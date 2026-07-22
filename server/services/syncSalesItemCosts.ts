/**
 * syncSalesItemCosts.ts
 *
 * After a container offload or charge edit, the inventory.averageRate for the
 * affected stock items is updated. This helper propagates that updated rate
 * into the historical sales_items.costPrice / totalCost / profit rows so the
 * Sales Report always reflects the correct landed cost.
 *
 * Design notes
 * ─────────────
 * • Uses the current inventory.averageRate, which is the post-offload weighted
 *   moving average. This is the same value the recalculate-costs UI endpoint
 *   (`POST /api/sales-report/recalculate-costs`) uses.
 * • Only updates rows where the cost actually changed (> 0.001 difference)
 *   to avoid unnecessary DB writes.
 * • Non-fatal by design — callers should fire-and-forget and log errors.
 */

import { db } from "../db";
import { inventory, salesItems, vouchers } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export interface SyncSalesItemCostsResult {
  updatedCount: number;
  stockItemsProcessed: number;
}

/**
 * Sync sales_items cost fields for the given stock items at the given location
 * by reading the current inventory.averageRate for each item.
 *
 * @param companyId  The ERP company whose sales_items to update
 * @param locationId The location where inventory lives (offload location)
 * @param stockItemIds  The stock items affected by the offload / charge edit
 */
export async function syncSalesItemCostsForStockItems(
  companyId: number,
  locationId: number,
  stockItemIds: number[]
): Promise<SyncSalesItemCostsResult> {
  if (stockItemIds.length === 0) return { updatedCount: 0, stockItemsProcessed: 0 };

  let updatedCount = 0;

  for (const stockItemId of stockItemIds) {
    // Read the updated averageRate from inventory at the offload location.
    let newCostPrice = 0;

    const [invRecord] = await db
      .select({ averageRate: inventory.averageRate })
      .from(inventory)
      .where(and(eq(inventory.stockItemId, stockItemId), eq(inventory.locationId, locationId)))
      .limit(1);

    if (invRecord) {
      newCostPrice = parseFloat(invRecord.averageRate || "0");
    }

    // Fall back to any location if that specific location has no record yet
    // (e.g. first offload to a fresh location — inventory row was just created).
    if (newCostPrice === 0) {
      const [anyInv] = await db
        .select({ averageRate: inventory.averageRate })
        .from(inventory)
        .where(eq(inventory.stockItemId, stockItemId))
        .limit(1);
      if (anyInv) newCostPrice = parseFloat(anyInv.averageRate || "0");
    }

    if (newCostPrice === 0) continue;

    // Find all sales_items for this stock item sold from this location in this company.
    const itemsToUpdate = await db
      .select({
        salesItemId: salesItems.id,
        quantity: salesItems.quantity,
        sellingPrice: salesItems.sellingPrice,
        oldCostPrice: salesItems.costPrice,
      })
      .from(salesItems)
      .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          eq(vouchers.locationId, locationId),
          eq(salesItems.stockItemId, stockItemId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt)
        )
      );

    for (const item of itemsToUpdate) {
      const oldCostPrice = parseFloat(item.oldCostPrice || "0");
      // Skip rows where the cost hasn't meaningfully changed
      if (Math.abs(newCostPrice - oldCostPrice) <= 0.001) continue;

      const qty = parseFloat(item.quantity || "0");
      const sellingPrice = parseFloat(item.sellingPrice || "0");
      const totalCost = qty * newCostPrice;
      const profit = qty * sellingPrice - totalCost;

      await db
        .update(salesItems)
        .set({
          costPrice: newCostPrice.toFixed(2),
          totalCost: totalCost.toFixed(2),
          profit: profit.toFixed(2),
        })
        .where(eq(salesItems.id, item.salesItemId));

      updatedCount++;
    }
  }

  return { updatedCount, stockItemsProcessed: stockItemIds.length };
}

/**
 * Apply a per-unit cost delta to the inventory averageRate for a set of stock
 * items at a given location, then sync sales_items costs.
 *
 * Used by the PATCH /api/containers/:id/offload route when extra charges are
 * edited in-place on an already-offloaded container — in that path the
 * inventory averageRate is NOT automatically recomputed by the route, so we
 * compute the delta and apply it manually before syncing.
 *
 * @param companyId    The ERP company
 * @param locationId   The offload location
 * @param stockItemIds Stock items affected
 * @param delta        Change in cost per unit (newAdditionalCostPerBale − old)
 */
export async function applyInventoryRateDeltaAndSync(
  companyId: number,
  locationId: number,
  stockItemIds: number[],
  delta: number
): Promise<SyncSalesItemCostsResult> {
  if (stockItemIds.length === 0) return { updatedCount: 0, stockItemsProcessed: 0 };

  // Apply the delta to inventory.averageRate for each stock item.
  // We do this first so syncSalesItemCostsForStockItems picks up the updated rate.
  if (Math.abs(delta) > 0.001) {
    for (const stockItemId of stockItemIds) {
      const [invRecord] = await db
        .select({
          id: inventory.id,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .where(and(eq(inventory.stockItemId, stockItemId), eq(inventory.locationId, locationId)))
        .limit(1);

      if (!invRecord) continue;

      const currentRate = parseFloat(invRecord.averageRate || "0");
      const currentQty = parseFloat(invRecord.quantity || "0");
      const newRate = Math.max(0, currentRate + delta);
      const newTotalValue = currentQty * newRate;

      await db
        .update(inventory)
        .set({
          averageRate: newRate.toFixed(2),
          totalValue: newTotalValue.toFixed(2),
          lastUpdated: new Date(),
        })
        .where(eq(inventory.id, invRecord.id));
    }
  }

  // Now sync sales_items with the updated rates.
  return syncSalesItemCostsForStockItems(companyId, locationId, stockItemIds);
}
