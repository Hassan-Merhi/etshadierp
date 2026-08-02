import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";
import type { StockTransferItem, StockAdjustmentItem } from "@shared/schema";

export async function updateStockTransfer(
  id: number,
  destinationLocationId: number,
  notes: string,
  items: Array<{ sourceLocationId: number; stockItemId: number; quantity: string; rate: string }>
): Promise<any> {
  return await db.transaction(async (tx) => {
    const [existingTransfer] = await tx
      .select()
      .from(schema.stockTransferVouchers)
      .where(eq(schema.stockTransferVouchers.id, id));
    if (!existingTransfer) throw new Error(`Stock transfer ${id} not found`);

    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, existingTransfer.voucherId));
    if (!voucher) throw new Error(`Voucher ${existingTransfer.voucherId} not found`);
    const isOptional = voucher.optional;

    const existingItems = await tx
      .select()
      .from(schema.stockTransferItems)
      .where(eq(schema.stockTransferItems.transferId, id));
    const itemsWithoutSource = existingItems.filter((item) => !item.sourceLocationId);
    if (itemsWithoutSource.length > 0) {
      throw new Error(
        `Cannot edit this stock transfer: ${itemsWithoutSource.length} items missing source location data.`
      );
    }

    if (existingTransfer.inventoryApplied || !isOptional) {
      // Consistent lock order for reversal — prevents deadlocks with concurrent ops.
      existingItems.sort((a, b) => a.stockItemId - b.stockItemId);
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
          const newRate = newQty > 0 ? (currentQty * currentRate + quantity * rate) / newQty : 0;
          const newValue = newQty * newRate;
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, sourceInventory.id));
        } else {
          const srcLocId = sourceLocationId || 0;
          const [sourceLocation] = await tx.select().from(schema.locations).where(eq(schema.locations.id, srcLocId));
          if (sourceLocation) {
            await tx.insert(schema.inventory).values({
              companyId: sourceLocation.companyId,
              locationId: srcLocId,
              stockItemId: oldItem.stockItemId,
              quantity: quantity.toFixed(3),
              averageRate: rate.toFixed(2),
              totalValue: totalAmount.toFixed(2),
              lastUpdated: new Date(),
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
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: currentRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, destInventory.id));
        }
      }
    }

    if (!items || items.length === 0) throw new Error("No items provided for stock transfer update");

    await tx.delete(schema.stockTransferItems).where(eq(schema.stockTransferItems.transferId, id));

    const [updatedTransfer] = await tx
      .update(schema.stockTransferVouchers)
      .set({
        sourceLocationId: items[0].sourceLocationId,
        destinationLocationId,
        notes,
        inventoryApplied: !isOptional,
      })
      .where(eq(schema.stockTransferVouchers.id, id))
      .returning();

    // Consistent lock order for new items — prevents deadlocks with concurrent ops.
    const sortedNewTransferItems = [...items].sort((a, b) => a.stockItemId - b.stockItemId);
    const transferItems: StockTransferItem[] = [];
    for (const item of sortedNewTransferItems) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const totalAmount = quantity * rate;

      const [transferItem] = await tx
        .insert(schema.stockTransferItems)
        .values({
          transferId: updatedTransfer.id,
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();
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
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: currentRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, sourceInventory.id));
        } else {
          throw new Error(
            `Insufficient inventory at source location ${item.sourceLocationId} for stock item ${item.stockItemId}`
          );
        }

        const destInventoryRows2 = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows2.rows?.[0] || destInventoryRows2[0];
        if (destInventory) {
          const currentQty = parseFloat(destInventory.quantity);
          const currentRate = parseFloat(destInventory.average_rate || "0");
          const newQty = currentQty + quantity;
          const newRate = newQty > 0 ? (currentQty * currentRate + quantity * rate) / newQty : 0;
          const newValue = newQty * newRate;
          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, destInventory.id));
        } else {
          const [destLocation] = await tx
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, destinationLocationId));
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
    const [existingAdjustment] = await tx
      .select()
      .from(schema.stockAdjustmentVouchers)
      .where(eq(schema.stockAdjustmentVouchers.id, id));
    if (!existingAdjustment) throw new Error(`Stock adjustment ${id} not found`);

    const [voucher] = await tx
      .select()
      .from(schema.vouchers)
      .where(eq(schema.vouchers.id, existingAdjustment.voucherId));
    if (!voucher) throw new Error(`Voucher ${existingAdjustment.voucherId} not found`);
    const isOptional = voucher.optional;

    const existingItems = await tx
      .select()
      .from(schema.stockAdjustmentItems)
      .where(eq(schema.stockAdjustmentItems.adjustmentId, id));

    const [location] = await tx
      .select()
      .from(schema.locations)
      .where(eq(schema.locations.id, existingAdjustment.locationId));
    if (!location) throw new Error(`Location ${existingAdjustment.locationId} not found`);

    if (!isOptional) {
      // Consistent lock order for reversal — prevents deadlocks with concurrent ops.
      existingItems.sort((a, b) => a.stockItemId - b.stockItemId);
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
            newRate = newQty > 0 ? (currentQty * currentRate + Math.abs(quantity) * rate) / newQty : 0;
            newValue = newQty * newRate;
          }

          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, currentInventory.id));
        } else if (oldAdjustmentType === "Consumption" || (oldAdjustmentType === "Mixed" && quantity < 0)) {
          await tx.insert(schema.inventory).values({
            companyId: location.companyId,
            locationId: existingAdjustment.locationId,
            stockItemId: oldItem.stockItemId,
            quantity: Math.abs(quantity).toFixed(3),
            averageRate: rate.toFixed(2),
            totalValue: totalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
        }
      }
    }

    await tx.delete(schema.stockAdjustmentItems).where(eq(schema.stockAdjustmentItems.adjustmentId, id));

    if (!isOptional) {
      const productionAccount = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, "PRODUCTION_ADJUSTMENT"),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      const consumptionAccount = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, "CONSUMPTION_EXPENSE"),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      const accountIdsToDelete: number[] = [];
      if (productionAccount.length > 0) accountIdsToDelete.push(productionAccount[0].id);
      if (consumptionAccount.length > 0) accountIdsToDelete.push(consumptionAccount[0].id);
      if (accountIdsToDelete.length > 0) {
        await tx
          .delete(schema.voucherEntries)
          .where(
            and(
              eq(schema.voucherEntries.voucherId, existingAdjustment.voucherId),
              inArray(schema.voucherEntries.ledgerAccountId, accountIdsToDelete)
            )
          );
      }
    }

    const [updatedAdjustment] = await tx
      .update(schema.stockAdjustmentVouchers)
      .set({ locationId, adjustmentType, notes })
      .where(eq(schema.stockAdjustmentVouchers.id, id))
      .returning();

    const [newLocation] = await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId));
    if (!newLocation) throw new Error(`Location ${locationId} not found`);

    const findOrCreateAdjustmentAccount = async (
      code: string,
      name: string,
      accountType: string,
      openingBalanceSide: "Dr" | "Cr"
    ): Promise<number> => {
      let [account] = await tx
        .select()
        .from(schema.ledgerAccounts)
        .where(
          and(
            eq(schema.ledgerAccounts.companyId, newLocation.companyId),
            eq(schema.ledgerAccounts.code, code),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      if (!account) {
        [account] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: newLocation.companyId,
            code,
            name,
            accountType,
            subType: accountType,
            openingBalance: "0",
            openingBalanceSide,
          })
          .returning();
      }
      return account.id;
    };

    let productionAccountId: number | null = null;
    let consumptionAccountId: number | null = null;
    if (!isOptional) {
      const adjustmentAccountId = await findOrCreateAdjustmentAccount(
        "STOCK_ADJUSTMENT",
        "Stock Adjustment (Production/Consumption)",
        "Indirect Expense",
        "Dr"
      );
      productionAccountId = adjustmentAccountId;
      consumptionAccountId = adjustmentAccountId;
    }

    let totalProductionValue = 0;
    let totalConsumptionValue = 0;

    // Consistent lock order for new items — prevents deadlocks with concurrent ops.
    const sortedUpdAdjItems = [...items].sort((a, b) => a.stockItemId - b.stockItemId);
    const adjustmentItems: StockAdjustmentItem[] = [];
    for (const item of sortedUpdAdjItems) {
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
            newRate = newQty > 0 ? (currentQty * currentRate + Math.abs(quantity) * rate) / newQty : 0;
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

          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: newRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, currentInventory.id));
        } else if (isProduction) {
          await tx.insert(schema.inventory).values({
            companyId: newLocation.companyId,
            locationId,
            stockItemId: item.stockItemId,
            quantity: Math.abs(quantity).toFixed(3),
            averageRate: item.rate,
            totalValue: actualTotalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
          totalProductionValue += actualTotalAmount;
        } else {
          throw new Error(`Insufficient inventory at location ${locationId} for stock item ${item.stockItemId}.`);
        }
      }

      const [adjustmentItem] = await tx
        .insert(schema.stockAdjustmentItems)
        .values({
          adjustmentId: updatedAdjustment.id,
          stockItemId: item.stockItemId,
          quantity: item.quantity,
          rate: actualRate.toFixed(2),
          totalAmount: actualTotalAmount.toFixed(2),
        })
        .returning();
      adjustmentItems.push(adjustmentItem);
    }

    if (!isOptional) {
      if (totalProductionValue > 0 && productionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId: existingAdjustment.voucherId,
          ledgerAccountId: productionAccountId,
          debitAmount: "0",
          creditAmount: totalProductionValue.toFixed(2),
          narration: `Production adjustment - ${adjustmentType} voucher`,
        });
      }
      if (totalConsumptionValue > 0 && consumptionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId: existingAdjustment.voucherId,
          ledgerAccountId: consumptionAccountId,
          debitAmount: totalConsumptionValue.toFixed(2),
          creditAmount: "0",
          narration: `Consumption expense - ${adjustmentType} voucher`,
        });
      }
    }

    return { adjustment: updatedAdjustment, items: adjustmentItems };
  });
}

// ---------------------------------------------------------------------------
// Stock Query Methods (PO / Sales history)
// ---------------------------------------------------------------------------
