import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { inventory, spStockMovements, stockItems } from "@shared/schema";
import type { db } from "../../db";
import { releaseDebtEnglish } from "../../i18n/finalCloseoutEnglish";
import { resultRows } from "../../lib/queryResult";
import {
  GOLDEN_COAST_POST_CUTOVER_FIFO_SOURCES,
  GOLDEN_COAST_CURRENT_INVENTORY_FIFO_SOURCE,
  type GoldenCoastFifoLot,
} from "../../services/accounting/goldenCoastPhase5PosSale";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | DatabaseTransaction;

export type { DatabaseTransaction, DbLike };

/** Route-level failure carrying the HTTP status and stable error code the POS client reads. */
export class GoldenCoastPhase6RouteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "GC_PHASE6_SALE_INVALID", status = 400) {
    super(releaseDebtEnglish(message));
    this.name = "GoldenCoastPhase6RouteError";
    this.code = code;
    this.status = status;
  }
}

export async function countGoldenCoastFifoLots(conn: DbLike, companyId: number): Promise<number> {
  const rows = await conn.execute(sql`
    SELECT COUNT(*)::int AS lot_count
    FROM sp_stock_movements
    WHERE company_id = ${companyId}
      AND source_type IN (${sql.join(
        GOLDEN_COAST_POST_CUTOVER_FIFO_SOURCES.map((source) => sql`${source}`),
        sql`, `
      )})
  `);
  return Number(resultRows(rows)[0]?.lot_count ?? 0);
}

export async function ensureCurrentInventoryLots(
  tx: DatabaseTransaction,
  companyId: number,
  locationId: number,
  stockItemIds: readonly number[],
  existingLots: readonly GoldenCoastFifoLot[]
): Promise<void> {
  const covered = new Set(existingLots.map((lot) => Number(lot.stockItemId)).filter((id) => Number.isInteger(id)));
  const missing = stockItemIds.filter((stockItemId) => !covered.has(stockItemId));
  if (missing.length === 0) return;

  const rows = await tx
    .select({
      inventoryId: inventory.id,
      stockItemId: inventory.stockItemId,
      quantity: inventory.quantity,
      averageRate: inventory.averageRate,
      articleCode: stockItems.code,
      description: stockItems.name,
    })
    .from(inventory)
    .innerJoin(stockItems, eq(stockItems.id, inventory.stockItemId))
    .where(
      and(
        eq(inventory.companyId, companyId),
        eq(inventory.locationId, locationId),
        inArray(inventory.stockItemId, missing),
        sql`CAST(${inventory.quantity} AS numeric) > 0`
      )
    )
    .for("update");

  for (const row of rows) {
    const quantity = new Decimal(String(row.quantity ?? "0"));
    const rate = new Decimal(String(row.averageRate ?? "0"));
    if (rate.lte(0)) {
      throw new GoldenCoastPhase6RouteError(
        `Stock item #${row.stockItemId} has positive inventory with no usable average rate`,
        "GC_PHASE5_FIFO_COST_INVALID",
        409
      );
    }
    const unitCost = rate.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
    await tx.insert(spStockMovements).values({
      companyId,
      sourceType: GOLDEN_COAST_CURRENT_INVENTORY_FIFO_SOURCE,
      articleCode: String(row.articleCode ?? ""),
      description: `Golden Coast current inventory cost lot from inventory #${row.inventoryId}`,
      stockItemId: Number(row.stockItemId),
      locationId,
      qtyIn: quantity.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      qtyRemaining: quantity.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      baseUnitCostUsd: unitCost,
      landedUnitCostUsd: unitCost,
      finalUnitCostUsd: unitCost,
    });
  }
}

export async function lockFifoLots(
  tx: DatabaseTransaction,
  companyId: number,
  locationId: number,
  stockItemIds: readonly number[]
): Promise<GoldenCoastFifoLot[]> {
  const rows = await tx
    .select({
      id: spStockMovements.id,
      companyId: spStockMovements.companyId,
      locationId: spStockMovements.locationId,
      stockItemId: spStockMovements.stockItemId,
      articleCode: spStockMovements.articleCode,
      description: spStockMovements.description,
      sourceType: spStockMovements.sourceType,
      qtyRemaining: spStockMovements.qtyRemaining,
      finalUnitCostUsd: spStockMovements.finalUnitCostUsd,
      createdAt: spStockMovements.createdAt,
    })
    .from(spStockMovements)
    .where(
      and(
        eq(spStockMovements.companyId, companyId),
        eq(spStockMovements.locationId, locationId),
        inArray(spStockMovements.stockItemId, [...stockItemIds]),
        inArray(spStockMovements.sourceType, [...GOLDEN_COAST_POST_CUTOVER_FIFO_SOURCES]),
        sql`CAST(${spStockMovements.qtyRemaining} AS numeric) > 0`
      )
    )
    .orderBy(asc(spStockMovements.createdAt), asc(spStockMovements.id))
    .for("update");

  return rows.map((row) => ({
    id: Number(row.id),
    companyId: Number(row.companyId),
    locationId: row.locationId == null ? null : Number(row.locationId),
    stockItemId: row.stockItemId == null ? null : Number(row.stockItemId),
    articleCode: String(row.articleCode ?? ""),
    description: row.description == null ? null : String(row.description),
    sourceType: row.sourceType == null ? null : String(row.sourceType),
    qtyRemaining: String(row.qtyRemaining ?? "0"),
    finalUnitCostUsd: String(row.finalUnitCostUsd ?? "0"),
    createdAt: row.createdAt == null ? null : new Date(row.createdAt).toISOString(),
  }));
}

export async function consumeFifoLot(
  tx: DatabaseTransaction,
  companyId: number,
  allocation: { lotId: number; qty: string; qtyRemainingAfter: string }
): Promise<void> {
  const updated = await tx.execute(sql`
    UPDATE sp_stock_movements
    SET qty_remaining = ${allocation.qtyRemainingAfter}
    WHERE id = ${allocation.lotId}
      AND company_id = ${companyId}
      AND CAST(qty_remaining AS numeric) >= CAST(${allocation.qty} AS numeric)
    RETURNING id
  `);
  if (resultRows(updated).length !== 1) {
    throw new GoldenCoastPhase6RouteError(
      `Golden Coast FIFO lot #${allocation.lotId} changed while the sale was being posted`,
      "GC_PHASE6_FIFO_CONFLICT",
      409
    );
  }
}
