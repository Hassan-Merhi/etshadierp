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

// ---------------------------------------------------------------------------
// Lightweight in-process TTL cache for expensive computed stat endpoints.
// Keyed by endpoint + companyId + date params. 30-second TTL means a company
// with multiple users hitting the dashboard simultaneously gets one DB round-
// trip instead of N.  Mutations don't invalidate the cache — the 30-second
// staleness is acceptable for these summary/aggregate endpoints.
// ---------------------------------------------------------------------------
const _statCache = new Map<string, { data: any; expiresAt: number }>();
function _getCached(key: string): any | null {
  const e = _statCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _statCache.delete(key);
    return null;
  }
  return e.data;
}
function _setCached(key: string, data: any, ttlMs = 30_000): void {
  _statCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  // Prune stale entries to prevent unbounded growth (> 500 entries is unusual)
  if (_statCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _statCache) {
      if (v.expiresAt < now) _statCache.delete(k);
    }
  }
}

export function registerStatsDataRoutes(app: Express) {
  app.get("/api/stats/monthly-data", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all Sales vouchers for this company (excluding optional)
      const salesVouchers = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.voucherType, "Sales"),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        )
        .execute();

      // Get all Income and Expense ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations
      const incomeAccountIds = companyAccounts.filter((acc) => acc.accountType === "Income").map((acc) => acc.id);

      // Include ALL expenses in monthly profit calculation for consistency with P&L report
      // PURCHASES are now included (previously excluded) to match P&L calculation
      // Only exclude container-related import charges that are capitalized to inventory
      const excludedExpenseCodes = [
        "IMPORTCHARGES", // Old consolidated import charges (deprecated, capitalized)
        "IMPORT_CHARGES", // Alternative format
        "DUTIES", // Container import duties (capitalized)
        "DUT", // Abbreviated duties code
        "TRANSPORTCHARGES", // Container transport costs (capitalized)
        "TRANSPORT", // Alternative transport account name (capitalized)
        "TRA", // Abbreviated transport code
        "TRANSFER_CHARGES", // Transfer charges (capitalized)
        "CONTAINERLICENSES", // Container license fees (capitalized)
        "CONLIC", // Abbreviated container licenses
        "LICENSES", // Alternative license account name (capitalized)
        "LIC", // Abbreviated licenses code
      ];

      // Name patterns to exclude (container-related costs only)
      const excludedNamePatterns = [
        "duties",
        "transport charges",
        "container license",
        "import charge",
        "transfer charge",
      ];

      // Normalize function: uppercase + remove spaces/underscores for comparison
      const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s_-]/g, "");

      const expenseAccounts = companyAccounts.filter((acc) => {
        // Include Purchase accounts by code (for P&L consistency)
        const isPurchaseAccount = acc.code === "PURCHASES" || acc.code?.startsWith("PURCHASES-");
        if (isPurchaseAccount) return true;

        // Support both correct format (accountType="Expense") and legacy format
        // (accountType="Indirect Expense" or "Direct Expense")
        const isExpenseAccount =
          acc.accountType === "Expense" ||
          acc.accountType === "Indirect Expense" ||
          acc.accountType === "Direct Expense";

        if (!isExpenseAccount) return false;

        // Check if code matches exclusion list
        const normalizedCode = normalizeCode(acc.code);
        const codeExcluded = excludedExpenseCodes.some((excluded) => normalizeCode(excluded) === normalizedCode);

        // Check if name contains excluded patterns
        const nameLower = (acc.name || "").toLowerCase();
        const nameExcluded = excludedNamePatterns.some((pattern) => nameLower.includes(pattern));

        // Exclude if either code or name matches
        return !codeExcluded && !nameExcluded;
      });
      const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

      // Single JOIN query: fetch entries with their voucher dates — replaces two-step
      // (previously: fetch companyVouchers → extract IDs → inArray(voucherEntries))
      const companyEntriesRaw = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          voucherDate: vouchers.voucherDate,
          voucherId: voucherEntries.voucherId,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)))
        .execute();

      // Keep voucherDateMap for compatibility with code below that uses it
      const voucherDateMap = new Map(companyEntriesRaw.map((e) => [e.voucherId, e.voucherDate]));

      // companyEntriesRaw already fetched above via JOIN
      const companyEntries = companyEntriesRaw;

      // Group data by month (last 6 months)
      const monthlyData = new Map<string, { sales: number; profit: number }>();
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      // Initialize last 6 months
      const currentDate = new Date();
      for (let i = 5; i >= 0; i--) {
        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const monthKey = monthNames[date.getMonth()];
        monthlyData.set(monthKey, { sales: 0, profit: 0 });
      }

      // Calculate sales by month
      for (const voucher of salesVouchers) {
        const voucherDate = new Date(voucher.voucherDate);
        const monthKey = monthNames[voucherDate.getMonth()];
        const amount = parseFloat(voucher.totalAmount || "0");

        if (monthlyData.has(monthKey)) {
          const data = monthlyData.get(monthKey)!;
          data.sales += amount;
        }
      }

      // Calculate profit by month (income - expenses)
      for (const entry of companyEntries) {
        const voucherDate = voucherDateMap.get(entry.voucherId);
        if (!voucherDate) continue;

        const date = new Date(voucherDate);
        const monthKey = monthNames[date.getMonth()];

        if (!monthlyData.has(monthKey)) continue;

        const data = monthlyData.get(monthKey)!;

        // Income accounts: credits increase profit, debits decrease it
        if (entry.ledgerAccountId && incomeAccountIds.includes(entry.ledgerAccountId)) {
          data.profit += parseFloat(entry.creditAmount || "0") - parseFloat(entry.debitAmount || "0");
        }

        // Expense accounts (including Purchases): debits decrease profit, credits increase it
        if (entry.ledgerAccountId && expenseAccountIds.includes(entry.ledgerAccountId)) {
          data.profit -= parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        }
      }

      // Convert map to array
      const result = Array.from(monthlyData.entries()).map(([month, data]) => ({
        month,
        sales: data.sales,
        profit: data.profit,
      }));

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

      // Get total stock items count
      const stockItems = await storage.getAllStockItems(companyId);
      const totalStockItems = stockItems.length;

      // Get all inventory for the company
      const inventory = await storage.getCompanyInventory(companyId);

      // Calculate low stock items (quantity < 20)
      const lowStockThreshold = 20;
      const lowStockItems = inventory
        .filter((item) => parseFloat(item.quantity) < lowStockThreshold && parseFloat(item.quantity) > 0)
        .map((item) => ({
          name: item.stockItemName,
          stock: parseFloat(item.quantity),
          location: item.locationName || "Unknown",
        }))
        .sort((a, b) => a.stock - b.stock) // Sort by lowest stock first
        .slice(0, 10); // Limit to top 10 low stock items

      // Count critical items (quantity < 5)
      const criticalThreshold = 5;
      const criticalCount = inventory.filter(
        (item) => parseFloat(item.quantity) < criticalThreshold && parseFloat(item.quantity) > 0
      ).length;

      res.json({
        totalStockItems,
        lowStockCount: lowStockItems.length,
        criticalCount,
        lowStockItems,
      });
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

      // Get all expense-related ledger accounts
      const allAccounts = await storage.getAllLedgerAccounts(companyId);

      // Find accounts to EXCLUDE from expenses:
      // 1. IMPORT_CHARGES parent and children (import costs capitalized into inventory)
      // 2. PURCHASES accounts (inventory cost, not expense until sold as COGS)
      const importChargesParent = allAccounts.find((acc) => acc.code === "IMPORT_CHARGES");
      const excludedFromExpenses = new Set<number>();

      if (importChargesParent) {
        excludedFromExpenses.add(importChargesParent.id);
        // Also find all children of IMPORT_CHARGES
        for (const acc of allAccounts) {
          if (acc.parentId === importChargesParent.id) {
            excludedFromExpenses.add(acc.id);
          }
        }
      }

      // Exclude PURCHASES accounts - these are inventory costs, not expenses
      for (const acc of allAccounts) {
        if (acc.code === "PURCHASES" || acc.code?.startsWith("PURCHASES_")) {
          excludedFromExpenses.add(acc.id);
        }
      }

      const expenseAccounts = allAccounts.filter(
        (acc) =>
          (acc.accountType === "Expense" ||
            acc.accountType === "Direct Expense" ||
            acc.accountType === "Indirect Expense") &&
          !excludedFromExpenses.has(acc.id)
      );

      const expenseAccountIds = new Set(expenseAccounts.map((a) => a.id));
      const accountTypeMap = new Map<number, string>();
      for (const acc of expenseAccounts) {
        accountTypeMap.set(acc.id, acc.accountType);
      }

      const _ebCacheKey = `expense-breakdown:${companyId}`;
      const _ebCached = _getCached(_ebCacheKey);
      if (_ebCached) return res.json(_ebCached);

      if (expenseAccountIds.size === 0) {
        _setCached(_ebCacheKey, []);
        return res.json([]);
      }

      // Single JOIN — replaces the two-query IN-clause anti-pattern.
      // Directly filters entries to expense accounts for this company.
      const expenseEntries = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt),
            inArray(voucherEntries.ledgerAccountId as any, [...expenseAccountIds])
          )
        )
        .execute();

      // Sum balances by expense type
      const expenseByType = new Map<string, number>();

      for (const entry of expenseEntries) {
        if (!entry.ledgerAccountId) continue;
        const accountType = accountTypeMap.get(entry.ledgerAccountId);
        if (!accountType) continue;
        const amount = parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        if (amount <= 0) continue;
        expenseByType.set(accountType, (expenseByType.get(accountType) || 0) + amount);
      }

      // Convert to array format for chart
      const result = Array.from(expenseByType.entries())
        .filter(([_, value]) => value > 0)
        .map(([name, value]) => ({
          name: name.replace(" Expense", ""),
          value: Math.round(value * 100) / 100,
        }))
        .sort((a, b) => b.value - a.value);

      _setCached(_ebCacheKey, result);
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
      console.error("Sales report error:", error);
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
      console.error("All companies sales report error:", error);
      res.status(500).json({ message: error.message, details: error.toString() });
    }
  });

  // Recalculate cost prices for sales items using current inventory rates
}
