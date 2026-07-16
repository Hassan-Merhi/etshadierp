/**
 * Shared cascade logic for propagating a corrected raw-material landed cost
 * (per kg, in the container's native currency) down through the chain:
 *
 *   factoryRawStock  →  factoryMixBatchSources  →  factoryMixBatches  →  factoryBales
 *
 * Extracted from the inline logic in rawStockContainerRoutes.ts's
 * post-offload-charges handler so the exact same, tested math is reused by:
 *   - the post-offload-charges route (adding a late freight/duty/other charge)
 *   - the one-off historical landed-cost repair script (scripts/repair-*.ts)
 *
 * IMPORTANT: this only touches cost/valuation fields (costPerKg, costPerKgUsd,
 * totalCost). It never touches quantities, vouchers, supplier balances, or
 * payments — callers are responsible for those concerns separately.
 *
 * Must be called inside an existing `db.transaction(async (tx) => {...})` —
 * pass the `tx` handle so all writes are atomic with the caller's other work.
 */
import { eq, and, sql, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { factoryRawStock, factoryMixBatchSources, factoryMixBatches, factoryBales, factoryContainers, factorySuppliers } from "@shared/schema";
import { getLockedSupplierRate, getAuthoritativeSupplierRemainingKg } from "./rawStockLockedRate";

export interface CascadeResult {
  rawStockRowsUpdated: number;
  affectedBatches: {
    batchId: number;
    batchCode: string;
    status: string;
    oldCostPerKg: number;
    newCostPerKg: number;
    /** Sum of mix-batch source weights belonging ONLY to the container being
     *  corrected — NOT the total batch weight (which may blend multiple containers). */
    weightKgFromContainer: number;
    wasCompleted: boolean;
  }[];
  affectedBales: { baleId: number; baleCode?: string }[];
}

const COMPLETED_BATCH_STATUSES_SHARED = ["COMPLETED", "CLOSED"];

/**
 * Recompute a single mix batch's weighted-average cost/kg from ALL of its
 * current sources using Decimal.js (no binary floating-point drift), then
 * cascade that blended cost down to every non-deleted bale still pressed from
 * it. Shared by cascadeContainerCostChange (triggered by a container's cost
 * changing) and any source-level repair (e.g. a mix-batch-source recorded
 * with cost 0) — both need the exact same weighted-average + bale-cascade math.
 */
export async function recomputeBatchAndCascadeBales(
  tx: any,
  companyId: number,
  batchId: number
): Promise<{
  batchCode: string;
  status: string;
  oldCostPerKg: number;
  newCostPerKg: number;
  /** Total weight of all sources in the batch (not per-container). */
  totalBatchWeightKg: number;
  wasCompleted: boolean;
  bales: { baleId: number; baleCode?: string }[];
}> {
  const [batch] = await tx.select().from(factoryMixBatches).where(eq(factoryMixBatches.id, batchId));
  const oldCostPerKg = batch ? parseFloat(batch.costPerKg || "0") : 0;
  const wasCompleted = !!batch && COMPLETED_BATCH_STATUSES_SHARED.includes(batch.status);
  const allSources = await tx.select().from(factoryMixBatchSources).where(eq(factoryMixBatchSources.mixBatchId, batchId));

  // Use Decimal.js for all monetary/weight arithmetic — prevents binary
  // floating-point drift from compounding over large (20 000+ kg) batches.
  let dTotalCost = new Decimal(0);
  let dTotalWeight = new Decimal(0);
  for (const s of allSources) {
    dTotalCost = dTotalCost.plus(new Decimal(s.totalCost || "0"));
    dTotalWeight = dTotalWeight.plus(new Decimal(s.weightKg || "0"));
  }
  const dBatchCostPerKg = dTotalWeight.gt(0) ? dTotalCost.div(dTotalWeight) : new Decimal(0);
  const batchCostPerKg = dBatchCostPerKg.toNumber();

  await tx
    .update(factoryMixBatches)
    .set({
      costPerKg: dBatchCostPerKg.toDecimalPlaces(6).toFixed(6),
      totalCost: dTotalCost.toDecimalPlaces(6).toFixed(6),
      updatedAt: new Date(),
    })
    .where(eq(factoryMixBatches.id, batchId));

  const balesInBatch = await tx
    .select({ id: factoryBales.id, baleCode: factoryBales.baleCode, weightKg: factoryBales.weightKg })
    .from(factoryBales)
    .where(
      and(
        eq(factoryBales.mixBatchId, batchId),
        eq(factoryBales.companyId, companyId),
        sql`${factoryBales.status} NOT IN ('DELETED','REMOVED')`
      )
    );
  const bales: { baleId: number; baleCode?: string }[] = [];
  for (const bale of balesInBatch) {
    const dBaleWt = new Decimal(bale.weightKg as string || "0");
    const dBaleTotalCost = dBaleWt.times(dBatchCostPerKg);
    await tx
      .update(factoryBales)
      .set({
        costPerKg: dBatchCostPerKg.toDecimalPlaces(6).toFixed(6),
        totalCost: dBaleTotalCost.toDecimalPlaces(6).toFixed(6),
        updatedAt: new Date(),
      })
      .where(eq(factoryBales.id, bale.id));
    bales.push({ baleId: bale.id, baleCode: bale.baleCode });
  }

  return {
    batchCode: batch?.batchCode || `#${batchId}`,
    status: batch?.status || "UNKNOWN",
    oldCostPerKg,
    newCostPerKg: batchCostPerKg,
    totalBatchWeightKg: dTotalWeight.toNumber(),
    wasCompleted,
    bales,
  };
}

/**
 * Recalculate and write the corrected inclusive cost/kg for a single container's
 * raw stock row(s), then cascade the change through every mix-batch source that
 * drew from this container, recompute each affected batch's weighted-average
 * cost/kg from ALL of its sources (not just this container's), and push the new
 * batch cost down to every bale still carrying that batch's cost.
 */
export async function cascadeContainerCostChange(
  tx: any,
  params: {
    companyId: number;
    containerId: number;
    newCostPerKg: number; // native currency, inclusive landed cost per kg
    newCostPerKgUsd: number; // USD equivalent
  },
  opts: {
    /** When true, also rewrites COMPLETED/CLOSED mix batches (and their bales)
     * sourced from this container. This is an explicit, admin-approved override
     * of the normal "historical record is locked" rule above — only ever set
     * from the recalc apply route, and only when the admin opted in per-request. */
    includeCompletedBatches?: boolean;
  } = {}
): Promise<CascadeResult> {
  const { companyId, containerId, newCostPerKg, newCostPerKgUsd } = params;
  const { includeCompletedBatches = false } = opts;

  const dNewCostPerKgUsd = new Decimal(newCostPerKgUsd);

  // 1. Raw stock — update ALL rows for this container/company (normally exactly one,
  //    enforced by the factory_raw_stock_company_container_unique index). Capture
  //    each row's OLD cost and still-remaining kg BEFORE overwriting, so the locked
  //    rate correction below can isolate exactly the value impact that still
  //    belongs to current stock (see step 1a).
  const rawStockRows = await tx
    .select()
    .from(factoryRawStock)
    .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

  let dCorrectedContainerRemainingKg = new Decimal(0);
  let dOldValueOfRemaining = new Decimal(0);
  for (const row of rawStockRows) {
    const dReceived = new Decimal(row.receivedKg as string || "0");
    const dUsed = new Decimal(row.usedKg as string || "0");
    const dRemaining = Decimal.max(0, dReceived.minus(dUsed));
    const dOldCostUsd = new Decimal(row.costPerKgUsd as string || row.costPerKg as string || "0");
    dCorrectedContainerRemainingKg = dCorrectedContainerRemainingKg.plus(dRemaining);
    dOldValueOfRemaining = dOldValueOfRemaining.plus(dRemaining.times(dOldCostUsd));

    await tx
      .update(factoryRawStock)
      .set({ costPerKg: String(newCostPerKg), costPerKgUsd: String(newCostPerKgUsd) })
      .where(eq(factoryRawStock.id, row.id));
  }

  // 1a. Nudge the supplier's locked rate to reflect only the value delta that
  // still belongs to current remaining stock — exactly as a moving-average
  // correction (see rawStockLockedRate.ts for the rationale).
  const [container] = await tx
    .select({ supplierId: factoryContainers.supplierId })
    .from(factoryContainers)
    .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
  if (container?.supplierId && dCorrectedContainerRemainingKg.gt(0)) {
    const oldLockedRate = await getLockedSupplierRate(tx, companyId, container.supplierId, { forUpdate: true });
    const supplierTotalRemainingKg = await getAuthoritativeSupplierRemainingKg(tx, companyId, container.supplierId);
    const dOldCostWeightedAvg = dOldValueOfRemaining.div(dCorrectedContainerRemainingKg);
    const dValueDelta = dCorrectedContainerRemainingKg.times(dNewCostPerKgUsd.minus(dOldCostWeightedAvg));
    const dSupplierTotal = new Decimal(supplierTotalRemainingKg);
    const dNewLockedRate = dSupplierTotal.gt(0)
      ? new Decimal(oldLockedRate).plus(dValueDelta.div(dSupplierTotal))
      : dNewCostPerKgUsd;
    await tx
      .update(factorySuppliers)
      .set({ currentRawMaterialCostPerKgUsd: Decimal.max(0, dNewLockedRate).toFixed(8), updatedAt: new Date() })
      .where(and(eq(factorySuppliers.id, container.supplierId), eq(factorySuppliers.companyId, companyId)));
  }

  // 2. Mix batch sources sourced from this container.
  const OPEN_BATCH_STATUSES = ["ACTIVE", "OPEN", "CARRY_FORWARD"];
  const COMPLETED_BATCH_STATUSES = ["COMPLETED", "CLOSED"];
  const batchStatusFilter = includeCompletedBatches
    ? [...OPEN_BATCH_STATUSES, ...COMPLETED_BATCH_STATUSES]
    : OPEN_BATCH_STATUSES;
  const mixSources = await tx
    .select({ src: factoryMixBatchSources, batchStatus: factoryMixBatches.status })
    .from(factoryMixBatchSources)
    .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
    .where(
      and(
        eq(factoryMixBatchSources.containerId, containerId),
        inArray(factoryMixBatches.status, batchStatusFilter),
        sql`${factoryMixBatches.deletedAt} IS NULL`
      )
    )
    .then((rows: any[]) => rows.map((r) => r.src));

  const affectedBatches: CascadeResult["affectedBatches"] = [];
  const affectedBales: CascadeResult["affectedBales"] = [];

  if (mixSources.length > 0) {
    // Track how much weight the target container contributes to each batch
    // (the cascade may touch several batches, each possibly blending many containers).
    const containerWeightByBatch = new Map<number, Decimal>();
    for (const src of mixSources) {
      const prev = containerWeightByBatch.get(src.mixBatchId) || new Decimal(0);
      containerWeightByBatch.set(src.mixBatchId, prev.plus(new Decimal(src.weightKg || "0")));
    }

    for (const src of mixSources) {
      // Mix-batch sources store cost in USD — use newCostPerKgUsd, not the native-currency value.
      const dSrcWeight = new Decimal(src.weightKg as string || "0");
      const dNewSourceTotalCost = dSrcWeight.times(dNewCostPerKgUsd);
      await tx
        .update(factoryMixBatchSources)
        .set({
          costPerKg: dNewCostPerKgUsd.toDecimalPlaces(6).toFixed(6),
          totalCost: dNewSourceTotalCost.toDecimalPlaces(6).toFixed(6),
        })
        .where(eq(factoryMixBatchSources.id, src.id));
    }

    // 3. Recompute weighted-average cost for every batch touched (from ALL its
    //    sources, not just this container's), then cascade to bales.
    const affectedBatchIds = [...new Set(mixSources.map((s: any) => s.mixBatchId as number))] as number[];
    for (const batchId of affectedBatchIds) {
      const { bales, totalBatchWeightKg: _totalWeight, ...batchResult } = await recomputeBatchAndCascadeBales(tx, companyId, batchId);
      affectedBatches.push({
        batchId,
        ...batchResult,
        weightKgFromContainer: (containerWeightByBatch.get(batchId) || new Decimal(0)).toNumber(),
      });
      affectedBales.push(...bales);
    }
  }

  return { rawStockRowsUpdated: rawStockRows.length, affectedBatches, affectedBales };
}
