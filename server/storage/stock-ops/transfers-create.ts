import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import * as schema from "@shared/schema";
import type { StockTransferItem, StockAdjustmentItem } from "@shared/schema";

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

    // Sort by stockItemId so concurrent transfers always lock rows in the same
    // order — prevents deadlocks when two operations touch the same items.
    const sortedTransferItems = [...items].sort((a, b) => a.stockItemId - b.stockItemId);

    const [transfer] = await tx
      .insert(schema.stockTransferVouchers)
      .values({
        voucherId,
        sourceLocationId: items[0].sourceLocationId,
        destinationLocationId,
        notes,
        inventoryApplied: !isOptional,
      })
      .returning();

    const transferItems: StockTransferItem[] = [];
    for (const item of sortedTransferItems) {
      const quantity = parseFloat(item.quantity);
      const rate = parseFloat(item.rate);
      const totalAmount = quantity * rate;

      const [transferItem] = await tx
        .insert(schema.stockTransferItems)
        .values({
          transferId: transfer.id,
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: item.quantity,
          rate: item.rate,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

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

          await tx
            .update(schema.inventory)
            .set({
              quantity: newQty.toFixed(3),
              averageRate: currentRate.toFixed(2),
              totalValue: newValue.toFixed(2),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, sourceInventory.id));
        }

        const destInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows.rows?.[0] || destInventoryRows[0];

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

    const [adjustment] = await tx
      .insert(schema.stockAdjustmentVouchers)
      .values({
        voucherId,
        locationId,
        adjustmentType,
        notes,
      })
      .returning();

    const [location] = await tx.select().from(schema.locations).where(eq(schema.locations.id, locationId));
    if (!location) throw new Error(`Location ${locationId} not found`);

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
            eq(schema.ledgerAccounts.companyId, location.companyId),
            eq(schema.ledgerAccounts.code, code),
            isNull(schema.ledgerAccounts.deletedAt)
          )
        )
        .limit(1);
      if (!account) {
        [account] = await tx
          .insert(schema.ledgerAccounts)
          .values({
            companyId: location.companyId,
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

    // Sort by stockItemId — consistent lock order prevents deadlocks with concurrent ops.
    const sortedAdjItems = [...items].sort((a, b) => a.stockItemId - b.stockItemId);
    const adjustmentItems: StockAdjustmentItem[] = [];
    for (const item of sortedAdjItems) {
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
            companyId: location.companyId,
            locationId,
            stockItemId: item.stockItemId,
            quantity: Math.abs(quantity).toFixed(3),
            averageRate: item.rate,
            totalValue: actualTotalAmount.toFixed(2),
            lastUpdated: new Date(),
          });
          totalProductionValue += actualTotalAmount;
        } else {
          const [stockItem] = await tx
            .select()
            .from(schema.stockItems)
            .where(eq(schema.stockItems.id, item.stockItemId));
          if (!stockItem) throw new Error(`Stock item ${item.stockItemId} not found.`);
          const fallbackRate = parseFloat(stockItem.openingRate || "0");
          if (fallbackRate <= 0) throw new Error(`Stock item "${stockItem.name}" has no opening rate set.`);
          actualRate = fallbackRate;
          actualTotalAmount = Math.abs(quantity) * fallbackRate;
          totalConsumptionValue += actualTotalAmount;
          await tx.insert(schema.inventory).values({
            companyId: location.companyId,
            locationId,
            stockItemId: item.stockItemId,
            quantity: (-Math.abs(quantity)).toFixed(3),
            averageRate: fallbackRate.toFixed(2),
            totalValue: (-actualTotalAmount).toFixed(2),
            lastUpdated: new Date(),
          });
        }
      }

      const [adjustmentItem] = await tx
        .insert(schema.stockAdjustmentItems)
        .values({
          adjustmentId: adjustment.id,
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
          voucherId,
          ledgerAccountId: productionAccountId,
          debitAmount: "0",
          creditAmount: totalProductionValue.toFixed(2),
          narration: `Production adjustment - ${adjustmentType} voucher`,
        });
      }
      if (totalConsumptionValue > 0 && consumptionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId,
          ledgerAccountId: consumptionAccountId,
          debitAmount: totalConsumptionValue.toFixed(2),
          creditAmount: "0",
          narration: `Consumption expense - ${adjustmentType} voucher`,
        });
      }
    }

    return { adjustment, items: adjustmentItems };
  });
}

// ---------------------------------------------------------------------------
// Get by Voucher ID
// ---------------------------------------------------------------------------
