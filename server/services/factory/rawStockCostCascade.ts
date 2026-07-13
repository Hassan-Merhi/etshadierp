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
import { factoryRawStock, factoryMixBatchSources, factoryMixBatches, factoryBales } from "@shared/schema";

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
  //    enforced by the factory_raw_stock_company_container_unique index).
  const rawStockRows = await tx
    .select()
    .from(factoryRawStock)
    .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));
  for (const row of rawStockRows) {
    await tx
      .update(factoryRawStock)
      .set({ costPerKg: String(newCostPerKg), costPerKgUsd: String(newCostPerKgUsd) })
      .where(eq(factoryRawStock.id, row.id));
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
