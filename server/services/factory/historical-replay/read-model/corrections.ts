import Decimal from "decimal.js";
import {
  FINALIZED_BALE_STATUSES,
  type ReplayQueryExecutor,
  type BatchInfo,
  type SourceInfo,
  type BatchCorrection,
  type BlockedBatch,
} from "../types";

export function computeBatchCorrections(
  batchInfoMap: Map<number, BatchInfo>,
  sourceInfos: SourceInfo[],
  expectedRateAtBatch: Map<string, number>,
  canonicalRateByContainer: Map<number, number>
): { corrections: BatchCorrection[]; blockedBatches: BlockedBatch[] } {
  const sourcesByBatch = new Map<number, SourceInfo[]>();
  for (const source of sourceInfos) {
    const values = sourcesByBatch.get(source.batchId) ?? [];
    values.push(source);
    sourcesByBatch.set(source.batchId, values);
  }

  const allBatchIds = new Set(batchInfoMap.keys());
  const dependencies = new Map<number, Set<number>>();
  const dependents = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  for (const source of sourceInfos) {
    if (source.sourceBatchId == null || !allBatchIds.has(source.batchId)) continue;
    const values = dependencies.get(source.batchId) ?? new Set<number>();
    values.add(source.sourceBatchId);
    dependencies.set(source.batchId, values);
  }
  for (const [batchId, values] of dependencies) {
    inDegree.set(batchId, values.size);
    for (const upstream of values) {
      const downstream = dependents.get(upstream) ?? new Set<number>();
      downstream.add(batchId);
      dependents.set(upstream, downstream);
    }
  }

  const queue = [...allBatchIds].filter((id) => (inDegree.get(id) ?? 0) === 0);
  const order: number[] = [];
  const visited = new Set<number>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    order.push(current);
    for (const child of dependents.get(current) ?? []) {
      const nextDegree = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, nextDegree);
      if (nextDegree <= 0) queue.push(child);
    }
  }

  const cycleBatchIds = new Set([...allBatchIds].filter((id) => !visited.has(id)));
  const blockedIds = new Set<number>();
  const reasonByBatch = new Map<number, string>();
  for (const source of sourceInfos) {
    if (source.sourceBatchId != null && !allBatchIds.has(source.sourceBatchId)) {
      blockedIds.add(source.batchId);
      reasonByBatch.set(source.batchId, "UPSTREAM_BATCH_MISSING");
    }
  }

  const correctedBatchCost = new Map<number, number>();
  const corrections: BatchCorrection[] = [];
  for (const batchId of order) {
    if (cycleBatchIds.has(batchId) || blockedIds.has(batchId)) continue;
    const batch = batchInfoMap.get(batchId);
    const sources = sourcesByBatch.get(batchId) ?? [];
    if (!batch || sources.length === 0) continue;

    const blockedUpstream = sources.some(
      (source) =>
        source.pricingBasis === "BATCH" &&
        source.sourceBatchId != null &&
        (cycleBatchIds.has(source.sourceBatchId) || blockedIds.has(source.sourceBatchId))
    );
    if (blockedUpstream) {
      blockedIds.add(batchId);
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

      let correctedCost: number;
      if (source.pricingBasis === "BATCH" && source.sourceBatchId != null) {
        const upstreamCost = correctedBatchCost.get(source.sourceBatchId);
        if (upstreamCost == null) {
          blockedIds.add(batchId);
          blocked = true;
          break;
        }
        correctedCost = upstreamCost;
      } else if (source.pricingBasis === "SUPPLIER_LOCKED_RATE" && source.supplierId != null) {
        const expected = expectedRateAtBatch.get(`${source.supplierId}:${source.batchId}`);
        if (expected == null) {
          blockedIds.add(batchId);
          reasonByBatch.set(batchId, "MISSING_SUPPLIER_RATE");
          blocked = true;
          break;
        }
        correctedCost = expected;
      } else if (source.pricingBasis === "CONTAINER_DIRECT" && source.containerId != null) {
        const canonical = canonicalRateByContainer.get(source.containerId);
        if (canonical == null) {
          blockedIds.add(batchId);
          reasonByBatch.set(batchId, "UNRESOLVED_FX");
          blocked = true;
          break;
        }
        correctedCost = canonical;
      } else if (source.pricingBasis === "MANUAL_REVIEW") {
        blockedIds.add(batchId);
        reasonByBatch.set(batchId, "MANUAL_REVIEW_SOURCE");
        blocked = true;
        break;
      } else {
        correctedCost = source.storedCostPerKg;
      }

      correctedSourceCosts.set(source.sourceId, correctedCost);
      totalCost = totalCost.plus(weight.times(correctedCost));
      totalWeight = totalWeight.plus(weight);
    }

    if (blocked) continue;
    const expectedCostPerKg = totalWeight.gt(0) ? totalCost.div(totalWeight).toDecimalPlaces(6).toNumber() : 0;
    const expectedTotalCost = totalCost.toDecimalPlaces(6).toNumber();
    correctedBatchCost.set(batchId, expectedCostPerKg);
    if (
      Math.abs(expectedCostPerKg - batch.storedCostPerKg) > 0.000001 ||
      Math.abs(expectedTotalCost - batch.storedTotalCost) > 0.01
    ) {
      corrections.push({
        batchId,
        batchCode: batch.batchCode,
        status: batch.status,
        batchDate: batch.batchDate,
        storedCostPerKg: batch.storedCostPerKg,
        expectedCostPerKg,
        storedTotalCost: batch.storedTotalCost,
        expectedTotalCost,
        correctedSourceCosts,
      });
    }
  }

  const blockedBatches: BlockedBatch[] = [];
  for (const batchId of cycleBatchIds) {
    const batch = batchInfoMap.get(batchId);
    if (batch)
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
    if (batch) {
      blockedBatches.push({
        batchId,
        batchCode: batch.batchCode,
        reasons: [reasonByBatch.get(batchId) ?? "UPSTREAM_BATCH_MISSING"],
        dependencyPath: [],
      });
    }
  }
  return { corrections, blockedBatches };
}

export async function loadBaleCountsByBatch(
  executor: ReplayQueryExecutor,
  companyId: number,
  batchIds: number[]
): Promise<{ total: Map<number, number>; finalized: Map<number, number> }> {
  if (batchIds.length === 0) return { total: new Map(), finalized: new Map() };
  const finalizedIn = FINALIZED_BALE_STATUSES.map((status) => `'${status}'`).join(",");
  const [totalResult, finalizedResult] = await Promise.all([
    executor.query<{ mix_batch_id: number; cnt: string }>(
      `SELECT mix_batch_id, COUNT(*)::int AS cnt
       FROM factory_bales
       WHERE mix_batch_id = ANY($1)
         AND company_id = $2
         AND status NOT IN ('DELETED','REMOVED')
       GROUP BY mix_batch_id`,
      [batchIds, companyId]
    ),
    executor.query<{ mix_batch_id: number; cnt: string }>(
      `SELECT mix_batch_id, COUNT(*)::int AS cnt
       FROM factory_bales
       WHERE mix_batch_id = ANY($1)
         AND company_id = $2
         AND status IN (${finalizedIn})
       GROUP BY mix_batch_id`,
      [batchIds, companyId]
    ),
  ]);
  return {
    total: new Map(totalResult.rows.map((row) => [row.mix_batch_id, Number(row.cnt)])),
    finalized: new Map(finalizedResult.rows.map((row) => [row.mix_batch_id, Number(row.cnt)])),
  };
}

/** Executor-aware preview used by read-only preview and locked apply. */
