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
import { eq, and, sql } from "drizzle-orm";
import { factoryRawStock, factoryMixBatchSources, factoryMixBatches, factoryBales, factoryContainers, factorySuppliers } from "@shared/schema";
import { getLockedSupplierRate, getAuthoritativeSupplierRemainingKg } from "./rawStockLockedRate";

export interface CascadeResult {
  rawStockRowsUpdated: number;
  affectedBatches: {
    batchId: number;
    batchCode: string;
    oldCostPerKg: number;
    newCostPerKg: number;
    weightKg: number;
  }[];
  affectedBales: { baleId: number; baleCode?: string }[];
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
  }
): Promise<CascadeResult> {
  const { companyId, containerId, newCostPerKg, newCostPerKgUsd } = params;

  // 1. Raw stock — update ALL rows for this container/company (normally exactly one,
  //    enforced by the factory_raw_stock_company_container_unique index). Capture
  //    each row's OLD cost and still-remaining kg BEFORE overwriting, so the locked
  //    rate correction below can isolate exactly the value impact that still
  //    belongs to current stock (see step 1a).
  const rawStockRows = await tx
    .select()
    .from(factoryRawStock)
    .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

  let correctedContainerRemainingKg = 0;
  let oldValueOfRemaining = 0;
  for (const row of rawStockRows) {
    const rowRemainingKg = Math.max(
      0,
      (parseFloat(row.receivedKg as string) || 0) - (parseFloat(row.usedKg as string) || 0)
    );
    const rowOldCostUsd = parseFloat(row.costPerKgUsd as string) || parseFloat(row.costPerKg as string) || 0;
    correctedContainerRemainingKg += rowRemainingKg;
    oldValueOfRemaining += rowRemainingKg * rowOldCostUsd;

    await tx
      .update(factoryRawStock)
      .set({ costPerKg: String(newCostPerKg), costPerKgUsd: String(newCostPerKgUsd) })
      .where(eq(factoryRawStock.id, row.id));
  }

  // 1a. This IS one of the two sanctioned ways a supplier's locked rate may change
  // (an explicit authorized landed-cost correction to a specific container). It
  // must apply ONLY the value impact of the correction that still belongs to
  // current remaining stock — never recompute from all-time received kg, which
  // would reintroduce already-consumed kilograms into the rate. The correction is
  // spread across the supplier's TOTAL current remaining kg (via the same
  // authoritative helper the offload formula and Raw Materials API use), exactly
  // like a moving-average nudge rather than a full re-derivation:
  //
  //   newLockedRate = oldLockedRate
  //                   + (correctedContainerRemainingKg × (newCostPerKgUsd − oldCostPerKgUsd))
  //                     ÷ supplierTotalRemainingKg
  const [container] = await tx
    .select({ supplierId: factoryContainers.supplierId })
    .from(factoryContainers)
    .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));
  if (container?.supplierId && correctedContainerRemainingKg > 0) {
    const oldLockedRate = await getLockedSupplierRate(tx, companyId, container.supplierId, { forUpdate: true });
    const supplierTotalRemainingKg = await getAuthoritativeSupplierRemainingKg(tx, companyId, container.supplierId);
    const oldCostWeightedAvgForContainer = oldValueOfRemaining / correctedContainerRemainingKg;
    const valueDelta = correctedContainerRemainingKg * (newCostPerKgUsd - oldCostWeightedAvgForContainer);
    const newLockedRate =
      supplierTotalRemainingKg > 0 ? oldLockedRate + valueDelta / supplierTotalRemainingKg : newCostPerKgUsd;
    await tx
      .update(factorySuppliers)
      .set({ currentRawMaterialCostPerKgUsd: String(Math.max(0, newLockedRate)), updatedAt: new Date() })
      .where(and(eq(factorySuppliers.id, container.supplierId), eq(factorySuppliers.companyId, companyId)));
  }

  // 2. Mix batch sources sourced from this container.
  const mixSources = await tx
    .select()
    .from(factoryMixBatchSources)
    .where(eq(factoryMixBatchSources.containerId, containerId));

  const affectedBatches: CascadeResult["affectedBatches"] = [];
  const affectedBales: CascadeResult["affectedBales"] = [];

  if (mixSources.length > 0) {
    for (const src of mixSources) {
      const newSourceTotalCost = parseFloat(src.weightKg) * newCostPerKg;
      await tx
        .update(factoryMixBatchSources)
        .set({ costPerKg: String(newCostPerKg), totalCost: String(newSourceTotalCost.toFixed(2)) })
        .where(eq(factoryMixBatchSources.id, src.id));
    }

    // 3. Recompute weighted-average cost for every batch touched (from ALL its
    //    sources, not just this container's — a batch may blend multiple suppliers).
    const affectedBatchIds = [...new Set(mixSources.map((s: any) => s.mixBatchId as number))] as number[];
    for (const batchId of affectedBatchIds) {
      const [batch] = await tx.select().from(factoryMixBatches).where(eq(factoryMixBatches.id, batchId));
      const oldCostPerKg = batch ? parseFloat(batch.costPerKg || "0") : 0;
      const allSources = await tx
        .select()
        .from(factoryMixBatchSources)
        .where(eq(factoryMixBatchSources.mixBatchId, batchId));
      const batchTotalCost = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.totalCost || "0"), 0);
      const batchTotalWeight = allSources.reduce((sum: number, s: any) => sum + parseFloat(s.weightKg || "0"), 0);
      const batchCostPerKg = batchTotalWeight > 0 ? batchTotalCost / batchTotalWeight : 0;
      await tx
        .update(factoryMixBatches)
        .set({
          costPerKg: String(batchCostPerKg.toFixed(4)),
          totalCost: String(batchTotalCost.toFixed(2)),
          updatedAt: new Date(),
        })
        .where(eq(factoryMixBatches.id, batchId));

      const srcWeight = mixSources
        .filter((s: any) => s.mixBatchId === batchId)
        .reduce((sum: number, s: any) => sum + parseFloat(s.weightKg || "0"), 0);
      affectedBatches.push({
        batchId,
        batchCode: batch?.batchCode || `#${batchId}`,
        oldCostPerKg,
        newCostPerKg: batchCostPerKg,
        weightKg: srcWeight,
      });

      // 4. Cascade the blended batch cost down to every bale still pressed from it.
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
      for (const bale of balesInBatch) {
        const baleWt = parseFloat(bale.weightKg as string) || 0;
        await tx
          .update(factoryBales)
          .set({
            costPerKg: String(batchCostPerKg.toFixed(4)),
            totalCost: String((baleWt * batchCostPerKg).toFixed(2)),
            updatedAt: new Date(),
          })
          .where(eq(factoryBales.id, bale.id));
        affectedBales.push({ baleId: bale.id, baleCode: bale.baleCode });
      }
    }
  }

  return { rawStockRowsUpdated: rawStockRows.length, affectedBatches, affectedBales };
}
