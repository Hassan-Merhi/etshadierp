import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "./_helpers";
import {
  inventory, stockItems, stockGroups, stockGroupArchives,
  stockTransferVouchers, stockTransferItems,
  stockAdjustmentVouchers, stockAdjustmentItems,
  containers, containerOffloads, containerOffloadItems,
  bankAccounts, fixedAssets, ledgerAccounts, insertLedgerAccountSchema,
  insertStockGroupSchema, insertStockItemSchema, insertContainerSchema,
  insertStockTransferVoucherSchema, insertStockAdjustmentVoucherSchema,
  updateStockTransferSchema, updateStockAdjustmentSchema,
  vouchers, voucherEntries, salesItems, suppliers, customers, customerBalances,
  employees, locations, userLocations, userCompanyRoles, companies,
  auditLog, users, FEATURE_KEYS, companySettings,
  purchaseOrders, poLineItems, interCompanyTransfers,
  insertInterCompanyTransferSchema, insertContainerSaleSchema, containerSales,
  insertUserPreferencesSchema, userPreferences,
  insertDraftPosSaleSchema, InsertDraftPosSale,
  insertSalaryAdvanceSchema, insertSalaryAdvanceDeductionSchema,
  salaryAdvances, salaryAdvanceDeductions,
  fiscalPeriodClosures, wasteDispatches, wasteDispatchItems,
  dashboardCashAccounts, dashboardPayableAccounts, dashboardAccountSelections,
  insertDashboardCashAccountSchema, insertDashboardPayableAccountSchema,
  insertDashboardAccountSelectionSchema,
  creditNoteItems, pendingBarcodes, insertPendingBarcodeSchema,
  bales, baleProducts, baleProductCategories, storedFiles,
  stockItemLocationPrices, exchangeRates,
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance, round2 } from "../netPositionHelper";


export function registerStatsRoutes(app: Express) {
  app.get("/api/stats/net-profit", requireAuth, async (req, res) => {
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
      const companyRecord = await storage.getCompanyById(companyId);
      const companyBaseCurrency = companyRecord?.baseCurrency || "USD";

      // Get all ledger accounts for this company
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations

      // Cumulative voucher filter: include ALL transactions up to toDate (balance-sheet approach)
      const voucherConditions: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
      ];
      if (toDate) {
        voucherConditions.push(lte(vouchers.voucherDate, toDate));
      }
      // Single JOIN query — avoids the large IN-clause on voucher IDs
      const companyEntries = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          supplierId:      voucherEntries.supplierId,
          employeeId:      voucherEntries.employeeId,
          debitAmount:     voucherEntries.debitAmount,
          creditAmount:    voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(...voucherConditions))
        .execute();

      // Calculate balances for each ledger account (debit/credit totals)
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

      // Calculate supplier balances from voucher entries
      const supplierBalances = new Map<number, { debit: number; credit: number }>();
      for (const entry of companyEntries) {
        if (entry.supplierId) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");
          const current = supplierBalances.get(entry.supplierId) || { debit: 0, credit: 0 };
          supplierBalances.set(entry.supplierId, {
            debit: current.debit + debit,
            credit: current.credit + credit,
          });
        }
      }

      // Calculate employee balances from voucher entries (respects asOfDate filter)
      const employeeBalances = new Map<number, { debit: number; credit: number }>();
      for (const entry of companyEntries) {
        if (entry.employeeId) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");
          const current = employeeBalances.get(entry.employeeId) || { debit: 0, credit: 0 };
          employeeBalances.set(entry.employeeId, {
            debit: current.debit + debit,
            credit: current.credit + credit,
          });
        }
      }

      // ============ NET POSITION CALCULATION ============
      // Uses shared helper (netPositionHelper.ts) – single source of truth for
      // the asset vs liability classification formula used by both ERP and Factory.

      // Parent company determines whether ERP supplier ledger accounts are included
      const parentCompanyId = await storage.getParentCompanyId();
      const shouldIncludeSuppliers = parentCompanyId === null || companyId === parentCompanyId;

      // Build excluded-from-expenses set (needed for the P&L expense pass below)
      const importChargesParent = companyAccounts.find(acc => acc.code === "IMPORT_CHARGES");
      const excludedFromExpenses = new Set<number>();
      if (importChargesParent) {
        excludedFromExpenses.add(importChargesParent.id);
        for (const acc of companyAccounts) {
          if (acc.parentId === importChargesParent.id) excludedFromExpenses.add(acc.id);
        }
      }
      for (const acc of companyAccounts) {
        if (
          acc.code === "PURCHASES" || acc.code?.startsWith("PURCHASES_") ||
          acc.code === "PRODUCTION_ADJUSTMENT" || acc.code === "CONSUMPTION_EXPENSE"
        ) {
          excludedFromExpenses.add(acc.id);
        }
      }

      // 1. Classify balance-sheet accounts (assets vs liabilities) via shared helper
      const classified = classifyNetPositionAccounts(companyAccounts, accountBalances, {
        includeSupplierTypeAccounts: shouldIncludeSuppliers,
      });
      let forUsTotal = classified.forUsTotal;
      let onUsTotal = classified.onUsTotal;
      const forUsAccounts = classified.forUsAccounts;
      const onUsAccounts = classified.onUsAccounts;
      const categoryTotals = classified.categoryTotals;

      // CFA revaluation: Cash accounts hold physical CFA units whose USD worth changes with the rate.
      // Expenses, loans, receivables are locked at their historical CFA values — do NOT revalue them.
      // Only revalue if this company's base currency IS CFA (not a USD company that happens to have
      // a CFA exchange rate stored for reference/inter-company purposes).
      const cfaRateRows = companyBaseCurrency === "CFA"
        ? await db.select()
            .from(exchangeRates)
            .where(and(
              eq(exchangeRates.companyId, companyId),
              eq(exchangeRates.fromCurrency, "USD"),
              eq(exchangeRates.toCurrency, "CFA"),
            ))
            .orderBy(desc(exchangeRates.effectiveDate))
            .limit(1)
        : [];
      const currentCfaRate = cfaRateRows.length > 0 ? parseFloat(cfaRateRows[0].rate) : 0;

      if (currentCfaRate > 0) {
        // Revalue ALL balance-sheet accounts (forUs = assets, onUs = liabilities).
        // For a CFA company every ledger balance is stored in CFA — divide by rate to get USD.
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
      const expensesAccounts: { name: string; code: string; value: number; category: string }[] = [];
      const incomeAccounts: { name: string; code: string; value: number; category: string }[] = [];

      for (const acc of companyAccounts) {
        const netBalance = getAccountNetBalance(acc, accountBalances);
        const isAnyExpenseType = expenseTypesArr.includes(acc.accountType || "");
        const isIncomeAccount = acc.accountType === "Income";

        if (isIncomeAccount) {
          if (netBalance < 0) {
            incomeTotal += Math.abs(netBalance);
            categoryTotals["income_Sales/Revenue"] = (categoryTotals["income_Sales/Revenue"] || 0) + Math.abs(netBalance);
            incomeAccounts.push({ name: acc.name, code: acc.code || "", value: Math.abs(netBalance), category: "Income" });
          } else if (netBalance > 0) {
            incomeTotal -= netBalance;
            categoryTotals["income_Sales/Revenue"] = (categoryTotals["income_Sales/Revenue"] || 0) - netBalance;
            incomeAccounts.push({ name: acc.name, code: acc.code || "", value: -netBalance, category: "Income (Refund)" });
          }
        } else if (isAnyExpenseType && !excludedFromExpenses.has(acc.id)) {
          const category = acc.accountType || "Expense";
          if (netBalance > 0) {
            expensesTotal += netBalance;
            categoryTotals[`exp_${category}`] = (categoryTotals[`exp_${category}`] || 0) + netBalance;
            expensesAccounts.push({ name: acc.name, code: acc.code || "", value: netBalance, category });
          } else if (netBalance < 0) {
            const credit = Math.abs(netBalance);
            expensesTotal -= credit;
            categoryTotals[`exp_${category}`] = (categoryTotals[`exp_${category}`] || 0) - credit;
            expensesAccounts.push({ name: acc.name, code: acc.code || "", value: -credit, category: category + " (Refund)" });
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
          if (factoryLedgerCodesToStrip.has(code) || factoryLedgerNamesToStrip.some(p => nameLower.includes(p))) {
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
          forUsAccounts.push({ name: "Stock In Hand (Inventory)", code: "COMPUTED", value: stockOnFloor, category: "Inventory" });
        }
      }

      // Add Workers/Payroll - employee balances (what we owe them)
      const companyEmployees = await db
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
        .execute();
      // Compute each employee's balance from live voucher entries (respects asOfDate)
      // Dr entry = payment/advance paid to them; Cr entry = salary/earnings owed to them
      // netBalance > 0: we paid more than owed (advance/asset); < 0: we owe them (liability)
      let workerLiabilities = 0;
      let workerAdvances = 0;
      for (const emp of companyEmployees) {
        const opening = parseFloat((emp as any).openingBalance || "0");
        const openingSide = (emp as any).openingBalanceSide === "Dr" ? 1 : -1; // default Cr = we owe them
        const signedOpening = opening * openingSide;
        const balance = employeeBalances.get(emp.id) || { debit: 0, credit: 0 };
        const netBalance = signedOpening + balance.debit - balance.credit;
        if (netBalance < 0) {
          workerLiabilities += Math.abs(netBalance);
        } else if (netBalance > 0) {
          workerAdvances += netBalance;
        }
      }
      if (workerLiabilities > 0) {
        onUsTotal += workerLiabilities;
        categoryTotals["liability_Workers"] = (categoryTotals["liability_Workers"] || 0) + workerLiabilities;
        onUsAccounts.push({ name: "Workers/Employees Payable", code: "COMPUTED", value: workerLiabilities, category: "Workers" });
      }
      if (workerAdvances > 0) {
        forUsTotal += workerAdvances;
        categoryTotals["asset_Worker Advances"] = (categoryTotals["asset_Worker Advances"] || 0) + workerAdvances;
        forUsAccounts.push({ name: "Worker Advances (Prepaid)", code: "COMPUTED", value: workerAdvances, category: "Worker Advances" });
      }

      // Add Suppliers (only for parent company or if no parent set)
      if (shouldIncludeSuppliers) {
        const allSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
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
              onUsAccounts.push({ name: sup.legalName, code: sup.code || "", value: netBalance, category: "Supplier" });
            } else if (netBalance < 0) {
              supplierAssets += Math.abs(netBalance);
              forUsAccounts.push({ name: sup.legalName, code: sup.code || "", value: Math.abs(netBalance), category: "Supplier Overpayment" });
            }
          }
        }
        
        if (supplierLiabilities > 0) {
          onUsTotal += supplierLiabilities;
          categoryTotals["liability_Suppliers"] = supplierLiabilities;
        }
        if (supplierAssets > 0) {
          forUsTotal += supplierAssets;
          categoryTotals["asset_Supplier Overpayment"] = supplierAssets;
        }
      }

      // Stock OTW — historical as of toDate (containers that were in transit on that date)
      // A container was OTW on toDate if: importDate ≤ toDate AND (offloadDate IS NULL OR offloadDate > toDate)
      const otwContainersQuery = toDate
        ? and(
            eq(containers.companyId, companyId),
            lte(containers.importDate, toDate),
            or(isNull(containers.offloadDate), sql`${containers.offloadDate} > ${toDate}`)
          )
        : and(eq(containers.companyId, companyId), eq(containers.status, "OTW"));
      const otwContainers = await db.select().from(containers).where(otwContainersQuery).execute();

      let stockOtwValue = 0;
      for (const container of otwContainers) {
        const containerValue = parseFloat(container.grandTotal || container.itemsTotal || "0");
        stockOtwValue += containerValue;
      }

      if (stockOtwValue > 0) {
        forUsTotal += stockOtwValue;
        categoryTotals["asset_Stock OTW"] = stockOtwValue;
        forUsAccounts.push({ name: "Stock On The Way", code: "STOCK_OTW", value: stockOtwValue, category: "Stock OTW" });
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
      forUsAccounts.forEach(acc => acc.value = round2(acc.value));
      onUsAccounts.forEach(acc => acc.value = round2(acc.value));
      expensesAccounts.forEach(acc => acc.value = round2(acc.value));
      incomeAccounts.forEach(acc => acc.value = round2(acc.value));

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
      
      // Net Position = Pure sign-based: Sum(positive balances) - Sum(negative balances)
      // Positive balance = asset (what we have)
      // Negative balance = liability (what we owe)
      // This is a simplified calculation: Assets - Liabilities only
      const netPosition = round2(forUsTotal - onUsTotal);
      
      const netPositionLabel = netPosition >= 0 
        ? "We have more than we owe" 
        : "We owe more than we have";

      // Owner's Capital for backward compatibility
      const profitAccounts = companyAccounts.filter(acc => acc.accountType === "Profit");
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

      res.json({
        totalIncome: incomeTotal,
        totalExpenses: expensesTotal,
        netProfit,
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
      });
    } catch (error: any) {
      console.error("[/api/stats/net-profit] Unhandled error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Net Position Excel Export
  app.get("/api/stats/net-position-excel", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Cumulative "as of" date — same approach as /api/stats/net-profit
      const toDate = req.query.toDate ? String(req.query.toDate) : null;

      const allCompanies = await storage.getAllCompanies();
      const company = allCompanies.find((c: any) => c.id === companyId);
      const companyName = company?.name || "Company";

      // ── 1. Accounts & voucher entries (cumulative up to toDate) ──────────
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true);

      const voucherConds: any[] = [
        eq(vouchers.companyId, companyId),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
      ];
      if (toDate) voucherConds.push(lte(vouchers.voucherDate, toDate));

      // Single JOIN — no large IN-clause on voucher IDs
      const companyEntries = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          supplierId:      voucherEntries.supplierId,
          employeeId:      voucherEntries.employeeId,
          debitAmount:     voucherEntries.debitAmount,
          creditAmount:    voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(...voucherConds))
        .execute();

      const accountBalances = new Map<number, { debit: number; credit: number }>();
      const supplierBalances = new Map<number, { debit: number; credit: number }>();
      const employeeBalances = new Map<number, { debit: number; credit: number }>();
      for (const e of companyEntries as any[]) {
        if (e.ledgerAccountId) {
          const cur = accountBalances.get(e.ledgerAccountId) || { debit: 0, credit: 0 };
          accountBalances.set(e.ledgerAccountId, { debit: cur.debit + parseFloat(e.debitAmount || "0"), credit: cur.credit + parseFloat(e.creditAmount || "0") });
        }
        if (e.supplierId) {
          const cur = supplierBalances.get(e.supplierId) || { debit: 0, credit: 0 };
          supplierBalances.set(e.supplierId, { debit: cur.debit + parseFloat(e.debitAmount || "0"), credit: cur.credit + parseFloat(e.creditAmount || "0") });
        }
        if (e.employeeId) {
          const cur = employeeBalances.get(e.employeeId) || { debit: 0, credit: 0 };
          employeeBalances.set(e.employeeId, { debit: cur.debit + parseFloat(e.debitAmount || "0"), credit: cur.credit + parseFloat(e.creditAmount || "0") });
        }
      }

      // ── 2. Classify accounts ──────────────────────────────────────────────
      const parentCompanyId = await storage.getParentCompanyId();
      const shouldIncludeSuppliers = parentCompanyId === null || companyId === parentCompanyId;
      const classified = classifyNetPositionAccounts(companyAccounts, accountBalances, { includeSupplierTypeAccounts: shouldIncludeSuppliers });
      let forUsTotal = classified.forUsTotal;
      let onUsTotal  = classified.onUsTotal;
      const forUsAccounts: any[] = [...classified.forUsAccounts];
      const onUsAccounts: any[]  = [...classified.onUsAccounts];

      // ── 3. Stock In Hand — historical as of toDate ────────────────────────
      const activeLocsData = await db.select({ id: locations.id }).from(locations)
        .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt))).execute();
      const activeLocIds = activeLocsData.map((l: any) => l.id);
      let stockOnFloor = 0;
      if (activeLocIds.length > 0) {
        if (toDate) {
          // Parallelize across locations — each location is independent
          const allHistorical = await Promise.all(
            activeLocIds.map((locId: number) => calculateHistoricalLocationInventory(locId, companyId, toDate))
          );
          for (const items of allHistorical) {
            for (const inv of items as any[]) {
              const qty = parseFloat(inv.quantity || "0");
              const rate = parseFloat(inv.averageRate || "0");
              if (qty > 0) stockOnFloor += qty * rate;
            }
          }
        } else {
          const invData = await db.select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
            .from(inventory).where(inArray(inventory.locationId, activeLocIds)).execute();
          for (const inv of invData as any[]) stockOnFloor += parseFloat(inv.quantity || "0") * parseFloat(inv.averageRate || "0");
        }
      }
      if (stockOnFloor > 0) {
        forUsTotal += stockOnFloor;
        forUsAccounts.push({ name: "Stock In Hand (Inventory)", code: "COMPUTED", value: stockOnFloor, category: "Inventory" });
      }

      // ── 4. Payroll / employee balances (matches /api/stats/net-profit exactly) ──
      const companyEmployees = await db
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.active, true), isNull(employees.deletedAt)))
        .execute();
      let workerLiabilities = 0;
      let workerAdvances = 0;
      for (const emp of companyEmployees as any[]) {
        const opening = parseFloat(emp.openingBalance || "0");
        const openingSide = emp.openingBalanceSide === "Dr" ? 1 : -1;
        const signedOpening = opening * openingSide;
        const balance = employeeBalances.get(emp.id) || { debit: 0, credit: 0 };
        const netBalance = signedOpening + balance.debit - balance.credit;
        if (netBalance < 0) {
          workerLiabilities += Math.abs(netBalance);
        } else if (netBalance > 0) {
          workerAdvances += netBalance;
        }
      }
      if (workerLiabilities > 0) {
        onUsTotal += workerLiabilities;
        onUsAccounts.push({ name: "Workers/Employees Payable", code: "COMPUTED", value: workerLiabilities, category: "Workers" });
      }
      if (workerAdvances > 0) {
        forUsTotal += workerAdvances;
        forUsAccounts.push({ name: "Worker Advances (Prepaid)", code: "COMPUTED", value: workerAdvances, category: "Worker Advances" });
      }

      // ── 5. Supplier balances ──────────────────────────────────────────────
      if (shouldIncludeSuppliers) {
        const allSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
        let supplierLiabilities = 0;
        let supplierAssets = 0;
        for (const sup of allSuppliers as any[]) {
          const balance = supplierBalances.get(sup.id);
          if (balance) {
            const opening = parseFloat(sup.openingBalance || "0");
            const netBalance = opening + balance.credit - balance.debit;
            if (netBalance > 0) {
              supplierLiabilities += netBalance;
              onUsAccounts.push({ name: sup.legalName, code: sup.code || "", value: netBalance, category: "Supplier" });
            } else if (netBalance < 0) {
              supplierAssets += Math.abs(netBalance);
              forUsAccounts.push({ name: sup.legalName, code: sup.code || "", value: Math.abs(netBalance), category: "Supplier Overpayment" });
            }
          }
        }
        if (supplierLiabilities > 0) onUsTotal += supplierLiabilities;
        if (supplierAssets > 0) forUsTotal += supplierAssets;
      }

      // ── 6. OTW containers — historical as of toDate ───────────────────────
      const excelOtwQuery = toDate
        ? and(
            eq(containers.companyId, companyId),
            lte(containers.importDate, toDate),
            or(isNull(containers.offloadDate), sql`${containers.offloadDate} > ${toDate}`)
          )
        : and(eq(containers.companyId, companyId), eq(containers.status, "OTW"));
      const otwContainers = await db.select().from(containers).where(excelOtwQuery).execute();
      let stockOtwValue = 0;
      for (const container of otwContainers as any[]) {
        stockOtwValue += parseFloat(container.grandTotal || container.itemsTotal || "0");
      }
      if (stockOtwValue > 0) {
        forUsTotal += stockOtwValue;
        forUsAccounts.push({ name: "Stock On The Way", code: "STOCK_OTW", value: stockOtwValue, category: "Stock OTW" });
      }

      const netPosition = round2(forUsTotal - onUsTotal);
      forUsTotal = round2(forUsTotal);
      onUsTotal = round2(onUsTotal);
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

      // ── 5. Build Excel ────────────────────────────────────────────────────
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.default.Workbook();
      wb.creator = companyName;
      wb.created = new Date();

      const DARK_GREEN  = "FF1A6B3C";
      const DARK_RED    = "FF8B1A1A";
      const DARK_NAVY   = "FF1F3864";
      const LIGHT_GREEN = "FFE8F5E9";
      const LIGHT_RED   = "FFFDECEA";
      const ALT_ROW     = "FFF5F5F5";
      const NUM_FMT     = '#,##0.00';

      const currency = (n: number) => `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

      // ── Sheet 1: Summary ──────────────────────────────────────────────────
      const ws1 = wb.addWorksheet("Net Position Summary");
      ws1.columns = [
        { key: "label", width: 35 },
        { key: "value", width: 22 },
        { key: "note",  width: 40 },
      ];

      const addTitle = (ws: any, text: string, argb: string) => {
        const row = ws.addRow([text]);
        row.height = 28;
        const cell = row.getCell(1);
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        cell.alignment = { vertical: "middle" };
        ws.mergeCells(`A${row.number}:C${row.number}`);
      };

      const addSubheader = (ws: any, text: string, argb: string) => {
        const row = ws.addRow([text]);
        row.height = 18;
        const cell = row.getCell(1);
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
        ws.mergeCells(`A${row.number}:C${row.number}`);
      };

      addTitle(ws1, `${companyName} — Net Position Report`, DARK_NAVY);

      const dateRange = fromDate && toDate ? `${fromDate} to ${toDate}` : fromDate ? `From ${fromDate}` : toDate ? `Up to ${toDate}` : "All Time";
      const metaRow = ws1.addRow([`Date Range: ${dateRange}`, "", `Generated: ${new Date().toLocaleDateString()}`]);
      metaRow.getCell(1).font = { italic: true, color: { argb: "FF555555" } };
      metaRow.getCell(3).font = { italic: true, color: { argb: "FF555555" } };
      metaRow.getCell(3).alignment = { horizontal: "right" };
      ws1.addRow([]);

      // Formula banner
      addSubheader(ws1, "Net Position Formula", DARK_NAVY);
      const formulaRow = ws1.addRow(["What We Have  −  What We Owe  =  Net Position"]);
      ws1.mergeCells(`A${formulaRow.number}:C${formulaRow.number}`);
      formulaRow.getCell(1).font = { bold: true, size: 12 };
      formulaRow.height = 20;

      ws1.addRow([]);

      // Summary table
      const sumHeaders = ws1.addRow(["Category", "Amount (USD)", "Notes"]);
      sumHeaders.height = 18;
      sumHeaders.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_NAVY } };
        cell.alignment = { horizontal: "center" };
      });

      const haveRow = ws1.addRow(["What We Have (Total Assets)", currency(round2(forUsTotal)), `${forUsAccounts.length} accounts`]);
      haveRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } };
      haveRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } };
      haveRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } };
      haveRow.getCell(1).font = { bold: true, color: { argb: DARK_GREEN } };
      haveRow.getCell(2).font = { bold: true, color: { argb: DARK_GREEN } };
      haveRow.getCell(2).alignment = { horizontal: "right" };

      const oweRow = ws1.addRow(["What We Owe (Total Liabilities)", currency(round2(onUsTotal)), `${onUsAccounts.length} accounts`]);
      oweRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
      oweRow.getCell(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
      oweRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } };
      oweRow.getCell(1).font = { bold: true, color: { argb: DARK_RED } };
      oweRow.getCell(2).font = { bold: true, color: { argb: DARK_RED } };
      oweRow.getCell(2).alignment = { horizontal: "right" };

      const netArgb = netPosition >= 0 ? DARK_GREEN : DARK_RED;
      const netBgArgb = netPosition >= 0 ? "FFD4EDDA" : "FFF8D7DA";
      const netRow = ws1.addRow(["Net Position", currency(round2(netPosition)), netPosition >= 0 ? "We have more than we owe" : "We owe more than we have"]);
      [1, 2, 3].forEach((col) => {
        const cell = netRow.getCell(col);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: netBgArgb } };
        cell.font = { bold: true, size: 13, color: { argb: netArgb } };
      });
      netRow.getCell(2).alignment = { horizontal: "right" };
      netRow.height = 22;

      ws1.addRow([]);

      // Category breakdown — Assets
      addSubheader(ws1, "Assets Breakdown by Category", DARK_GREEN);
      const assetCatMap: Record<string, number> = {};
      for (const a of forUsAccounts) assetCatMap[a.category || "Other"] = (assetCatMap[a.category || "Other"] || 0) + a.value;
      const catHdr = ws1.addRow(["Category", "Total (USD)", ""]);
      catHdr.eachCell((cell: any) => { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } }; });
      Object.entries(assetCatMap).sort((a, b) => b[1] - a[1]).forEach(([cat, val], i) => {
        const r = ws1.addRow([cat, currency(round2(val)), ""]);
        if (i % 2 === 1) r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } }; });
        r.getCell(2).alignment = { horizontal: "right" };
      });

      ws1.addRow([]);

      // Category breakdown — Liabilities
      addSubheader(ws1, "Liabilities Breakdown by Category", DARK_RED);
      const liabCatMap: Record<string, number> = {};
      for (const a of onUsAccounts) liabCatMap[a.category || "Other"] = (liabCatMap[a.category || "Other"] || 0) + a.value;
      const liabHdr = ws1.addRow(["Category", "Total (USD)", ""]);
      liabHdr.eachCell((cell: any) => { cell.font = { bold: true }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } }; });
      Object.entries(liabCatMap).sort((a, b) => b[1] - a[1]).forEach(([cat, val], i) => {
        const r = ws1.addRow([cat, currency(round2(val)), ""]);
        if (i % 2 === 1) r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } }; });
        r.getCell(2).alignment = { horizontal: "right" };
      });

      // ── Sheet 2: What We Have (Assets) ────────────────────────────────────
      const ws2 = wb.addWorksheet("What We Have (Assets)");
      ws2.columns = [
        { key: "name",     width: 40, header: "Account Name" },
        { key: "code",     width: 18, header: "Code" },
        { key: "category", width: 22, header: "Category" },
        { key: "value",    width: 20, header: "Balance (USD)" },
      ];
      const ws2Hdr = ws2.getRow(1);
      ws2Hdr.height = 20;
      ws2Hdr.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GREEN } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });

      // Title row above headers
      ws2.spliceRows(1, 0, [`${companyName} — What We Have (Assets)  |  ${dateRange}`]);
      ws2.mergeCells("A1:D1");
      const ws2Title = ws2.getRow(1);
      ws2Title.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
      ws2Title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_GREEN } };
      ws2Title.height = 24;

      const sortedAssets = [...forUsAccounts].sort((a, b) => b.value - a.value);
      sortedAssets.forEach((acc, i) => {
        const r = ws2.addRow({ name: acc.name, code: acc.code || "", category: acc.category || "Other", value: round2(acc.value) });
        r.getCell("value").numFmt = NUM_FMT;
        r.getCell("value").alignment = { horizontal: "right" };
        if (i % 2 === 1) r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } }; });
      });

      // Total row
      const assetTotalRow = ws2.addRow({ name: "TOTAL", code: "", category: "", value: round2(forUsTotal) });
      assetTotalRow.eachCell((c: any) => { c.font = { bold: true, color: { argb: DARK_GREEN } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GREEN } }; });
      assetTotalRow.getCell("value").numFmt = NUM_FMT;
      assetTotalRow.getCell("value").alignment = { horizontal: "right" };

      // ── Sheet 3: What We Owe (Liabilities) ───────────────────────────────
      const ws3 = wb.addWorksheet("What We Owe (Liabilities)");
      ws3.columns = [
        { key: "name",     width: 40, header: "Account Name" },
        { key: "code",     width: 18, header: "Code" },
        { key: "category", width: 22, header: "Category" },
        { key: "value",    width: 20, header: "Balance (USD)" },
      ];
      ws3.spliceRows(1, 0, [`${companyName} — What We Owe (Liabilities)  |  ${dateRange}`]);
      ws3.mergeCells("A1:D1");
      const ws3Title = ws3.getRow(1);
      ws3Title.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 13 };
      ws3Title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_RED } };
      ws3Title.height = 24;
      const ws3Hdr = ws3.getRow(2);
      ws3Hdr.height = 20;
      ws3Hdr.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_RED } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });

      const sortedLiabs = [...onUsAccounts].sort((a, b) => b.value - a.value);
      sortedLiabs.forEach((acc, i) => {
        const r = ws3.addRow({ name: acc.name, code: acc.code || "", category: acc.category || "Other", value: round2(acc.value) });
        r.getCell("value").numFmt = NUM_FMT;
        r.getCell("value").alignment = { horizontal: "right" };
        if (i % 2 === 1) r.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT_ROW } }; });
      });

      const liabTotalRow = ws3.addRow({ name: "TOTAL", code: "", category: "", value: round2(onUsTotal) });
      liabTotalRow.eachCell((c: any) => { c.font = { bold: true, color: { argb: DARK_RED } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_RED } }; });
      liabTotalRow.getCell("value").numFmt = NUM_FMT;
      liabTotalRow.getCell("value").alignment = { horizontal: "right" };

      // ── Send file ─────────────────────────────────────────────────────────
      const dateTag = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="Net_Position_${dateTag}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Net position Excel error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get monthly sales and profit data for Dashboard charts
  app.get("/api/stats/monthly-data", requireAuth, async (req, res) => {
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
            eq(vouchers.optional, false),
          ),
        )
        .execute();

      // Get all Income and Expense ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations
      const incomeAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Income")
        .map((acc) => acc.id);
      
      // Include ALL expenses in monthly profit calculation for consistency with P&L report
      // PURCHASES are now included (previously excluded) to match P&L calculation
      // Only exclude container-related import charges that are capitalized to inventory
      const excludedExpenseCodes = [
        "IMPORTCHARGES",       // Old consolidated import charges (deprecated, capitalized)
        "IMPORT_CHARGES",      // Alternative format
        "DUTIES",              // Container import duties (capitalized)
        "DUT",                 // Abbreviated duties code
        "TRANSPORTCHARGES",    // Container transport costs (capitalized)
        "TRANSPORT",           // Alternative transport account name (capitalized)
        "TRA",                 // Abbreviated transport code
        "TRANSFER_CHARGES",    // Transfer charges (capitalized)
        "CONTAINERLICENSES",   // Container license fees (capitalized)
        "CONLIC",              // Abbreviated container licenses
        "LICENSES",            // Alternative license account name (capitalized)
        "LIC",                 // Abbreviated licenses code
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
      const normalizeCode = (code: string) => 
        code.toUpperCase().replace(/[\s_-]/g, "");
      
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
        const codeExcluded = excludedExpenseCodes.some(excluded => 
          normalizeCode(excluded) === normalizedCode
        );
        
        // Check if name contains excluded patterns
        const nameLower = (acc.name || "").toLowerCase();
        const nameExcluded = excludedNamePatterns.some(pattern => 
          nameLower.includes(pattern)
        );
        
        // Exclude if either code or name matches
        return !codeExcluded && !nameExcluded;
      });
      const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

      // Get all voucher entries for this company (excluding optional)
      const companyVouchers = await db
        .select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
        .from(vouchers)
        .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);
      const voucherDateMap = new Map(
        companyVouchers.map((v) => [v.id, v.voucherDate]),
      );

      const companyEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

      // Group data by month (last 6 months)
      const monthlyData = new Map<string, { sales: number; profit: number }>();
      const monthNames = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];

      // Initialize last 6 months
      const currentDate = new Date();
      for (let i = 5; i >= 0; i--) {
        const date = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() - i,
          1,
        );
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
        if (
          entry.ledgerAccountId &&
          incomeAccountIds.includes(entry.ledgerAccountId)
        ) {
          data.profit +=
            parseFloat(entry.creditAmount || "0") -
            parseFloat(entry.debitAmount || "0");
        }

        // Expense accounts (including Purchases): debits decrease profit, credits increase it
        if (
          entry.ledgerAccountId &&
          expenseAccountIds.includes(entry.ledgerAccountId)
        ) {
          data.profit -=
            parseFloat(entry.debitAmount || "0") -
            parseFloat(entry.creditAmount || "0");
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
        .filter(
          (item) =>
            parseFloat(item.quantity) < lowStockThreshold &&
            parseFloat(item.quantity) > 0,
        )
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
        (item) =>
          parseFloat(item.quantity) < criticalThreshold &&
          parseFloat(item.quantity) > 0,
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
      const importChargesParent = allAccounts.find(acc => acc.code === "IMPORT_CHARGES");
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
      
      const expenseAccounts = allAccounts.filter(acc => 
        (acc.accountType === "Expense" ||
         acc.accountType === "Direct Expense" ||
         acc.accountType === "Indirect Expense") &&
        !excludedFromExpenses.has(acc.id)
      );

      // Get all non-optional vouchers for this company
      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(
          and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.optional, false),
            isNull(vouchers.deletedAt)
          )
        )
        .execute();

      const companyVoucherIds = companyVouchers.map(v => v.id);

      // Get all entries for company vouchers
      const entries = companyVoucherIds.length > 0
        ? await db
            .select()
            .from(voucherEntries)
            .where(inArray(voucherEntries.voucherId, companyVoucherIds))
            .execute()
        : [];

      // Create a map of account ID to account type
      const accountTypeMap = new Map<number, string>();
      for (const acc of expenseAccounts) {
        accountTypeMap.set(acc.id, acc.accountType);
      }

      // Sum balances by expense type
      const expenseByType = new Map<string, number>();
      
      for (const entry of entries) {
        if (!entry.ledgerAccountId) continue;
        
        const accountType = accountTypeMap.get(entry.ledgerAccountId);
        if (!accountType) continue;

        // Expense accounts: debits increase expense, credits decrease it
        const amount = parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
        if (amount <= 0) continue;

        const current = expenseByType.get(accountType) || 0;
        expenseByType.set(accountType, current + amount);
      }

      // Convert to array format for chart
      const result = Array.from(expenseByType.entries())
        .filter(([_, value]) => value > 0)
        .map(([name, value]) => ({
          name: name.replace(" Expense", ""),
          value: Math.round(value * 100) / 100,
        }))
        .sort((a, b) => b.value - a.value);

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import Cycle Balance - tracks the full import/offload cycle to ensure it balances to zero
  // Formula: Supplier Balance (credit/liability) + Stock OTW (debit/asset) + Loan accounts + Expense charges - Stock Value on Floor
  app.get("/api/sales-report", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockItemId, stockGroupId } = req.query;

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
        conditions.push(
          eq(vouchers.locationId, parseInt(locationId as string)),
        );
      }
      if (stockItemId) {
        conditions.push(
          eq(salesItems.stockItemId, parseInt(stockItemId as string)),
        );
      }
      if (stockGroupId) {
        conditions.push(
          eq(stockItems.stockGroupId, parseInt(stockGroupId as string)),
        );
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
      const enhancedSalesData = salesData.map(item => {
        // Use location price if available, otherwise use actual selling price
        const configuredPrice = parseFloat(item.configuredSellingPrice || "0") > 0 
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
  app.get("/api/dashboard/sales-report-all", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get all companies the user has access to
      const userCompanyRoles = await storage.getUserCompaniesWithRoles(userId);
      const companyIds = userCompanyRoles.map(r => r.companyId);

      if (companyIds.length === 0) {
        return res.json([]);
      }

      // Get all companies for names
      const allCompanies = await storage.getAllCompanies();
      const companyMap = new Map(allCompanies.map(c => [c.id, c]));

      const { startDate, endDate, locationId, stockItemId, companyFilter, stockGroupName } = req.query;

      // Parse company filter if provided
      let filteredCompanyIds = companyIds;
      if (companyFilter && typeof companyFilter === 'string' && companyFilter.length > 0) {
        const filterCodes = companyFilter.split(',');
        filteredCompanyIds = companyIds.filter(id => {
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
          const configuredPrice = parseFloat(item.configuredSellingPrice || "0") > 0 
            ? parseFloat(item.configuredSellingPrice || "0")
            : parseFloat(item.actualSellingPrice || "0");
          
          const actualPrice = parseFloat(item.actualSellingPrice || "0");
          const totalSales = parseFloat(item.totalSales || "0");
          const costProfit = parseFloat(item.costProfit || "0");
          const quantity = parseFloat(item.quantity || "0");
          
          const configuredProfit = (actualPrice - configuredPrice) * quantity;
          const totalConfiguredCost = configuredPrice * quantity;
          
          const costProfitPercentage = totalSales > 0 ? (costProfit / totalSales) * 100 : 0;
          const configuredProfitPercentage = totalConfiguredCost > 0 ? (configuredProfit / totalConfiguredCost) * 100 : 0;
          
          allSalesData.push({
            ...item,
            companyId,
            companyCode: company?.code || '',
            companyName: company?.name || 'Unknown',
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
  app.post(
    "/api/sales-report/recalculate-costs",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { startDate, endDate, stockItemId, locationId } = req.body;

        // Build conditions for finding sales items to update
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
              .where(
                and(
                  eq(inventory.stockItemId, item.stockItemId),
                  eq(inventory.locationId, item.locationId)
                )
              )
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
    }
  );

  // Reports API Endpoints

  // Profit & Loss Report
  app.get(
    "/api/reports/profit-loss",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { startDate, endDate } = req.query;

        // Get all ledger accounts for this company
        const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations

        const incomeAccounts = companyAccounts.filter(
          (acc) => acc.accountType === "Income",
        );
        const expenseAccounts = companyAccounts.filter(
          (acc) => 
            acc.accountType === "Expense" || 
            acc.accountType === "Indirect Expense" || 
            acc.accountType === "Direct Expense",
        );

        const incomeAccountIds = incomeAccounts.map((acc) => acc.id);
        const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

        // Get voucher IDs for this company with date filter
        let companyVouchersQuery = db
          .select({ id: vouchers.id, voucherDate: vouchers.voucherDate })
          .from(vouchers)
          .where(eq(vouchers.companyId, companyId));

        const conditions = [eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)];
        if (startDate) {
          conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
        }
        if (endDate) {
          conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
        }

        const companyVouchers = await db
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(...conditions))
          .execute();

        const companyVoucherIds = companyVouchers.map((v) => v.id);

        // Get voucher entries
        const companyEntries =
          companyVoucherIds.length > 0
            ? await db
                .select()
                .from(voucherEntries)
                .where(inArray(voucherEntries.voucherId, companyVoucherIds))
                .execute()
            : [];

        // Calculate balances for each account
        const accountBalances = new Map<number, number>();

        for (const entry of companyEntries) {
          if (entry.ledgerAccountId) {
            const debit = parseFloat(entry.debitAmount || "0");
            const credit = parseFloat(entry.creditAmount || "0");
            const currentBalance =
              accountBalances.get(entry.ledgerAccountId) || 0;
            accountBalances.set(
              entry.ledgerAccountId,
              currentBalance + credit - debit,
            );
          }
        }

        // Build income statement
        const incomeItems = incomeAccounts
          .map((acc) => ({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            balance: accountBalances.get(acc.id) || 0,
          }))
          .filter((item) => item.balance !== 0);

        const expenseItems = expenseAccounts
          .map((acc) => ({
            id: acc.id,
            code: acc.code,
            name: acc.name,
            accountType: acc.accountType,
            balance: accountBalances.get(acc.id) || 0,
          }))
          .filter((item) => item.balance !== 0);

        const totalIncome = incomeItems.reduce(
          (sum, item) => sum + item.balance,
          0,
        );
        const totalExpenses = expenseItems.reduce(
          (sum, item) => sum + item.balance,
          0,
        );
        const netProfit = totalIncome - totalExpenses;

        res.json({
          incomeItems,
          expenseItems,
          totalIncome,
          totalExpenses,
          netProfit,
          startDate: startDate || null,
          endDate: endDate || null,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Balance Sheet Report
  app.get(
    "/api/reports/balance-sheet",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }

        const { asOfDate } = req.query;

        // Get all accounts
        const ledgers = await storage.getAllLedgerAccounts(companyId);
        const banks = await storage.getAllBankAccounts(companyId);
        const assets = await storage.getAllFixedAssets(companyId);
      const employees = await storage.getAllEmployees(companyId);
        const suppliers = await storage.getAllSuppliers();

        // Get vouchers up to asOfDate
        const conditions = [eq(vouchers.companyId, companyId)];
        if (asOfDate) {
          conditions.push(lte(vouchers.voucherDate, asOfDate));
        }

        const companyVouchers = await db
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(...conditions))
          .execute();

        const companyVoucherIds = companyVouchers.map((v) => v.id);

        const allEntries =
          companyVoucherIds.length > 0
            ? await db
                .select()
                .from(voucherEntries)
                .where(inArray(voucherEntries.voucherId, companyVoucherIds))
                .execute()
            : [];

        // Calculate balances
        const ledgerBalances = new Map<
          number,
          { debits: number; credits: number }
        >();
        const bankBalances = new Map<
          number,
          { debits: number; credits: number }
        >();
        const assetBalances = new Map<
          number,
          { debits: number; credits: number }
      >();
      const employeeBalances = new Map<
        number,
        { debits: number; credits: number }
        >();
        const supplierBalances = new Map<
          number,
          { debits: number; credits: number }
        >();

        for (const entry of allEntries) {
          const debit = parseFloat(entry.debitAmount || "0");
          const credit = parseFloat(entry.creditAmount || "0");

          if (entry.ledgerAccountId) {
            const existing = ledgerBalances.get(entry.ledgerAccountId) || {
              debits: 0,
              credits: 0,
            };
            ledgerBalances.set(entry.ledgerAccountId, {
              debits: existing.debits + debit,
              credits: existing.credits + credit,
            });
          }

          if (entry.bankAccountId) {
            const existing = bankBalances.get(entry.bankAccountId) || {
              debits: 0,
              credits: 0,
            };
            bankBalances.set(entry.bankAccountId, {
              debits: existing.debits + debit,
              credits: existing.credits + credit,
            });
          }

          if (entry.fixedAssetId) {
            const existing = assetBalances.get(entry.fixedAssetId) || {
              debits: 0,
              credits: 0,
            };
            assetBalances.set(entry.fixedAssetId, {
              debits: existing.debits + debit,
              credits: existing.credits + credit,
            });
          }

          if (entry.supplierId) {
            const existing = supplierBalances.get(entry.supplierId) || {
              debits: 0,
              credits: 0,
            };
            // Only count pure credit or pure debit entries to prevent double-counting
            // This matches the logic in /api/suppliers/stats
            if (credit > 0 && debit === 0) {
              supplierBalances.set(entry.supplierId, {
                debits: existing.debits,
                credits: existing.credits + credit,
              });
            } else if (debit > 0 && credit === 0) {
              supplierBalances.set(entry.supplierId, {
                debits: existing.debits + debit,
                credits: existing.credits,
              });
            }
          }
        }

        // Categorize and calculate net balances
        const assetAccounts = ledgers
          .filter((l) => l.accountType === "Asset")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.debits - bal.credits,
            };
          });

        const bankAccounts = banks.map((bank) => {
          const bal = bankBalances.get(bank.id) || { debits: 0, credits: 0 };
          const openingBalance = parseFloat(bank.openingBalance || "0");
          return {
            id: bank.id,
            code: bank.accountNumber,
            name: bank.bankName,
            balance: openingBalance + bal.debits - bal.credits,
          };
        });

        const fixedAssetAccounts = assets.map((asset) => {
          const bal = assetBalances.get(asset.id) || { debits: 0, credits: 0 };
          const purchaseValue = parseFloat(asset.purchaseAmount || "0");
          return {
            id: asset.id,
            code: asset.code,
            name: asset.name,
            balance: purchaseValue + bal.debits - bal.credits,
          };
        });

        const liabilityAccounts = ledgers
          .filter((l) => l.accountType === "Liability")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.credits - bal.debits,
            };
          });

        const supplierAccounts = suppliers
          .map((supplier) => {
            const bal = supplierBalances.get(supplier.id) || {
              debits: 0,
              credits: 0,
            };
            return {
              id: supplier.id,
              code: supplier.code,
              name: supplier.legalName,
              balance: bal.credits - bal.debits,
            };
          })
          .filter((s) => s.balance !== 0);

        const equityAccounts = ledgers
          .filter((l) => l.accountType === "Equity")
          .map((acc) => {
            const bal = ledgerBalances.get(acc.id) || { debits: 0, credits: 0 };
            const openingBalance = parseFloat(acc.openingBalance || "0");
            return {
              id: acc.id,
              code: acc.code,
              name: acc.name,
              balance: openingBalance + bal.credits - bal.debits,
            };
          });

        const totalAssets = [
          ...assetAccounts,
          ...bankAccounts,
          ...fixedAssetAccounts,
        ].reduce((sum, item) => sum + item.balance, 0);

        const totalLiabilities = [
          ...liabilityAccounts,
          ...supplierAccounts,
        ].reduce((sum, item) => sum + item.balance, 0);

        const totalEquity = equityAccounts.reduce(
          (sum, item) => sum + item.balance,
          0,
        );

        res.json({
          assets: {
            ledgers: assetAccounts.filter((a) => a.balance !== 0),
            banks: bankAccounts.filter((b) => b.balance !== 0),
            fixedAssets: fixedAssetAccounts.filter((f) => f.balance !== 0),
            total: totalAssets,
          },
          liabilities: {
            ledgers: liabilityAccounts.filter((l) => l.balance !== 0),
            suppliers: supplierAccounts,
            total: totalLiabilities,
          },
          equity: {
            accounts: equityAccounts.filter((e) => e.balance !== 0),
            total: totalEquity,
          },
          asOfDate: asOfDate || null,
        });
      } catch (error: any) {
        res.status(500).json({ message: error.message });
      }
    },
  );

  // Sales Report
  app.get("/api/reports/sales", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      const conditions = [eq(vouchers.companyId, companyId)];

      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }
      if (locationId) {
        conditions.push(
          eq(vouchers.locationId, parseInt(locationId as string)),
        );
      }

      let salesQuery = db
        .select({
          id: salesItems.id,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          locationName: locations.name,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          stockGroupId: stockItems.stockGroupId,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          costPrice: salesItems.costPrice,
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
          profit: salesItems.profit,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
        .leftJoin(locations, eq(vouchers.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(vouchers.voucherDate);

      let salesData = await salesQuery.execute();

      // Filter by stock group if provided
      if (stockGroupId) {
        salesData = salesData.filter(
          (s) => s.stockGroupId === parseInt(stockGroupId as string),
        );
      }

      const totalQuantity = salesData.reduce(
        (sum, item) => sum + parseFloat(item.quantity),
        0,
      );
      const totalSales = salesData.reduce(
        (sum, item) => sum + parseFloat(item.totalSales),
        0,
      );
      const totalCost = salesData.reduce(
        (sum, item) => sum + parseFloat(item.totalCost),
        0,
      );
      const totalProfit = salesData.reduce(
        (sum, item) => sum + parseFloat(item.profit),
        0,
      );

      res.json({
        items: salesData,
        summary: {
          totalQuantity,
          totalSales,
          totalCost,
          totalProfit,
          grossProfitMargin:
            totalSales > 0 ? (totalProfit / totalSales) * 100 : 0,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Movement Report
  app.get("/api/reports/stock-movement", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockGroupId } = req.query;

      // Get all stock items for this company
      const allStockItems = await storage.getAllStockItems(companyId);

      // Filter by stock group if provided
      const stockItemsToReport = stockGroupId
        ? allStockItems.filter(
            (item) => item.stockGroupId === parseInt(stockGroupId as string),
          )
        : allStockItems;

      // Get all inventory records
      const inventoryConditions = [eq(locations.companyId, companyId)];

      if (locationId) {
        inventoryConditions.push(
          eq(inventory.locationId, parseInt(locationId as string)),
        );
      }

      const inventoryRecords = await db
        .select({
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          locationName: locations.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(...inventoryConditions))
        .execute();

      // Build movement report - calculate value dynamically as qty * rate
      const movementData = stockItemsToReport
        .map((item) => {
          const itemInventory = inventoryRecords.filter(
            (inv) => inv.stockItemId === item.id,
          );
          const totalQuantity = itemInventory.reduce(
            (sum, inv) => sum + parseFloat(inv.quantity),
            0,
          );
          const totalValue = itemInventory.reduce(
            (sum, inv) => sum + parseFloat(inv.quantity) * parseFloat(inv.averageRate),
            0,
          );

          return {
            stockItemId: item.id,
            stockItemCode: item.code,
            stockItemName: item.name,
            locations: itemInventory.map((inv) => {
              const qty = parseFloat(inv.quantity) || 0;
              const rate = parseFloat(inv.averageRate) || 0;
              return {
                locationId: inv.locationId,
                locationName: inv.locationName,
                quantity: qty,
                averageRate: rate,
                totalValue: qty * rate,
              };
            }),
            totalQuantity,
            totalValue,
          };
        })
        .filter((item) => item.totalQuantity > 0);

      const grandTotalQuantity = movementData.reduce(
        (sum, item) => sum + item.totalQuantity,
        0,
      );
      const grandTotalValue = movementData.reduce(
        (sum, item) => sum + item.totalValue,
        0,
      );

      res.json({
        items: movementData,
        summary: {
          totalItems: movementData.length,
          grandTotalQuantity,
          grandTotalValue,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          locationId: locationId || null,
          stockGroupId: stockGroupId || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Container Report
  app.get("/api/reports/containers", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { status, supplierId, startDate, endDate, allCompanies, specificCompanyId } = req.query;

      // Determine which companies to include
      let companyCondition;
      if (allCompanies === "true") {
        const userCompanies = await storage.getUserCompaniesWithRoles(req.user!.id);
        const companyIds = userCompanies.map((uc) => uc.companyId);
        companyCondition = companyIds.length > 0 ? inArray(containers.companyId, companyIds) : eq(containers.companyId, companyId);
      } else if (specificCompanyId) {
        companyCondition = eq(containers.companyId, parseInt(specificCompanyId as string));
      } else {
        companyCondition = eq(containers.companyId, companyId);
      }

      const conditions = [companyCondition];

      // Normalise status: the DB stores "OFFLOADED" (all-caps) while the
      // frontend select sends "Offloaded" (mixed-case). Uppercase comparison
      // handles both, and also tolerates any future casing differences.
      const isOffloaded = (status as string | undefined)?.toLowerCase() === "offloaded";
      if (status) {
        const dbStatus = isOffloaded ? "OFFLOADED" : (status as string);
        conditions.push(eq(containers.status, dbStatus));
      }
      if (supplierId) {
        conditions.push(
          eq(containers.supplierId, parseInt(supplierId as string)),
        );
      }

      // Date filtering — offloaded containers use offloadDate; OTW use importDate
      if (isOffloaded) {
        if (startDate) conditions.push(sql`${containers.offloadDate} >= ${startDate}`);
        if (endDate) conditions.push(sql`${containers.offloadDate} <= ${endDate}`);
      } else {
        if (startDate) conditions.push(sql`${containers.importDate} >= ${startDate}`);
        if (endDate) conditions.push(sql`${containers.importDate} <= ${endDate}`);
      }

      const containerData = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          supplierName: suppliers.legalName,
          status: containers.status,
          importDate: containers.importDate,
          offloadDate: containers.offloadDate,
          itemsTotal: containers.itemsTotal,
          chargesTotal: containers.chargesTotal,
          grandTotal: containers.grandTotal,
          companyId: containers.companyId,
          companyName: companies.name,
        })
        .from(containers)
        .innerJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .innerJoin(companies, eq(containers.companyId, companies.id))
        .where(and(...conditions))
        .orderBy(isOffloaded ? sql`${containers.offloadDate} DESC NULLS LAST` : sql`${containers.importDate} DESC NULLS LAST`);

      const totalItemsTotal = containerData.reduce(
        (sum, c) => sum + parseFloat(c.itemsTotal || "0"),
        0,
      );
      const totalChargesTotal = containerData.reduce(
        (sum, c) => sum + parseFloat(c.chargesTotal || "0"),
        0,
      );
      const totalGrandTotal = containerData.reduce(
        (sum, c) => sum + parseFloat(c.grandTotal || "0"),
        0,
      );

      res.json({
        containers: containerData,
        summary: {
          totalContainers: containerData.length,
          totalItemsTotal,
          totalChargesTotal,
          totalGrandTotal,
        },
        filters: {
          status: status || null,
          supplierId: supplierId || null,
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Ratio Analysis Report
  app.get("/api/reports/ratios", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate } = req.query;

      // Get all ledger accounts
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations

      const incomeAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Income")
        .map((acc) => acc.id);
      const expenseAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Expense")
        .map((acc) => acc.id);
      const assetAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Asset")
        .map((acc) => acc.id);
      const liabilityAccountIds = companyAccounts
        .filter((acc) => acc.accountType === "Liability")
        .map((acc) => acc.id);

      // Get vouchers with date filter
      const conditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        conditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        conditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const companyVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(...conditions))
        .execute();

      const companyVoucherIds = companyVouchers.map((v) => v.id);

      const companyEntries =
        companyVoucherIds.length > 0
          ? await db
              .select()
              .from(voucherEntries)
              .where(inArray(voucherEntries.voucherId, companyVoucherIds))
              .execute()
          : [];

      // Calculate totals
      let totalIncome = 0;
      let totalExpenses = 0;
      let totalAssets = 0;
      let totalLiabilities = 0;

      for (const entry of companyEntries) {
        const debit = parseFloat(entry.debitAmount || "0");
        const credit = parseFloat(entry.creditAmount || "0");

        if (entry.ledgerAccountId) {
          if (incomeAccountIds.includes(entry.ledgerAccountId)) {
            totalIncome += credit - debit;
          }
          if (expenseAccountIds.includes(entry.ledgerAccountId)) {
            totalExpenses += debit - credit;
          }
          if (assetAccountIds.includes(entry.ledgerAccountId)) {
            totalAssets += debit - credit;
          }
          if (liabilityAccountIds.includes(entry.ledgerAccountId)) {
            totalLiabilities += credit - debit;
          }
        }
      }

      // Get sales data for gross profit calculation
      const salesConditions = [eq(vouchers.companyId, companyId)];
      if (startDate) {
        salesConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
      }
      if (endDate) {
        salesConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
      }

      const salesData = await db
        .select({
          totalSales: salesItems.totalSales,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(...salesConditions))
        .execute();

      const totalSales = salesData.reduce(
        (sum, s) => sum + parseFloat(s.totalSales),
        0,
      );
      const totalCost = salesData.reduce(
        (sum, s) => sum + parseFloat(s.totalCost),
        0,
      );
      const grossProfit = totalSales - totalCost;

      // Calculate ratios
      const netProfit = totalIncome - totalExpenses;
      const grossProfitMargin =
        totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;
      const netProfitMargin =
        totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
      const currentRatio =
        totalLiabilities > 0 ? totalAssets / totalLiabilities : 0;
      const debtToEquity =
        totalAssets - totalLiabilities > 0
          ? totalLiabilities / (totalAssets - totalLiabilities)
          : 0;

      res.json({
        ratios: {
          grossProfitMargin,
          netProfitMargin,
          currentRatio,
          debtToEquity,
        },
        underlying: {
          totalIncome,
          totalExpenses,
          totalSales,
          totalCost,
          grossProfit,
          netProfit,
          totalAssets,
          totalLiabilities,
          totalEquity: totalAssets - totalLiabilities,
        },
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Opening Stock Summary Report - shows stock groups with opening/closing balances
  app.get("/api/reports/opening-stock-summary", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { locationId, stockGroupId } = req.query;

      // Get all stock groups for the company
      const allStockGroups = await storage.getAllStockGroups(companyId);
      
      // Get all stock items for the company
      const allStockItems = await storage.getAllStockItems(companyId);
      
      // Get inventory data with optional location filter
      // IMPORTANT: Use innerJoin + active=true to exclude inventory from deleted/inactive locations
      let inventoryData;
      if (locationId && locationId !== "all") {
        inventoryData = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            locationId: inventory.locationId,
            locationName: locations.name,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(
            and(
              eq(inventory.companyId, companyId),
              eq(inventory.locationId, parseInt(locationId as string)),
              eq(locations.active, true)
            )
          )
          .execute();
      } else {
        inventoryData = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
            locationId: inventory.locationId,
            locationName: locations.name,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(
            and(
              eq(inventory.companyId, companyId),
              eq(locations.active, true)
            )
          )
          .execute();
      }

      // Create a map of stock item ID to inventory aggregated across locations
      // Calculate value dynamically as qty * averageRate
      const inventoryByItem = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of inventoryData) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;
        
        if (inventoryByItem.has(inv.stockItemId)) {
          const existing = inventoryByItem.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          inventoryByItem.set(inv.stockItemId, {
            quantity: qty,
            totalValue: val,
          });
        }
      }

      // Build stock groups summary
      const stockGroupSummary = allStockGroups.map((group) => {
        // Get items in this group
        const groupItems = allStockItems.filter((item) => item.stockGroupId === group.id);
        
        // Calculate opening balance from stock items
        let openingQty = 0;
        let openingValue = 0;
        
        // Calculate closing balance from inventory
        let closingQty = 0;
        let closingValue = 0;

        for (const item of groupItems) {
          // Opening balance from stock item master data
          const itemOpeningQty = parseFloat(item.openingQty || "0");
          const itemOpeningValue = parseFloat(item.openingValue || "0");
          openingQty += itemOpeningQty;
          openingValue += itemOpeningValue;

          // Closing balance from current inventory
          const inv = inventoryByItem.get(item.id);
          if (inv) {
            closingQty += inv.quantity;
            closingValue += inv.totalValue;
          }
        }

        return {
          id: group.id,
          code: group.code,
          name: group.name,
          opening: {
            quantity: openingQty,
            rate: openingQty > 0 ? openingValue / openingQty : 0,
            value: openingValue,
          },
          closing: {
            quantity: closingQty,
            rate: closingQty > 0 ? closingValue / closingQty : 0,
            value: closingValue,
          },
          itemCount: groupItems.length,
        };
      }).filter((g) => g.opening.quantity > 0 || g.closing.quantity > 0);

      // Calculate grand totals
      const grandTotal = {
        opening: {
          quantity: stockGroupSummary.reduce((sum, g) => sum + g.opening.quantity, 0),
          value: stockGroupSummary.reduce((sum, g) => sum + g.opening.value, 0),
        },
        closing: {
          quantity: stockGroupSummary.reduce((sum, g) => sum + g.closing.quantity, 0),
          value: stockGroupSummary.reduce((sum, g) => sum + g.closing.value, 0),
        },
      };

      res.json({
        stockGroups: stockGroupSummary,
        grandTotal,
        filters: {
          locationId: locationId || null,
        },
        notes: {
          opening: "Opening balances are from stock item master data (not location-specific)",
          closing: locationId && locationId !== "all" 
            ? "Closing balances are filtered by the selected location" 
            : "Closing balances are aggregated across all locations",
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get stock items for a specific stock group (drill-down)
  app.get("/api/reports/opening-stock-summary/:stockGroupId/items", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { stockGroupId } = req.params;
      const { locationId } = req.query;

      // Get stock items in this group
      const groupItems = await db
        .select()
        .from(stockItems)
        .where(
          and(
            eq(stockItems.companyId, companyId),
            eq(stockItems.stockGroupId, parseInt(stockGroupId))
          )
        )
        .execute();

      // Get inventory data for these items
      // IMPORTANT: Use innerJoin + active=true to exclude inventory from deleted/inactive locations
      const itemIds = groupItems.map((i) => i.id);
      
      let inventoryData: any[] = [];
      if (itemIds.length > 0) {
        const conditions = [
          eq(inventory.companyId, companyId),
          inArray(inventory.stockItemId, itemIds),
          eq(locations.active, true),
        ];
        if (locationId && locationId !== "all") {
          conditions.push(eq(inventory.locationId, parseInt(locationId as string)));
        }
        
        inventoryData = await db
          .select({
            stockItemId: inventory.stockItemId,
            quantity: inventory.quantity,
            averageRate: inventory.averageRate,
          })
          .from(inventory)
          .innerJoin(locations, eq(inventory.locationId, locations.id))
          .where(and(...conditions))
          .execute();
      }

      // Create inventory map aggregated by item
      // Calculate value dynamically as qty * averageRate
      const inventoryByItem = new Map<number, { quantity: number; totalValue: number }>();
      for (const inv of inventoryData) {
        const qty = parseFloat(inv.quantity) || 0;
        const rate = parseFloat(inv.averageRate) || 0;
        const val = qty * rate;
        
        if (inventoryByItem.has(inv.stockItemId)) {
          const existing = inventoryByItem.get(inv.stockItemId)!;
          existing.quantity += qty;
          existing.totalValue += val;
        } else {
          inventoryByItem.set(inv.stockItemId, {
            quantity: qty,
            totalValue: val,
          });
        }
      }

      // Build items with opening and closing balances
      const items = groupItems.map((item) => {
        const openingQty = parseFloat(item.openingQty || "0");
        const openingRate = parseFloat(item.openingRate || "0");
        const openingValue = parseFloat(item.openingValue || "0");

        const inv = inventoryByItem.get(item.id);
        const closingQty = inv?.quantity || 0;
        const closingValue = inv?.totalValue || 0;
        const closingRate = closingQty > 0 ? closingValue / closingQty : 0;

        return {
          id: item.id,
          code: item.code,
          name: item.name,
          uom: item.uom,
          opening: {
            quantity: openingQty,
            rate: openingRate,
            value: openingValue,
          },
          closing: {
            quantity: closingQty,
            rate: closingRate,
            value: closingValue,
          },
        };
      }).filter((i) => i.opening.quantity > 0 || i.closing.quantity > 0);

      // Calculate totals
      const grandTotal = {
        opening: {
          quantity: items.reduce((sum, i) => sum + i.opening.quantity, 0),
          value: items.reduce((sum, i) => sum + i.opening.value, 0),
        },
        closing: {
          quantity: items.reduce((sum, i) => sum + i.closing.quantity, 0),
          value: items.reduce((sum, i) => sum + i.closing.value, 0),
        },
      };

      // Get stock group info
      const stockGroup = await storage.getStockGroupById(parseInt(stockGroupId), companyId);

      res.json({
        items,
        grandTotal,
        stockGroup: stockGroup ? {
          id: stockGroup.id,
          code: stockGroup.code,
          name: stockGroup.name,
        } : null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Debug endpoint: Check raw inventory records for a specific stock item
}
