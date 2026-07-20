import type { Express } from "express";
import { db, pool } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
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
  dashboardCashAccounts,
  dashboardPayableAccounts,
  dashboardAccountSelections,
  insertDashboardCashAccountSchema,
  insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
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

export function registerNetProfitExcelRoute(app: Express) {
  app.get("/api/reports/net-profit-excel", requireAuth, async (req, res) => {
    try {
      const role = req.user?.role;
      const isAdminOrDev = role === "Admin" || role === "Developer";
      const requestedCompanyId = req.query.companyId ? parseInt(req.query.companyId as string) : null;
      const companyId = isAdminOrDev && requestedCompanyId ? requestedCompanyId : req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCompanies = await storage.getAllCompanies();
      const company = allCompanies.find((c: any) => c.id === companyId);
      const companyName = company?.name || "Company";

      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;
      const periodLabel = (req.query.periodLabel as string) || "All Time";

      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true);

      // Fetch period vouchers WITH their dates for monthly grouping
      const voucherConditions: any[] = [
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
      ];
      if (startDate) voucherConditions.push(gte(vouchers.voucherDate, startDate.toISOString().split("T")[0]));
      if (endDate) voucherConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));

      const allPeriodVouchers = await db
        .select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
        .from(vouchers)
        .where(and(...voucherConditions))
        .execute();

      // Group voucher IDs by YYYY-MM
      const vouchersByMonth = new Map<string, number[]>();
      for (const v of allPeriodVouchers) {
        const d = new Date(v.voucherDate);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!vouchersByMonth.has(mk)) vouchersByMonth.set(mk, []);
        vouchersByMonth.get(mk)!.push(v.id);
      }
      const sortedMonths = Array.from(vouchersByMonth.keys()).sort();

      // Fetch ALL entries for ALL period vouchers at once.
      // COALESCE(base_debit_amount, debit_amount): uses historical USD base when available.
      const allPeriodVoucherIds = allPeriodVouchers.map((v) => v.id);
      const allPeriodEntries =
        allPeriodVoucherIds.length > 0
          ? await db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                voucherId: voucherEntries.voucherId,
                debitAmount: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
                creditAmount: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
              })
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, allPeriodVoucherIds))
              .execute()
          : [];

      // Map entries by voucherId for fast monthly lookup
      const entriesByVoucherId = new Map<number, any[]>();
      for (const e of allPeriodEntries) {
        if (!entriesByVoucherId.has(e.voucherId)) entriesByVoucherId.set(e.voucherId, []);
        entriesByVoucherId.get(e.voucherId)!.push(e);
      }

      // Fetch ALL sales with dates for the period
      const salesConditions: any[] = [
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
      ];
      if (startDate) salesConditions.push(gte(vouchers.voucherDate, startDate.toISOString().split("T")[0]));
      if (endDate) salesConditions.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      const allSalesRows = await db
        .select({ voucherDate: vouchers.voucherDate, total: salesItems.totalSales })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...salesConditions))
        .execute();

      // Group POS sales by month
      const salesByMonth = new Map<string, number>();
      let totalSalesAll = 0;
      for (const s of allSalesRows) {
        const d = new Date(s.voucherDate);
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const v = parseFloat(s.total || "0");
        salesByMonth.set(mk, (salesByMonth.get(mk) || 0) + v);
        totalSalesAll += v;
      }

      // ERP voucher-based income: income accounts excluded from directIncomes/indirectIncomes
      // (SALES-named accounts and uncategorized income) that appear in non-POS vouchers.
      const xlsxMissedIncomeAccounts = companyAccounts.filter((acc: any) => {
        if (acc.accountType !== "Income") return false;
        if (acc.subType === "Indirect Income") return false;
        if (
          acc.subType === "Direct Income" &&
          !acc.code?.includes("SALES") &&
          !acc.name?.toLowerCase().includes("sales")
        )
          return false;
        return true;
      });
      // Re-fetch pos voucher IDs for the period to exclude from ERP income calculation
      const posPeriodVouchersXlsx =
        allPeriodVoucherIds.length > 0 && xlsxMissedIncomeAccounts.length > 0
          ? await db
              .select({ voucherId: salesItems.voucherId })
              .from(salesItems)
              .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
              .where(and(...salesConditions))
              .execute()
          : [];
      const posVIdSetXlsx = new Set(posPeriodVouchersXlsx.map((r) => r.voucherId));
      const nonPosVIdsXlsx = allPeriodVoucherIds.filter((id) => !posVIdSetXlsx.has(id));

      // Map voucherId → voucherDate for nonPosVouchers
      const voucherDateMap = new Map<number, string>();
      for (const v of allPeriodVouchers) voucherDateMap.set(v.id, v.voucherDate as string);

      if (xlsxMissedIncomeAccounts.length > 0 && nonPosVIdsXlsx.length > 0) {
        const missedAccIdsXlsx = xlsxMissedIncomeAccounts.map((a: any) => a.id);
        const erpIncEntries = await db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            voucherId: voucherEntries.voucherId,
            debitAmount: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
            creditAmount: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
          })
          .from(voucherEntries)
          .where(
            and(
              inArray(voucherEntries.voucherId, nonPosVIdsXlsx),
              inArray(voucherEntries.ledgerAccountId, missedAccIdsXlsx)
            )
          )
          .execute();
        for (const e of erpIncEntries) {
          const credit = parseFloat(e.creditAmount || "0");
          const debit = parseFloat(e.debitAmount || "0");
          const net = credit - debit;
          if (Math.abs(net) < 0.001) continue;
          const vDate = voucherDateMap.get(e.voucherId);
          if (!vDate) continue;
          const d = new Date(vDate);
          const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          salesByMonth.set(mk, (salesByMonth.get(mk) || 0) + net);
          totalSalesAll += net;
        }
      }

      // allTimeAccountBalances for Net Position (no startDate filter)
      const allTimeConds: any[] = [
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(vouchers.optional, false),
      ];
      if (endDate) allTimeConds.push(lte(vouchers.voucherDate, endDate.toISOString().split("T")[0]));
      const allTimeVsXlsx = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...allTimeConds))
        .execute();
      const allTimeIdsXlsx = allTimeVsXlsx.map((v) => v.id);
      const allTimeEntriesXlsx =
        allTimeIdsXlsx.length > 0
          ? await db
              .select({
                ledgerAccountId: voucherEntries.ledgerAccountId,
                debitAmount: sql<string>`COALESCE("voucher_entries"."base_debit_amount", "voucher_entries"."debit_amount")`,
                creditAmount: sql<string>`COALESCE("voucher_entries"."base_credit_amount", "voucher_entries"."credit_amount")`,
              })
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, allTimeIdsXlsx))
              .execute()
          : [];
      const allTimeBalsXlsx = new Map<number, { debit: number; credit: number }>();
      for (const e of allTimeEntriesXlsx) {
        if (e.ledgerAccountId) {
          const d = parseFloat(e.debitAmount || "0"),
            c = parseFloat(e.creditAmount || "0");
          const cur = allTimeBalsXlsx.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
          allTimeBalsXlsx.set(e.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
        }
      }

      // Opening Stock
      const allStockItems = await storage.getAllStockItems(companyId);
      let openingStockValue = 0;
      for (const item of allStockItems) openingStockValue += parseFloat((item as any).openingValue || "0");

      // Closing Stock (current inventory)
      const activeLocData = await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
        .execute();
      const activeLocIds = activeLocData.map((l) => l.id);
      let closingStockValue = 0;
      if (activeLocIds.length > 0) {
        const invData = await db
          .select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
          .from(inventory)
          .where(inArray(inventory.locationId, activeLocIds))
          .execute();
        for (const inv of invData)
          closingStockValue += parseFloat(inv.quantity || "0") * parseFloat(inv.averageRate || "0");
      }

      // Net Position - same calculation as dashboard (/api/stats/net-profit)
      const npRound2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // Build supplier balance map from all-time entries
      const xlsxSupplierBals = new Map<number, { debit: number; credit: number }>();
      for (const e of allTimeEntriesXlsx) {
        if ((e as any).supplierId) {
          const d = parseFloat((e as any).debitAmount || "0"),
            c = parseFloat((e as any).creditAmount || "0");
          const cur = xlsxSupplierBals.get((e as any).supplierId) || { debit: 0, credit: 0 };
          xlsxSupplierBals.set((e as any).supplierId, { debit: cur.debit + d, credit: cur.credit + c });
        }
      }

      // Account exclusion rules matching dashboard
      const npExcludedTypes = ["Income", "Profit", "Equity", "EQUITY", "Fixed Asset"];
      const npExpenseTypes = ["Expense", "Direct Expense", "Indirect Expense"];
      const npLiabilityTypes = ["Liability", "Duty Agent", "Transporter Agent", "Loan"];
      const npAssetTypes = ["Asset", "Current Asset", "Fixed Asset", "Bank", "Cash"];
      const npStockPatterns = [
        "closing stock",
        "opening stock",
        "stock in hand",
        "stock on hand",
        "inventory",
        "stock account",
        "goods in stock",
        "merchandise",
      ];
      const npStockCodes = ["CLOSING_STOCK", "OPENING_STOCK", "STOCK", "INVENTORY", "STOCK_IN_HAND"];
      const npFixedAssetNames = [
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
      const isExcludedFromNp = (acc: any) => {
        if (npExcludedTypes.includes(acc.accountType || "")) return true;
        if (acc.code === "PRODUCTION_ADJUSTMENT" || acc.code === "CONSUMPTION_EXPENSE") return true;
        const nameLower = (acc.name || "").toLowerCase();
        const codeLower = (acc.code || "").toLowerCase();
        if (npAssetTypes.includes(acc.accountType || "")) {
          if (npStockPatterns.some((p: string) => nameLower.includes(p))) return true;
          if (
            npStockCodes.some(
              (c: string) => codeLower === c.toLowerCase() || codeLower.startsWith(c.toLowerCase() + "_")
            )
          )
            return true;
          if (npFixedAssetNames.some((p: string) => nameLower.includes(p))) return true;
        }
        return false;
      };

      // CFA revaluation: Cash accounts hold physical CFA units — their USD worth changes with the rate.
      const xlsxCfaRateRows = await db
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
      const xlsxCurrentCfaRate = xlsxCfaRateRows.length > 0 ? parseFloat(xlsxCfaRateRows[0].rate) : 0;

      let npForUs = 0,
        npOnUs = 0;
      for (const acc of companyAccounts) {
        if (npExpenseTypes.includes(acc.accountType || "")) continue;
        if (acc.accountType === "Income") continue;
        if (isExcludedFromNp(acc)) continue;
        const opening = parseFloat((acc as any).openingBalance || "0");
        const openingSigned = (acc as any).openingBalanceSide === "Dr" ? opening : -opening;
        const bal = allTimeBalsXlsx.get(acc.id) || { debit: 0, credit: 0 };
        let net = openingSigned + bal.debit - bal.credit;
        // Revalue Cash accounts: amounts are in CFA, divide by current rate to get USD
        if (xlsxCurrentCfaRate > 0 && acc.accountType === "Cash") {
          net = net / xlsxCurrentCfaRate;
        }
        if (net > 0) npForUs += net;
        else if (net < 0) npOnUs += Math.abs(net);
      }

      // For All Time (no endDate): include inventory, workers, OTW — current values match the dashboard.
      // For specific periods (endDate set): skip these non-date-bounded components.
      const xlsxIsAllTime = !endDate;
      if (xlsxIsAllTime) {
        // Add stock on floor (inventory) as asset
        npForUs += closingStockValue;

        // Add worker/employee liabilities
        const xlsxEmployees = await db
          .select()
          .from(employees)
          .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
          .execute();
        let xlsxWorkerBal = 0;
        for (const emp of xlsxEmployees) xlsxWorkerBal += parseFloat((emp as any).currentBalance || "0");
        if (xlsxWorkerBal > 0) npOnUs += xlsxWorkerBal;
        else if (xlsxWorkerBal < 0) npForUs += Math.abs(xlsxWorkerBal);

        // Add OTW containers as assets
        const xlsxOtwContainers = await db
          .select()
          .from(containers)
          .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")))
          .execute();
        for (const c of xlsxOtwContainers) {
          npForUs += parseFloat((c as any).grandTotal || (c as any).itemsTotal || "0");
        }
      }

      // Add suppliers (always included — xlsxSupplierBals is already bounded by endDate)
      const xlsxParentCompanyId = await storage.getParentCompanyId();
      const xlsxShouldIncludeSuppliers = xlsxParentCompanyId === null || companyId === xlsxParentCompanyId;
      if (xlsxShouldIncludeSuppliers) {
        const xlsxAllSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
        for (const sup of xlsxAllSuppliers) {
          const balance = xlsxSupplierBals.get((sup as any).id);
          if (balance) {
            const opening = parseFloat((sup as any).openingBalance || "0");
            const netBalance = opening + balance.credit - balance.debit;
            if (netBalance > 0) npOnUs += netBalance;
            else if (netBalance < 0) npForUs += Math.abs(netBalance);
          }
        }
      }

      const netPositionValue = npRound2(npForUs - npOnUs);

      // Import charges IDs
      const importChargesParent = companyAccounts.find((acc: any) => acc.code === "IMPORT_CHARGES");
      const importChargesIds = new Set<number>();
      if (importChargesParent) {
        importChargesIds.add((importChargesParent as any).id);
        companyAccounts.forEach((acc: any) => {
          if (acc.parentId === (importChargesParent as any).id) importChargesIds.add(acc.id);
        });
      }

      const fmt = (n: number) => parseFloat(n.toFixed(2));

      function computeBalancesFromEntries(entries: any[]): Map<number, { debit: number; credit: number }> {
        const bal = new Map<number, { debit: number; credit: number }>();
        for (const e of entries) {
          if (e.ledgerAccountId) {
            const d = parseFloat(e.debitAmount || "0"),
              c = parseFloat(e.creditAmount || "0");
            const cur = bal.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
            bal.set(e.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
          }
        }
        return bal;
      }

      function computeStats(
        balances: Map<number, { debit: number; credit: number }>,
        salesTotal: number,
        openingSt: number,
        closingSt: number,
        monthlyMode = false
      ) {
        // Direct Incomes (non-sales income accounts)
        const directIncAccounts = companyAccounts.filter(
          (acc: any) =>
            acc.accountType === "Income" &&
            acc.subType === "Direct Income" &&
            !acc.code?.includes("SALES") &&
            !acc.name?.toLowerCase().includes("sales")
        );
        let directIncTotal = 0;
        const directIncDetails = directIncAccounts
          .map((acc: any) => {
            const b = balances.get(acc.id) || { debit: 0, credit: 0 };
            const net = b.credit - b.debit;
            directIncTotal += net;
            return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
          })
          .filter((r: any) => r.debit !== 0 || r.credit !== 0);

        const totalIncome = salesTotal + directIncTotal;

        // Purchases
        const purchaseAccounts = companyAccounts.filter(
          (acc: any) => acc.code === "PURCHASES" || acc.code?.startsWith("PURCHASES-")
        );
        let purchaseTotal = 0;
        const purchaseDetails = purchaseAccounts
          .map((acc: any) => {
            const b = balances.get(acc.id) || { debit: 0, credit: 0 };
            const net = b.debit - b.credit;
            purchaseTotal += net;
            return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
          })
          .filter((r: any) => r.debit !== 0 || r.credit !== 0);

        // Direct Expenses
        const directExpAccounts = companyAccounts.filter(
          (acc: any) =>
            acc.code !== "PURCHASES" &&
            !acc.code?.startsWith("PURCHASES") &&
            (acc.accountType === "Direct Expense" ||
              (acc.accountType === "Expense" && acc.subType === "Direct Expense") ||
              importChargesIds.has(acc.id))
        );
        let directExpTotal = 0;
        const directExpDetails = directExpAccounts
          .map((acc: any) => {
            const b = balances.get(acc.id) || { debit: 0, credit: 0 };
            const net = b.debit - b.credit;
            directExpTotal += net;
            return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
          })
          .filter((r: any) => r.debit !== 0 || r.credit !== 0);

        // Indirect Expenses
        const indirectExpAccounts = companyAccounts.filter(
          (acc: any) =>
            acc.accountType === "Indirect Expense" &&
            acc.code !== "PRODUCTION_ADJUSTMENT" &&
            acc.code !== "CONSUMPTION_EXPENSE" &&
            acc.code !== "PURCHASES" &&
            !acc.code?.startsWith("PURCHASES")
        );
        let indirectExpTotal = 0;
        const indirectExpDetails = indirectExpAccounts
          .map((acc: any) => {
            const b = balances.get(acc.id) || { debit: 0, credit: 0 };
            const net = b.debit - b.credit;
            indirectExpTotal += net;
            return { id: acc.id, name: acc.name, debit: b.debit, credit: b.credit, balance: net };
          })
          .filter((r: any) => r.debit !== 0 || r.credit !== 0);

        // COGS: Opening + Purchases + Direct + Indirect - Closing (monthlyMode: no opening/closing)
        const totalCOGS = monthlyMode
          ? purchaseTotal + directExpTotal + indirectExpTotal
          : openingSt + purchaseTotal + directExpTotal + indirectExpTotal - closingSt;

        const grossProfit = totalIncome - totalCOGS;
        const netProfit = grossProfit;
        const grossMarginPct = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0;
        const netMarginPct = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

        return {
          salesTotal,
          directIncTotal,
          directIncDetails,
          totalIncome,
          purchaseTotal,
          purchaseDetails,
          directExpTotal,
          directExpDetails,
          indirectExpTotal,
          indirectExpDetails,
          openingSt,
          closingSt,
          totalCOGS,
          grossProfit,
          netProfit,
          grossMarginPct,
          netMarginPct,
          monthlyMode,
        };
      }

      function writeSheet(
        ws: any,
        stats: ReturnType<typeof computeStats>,
        sheetLabel: string,
        showNetPosition: boolean,
        npValue: number
      ) {
        const {
          salesTotal,
          directIncTotal,
          directIncDetails,
          totalIncome,
          purchaseTotal,
          purchaseDetails,
          directExpTotal,
          directExpDetails,
          indirectExpTotal,
          indirectExpDetails,
          openingSt,
          closingSt,
          totalCOGS,
          grossProfit,
          netProfit,
          grossMarginPct,
          netMarginPct,
          monthlyMode,
        } = stats;

        ws.properties.defaultColWidth = 20;

        // Title
        ws.mergeCells("A1:E1");
        const titleCell = ws.getCell("A1");
        titleCell.value = `Profit & Loss — ${companyName}`;
        titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(1).height = 36;

        ws.mergeCells("A2:E2");
        const subCell = ws.getCell("A2");
        subCell.value = `Period: ${sheetLabel}${monthlyMode ? "  |  COGS = Purchases + Direct + Indirect Expenses (no stock adjustment for individual months)" : ""}`;
        subCell.font = { italic: true, size: 11, color: { argb: "FF555555" } };
        subCell.alignment = { horizontal: "center" };
        ws.getRow(2).height = 22;
        ws.addRow([]);

        // KPI Summary block
        const kpiHdr = ws.addRow(["", "SUMMARY", "", "", ""]);
        kpiHdr.getCell(2).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
        kpiHdr.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        ws.mergeCells(`B${kpiHdr.number}:E${kpiHdr.number}`);

        const kpiRows: [string, string | number, boolean][] = [
          ["Total Income (Sales + Direct Inc)", fmt(totalIncome), false],
          ["Total COGS", fmt(totalCOGS), false],
          ["Gross Profit", fmt(grossProfit), true],
          ["Net Profit", fmt(netProfit), true],
          ["Gross Margin %", grossMarginPct.toFixed(1) + "%", false],
          ["Net Margin %", netMarginPct.toFixed(1) + "%", false],
        ];

        for (const [label, value, isBold] of kpiRows) {
          const row = ws.addRow(["", label, "", "", value]);
          const numVal = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ""));
          const profColor = numVal >= 0 ? "FF16A34A" : "FFDC2626";
          row.getCell(2).font = { bold: isBold };
          row.getCell(5).font = { bold: isBold, color: { argb: isBold ? profColor : "FF374151" } };
          if (typeof value === "number" || !String(value).includes("%")) row.getCell(5).numFmt = "$#,##0.##";
          ws.mergeCells(`B${row.number}:D${row.number}`);
          if (isBold) {
            row.eachCell((cell: any) => {
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: numVal >= 0 ? "FFD1FAE5" : "FFFEE2E2" },
              };
            });
            row.getCell(2).font = { bold: true };
            row.getCell(5).font = { bold: true, color: { argb: profColor } };
          }
        }
        ws.addRow([]);

        // Helper: section header row
        const secHeader = (title: string, color: string) => {
          const hRow = ws.addRow([title, "Account", "Debit", "Credit", "Net"]);
          hRow.eachCell((cell: any, col: number) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
            cell.alignment = { horizontal: col <= 2 ? "left" : "right" };
          });
        };

        // Helper: account detail rows
        const addAccRows = (rows: any[]) => {
          if (rows.length === 0) {
            const empty = ws.addRow(["", "(none)", "", "", ""]);
            empty.getCell(2).font = { italic: true, color: { argb: "FF888888" } };
            return;
          }
          for (const r of rows) {
            const dr = ws.addRow(["", r.name, fmt(r.debit), fmt(r.credit), fmt(r.balance)]);
            dr.getCell(3).numFmt = "$#,##0";
            dr.getCell(4).numFmt = "$#,##0";
            dr.getCell(5).numFmt = "$#,##0";
            dr.getCell(5).font = { color: { argb: r.balance >= 0 ? "FF16A34A" : "FFDC2626" } };
          }
        };

        // Helper: subtotal row
        const subTot = (label: string, value: number) => {
          const r = ws.addRow(["", label, "", "", fmt(value)]);
          r.eachCell((cell: any) => {
            cell.font = { bold: true };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
          });
          r.getCell(5).numFmt = "$#,##0";
          r.getCell(5).font = { bold: true, color: { argb: value >= 0 ? "FF16A34A" : "FFDC2626" } };
          ws.addRow([]);
        };

        // === INCOME SECTION ===
        secHeader("INCOME", "FF1E3A5F");
        // Sales row
        const salesRow = ws.addRow(["", "Total Sales (POS & Revenue)", "", "", fmt(salesTotal)]);
        salesRow.getCell(5).numFmt = "$#,##0";
        salesRow.getCell(5).font = { color: { argb: "FF16A34A" } };
        // Direct Incomes
        if (directIncDetails.length > 0) {
          const diHdr = ws.addRow(["", "— Direct Incomes", "", "", ""]);
          diHdr.getCell(2).font = { italic: true, color: { argb: "FF555555" } };
          addAccRows(directIncDetails);
        }
        subTot("Total Income", totalIncome);

        // === COST OF GOODS SOLD ===
        secHeader("COST OF GOODS SOLD (COGS)", "FFDC2626");
        if (!monthlyMode && openingSt > 0) {
          const osRow = ws.addRow(["", "Opening Stock", "", "", fmt(openingSt)]);
          osRow.getCell(5).numFmt = "$#,##0";
          osRow.getCell(5).font = { color: { argb: "FFDC2626" } };
        }

        // Purchases sub-section
        const pHdr = ws.addRow(["", "— Purchases", "", "", ""]);
        pHdr.getCell(2).font = { italic: true, bold: true, color: { argb: "FFDC2626" } };
        addAccRows(purchaseDetails);
        const pTotRow = ws.addRow(["", "Total Purchases", "", "", fmt(purchaseTotal)]);
        pTotRow.getCell(2).font = { bold: true };
        pTotRow.getCell(5).numFmt = "$#,##0";
        pTotRow.getCell(5).font = { bold: true, color: { argb: "FFDC2626" } };

        // Direct Expenses sub-section
        const deHdr = ws.addRow(["", "— Direct Expenses", "", "", ""]);
        deHdr.getCell(2).font = { italic: true, bold: true, color: { argb: "FFB45309" } };
        addAccRows(directExpDetails);
        const deTotRow = ws.addRow(["", "Total Direct Expenses", "", "", fmt(directExpTotal)]);
        deTotRow.getCell(2).font = { bold: true };
        deTotRow.getCell(5).numFmt = "$#,##0";
        deTotRow.getCell(5).font = { bold: true, color: { argb: "FFDC2626" } };

        // Indirect Expenses sub-section
        const ieHdr = ws.addRow(["", "— Indirect Expenses", "", "", ""]);
        ieHdr.getCell(2).font = { italic: true, bold: true, color: { argb: "FF7C3AED" } };
        addAccRows(indirectExpDetails);
        const ieTotRow = ws.addRow(["", "Total Indirect Expenses", "", "", fmt(indirectExpTotal)]);
        ieTotRow.getCell(2).font = { bold: true };
        ieTotRow.getCell(5).numFmt = "$#,##0";
        ieTotRow.getCell(5).font = { bold: true, color: { argb: "FFDC2626" } };

        if (!monthlyMode && closingSt > 0) {
          const csRow = ws.addRow(["", "Less: Closing Stock", "", "", fmt(-closingSt)]);
          csRow.getCell(5).numFmt = "$#,##0";
          csRow.getCell(5).font = { color: { argb: "FF16A34A" } };
        }

        // COGS total
        const cogsRow = ws.addRow(["TOTAL COGS", "", "", "", fmt(totalCOGS)]);
        cogsRow.eachCell((cell: any) => {
          cell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
          cell.alignment = { horizontal: "center" };
        });
        cogsRow.getCell(5).numFmt = "$#,##0.##";
        ws.mergeCells(`A${cogsRow.number}:D${cogsRow.number}`);
        ws.getRow(cogsRow.number).height = 24;
        ws.addRow([]);

        // GROSS PROFIT
        const gpRow = ws.addRow(["GROSS PROFIT", "", "", "", fmt(grossProfit)]);
        gpRow.eachCell((cell: any) => {
          cell.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: grossProfit >= 0 ? "FF059669" : "FFDC2626" },
          };
          cell.alignment = { horizontal: "center" };
        });
        gpRow.getCell(5).numFmt = "$#,##0.##";
        ws.mergeCells(`A${gpRow.number}:D${gpRow.number}`);
        ws.getRow(gpRow.number).height = 28;

        // NET PROFIT (= Gross Profit since all expenses are in COGS)
        const npRow = ws.addRow(["NET PROFIT", "", "", "", fmt(netProfit)]);
        npRow.eachCell((cell: any) => {
          cell.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: netProfit >= 0 ? "FF2563EB" : "FFDC2626" },
          };
          cell.alignment = { horizontal: "center" };
        });
        npRow.getCell(5).numFmt = "$#,##0.##";
        ws.mergeCells(`A${npRow.number}:D${npRow.number}`);
        ws.getRow(npRow.number).height = 28;
        ws.addRow([]);

        // RATIOS
        const ratioHdr = ws.addRow(["RATIOS", "", "", "", ""]);
        ratioHdr.getCell(1).font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        ratioHdr.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5563" } };

        const gmRow = ws.addRow(["", "Gross Margin %", "", "", grossMarginPct.toFixed(2) + "%"]);
        gmRow.getCell(2).font = { bold: false };
        gmRow.getCell(5).font = { bold: true };
        ws.mergeCells(`B${gmRow.number}:D${gmRow.number}`);

        const nmRow = ws.addRow(["", "Net Margin %", "", "", netMarginPct.toFixed(2) + "%"]);
        nmRow.getCell(2).font = { bold: false };
        nmRow.getCell(5).font = { bold: true };
        ws.mergeCells(`B${nmRow.number}:D${nmRow.number}`);

        ws.getColumn(1).width = 28;
        ws.getColumn(2).width = 38;
        ws.getColumn(3).width = 16;
        ws.getColumn(4).width = 16;
        ws.getColumn(5).width = 16;
      }

      function writeSummarySheet(
        ws: any,
        monthStatsList: ReturnType<typeof computeStats>[],
        totalStats: ReturnType<typeof computeStats>,
        monthLabels: string[],
        npValue: number
      ) {
        const numMonths = monthLabels.length;
        const totalCol = numMonths + 2; // col B = month1, ..., last month col = B+numMonths-1, total = B+numMonths

        ws.properties.defaultColWidth = 16;

        // Title
        ws.mergeCells(1, 1, 1, totalCol);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = `P&L Summary — ${companyName}`;
        titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
        titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        titleCell.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(1).height = 36;

        // Header row: [blank] | Month1 | Month2 | ... | TOTAL
        const hdrRowData: any[] = [""];
        for (const ml of monthLabels) hdrRowData.push(ml);
        hdrRowData.push("TOTAL");
        const hdrRow = ws.addRow(hdrRowData);
        hdrRow.eachCell((cell: any, col: number) => {
          if (col === 1) return;
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: col === totalCol ? "FF1E3A5F" : "FF374151" },
          };
          cell.alignment = { horizontal: "right" };
        });
        ws.getRow(2).height = 22;

        // Helper: write a data row
        const numFmt = "$#,##0";
        const pctFmt = "0.00%";

        const writeRow = (
          label: string,
          monthVals: number[],
          totalVal: number,
          opts: {
            bold?: boolean;
            highlight?: boolean;
            colorize?: boolean;
            pct?: boolean;
            labelColor?: string;
            indent?: boolean;
          } = {}
        ) => {
          const rowData: any[] = [opts.indent ? "  " + label : label];
          for (const v of monthVals) rowData.push(opts.pct ? v / 100 : fmt(v));
          rowData.push(opts.pct ? fmt(totalVal) / 100 : fmt(totalVal));
          const row = ws.addRow(rowData);
          if (opts.bold) row.getCell(1).font = { bold: true };
          if (opts.labelColor) row.getCell(1).font = { bold: opts.bold, color: { argb: opts.labelColor } };

          for (let c = 2; c <= totalCol; c++) {
            const cell = row.getCell(c);
            const val = c === totalCol ? totalVal : monthVals[c - 2];
            cell.numFmt = opts.pct ? "0.00%" : numFmt;
            if (opts.bold) cell.font = { bold: true };
            if (opts.colorize) cell.font = { bold: opts.bold, color: { argb: val >= 0 ? "FF16A34A" : "FFDC2626" } };
            if (opts.highlight)
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: val >= 0 ? "FFD1FAE5" : "FFFEE2E2" } };
          }
          return row;
        };

        const writeSectionHdr = (label: string, color: string) => {
          const rowData: any[] = [label];
          for (let i = 0; i <= numMonths; i++) rowData.push("");
          const row = ws.addRow(rowData);
          row.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
          });
          ws.mergeCells(row.number, 1, row.number, totalCol);
          ws.getRow(row.number).height = 20;
        };

        const blankRow = () => ws.addRow(Array(totalCol).fill(""));

        // === INCOME ===
        writeSectionHdr("INCOME", "FF1E3A5F");
        writeRow(
          "Sales Revenue",
          monthStatsList.map((s) => s.salesTotal),
          totalStats.salesTotal,
          { colorize: true }
        );
        writeRow(
          "Direct Incomes",
          monthStatsList.map((s) => s.directIncTotal),
          totalStats.directIncTotal,
          { colorize: true }
        );
        writeRow(
          "TOTAL INCOME",
          monthStatsList.map((s) => s.totalIncome),
          totalStats.totalIncome,
          { bold: true, colorize: true, highlight: true }
        );
        blankRow();

        // === COGS ===
        writeSectionHdr("COST OF GOODS SOLD (COGS)", "FFDC2626");
        // Opening Stock: only show in total column (not per-month)
        {
          const rowData: any[] = ["Opening Stock"];
          for (let i = 0; i < numMonths; i++) rowData.push("—");
          rowData.push(fmt(totalStats.openingSt));
          const row = ws.addRow(rowData);
          row.getCell(1).font = { italic: true };
          row.getCell(totalCol).numFmt = numFmt;
          row.getCell(totalCol).font = { color: { argb: "FFDC2626" } };
        }
        writeRow(
          "Purchases",
          monthStatsList.map((s) => s.purchaseTotal),
          totalStats.purchaseTotal,
          { colorize: true, indent: true }
        );
        writeRow(
          "Direct Expenses",
          monthStatsList.map((s) => s.directExpTotal),
          totalStats.directExpTotal,
          { colorize: true, indent: true }
        );
        writeRow(
          "Indirect Expenses",
          monthStatsList.map((s) => s.indirectExpTotal),
          totalStats.indirectExpTotal,
          { colorize: true, indent: true }
        );
        // Closing Stock: only show in total column (negative, reduces COGS)
        {
          const rowData: any[] = ["Less: Closing Stock"];
          for (let i = 0; i < numMonths; i++) rowData.push("—");
          rowData.push(fmt(-totalStats.closingSt));
          const row = ws.addRow(rowData);
          row.getCell(1).font = { italic: true };
          row.getCell(totalCol).numFmt = numFmt;
          row.getCell(totalCol).font = { color: { argb: "FF16A34A" } };
        }
        writeRow(
          "TOTAL COGS",
          monthStatsList.map((s) => s.totalCOGS),
          totalStats.totalCOGS,
          { bold: true, colorize: true, highlight: true }
        );
        blankRow();

        // === GROSS PROFIT ===
        writeSectionHdr("GROSS PROFIT", "FF059669");
        writeRow(
          "Gross Profit",
          monthStatsList.map((s) => s.grossProfit),
          totalStats.grossProfit,
          { bold: true, colorize: true, highlight: true }
        );
        blankRow();

        // === NET PROFIT ===
        writeSectionHdr("NET PROFIT", "FF2563EB");
        writeRow(
          "Net Profit",
          monthStatsList.map((s) => s.netProfit),
          totalStats.netProfit,
          { bold: true, colorize: true, highlight: true }
        );
        blankRow();

        // === RATIOS ===
        writeSectionHdr("RATIOS", "FF4B5563");
        writeRow(
          "Gross Margin %",
          monthStatsList.map((s) => s.grossMarginPct),
          totalStats.grossMarginPct,
          { pct: true }
        );
        writeRow(
          "Net Margin %",
          monthStatsList.map((s) => s.netMarginPct),
          totalStats.netMarginPct,
          { pct: true }
        );
        blankRow();

        // Column widths
        ws.getColumn(1).width = 36;
        for (let c = 2; c <= totalCol; c++) ws.getColumn(c).width = 14;
      }

      function fmtMonthLabel(mk: string) {
        const [yr, mo] = mk.split("-");
        const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${names[parseInt(mo) - 1]} ${yr}`;
      }

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.default.Workbook();
      workbook.creator = "ERP System";
      workbook.created = new Date();

      if (sortedMonths.length > 1) {
        // Summary sheet first (one column per month + grand total)
        const allBalances = computeBalancesFromEntries(allPeriodEntries);
        const totalStats = computeStats(allBalances, totalSalesAll, openingStockValue, closingStockValue, false);
        const monthStatsList = sortedMonths.map((mk) => {
          const monthVIds = vouchersByMonth.get(mk)!;
          const monthEntries = monthVIds.flatMap((id) => entriesByVoucherId.get(id) || []);
          const monthBalances = computeBalancesFromEntries(monthEntries);
          const monthSales = salesByMonth.get(mk) || 0;
          return computeStats(monthBalances, monthSales, 0, 0, true);
        });
        const monthLabels = sortedMonths.map(fmtMonthLabel);

        const summaryWs = workbook.addWorksheet("Summary");
        writeSummarySheet(summaryWs, monthStatsList, totalStats, monthLabels, netPositionValue);

        // One detail sheet per month
        for (let i = 0; i < sortedMonths.length; i++) {
          const mk = sortedMonths[i];
          const ws = workbook.addWorksheet(fmtMonthLabel(mk));
          writeSheet(ws, monthStatsList[i], fmtMonthLabel(mk), false, 0);
        }
      } else {
        // Single sheet
        const allBalances = computeBalancesFromEntries(allPeriodEntries);
        const stats = computeStats(allBalances, totalSalesAll, openingStockValue, closingStockValue, false);
        const ws = workbook.addWorksheet("Net Profit Report");
        writeSheet(ws, stats, periodLabel, false, 0);
      }

      const safeCompanyName = companyName.replace(/[^a-z0-9]/gi, "_");
      const safePeriod = periodLabel.replace(/[^a-z0-9]/gi, "_");
      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      // Non-fatal audit write: must not corrupt the export response if it fails
      try {
        await logAudit({
          userId: req.session.userId!,
          username: (req.session as any).username || req.session.userId!,
          companyId: companyId!,
          action: "export",
          tableName: "reports",
          recordId: null,
          recordIdentifier: `Net Profit Excel — ${periodLabel}`,
          changes: { format: { old: null, new: "xlsx" } },
        });
      } catch (auditErr) {
        console.error("[NetProfitExcel] audit write failed:", auditErr);
      }
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="NetProfit_${safeCompanyName}_${safePeriod}.xlsx"`);
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      console.error("Net profit Excel export error:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  // ─── Agent Accounts ──────────────────────────────────────────────────────
}
