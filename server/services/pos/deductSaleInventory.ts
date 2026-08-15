/**
 * server/services/pos/deductSaleInventory.ts
 *
 * Authoritative in-transaction stock check, row lock, and inventory deduction
 * for one POS sale item.
 */
import { sql } from "drizzle-orm";
import { adjustInventory } from "../../inventoryHelper";
import { toInventoryDecimal } from "../../lib/inventoryMath";
import type { ValidatedInventoryItem } from "./posSaleTypes";

export interface LockedInventoryResult {
  lockedQty: number;
  costPrice: number;
}

export async function lockAndDeductInventoryForSaleItem(
  tx: any,
  parsedLocationId: number,
  locationId: any,
  validatedItem: ValidatedInventoryItem,
  canSellNegativeStock: boolean,
  companyId: number
): Promise<LockedInventoryResult> {
  const { item, currentRate, inventoryRecord, saleQty } = validatedItem;

  const stockLockResult = await tx.execute(sql`
    SELECT i.quantity, i.average_rate, si.name AS item_name
    FROM inventory i
    LEFT JOIN stock_items si ON si.id = i.stock_item_id
    WHERE i.location_id = ${parsedLocationId} AND i.stock_item_id = ${item.stockItemId}
    FOR UPDATE OF i
  `);
  const lockedRow = stockLockResult.rows?.[0] ?? stockLockResult[0];
  const lockedQuantity = toInventoryDecimal(lockedRow?.quantity);
  const requestedQuantity = toInventoryDecimal(saleQty);

  if (lockedQuantity.lessThan(requestedQuantity) && !canSellNegativeStock) {
    throw new Error(
      `Not enough stock for "${lockedRow?.item_name || inventoryRecord?.itemName || item.stockItemId}". Available: ${lockedQuantity.toString()}, requested: ${requestedQuantity.toString()}.`
    );
  }

  await adjustInventory(tx, locationId, item.stockItemId, requestedQuantity.negated().toNumber(), companyId);

  const costPrice = toInventoryDecimal(lockedRow?.average_rate ?? currentRate);
  return {
    lockedQty: lockedQuantity.toNumber(),
    costPrice: costPrice.toNumber(),
  };
}
