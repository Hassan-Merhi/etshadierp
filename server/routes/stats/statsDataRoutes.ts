import type { Express } from "express";
import { logger } from "../../lib/logger";
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

import { _getCached, _setCached } from "../../services/shared/ttlCache";
import { getMonthlyData, getStockSummary, getExpenseBreakdown } from "../../services/stats/dashboardStatsService";

export function registerStatsDataRoutes(app: Express) {
  app.get("/api/stats/monthly-data", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const result = await getMonthlyData(companyId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get stock summary stats for Dashboard
  app.get("/api/stats/stock-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const result = await getStockSummary(companyId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get expense breakdown by account type for Dashboard donut chart
  app.get("/api/stats/expense-breakdown", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const result = await getExpenseBreakdown(companyId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import Cycle Balance - tracks the full import/offload cycle to ensure it balances to zero
  // Formula: Supplier Balance (credit/liability) + Stock OTW (debit/asset) + Loan accounts + Expense charges - Stock Value on Floor
  app.get("/api/sales-report", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockItemId, stockGroupId } = req.query;

      // Apply filters
      const conditions = [eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }
      if (locationId) {
        conditions.push(eq(vouchers.locationId, parseInt(locationId as string)));
      }
      if (stockItemId) {
        conditions.push(eq(salesItems.stockItemId, parseInt(stockItemId as string)));
      }
      if (stockGroupId) {
        conditions.push(eq(stockItems.stockGroupId, parseInt(stockGroupId as string)));
      }

      const salesData = await db
        .select({
          id: salesItems.id,
          voucherId: salesItems.voucherId,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          locationId: vouchers.locationId,
          locationName: sql<string>`COALESCE(${locations.name}, ${vouchers.locationName})`.as("location_name"),
          stockItemId: salesItems.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          stockGroupId: stockItems.stockGroupId,
          quantity: salesItems.quantity,
          actualSellingPrice: salesItems.sellingPrice, // Price item was actually sold at
          configuredSellingPrice: stockItemLocationPrices.sellingPrice, // Location-specific price
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          costProfit: salesItems.profit, // Actual selling price - cost price
          isCreditSale: vouchers.isCreditSale,
          createdAt: salesItems.createdAt,
          customerName: sql<string | null>`(
            SELECT la.name
            FROM voucher_entries ve
            INNER JOIN ledger_accounts la ON ve.ledger_account_id = la.id
            WHERE ve.voucher_id = ${vouchers.id}
              AND cast(ve.debit_amount as numeric) > 0
              AND ve.ledger_account_id IS NOT NULL
            LIMIT 1
          )`.as("customer_name"),
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .leftJoin(
          stockItemLocationPrices,
          and(
            eq(stockItemLocationPrices.stockItemId, salesItems.stockItemId),
            eq(stockItemLocationPrices.locationId, vouchers.locationId)
          )
        )
        .where(and(...conditions))
        .orderBy(vouchers.voucherDate);

      // Calculate configured profit for each item (configured selling price - actual selling price) * quantity
      const enhancedSalesData = salesData.map((item) => {
        // Use location price if available, otherwise use actual selling price
        const configuredPrice =
          parseFloat(item.configuredSellingPrice || "0") > 0
            ? parseFloat(item.configuredSellingPrice || "0")
            : parseFloat(item.actualSellingPrice || "0");

        const actualPrice = parseFloat(item.actualSellingPrice || "0");
        const totalSales = parseFloat(item.totalSales || "0");
        const costProfit = parseFloat(item.costProfit || "0");
        const quantity = parseFloat(item.quantity || "0");

        const configuredProfit = (actualPrice - configuredPrice) * quantity;
        const totalConfiguredCost = configuredPrice * quantity;

        // Calculate percentages
        const costProfitPercentage = totalSales > 0 ? (costProfit / totalSales) * 100 : 0;
        const configuredProfitPercentage = totalConfiguredCost > 0 ? (configuredProfit / totalConfiguredCost) * 100 : 0;

        return {
          ...item,
          configuredSellingPrice: configuredPrice.toString(),
          configuredProfit,
          totalConfiguredCost,
          costProfitPercentage,
          configuredProfitPercentage,
        };
      });

      res.json(enhancedSalesData);
    } catch (error: any) {
      logger.error("Sales report error:", { error: error });
      res.status(500).json({ message: error.message, details: error.toString() });
    }
  });

  // Sales Report - All Companies (cross-company view like container tracking)
  app.get("/api/dashboard/sales-report-all", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get all companies the user has access to
      const userCompanyRoles = await storage.getUserCompaniesWithRoles(userId);
      const companyIds = userCompanyRoles.map((r) => r.companyId);

      if (companyIds.length === 0) {
        return res.json([]);
      }

      // Get all companies for names
      const allCompanies = await storage.getAllCompanies();
      const companyMap = new Map(allCompanies.map((c) => [c.id, c]));

      const { startDate, endDate, locationId, stockItemId, companyFilter, stockGroupName } = req.query;

      // Parse company filter if provided
      let filteredCompanyIds = companyIds;
      if (companyFilter && typeof companyFilter === "string" && companyFilter.length > 0) {
        const filterCodes = companyFilter.split(",");
        filteredCompanyIds = companyIds.filter((id) => {
          const company = companyMap.get(id);
          return company && filterCodes.includes(company.code);
        });
      }

      const allSalesData: any[] = [];

      for (const companyId of filteredCompanyIds) {
        const company = companyMap.get(companyId);

        // Apply filters
        const conditions = [
          eq(vouchers.companyId, companyId),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
        ];

        if (startDate) {
          conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
        }
        if (endDate) {
          conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
        }
        if (locationId) {
          conditions.push(eq(vouchers.locationId, parseInt(locationId as string)));
        }
        if (stockItemId) {
          conditions.push(eq(salesItems.stockItemId, parseInt(stockItemId as string)));
        }

        const salesData = await db
          .select({
            id: salesItems.id,
            voucherId: salesItems.voucherId,
            voucherNumber: vouchers.voucherNumber,
            voucherDate: vouchers.voucherDate,
            locationId: vouchers.locationId,
            locationName: sql<string>`COALESCE(${locations.name}, ${vouchers.locationName})`.as("location_name"),
            stockItemId: salesItems.stockItemId,
            stockItemCode: stockItems.code,
            stockItemName: stockItems.name,
            stockGroupId: stockItems.stockGroupId,
            stockGroupName: stockGroups.name,
            quantity: salesItems.quantity,
            actualSellingPrice: salesItems.sellingPrice,
            configuredSellingPrice: stockItemLocationPrices.sellingPrice,
            costPrice: salesItems.costPrice,
            totalSales: salesItems.totalSales,
            totalCost: salesItems.totalCost,
            costProfit: salesItems.profit,
            createdAt: salesItems.createdAt,
          })
          .from(salesItems)
          .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
          .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
          .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
          .leftJoin(locations, eq(vouchers.locationId, locations.id))
          .leftJoin(
            stockItemLocationPrices,
            and(
              eq(stockItemLocationPrices.stockItemId, salesItems.stockItemId),
              eq(stockItemLocationPrices.locationId, vouchers.locationId)
            )
          )
          .where(and(...conditions, ...(stockGroupName ? [eq(stockGroups.name, stockGroupName as string)] : [])))
          .orderBy(vouchers.voucherDate);

        // Enhance with computed values and company info
        for (const item of salesData) {
          const configuredPrice =
            parseFloat(item.configuredSellingPrice || "0") > 0
              ? parseFloat(item.configuredSellingPrice || "0")
              : parseFloat(item.actualSellingPrice || "0");

          const actualPrice = parseFloat(item.actualSellingPrice || "0");
          const totalSales = parseFloat(item.totalSales || "0");
          const costProfit = parseFloat(item.costProfit || "0");
          const quantity = parseFloat(item.quantity || "0");

          const configuredProfit = (actualPrice - configuredPrice) * quantity;
          const totalConfiguredCost = configuredPrice * quantity;

          const costProfitPercentage = totalSales > 0 ? (costProfit / totalSales) * 100 : 0;
          const configuredProfitPercentage =
            totalConfiguredCost > 0 ? (configuredProfit / totalConfiguredCost) * 100 : 0;

          allSalesData.push({
            ...item,
            companyId,
            companyCode: company?.code || "",
            companyName: company?.name || "Unknown",
            configuredSellingPrice: configuredPrice.toString(),
            configuredProfit,
            totalConfiguredCost,
            costProfitPercentage,
            configuredProfitPercentage,
          });
        }
      }

      res.json(allSalesData);
    } catch (error: any) {
      logger.error("All companies sales report error:", { error: error });
      res.status(500).json({ message: error.message, details: error.toString() });
    }
  });

  // Recalculate cost prices for sales items using current inventory rates
}
