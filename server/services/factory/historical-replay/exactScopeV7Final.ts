import Decimal from "decimal.js";
import type {
  ReplayQueryExecutor,
  ReplayScopeInternal,
  ReplayWriteScope,
} from "./types";
import { buildBatchConsumptionEvents } from "./readModel";
import {
  buildExactHistoricalReplayScopeInternalFinal,
} from "./exactScopeFinal";
import { normalizeReplayWriteScope } from "./selectedScope";
import {
  connectedScopeIsComplete,
  expandConnectedSupplierClosure,
} from "./supplierClosureV7Final";
import { previewHistoricalCostReplayWithExecutor } from "./securePreview";

function safetyError(message: string, details?: unknown): Error & { code: string; details?: unknown } {
  return Object.assign(new Error(message), {
    // The existing protected route already maps this code to HTTP 409. Reusing it
    // keeps all V7 fail-closed conditions out of the generic 500 path.
    code: "HISTORICAL_REPLAY_SCOPE_VIOLATION",
    details,
  });
}

function sorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function assertPlannedCostArithmetic(scope: ReplayScopeInternal): void {
  const sourceCorrections = scope._sourceCorrections ?? new Map();
  for (const correction of sourceCorrections.values()) {
    const expectedTotal = new Decimal(correction.weightKg)
      .times(correction.expectedCostPerKg)
      .toDecimalPlaces(6);
    if (expectedTotal.minus(correction.expectedTotalCost).abs().gt(0.01)) {
      throw safetyError("Historical Replay source arithmetic does not reconcile.", {
        sourceId: correction.sourceId,
        batchId: correction.batchId,
        expectedFromWeightAndRate: expectedTotal.toNumber(),
        plannedTotal: correction.expectedTotalCost,
      });
    }
  }

  const sourcesByBatchId = new Map<number, typeof scope._sourceInfos>();
  for (const source of scope._sourceInfos) {
    const rows = sourcesByBatchId.get(source.batchId) ?? [];
    rows.push(source);
    sourcesByBatchId.set(source.batchId, rows);
  }

  for (const correction of scope._batchCorrections) {
    const sources = sourcesByBatchId.get(correction.batchId) ?? [];
    if (sources.length === 0) {
      throw safetyError("Historical Replay batch has no complete source set.", {
        batchId: correction.batchId,
        batchCode: correction.batchCode,
      });
    }

    let totalWeight = new Decimal(0);
    let totalCost = new Decimal(0);
    for (const source of sources) {
      const costPerKg = sourceCorrections.get(source.sourceId)?.expectedCostPerKg
        ?? correction.correctedSourceCosts.get(source.sourceId)
        ?? source.storedCostPerKg;
      totalWeight = totalWeight.plus(source.weightKg);
      totalCost = totalCost.plus(new Decimal(source.weightKg).times(costPerKg));
    }

    if (totalWeight.lte(0)) {
      throw safetyError("Historical Replay batch has no positive source weight.", {
        batchId: correction.batchId,
        batchCode: correction.batchCode,
      });
    }

    const expectedTotal = totalCost.toDecimalPlaces(6);
    const expectedRate = totalCost.div(totalWeight).toDecimalPlaces(6);
    if (
      expectedTotal.minus(correction.expectedTotalCost).abs().gt(0.01)
      || expectedRate.minus(correction.expectedCostPerKg).abs().gt(0.000001)
    ) {
      throw safetyError("Historical Replay batch arithmetic does not reconcile.", {
        batchId: correction.batchId,
        batchCode: correction.batchCode,
        expectedTotalFromSources: expectedTotal.toNumber(),
        plannedTotal: correction.expectedTotalCost,
        expectedRateFromSources: expectedRate.toNumber(),
        plannedRate: correction.expectedCostPerKg,
      });
    }
  }
}

export async function buildExactHistoricalReplayScopeV7Final(params: {
  companyId: number;
  selectedSupplierIds: Set<number>;
  includeCompletedBatches: boolean;
  includeFinalizedBales: boolean;
  executor: ReplayQueryExecutor;
}): Promise<ReplayWriteScope> {
  const internal = await buildExactHistoricalReplayScopeInternalV7Final({
    ...params,
    lockRows: false,
  });
  return normalizeReplayWriteScope(internal);
}

/**
 * Final V7 scope builder. It expands the requested supplier selection to the full
 * connected mixed-batch supplier closure before the legacy exact-scope engine runs.
 * No supplier in a connected mixed batch can be silently left on a known-wrong
 * persisted rate, and no blocked batch can receive a confirmation token.
 */
export async function buildExactHistoricalReplayScopeInternalV7Final(params: {
  companyId: number;
  selectedSupplierIds: Set<number>;
  includeCompletedBatches: boolean;
  includeFinalizedBales: boolean;
  executor: ReplayQueryExecutor;
  lockRows?: boolean;
}): Promise<ReplayScopeInternal> {
  if (params.selectedSupplierIds.size === 0) {
    throw safetyError("Historical Replay requires at least one selected supplier.");
  }

  // buildBatchConsumptionEvents always returns the complete source read-model; the
  // supplier filter controls only emitted timeline events. An empty filter is enough
  // for closure discovery without doing a partial supplier replay.
  const { sourceInfos } = await buildBatchConsumptionEvents(
    params.executor,
    params.companyId,
    new Set<number>()
  );

  const closure = expandConnectedSupplierClosure(sourceInfos, params.selectedSupplierIds);
  if (!connectedScopeIsComplete(sourceInfos, closure)) {
    throw safetyError(
      "Historical Replay cannot prepare because a connected mixed batch has unresolved inventory ownership.",
      {
        requestedSupplierIds: sorted(params.selectedSupplierIds),
        expandedSupplierIds: sorted(closure.supplierIds),
        unresolvedBatchIds: sorted(closure.unresolvedBatchIds),
      }
    );
  }

  const preview = await previewHistoricalCostReplayWithExecutor(params.executor, params.companyId);
  if (preview.summary.scanCoverageError) {
    throw safetyError("Historical Replay scan coverage is incomplete. No token was issued.");
  }

  const previewBySupplierId = new Map(preview.supplierRows.map((row) => [row.supplierId, row]));
  const unsafeSuppliers = sorted(closure.supplierIds)
    .map((supplierId) => previewBySupplierId.get(supplierId) ?? {
      supplierId,
      supplierName: `Supplier #${supplierId}`,
      safeToRepair: false,
      reasons: ["SUPPLIER_TIMELINE_UNAVAILABLE"],
    })
    .filter((row) => !row.safeToRepair)
    .map((row) => ({
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      reasons: row.reasons,
    }));

  if (unsafeSuppliers.length > 0) {
    throw safetyError(
      "Historical Replay cannot prepare until every supplier in the connected mixed-batch scope is safe.",
      { unsafeSuppliers }
    );
  }

  const scope = await buildExactHistoricalReplayScopeInternalFinal({
    ...params,
    selectedSupplierIds: closure.supplierIds,
  });

  const expectedSupplierIds = sorted(closure.supplierIds);
  const actualSupplierIds = sorted(scope.supplierIds);
  if (JSON.stringify(expectedSupplierIds) !== JSON.stringify(actualSupplierIds)) {
    throw safetyError(
      "Historical Replay exact scope dropped a supplier from the connected closure.",
      { expectedSupplierIds, actualSupplierIds }
    );
  }

  if (scope.blockedBatches.length > 0) {
    throw safetyError(
      "Historical Replay has blocked batches. Resolve every reason before preparing a token.",
      { blockedBatches: scope.blockedBatches }
    );
  }

  assertPlannedCostArithmetic(scope);

  // Freeze the final scoped preview into the signed fingerprint input. The low-level
  // preview is company-wide, while these fields describe the fully-expanded selection.
  scope._fullPreview.summary.incompleteMixedBatchSupplierScopes = 0;
  scope._fullPreview.summary.blockedBatches = 0;

  return scope;
}
