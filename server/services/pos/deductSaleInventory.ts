/**
 * server/services/pos/deductSaleInventory.ts
 *
 * PHASE 19 structural split — moved (unchanged) from server/routes/pos/posSalesRoutes.ts:
 * authoritative in-transaction stock check + row lock + inventory deduction for one sale item.
 */
import { sql } from "drizzle-orm";
import { adjustInventory } from "../../inventoryHelper";
import type { ValidatedInventoryItem } from "./posSaleTypes";

export interface LockedInventoryResult {
  lockedQty: number;
  costPrice: number;
}

/**
 * Fix 3: Authoritative stock check inside the transaction with row lock.
 * Catches race conditions where two cashiers sell the last unit concurrently.
 * Use FOR UPDATE OF i (not the whole JOIN) because PostgreSQL rejects
 * FOR UPDATE on the nullable side of a LEFT JOIN.
 *
 * Throws Error (same messages as before) on insufficient stock.
 */
export async function lockAndDeductInventoryForSaleItem(
  tx: any,
  parsedLocationId: number,
  locationId: any,
  validatedItem: ValidatedInventoryItem,
  canSellNegativeStock: boolean,
  companyId: number
): Promise<LockedInventoryResult> {
  const { item, currentRate, inventoryRecord, saleQty } = validatedItem;

  const stockLockResult = await (tx as any).execute(sql`
    SELECT i.quantity, i.average_rate, si.name AS item_name
    FROM inventory i
    LEFT JOIN stock_items si ON si.id = i.stock_item_id
    WHERE i.location_id = ${parsedLocationId} AND i.stock_item_id = ${item.stockItemId}
    FOR UPDATE OF i
  `);
  const lockedRow = stockLockResult.rows?.[0] ?? stockLockResult[0];
  const lockedQty = lockedRow ? parseFloat(lockedRow.quantity ?? "0") : 0;
  if (lockedQty < saleQty && !canSellNegativeStock) {
    throw new Error(
      `Not enough stock for "${lockedRow?.item_name || inventoryRecord?.itemName || item.stockItemId}". Available: ${lockedQty}, requested: ${saleQty}.`
    );
  }

  await adjustInventory(tx, locationId, item.stockItemId, -saleQty, companyId);

  // Use the freshly-locked average_rate so two concurrent cashiers both
  // record the correct cost basis rather than a stale pre-read value.
  const costPrice = lockedRow ? parseFloat(lockedRow.average_rate ?? "0") : currentRate;

  return { lockedQty, costPrice };
}
