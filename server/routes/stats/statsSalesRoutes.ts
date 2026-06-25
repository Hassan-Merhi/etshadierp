import type { Express } from "express";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "../_helpers";
import { getClientDate } from "../../lib/dateUtils";
import {
  inventory,
  stockItems,
  stockGroups,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  bankAccounts,
  fixedAssets,
  ledgerAccounts,
  insertLedgerAccountSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertContainerSchema,
  insertStockTransferVoucherSchema,
  insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema,
  updateStockAdjustmentSchema,
  vouchers,
  voucherEntries,
  salesItems,
  suppliers,
  customers,
  customerBalances,
  employees,
  locations,
  userLocations,
  userCompanyRoles,
  companies,
  auditLog,
  users,
  FEATURE_KEYS,
  companySettings,
  purchaseOrders,
  poLineItems,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  insertContainerSaleSchema,
  containerSales,
  insertUserPreferencesSchema,
  userPreferences,
  insertDraftPosSaleSchema,
  InsertDraftPosSale,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  salaryAdvances,
  salaryAdvanceDeductions,
  fiscalPeriodClosures,
  wasteDispatches,
  wasteDispatchItems,
  dashboardCashAccounts,
  dashboardPayableAccounts,
  dashboardAccountSelections,
  insertDashboardCashAccountSchema,
  insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems,
  pendingBarcodes,
  insertPendingBarcodeSchema,
  bales,
  baleProducts,
  baleProductCategories,
  storedFiles,
  stockItemLocationPrices,
  exchangeRates,
  factoryWorkerAdvances,
  propertyContracts,
  propertyMonthlyLedger,
  propertyPayments,
} from "@shared/schema";
import {
  eq,
  and,
  or,
  desc,
  asc,
  lt,
  gt,
  ne,
  inArray,
  sql,
  isNull,
  isNotNull,
  not,
  gte,
  lte,
  like,
  ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance, round2 } from "../../netPositionHelper";

import { getProfitLoss, getBalanceSheet } from "../../services/reports/financialReportsService";

export function registerStatsSalesRoutes(app: Express) {
  app.post("/api/sales-report/recalculate-costs", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, stockItemId, locationId } = req.body;

      // Build conditions for finding sales items to update
      const conditions = [eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }
      if (stockItemId) {
        conditions.push(eq(salesItems.stockItemId, stockItemId));
      }
      if (locationId) {
        conditions.push(eq(vouchers.locationId, locationId));
      }

      // Get all sales items that match the criteria
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
        // Get current average rate from inventory at that location
        let newCostPrice = 0;

        if (item.locationId) {
          const [invRecord] = await db
            .select({
              averageRate: inventory.averageRate,
            })
            .from(inventory)
            .where(and(eq(inventory.stockItemId, item.stockItemId), eq(inventory.locationId, item.locationId)))
            .limit(1);

          if (invRecord) {
            newCostPrice = parseFloat(invRecord.averageRate || "0");
          }
        }

        // If no inventory at location, try to get from any location
        if (newCostPrice === 0) {
          const [anyInvRecord] = await db
            .select({
              averageRate: inventory.averageRate,
            })
            .from(inventory)
            .where(eq(inventory.stockItemId, item.stockItemId))
            .limit(1);

          if (anyInvRecord) {
            newCostPrice = parseFloat(anyInvRecord.averageRate || "0");
          }
        }

        const oldCostPrice = parseFloat(item.oldCostPrice || "0");

        // Only update if cost price is different
        if (Math.abs(newCostPrice - oldCostPrice) > 0.01) {
          const qty = parseFloat(item.quantity || "0");
          const sellingPrice = parseFloat(item.sellingPrice || "0");
          const totalSales = qty * sellingPrice;
          const totalCost = qty * newCostPrice;
          const profit = totalSales - totalCost;

          await db
            .update(salesItems)
            .set({
              costPrice: newCostPrice.toFixed(2),
              totalCost: totalCost.toFixed(2),
              profit: profit.toFixed(2),
            })
            .where(eq(salesItems.id, item.salesItemId));

          // Get item name for response
          const [stockItem] = await db
            .select({ name: stockItems.name })
            .from(stockItems)
            .where(eq(stockItems.id, item.stockItemId))
            .limit(1);

          updates.push({
            id: item.salesItemId,
            oldCost: oldCostPrice,
            newCost: newCostPrice,
            itemName: stockItem?.name || "Unknown",
          });

          updatedCount++;
        }
      }

      res.json({
        message: `Updated cost prices for ${updatedCount} sales items`,
        totalChecked: itemsToUpdate.length,
        updatedCount,
        updates: updates.slice(0, 50), // Limit response to first 50 updates
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Reports API Endpoints

  // Profit & Loss Report
  app.get("/api/reports/profit-loss", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;
      const result = await getProfitLoss(
        companyId,
        startDate as string | undefined,
        endDate as string | undefined
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Balance Sheet Report
  app.get("/api/reports/balance-sheet", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { asOfDate } = req.query;
      const result = await getBalanceSheet(companyId, asOfDate as string | undefined);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sales Report
}
