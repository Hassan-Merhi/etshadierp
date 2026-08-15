import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  addInventoryValues,
  inventoryMoney,
  inventoryQuantity,
  inventoryUnitCost,
  multiplyInventoryValues,
  subtractInventoryValues,
  toInventoryDecimal,
  weightedAverageInventoryCost,
} from "../../lib/inventoryMath";
import * as schema from "@shared/schema";
import type { StockTransferItem, StockAdjustmentItem } from "@shared/schema";

export async function createStockTransfer(
  voucherId: number,
  destinationLocationId: number,
  notes: string,
  items: Array<{ sourceLocationId: number; stockItemId: number; quantity: string; rate: string }>
): Promise<unknown> {
  return await db.transaction(async (tx) => {
    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
    if (!voucher) throw new Error(`Voucher ${voucherId} not found`);
    const isOptional = voucher.optional;

    if (!items || items.length === 0) throw new Error("No items provided for stock transfer");

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
      const quantity = toInventoryDecimal(item.quantity);
      const rate = toInventoryDecimal(item.rate);
      const totalAmount = multiplyInventoryValues(quantity, rate);

      const [transferItem] = await tx
        .insert(schema.stockTransferItems)
        .values({
          transferId: transfer.id,
          stockItemId: item.stockItemId,
          sourceLocationId: item.sourceLocationId,
          quantity: inventoryQuantity(quantity),
          rate: inventoryUnitCost(rate),
          totalAmount: inventoryMoney(totalAmount),
        })
        .returning();

      transferItems.push(transferItem);

      if (!isOptional) {
        const sourceInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${item.sourceLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const sourceInventory = sourceInventoryRows.rows?.[0] || sourceInventoryRows[0];

        if (sourceInventory) {
          const currentQty = toInventoryDecimal(sourceInventory.quantity);
          const currentRate = toInventoryDecimal(sourceInventory.average_rate);
          const newQty = subtractInventoryValues(currentQty, quantity);
          const newValue = newQty.isPositive() ? multiplyInventoryValues(newQty, currentRate) : toInventoryDecimal(0);

          await tx
            .update(schema.inventory)
            .set({
              quantity: inventoryQuantity(newQty),
              averageRate: inventoryUnitCost(currentRate),
              totalValue: inventoryMoney(newValue),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, sourceInventory.id));
        }

        const destInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${destinationLocationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const destInventory = destInventoryRows.rows?.[0] || destInventoryRows[0];

        if (destInventory) {
          const currentQty = toInventoryDecimal(destInventory.quantity);
          const currentRate = toInventoryDecimal(destInventory.average_rate);
          const newQty = addInventoryValues(currentQty, quantity);
          const newRate = weightedAverageInventoryCost(currentQty, currentRate, quantity, rate);
          const newValue = multiplyInventoryValues(newQty, newRate);

          await tx
            .update(schema.inventory)
            .set({
              quantity: inventoryQuantity(newQty),
              averageRate: inventoryUnitCost(newRate),
              totalValue: inventoryMoney(newValue),
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
            quantity: inventoryQuantity(quantity),
            averageRate: inventoryUnitCost(rate),
            totalValue: inventoryMoney(totalAmount),
            lastUpdated: new Date(),
          });
        }
      }
    }

    return { transfer, items: transferItems };
  });
}

export async function createStockAdjustment(
  voucherId: number,
  locationId: number,
  adjustmentType: "Production" | "Consumption" | "Mixed",
  notes: string,
  items: Array<{ stockItemId: number; quantity: string; rate: string }>,
  consumptionAccountOverride?: { code: string; name: string }
): Promise<unknown> {
  return await db.transaction(async (tx) => {
    const [voucher] = await tx.select().from(schema.vouchers).where(eq(schema.vouchers.id, voucherId));
    if (!voucher) throw new Error(`Voucher ${voucherId} not found`);
    const isOptional = voucher.optional;

    const [adjustment] = await tx
      .insert(schema.stockAdjustmentVouchers)
      .values({ voucherId, locationId, adjustmentType, notes })
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

    let totalProductionValue = toInventoryDecimal(0);
    let totalConsumptionValue = toInventoryDecimal(0);

    const sortedAdjItems = [...items].sort((a, b) => a.stockItemId - b.stockItemId);
    const adjustmentItems: StockAdjustmentItem[] = [];
    for (const item of sortedAdjItems) {
      const quantity = toInventoryDecimal(item.quantity);
      const absoluteQuantity = quantity.abs();
      const rate = toInventoryDecimal(item.rate);
      const isProduction = adjustmentType === "Production" || (adjustmentType === "Mixed" && quantity.isPositive());
      let actualRate = rate;
      let actualTotalAmount = multiplyInventoryValues(absoluteQuantity, rate);

      if (!isOptional) {
        const currentInventoryRows = await (tx as any).execute(
          sql`SELECT * FROM inventory WHERE location_id = ${locationId} AND stock_item_id = ${item.stockItemId} FOR UPDATE`
        );
        const currentInventory = currentInventoryRows.rows?.[0] || currentInventoryRows[0];

        if (currentInventory) {
          const currentQty = toInventoryDecimal(currentInventory.quantity);
          const currentRate = toInventoryDecimal(currentInventory.average_rate);
          let newQty;
          let newValue;
          let newRate;

          if (isProduction) {
            newQty = addInventoryValues(currentQty, absoluteQuantity);
            newRate = weightedAverageInventoryCost(currentQty, currentRate, absoluteQuantity, rate);
            newValue = multiplyInventoryValues(newQty, newRate);
            totalProductionValue = addInventoryValues(totalProductionValue, actualTotalAmount);
          } else {
            newQty = subtractInventoryValues(currentQty, absoluteQuantity);
            newValue = newQty.isPositive() ? multiplyInventoryValues(newQty, currentRate) : toInventoryDecimal(0);
            newRate = currentRate;
            actualRate = currentRate;
            actualTotalAmount = multiplyInventoryValues(absoluteQuantity, currentRate);
            totalConsumptionValue = addInventoryValues(totalConsumptionValue, actualTotalAmount);
          }

          await tx
            .update(schema.inventory)
            .set({
              quantity: inventoryQuantity(newQty),
              averageRate: inventoryUnitCost(newRate),
              totalValue: inventoryMoney(newValue),
              lastUpdated: new Date(),
            })
            .where(eq(schema.inventory.id, currentInventory.id));
        } else if (isProduction) {
          await tx.insert(schema.inventory).values({
            companyId: location.companyId,
            locationId,
            stockItemId: item.stockItemId,
            quantity: inventoryQuantity(absoluteQuantity),
            averageRate: inventoryUnitCost(rate),
            totalValue: inventoryMoney(actualTotalAmount),
            lastUpdated: new Date(),
          });
          totalProductionValue = addInventoryValues(totalProductionValue, actualTotalAmount);
        } else {
          const [stockItem] = await tx
            .select()
            .from(schema.stockItems)
            .where(eq(schema.stockItems.id, item.stockItemId));
          if (!stockItem) throw new Error(`Stock item ${item.stockItemId} not found.`);
          const fallbackRate = toInventoryDecimal(stockItem.openingRate);
          if (!fallbackRate.isPositive()) throw new Error(`Stock item "${stockItem.name}" has no opening rate set.`);
          actualRate = fallbackRate;
          actualTotalAmount = multiplyInventoryValues(absoluteQuantity, fallbackRate);
          totalConsumptionValue = addInventoryValues(totalConsumptionValue, actualTotalAmount);
          await tx.insert(schema.inventory).values({
            companyId: location.companyId,
            locationId,
            stockItemId: item.stockItemId,
            quantity: inventoryQuantity(absoluteQuantity.negated()),
            averageRate: inventoryUnitCost(fallbackRate),
            totalValue: inventoryMoney(actualTotalAmount.negated()),
            lastUpdated: new Date(),
          });
        }
      }

      const [adjustmentItem] = await tx
        .insert(schema.stockAdjustmentItems)
        .values({
          adjustmentId: adjustment.id,
          stockItemId: item.stockItemId,
          quantity: inventoryQuantity(quantity),
          rate: inventoryUnitCost(actualRate),
          totalAmount: inventoryMoney(actualTotalAmount),
        })
        .returning();
      adjustmentItems.push(adjustmentItem);
    }

    if (!isOptional) {
      if (totalProductionValue.isPositive() && productionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId,
          ledgerAccountId: productionAccountId,
          debitAmount: "0",
          creditAmount: inventoryMoney(totalProductionValue),
          narration: `Production adjustment - ${adjustmentType} voucher`,
        });
      }
      if (totalConsumptionValue.isPositive() && consumptionAccountId) {
        await tx.insert(schema.voucherEntries).values({
          voucherId,
          ledgerAccountId: consumptionAccountId,
          debitAmount: inventoryMoney(totalConsumptionValue),
          creditAmount: "0",
          narration: `Consumption expense - ${adjustmentType} voucher`,
        });
      }
    }

    return { adjustment, items: adjustmentItems };
  });
}
