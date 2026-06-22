import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "@shared/schema";
import type { StockTransferItem, StockAdjustmentItem } from "@shared/schema";
import { getStockItemByCodeOrAlias } from "./inventory";

// ---------------------------------------------------------------------------
// Update Cost Prices by Barcode
// ---------------------------------------------------------------------------

export async function updateCostPricesByBarcode(
  locationId: number,
  companyId: number,
  updates: Array<{ barcode: string; costPrice: number }>
): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  for (const update of updates) {
    try {
      const stockItem = await getStockItemByCodeOrAlias(update.barcode, companyId);
      if (!stockItem) {
        errors.push(`Barcode not found: ${update.barcode}`);
        continue;
      }

      await db.transaction(async (tx) => {
        const inventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${stockItem.id} FOR UPDATE`
        );
        const inventory = inventoryRows.rows?.[0] || inventoryRows[0];

        if (inventory) {
          const newTotalValue = (parseFloat(inventory.quantity) * update.costPrice).toFixed(2);
          await tx
            .update(schema.inventory)
            .set({
              averageRate: update.costPrice.toFixed(2),
              totalValue: newTotalValue,
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, inventory.id));
          updated++;
        } else {
          errors.push(`Item not found in inventory for barcode: ${update.barcode}`);
        }
      });
    } catch (err: any) {
      errors.push(`Error processing ${update.barcode}: ${err.message}`);
    }
  }

  return { updated, errors };
}

// ---------------------------------------------------------------------------
// Update Stock Transfer / Adjustment Items (inline edits, no inventory side-effect)
// ---------------------------------------------------------------------------

export async function updateStockTransferItem(
  id: number,
  updates: Partial<{ stockItemId: number; quantity: string; rate: string }>
): Promise<StockTransferItem> {
  const [currentItem] = await db
    .select()
    .from(schema.stockTransferItems)
    .where(eq(schema.stockTransferItems.id, id));
  if (!currentItem) throw new Error("Stock transfer item not found");

  const updateData: any = {};
  if (updates.stockItemId !== undefined) updateData.stockItemId = updates.stockItemId;
  if (updates.quantity !== undefined) updateData.quantity = updates.quantity;
  if (updates.rate !== undefined) updateData.rate = updates.rate;

  const finalQuantity = updates.quantity !== undefined ? updates.quantity : currentItem.quantity;
  const finalRate = updates.rate !== undefined ? updates.rate : currentItem.rate;
  const qty = parseFloat(finalQuantity);
  const rate = parseFloat(finalRate);
  if (isNaN(qty) || isNaN(rate)) throw new Error("Invalid quantity or rate value");
  updateData.totalAmount = (qty * rate).toFixed(2);

  const [updated] = await db
    .update(schema.stockTransferItems)
    .set(updateData)
    .where(eq(schema.stockTransferItems.id, id))
    .returning();
  return updated;
}

export async function updateStockAdjustmentItem(
  id: number,
  updates: Partial<{ stockItemId: number; quantity: string; rate: string }>
): Promise<StockAdjustmentItem> {
  const [currentItem] = await db
    .select()
    .from(schema.stockAdjustmentItems)
    .where(eq(schema.stockAdjustmentItems.id, id));
  if (!currentItem) throw new Error("Stock adjustment item not found");

  const updateData: any = {};
  if (updates.stockItemId !== undefined) updateData.stockItemId = updates.stockItemId;
  if (updates.quantity !== undefined) updateData.quantity = updates.quantity;
  if (updates.rate !== undefined) updateData.rate = updates.rate;

  const finalQuantity = updates.quantity !== undefined ? updates.quantity : currentItem.quantity;
  const finalRate = updates.rate !== undefined ? updates.rate : currentItem.rate;
  const qty = parseFloat(finalQuantity);
  const rate = parseFloat(finalRate);
  if (isNaN(qty) || isNaN(rate)) throw new Error("Invalid quantity or rate value");
  updateData.totalAmount = (qty * rate).toFixed(2);

  const [updated] = await db
    .update(schema.stockAdjustmentItems)
    .set(updateData)
    .where(eq(schema.stockAdjustmentItems.id, id))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Create Stock Transfer
// ---------------------------------------------------------------------------

export async function createStockTransfer(
  voucherId: number,
  destinationLocationId: number,
  notes: string,
  items: Array<{ sourceLocationId: number; stockItemId: number; quantity: string; rate: string }>
): Promise<any> {
  return await db.transaction(async (tx) => {
    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
    if (!voucher) throw new Error(`Voucher ${voucherId} not found`);
    const isOptional = voucher.optional;

    if (!items || items.length === 0) throw new Error("No items provided for stock transfer");

    const [transfer] = await tx.insert(schema.stockTransferVouchers).values({
      voucherId,
      sourceLocationId: items[0].sourceLocationId,
      destinationLocationId,
      notes,
      inventoryApplied: !isOptional,
    }).returning();

    const transferItems: StockTransferItem[] = [];
    for (const item of items) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const totalAmount = quantity * rate;

      const [transferItem] = await tx.insert(schema.stockTransferItems).values({
        transferId: transfer.id,
        stockItemId: item.stockItemId,
        sourceLocationId: item.sourceLocationId,
        quantity: item.quantity,
        rate: item.rate,
        totalAmount: totalAmount.toFixed(2),
      }).returning();

      transferItems.push(transferItem);

      if (!isOptional) {
        const sourceInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${item.sourceLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const sourceInventory = sourceInventoryRows.rows?.[0] || sourceInventoryRows[0];

        if (sourceInventory) {
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentRate = parseFloat(sourceInventory.average_rate);
          const newQty = currentQty - quantity;
          const newValue = newQty > 0 ? newQty * currentRate : 0;

          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3),
            averageRate: currentRate.toFixed(2),
            totalValue: newValue.toFixed(2),
            lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, sourceInventory.id));
        }

        const destInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows.rows?.[0] || destInventoryRows[0];

        if (destInventory) {
          const currentQty = parseFloat(destInventory.quantity);
          const currentRate = parseFloat(destInventory.average_rate || "0");
          const newQty = currentQty + quantity;
          const newRate = newQty > 0 ? ((currentQty * currentRate) + (quantity * rate)) / newQty : 0;
          const newValue = newQty * newRate;

          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3),
            averageRate: newRate.toFixed(2),
            totalValue: newValue.toFixed(2),
            lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, destInventory.id));
        } else {
          const [destLocation] = await tx.select().from(schema.locations).where(eq(schema.locations.id, destinationLocationId));
          if (!destLocation) throw new Error(`Destination location ${destinationLocationId} not found`);

          await tx.insert(schema.inventory).values({
            companyId: destLocation.companyId,
            locationId: destinationLocationId,
            stockItemId: item.stockItemId,
            quantity: item.quantity,
            averageRate: item.rate,
            totalValue: totalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
        }
      }
    }

    return { transfer, items: transferItems };
  });
}

// ---------------------------------------------------------------------------
// Create Stock Adjustment
// ---------------------------------------------------------------------------

export async function createStockAdjustment(
  voucherId: number,
  locationId: number,
  adjustmentType: "Production" | "Consumption" | "Mixed",
  notes: string,
  items: Array<{ stockItemId: number; quantity: string; rate: string }>,
  consumptionAccountOverride?: { code: string; name: string }
): Promise<any> {
  return await db.transaction(async (tx) => {
    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
    if (!voucher) throw new Error(`Voucher ${voucherId} not found`);
    const isOptional = voucher.optional;

    const [adjustment] = await tx.insert(schema.stockAdjustmentVouchers).values({
      voucherId, locationId, adjustmentType, notes,
    }).returning();

    const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId));
    if (!location) throw new Error(`Location ${locationId} not found`);

    const findOrCreateAdjustmentAccount = async (code: string, name: string, accountType: string, openingBalanceSide: "Dr" | "Cr"): Promise<number> => {
      let [account] = await tx.select().from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, code), isNull(schema.ledgerAccounts.deletedAt)))
        .limit(1);
      if (!account) {
        [account] = await tx.insert(schema.ledgerAccounts).values({
          companyId: location.companyId, code, name, accountType, subType: accountType, openingBalance: "0", openingBalanceSide,
        }).returning();
      }
      return account.id;
    };

    let productionAccountId: number | null = null;
    let consumptionAccountId: number | null = null;

    if (!isOptional) {
      const adjustmentAccountId = await findOrCreateAdjustmentAccount(
        "STOCK_ADJUSTMENT", "Stock Adjustment (Production/Consumption)", "Indirect Expense", "Dr"
      );
      productionAccountId = adjustmentAccountId;
      consumptionAccountId = adjustmentAccountId;
    }

    let totalProductionValue = 0;
    let totalConsumptionValue = 0;

    const adjustmentItems: StockAdjustmentItem[] = [];
    for (const item of items) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const isProduction = adjustmentType === "Production" || (adjustmentType === "Mixed" && quantity > 0);
      let actualRate = rate;
      let actualTotalAmount = Math.abs(quantity) * rate;

      if (!isOptional) {
        const currentInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const currentInventory = currentInventoryRows.rows?.[0] || currentInventoryRows[0];

        if (currentInventory) {
          const currentQty = parseFloat(currentInventory.quantity);
          const currentValue = parseFloat(currentInventory.total_value);
          const currentRate = parseFloat(currentInventory.average_rate);
          let newQty: number, newValue: number, newRate: number, actualValueChange: number;

          if (isProduction) {
            newQty = currentQty + Math.abs(quantity);
            newRate = newQty > 0 ? ((currentQty * currentRate) + (Math.abs(quantity) * rate)) / newQty : 0;
            newValue = newQty * newRate;
            actualValueChange = Math.abs(quantity) * rate;
            totalProductionValue += actualValueChange;
          } else {
            newQty = currentQty - Math.abs(quantity);
            newValue = newQty > 0 ? newQty * currentRate : 0;
            newRate = currentRate;
            actualRate = currentRate;
            actualTotalAmount = Math.abs(quantity) * currentRate;
            actualValueChange = actualTotalAmount;
            totalConsumptionValue += actualValueChange;
          }

          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3),
            averageRate: newRate.toFixed(2),
            totalValue: newValue.toFixed(2),
            lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, currentInventory.id));
        } else if (isProduction) {
          await tx.insert(schema.inventory).values({
            companyId: location.companyId, locationId, stockItemId: item.stockItemId,
            quantity: Math.abs(quantity).toFixed(3), averageRate: item.rate, totalValue: actualTotalAmount.toFixed(2), lastUpdated: new Date(),
          });
          totalProductionValue += actualTotalAmount;
        } else {
          const [stockItem] = await tx.select().from(schema.stockItems).where(eq(schema.stockItems.id, item.stockItemId));
          if (!stockItem) throw new Error(`Stock item ${item.stockItemId} not found.`);
          const fallbackRate = parseFloat(stockItem.openingRate || "0");
          if (fallbackRate <= 0) throw new Error(`Stock item "${stockItem.name}" has no opening rate set.`);
          actualRate = fallbackRate;
          actualTotalAmount = Math.abs(quantity) * fallbackRate;
          totalConsumptionValue += actualTotalAmount;
          await tx.insert(schema.inventory).values({
            companyId: location.companyId, locationId, stockItemId: item.stockItemId,
            quantity: (-Math.abs(quantity)).toFixed(3), averageRate: fallbackRate.toFixed(2), totalValue: (-actualTotalAmount).toFixed(2), lastUpdated: new Date(),
          });
        }
      }

      const [adjustmentItem] = await tx.insert(schema.stockAdjustmentItems).values({
        adjustmentId: adjustment.id, stockItemId: item.stockItemId, quantity: item.quantity,
        rate: actualRate.toFixed(2), totalAmount: actualTotalAmount.toFixed(2),
      }).returning();
      adjustmentItems.push(adjustmentItem);
    }

    if (!isOptional) {
      if (totalProductionValue > 0 && productionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId, ledgerAccountId: productionAccountId, debitAmount: "0",
          creditAmount: totalProductionValue.toFixed(2), narration: `Production adjustment - ${adjustmentType} voucher`,
        });
      }
      if (totalConsumptionValue > 0 && consumptionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId, ledgerAccountId: consumptionAccountId, debitAmount: totalConsumptionValue.toFixed(2),
          creditAmount: "0", narration: `Consumption expense - ${adjustmentType} voucher`,
        });
      }
    }

    return { adjustment, items: adjustmentItems };
  });
}

// ---------------------------------------------------------------------------
// Get by Voucher ID
// ---------------------------------------------------------------------------

export async function getStockTransferByVoucherId(voucherId: number): Promise<any | null> {
  const [transfer] = await db.select().from(schema.stockTransferVouchers).where(eq(schema.stockTransferVouchers.voucherId, voucherId));
  if (!transfer) return null;
  const items = await db.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, transfer.id));
  return { ...transfer, items };
}

export async function getStockAdjustmentByVoucherId(voucherId: number): Promise<any | null> {
  const [adjustment] = await db.select().from(schema.stockAdjustmentVouchers).where(eq(schema.stockAdjustmentVouchers.voucherId, voucherId));
  if (!adjustment) return null;
  const items = await db.select().from(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.adjustmentId, adjustment.id));
  return { ...adjustment, items };
}

// ---------------------------------------------------------------------------
// Update Stock Transfer
// ---------------------------------------------------------------------------

export async function updateStockTransfer(
  id: number,
  destinationLocationId: number,
  notes: string,
  items: Array<{ sourceLocationId: number; stockItemId: number; quantity: string; rate: string }>
): Promise<any> {
  return await db.transaction(async (tx) => {
    const [existingTransfer] = await tx.select().from(schema.stockTransferVouchers).where(eq(schema.stockTransferVouchers.id, id));
    if (!existingTransfer) throw new Error(`Stock transfer ${id} not found`);

    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, existingTransfer.voucherId));
    if (!voucher) throw new Error(`Voucher ${existingTransfer.voucherId} not found`);
    const isOptional = voucher.optional;

    const existingItems = await tx.select().from(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, id));
    const itemsWithoutSource = existingItems.filter(item => !item.sourceLocationId);
    if (itemsWithoutSource.length > 0) {
      throw new Error(`Cannot edit this stock transfer: ${itemsWithoutSource.length} items missing source location data.`);
    }

    if (existingTransfer.inventoryApplied || !isOptional) {
      for (const oldItem of existingItems) {
        const quantity = parseFloat(oldItem.quantity);
        const rate = parseFloat(oldItem.rate);
        const totalAmount = quantity * rate;
        const sourceLocationId = oldItem.sourceLocationId || existingTransfer.sourceLocationId;

        const sourceInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${sourceLocationId} AND stock_item_id = ${oldItem.stockItemId} FOR UPDATE`
        );
        const sourceInventory = sourceInventoryRows.rows?.[0] || sourceInventoryRows[0];

        if (sourceInventory) {
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentRate = parseFloat(sourceInventory.average_rate || "0");
          const newQty = currentQty + quantity;
          const newRate = newQty > 0 ? ((currentQty * currentRate) + (quantity * rate)) / newQty : 0;
          const newValue = newQty * newRate;
          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3), averageRate: newRate.toFixed(2), totalValue: newValue.toFixed(2), lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, sourceInventory.id));
        } else {
          const srcLocId = sourceLocationId || 0;
          const [sourceLocation] = await tx.select().from(schema.locations).where(eq(schema.locations.id, srcLocId));
          if (sourceLocation) {
            await tx.insert(schema.inventory).values({
              companyId: sourceLocation.companyId, locationId: srcLocId, stockItemId: oldItem.stockItemId,
              quantity: quantity.toFixed(3), averageRate: rate.toFixed(2), totalValue: totalAmount.toFixed(2), lastUpdated: new Date(),
            });
          }
        }

        const destInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${existingTransfer.destinationLocationId} AND stock_item_id = ${oldItem.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows.rows?.[0] || destInventoryRows[0];
        if (destInventory) {
          const currentQty = parseFloat(destInventory.quantity);
          const currentRate = parseFloat(destInventory.average_rate);
          const newQty = currentQty - quantity;
          const newValue = newQty > 0 ? newQty * currentRate : 0;
          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3), averageRate: currentRate.toFixed(2), totalValue: newValue.toFixed(2), lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, destInventory.id));
        }
      }
    }

    if (!items || items.length === 0) throw new Error("No items provided for stock transfer update");

    await tx.delete(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, id));

    const [updatedTransfer] = await tx.update(schema.stockTransferVouchers).set({
      sourceLocationId: items[0].sourceLocationId,
      destinationLocationId,
      notes,
      inventoryApplied: !isOptional,
    }).where(eq(schema.stockTransferVouchers.id, id)).returning();

    const transferItems: StockTransferItem[] = [];
    for (const item of items) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const totalAmount = quantity * rate;

      const [transferItem] = await tx.insert(schema.stockTransferItems).values({
        transferId: updatedTransfer.id, stockItemId: item.stockItemId, sourceLocationId: item.sourceLocationId,
        quantity: item.quantity, rate: item.rate, totalAmount: totalAmount.toFixed(2),
      }).returning();
      transferItems.push(transferItem);

      if (!isOptional) {
        const sourceInventoryRows2 = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${item.sourceLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const sourceInventory = sourceInventoryRows2.rows?.[0] || sourceInventoryRows2[0];
        if (sourceInventory) {
          const currentQty = parseFloat(sourceInventory.quantity);
          const currentRate = parseFloat(sourceInventory.average_rate);
          const newQty = currentQty - quantity;
          const newValue = newQty > 0 ? newQty * currentRate : 0;
          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3), averageRate: currentRate.toFixed(2), totalValue: newValue.toFixed(2), lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, sourceInventory.id));
        } else {
          throw new Error(`Insufficient inventory at source location ${item.sourceLocationId} for stock item ${item.stockItemId}`);
        }

        const destInventoryRows2 = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows2.rows?.[0] || destInventoryRows2[0];
        if (destInventory) {
          const currentQty = parseFloat(destInventory.quantity);
          const currentRate = parseFloat(destInventory.average_rate || "0");
          const newQty = currentQty + quantity;
          const newRate = newQty > 0 ? ((currentQty * currentRate) + (quantity * rate)) / newQty : 0;
          const newValue = newQty * newRate;
          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3), averageRate: newRate.toFixed(2), totalValue: newValue.toFixed(2), lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, destInventory.id));
        } else {
          const [destLocation] = await tx.select().from(schema.locations).where(eq(schema.locations.id, destinationLocationId));
          if (!destLocation) throw new Error(`Destination location ${destinationLocationId} not found`);
          await tx.insert(schema.inventory).values({
            companyId: destLocation.companyId, locationId: destinationLocationId, stockItemId: item.stockItemId,
            quantity: item.quantity, averageRate: item.rate, totalValue: totalAmount.toFixed(2), lastUpdated: new Date(),
          });
        }
      }
    }

    return { transfer: updatedTransfer, items: transferItems };
  });
}

// ---------------------------------------------------------------------------
// Update Stock Adjustment
// ---------------------------------------------------------------------------

export async function updateStockAdjustment(
  id: number,
  locationId: number,
  adjustmentType: "Production" | "Consumption" | "Mixed",
  notes: string,
  items: Array<{ stockItemId: number; quantity: string; rate: string }>
): Promise<any> {
  return await db.transaction(async (tx) => {
    const [existingAdjustment] = await tx.select().from(schema.stockAdjustmentVouchers).where(eq(schema.stockAdjustmentVouchers.id, id));
    if (!existingAdjustment) throw new Error(`Stock adjustment ${id} not found`);

    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, existingAdjustment.voucherId));
    if (!voucher) throw new Error(`Voucher ${existingAdjustment.voucherId} not found`);
    const isOptional = voucher.optional;

    const existingItems = await tx.select().from(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.adjustmentId, id));

    const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, existingAdjustment.locationId));
    if (!location) throw new Error(`Location ${existingAdjustment.locationId} not found`);

    if (!isOptional) {
      for (const oldItem of existingItems) {
        const quantity = parseFloat(oldItem.quantity);
        const rate = parseFloat(oldItem.rate);
        const totalAmount = Math.abs(quantity) * rate;
        const oldAdjustmentType = existingAdjustment.adjustmentType;
        const wasProduction = oldAdjustmentType === "Production" || (oldAdjustmentType === "Mixed" && quantity > 0);

        const currentInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${existingAdjustment.locationId} AND stock_item_id = ${oldItem.stockItemId} FOR UPDATE`
        );
        const currentInventory = currentInventoryRows.rows?.[0] || currentInventoryRows[0];

        if (currentInventory) {
          const currentQty = parseFloat(currentInventory.quantity);
          const currentRate = parseFloat(currentInventory.average_rate || "0");
          let newQty: number, newValue: number, newRate: number;

          if (wasProduction) {
            newQty = currentQty - Math.abs(quantity);
            newValue = newQty > 0 ? newQty * currentRate : 0;
            newRate = currentRate;
          } else {
            newQty = currentQty + Math.abs(quantity);
            newRate = newQty > 0 ? ((currentQty * currentRate) + (Math.abs(quantity) * rate)) / newQty : 0;
            newValue = newQty * newRate;
          }

          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3), averageRate: newRate.toFixed(2), totalValue: newValue.toFixed(2), lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, currentInventory.id));
        } else if (oldAdjustmentType === "Consumption" || (oldAdjustmentType === "Mixed" && quantity < 0)) {
          await tx.insert(schema.inventory).values({
            companyId: location.companyId, locationId: existingAdjustment.locationId, stockItemId: oldItem.stockItemId,
            quantity: Math.abs(quantity).toFixed(3), averageRate: rate.toFixed(2), totalValue: totalAmount.toFixed(2), lastUpdated: new Date(),
          });
        }
      }
    }

    await tx.delete(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.adjustmentId, id));

    if (!isOptional) {
      const productionAccount = await tx.select().from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, "PRODUCTION_ADJUSTMENT"), isNull(schema.ledgerAccounts.deletedAt))).limit(1);
      const consumptionAccount = await tx.select().from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.companyId, location.companyId), eq(schema.ledgerAccounts.code, "CONSUMPTION_EXPENSE"), isNull(schema.ledgerAccounts.deletedAt))).limit(1);
      const accountIdsToDelete: number[] = [];
      if (productionAccount.length > 0) accountIdsToDelete.push(productionAccount[0].id);
      if (consumptionAccount.length > 0) accountIdsToDelete.push(consumptionAccount[0].id);
      if (accountIdsToDelete.length > 0) {
        await tx.delete(schema.voucherEntries).where(
          and(eq(schema.voucherEntries.voucherId, existingAdjustment.voucherId), inArray(schema.voucherEntries.ledgerAccountId, accountIdsToDelete))
        );
      }
    }

    const [updatedAdjustment] = await tx.update(schema.stockAdjustmentVouchers)
      .set({ locationId, adjustmentType, notes })
      .where(eq(schema.stockAdjustmentVouchers.id, id))
      .returning();

    const [newLocation] = await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId));
    if (!newLocation) throw new Error(`Location ${locationId} not found`);

    const findOrCreateAdjustmentAccount = async (code: string, name: string, accountType: string, openingBalanceSide: "Dr" | "Cr"): Promise<number> => {
      let [account] = await tx.select().from(schema.ledgerAccounts)
        .where(and(eq(schema.ledgerAccounts.companyId, newLocation.companyId), eq(schema.ledgerAccounts.code, code), isNull(schema.ledgerAccounts.deletedAt))).limit(1);
      if (!account) {
        [account] = await tx.insert(schema.ledgerAccounts).values({
          companyId: newLocation.companyId, code, name, accountType, subType: accountType, openingBalance: "0", openingBalanceSide,
        }).returning();
      }
      return account.id;
    };

    let productionAccountId: number | null = null;
    let consumptionAccountId: number | null = null;
    if (!isOptional) {
      const adjustmentAccountId = await findOrCreateAdjustmentAccount(
        "STOCK_ADJUSTMENT", "Stock Adjustment (Production/Consumption)", "Indirect Expense", "Dr"
      );
      productionAccountId = adjustmentAccountId;
      consumptionAccountId = adjustmentAccountId;
    }

    let totalProductionValue = 0;
    let totalConsumptionValue = 0;

    const adjustmentItems: StockAdjustmentItem[] = [];
    for (const item of items) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const isProduction = adjustmentType === "Production" || (adjustmentType === "Mixed" && quantity > 0);
      let actualRate = rate;
      let actualTotalAmount = Math.abs(quantity) * rate;

      if (!isOptional) {
        const currentInventoryRows2 = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const currentInventory = currentInventoryRows2.rows?.[0] || currentInventoryRows2[0];

        if (currentInventory) {
          const currentQty = parseFloat(currentInventory.quantity);
          const currentRate = parseFloat(currentInventory.average_rate || "0");
          let newQty: number, newValue: number, newRate: number, actualValueChange: number;

          if (isProduction) {
            newQty = currentQty + Math.abs(quantity);
            newRate = newQty > 0 ? ((currentQty * currentRate) + (Math.abs(quantity) * rate)) / newQty : 0;
            newValue = newQty * newRate;
            actualValueChange = Math.abs(quantity) * rate;
            totalProductionValue += actualValueChange;
          } else {
            newQty = currentQty - Math.abs(quantity);
            newValue = newQty > 0 ? newQty * currentRate : 0;
            newRate = currentRate;
            actualRate = currentRate;
            actualTotalAmount = Math.abs(quantity) * currentRate;
            actualValueChange = actualTotalAmount;
            totalConsumptionValue += actualValueChange;
          }

          await tx.update(schema.inventory).set({
            quantity: newQty.toFixed(3), averageRate: newRate.toFixed(2), totalValue: newValue.toFixed(2), lastUpdated: new Date(),
          }).where(eq(schema.inventory.id, currentInventory.id));
        } else if (isProduction) {
          await tx.insert(schema.inventory).values({
            companyId: newLocation.companyId, locationId, stockItemId: item.stockItemId,
            quantity: Math.abs(quantity).toFixed(3), averageRate: item.rate, totalValue: actualTotalAmount.toFixed(2), lastUpdated: new Date(),
          });
          totalProductionValue += actualTotalAmount;
        } else {
          throw new Error(`Insufficient inventory at location ${locationId} for stock item ${item.stockItemId}.`);
        }
      }

      const [adjustmentItem] = await tx.insert(schema.stockAdjustmentItems).values({
        adjustmentId: updatedAdjustment.id, stockItemId: item.stockItemId, quantity: item.quantity,
        rate: actualRate.toFixed(2), totalAmount: actualTotalAmount.toFixed(2),
      }).returning();
      adjustmentItems.push(adjustmentItem);
    }

    if (!isOptional) {
      if (totalProductionValue > 0 && productionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId: existingAdjustment.voucherId, ledgerAccountId: productionAccountId,
          debitAmount: "0", creditAmount: totalProductionValue.toFixed(2), narration: `Production adjustment - ${adjustmentType} voucher`,
        });
      }
      if (totalConsumptionValue > 0 && consumptionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId: existingAdjustment.voucherId, ledgerAccountId: consumptionAccountId,
          debitAmount: totalConsumptionValue.toFixed(2), creditAmount: "0", narration: `Consumption expense - ${adjustmentType} voucher`,
        });
      }
    }

    return { adjustment: updatedAdjustment, items: adjustmentItems };
  });
}

// ---------------------------------------------------------------------------
// Stock Query Methods (PO / Sales history)
// ---------------------------------------------------------------------------

export async function getLastPurchaseOrderForItem(stockItemId: number, companyId: number): Promise<any | null> {
  const result = await db.select({
    poNumber: schema.purchaseOrders.poNumber,
    poDate: schema.purchaseOrders.createdAt,
    supplierName: schema.suppliers.legalName,
    quantity: schema.poLineItems.quantity,
    rate: schema.poLineItems.rate,
    amount: schema.poLineItems.lineTotal,
  })
  .from(schema.poLineItems)
  .innerJoin(schema.purchaseOrders, eq(schema.poLineItems.poId, schema.purchaseOrders.id))
  .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
  .where(and(eq(schema.poLineItems.stockItemId, stockItemId), eq(schema.purchaseOrders.companyId, companyId)))
  .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`)
  .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getLastSaleForItem(stockItemId: number, companyId: number): Promise<any | null> {
  const result = await db.select({
    voucherNumber: schema.vouchers.voucherNumber,
    saleDate: schema.vouchers.voucherDate,
    locationName: schema.locations.name,
    quantity: schema.salesItems.quantity,
    sellingPrice: schema.salesItems.sellingPrice,
    totalSales: schema.salesItems.totalSales,
  })
  .from(schema.salesItems)
  .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
  .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
  .where(and(eq(schema.salesItems.stockItemId, stockItemId), eq(schema.vouchers.companyId, companyId)))
  .orderBy(sql`${schema.vouchers.voucherDate} DESC`)
  .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getLastSoldPrices(companyId: number): Promise<Record<number, string>> {
  const result = await db.execute(sql`
    WITH latest_sales AS (
      SELECT DISTINCT ON (si.stock_item_id)
        si.stock_item_id,
        si.selling_price
      FROM sales_items si
      INNER JOIN vouchers v ON si.voucher_id = v.id
      WHERE v.company_id = ${companyId}
      ORDER BY si.stock_item_id, v.voucher_date DESC, si.created_at DESC
    )
    SELECT stock_item_id, selling_price FROM latest_sales
  `);
  const priceMap: Record<number, string> = {};
  for (const row of result.rows as any[]) {
    priceMap[row.stock_item_id] = row.selling_price;
  }
  return priceMap;
}

export async function getAllPurchasesForItem(stockItemId: number, companyId: number, fromDate?: string, toDate?: string): Promise<any[]> {
  const conditions: any[] = [
    eq(schema.poLineItems.stockItemId, stockItemId),
    eq(schema.purchaseOrders.companyId, companyId),
    sql`(${schema.purchaseOrders.containerId} IS NULL OR ${schema.containers.status} NOT IN ('OFFLOADED', 'SOLD'))`,
  ];
  if (fromDate) conditions.push(sql`${schema.purchaseOrders.createdAt}::date >= ${fromDate}::date`);
  if (toDate) conditions.push(sql`${schema.purchaseOrders.createdAt}::date <= ${toDate}::date`);

  return await db.select({
    poNumber: schema.purchaseOrders.poNumber,
    poDate: schema.purchaseOrders.createdAt,
    supplierName: schema.suppliers.legalName,
    containerNumber: schema.containers.containerNumber,
    quantity: schema.poLineItems.quantity,
    rate: schema.poLineItems.rate,
    amount: schema.poLineItems.lineTotal,
  })
  .from(schema.poLineItems)
  .innerJoin(schema.purchaseOrders, eq(schema.poLineItems.poId, schema.purchaseOrders.id))
  .innerJoin(schema.suppliers, eq(schema.purchaseOrders.supplierId, schema.suppliers.id))
  .leftJoin(schema.containers, eq(schema.purchaseOrders.containerId, schema.containers.id))
  .where(and(...conditions))
  .orderBy(sql`${schema.purchaseOrders.createdAt} DESC`);
}

export async function getAllSalesForItem(stockItemId: number, companyId: number, fromDate?: string, toDate?: string): Promise<any[]> {
  const conditions: any[] = [
    eq(schema.salesItems.stockItemId, stockItemId),
    eq(schema.vouchers.companyId, companyId),
    eq(schema.vouchers.optional, false),
  ];
  if (fromDate) conditions.push(sql`${schema.vouchers.voucherDate}::date >= ${fromDate}::date`);
  if (toDate) conditions.push(sql`${schema.vouchers.voucherDate}::date <= ${toDate}::date`);

  return await db.select({
    voucherId: schema.vouchers.id,
    voucherNumber: schema.vouchers.voucherNumber,
    saleDate: schema.vouchers.voucherDate,
    locationName: schema.locations.name,
    quantity: schema.salesItems.quantity,
    sellingPrice: schema.salesItems.sellingPrice,
    totalSales: schema.salesItems.totalSales,
    posStation: schema.vouchers.shiftId,
  })
  .from(schema.salesItems)
  .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
  .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
  .where(and(...conditions))
  .orderBy(sql`${schema.vouchers.voucherDate} DESC`);
}

export async function getInventoryLocationsByItem(stockItemId: number, companyId: number): Promise<any[]> {
  const results = await db.execute(sql`
    SELECT DISTINCT ON (i.location_id)
      i.location_id as "locationId",
      l.name as "locationName",
      l.code as "locationCode",
      i.quantity,
      i.average_rate as "averageRate",
      i.total_value as "totalValue"
    FROM inventory i
    INNER JOIN locations l ON i.location_id = l.id
    WHERE i.stock_item_id = ${stockItemId}
      AND l.company_id = ${companyId}
      AND i.quantity::numeric > 0
    ORDER BY i.location_id, i.last_updated DESC
  `);
  return (results.rows as any[]).sort((a, b) => (a.locationName || '').localeCompare(b.locationName || ''));
}

export async function getVoucherHistoryForItem(stockItemId: number, companyId: number): Promise<any[]> {
  const sales = await db.select({
    voucherId: schema.vouchers.id,
    voucherNumber: schema.vouchers.voucherNumber,
    voucherType: schema.vouchers.voucherType,
    voucherDate: schema.vouchers.voucherDate,
    locationId: schema.vouchers.locationId,
    locationName: schema.locations.name,
    locationCode: schema.locations.code,
    quantityOut: schema.salesItems.quantity,
    quantityIn: sql<string>`'0'`,
    rate: schema.salesItems.sellingPrice,
    amount: schema.salesItems.totalSales,
  })
  .from(schema.salesItems)
  .innerJoin(schema.vouchers, eq(schema.salesItems.voucherId, schema.vouchers.id))
  .leftJoin(schema.locations, eq(schema.vouchers.locationId, schema.locations.id))
  .where(and(eq(schema.salesItems.stockItemId, stockItemId), eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)));

  const transfersOut = await db.select({
    voucherId: schema.vouchers.id,
    voucherNumber: schema.vouchers.voucherNumber,
    voucherType: schema.vouchers.voucherType,
    voucherDate: schema.vouchers.voucherDate,
    locationId: schema.stockTransferItems.sourceLocationId,
    locationName: schema.locations.name,
    locationCode: schema.locations.code,
    quantityOut: schema.stockTransferItems.quantity,
    quantityIn: sql<string>`'0'`,
    rate: schema.stockTransferItems.rate,
    amount: sql<string>`(${schema.stockTransferItems.quantity}::numeric * ${schema.stockTransferItems.rate}::numeric)::text`,
  })
  .from(schema.stockTransferItems)
  .innerJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
  .innerJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
  .leftJoin(schema.locations, eq(schema.stockTransferItems.sourceLocationId, schema.locations.id))
  .where(and(eq(schema.stockTransferItems.stockItemId, stockItemId), eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)));

  const transfersIn = await db.select({
    voucherId: schema.vouchers.id,
    voucherNumber: schema.vouchers.voucherNumber,
    voucherType: schema.vouchers.voucherType,
    voucherDate: schema.vouchers.voucherDate,
    locationId: schema.stockTransferVouchers.destinationLocationId,
    locationName: schema.locations.name,
    locationCode: schema.locations.code,
    quantityOut: sql<string>`'0'`,
    quantityIn: schema.stockTransferItems.quantity,
    rate: schema.stockTransferItems.rate,
    amount: sql<string>`(${schema.stockTransferItems.quantity}::numeric * ${schema.stockTransferItems.rate}::numeric)::text`,
  })
  .from(schema.stockTransferItems)
  .innerJoin(schema.stockTransferVouchers, eq(schema.stockTransferItems.transferId, schema.stockTransferVouchers.id))
  .innerJoin(schema.vouchers, eq(schema.stockTransferVouchers.voucherId, schema.vouchers.id))
  .leftJoin(schema.locations, eq(schema.stockTransferVouchers.destinationLocationId, schema.locations.id))
  .where(and(eq(schema.stockTransferItems.stockItemId, stockItemId), eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)));

  const adjustments = await db.select({
    voucherId: schema.vouchers.id,
    voucherNumber: schema.vouchers.voucherNumber,
    voucherType: schema.vouchers.voucherType,
    voucherDate: schema.vouchers.voucherDate,
    locationId: schema.stockAdjustmentVouchers.locationId,
    locationName: schema.locations.name,
    locationCode: schema.locations.code,
    quantityOut: sql<string>`CASE WHEN ${schema.stockAdjustmentItems.quantity}::numeric < 0 THEN ABS(${schema.stockAdjustmentItems.quantity}::numeric)::text ELSE '0' END`,
    quantityIn: sql<string>`CASE WHEN ${schema.stockAdjustmentItems.quantity}::numeric > 0 THEN ${schema.stockAdjustmentItems.quantity} ELSE '0' END`,
    rate: schema.stockAdjustmentItems.rate,
    amount: sql<string>`(${schema.stockAdjustmentItems.quantity}::numeric * ${schema.stockAdjustmentItems.rate}::numeric)::text`,
  })
  .from(schema.stockAdjustmentItems)
  .innerJoin(schema.stockAdjustmentVouchers, eq(schema.stockAdjustmentItems.adjustmentId, schema.stockAdjustmentVouchers.id))
  .innerJoin(schema.vouchers, eq(schema.stockAdjustmentVouchers.voucherId, schema.vouchers.id))
  .leftJoin(schema.locations, eq(schema.stockAdjustmentVouchers.locationId, schema.locations.id))
  .where(and(eq(schema.stockAdjustmentItems.stockItemId, stockItemId), eq(schema.vouchers.companyId, companyId), eq(schema.vouchers.optional, false)));

  const allTransactions = [...sales, ...transfersOut, ...transfersIn, ...adjustments];
  allTransactions.sort((a, b) => new Date(b.voucherDate).getTime() - new Date(a.voucherDate).getTime());
  return allTransactions;
}
