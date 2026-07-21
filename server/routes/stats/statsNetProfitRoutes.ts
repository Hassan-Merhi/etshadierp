import type { Express } from "express";
import { db, pool } from "../../db";
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

export function registerStatsNetProfitRoutes(app: Express) {
  app.get("/api/stats/net-profit", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Balance-sheet "as of" date — cumulative approach (everything up to toDate)
      // fromDate is accepted but intentionally ignored for balance-sheet accounts;
      // the balance sheet is always a point-in-time snapshot (as of toDate), not a period.
      const toDate = req.query.toDate ? String(req.query.toDate) : null;

      // Rounding helper — defined early so it is available throughout the handler
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // Fetch company to know its base currency (CFA vs USD)
      // Check the 30-second TTL cache before touching the DB
      const _cacheKey = `net-profit:${companyId}:${toDate || ""}`;
      const _cached = _getCached(_cacheKey);
      if (_cached) return res.json(_cached);

      // Build voucher conditions synchronously — no DB call needed
      const voucherConditions: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
      ];
      if (toDate) {
        voucherConditions.push(lte(vouchers.voucherDate, toDate));
      }

      // Program 6D optimization: replace the two large per-row entry materialisations
      // with three grouped-SQL queries.  This was validated by the Program 6D
      // reconciliation script (995/995 cases, max diff < 1e-9, zero semantic mismatches)
      // and by query-plan evidence showing 97-99% reduction in rows returned to the app.
      //
      // Three queries replace the original two:
      //   1. groupedLedgerRows   — SUM per ledger_account_id, scoped by ACCOUNT's companyId
      //      Preserves migrated-account attribution (rule 1+2).
      //   2. groupedSupplierRows — SUM per supplier_id with SQL CASE for pure-side filtering,
      //      scoped by VOUCHER's companyId.  Mixed debit+credit FX settlement rows
      //      contribute 0 to both sides (rules 3+4+5).
      //   3. groupedEmployeeRows — SUM per employee_id, scoped by VOUCHER's companyId (rule 3).
      //
      // pool.query is used (not db.select) to avoid the Drizzle ::cast-in-sql-template
      // issue documented in the project memory.
      const _entryParams = toDate ? [companyId, toDate] : [companyId];
      const _dateClause  = toDate ? "AND v.voucher_date <= $2" : "";

      const [companyRecord, companyAccounts, parentCompanyId,
             groupedLedgerRows, groupedSupplierRows, groupedEmployeeRows, hasMigratedResult] = await Promise.all([
        storage.getCompanyById(companyId),
        storage.getAllLedgerAccounts(companyId, true),
        storage.getParentCompanyId(),
        // 1. Ledger-account balances — account-company scoped (migrated-account rule)
        // COALESCE(base_debit_amount, debit_amount): uses historical USD base when available
        // (i.e. after backfill), falls back to debit_amount for legacy rows.
        pool.query<{ ledger_account_id: string; total_debit: string; total_credit: string }>(
          `SELECT ve.ledger_account_id,
                  SUM(COALESCE(ve.base_debit_amount,  ve.debit_amount)::numeric)  AS total_debit,
                  SUM(COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric) AS total_credit
           FROM voucher_entries ve
           JOIN vouchers        v  ON ve.voucher_id        = v.id
           JOIN ledger_accounts la ON ve.ledger_account_id = la.id
           WHERE la.company_id = $1
             AND v.optional    = false
             AND v.deleted_at IS NULL
             ${_dateClause}
           GROUP BY ve.ledger_account_id`,
          _entryParams,
        ),
        // 2. Supplier balances — voucher-company scoped, pure-side only (excludes mixed FX rows)
        pool.query<{ supplier_id: string; total_debit: string; total_credit: string }>(
          `SELECT ve.supplier_id,
                  SUM(CASE WHEN COALESCE(ve.base_debit_amount,  ve.debit_amount)::numeric  > 0
                                AND COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric = 0
                           THEN COALESCE(ve.base_debit_amount, ve.debit_amount)::numeric ELSE 0 END) AS total_debit,
                  SUM(CASE WHEN COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric > 0
                                AND COALESCE(ve.base_debit_amount,  ve.debit_amount)::numeric  = 0
                           THEN COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric ELSE 0 END) AS total_credit
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE v.company_id    = $1
             AND ve.supplier_id IS NOT NULL
             AND v.optional      = false
             AND v.deleted_at   IS NULL
             ${_dateClause}
           GROUP BY ve.supplier_id`,
          _entryParams,
        ),
        // 3. Employee balances — voucher-company scoped
        pool.query<{ employee_id: string; total_debit: string; total_credit: string }>(
          `SELECT ve.employee_id,
                  SUM(COALESCE(ve.base_debit_amount,  ve.debit_amount)::numeric)  AS total_debit,
                  SUM(COALESCE(ve.base_credit_amount, ve.credit_amount)::numeric) AS total_credit
           FROM voucher_entries ve
           JOIN vouchers v ON ve.voucher_id = v.id
           WHERE v.company_id    = $1
             AND ve.employee_id IS NOT NULL
             AND v.optional      = false
             AND v.deleted_at   IS NULL
             ${_dateClause}
           GROUP BY ve.employee_id`,
          _entryParams,
        ),
        // 7. Phase 6 guard: any entry with base_debit_amount set means COALESCE already
        //    returns the correct historical USD base — legacy CFA revaluation must NOT run
        //    or it will double-convert migrated amounts.
        pool.query<{ has_migrated: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM voucher_entries ve
             JOIN vouchers v ON ve.voucher_id = v.id
             WHERE v.company_id = $1
               AND ve.base_debit_amount IS NOT NULL
           ) AS has_migrated`,
          [companyId],
        ),
      ]);
      // true  → some entries have base_debit_amount → COALESCE returns USD base → skip legacy revaluation
      // false → all entries are pre-migration legacy → legacy CFA revaluation block applies
      const hasMigratedEntries = (hasMigratedResult as any).rows[0]?.has_migrated === true;
      const companyBaseCurrency = companyRecord?.baseCurrency || "USD";

      // Build accountBalances from grouped SQL result.
      // Account-company scoped: migrated accounts carry their full balance to the
      // destination company regardless of which company their vouchers belong to.
      const accountBalances = new Map<number, { debit: number; credit: number }>();
      for (const row of groupedLedgerRows.rows) {
        if (row.ledger_account_id) {
          accountBalances.set(Number(row.ledger_account_id), {
            debit:  parseFloat(row.total_debit  || "0"),
            credit: parseFloat(row.total_credit || "0"),
          });
        }
      }

      // Build supplierBalances from grouped SQL result.
      // Pure-side filtering is performed in SQL (CASE expressions above) so mixed
      // debit+credit FX settlement rows contribute 0 to both sides — matching the
      // /api/suppliers/stats logic and the original per-row application filter.
      const supplierBalances = new Map<number, { debit: number; credit: number }>();
      for (const row of groupedSupplierRows.rows) {
        if (row.supplier_id) {
          supplierBalances.set(Number(row.supplier_id), {
            debit:  parseFloat(row.total_debit  || "0"),
            credit: parseFloat(row.total_credit || "0"),
          });
        }
      }

      // Build employeeBalances from grouped SQL result (voucher-company scoped).
      const employeeBalances = new Map<number, { debit: number; credit: number }>();
      for (const row of groupedEmployeeRows.rows) {
        if (row.employee_id) {
          employeeBalances.set(Number(row.employee_id), {
            debit:  parseFloat(row.total_debit  || "0"),
            credit: parseFloat(row.total_credit || "0"),
          });
        }
      }

      // ============ NET POSITION CALCULATION ============
      // Uses shared helper (netPositionHelper.ts) – single source of truth for
      // the asset vs liability classification formula used by both ERP and Factory.

      // Parent company determines whether ERP supplier ledger accounts are included
      // (parentCompanyId already fetched in the parallel Promise.all above)
      const shouldIncludeSuppliers = parentCompanyId === null || companyId === parentCompanyId;

      // Build excluded-from-expenses set (needed for the P&L expense pass below)
      const importChargesParent = companyAccounts.find((acc) => acc.code === "IMPORT_CHARGES");
      const excludedFromExpenses = new Set<number>();
      if (importChargesParent) {
        excludedFromExpenses.add(importChargesParent.id);
        for (const acc of companyAccounts) {
          if (acc.parentId === importChargesParent.id) excludedFromExpenses.add(acc.id);
        }
      }
      for (const acc of companyAccounts) {
        if (
          acc.code === "PURCHASES" ||
          acc.code?.startsWith("PURCHASES_") ||
          acc.code === "PRODUCTION_ADJUSTMENT" ||
          acc.code === "CONSUMPTION_EXPENSE"
        ) {
          excludedFromExpenses.add(acc.id);
        }
      }

      // 1. Classify balance-sheet accounts (assets vs liabilities) via shared helper.
      // SP formula: What We Have = Cash + Stock (from inventory table); What We Owe = Supplier Cash Payable only.
      // All other SP ledger accounts (OTW, prepaid, intercompany, clearing accounts, etc.) are excluded.
      // For non-SP: exclude sp_stock (inventory table is authoritative) and sp_cost_clearing (double-counts).
      const isSupplierPartner = (companyRecord as any)?.companyType === "supplier_partner";
      const accountsForClassify = isSupplierPartner
        ? companyAccounts.filter((a: any) => a.accountType === "Cash" || a.subType === "sp_payable")
        : companyAccounts.filter((a: any) => a.subType !== "sp_stock" && a.subType !== "sp_cost_clearing");
      const classified = classifyNetPositionAccounts(accountsForClassify, accountBalances, {
        includeSupplierTypeAccounts: shouldIncludeSuppliers,
      });
      let forUsTotal = classified.forUsTotal;
      let onUsTotal = classified.onUsTotal;
      const forUsAccounts = classified.forUsAccounts;
      const onUsAccounts = classified.onUsAccounts;
      const categoryTotals = classified.categoryTotals;

      // Exclude ledger-based "Accrued Rent Payable" — the computed rentPayable
      // (expected − paid up to asOf) is always more accurate than the accrual-
      // scheduler-dependent ledger account. Strip it here before any totals are used.
      for (let i = onUsAccounts.length - 1; i >= 0; i--) {
        const a = onUsAccounts[i] as any;
        const nameLower = (a.name || "").toLowerCase();
        const code = (a.code || "").toUpperCase();
        if (nameLower.includes("accrued rent") || code === "ACCR-RENT-PAY" || code === "ACCRUED_RENT_PAYABLE") {
          onUsTotal = round2(onUsTotal - a.value);
          onUsAccounts.splice(i, 1);
        }
      }

      // Exclude ledger-based "Prepaid Rent" accounts — the rental-shops calculation
      // below (propertyContracts: paid − expected) is always the authoritative source
      // for prepaid rent. Keeping both would double-count it.
      for (let i = forUsAccounts.length - 1; i >= 0; i--) {
        const a = forUsAccounts[i] as any;
        const nameLower = (a.name || "").toLowerCase();
        if (nameLower.includes("prepaid rent")) {
          forUsTotal = round2(forUsTotal - a.value);
          // Subtract from whichever category bucket it landed in (typically "asset_Asset")
          const catKey = `asset_${a.category}`;
          if (categoryTotals[catKey] !== undefined) {
            categoryTotals[catKey] = round2(categoryTotals[catKey] - a.value);
            if (Math.abs(categoryTotals[catKey]) < 0.01) delete categoryTotals[catKey];
          }
          forUsAccounts.splice(i, 1);
        }
      }

      // CFA revaluation: Cash accounts hold physical CFA units whose USD worth changes with the rate.
      // Expenses, loans, receivables are locked at their historical CFA values — do NOT revalue them.
      // Only revalue if this company's base currency IS CFA (not a USD company that happens to have
      // a CFA exchange rate stored for reference/inter-company purposes).
      const cfaRateRows =
        companyBaseCurrency === "CFA"
          ? await db
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
              .limit(1)
          : [];
      const currentCfaRate = cfaRateRows.length > 0 ? parseFloat(cfaRateRows[0].rate) : 0;

      if (currentCfaRate > 0 && !hasMigratedEntries) {
        // Legacy CFA revaluation: only runs when ALL entries are pre-migration.
        // After backfill (hasMigratedEntries=true) COALESCE already returns historical USD
        // base amounts — dividing again would produce double-conversion errors.
        // For a pre-migration CFA company every ledger balance is stored in CFA — divide by
        // the current rate to get an approximate USD equivalent.
        for (const acc of forUsAccounts) {
          const oldVal = acc.value;
          const newVal = round2(oldVal / currentCfaRate);
          forUsTotal = round2(forUsTotal - oldVal + newVal);
          classified.forUsTotal = forUsTotal;
          acc.value = newVal;
        }
        for (const acc of onUsAccounts) {
          const oldVal = acc.value;
          const newVal = round2(oldVal / currentCfaRate);
          onUsTotal = round2(onUsTotal - oldVal + newVal);
          classified.onUsTotal = onUsTotal;
          acc.value = newVal;
        }
      }

      // 2. Process income and expense accounts for the P&L breakdown (ERP-specific)
      //    The helper skips expense/income types; we handle them here.
      const expenseTypesArr = ["Expense", "Direct Expense", "Indirect Expense"];
      let expensesTotal = 0;
      let incomeTotal = 0;
      const expensesAccounts: { id: number; name: string; code: string; value: number; category: string }[] = [];
      const incomeAccounts: { id: number; name: string; code: string; value: number; category: string }[] = [];

      for (const acc of companyAccounts) {
        const netBalance = getAccountNetBalance(acc, accountBalances);
        const isAnyExpenseType = expenseTypesArr.includes(acc.accountType || "");
        const isIncomeAccount = acc.accountType === "Income";

        if (isIncomeAccount) {
          if (netBalance < 0) {
            incomeTotal += Math.abs(netBalance);
            categoryTotals["income_Sales/Revenue"] =
              (categoryTotals["income_Sales/Revenue"] || 0) + Math.abs(netBalance);
            incomeAccounts.push({
              id: acc.id,
              name: acc.name,
              code: acc.code || "",
              value: Math.abs(netBalance),
              category: "Income",
            });
          } else if (netBalance > 0) {
            incomeTotal -= netBalance;
            categoryTotals["income_Sales/Revenue"] = (categoryTotals["income_Sales/Revenue"] || 0) - netBalance;
            incomeAccounts.push({
              id: acc.id,
              name: acc.name,
              code: acc.code || "",
              value: -netBalance,
              category: "Income (Refund)",
            });
          }
        } else if (isAnyExpenseType && !excludedFromExpenses.has(acc.id)) {
          const category = acc.accountType || "Expense";
          if (netBalance > 0) {
            expensesTotal += netBalance;
            categoryTotals[`exp_${category}`] = (categoryTotals[`exp_${category}`] || 0) + netBalance;
            expensesAccounts.push({ id: acc.id, name: acc.name, code: acc.code || "", value: netBalance, category });
          } else if (netBalance < 0) {
            const credit = Math.abs(netBalance);
            expensesTotal -= credit;
            categoryTotals[`exp_${category}`] = (categoryTotals[`exp_${category}`] || 0) - credit;
            expensesAccounts.push({
              id: acc.id,
              name: acc.name,
              code: acc.code || "",
              value: -credit,
              category: category + " (Refund)",
            });
          }
        }
      }

      // Breakdown arrays — populated from categoryTotals after all extra sources are added below
      const forUsBreakdown: { name: string; value: number }[] = [];
      const onUsBreakdown: { name: string; value: number }[] = [];
      const expensesBreakdown: { name: string; value: number }[] = [];
      const incomeBreakdown: { name: string; value: number }[] = [];

      // ── ERP mode: always strip factory-specific ledger accounts (if any exist)
      // and compute Stock In Hand from location inventory.
      // Factory-specific bale/raw-material calculations belong exclusively in
      // /api/factory/net-position — this endpoint is ERP-only.
      const factoryLedgerCodesToStrip = new Set(["FACTORY_RAW_MATERIAL_STOCK", "FACTORY_STOCK_IN_HAND"]);
      const factoryLedgerNamesToStrip = ["factory raw material stock", "factory stock in hand"];
      {
        let i = forUsAccounts.length - 1;
        while (i >= 0) {
          const acc = forUsAccounts[i] as any;
          const code = (acc.code || "").toUpperCase();
          const nameLower = (acc.name || "").toLowerCase();
          if (factoryLedgerCodesToStrip.has(code) || factoryLedgerNamesToStrip.some((p) => nameLower.includes(p))) {
            forUsTotal -= acc.value;
            const catKey = `asset_${acc.category || acc.name}`;
            if (categoryTotals[catKey] !== undefined) delete categoryTotals[catKey];
            forUsAccounts.splice(i, 1);
          }
          i--;
        }
      }

      // ── ERP Stock In Hand — location inventory (weighted-average cost) ──
      {
        const activeLocationsData = await db
          .select({ id: locations.id })
          .from(locations)
          .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
          .execute();
        const activeLocationIds = activeLocationsData.map((l) => l.id);

        let stockOnFloor = 0;
        if (activeLocationIds.length > 0) {
          if (toDate) {
            const allHistorical = await Promise.all(
              activeLocationIds.map((locId) => calculateHistoricalLocationInventory(locId, companyId, toDate))
            );
            for (const items of allHistorical) {
              for (const inv of items) {
                const qty = parseFloat(inv.quantity || "0");
                const rate = parseFloat(inv.averageRate || "0");
                if (qty > 0) stockOnFloor += qty * rate;
              }
            }
          } else {
            const inventoryData = await db
              .select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
              .from(inventory)
              .where(inArray(inventory.locationId, activeLocationIds))
              .execute();
            for (const inv of inventoryData) {
              stockOnFloor += parseFloat(inv.quantity || "0") * parseFloat(inv.averageRate || "0");
            }
          }
        }
        stockOnFloor = Math.round((stockOnFloor + Number.EPSILON) * 100) / 100;
        if (stockOnFloor > 0) {
          forUsTotal += stockOnFloor;
          categoryTotals["asset_Stock In Hand"] = stockOnFloor;
          forUsAccounts.push({
            name: "Stock In Hand (Inventory)",
            code: "COMPUTED",
            value: stockOnFloor,
            category: "Inventory",
          });
        }
      }

      // Add Workers/Payroll - employee balances (salary payable only)
      const companyEmployees = await db
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
        .execute();
      // Compute each employee's net voucher balance to find salary owed (liability only).
      // Advances are NOT sourced from the ledger here — they are read directly from
      // salaryAdvances.remainingBalance below to match the Payroll → Advances "Outstanding" card.
      let workerLiabilities = 0;
      for (const emp of companyEmployees) {
        const opening = parseFloat((emp as any).openingBalance || "0");
        const openingSide = (emp as any).openingBalanceSide === "Dr" ? 1 : -1; // default Cr = we owe them
        const signedOpening = opening * openingSide;
        const balance = employeeBalances.get(emp.id) || { debit: 0, credit: 0 };
        const netBalance = signedOpening + balance.debit - balance.credit;
        if (netBalance < 0) {
          workerLiabilities += Math.abs(netBalance);
        }
        // netBalance > 0 (advance) is intentionally NOT included here —
        // the authoritative outstanding figure comes from salaryAdvances.remainingBalance below.
      }

      // Strip any "advance"-related ledger accounts that classifyNetPositionAccounts may have
      // captured (e.g. "Worker Advances", "Salary Advances", "Employee Advances",
      // "Factory Worker Advances"). The table-based query below is the single source of truth
      // for advances outstanding, so we must remove them from the classifier output to prevent
      // double-counting.
      const advanceLedgerPattern = /(?:worker|salary|employee|factory)\s+advance/i;
      {
        let i = forUsAccounts.length - 1;
        while (i >= 0) {
          const acc = forUsAccounts[i] as any;
          if (advanceLedgerPattern.test(acc.name || "")) {
            forUsTotal = round2(forUsTotal - acc.value);
            const catKey = `asset_${acc.category || acc.name}`;
            if (categoryTotals[catKey] !== undefined) delete categoryTotals[catKey];
            forUsAccounts.splice(i, 1);
          }
          i--;
        }
      }

      // Authoritative ERP worker advances = SUM(salaryAdvances.remainingBalance)
      // WHERE fullyPaid = false AND companyId = X — exactly what Payroll → Advances shows.
      const [saRow] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${salaryAdvances.remainingBalance} AS numeric)), 0)` })
        .from(salaryAdvances)
        .where(and(eq(salaryAdvances.companyId, companyId), eq(salaryAdvances.fullyPaid, false)));
      const rawSalaryAdvances = round2(parseFloat((saRow as any)?.total || "0"));
      // For CFA companies, worker balances come from voucher entries.
      // Guard: only convert if ALL entries are pre-migration (hasMigratedEntries=false).
      // After migration COALESCE already returns USD-base values; re-dividing by CFA rate
      // would produce incorrect double-conversion.
      const workerLiabilitiesDisplay =
        currentCfaRate > 0 && !hasMigratedEntries ? round2(workerLiabilities / currentCfaRate) : workerLiabilities;
      // rawSalaryAdvances comes from the salary_advances table (not voucher entries).
      // Its currency follows the company base currency for CFA companies.
      const workerAdvancesDisplay = currentCfaRate > 0 && !hasMigratedEntries ? round2(rawSalaryAdvances / currentCfaRate) : rawSalaryAdvances;
      if (workerLiabilitiesDisplay > 0) {
        onUsTotal += workerLiabilitiesDisplay;
        categoryTotals["liability_Workers"] = (categoryTotals["liability_Workers"] || 0) + workerLiabilitiesDisplay;
        onUsAccounts.push({
          name: "Workers/Employees Payable",
          code: "COMPUTED",
          value: workerLiabilitiesDisplay,
          category: "Workers",
        });
      }
      if (workerAdvancesDisplay > 0) {
        forUsTotal += workerAdvancesDisplay;
        categoryTotals["asset_Worker Advances"] =
          (categoryTotals["asset_Worker Advances"] || 0) + workerAdvancesDisplay;
        forUsAccounts.push({
          name: "Worker Advances (Prepaid)",
          code: "COMPUTED",
          value: workerAdvancesDisplay,
          category: "Worker Advances",
        });
      }

      // Add Suppliers (only for parent company or if no parent set)
      if (shouldIncludeSuppliers) {
        // Only fetch suppliers that appear in this company's entries (avoids full-table scan)
        const supplierIdsWithBalance = [...supplierBalances.keys()];
        const allSuppliers =
          supplierIdsWithBalance.length > 0
            ? await db
                .select()
                .from(suppliers)
                .where(and(isNull(suppliers.deletedAt), inArray(suppliers.id, supplierIdsWithBalance)))
                .execute()
            : [];
        let supplierLiabilities = 0;
        let supplierAssets = 0;

        for (const sup of allSuppliers) {
          const balance = supplierBalances.get(sup.id);
          if (balance) {
            const opening = parseFloat(sup.openingBalance || "0");
            // Suppliers: Credit = we owe them, Debit = we paid them
            // Net positive = we owe them (liability), Net negative = they owe us (asset)
            const netBalance = opening + balance.credit - balance.debit;
            if (netBalance > 0) {
              supplierLiabilities += netBalance;
              const displayVal = currentCfaRate > 0 && !hasMigratedEntries ? round2(netBalance / currentCfaRate) : netBalance;
              onUsAccounts.push({ name: sup.legalName, code: sup.code || "", value: displayVal, category: "Supplier" });
            } else if (netBalance < 0) {
              supplierAssets += Math.abs(netBalance);
              const displayVal =
                currentCfaRate > 0 && !hasMigratedEntries ? round2(Math.abs(netBalance) / currentCfaRate) : Math.abs(netBalance);
              forUsAccounts.push({
                name: sup.legalName,
                code: sup.code || "",
                value: displayVal,
                category: "Supplier Overpayment",
              });
            }
          }
        }

        // For CFA companies, supplier balances are in CFA → convert to USD
        // Guard: supplier balances come from voucher entries via COALESCE.
        // Only convert pre-migration amounts; after migration the COALESCE already returns USD.
        const supplierLiabilitiesDisplay =
          currentCfaRate > 0 && !hasMigratedEntries ? round2(supplierLiabilities / currentCfaRate) : supplierLiabilities;
        const supplierAssetsDisplay = currentCfaRate > 0 && !hasMigratedEntries ? round2(supplierAssets / currentCfaRate) : supplierAssets;
        if (supplierLiabilitiesDisplay > 0) {
          onUsTotal += supplierLiabilitiesDisplay;
          categoryTotals["liability_Suppliers"] = supplierLiabilitiesDisplay;
        }
        if (supplierAssetsDisplay > 0) {
          forUsTotal += supplierAssetsDisplay;
          categoryTotals["asset_Supplier Overpayment"] = supplierAssetsDisplay;
        }
      }

      // Stock OTW — historical as of toDate (containers that were in transit on that date).
      // SP (supplier_partner) companies track OTW via the sp_goods_otw ledger account instead
      // of the containers table, so skip the container-based calculation to avoid double-counting.
      const isSpCompany = companyRecord?.companyType === "supplier_partner";
      if (!isSpCompany) {
        // Rule: a container was OTW as of toDate if it was imported by then AND either
        //   (a) it is still OTW (never formally offloaded via the offload workflow), OR
        //   (b) it was formally offloaded AFTER toDate (so it was still in transit as of toDate).
        // A manually-entered tracking offloadDate does NOT indicate a formal offload — only
        // status='OFFLOADED' (set by the offload workflow) is authoritative. This keeps the
        // date-filtered result consistent with the no-filter query (status = 'OTW').
        const otwContainersQuery = toDate
          ? and(
              eq(containers.companyId, companyId),
              lte(containers.importDate, toDate),
              or(
                eq(containers.status, "OTW"),
                and(eq(containers.status, "OFFLOADED"), sql`${containers.offloadDate} > ${toDate}`)
              )
            )
          : and(eq(containers.companyId, companyId), eq(containers.status, "OTW"));
        const otwContainers = await db.select().from(containers).where(otwContainersQuery).execute();

        let stockOtwValue = 0;
        for (const container of otwContainers) {
          // Use numeric OR so that grandTotal="0" (DB default) falls through to itemsTotal.
          // String OR ("0" || itemsTotal) would never reach itemsTotal because "0" is truthy.
          const gTotal = parseFloat(container.grandTotal ?? "0");
          const containerValue = gTotal || parseFloat(container.itemsTotal ?? "0");
          stockOtwValue += containerValue;
        }

        if (stockOtwValue > 0) {
          forUsTotal += stockOtwValue;
          categoryTotals["asset_Stock OTW"] = stockOtwValue;
          forUsAccounts.push({
            name: "Stock On The Way",
            code: "STOCK_OTW",
            value: stockOtwValue,
            category: "Stock OTW",
          });
        }
      }

      // ── Rental Outstanding (Tenant Receivables) ──────────────────────────────
      // For every active rental contract under this company (any module), compute
      // outstanding = SUM(expected for past+current months) - SUM(paid).
      // Company is the TENANT paying rent to landlords.
      // paid > expected → we overpaid → prepaid rent asset → forUs
      // expected > paid → we still owe → rent payable → onUs
      //
      // Wrapped in try-catch: if the property tables are missing schema columns
      // (e.g. `currency` not yet in prod), the dashboard still loads — rent data
      // is simply omitted rather than crashing the whole response.
      try {
        const activeContracts = await db
          .select({ id: propertyContracts.id, currency: propertyContracts.currency })
          .from(propertyContracts)
          .where(and(eq(propertyContracts.companyId, companyId), eq(propertyContracts.status, "ACTIVE")));
        if (activeContracts.length > 0) {
          const contractIds = activeContracts.map((c) => c.id);
          const asOfExpr = toDate ? sql`${toDate}::date` : sql`CURRENT_DATE`;
          // Expected: months on or before the asOf date
          const expectedRows = await db
            .select({
              contractId: propertyMonthlyLedger.contractId,
              expected: sql<string>`COALESCE(SUM(
              CASE WHEN (
                ${propertyMonthlyLedger.year} < EXTRACT(YEAR FROM ${asOfExpr})
                OR (
                  ${propertyMonthlyLedger.year} = EXTRACT(YEAR FROM ${asOfExpr})
                  AND ${propertyMonthlyLedger.month} <= EXTRACT(MONTH FROM ${asOfExpr})
                )
              ) THEN CAST(${propertyMonthlyLedger.expectedAmount} AS numeric) ELSE 0 END
            ), 0)`,
            })
            .from(propertyMonthlyLedger)
            .where(inArray(propertyMonthlyLedger.contractId, contractIds))
            .groupBy(propertyMonthlyLedger.contractId);
          // Paid: only rent-linked payments (ledgerRowId IS NOT NULL) made on or before the asOf date.
          // Payments with ledgerRowId=null are guarantee-release/refund log entries — they are NOT
          // rent payments and must not inflate the "paid" total (which would falsely produce prepaid rent).
          const paidConditions: any[] = [
            inArray(propertyPayments.contractId, contractIds),
            isNotNull(propertyPayments.ledgerRowId),
          ];
          if (toDate) paidConditions.push(lte(propertyPayments.paymentDate, toDate));
          const paidRows = await db
            .select({
              contractId: propertyPayments.contractId,
              paid: sql<string>`COALESCE(SUM(CAST(${propertyPayments.amount} AS numeric)), 0)`,
            })
            .from(propertyPayments)
            .where(and(...paidConditions))
            .groupBy(propertyPayments.contractId);
          const paidMap = new Map(paidRows.map((r) => [r.contractId, parseFloat(r.paid)]));

          let prepaidRent = 0;
          let rentPayable = 0;
          for (const row of expectedRows) {
            const expected = parseFloat(row.expected);
            const paid = paidMap.get(row.contractId) ?? 0;
            const net = paid - expected; // positive = overpaid
            const contract = activeContracts.find((c) => c.id === row.contractId);
            const isCfa = contract?.currency === "CFA";
            const usd = isCfa && currentCfaRate > 0 ? net / currentCfaRate : net;
            if (usd > 0) prepaidRent += usd;
            else if (usd < 0) rentPayable += -usd;
          }
          if (prepaidRent > 0.005) {
            const val = round2(prepaidRent);
            forUsTotal = round2(forUsTotal + val);
            categoryTotals["asset_Prepaid Rent"] = (categoryTotals["asset_Prepaid Rent"] || 0) + val;
            forUsAccounts.push({ name: "Prepaid Rent", code: "PREPAID_RENT", value: val, category: "Prepaid Rent" });
          }
          if (rentPayable > 0.005) {
            const val = round2(rentPayable);
            onUsTotal = round2(onUsTotal + val);
            categoryTotals["liability_Rent Payable"] = (categoryTotals["liability_Rent Payable"] || 0) + val;
            onUsAccounts.push({ name: "Rent Payable", code: "RENT_PAYABLE", value: val, category: "Rent Payable" });
          }
        }
      } catch (rentalErr: any) {
        console.warn("[/api/stats/net-profit] Rental section skipped (schema or data error):", rentalErr.message);
        // Non-fatal: dashboard continues without rent figures
      }

      // Build breakdowns from category totals (with rounding)
      for (const [key, value] of Object.entries(categoryTotals)) {
        if (value === 0) continue;
        const roundedValue = round2(value);

        if (key.startsWith("asset_")) {
          forUsBreakdown.push({ name: key.replace("asset_", ""), value: roundedValue });
        } else if (key.startsWith("liability_")) {
          onUsBreakdown.push({ name: key.replace("liability_", ""), value: roundedValue });
        } else if (key.startsWith("exp_")) {
          expensesBreakdown.push({ name: key.replace("exp_", ""), value: roundedValue });
        } else if (key.startsWith("income_")) {
          incomeBreakdown.push({ name: key.replace("income_", ""), value: roundedValue });
        }
      }

      // Round individual account values
      forUsAccounts.forEach((acc) => (acc.value = round2(acc.value)));
      onUsAccounts.forEach((acc) => (acc.value = round2(acc.value)));
      expensesAccounts.forEach((acc) => (acc.value = round2(acc.value)));
      incomeAccounts.forEach((acc) => (acc.value = round2(acc.value)));

      // Sort breakdowns by value (highest first)
      forUsBreakdown.sort((a, b) => b.value - a.value);
      onUsBreakdown.sort((a, b) => b.value - a.value);
      expensesBreakdown.sort((a, b) => b.value - a.value);
      incomeBreakdown.sort((a, b) => b.value - a.value);

      // Sort individual account arrays by value (highest first)
      forUsAccounts.sort((a, b) => b.value - a.value);
      onUsAccounts.sort((a, b) => b.value - a.value);
      expensesAccounts.sort((a, b) => b.value - a.value);
      incomeAccounts.sort((a, b) => b.value - a.value);

      // ============ FINAL CALCULATIONS ============

      // Round all totals to prevent floating point noise
      forUsTotal = round2(forUsTotal);
      onUsTotal = round2(onUsTotal);
      incomeTotal = round2(incomeTotal);
      expensesTotal = round2(expensesTotal);

      // ── Merge stock accounts into one combined Inventory line ────────────────
      // "Stock In Hand (Inventory)" (computed from inventory table) and ledger
      // accounts like "Stock on Floor" (accountType: Asset) represent the same
      // physical stock and should appear as a single line in the breakdown.
      {
        const isStockEntry = (a: any) => {
          const nl = (a.name || "").toLowerCase();
          const cat = (a.category || "").toLowerCase();
          return cat === "inventory" || nl.includes("stock in hand") || nl.includes("stock on floor");
        };
        const stockEntries = forUsAccounts.filter(isStockEntry);
        if (stockEntries.length > 1) {
          const combined = round2(stockEntries.reduce((s: number, a: any) => s + (a.value || 0), 0));
          for (let i = forUsAccounts.length - 1; i >= 0; i--) {
            if (isStockEntry(forUsAccounts[i])) forUsAccounts.splice(i, 1);
          }
          if (combined > 0) {
            forUsAccounts.push({
              name: "Stock In Hand / Stock on Floor",
              code: "COMPUTED",
              value: combined,
              category: "Inventory",
            });
          }
        } else if (stockEntries.length === 1 && stockEntries[0].name !== "Stock In Hand / Stock on Floor") {
          stockEntries[0].name = "Stock In Hand / Stock on Floor";
        }
      }

      // Net Position = Pure sign-based: Sum(positive balances) - Sum(negative balances)
      // Positive balance = asset (what we have)
      // Negative balance = liability (what we owe)
      // This is a simplified calculation: Assets - Liabilities only
      const netPosition = round2(forUsTotal - onUsTotal);

      const netPositionLabel = netPosition >= 0 ? "We have more than we owe" : "We owe more than we have";

      // SP companies: calculate realized POS profit from salesItems.profit
      // (source of truth: totalSales − totalCost per line, stored at sale time).
      // This is displayed as an informational P&L section — it is NOT added to
      // forUsTotal because the balance-sheet entries (Dr Cash, Dr clearing,
      // Cr Payable) already mathematically reflect the profit in the net position.
      // Adding it again would double-count.
      let spPosProfit = 0;
      if (isSpCompany) {
        const spProfitResult = await db.execute(sql`
          SELECT COALESCE(SUM(CAST(si.profit AS DECIMAL)), 0) AS total
          FROM sales_items si
          JOIN vouchers v ON si.voucher_id = v.id
          WHERE v.company_id  = ${companyId}
            AND v.voucher_type = 'Sales'
            AND v.deleted_at  IS NULL
            ${toDate ? sql`AND v.voucher_date <= ${toDate}` : sql``}
        `);
        const spRow = ((spProfitResult as any).rows ?? spProfitResult)[0];
        spPosProfit = round2(parseFloat(spRow?.total || "0"));
      }

      // Owner's Capital for backward compatibility
      const profitAccounts = companyAccounts.filter((acc) => acc.accountType === "Profit");
      let ownersCapital = 0;
      for (const acc of profitAccounts) {
        const opening = parseFloat(acc.openingBalance || "0");
        const balance = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
        ownersCapital += opening + balance.credit - balance.debit;
      }

      // Net Worth and Profit for backward compatibility
      const netWorth = round2(forUsTotal - onUsTotal);
      const netProfit = round2(incomeTotal - expensesTotal);

      // Breakdown for display
      const netPositionBreakdown = {
        assets: {
          total: forUsTotal,
          breakdown: forUsBreakdown,
        },
        liabilities: {
          total: onUsTotal,
          breakdown: onUsBreakdown,
        },
        income: {
          total: incomeTotal,
          breakdown: incomeBreakdown,
        },
        expenses: {
          total: expensesTotal,
          breakdown: expensesBreakdown,
        },
        netPosition,
      };

      const _result = {
        totalIncome: incomeTotal,
        totalExpenses: expensesTotal,
        netProfit,
        spPosProfit,
        forUs: {
          total: forUsTotal,
          breakdown: forUsBreakdown,
          accounts: forUsAccounts,
        },
        onUs: {
          total: onUsTotal,
          breakdown: onUsBreakdown,
          accounts: onUsAccounts,
        },
        income: {
          total: incomeTotal,
          breakdown: incomeBreakdown,
          accounts: incomeAccounts,
        },
        expenses: {
          total: expensesTotal,
          breakdown: expensesBreakdown,
          accounts: expensesAccounts,
        },
        ownersCapital,
        netWorth,
        netPosition,
        netPositionLabel,
        netPositionBreakdown,
        forUsTotal,
        onUsTotal,
        incomeTotal,
        expensesTotal,
      };
      _setCached(_cacheKey, _result);
      res.json(_result);
    } catch (error: any) {
      console.error("[/api/stats/net-profit] Unhandled error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Net Position Excel Export
}
