/**
 * Stable, receipt-weighted raw-material cost/kg for a supplier.
 *
 * This is the ONLY correct way to price a mix-batch supplier source. It must be
 * weighted by each row's RECEIVED kg — never by remaining/available kg — so the
 * rate stays fixed while stock is consumed (FIFO or otherwise) and only moves
 * when new stock is received or an existing container's landed cost is corrected.
 *
 * Do not inline this calculation elsewhere. Any supplier-source costing path in
 * factoryMixBatchRoutes.ts (create/edit/top-up/etc.) must call this helper so the
 * rate is computed identically everywhere.
 */
import { eq, and, isNull, sql } from "drizzle-orm";
import { factoryRawStock, factoryContainers } from "@shared/schema";

export interface StableSupplierRawStockRow {
  id: number;
  containerId: number;
  receivedKg: number;
  usedKg: number;
  costPerKgUsd: number;
  offloadedAt: Date;
}

export interface StableSupplierCostResult {
  /** Receipt-weighted cost/kg (USD). 0 if the supplier has no received stock. */
  costPerKgUsd: number;
  /** Total received kg across all non-deleted offloaded rows (used as the weight). */
  totalReceivedKg: number;
  /** Raw stock rows for this supplier, ordered oldest-offloaded-first — for FIFO allocation only. */
  rows: StableSupplierRawStockRow[];
}

/**
 * Computes the stable receipt-weighted cost/kg for a supplier's raw stock, and
 * returns the underlying rows (oldest-first) for FIFO usedKg allocation.
 *
 * IMPORTANT: `tx` should be the active transaction when called from inside a
 * mix-batch mutation so `.for("update")` row locks are honored consistently
 * with the existing FIFO-deduction code paths.
 */
export async function getStableSupplierCost(
  tx: any,
  companyId: number,
  supplierId: number,
  opts: { forUpdate?: boolean } = {}
): Promise<StableSupplierCostResult> {
  let query = tx
    .select({
      id: factoryRawStock.id,
      containerId: factoryRawStock.containerId,
      receivedKg: factoryRawStock.receivedKg,
      usedKg: factoryRawStock.usedKg,
      costPerKg: factoryRawStock.costPerKg,
      costPerKgUsd: factoryRawStock.costPerKgUsd,
      offloadedAt: factoryRawStock.offloadedAt,
    })
    .from(factoryRawStock)
    .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
    .where(
      and(
        eq(factoryRawStock.companyId, companyId),
        eq(factoryContainers.supplierId, supplierId),
        sql`${factoryContainers.status} != 'DELETED'`,
        isNull(factoryRawStock.deletedAt),
        isNull(factoryContainers.deletedAt)
      )
    )
    .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id);

  if (opts.forUpdate) query = query.for("update");

  const rawRows = await query;

  let weightedCostSum = 0;
  let totalReceivedKg = 0;
  const rows: StableSupplierRawStockRow[] = [];

  for (const r of rawRows) {
    const receivedKg = parseFloat(r.receivedKg as string) || 0;
    const usedKg = parseFloat(r.usedKg as string) || 0;
    // Fall back to costPerKg only for legacy rows that predate the USD column.
    const costPerKgUsd = parseFloat(r.costPerKgUsd as string) || parseFloat(r.costPerKg as string) || 0;

    weightedCostSum += receivedKg * costPerKgUsd;
    totalReceivedKg += receivedKg;
    rows.push({
      id: r.id,
      containerId: r.containerId,
      receivedKg,
      usedKg,
      costPerKgUsd,
      offloadedAt: r.offloadedAt,
    });
  }

  const costPerKgUsd = totalReceivedKg > 0 ? weightedCostSum / totalReceivedKg : 0;

  return { costPerKgUsd, totalReceivedKg, rows };
}
