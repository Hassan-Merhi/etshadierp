/**
 * server/services/pos/buildSaleItems.ts
 *
 * PHASE 19 structural split — moved (unchanged) from server/routes/pos/posSalesRoutes.ts:
 *   - basic per-item field validation
 *   - grand total calculation
 *   - inventory availability pre-check (best-effort; authoritative check is inside the tx)
 */
import { db } from "../../db";
import { inventory, stockItems } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { HandlerErrorResult, ValidatedInventoryItem } from "./posSaleTypes";

/** Input validation assertions for inventory safety. */
export function validateItemsBasic(locationId: any, items: any[]): { error: HandlerErrorResult } | null {
  const parsedLocationId = Number(locationId);
  if (!locationId || isNaN(parsedLocationId)) {
    return { error: { status: 400, body: { message: `Invalid locationId: ${locationId}` } } };
  }
  for (const item of items) {
    if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
      return { error: { status: 400, body: { message: `Invalid stockItemId: ${item.stockItemId}` } } };
    }
    const qty = parseFloat(item.quantity);
    if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
      return {
        error: { status: 400, body: { message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` } },
      };
    }
  }
  return null;
}

/** Validate and calculate total. */
export function calculateGrandTotal(items: any[]): { grandTotal: number } | { error: HandlerErrorResult } {
  let grandTotal = 0;
  for (const item of items) {
    if (!item.stockItemId) {
      return { error: { status: 400, body: { message: "Stock item ID is required for all items" } } };
    }
    if (!item.quantity || parseFloat(item.quantity) <= 0) {
      return { error: { status: 400, body: { message: "Quantity must be positive for all items" } } };
    }
    if (!item.rate || parseFloat(item.rate) < 0) {
      return { error: { status: 400, body: { message: "Rate must be non-negative for all items" } } };
    }
    grandTotal += parseFloat(item.quantity) * parseFloat(item.rate);
  }
  return { grandTotal };
}

/**
 * STEP 1a: Validate inventory rows (best-effort pre-check; authoritative check is inside
 * the transaction). Throws Error (same messages as before) on missing inventory / insufficient
 * stock so the route's outer catch block can map them to the correct status codes.
 */
export async function validateInventoryAvailability(
  locationId: any,
  items: any[],
  canSellNegativeStock: boolean
): Promise<ValidatedInventoryItem[]> {
  const inventoryValidation: ValidatedInventoryItem[] = [];

  for (const item of items) {
    const [inventoryRecord] = await db
      .select({
        id: inventory.id,
        locationId: inventory.locationId,
        stockItemId: inventory.stockItemId,
        quantity: inventory.quantity,
        averageRate: inventory.averageRate,
        itemName: stockItems.name,
      })
      .from(inventory)
      .leftJoin(stockItems, eq(stockItems.id, inventory.stockItemId))
      .where(and(eq(inventory.locationId, locationId), eq(inventory.stockItemId, item.stockItemId)));

    if (!inventoryRecord) {
      throw new Error(`Inventory not found for item ${item.stockItemId} at location ${locationId}`);
    }

    const currentQty = parseFloat(inventoryRecord.quantity);
    const saleQty = parseFloat(item.quantity);
    const itemDisplayName = inventoryRecord.itemName || `item ${item.stockItemId}`;

    if (currentQty < saleQty && !canSellNegativeStock) {
      throw new Error(`Not enough stock for "${itemDisplayName}". Available: ${currentQty}, requested: ${saleQty}.`);
    }

    inventoryValidation.push({
      item,
      inventoryRecord,
      currentQty,
      saleQty,
      newQty: currentQty - saleQty,
      currentRate: parseFloat(inventoryRecord.averageRate),
    });
  }

  // Sort by stockItemId so all concurrent transactions acquire inventory row locks
  // in the same order — prevents deadlocks when two cashiers sell the same items.
  inventoryValidation.sort((a, b) => a.item.stockItemId - b.item.stockItemId);

  return inventoryValidation;
}
