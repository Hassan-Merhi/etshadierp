/**
 * Stable, receipt-weighted raw-material cost/kg for a supplier.
 *
 * This is the legacy fallback used only when a supplier has no persisted locked
 * rate. It is weighted by RECEIVED kg — never remaining kg — so FIFO consumption
 * cannot move the fallback calculation. Normal business reads use the persisted,
 * event-driven rate from rawStockLockedRate.ts.
 */
import { eq, and, isNull, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { factoryRawStock, factoryContainers } from "@shared/schema";
import { calculateWeightedAverageCost } from "./factoryCostingEngine";
import type { DatabaseOrTransaction } from "../../db";

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
  /** Raw stock rows for this supplier, oldest-first, for FIFO allocation only. */
  rows: StableSupplierRawStockRow[];
}

/**
 * Returns the receipt-weighted legacy fallback and the source rows required by
 * FIFO quantity allocation. The transaction handle should be used by mutations
 * so optional row locks remain inside the owning transaction.
 */
export async function getStableSupplierCost(
  tx: DatabaseOrTransaction,
  companyId: number,
  supplierId: number,
  opts: { forUpdate?: boolean } = {}
): Promise<StableSupplierCostResult> {
  const query = tx
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
  const rawRows = await (opts.forUpdate ? query.for("update") : query);
  const rows: StableSupplierRawStockRow[] = rawRows.map((row: any) => {
    const receivedKg = new Decimal(row.receivedKg || 0).toNumber();
    const rawUsdRate = new Decimal(row.costPerKgUsd || 0);
    const costPerKgUsd = rawUsdRate.gt(0) ? rawUsdRate.toNumber() : new Decimal(row.costPerKg || 0).toNumber();

    return {
      id: row.id,
      containerId: row.containerId,
      receivedKg,
      usedKg: new Decimal(row.usedKg || 0).toNumber(),
      costPerKgUsd,
      offloadedAt: row.offloadedAt,
    };
  });

  const aggregate = calculateWeightedAverageCost(
    rows.map((row) => ({
      quantityKg: row.receivedKg,
      unitCostPerKg: row.costPerKgUsd,
    }))
  );

  return {
    costPerKgUsd: aggregate.weightedUnitCostPerKg.toNumber(),
    totalReceivedKg: aggregate.totalQuantityKg.toNumber(),
    rows,
  };
}
