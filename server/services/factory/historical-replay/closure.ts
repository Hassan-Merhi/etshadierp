import Decimal from "decimal.js";
import type {
  BatchCorrection,
  BatchInfo,
  BlockedBatch,
  SourceCorrection,
  SourceInfo,
} from "./types";

export interface SelectedSupplierCorrectionPlan {
  rootBatchIds: Set<number>;
  closureBatchIds: Set<number>;
  allBatchPlans: BatchCorrection[];
  changedBatchCorrections: BatchCorrection[];
  sourceCorrections: Map<number, SourceCorrection>;
  blockedBatches: BlockedBatch[];
}

/**
 * Start from batches that consume one of the selected suppliers directly, then
 * follow BATCH sources downstream. Unrelated company batches are never added.
 */
export function buildSelectedSupplierBatchClosure(
  sourceInfos: SourceInfo[],
  selectedSupplierIds: Set<number>
): { rootBatchIds: Set<number>; closureBatchIds: Set<number> } {
  const rootBatchIds = new Set<number>();
  for (const source of sourceInfos) {
    if (
      source.pricingBasis === "SUPPLIER_LOCKED_RATE"
      && source.supplierId != null
      && selectedSupplierIds.has(source.supplierId)
    ) {
      rootBatchIds.add(source.batchId);
    }
  }

  const dependentsByUpstream = new Map<number, Set<number>>();
  for (const source of sourceInfos) {
    if (source.pricingBasis !== "BATCH" || source.sourceBatchId == null) continue;
    const dependents = dependentsByUpstream.get(source.sourceBatchId) ?? new Set<number>();
    dependents.add(source.batchId);
    dependentsByUpstream.set(source.sourceBatchId, dependents);
  }

  const closureBatchIds = new Set(rootBatchIds);
  const queue = [...rootBatchIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependentsByUpstream.get(current) ?? []) {
      if (closureBatchIds.has(dependent)) continue;
      closureBatchIds.add(dependent);
      queue.push(dependent);
    }
  }

  return { rootBatchIds, closureBatchIds };
}

function needsBatchUpdate(correction: BatchCorrection): boolean {
  return Math.abs(correction.expectedCostPerKg - correction.storedCostPerKg) > 0.000001
    || Math.abs(correction.expectedTotalCost - correction.storedTotalCost) > 0.01;
}

/**
 * Compute correction math only for the selected-supplier downstream closure.
 *
 * Isolation rules:
 * - selected supplier sources use their replayed historical rate;
 * - internal BATCH sources follow corrected upstream batch cost;
 * - unrelated supplier/container sources remain at their persisted cost;
 * - BATCH sources pointing outside the closure remain persisted external inputs.
 */
export function buildSelectedSupplierCorrectionPlan(params: {
  batchInfoMap: Map<number, BatchInfo>;
  sourceInfos: SourceInfo[];
  selectedSupplierIds: Set<number>;
  expectedRateAtBatch: Map<string, number>;
  canonicalRateByContainer: Map<number, number>;
}): SelectedSupplierCorrectionPlan {
  const {
    batchInfoMap,
    sourceInfos,
    selectedSupplierIds,
    expectedRateAtBatch,
  } = params;
  const { rootBatchIds, closureBatchIds } = buildSelectedSupplierBatchClosure(
    sourceInfos,
    selectedSupplierIds
  );

  const sourcesByBatch = new Map<number, SourceInfo[]>();
  for (const source of sourceInfos) {
    if (!closureBatchIds.has(source.batchId)) continue;
    const sources = sourcesByBatch.get(source.batchId) ?? [];
    sources.push(source);
    sourcesByBatch.set(source.batchId, sources);
  }

  const internalDependencies = new Map<number, Set<number>>();
  const dependents = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  const blockedIds = new Set<number>();
  const reasonByBatch = new Map<number, string>();

  for (const batchId of closureBatchIds) inDegree.set(batchId, 0);
  for (const source of sourceInfos) {
    if (!closureBatchIds.has(source.batchId) || source.pricingBasis !== "BATCH") continue;
    if (source.sourceBatchId == null || !batchInfoMap.has(source.sourceBatchId)) {
      blockedIds.add(source.batchId);
      reasonByBatch.set(source.batchId, "UPSTREAM_BATCH_MISSING");
      continue;
    }
    if (!closureBatchIds.has(source.sourceBatchId)) continue;

    const dependencies = internalDependencies.get(source.batchId) ?? new Set<number>();
    if (!dependencies.has(source.sourceBatchId)) {
      dependencies.add(source.sourceBatchId);
      internalDependencies.set(source.batchId, dependencies);
      inDegree.set(source.batchId, (inDegree.get(source.batchId) ?? 0) + 1);
      const downstream = dependents.get(source.sourceBatchId) ?? new Set<number>();
      downstream.add(source.batchId);
      dependents.set(source.sourceBatchId, downstream);
    }
  }

  const queue = [...closureBatchIds].filter((batchId) => (inDegree.get(batchId) ?? 0) === 0);
  const processOrder: number[] = [];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const batchId = queue.shift()!;
    if (visited.has(batchId)) continue;
    visited.add(batchId);
    processOrder.push(batchId);
    for (const downstream of dependents.get(batchId) ?? []) {
      const nextDegree = (inDegree.get(downstream) ?? 0) - 1;
      inDegree.set(downstream, nextDegree);
      if (nextDegree === 0) queue.push(downstream);
    }
  }

  const cycleBatchIds = new Set<number>();
  for (const batchId of closureBatchIds) {
    if (!visited.has(batchId)) cycleBatchIds.add(batchId);
  }

  const correctedBatchCost = new Map<number, number>();
  const allBatchPlans: BatchCorrection[] = [];
  const sourceCorrections = new Map<number, SourceCorrection>();

  for (const batchId of processOrder) {
    if (cycleBatchIds.has(batchId) || blockedIds.has(batchId)) continue;
    const batch = batchInfoMap.get(batchId);
    const sources = sourcesByBatch.get(batchId) ?? [];
    if (!batch || sources.length === 0) continue;

    const blockedUpstream = sources.some((source) =>
      source.pricingBasis === "BATCH"
      && source.sourceBatchId != null
      && closureBatchIds.has(source.sourceBatchId)
      && (cycleBatchIds.has(source.sourceBatchId) || blockedIds.has(source.sourceBatchId))
    );
    if (blockedUpstream) {
      blockedIds.add(batchId);
      reasonByBatch.set(batchId, "UPSTREAM_BATCH_BLOCKED");
      continue;
    }

    let totalCost = new Decimal(0);
    let totalWeight = new Decimal(0);
    let blocked = false;
    const correctedSourceCosts = new Map<number, number>();

    for (const source of sources) {
      const weight = new Decimal(source.weightKg);
      if (weight.lte(0)) {
        blockedIds.add(batchId);
        reasonByBatch.set(batchId, "ZERO_WEIGHT_SOURCE");
        blocked = true;
        break;
      }

      let correctedCostPerKg: number;
      if (source.pricingBasis === "BATCH") {
        if (source.sourceBatchId == null || !batchInfoMap.has(source.sourceBatchId)) {
          blockedIds.add(batchId);
          reasonByBatch.set(batchId, "UPSTREAM_BATCH_MISSING");
          blocked = true;
          break;
        }
        if (closureBatchIds.has(source.sourceBatchId)) {
          const upstreamCost = correctedBatchCost.get(source.sourceBatchId);
          if (upstreamCost == null) {
            blockedIds.add(batchId);
            reasonByBatch.set(batchId, "UPSTREAM_BATCH_BLOCKED");
            blocked = true;
            break;
          }
          correctedCostPerKg = upstreamCost;
        } else {
          correctedCostPerKg = source.storedCostPerKg;
        }
      } else if (
        source.pricingBasis === "SUPPLIER_LOCKED_RATE"
        && source.supplierId != null
        && selectedSupplierIds.has(source.supplierId)
      ) {
        const expected = expectedRateAtBatch.get(`${source.supplierId}:${source.batchId}`);
        if (expected == null) {
          blockedIds.add(batchId);
          reasonByBatch.set(batchId, "MISSING_SUPPLIER_RATE");
          blocked = true;
          break;
        }
        correctedCostPerKg = expected;
      } else if (source.pricingBasis === "MANUAL_REVIEW") {
        blockedIds.add(batchId);
        reasonByBatch.set(batchId, "MANUAL_REVIEW_SOURCE");
        blocked = true;
        break;
      } else {
        correctedCostPerKg = source.storedCostPerKg;
      }

      correctedSourceCosts.set(source.sourceId, correctedCostPerKg);
      totalCost = totalCost.plus(weight.times(correctedCostPerKg));
      totalWeight = totalWeight.plus(weight);
    }

    if (blocked) continue;
    const expectedCostPerKg = totalWeight.gt(0)
      ? totalCost.div(totalWeight).toDecimalPlaces(6).toNumber()
      : 0;
    const expectedTotalCost = totalCost.toDecimalPlaces(6).toNumber();
    correctedBatchCost.set(batchId, expectedCostPerKg);

    const correction: BatchCorrection = {
      batchId,
      batchCode: batch.batchCode,
      status: batch.status,
      batchDate: batch.batchDate,
      storedCostPerKg: batch.storedCostPerKg,
      expectedCostPerKg,
      storedTotalCost: batch.storedTotalCost,
      expectedTotalCost,
      correctedSourceCosts,
    };
    allBatchPlans.push(correction);

    for (const source of sources) {
      const expectedSourceCost = correctedSourceCosts.get(source.sourceId);
      if (expectedSourceCost == null) continue;
      const expectedSourceTotal = new Decimal(source.weightKg)
        .times(expectedSourceCost)
        .toDecimalPlaces(6)
        .toNumber();
      if (
        Math.abs(expectedSourceCost - source.storedCostPerKg) <= 0.000001
        && Math.abs(expectedSourceTotal - source.storedTotalCost) <= 0.01
      ) {
        continue;
      }
      sourceCorrections.set(source.sourceId, {
        sourceId: source.sourceId,
        batchId: source.batchId,
        pricingBasis: source.pricingBasis,
        weightKg: source.weightKg,
        expectedCostPerKg: expectedSourceCost,
        expectedTotalCost: expectedSourceTotal,
      });
    }
  }

  const blockedBatches: BlockedBatch[] = [];
  for (const batchId of cycleBatchIds) {
    const batch = batchInfoMap.get(batchId);
    if (!batch) continue;
    blockedBatches.push({
      batchId,
      batchCode: batch.batchCode,
      reasons: ["BATCH_DEPENDENCY_CYCLE"],
      dependencyPath: [],
    });
  }
  for (const batchId of blockedIds) {
    if (cycleBatchIds.has(batchId)) continue;
    const batch = batchInfoMap.get(batchId);
    if (!batch) continue;
    blockedBatches.push({
      batchId,
      batchCode: batch.batchCode,
      reasons: [reasonByBatch.get(batchId) ?? "UPSTREAM_BATCH_BLOCKED"],
      dependencyPath: [],
    });
  }

  return {
    rootBatchIds,
    closureBatchIds,
    allBatchPlans,
    changedBatchCorrections: allBatchPlans.filter(needsBatchUpdate),
    sourceCorrections,
    blockedBatches,
  };
}
