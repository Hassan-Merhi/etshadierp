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

  // Freeze the final scoped preview into the signed fingerprint input. The low-level
  // preview is company-wide, while these fields describe the fully-expanded selection.
  scope._fullPreview.summary.incompleteMixedBatchSupplierScopes = 0;
  scope._fullPreview.summary.blockedBatches = 0;

  return scope;
}
