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
import {
  addInventoryValues,
  inventoryMoney,
  inventoryUnitCost,
  multiplyInventoryValues,
  subtractInventoryValues,
  toInventoryDecimal,
} from "../lib/inventoryMath";
import { inventory, salesItems, vouchers } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

export interface SyncSalesItemCostsResult {
  updatedCount: number;
  stockItemsProcessed: number;
}

export async function syncSalesItemCostsForStockItems(
  companyId: number,
  locationId: number,
  stockItemIds: number[]
): Promise<SyncSalesItemCostsResult> {
  if (stockItemIds.length === 0) return { updatedCount: 0, stockItemsProcessed: 0 };

  let updatedCount = 0;

  for (const stockItemId of stockItemIds) {
    let newCostPrice = toInventoryDecimal(0);

    const [invRecord] = await db
      .select({ averageRate: inventory.averageRate })
      .from(inventory)
      .where(and(eq(inventory.stockItemId, stockItemId), eq(inventory.locationId, locationId)))
      .limit(1);

    if (invRecord) {
      newCostPrice = toInventoryDecimal(invRecord.averageRate);
    }

    if (newCostPrice.isZero()) {
      const [anyInv] = await db
        .select({ averageRate: inventory.averageRate })
        .from(inventory)
        .where(eq(inventory.stockItemId, stockItemId))
        .limit(1);
      if (anyInv) newCostPrice = toInventoryDecimal(anyInv.averageRate);
    }

    if (newCostPrice.isZero()) continue;

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
      const oldCostPrice = toInventoryDecimal(item.oldCostPrice);
      if (newCostPrice.minus(oldCostPrice).abs().lessThanOrEqualTo("0.001")) continue;

      const totalCost = multiplyInventoryValues(item.quantity, newCostPrice);
      const salesValue = multiplyInventoryValues(item.quantity, item.sellingPrice);
      const profit = subtractInventoryValues(salesValue, totalCost);

      await db
        .update(salesItems)
        .set({
          costPrice: inventoryUnitCost(newCostPrice),
          totalCost: inventoryMoney(totalCost),
          profit: inventoryMoney(profit),
        })
        .where(eq(salesItems.id, item.salesItemId));

      updatedCount++;
    }
  }

  return { updatedCount, stockItemsProcessed: stockItemIds.length };
}

export async function applyInventoryRateDeltaAndSync(
  companyId: number,
  locationId: number,
  stockItemIds: number[],
  delta: number
): Promise<SyncSalesItemCostsResult> {
  if (stockItemIds.length === 0) return { updatedCount: 0, stockItemsProcessed: 0 };

  const rateDelta = toInventoryDecimal(delta);
  if (rateDelta.abs().greaterThan("0.001")) {
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

      const candidateRate = addInventoryValues(invRecord.averageRate, rateDelta);
      const newRate = candidateRate.isNegative() ? toInventoryDecimal(0) : candidateRate;
      const newTotalValue = multiplyInventoryValues(invRecord.quantity, newRate);

      await db
        .update(inventory)
        .set({
          averageRate: inventoryUnitCost(newRate),
          totalValue: inventoryMoney(newTotalValue),
          lastUpdated: new Date(),
        })
        .where(eq(inventory.id, invRecord.id));
    }
  }

  return syncSalesItemCostsForStockItems(companyId, locationId, stockItemIds);
}
