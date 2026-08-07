import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import {
  inventoryMoney,
  inventoryUnitCost,
  multiplyInventoryValues,
  subtractInventoryValues,
  toInventoryDecimal,
} from "../../lib/inventoryMath";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { inventory, stockItems, vouchers, salesItems } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

import { getProfitLoss, getBalanceSheet } from "../../services/reports/financialReportsService";

export function registerStatsSalesRoutes(app: Express) {
  app.post("/api/sales-report/recalculate-costs", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate, stockItemId, locationId } = req.body;
      const conditions = [eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)];
      if (startDate) conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      if (stockItemId) conditions.push(eq(salesItems.stockItemId, stockItemId));
      if (locationId) conditions.push(eq(vouchers.locationId, locationId));

      const itemsToUpdate = await db
        .select({
          salesItemId: salesItems.id,
          stockItemId: salesItems.stockItemId,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          oldCostPrice: salesItems.costPrice,
          locationId: vouchers.locationId,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...conditions));

      let updatedCount = 0;
      const updates: { id: number; oldCost: number; newCost: number; itemName: string }[] = [];

      for (const item of itemsToUpdate) {
        let newCostPrice = toInventoryDecimal(0);
        if (item.locationId) {
          const [inventoryRecord] = await db
            .select({ averageRate: inventory.averageRate })
            .from(inventory)
            .where(and(eq(inventory.stockItemId, item.stockItemId), eq(inventory.locationId, item.locationId)))
            .limit(1);
          if (inventoryRecord) newCostPrice = toInventoryDecimal(inventoryRecord.averageRate);
        }

        if (newCostPrice.isZero()) {
          const [fallbackInventoryRecord] = await db
            .select({ averageRate: inventory.averageRate })
            .from(inventory)
            .where(eq(inventory.stockItemId, item.stockItemId))
            .limit(1);
          if (fallbackInventoryRecord) newCostPrice = toInventoryDecimal(fallbackInventoryRecord.averageRate);
        }

        const oldCostPrice = toInventoryDecimal(item.oldCostPrice);
        if (newCostPrice.minus(oldCostPrice).abs().greaterThan("0.01")) {
          const quantity = toInventoryDecimal(item.quantity);
          const totalSales = multiplyInventoryValues(quantity, item.sellingPrice);
          const totalCost = multiplyInventoryValues(quantity, newCostPrice);
          const profit = subtractInventoryValues(totalSales, totalCost);

          await db
            .update(salesItems)
            .set({
              costPrice: inventoryUnitCost(newCostPrice),
              totalCost: inventoryMoney(totalCost),
              profit: inventoryMoney(profit),
            })
            .where(eq(salesItems.id, item.salesItemId));

          const [stockItem] = await db
            .select({ name: stockItems.name })
            .from(stockItems)
            .where(eq(stockItems.id, item.stockItemId))
            .limit(1);

          updates.push({
            id: item.salesItemId,
            oldCost: oldCostPrice.toNumber(),
            newCost: newCostPrice.toNumber(),
            itemName: stockItem?.name || "Unknown",
          });
          updatedCount++;
        }
      }

      res.json({
        message: `Updated cost prices for ${updatedCount} sales items`,
        totalChecked: itemsToUpdate.length,
        updatedCount,
        updates: updates.slice(0, 50),
      });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/reports/profit-loss", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate } = req.query;
      res.json(await getProfitLoss(companyId, startDate as string | undefined, endDate as string | undefined));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/reports/balance-sheet", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { asOfDate } = req.query;
      res.json(await getBalanceSheet(companyId, asOfDate as string | undefined));
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
