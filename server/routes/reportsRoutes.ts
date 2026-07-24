import type { Express } from "express";
import { logger } from "../lib/logger";
import { db, pool } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { registerDashboardAccountRoutes } from "./reportsDashboardAccountRoutes";
import { registerReportsNetProfitStatementRoutes } from "./reportsNetProfitStatementRoutes";
import { registerReportsClosingStockRoutes } from "./reportsClosingStockRoutes";
import { _npsCached, _npsSetCache } from "./reportsNetProfitCache";
import {
  upload,
  logAudit,
  getCurrentExchangeRate,
  calculateHistoricalLocationInventory,
  syncEmployeeBalancesFromEntries,
} from "./_helpers";
import {
  inventory,
  stockItems,
  stockGroups,
  stockItemCodeAliases,
  stockItemLocationPrices,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  containers,
  containerOffloads,
  containerOffloadItems,
  containerSales,
  containerCharges,
  containerTrackingImportRowSchema,
  updateContainerTrackingSchema,
  bankAccounts,
  fixedAssets,
  insertBankAccountSchema,
  insertFixedAssetSchema,
  insertStockGroupSchema,
  insertStockItemSchema,
  insertStockItemCodeAliasSchema,
  insertContainerSchema,
  offloadRequestSchema,
  purchaseOrders,
  poLineItems,
  insertContainerSaleSchema,
  vouchers,
  voucherEntries,
  posShifts,
  salesItems,
  insertVoucherSchema,
  insertVoucherEntrySchema,
  insertSalesItemSchema,
  suppliers,
  customers,
  customerBalances,
  locations,
  employees,
  userLocations,
  auditLog,
  interCompanyTransfers,
  insertInterCompanyTransferSchema,
  ledgerAccounts,
  insertLedgerAccountSchema,
  companies,
  users,
  userCompanyRoles,
  companySettings,
  FEATURE_KEYS,
  fiscalPeriodClosures,
  wasteDispatches,
  wasteDispatchItems,
  insertWasteDispatchSchema,
  bales,
  baleProducts,
  baleProductCategories,
  baleTransfers,
  insertBaleSchema,
  insertBaleTransferSchema,
  creditNoteItems,
  pendingBarcodes,
  insertPendingBarcodeSchema,
  storedFiles,
  spreadsheets,
  liveSpreadsheets,
  agentAccounts,
  insertAgentAccountSchema,
  salaryAdvances,
  salaryAdvanceDeductions,
  insertSalaryAdvanceSchema,
  insertSalaryAdvanceDeductionSchema,
  chatMessages,
  exchangeRates,
  factoryRawStock,
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
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";
import path from "path";
import fs from "fs";

export function registerReportsRoutes(app: Express) {
  app.get("/api/reports/net-profit-statement", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const sessionCompanyId = req.session.currentCompanyId;
      if (!sessionCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      const isAdminOrDev = req.user?.role === "Admin" || req.user?.role === "Developer";
      const requestedCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
      const companyId = isAdminOrDev && requestedCompanyId ? requestedCompanyId : sessionCompanyId;

      // Get date range filters (optional)
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;

      // 30-second TTL cache (keyed by companyId + date range)
      const npsCacheKey = `net-profit:${companyId}:${req.query.startDate || ""}:${req.query.endDate || ""}`;
      const npsCachedResult = _npsCached(npsCacheKey);
      if (npsCachedResult) return res.json(npsCachedResult);

      // Phase 1: metadata + accounts + stock items (all independent, run in parallel)
      const [companyRecord, companyAccounts, allStockItems] = await Promise.all([
        db
          .select({ companyType: companies.companyType })
          .from(companies)
          .where(eq(companies.id, companyId))
          .execute()
          .then((r) => r[0] ?? null),
        storage.getAllLedgerAccounts(companyId, true),
        storage.getAllStockItems(companyId),
      ]);
      const isFactoryCompany = companyRecord?.companyType === "factory";

      // Build voucher filter conditions
      const voucherConditions: any[] = [
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
      ];
      if (startDate) {
        voucherConditions.push(gte(vouchers.voucherDate, startDate.toISOString().split("T")[0]));
      }
      if (endDate) {
        voucherConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      }

      // allTime conditions: same but without startDate filter
      const allTimeVoucherConditions: any[] = [
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
      ];
      if (endDate) {
        allTimeVoucherConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      }

      // Phase 2: period entries + all-time entries via JOINs (eliminates 2 intermediate ID round-trips)
      // COALESCE(base_debit_amount, debit_amount): uses historical USD base when available
      // (i.e. after backfill), falls back to debit_amount for legacy rows.
      const [periodEntries, allTimeEntries] = await Promise.all([
        db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            debitAmount: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
            creditAmount: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
            voucherId: voucherEntries.voucherId,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(...voucherConditions))
          .execute(),
        db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            debitAmount: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
            creditAmount: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
            supplierId: voucherEntries.supplierId,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(...allTimeVoucherConditions))
          .execute(),
      ]);

      const companyEntries = periodEntries;
      const companyVoucherIds = [
        ...new Set(periodEntries.map((e) => e.voucherId).filter((id): id is number => id != null)),
      ];

      // Calculate balances for each account (credit - debit for normal P&L view)
      // accountBalances = period-filtered (used for P&L: purchases, sales, expenses, incomes)
      const accountBalances = new Map<number, { debit: number; credit: number }>();
      for (const entry of companyEntries) {
        if (entry.ledgerAccountId) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");
          const current = accountBalances.get(entry.ledgerAccountId) || { debit: 0, credit: 0 };
          accountBalances.set(entry.ledgerAccountId, {
            debit: current.debit + debit,
            credit: current.credit + credit,
          });
        }
      }

      // allTimeAccountBalances = ALL vouchers up to endDate (used for Net Position balance sheet)
      // This ensures Net Position reflects the true running balance of assets/liabilities
      const allTimeAccountBalances = new Map<number, { debit: number; credit: number }>();
      for (const entry of allTimeEntries) {
        if (entry.ledgerAccountId) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");
          const current = allTimeAccountBalances.get(entry.ledgerAccountId) || { debit: 0, credit: 0 };
          allTimeAccountBalances.set(entry.ledgerAccountId, {
            debit: current.debit + debit,
            credit: current.credit + credit,
          });
        }
      }

      // 1. Opening Stock - FROZEN value from stock items' opening values only
      // This value does not change with POS sales - it represents the initial inventory setup
      let openingStockValue = 0;
      for (const item of allStockItems) {
        openingStockValue += parseFloat(item.openingValue || "0");
      }

      // 2. Purchase Accounts - accounts with code starting with PURCHASES or related expense accounts
      const purchaseAccounts = companyAccounts.filter(
        (acc) => acc.code === "PURCHASES" || acc.code?.startsWith("PURCHASES-")
      );
      let purchaseAccountsTotal = 0;
      const purchaseAccountsDetails: {
        id: number;
        code: string;
        name: string;
        debit: number;
        credit: number;
        balance: number;
      }[] = purchaseAccounts.map((acc) => {
        const balance = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
        const netBalance = balance.debit - balance.credit; // Purchases are debits
        purchaseAccountsTotal += netBalance;
        return {
          id: acc.id,
          code: acc.code || "",
          name: acc.name,
          debit: balance.debit,
          credit: balance.credit,
          balance: netBalance,
        };
      });

      // For factory companies: calculate raw material purchases from factory_raw_stock table
      // and raw material remaining value for closing stock adjustment
      let factoryRawStockRemainingValue = 0;
      if (isFactoryCompany) {
        // Build filter for raw materials received in the period
        const frsConditions: any[] = [eq(factoryRawStock.companyId, companyId)];
        if (startDate) {
          frsConditions.push(gte(factoryRawStock.offloadedAt, startDate));
        }
        if (endDate) {
          frsConditions.push(lte(factoryRawStock.offloadedAt, endDate));
        }
        const frsInPeriod = await db
          .select({
            receivedKg: factoryRawStock.receivedKg,
            costPerKg: factoryRawStock.costPerKg,
          })
          .from(factoryRawStock)
          .where(and(...frsConditions))
          .execute();

        let factoryRawPurchaseCost = 0;
        for (const row of frsInPeriod) {
          const qty = parseFloat(row.receivedKg || "0");
          const cost = parseFloat(row.costPerKg || "0");
          factoryRawPurchaseCost += qty * cost;
        }

        if (factoryRawPurchaseCost > 0) {
          purchaseAccountsTotal += factoryRawPurchaseCost;
          purchaseAccountsDetails.push({
            id: -1,
            code: "FACTORY_RAW_MATERIALS",
            name: "Factory Raw Materials",
            debit: factoryRawPurchaseCost,
            credit: 0,
            balance: factoryRawPurchaseCost,
          });
        }

        // Closing stock: sum remaining (received - used) × cost per kg across ALL factory raw stock
        const allFrs = await db
          .select({
            receivedKg: factoryRawStock.receivedKg,
            usedKg: factoryRawStock.usedKg,
            costPerKg: factoryRawStock.costPerKg,
          })
          .from(factoryRawStock)
          .where(eq(factoryRawStock.companyId, companyId))
          .execute();
        for (const row of allFrs) {
          const received = parseFloat(row.receivedKg || "0");
          const used = parseFloat(row.usedKg || "0");
          const cost = parseFloat(row.costPerKg || "0");
          factoryRawStockRemainingValue += (received - used) * cost;
        }
      }

      // 3. Direct Incomes - accounts with accountType="Income" AND subType="Direct Income"
      // EXCLUDE sales-related accounts because Sales is already counted from salesItems table
      const directIncomeAccounts = companyAccounts.filter(
        (acc) =>
          acc.accountType === "Income" &&
          acc.subType === "Direct Income" &&
          !acc.code?.includes("SALES") && // Exclude SALES_REV, SALES, etc.
          !acc.name?.toLowerCase().includes("sales") // Exclude any sales-named accounts
      );
      let directIncomesTotal = 0;
      const directIncomesDetails = directIncomeAccounts.map((acc) => {
        const balance = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
        const netBalance = balance.credit - balance.debit; // Income is credits
        directIncomesTotal += netBalance;
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          debit: balance.debit,
          credit: balance.credit,
          balance: netBalance,
        };
      });

      // 4. Direct Expenses - include accounts that are Direct Expenses in any form:
      // - accountType === "Direct Expense"
      // - accountType === "Expense" AND subType === "Direct Expense"
      // - IMPORT_CHARGES parent and its children (import costs that reduce profit)
      const importChargesParent = companyAccounts.find((acc) => acc.code === "IMPORT_CHARGES");
      const importChargesAccountIds = new Set<number>();
      if (importChargesParent) {
        importChargesAccountIds.add(importChargesParent.id);
        companyAccounts.forEach((acc) => {
          if (acc.parentId === importChargesParent.id) {
            importChargesAccountIds.add(acc.id);
          }
        });
      }

      const directExpenseAccounts = companyAccounts.filter(
        (acc) =>
          acc.code !== "PURCHASES" &&
          !acc.code?.startsWith("PURCHASES") &&
          (acc.accountType === "Direct Expense" ||
            (acc.accountType === "Expense" && acc.subType === "Direct Expense") ||
            importChargesAccountIds.has(acc.id))
      );
      let directExpensesTotal = 0;
      const directExpensesDetails = directExpenseAccounts.map((acc) => {
        const balance = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
        const netBalance = balance.debit - balance.credit; // Expenses are debits
        directExpensesTotal += netBalance;
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          debit: balance.debit,
          credit: balance.credit,
          balance: netBalance,
          parentId: acc.parentId ?? undefined,
        };
      });

      // 5. Sales Accounts - Sum of all sales from Receipt vouchers (POS sales)
      // NOTE: Must calculate Sales BEFORE Gross Profit for Tally-style calculation
      const salesConditions = [
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
      ];
      if (startDate) {
        salesConditions.push(gte(vouchers.voucherDate, startDate.toISOString().split("T")[0]));
      }
      if (endDate) {
        salesConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      }

      const salesData = await db
        .select({
          total: sql<string>`COALESCE(SUM(${salesItems.totalSales}), 0)`,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...salesConditions))
        .execute();
      const posSalesTotal = parseFloat(salesData[0]?.total || "0");

      // For ERP companies (non-POS): income may be recorded via voucher entries crediting
      // income-type accounts (like SALES_REV). These are excluded from directIncomes/indirectIncomes
      // to avoid double-counting with POS salesItems, but for ERP vouchers (no salesItems),
      // we must capture them here so they appear as Sales Revenue in the P&L.
      //
      // "Missed" income accounts = those NOT already counted in directIncomes or indirectIncomes:
      //   - Income accounts with SALES in code/name (excluded by SALES filter in directIncomes)
      //   - Income accounts with null/unrecognized subType (don't match Direct or Indirect Income)
      const missedIncomeAccounts = companyAccounts.filter((acc) => {
        if (acc.accountType !== "Income") return false;
        if (acc.subType === "Indirect Income") return false; // already in indirectIncomesTotal
        if (
          acc.subType === "Direct Income" &&
          !acc.code?.includes("SALES") &&
          !acc.name?.toLowerCase().includes("sales")
        )
          return false; // already in directIncomesTotal
        return true;
      });

      let erpSalesTotal = 0;
      const erpSalesAccountsDetails: {
        id: number;
        code: string;
        name: string;
        debit: number;
        credit: number;
        balance: number;
      }[] = [];
      const missedAccountIds = missedIncomeAccounts.map((a) => a.id);
      if (missedAccountIds.length > 0) {
        // Single JOIN query: ERP (non-POS) voucher entries for missed income accounts.
        // "Non-POS" = vouchers that have NO sales_items rows (NOT EXISTS subquery).
        // Replaces the previous two-step: (1) fetch posVoucherIds, (2) inArray(nonPosVoucherIds).
        const erpSalesEntries = await db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            debitAmount: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
            creditAmount: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.optional, false),
              isNull(vouchers.deletedAt),
              inArray(voucherEntries.ledgerAccountId, missedAccountIds),
              sql`NOT EXISTS (SELECT 1 FROM sales_items si WHERE si.voucher_id = voucher_entries.voucher_id)`
            )
          )
          .execute();

        const erpSalesByAccount = new Map<number, { debit: number; credit: number }>();
        for (const e of erpSalesEntries) {
          if (!e.ledgerAccountId) continue;
          const d = parseFloat(e.debitAmount || "0");
          const c = parseFloat(e.creditAmount || "0");
          const cur = erpSalesByAccount.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
          erpSalesByAccount.set(e.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
        }
        for (const acc of missedIncomeAccounts) {
          const bal = erpSalesByAccount.get(acc.id) || { debit: 0, credit: 0 };
          const netBalance = bal.credit - bal.debit;
          if (Math.abs(netBalance) > 0.001) {
            erpSalesTotal += netBalance;
            erpSalesAccountsDetails.push({
              id: acc.id,
              code: acc.code || "",
              name: acc.name,
              debit: bal.debit,
              credit: bal.credit,
              balance: netBalance,
            });
          }
        }
      }

      const salesAccountsTotal = posSalesTotal + erpSalesTotal;

      // 6. Closing Stock — single JOIN replaces two-step (fetch active locationIds, then inArray)
      let closingStockValue = 0;
      {
        const inventoryData = await db
          .select({
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
          .execute();
        for (const inv of inventoryData) {
          closingStockValue += parseFloat(inv.quantity || "0") * parseFloat(inv.averageRate || "0");
        }
      }

      // For factory companies: add raw material remaining stock to closing stock value
      if (isFactoryCompany) {
        closingStockValue += factoryRawStockRemainingValue;
      }

      // 7. Gross Profit Calculation - TALLY PRIME TRADING ACCOUNT STYLE
      // Trading Account format:
      // - Credit side: Sales + Closing Stock + Direct Incomes
      // - Debit side: Opening Stock + Purchases + Direct Expenses
      // - Gross Profit = Credit side - Debit side
      const tradingCreditSide = salesAccountsTotal + closingStockValue + directIncomesTotal;
      const tradingDebitSide = openingStockValue + purchaseAccountsTotal + directExpensesTotal;
      // For "All Time" (no startDate): traditional Tally format — opening on debit, closing on credit.
      // For period-filtered (day/week/month): pure voucher-based P&L so periods are properly additive.
      // Opening/closing stock are excluded from period P&L to avoid all-time snapshot distortion.
      const grossProfit = startDate
        ? salesAccountsTotal + directIncomesTotal - purchaseAccountsTotal - directExpensesTotal
        : tradingCreditSide - tradingDebitSide;

      // 8. Indirect Expenses - accounts with accountType="Indirect Expense"
      // Exclude PRODUCTION_ADJUSTMENT and CONSUMPTION_EXPENSE — their inventory effect
      // is already captured in stockOnFloor (closing stock), showing them would double-count.
      // Also exclude PURCHASES accounts — those belong in the Trading Account, not Indirect Expenses.
      const indirectExpenseAccounts = companyAccounts.filter(
        (acc) =>
          acc.accountType === "Indirect Expense" &&
          acc.code !== "PRODUCTION_ADJUSTMENT" &&
          acc.code !== "CONSUMPTION_EXPENSE" &&
          acc.code !== "PURCHASES" &&
          !acc.code?.startsWith("PURCHASES")
      );
      let indirectExpensesTotal = 0;
      const indirectExpensesDetails = indirectExpenseAccounts.map((acc) => {
        const balance = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
        const netBalance = balance.debit - balance.credit; // Expenses are debits
        indirectExpensesTotal += netBalance;
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          debit: balance.debit,
          credit: balance.credit,
          balance: netBalance,
          parentId: acc.parentId ?? undefined,
        };
      });

      // 6b. Indirect Incomes - accounts with accountType="Income" AND subType="Indirect Income"
      // Must be calculated before Net Profit so it can be included
      const indirectIncomeAccounts = companyAccounts.filter(
        (acc) => acc.accountType === "Income" && acc.subType === "Indirect Income"
      );
      let indirectIncomesTotal = 0;
      const indirectIncomesDetails = indirectIncomeAccounts.map((acc) => {
        const balance = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
        const netBalance = balance.credit - balance.debit; // Income is credits
        indirectIncomesTotal += netBalance;
        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          debit: balance.debit,
          credit: balance.credit,
          balance: netBalance,
        };
      });

      // 9. Net Profit = Gross Profit + Indirect Incomes - Indirect Expenses
      // This follows Tally Prime's P&L methodology where:
      // - Gross Profit comes from Trading Account (direct expenses already included there)
      // - Then we add indirect incomes and subtract indirect expenses
      const netProfit = grossProfit + indirectIncomesTotal - indirectExpensesTotal;

      // 10. Net Position - same calculation as dashboard (/api/stats/net-profit)
      // Uses allTimeAccountBalances (all vouchers up to endDate) so it reflects the selected period.
      const npRound2Stmt = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // Build supplier balance map from all-time entries
      const stmtSupplierBals = new Map<number, { debit: number; credit: number }>();
      for (const e of allTimeEntries) {
        if (e.supplierId) {
          const d = parseFloat(e.debitAmount || "0"),
            c = parseFloat(e.creditAmount || "0");
          const cur = stmtSupplierBals.get(e.supplierId) || { debit: 0, credit: 0 };
          stmtSupplierBals.set(e.supplierId, { debit: cur.debit + d, credit: cur.credit + c });
        }
      }

      // Account exclusion rules matching dashboard
      const stmtExcludedTypes = ["Income", "Profit", "Equity", "EQUITY", "Fixed Asset"];
      const stmtExpenseTypes = ["Expense", "Direct Expense", "Indirect Expense"];
      const stmtAssetTypes = ["Asset", "Current Asset", "Fixed Asset", "Bank", "Cash"];
      const stmtStockPatterns = [
        "closing stock",
        "opening stock",
        "stock in hand",
        "stock on hand",
        "inventory",
        "stock account",
        "goods in stock",
        "merchandise",
      ];
      const stmtStockCodes = ["CLOSING_STOCK", "OPENING_STOCK", "STOCK", "INVENTORY", "STOCK_IN_HAND"];
      const stmtFixedAssetNames = [
        "rover",
        "toyota",
        "mercedes",
        "vehicle",
        "car",
        "truck",
        "land",
        "property",
        "building",
        "house",
        "rolex",
        "watch",
        "luxury",
        "jewelry",
        "guarantee",
        "deposit",
        "caution",
      ];
      const isExcludedFromStmtNp = (acc: (typeof companyAccounts)[0]) => {
        if (stmtExcludedTypes.includes(acc.accountType || "")) return true;
        if (acc.code === "PRODUCTION_ADJUSTMENT" || acc.code === "CONSUMPTION_EXPENSE") return true;
        const nameLower = (acc.name || "").toLowerCase();
        const codeLower = (acc.code || "").toLowerCase();
        if (stmtAssetTypes.includes(acc.accountType || "")) {
          if (stmtStockPatterns.some((p) => nameLower.includes(p))) return true;
          if (stmtStockCodes.some((c) => codeLower === c.toLowerCase() || codeLower.startsWith(c.toLowerCase() + "_")))
            return true;
          if (stmtFixedAssetNames.some((p) => nameLower.includes(p))) return true;
        }
        return false;
      };

      // CFA revaluation: fetch the latest USD→CFA rate for this company (if any).
      // Cash accounts hold physical CFA units — their USD worth changes with the rate.
      // Expenses, loans and all other accounts are locked at historical values.
      const stmtCfaRateRows = await db
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.companyId, companyId),
            eq(exchangeRates.fromCurrency, "USD"),
            eq(exchangeRates.toCurrency, "CFA")
          )
        )
        .orderBy(desc(exchangeRates.effectiveDate))
        .limit(1);
      const stmtCurrentCfaRate = stmtCfaRateRows.length > 0 ? parseFloat(stmtCfaRateRows[0].rate) : 0;

      let stmtNpForUs = 0,
        stmtNpOnUs = 0;
      const stmtLiabilityTypes = ["Liability", "Duty Agent", "Transporter Agent", "Loan"];
      for (const acc of companyAccounts) {
        if (stmtExpenseTypes.includes(acc.accountType || "")) continue;
        if (acc.accountType === "Income") continue;
        if (isExcludedFromStmtNp(acc)) continue;
        const opening = parseFloat(acc.openingBalance || "0");
        const openingSigned = acc.openingBalanceSide === "Dr" ? opening : -opening;
        const bal = allTimeAccountBalances.get(acc.id) || { debit: 0, credit: 0 };
        let net = openingSigned + bal.debit - bal.credit;
        // Revalue Cash accounts by the current CFA rate (amounts stored in CFA, convert to USD)
        if (stmtCurrentCfaRate > 0 && acc.accountType === "Cash") {
          net = net / stmtCurrentCfaRate;
        }
        if (net > 0) stmtNpForUs += net;
        else if (net < 0) stmtNpOnUs += Math.abs(net);
      }

      // For All Time (no endDate): include inventory, workers, OTW — they are current values that match the dashboard.
      // For specific periods (endDate set): skip these non-date-bounded components; rely only on
      // ledger account balances + supplier balances which ARE properly bounded by endDate.
      const stmtIsAllTime = !endDate;
      if (stmtIsAllTime) {
        // Add opening stock as an asset (entered outside ledger via stockItems.openingValue)
        // This is NOT an expense — it is the initial cost basis of inventory brought into the system
        if (openingStockValue > 0) {
          stmtNpForUs += openingStockValue;
        }

        // Add stock on floor (inventory) as asset
        stmtNpForUs += closingStockValue;

        // Add worker/employee liabilities
        const stmtEmployees = await db
          .select()
          .from(employees)
          .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
          .execute();
        let stmtWorkerBal = 0;
        for (const emp of stmtEmployees) stmtWorkerBal += parseFloat((emp as any).currentBalance || "0");
        if (stmtWorkerBal > 0) stmtNpOnUs += stmtWorkerBal;
        else if (stmtWorkerBal < 0) stmtNpForUs += Math.abs(stmtWorkerBal);

        // Add OTW containers as assets
        const stmtOtwContainers = await db
          .select()
          .from(containers)
          .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")))
          .execute();
        for (const c of stmtOtwContainers) {
          stmtNpForUs += parseFloat((c as any).grandTotal || (c as any).itemsTotal || "0");
        }
      }

      // Add suppliers (parent company only) - always included since stmtSupplierBals is already bounded by endDate
      const stmtParentCompanyId = await storage.getParentCompanyId();
      const stmtShouldIncludeSuppliers = stmtParentCompanyId === null || companyId === stmtParentCompanyId;
      let stmtSupplierTotal = 0;
      if (stmtShouldIncludeSuppliers) {
        const stmtAllSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
        for (const sup of stmtAllSuppliers) {
          const balance = stmtSupplierBals.get(sup.id);
          if (balance) {
            const opening = parseFloat((sup as any).openingBalance || "0");
            const netBalance = opening + balance.credit - balance.debit;
            if (netBalance > 0) {
              stmtNpOnUs += netBalance;
              stmtSupplierTotal += netBalance;
            } else if (netBalance < 0) {
              stmtNpForUs += Math.abs(netBalance);
              stmtSupplierTotal -= Math.abs(netBalance);
            }
          }
        }
      }

      // Debug: log net position components so discrepancies can be traced
      const stmtAccountsForUs: string[] = [],
        stmtAccountsOnUs: string[] = [];
      for (const acc of companyAccounts) {
        if (stmtExpenseTypes.includes(acc.accountType || "")) continue;
        if (acc.accountType === "Income") continue;
        if (isExcludedFromStmtNp(acc)) continue;
        const opening = parseFloat(acc.openingBalance || "0");
        const openingSigned = acc.openingBalanceSide === "Dr" ? opening : -opening;
        const bal = allTimeAccountBalances.get(acc.id) || { debit: 0, credit: 0 };
        const net = openingSigned + bal.debit - bal.credit;
        if (Math.abs(net) > 0.01) {
          const entry = `${acc.name} (${acc.code}/${acc.accountType}): ${net > 0 ? "+" : ""}${net.toFixed(2)}`;
          if (net > 0) stmtAccountsForUs.push(entry);
          else stmtAccountsOnUs.push(entry);
        }
      }
      const netPositionValue = npRound2Stmt(stmtNpForUs - stmtNpOnUs);

      // Opening Balances Net — the net worth of the business before any voucher transactions.
      // Computed as sum of all non-income/non-expense account opening balances (Dr positive, Cr negative).
      // Shown in the All Time P&L so that: Opening Balances + Sum(monthly P&Ls) ≈ Net Position.
      const skipTypesForOB = ["Income", "Expense", "Direct Expense", "Indirect Expense", "Profit"];
      let openingBalancesNet = 0;
      for (const acc of companyAccounts) {
        if (skipTypesForOB.includes(acc.accountType || "")) continue;
        if (isExcludedFromStmtNp(acc)) continue;
        const opening = parseFloat(acc.openingBalance || "0");
        if (opening === 0) continue;
        const openingSigned = acc.openingBalanceSide === "Dr" ? opening : -opening;
        openingBalancesNet += openingSigned;
      }

      // Calculate totals for panes (Tally Trading Account format)
      // Left pane (Debit side): Opening Stock + Purchases + Direct Expenses
      // Right pane (Credit side): Sales + Closing Stock + Direct Incomes
      const leftPaneTotal = tradingDebitSide; // Opening Stock + Purchases + Direct Expenses
      const rightTradingTotal = tradingCreditSide; // Sales + Closing Stock + Direct Incomes

      // === RIGHT PANE DATA ===
      // Note: salesAccountsTotal, closingStockValue, directIncomesTotal already calculated above for Gross Profit

      // Gross Profit b/f - Same as gross profit from Trading Account
      const grossProfitBf = grossProfit;

      // Right pane total for P&L display (trading credit side + indirect incomes for balancing)
      const rightPaneTotal = rightTradingTotal + indirectIncomesTotal;

      const npsResult = {
        dateRange: {
          startDate: startDate ? startDate.toISOString().split("T")[0] : null,
          endDate: endDate ? endDate.toISOString().split("T")[0] : null,
        },
        netPosition: netPositionValue,
        openingBalancesNet: startDate ? null : openingBalancesNet,
        // TALLY PRIME TRADING ACCOUNT STRUCTURE
        // Left pane (Debit side): Opening Stock + Purchases + Direct Expenses
        // Right pane (Credit side): Sales + Closing Stock + Direct Incomes
        leftPane: {
          // Trading Account - Debit Side
          // For period-filtered views (monthly, weekly, etc.), opening/closing stock are excluded
          // so monthly P&Ls reflect true trading performance (no all-time stock distortion).
          // Only "All Time" (no startDate) includes the stock adjustment.
          openingStock: {
            value: startDate ? 0 : openingStockValue,
          },
          purchaseAccounts: {
            total: purchaseAccountsTotal,
            accounts: purchaseAccountsDetails,
            count: purchaseAccountsDetails.length,
          },
          directExpenses: {
            total: directExpensesTotal,
            accounts: directExpensesDetails,
            count: directExpenseAccounts.length,
          },
          tradingTotal: leftPaneTotal, // Sum of debit side
          grossProfit: grossProfit, // Balancing figure (credit - debit)
          // P&L Section
          indirectExpenses: {
            total: indirectExpensesTotal,
            accounts: indirectExpensesDetails,
            count: indirectExpenseAccounts.length,
          },
          netProfit: netProfit,
        },
        rightPane: {
          // Trading Account - Credit Side
          salesAccounts: {
            total: salesAccountsTotal,
            posTotal: posSalesTotal,
            ledgerTotal: erpSalesTotal,
            accounts: erpSalesAccountsDetails,
          },
          directIncomes: {
            total: directIncomesTotal,
            accounts: directIncomesDetails,
            count: directIncomeAccounts.length,
          },
          closingStock: {
            value: startDate ? 0 : closingStockValue,
          },
          tradingTotal: rightTradingTotal, // Sum of credit side
          grossProfitBf: grossProfitBf,
          // P&L Section
          indirectIncomes: {
            total: indirectIncomesTotal,
            accounts: indirectIncomesDetails,
            count: indirectIncomeAccounts.length,
          },
          total: rightPaneTotal,
        },
      };
      _npsSetCache(npsCacheKey, npsResult);
      res.json(npsResult);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  registerReportsClosingStockRoutes(app);

  registerReportsNetProfitStatementRoutes(app);

  // Ledger Monthly Summary - monthly breakdown for a ledger account
  app.get("/api/reports/ledger-monthly-summary/:accountId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.accountId);
      if (isNaN(accountId)) return res.status(400).json({ message: "Invalid account ID" });
      const { startDate, endDate } = req.query;

      // Get the ledger account
      const account = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)))
        .execute()
        .then((rows) => rows[0]);

      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      // Parse date range
      const start = startDate ? new Date(startDate as string) : new Date(new Date().getFullYear(), 0, 1);
      const end = endDate ? new Date(endDate as string) : new Date(new Date().getFullYear(), 11, 31);

      // Get opening balance (entries before start date)
      const openingEntries = await db
        .select({
          debit: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
          credit: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, accountId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            lt(vouchers.voucherDate, start.toISOString().split("T")[0])
          )
        )
        .execute();

      // Sign-adjust opening balance: use Cr-normal convention (positive = Cr balance)
      const openingRawMonthly = parseFloat(account.openingBalance || "0");
      const openingBalSideMonthly = (account.openingBalanceSide as string) || "Dr";
      let openingBalance = openingBalSideMonthly === "Cr" ? openingRawMonthly : -openingRawMonthly;
      for (const entry of openingEntries) {
        openingBalance += parseFloat(entry.credit || "0") - parseFloat(entry.debit || "0");
      }

      // Get all voucher entries in date range grouped by month
      // COALESCE(base_debit_amount, debit_amount): uses historical USD base when available
      const entries = await db
        .select({
          voucherId: vouchers.id,
          date: vouchers.voucherDate,
          debit: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
          credit: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, accountId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            gte(vouchers.voucherDate, start.toISOString().split("T")[0]),
            lte(vouchers.voucherDate, end.toISOString().split("T")[0])
          )
        )
        .execute();

      // Group by month
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      const monthlyData: { month: number; monthName: string; debit: number; credit: number; closingBalance: number }[] =
        [];
      let runningBalance = openingBalance;

      for (let month = 0; month < 12; month++) {
        const monthEntries = entries.filter((e) => {
          const d = new Date(e.date);
          return d.getMonth() === month && d.getFullYear() === start.getFullYear();
        });

        let debit = 0;
        let credit = 0;
        for (const entry of monthEntries) {
          debit += parseFloat(entry.debit || "0");
          credit += parseFloat(entry.credit || "0");
        }

        runningBalance += credit - debit;

        monthlyData.push({
          month: month + 1,
          monthName: monthNames[month],
          debit,
          credit,
          closingBalance: runningBalance,
        });
      }

      // Calculate grand totals
      const grandTotal = {
        debit: monthlyData.reduce((sum, m) => sum + m.debit, 0),
        credit: monthlyData.reduce((sum, m) => sum + m.credit, 0),
        closingBalance: runningBalance,
      };

      res.json({
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
        },
        openingBalance,
        months: monthlyData,
        grandTotal,
        dateRange: {
          startDate: start.toISOString().split("T")[0],
          endDate: end.toISOString().split("T")[0],
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ledger Vouchers - vouchers for a specific month
  app.get("/api/reports/ledger-vouchers/:accountId/:year/:month", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const accountId = parseInt(req.params.accountId);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);
      if (isNaN(accountId) || isNaN(year) || isNaN(month))
        return res.status(400).json({ message: "Invalid parameters" });

      // Get the ledger account
      const account = await db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.companyId, companyId)))
        .execute()
        .then((rows) => rows[0]);

      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      const monthNames = [
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      // Calculate date range for the month
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);

      // Get opening balance (entries before this month)
      const openingEntries = await db
        .select({
          debit: voucherEntries.debitAmount,
          credit: voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, accountId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            lt(vouchers.voucherDate, startOfMonth.toISOString().split("T")[0])
          )
        )
        .execute();

      // Sign-adjust opening balance: use Cr-normal convention (positive = Cr balance)
      const openingRaw = parseFloat(account.openingBalance || "0");
      const openingBalSide = (account.openingBalanceSide as string) || "Dr";
      let openingBalance = openingBalSide === "Cr" ? openingRaw : -openingRaw;
      for (const entry of openingEntries) {
        openingBalance += parseFloat(entry.credit || "0") - parseFloat(entry.debit || "0");
      }

      // Get vouchers for the month
      const voucherEntriesData = await db
        .select({
          entryId: voucherEntries.id,
          voucherId: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          date: vouchers.voucherDate,
          debit: voucherEntries.debitAmount,
          credit: voucherEntries.creditAmount,
          supplierId: voucherEntries.supplierId,
          locationId: vouchers.locationId,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.ledgerAccountId, accountId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            gte(vouchers.voucherDate, startOfMonth.toISOString().split("T")[0]),
            lte(vouchers.voucherDate, endOfMonth.toISOString().split("T")[0])
          )
        )
        .orderBy(vouchers.voucherDate, vouchers.voucherNumber)
        .execute();

      // Enrich with party names
      const vouchersWithDetails = await Promise.all(
        voucherEntriesData.map(async (entry) => {
          let particulars: string;

          if (entry.supplierId) {
            const supplierData = await db
              .select({ legalName: suppliers.legalName })
              .from(suppliers)
              .where(eq(suppliers.id, entry.supplierId))
              .execute()
              .then((rows) => rows[0]);
            particulars = supplierData?.legalName || "Unknown Supplier";
          } else if (entry.locationId) {
            const location = await db
              .select({ name: locations.name })
              .from(locations)
              .where(eq(locations.id, entry.locationId))
              .execute()
              .then((rows) => rows[0]);
            particulars = location?.name || "Unknown Location";
          } else if (entry.narration) {
            particulars = entry.narration.substring(0, 50);
          } else {
            // Get contra account
            const contraEntries = await db
              .select({ accountName: ledgerAccounts.name })
              .from(voucherEntries)
              .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
              .where(and(eq(voucherEntries.voucherId, entry.voucherId), ne(voucherEntries.ledgerAccountId, accountId)))
              .execute();
            particulars = contraEntries[0]?.accountName || "Multiple Accounts";
          }

          return {
            id: entry.entryId,
            voucherId: entry.voucherId,
            date: entry.date,
            particulars,
            voucherType: entry.voucherType,
            voucherNumber: entry.voucherNumber,
            debit: parseFloat(entry.debit || "0"),
            credit: parseFloat(entry.credit || "0"),
          };
        })
      );

      const totals = {
        debit: vouchersWithDetails.reduce((sum, v) => sum + v.debit, 0),
        credit: vouchersWithDetails.reduce((sum, v) => sum + v.credit, 0),
      };

      const closingBalance = openingBalance + totals.credit - totals.debit;

      res.json({
        account: {
          id: account.id,
          code: account.code,
          name: account.name,
        },
        month,
        monthName: monthNames[month],
        year,
        openingBalance,
        vouchers: vouchersWithDetails,
        totals,
        closingBalance,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Voucher Detail - full voucher with items/entries
  app.get("/api/voucher-detail/:voucherId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const voucherId = parseInt(req.params.voucherId);
      if (isNaN(voucherId)) return res.status(400).json({ message: "Invalid voucher ID" });

      // Get the voucher
      const voucher = await db
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId)))
        .execute()
        .then((rows) => rows[0]);

      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // POS sales ownership is recorded through the linked shift.
      if (req.user?.role === "POS" && voucher.voucherType === "Sales") {
        const [ownedShift] = voucher.shiftId
          ? await db
              .select({ id: posShifts.id })
              .from(posShifts)
              .where(and(eq(posShifts.id, voucher.shiftId), eq(posShifts.userId, req.user.id)))
              .limit(1)
          : [];
        if (!ownedShift) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      // Get party name from voucher entries (supplier)
      let partyName: string | null = null;
      const supplierEntry = await db
        .select({ supplierId: voucherEntries.supplierId })
        .from(voucherEntries)
        .where(and(eq(voucherEntries.voucherId, voucherId), isNotNull(voucherEntries.supplierId)))
        .execute()
        .then((rows) => rows[0]);

      if (supplierEntry?.supplierId) {
        const supplier = await db
          .select({ legalName: suppliers.legalName })
          .from(suppliers)
          .where(eq(suppliers.id, supplierEntry.supplierId))
          .execute()
          .then((rows) => rows[0]);
        partyName = supplier?.legalName || null;
      }

      // Get location name
      const locationName = voucher.locationName || null;

      // Get purchase ledger
      let purchaseLedger: string | null = null;
      const purchaseEntry = await db
        .select({ name: ledgerAccounts.name })
        .from(voucherEntries)
        .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
        .where(
          and(
            eq(voucherEntries.voucherId, voucherId),
            or(eq(ledgerAccounts.code, "PURCHASES"), sql`${ledgerAccounts.code} LIKE 'PURCHASES-%'`)
          )
        )
        .execute()
        .then((rows) => rows[0]);
      purchaseLedger = purchaseEntry?.name || null;

      // Get sales items (from sales_items table for Receipt vouchers)
      const salesItemsData = await db
        .select({
          id: salesItems.id,
          stockItemId: salesItems.stockItemId,
          quantity: salesItems.quantity,
          rate: salesItems.sellingPrice,
          total: salesItems.totalSales,
        })
        .from(salesItems)
        .where(eq(salesItems.voucherId, voucherId))
        .execute();

      // Get purchase order line items if this is a PO-linked voucher
      const poItemsData = await db
        .select({
          id: poLineItems.id,
          stockItemId: poLineItems.stockItemId,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          total: poLineItems.lineTotal,
        })
        .from(poLineItems)
        .innerJoin(purchaseOrders, eq(poLineItems.poId, purchaseOrders.id))
        .where(eq(purchaseOrders.voucherId, voucherId))
        .execute();

      // Combine and enrich items
      const allItems = [...salesItemsData, ...poItemsData];
      const items = await Promise.all(
        allItems.map(async (item) => {
          let stockItem = null;
          if (item.stockItemId) {
            stockItem = await db
              .select({ name: stockItems.name, code: stockItems.code, uom: stockItems.uom })
              .from(stockItems)
              .where(eq(stockItems.id, item.stockItemId))
              .execute()
              .then((rows) => rows[0]);
          }

          return {
            id: item.id,
            stockItemId: item.stockItemId,
            stockItemName: stockItem?.name || "Unknown Item",
            stockItemCode: stockItem?.code || "",
            quantity: parseFloat(item.quantity || "0"),
            unit: stockItem?.uom || "BL",
            rate: parseFloat(item.rate || "0"),
            amount: parseFloat(item.total || "0"),
          };
        })
      );

      // Get ledger entries
      const entriesData = await db
        .select({
          id: voucherEntries.id,
          ledgerAccountId: voucherEntries.ledgerAccountId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
        })
        .from(voucherEntries)
        .where(eq(voucherEntries.voucherId, voucherId))
        .execute();

      const entries = await Promise.all(
        entriesData.map(async (entry) => {
          let ledgerName = "Unknown Account";
          if (entry.ledgerAccountId) {
            const ledger = await db
              .select({ name: ledgerAccounts.name })
              .from(ledgerAccounts)
              .where(eq(ledgerAccounts.id, entry.ledgerAccountId))
              .execute()
              .then((rows) => rows[0]);
            ledgerName = ledger?.name || "Unknown Account";
          }

          return {
            id: entry.id,
            ledgerAccountId: entry.ledgerAccountId || 0,
            ledgerAccountName: ledgerName,
            debitAmount: parseFloat(entry.debitAmount || "0"),
            creditAmount: parseFloat(entry.creditAmount || "0"),
            narration: entry.narration,
          };
        })
      );

      // Calculate totals
      const itemsTotalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
      const itemsTotalAmount = items.reduce((sum, i) => sum + i.amount, 0);
      const entriesDebit = entries.reduce((sum, e) => sum + e.debitAmount, 0);
      const entriesCredit = entries.reduce((sum, e) => sum + e.creditAmount, 0);

      res.json({
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        voucherType: voucher.voucherType,
        date: voucher.voucherDate,
        partyName,
        purchaseLedger,
        locationName,
        narration: voucher.description,
        supplierInvoiceNo: null,
        items,
        entries,
        totals: {
          quantity: itemsTotalQuantity,
          amount: itemsTotalAmount,
          debit: entriesDebit,
          credit: entriesCredit,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Dashboard Container Tracking - cross-company OTW container view
  app.get("/api/dashboard/container-tracking", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get all companies the user has access to
      const userCompanyRoles = await storage.getUserCompaniesWithRoles(userId);
      const companyIds = userCompanyRoles.map((r) => r.companyId);

      if (companyIds.length === 0) {
        return res.json({
          containers: [],
          byRoute: {},
          byAgent: {},
          byLocation: {},
          byTransporter: {},
          totals: { count: 0, amount: 0 },
        });
      }

      // Get all companies for names
      const allCompanies = await storage.getAllCompanies();
      const companyMap = new Map(allCompanies.map((c) => [c.id, c]));

      // Get all suppliers for names
      const allSuppliers = await storage.getAllSuppliers();
      const supplierMap = new Map(allSuppliers.map((s) => [s.id, s]));

      // Fetch ALL containers (OTW and Offloaded) from all accessible companies
      const otwContainers: any[] = [];
      const offloadedContainers: any[] = [];

      // Pre-fetch item counts for all containers
      const containerItemCounts: Record<number, number> = {};

      for (const companyId of companyIds) {
        const containers = await storage.getAllContainers(companyId);
        const containerIds = containers.map((c) => c.id);

        if (containerIds.length > 0) {
          // Get PO counts per container
          const posByContainer = await db
            .select({ containerId: purchaseOrders.containerId, poId: purchaseOrders.id })
            .from(purchaseOrders)
            .where(inArray(purchaseOrders.containerId, containerIds));

          const poIds = posByContainer.map((p) => p.poId);
          if (poIds.length > 0) {
            // Get line item counts per PO
            const lineItemCounts = await db
              .select({
                purchaseOrderId: poLineItems.poId,
                count: sql`count(*)`,
              })
              .from(poLineItems)
              .where(inArray(poLineItems.poId, poIds))
              .groupBy(poLineItems.poId);

            // Map PO counts to containers
            const poCountMap = new Map(
              lineItemCounts.filter((l) => l.purchaseOrderId != null).map((l) => [l.purchaseOrderId, Number(l.count)])
            );
            for (const po of posByContainer) {
              const containerId = po.containerId as number;
              containerItemCounts[containerId] =
                (containerItemCounts[containerId] || 0) + (poCountMap.get(po.poId) || 0);
            }
          }
        }

        containers.forEach((c) => {
          const enrichedContainer = {
            ...c,
            companyName: companyMap.get(c.companyId)?.name || "Unknown",
            companyCode: companyMap.get(c.companyId)?.code || "",
            supplierName: supplierMap.get(c.supplierId)?.legalName || "Unknown",
            itemCount: containerItemCounts[c.id] || 0,
          };
          if (c.status === "OFFLOADED") {
            offloadedContainers.push(enrichedContainer);
          } else if (c.status === "OTW") {
            otwContainers.push(enrichedContainer);
          }
        });
      }

      // Fetch agent ledger account balances from all companies
      const agentBalances: Record<string, number> = {};
      const uniqueAgents = new Set<string>();
      otwContainers.forEach((c) => {
        if (c.agent) uniqueAgents.add(c.agent);
      });

      // For each company, get ledger accounts and calculate balances for agents
      for (const companyId of companyIds) {
        const ledgerAccounts = await storage.getAllLedgerAccounts(companyId);
        for (const agent of Array.from(uniqueAgents)) {
          // Match agent name to ledger account (case-insensitive, partial match)
          const agentAccount = ledgerAccounts.find(
            (acc) =>
              (acc.name || "").toLowerCase().includes((agent || "").toLowerCase()) ||
              (agent || "").toLowerCase().includes((acc.name || "").toLowerCase())
          );
          if (agentAccount) {
            // Calculate balance from voucher entries
            const entries = await db
              .select({
                debitAmount: voucherEntries.debitAmount,
                creditAmount: voucherEntries.creditAmount,
              })
              .from(voucherEntries)
              .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
              .where(
                and(
                  eq(voucherEntries.ledgerAccountId, agentAccount.id),
                  eq(vouchers.companyId, companyId),
                  eq(vouchers.optional, false)
                )
              );

            let balance = parseFloat(agentAccount.openingBalance || "0");
            if (agentAccount.openingBalanceSide === "Cr") balance = -balance;

            for (const entry of entries) {
              balance += parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
            }

            agentBalances[agent] = (agentBalances[agent] || 0) + balance;
          }
        }
      }

      // Group OTW containers by shopName (route)
      const byRoute: Record<string, any[]> = {};
      const byAgent: Record<
        string,
        { containers: any[]; offloadedContainers: any[]; total: number; offloadedTotal: number; balance: number }
      > = {};
      const byLocation: Record<string, { count: number; total: number }> = {};

      let totalAmount = 0;

      // First, group offloaded containers by agent
      for (const container of offloadedContainers) {
        const agent = container.agent || "Unassigned";
        if (!byAgent[agent])
          byAgent[agent] = {
            containers: [],
            offloadedContainers: [],
            total: 0,
            offloadedTotal: 0,
            balance: agentBalances[agent] || 0,
          };
        byAgent[agent].offloadedContainers.push(container);
        byAgent[agent].offloadedTotal += parseFloat(container.dutyFee || "0");
      }

      for (const container of otwContainers) {
        // For Statement of Accounts (byAgent), only include OTW containers with plate numbers
        const hasPlate = container.numberPlate && container.numberPlate.trim() !== "";
        const route = container.shopName || "Unassigned";
        const agent = container.agent || "Unassigned";
        const location = container.trackingLocation || "Unknown";
        const amount = parseFloat(container.grandTotal || "0");

        // Group by route
        if (!byRoute[route]) byRoute[route] = [];
        byRoute[route].push(container);

        // Group by agent with balance - only for containers with plate numbers
        if (hasPlate) {
          if (!byAgent[agent])
            byAgent[agent] = {
              containers: [],
              offloadedContainers: [],
              total: 0,
              offloadedTotal: 0,
              balance: agentBalances[agent] || 0,
            };
          byAgent[agent].containers.push(container);
          byAgent[agent].total += amount;
        }

        // Group by location
        if (!byLocation[location]) byLocation[location] = { count: 0, total: 0 };
        byLocation[location].count++;
        byLocation[location].total += amount;

        totalAmount += amount;
      }

      // Group by transporter (both OTW and offloaded)
      const byTransporter: Record<string, { otw: any[]; offloaded: any[]; otwTotal: number; offloadedTotal: number }> =
        {};

      for (const container of otwContainers) {
        // For Statement of Accounts (byAgent), only include OTW containers with plate numbers
        const hasPlate = container.numberPlate && container.numberPlate.trim() !== "";
        const transporter = container.transporter || "Unassigned";
        if (!byTransporter[transporter]) {
          byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
        }
        byTransporter[transporter].otw.push(container);
        byTransporter[transporter].otwTotal += parseFloat(container.transportFee || "0");
      }

      for (const container of offloadedContainers) {
        const transporter = container.transporter || "Unassigned";
        if (!byTransporter[transporter]) {
          byTransporter[transporter] = { otw: [], offloaded: [], otwTotal: 0, offloadedTotal: 0 };
        }
        byTransporter[transporter].offloaded.push(container);
        byTransporter[transporter].offloadedTotal += parseFloat(container.transportFee || "0");
      }

      // Calculate total items from container itemCounts
      const totalItems = otwContainers.reduce((sum, c) => sum + (c.itemCount || 0), 0);

      res.json({
        containers: otwContainers,
        byRoute,
        byAgent,
        byLocation,
        byTransporter,
        totals: { count: otwContainers.length, amount: totalAmount, totalItems },
      });
    } catch (error: any) {
      logger.error("Dashboard container tracking error:", { error: error });
      res.status(500).json({ message: error.message });
    }
  });

  registerDashboardAccountRoutes(app);
}
