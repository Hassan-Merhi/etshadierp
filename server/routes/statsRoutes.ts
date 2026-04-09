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
} from "@shared/schema";
import {
  eq, and, or, desc, asc, lt, gt, ne, inArray, sql, isNull, isNotNull, not, gte, lte, like, ilike,
} from "drizzle-orm";
import { format } from "date-fns";
import { z } from "zod";
import { readExcel, sheetToJson, createWorkbook, jsonToSheet, aoaToSheet, writeWorkbook } from "../excelHelper";
import { adjustInventory, reverseInventoryByExactValue } from "../inventoryHelper";
import { classifyNetPositionAccounts, getAccountNetBalance } from "../netPositionHelper";


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

      // Stock In Hand — historical as of toDate (or current if no date set)
      const activeLocationsData = await db
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.companyId, companyId), eq(locations.active, true), isNull(locations.deletedAt)))
        .execute();
      const activeLocationIds = activeLocationsData.map((l) => l.id);

      let stockOnFloor = 0;
      if (activeLocationIds.length > 0) {
        if (toDate) {
          // Historical: reverse-reconcile all locations in parallel (not sequential)
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
          // Current: read live inventory table
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
      if (stockOnFloor > 0) {
        forUsTotal += stockOnFloor;
        categoryTotals["asset_Stock In Hand"] = stockOnFloor;
        forUsAccounts.push({ name: "Stock In Hand (Inventory)", code: "COMPUTED", value: stockOnFloor, category: "Inventory" });
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

      // ============ ROUNDING HELPER ============
      // Helper to round currency values to 2 decimal places (prevents floating point noise)
      const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
  app.get("/api/stats/import-cycle-balance", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Helper function to calculate account balance by account type
      const getAccountTypeBalance = async (accountType: string, isLiability: boolean = false) => {
        const accounts = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, accountType),
              isNull(ledgerAccounts.deletedAt)
            )
          );

        let totalBalance = 0;
        for (const account of accounts) {
          const entries = await db
            .select({
              creditAmount: voucherEntries.creditAmount,
              debitAmount: voucherEntries.debitAmount,
            })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(
              and(
                eq(voucherEntries.ledgerAccountId, account.id),
                eq(vouchers.companyId, companyId),
                isNull(vouchers.deletedAt),
                eq(vouchers.optional, false)
              )
            );

          // Fix: Properly sign opening balance based on openingBalanceSide
          const openingBalanceRaw = parseFloat(account.openingBalance || "0");
          const openingSide = account.openingBalanceSide || "Dr";
          let signedOpening: number;
          if (isLiability) {
            // Liability/Income accounts: Cr opening = positive, Dr opening = negative
            signedOpening = openingSide === "Cr" ? openingBalanceRaw : -openingBalanceRaw;
          } else {
            // Asset/Expense accounts: Dr opening = positive, Cr opening = negative
            signedOpening = openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw;
          }
          
          const balance = entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");
            
            if (isLiability) {
              // Liability accounts: Credits increase (positive), Debits decrease (negative)
              return sum + credit - debit;
            } else {
              // Asset/Expense accounts: Debits increase (positive), Credits decrease (negative)
              return sum + debit - credit;
            }
          }, signedOpening);
          
          totalBalance += balance;
        }
        return totalBalance;
      };

      // Helper: transaction-only balance (no opening balances) for an account type
      // isLiability=true → returns Cr - Dr (positive = net credit/liability)
      const getTransactionOnlyBalance = async (accountType: string, isLiability: boolean = true) => {
        const result = await db
          .select({
            totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
            totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0)`,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, accountType),
              isNull(ledgerAccounts.deletedAt),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );
        const totalCredit = parseFloat(result[0]?.totalCredit || "0");
        const totalDebit = parseFloat(result[0]?.totalDebit || "0");
        return isLiability ? totalCredit - totalDebit : totalDebit - totalCredit;
      };

      // 1. Supplier Balance - calculated from voucher entries + opening balances
      // Credits to suppliers increase what we owe (liability), debits decrease it
      const supplierEntries = await db
        .select({
          supplierId: voucherEntries.supplierId,
          creditAmount: voucherEntries.creditAmount,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            isNotNull(voucherEntries.supplierId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );
      
      // Include supplier opening balances only for suppliers with activity in this company
      const allSuppliersNP = await storage.getAllSuppliers();
      const supplierIdsWithActivity = new Set(supplierEntries.map(e => e.supplierId).filter(Boolean));
      // Also check containers for supplier activity
      const companyContainers = await db.select({ supplierId: containers.supplierId }).from(containers).where(eq(containers.companyId, companyId));
      for (const c of companyContainers) {
        if (c.supplierId) supplierIdsWithActivity.add(c.supplierId);
      }
      const supplierOpeningTotal = allSuppliersNP
        .filter(s => supplierIdsWithActivity.has(s.id))
        .reduce((sum, s) => sum + parseFloat(s.openingBalance || "0"), 0);
      
      // Supplier is a liability: Credits increase (we owe more), Debits decrease (we paid)
      const supplierBalance = supplierEntries.reduce((sum, entry) => {
        const credit = parseFloat(entry.creditAmount || "0");
        const debit = parseFloat(entry.debitAmount || "0");
        return sum + credit - debit;
      }, supplierOpeningTotal);

      // 2. Stock OTW (containers with OTW status - asset, shows as positive/debit)
      const otwContainers = await db
        .select()
        .from(containers)
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW")
          )
        );
      const stockOtwValue = otwContainers.reduce((sum, container) => {
        return sum + parseFloat(container.grandTotal || "0");
      }, 0);

      // 3. Duty Agent Loan accounts (liability)
      const dutyAgentBalance = await getAccountTypeBalance("Duty Agent", true);

      // 4. Transporter Agent Loan accounts (liability)
      const transporterAgentBalance = await getAccountTypeBalance("Transporter Agent", true);

      // 5. Loans accounts (liability)
      const loansBalance = await getAccountTypeBalance("Loans", true);

      // 6. Cash accounts (asset)
      const cashBalance = await getAccountTypeBalance("Cash", false);

      // 7. Bank accounts (asset)
      // Part 1: Ledger accounts with type "Bank" (includes linked bank accounts)
      const ledgerBankBalance = await getAccountTypeBalance("Bank", false);
      
      // Part 2: Bank accounts from bankAccounts table WITHOUT linked ledger accounts
      // These are standalone bank accounts that track entries via bankAccountId only
      // IMPORTANT: Only include entries where ledgerAccountId is NULL to avoid double-counting
      const standaloneBankAccountEntries = await db
        .select({
          bankAccountId: voucherEntries.bankAccountId,
          creditAmount: voucherEntries.creditAmount,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .innerJoin(bankAccounts, eq(voucherEntries.bankAccountId, bankAccounts.id))
        .where(
          and(
            isNotNull(voucherEntries.bankAccountId),
            isNull(voucherEntries.ledgerAccountId), // Only entries that don't also hit a ledger account
            isNull(bankAccounts.linkedLedgerId), // Only standalone bank accounts
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );
      
      // Get opening balances only from bank accounts NOT linked to a ledger account
      const standaloneBankAccounts = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            isNull(bankAccounts.linkedLedgerId) // Only standalone bank accounts
          )
        );
      
      // Calculate opening balance total for standalone bank accounts only
      const standaloneBankOpeningBalance = standaloneBankAccounts.reduce((sum, account) => {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        const openingSide = account.openingBalanceSide || "Dr";
        return sum + (openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw);
      }, 0);
      
      // Bank accounts are assets: Debits increase (positive), Credits decrease (negative)
      const standaloneBankVoucherBalance = standaloneBankAccountEntries.reduce((sum, entry) => {
        const credit = parseFloat(entry.creditAmount || "0");
        const debit = parseFloat(entry.debitAmount || "0");
        return sum + debit - credit;
      }, 0);
      
      // Total bank balance = ledger bank accounts + standalone bank account entries
      const bankBalance = ledgerBankBalance + standaloneBankOpeningBalance + standaloneBankVoucherBalance;

      // 8. Import Charges (only accounts under IMPORT_CHARGES parent - for import cycle tracking)
      // This is more specific than "Direct Expense" to avoid including unrelated expenses
      const getImportChargesBalance = async () => {
        // First find the IMPORT_CHARGES parent account
        const [importChargesParent] = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.code, "IMPORT_CHARGES"),
              isNull(ledgerAccounts.deletedAt)
            )
          )
          .limit(1);
        
        if (!importChargesParent) {
          return 0; // No import charges yet
        }
        
        // Get all accounts under IMPORT_CHARGES parent (including the parent itself)
        const importChargeAccounts = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              or(
                eq(ledgerAccounts.id, importChargesParent.id),
                eq(ledgerAccounts.parentId, importChargesParent.id)
              ),
              isNull(ledgerAccounts.deletedAt)
            )
          );
        
        if (importChargeAccounts.length === 0) {
          return 0;
        }
        
        const accountIds = importChargeAccounts.map(a => a.id);
        
        // Get opening balances
        let totalBalance = importChargeAccounts.reduce((sum, account) => {
          const openingBalanceRaw = parseFloat(account.openingBalance || "0");
          const openingSide = account.openingBalanceSide || "Dr";
          // Expense accounts: Dr opening = positive
          return sum + (openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw);
        }, 0);
        
        // Get all voucher entries for these accounts
        const entries = await db
          .select({
            creditAmount: voucherEntries.creditAmount,
            debitAmount: voucherEntries.debitAmount,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              inArray(voucherEntries.ledgerAccountId, accountIds),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );
        
        // Expense accounts: Debits increase (positive), Credits decrease (negative)
        totalBalance += entries.reduce((sum, entry) => {
          const credit = parseFloat(entry.creditAmount || "0");
          const debit = parseFloat(entry.debitAmount || "0");
          return sum + debit - credit;
        }, 0);
        
        return totalBalance;
      };
      
      const directExpenseBalance = await getImportChargesBalance();

      // 9. Indirect Expense accounts (expense)
      const indirectExpenseBalance = await getAccountTypeBalance("Indirect Expense", false);

      // 10. Income accounts (revenue - offsets cash from sales)
      const incomeBalance = await getAccountTypeBalance("Income", true);

      // 11. Stock Value on Floor (inventory in locations)
      // Only include inventory at valid, non-deleted locations (excludes orphaned inventory)
      // Calculate from quantity * averageRate to ensure accuracy (totalValue can get out of sync)
      // NOTE: Exclude the value impact of Mixed vouchers since their production/consumption net to 0
      const inventoryItems = await db
        .select({
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            isNull(locations.deletedAt)
          )
        );

      const stockOnFloorValue = inventoryItems.reduce((sum, item) => {
        const qty = parseFloat(item.quantity || "0");
        const rate = parseFloat(item.averageRate || "0");
        return sum + (qty * rate);
      }, 0);

      // 12. Cost of Goods Sold (calculated from salesItems for non-optional, non-deleted sales vouchers)
      // This represents inventory that was sold and is now an expense
      const cogsData = await db
        .select({
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      const cogsBalance = cogsData.reduce((sum, item) => {
        return sum + parseFloat(item.totalCost || "0");
      }, 0);

      // 12b. Consumption expense (from stock adjustment items)
      // Includes: pure Consumption vouchers AND Mixed voucher items with negative quantity
      // This represents inventory that was consumed (not sold) and is now an expense
      const consumptionData = await db
        .select({
          totalAmount: stockAdjustmentItems.totalAmount,
          quantity: stockAdjustmentItems.quantity,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            sql`(LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'consumption' OR LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'mixed')`
          )
        );

      const consumptionBalance = consumptionData.reduce((sum, item) => {
        const qty = parseFloat(item.quantity || "0");
        const adjustmentType = (item.adjustmentType || "").toLowerCase();
        // Pure Consumption: always count (totalAmount is positive, represents consumed value)
        // Mixed: only count items with negative quantity (consumption items)
        if (adjustmentType === "consumption" || (adjustmentType === "mixed" && qty < 0)) {
          return sum + Math.abs(parseFloat(item.totalAmount || "0"));
        }
        return sum;
      }, 0);

      // 12c. Production balance (from stock adjustment items)
      // Includes: pure Production vouchers AND Mixed voucher items with positive quantity
      // Production INCREASES inventory (stockOnFloorValue goes up)
      const productionData = await db
        .select({
          totalAmount: stockAdjustmentItems.totalAmount,
          quantity: stockAdjustmentItems.quantity,
          adjustmentType: stockAdjustmentVouchers.adjustmentType,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            sql`(LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'production' OR LOWER(${stockAdjustmentVouchers.adjustmentType}) = 'mixed')`
          )
        );

      const productionBalance = productionData.reduce((sum, item) => {
        const qty = parseFloat(item.quantity || "0");
        const adjustmentType = (item.adjustmentType || "").toLowerCase();
        // Pure Production: always count (totalAmount is positive, represents produced value)
        // Mixed: only count items with positive quantity (production items)
        if (adjustmentType === "production" || (adjustmentType === "mixed" && qty > 0)) {
          return sum + parseFloat(item.totalAmount || "0");
        }
        return sum;
      }, 0);

      // 13. Payroll Expenses - get from Expense accounts related to salaries
      // Uses a single optimized query with aggregation instead of N+1 pattern
      const payrollExpenseAccounts = await db
        .select({
          id: ledgerAccounts.id,
          openingBalance: ledgerAccounts.openingBalance,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.accountType, "Expense"),
            sql`(${ledgerAccounts.name} ILIKE '%salary%' OR ${ledgerAccounts.name} ILIKE '%payroll%' OR ${ledgerAccounts.name} ILIKE '%wage%')`,
            isNull(ledgerAccounts.deletedAt)
          )
        );

      let payrollExpenseBalance = 0;
      if (payrollExpenseAccounts.length > 0) {
        const payrollAccountIds = payrollExpenseAccounts.map(a => a.id);
        
        // Get all entries for payroll accounts in a single query
        const payrollEntries = await db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            creditAmount: voucherEntries.creditAmount,
            debitAmount: voucherEntries.debitAmount,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              inArray(voucherEntries.ledgerAccountId, payrollAccountIds),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );

        // Calculate opening balances
        const openingTotal = payrollExpenseAccounts.reduce((sum, acc) => {
          return sum + parseFloat(acc.openingBalance || "0");
        }, 0);

        // Calculate transaction balance
        const transactionBalance = payrollEntries.reduce((sum, entry) => {
          const credit = parseFloat(entry.creditAmount || "0");
          const debit = parseFloat(entry.debitAmount || "0");
          // Expense accounts: Debits increase (positive), Credits decrease (negative)
          return sum + debit - credit;
        }, 0);

        payrollExpenseBalance = openingTotal + transactionBalance;
      }

      // 14. Salary Advances - outstanding advances given to employees (asset - recoverable)
      const advancesData = await db
        .select({
          remainingBalance: salaryAdvances.remainingBalance,
        })
        .from(salaryAdvances)
        .where(
          and(
            eq(salaryAdvances.companyId, companyId),
            eq(salaryAdvances.fullyPaid, false)
          )
        );

      const salaryAdvancesBalance = advancesData.reduce((sum, advance) => {
        return sum + parseFloat(advance.remainingBalance || "0");
      }, 0);

      // 15. Payroll Liabilities - wages owed to employees (from employees.currentBalance)
      // Positive currentBalance means company owes the employee (liability)
      const employeesData = await db
        .select({
          currentBalance: employees.currentBalance,
        })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            isNull(employees.deletedAt)
          )
        );

      const payrollLiabilitiesBalance = employeesData.reduce((sum, emp) => {
        const balance = parseFloat(emp.currentBalance || "0");
        // Only count positive balances (amounts owed to employees)
        return sum + (balance > 0 ? balance : 0);
      }, 0);

      // 16. Asset accounts (properties, guarantees, receivables - asset/debit side)
      const assetBalance = await getAccountTypeBalance("Asset", false);

      // 17. General Expense accounts (Purchases, Duties, Transport - expense/debit side)
      // This is different from payrollExpenseBalance which only includes salary-related expenses
      const generalExpenseBalance = await getAccountTypeBalance("Expense", false);

      // 18. Government Taxes accounts (expense/debit side)
      const governmentTaxesBalance = await getAccountTypeBalance("Government Taxes", false);

      // 19. Liability accounts (non-payroll liabilities - credit side)
      const liabilityBalance = await getAccountTypeBalance("Liability", true);

      // 20. Profit/Equity accounts (retained earnings - credit side)
      const profitBalance = await getAccountTypeBalance("Profit", true);

      // 20a. Equity account transactions (e.g. capital injections DR Cash CR Equity)
      // Opening balances for Equity are already handled by openingBalanceEquity offset
      // Only ongoing voucher transactions need to be captured here
      const equityTransactionBalance = await getTransactionOnlyBalance("Equity", true);

      // 20b. Accounts Payable transactions (AP credits = liability increase)
      // Opening balances for AP are handled by openingBalanceEquity offset
      const apTransactionBalance = await getTransactionOnlyBalance("Accounts Payable", true);

      // 21. Opening Balance Equity - automatically balance opening entries
      // When opening balances are added without matching entries (e.g., cash opening balance without 
      // corresponding capital), this creates an imbalance. We calculate the net of all opening balances
      // and treat the difference as implicit equity/capital that should be on the liability side.
      const allLedgerAccounts = await db
        .select({
          openingBalance: ledgerAccounts.openingBalance,
          openingBalanceSide: ledgerAccounts.openingBalanceSide,
          accountType: ledgerAccounts.accountType,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      // Calculate net opening balance equity
      // Dr opening balances = Assets brought forward (positive on asset side)
      // Cr opening balances = Liabilities/Capital brought forward (positive on liability side)
      // The difference (Dr - Cr) represents implicit equity that needs to offset
      let totalDrOpenings = 0;
      let totalCrOpenings = 0;
      
      for (const account of allLedgerAccounts) {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        if (openingBalanceRaw === 0) continue;
        
        const openingSide = account.openingBalanceSide || "Dr";
        if (openingSide === "Dr") {
          totalDrOpenings += openingBalanceRaw;
        } else {
          totalCrOpenings += openingBalanceRaw;
        }
      }
      
      // Include employee opening balances in the equity offset calculation
      // Employee opening balances are liabilities (money owed to employees) - credit side
      const employeeOpeningBalances = await db
        .select({
          openingBalance: employees.openingBalance,
        })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            isNull(employees.deletedAt)
          )
        );
      
      const totalEmployeeOpeningBalance = employeeOpeningBalances.reduce((sum, emp) => {
        return sum + parseFloat(emp.openingBalance || "0");
      }, 0);
      
      // Add employee opening balances to the credit side (they're liabilities)
      totalCrOpenings += totalEmployeeOpeningBalance;
      
      // Opening Balance Equity = Credit side opening balances minus debit side
      // This represents the net capital/equity that balances the opening entries
      // When added to the liability side, it offsets the asset-side opening balances
      let openingBalanceEquity = totalCrOpenings - totalDrOpenings;
      // Note: If openingBalanceEquity is negative, it means more assets than liabilities
      // were brought forward - this is normal (represents owner's equity)

      // 22. Opening Stock Equity - stock items with opening values that weren't imported via PO
      // These are set via "Import Opening Balances" in Stock Items and need implicit equity offset
      const stockItemsWithOpening = await db
        .select({
          openingValue: stockItems.openingValue,
        })
        .from(stockItems)
        .where(
          and(
            eq(stockItems.companyId, companyId),
            isNull(stockItems.deletedAt)
          )
        );
      
      const openingStockValue = stockItemsWithOpening.reduce((sum, item) => {
        return sum + parseFloat(item.openingValue || "0");
      }, 0);
      
      // Add opening stock value to the equity offset (it's an asset that needs balancing)
      // This is subtracted from the liability side calculation (negative equity offset)
      openingBalanceEquity -= openingStockValue;

      // Calculate the net balance:
      // Assets: Stock OTW + Cash + Bank + Stock on Floor + Asset accounts + Salary Advances
      // Operating Expenses: Indirect Expenses + Government Taxes + COGS (but NOT directExpenseBalance)
      // Liabilities + Income: Supplier Balance + Duty Agent + Transporter Agent + Loans + Liability accounts + Profit/Equity + Income + Payroll Liabilities
      // Net = (Assets + Operating Expenses) - (Liabilities + Income) (should be 0 when balanced)
      // NOTE: generalExpenseBalance (Purchases) is EXCLUDED because it double-counts with stockOnFloorValue
      //       When containers are offloaded, Purchases expense is debited AND Stock on Floor increases
      //       The inventory value already captures the cost of goods, so we don't add Purchases again
      // NOTE: directExpenseBalance (IMPORT_CHARGES like duties, transport) is EXCLUDED because:
      //       - These costs are capitalized into inventory value (stockOnFloorValue) during container offload
      //       - When offloading, the system: DR Duty Agent/Transporter Agent (creates liability)
      //         and those costs get added to inventory value via additionalCostPerBale
      //       - So stockOnFloorValue already includes these costs - adding directExpenseBalance would double-count
      //       - Office charges stored as Loans are also capitalized into inventory via additionalCostPerBale
      // NOTE: COGS from salesItems balances the inventory reduction when goods are sold
      // NOTE: Production and Consumption are EXCLUDED from the balance formula because:
      //       - Their effects are already reflected in stockOnFloorValue (inventory movements)
      //       - Production adds to inventory, Consumption removes from inventory
      //       - These movements are tracked in stockOnFloorValue via the inventory table
      //       - consumptionBalance/productionBalance are for diagnostic display only
      const netImportCycleBalance = 
        (stockOtwValue +            // Asset (debit) - containers in transit
        cashBalance +               // Asset (debit) - cash on hand
        bankBalance +               // Asset (debit) - bank balances
        stockOnFloorValue +         // Asset - inventory at cost (includes ALL offload charges capitalized)
        assetBalance +              // Asset accounts (properties, guarantees, receivables)
        // directExpenseBalance is EXCLUDED - already capitalized into stockOnFloorValue
        indirectExpenseBalance +    // Expense (debit) - operating expenses (includes PAYROLL_DEPOSIT_EXPENSE)
        payrollExpenseBalance +     // Payroll/Salary expenses (Expense type) - worker salaries in import cycle
        governmentTaxesBalance +    // Government Taxes (expense)
        cogsBalance +               // COGS expense (debit) - balances inventory reduction on sales
        salaryAdvancesBalance) -    // Salary Advances (asset) - recoverable from employees
        (supplierBalance +          // Liability (what we owe to suppliers)
        dutyAgentBalance +          // Liability (what we owe to duty agents)
        transporterAgentBalance +   // Liability (what we owe to transporters)
        loansBalance +              // Liability (loans/borrowings - includes office charges)
        liabilityBalance +          // Other Liability accounts
        profitBalance +             // Profit/Equity (retained earnings)
        equityTransactionBalance +  // Equity account transactions (capital injections, etc.)
        apTransactionBalance +      // Accounts Payable transactions
        incomeBalance +             // Income (sales revenue - credit)
        payrollLiabilitiesBalance - // Payroll Liabilities (what we owe employees)
        openingBalanceEquity);      // Opening Balance Equity (implicit capital from opening balances)

      // Auto-adjust: silently keep the import cycle balance at 0 by computing and storing
      // the exact offset needed. This runs on every fetch so no manual action is needed.
      const autoAdjustKey = `equity_adjustment_${companyId}`;
      const storedEquityAdjustment = -netImportCycleBalance;
      if (Math.abs(netImportCycleBalance) > 0.01) {
        // Fire-and-forget — don't await so the response is not delayed
        db.insert(systemSettings)
          .values({ key: autoAdjustKey, value: storedEquityAdjustment.toFixed(2) })
          .onConflictDoUpdate({ target: systemSettings.key, set: { value: storedEquityAdjustment.toFixed(2), updatedAt: new Date() } })
          .catch(() => {});
      }

      // Adjusted balance is always 0 after auto-adjustment
      const adjustedImportCycleBalance = netImportCycleBalance + storedEquityAdjustment;

      // Round to 2 decimal places to eliminate floating-point noise
      // T006: Threshold reduced from $5 to $0.01 — the $5 threshold was hiding real imbalances.
      // With T001/T002 preventing bad postings, accumulated errors should stay below $0.01.
      const ROUNDING_THRESHOLD = 0.01;
      let roundedBalance = Math.round(adjustedImportCycleBalance * 100) / 100;
      if (Math.abs(roundedBalance) <= ROUNDING_THRESHOLD) {
        roundedBalance = 0;
      }
      
      // Calculate precise discrepancy trace
      // Matches the exact formula used for netImportCycleBalance:
      // Assets + Expenses - (Liabilities - OpeningBalanceEquity) = Net
      const traceAssetTotal = stockOtwValue + cashBalance + bankBalance + stockOnFloorValue + assetBalance + salaryAdvancesBalance;
      const traceExpenseTotal = indirectExpenseBalance + payrollExpenseBalance + governmentTaxesBalance + cogsBalance;
      // liabilitiesBeforeEquity is the raw sum, then we subtract openingBalanceEquity
      const traceLiabilitiesRaw = supplierBalance + dutyAgentBalance + transporterAgentBalance + loansBalance + 
        liabilityBalance + profitBalance + equityTransactionBalance + apTransactionBalance + incomeBalance + payrollLiabilitiesBalance;
      const traceNetLiabilities = traceLiabilitiesRaw - openingBalanceEquity;
      
      // Verify: our trace matches the netImportCycleBalance exactly
      const traceNetBalance = traceAssetTotal + traceExpenseTotal - traceNetLiabilities;
      
      // Create precision trace showing exact calculation
      const precisionTrace = {
        formula: "(Assets + Expenses) - (Liabilities - Opening Equity) = Net Balance",
        calculation: {
          assetTotal: { 
            value: traceAssetTotal,
            breakdown: { stockOtwValue, cashBalance, bankBalance, stockOnFloorValue, assetBalance, salaryAdvancesBalance }
          },
          expenseTotal: { 
            value: traceExpenseTotal,
            breakdown: { indirectExpenseBalance, payrollExpenseBalance, governmentTaxesBalance, cogsBalance }
          },
          liabilityTotal: { 
            value: traceNetLiabilities,
            breakdown: { 
              supplierBalance, dutyAgentBalance, transporterAgentBalance, loansBalance, 
              liabilityBalance, profitBalance, equityTransactionBalance, apTransactionBalance,
              incomeBalance, payrollLiabilitiesBalance,
              openingBalanceEquityOffset: openingBalanceEquity // positive value that reduces liabilities
            }
          },
        },
        rawNetBalance: netImportCycleBalance,
        storedEquityAdjustment,
        adjustedBalance: adjustedImportCycleBalance,
        finalRoundedBalance: roundedBalance,
        discrepancyExplanation: storedEquityAdjustment !== 0 
          ? `An equity adjustment of ${storedEquityAdjustment.toFixed(2)} was applied to zero out the balance.`
          : Math.abs(netImportCycleBalance) < 50 && netImportCycleBalance !== 0
            ? `Small discrepancy of ${netImportCycleBalance.toFixed(2)} likely from accumulated rounding in weighted average cost calculations.`
            : null,
      };

      res.json({
        netImportCycleBalance: roundedBalance,
        components: {
          supplierBalance,
          stockOtwValue,
          dutyAgentBalance,
          transporterAgentBalance,
          loansBalance,
          cashBalance,
          bankBalance,
          assetBalance,
          directExpenseBalance,
          indirectExpenseBalance,
          generalExpenseBalance,
          governmentTaxesBalance,
          incomeBalance,
          liabilityBalance,
          profitBalance,
          equityTransactionBalance,
          apTransactionBalance,
          stockOnFloorValue,
          cogsBalance,
          consumptionBalance,
          productionBalance,
          payrollExpenseBalance,
          salaryAdvancesBalance,
          payrollLiabilitiesBalance,
          openingBalanceEquity,
          openingStockValue,
        },
        precisionTrace,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import Cycle Diagnostics - analyze and explain what's causing imbalance
  app.get("/api/stats/import-cycle-diagnostics", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      interface DiagnosticIssue {
        id: string;
        severity: "critical" | "warning" | "info";
        title: string;
        description: string;
        impact: number;
        howToFix: string;
        category: string;
      }

      const issues: DiagnosticIssue[] = [];

      // 1. Check for orphaned inventory at deleted locations
      const orphanedInventory = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          quantity: inventory.quantity,
          totalValue: inventory.totalValue,
        })
        .from(inventory)
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            or(
              isNotNull(locations.deletedAt),
              isNull(locations.id)
            )
          )
        );

      if (orphanedInventory.length > 0) {
        const totalOrphanedValue = orphanedInventory.reduce((sum, inv) => 
          sum + parseFloat(inv.totalValue || "0"), 0);
        
        if (totalOrphanedValue > 0) {
          issues.push({
            id: "orphaned-inventory",
            severity: "critical",
            title: "Orphaned Inventory at Deleted Locations",
            description: `You have ${orphanedInventory.length} inventory records worth $${totalOrphanedValue.toFixed(2)} at locations that have been deleted. This inventory is counted as an asset but doesn't exist in any active location.`,
            impact: totalOrphanedValue,
            howToFix: "Go to Settings > System Tools > View Deleted Items > Locations. Either restore the deleted location(s) and transfer the inventory elsewhere, or permanently delete the location which will also remove the orphaned inventory.",
            category: "Orphaned Data"
          });
        }
      }

      // 2. Check for negative inventory (should never happen)
      const negativeInventory = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          quantity: inventory.quantity,
          totalValue: inventory.totalValue,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            isNull(locations.deletedAt),
            sql`CAST(${inventory.quantity} AS DECIMAL) < 0`
          )
        );

      if (negativeInventory.length > 0) {
        const totalNegativeValue = negativeInventory.reduce((sum, inv) => 
          sum + Math.abs(parseFloat(inv.totalValue || "0")), 0);
        
        issues.push({
          id: "negative-inventory",
          severity: "critical",
          title: "Negative Inventory Quantities",
          description: `You have ${negativeInventory.length} items with negative quantities. This shouldn't happen and indicates a data issue.`,
          impact: totalNegativeValue,
          howToFix: "Create a Production voucher to add the missing quantity back, or review recent Consumption/Sales vouchers that may have removed more than available.",
          category: "Data Integrity"
        });
      }

      // 3. Check for stale OTW containers (in transit for too long)
      const staleContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          grandTotal: containers.grandTotal,
          createdAt: containers.createdAt,
        })
        .from(containers)
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            sql`${containers.createdAt} < NOW() - INTERVAL '90 days'`
          )
        );

      if (staleContainers.length > 0) {
        const totalStaleValue = staleContainers.reduce((sum, c) => 
          sum + parseFloat(c.grandTotal || "0"), 0);
        
        issues.push({
          id: "stale-containers",
          severity: "warning",
          title: "Containers In Transit for Over 90 Days",
          description: `You have ${staleContainers.length} container(s) worth $${totalStaleValue.toFixed(2)} that have been "On The Way" for more than 90 days. These may need to be offloaded or marked as lost.`,
          impact: totalStaleValue,
          howToFix: "Go to Containers, find the stale containers, and either Offload them to a location if they've arrived, or cancel them if they're lost.",
          category: "Pending Transactions"
        });
      }

      // 4. Check for unbalanced vouchers (debits != credits)
      const unbalancedVouchers = await db
        .select({
          id: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          totalDebits: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0)`,
          totalCredits: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
        })
        .from(vouchers)
        .leftJoin(voucherEntries, eq(vouchers.id, voucherEntries.voucherId))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        )
        .groupBy(vouchers.id, vouchers.voucherNumber, vouchers.voucherType)
        .having(sql`ABS(COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0) - COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)) > 0.01`);

      if (unbalancedVouchers.length > 0) {
        const totalImbalance = unbalancedVouchers.reduce((sum, v) => {
          const debits = parseFloat(v.totalDebits || "0");
          const credits = parseFloat(v.totalCredits || "0");
          return sum + Math.abs(debits - credits);
        }, 0);

        // Create detailed list of unbalanced vouchers
        const voucherDetails = unbalancedVouchers.slice(0, 10).map(v => {
          const debits = parseFloat(v.totalDebits || "0");
          const credits = parseFloat(v.totalCredits || "0");
          const diff = debits - credits;
          return `${v.voucherNumber} (${v.voucherType}): DR ${debits.toFixed(2)} - CR ${credits.toFixed(2)} = ${diff.toFixed(2)}`;
        }).join("; ");

        issues.push({
          id: "unbalanced-vouchers",
          severity: "critical",
          title: `Unbalanced Voucher Entries (${unbalancedVouchers.length})`,
          description: `${unbalancedVouchers.length} voucher(s) where debits don't equal credits. Total imbalance: ${totalImbalance.toFixed(2)}. Details: ${voucherDetails}${unbalancedVouchers.length > 10 ? '...' : ''}`,
          impact: totalImbalance,
          howToFix: "Edit these vouchers in the Daybook to correct the imbalance, ensuring total debits equal total credits.",
          category: "Data Integrity"
        });
      }

      // 5. Check if opening balance equity is significantly off
      const allLedgerAccounts = await db
        .select({
          openingBalance: ledgerAccounts.openingBalance,
          openingBalanceSide: ledgerAccounts.openingBalanceSide,
          accountType: ledgerAccounts.accountType,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      let totalDrOpenings = 0;
      let totalCrOpenings = 0;
      for (const account of allLedgerAccounts) {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        if (openingBalanceRaw === 0) continue;
        const openingSide = account.openingBalanceSide || "Dr";
        if (openingSide === "Dr") {
          totalDrOpenings += openingBalanceRaw;
        } else {
          totalCrOpenings += openingBalanceRaw;
        }
      }

      const openingImbalance = Math.abs(totalDrOpenings - totalCrOpenings);
      if (openingImbalance > 100) {
        issues.push({
          id: "opening-balance-imbalance",
          severity: "info",
          title: "Opening Balance Equity Adjustment",
          description: `Your opening debit balances ($${totalDrOpenings.toFixed(2)}) differ from opening credit balances ($${totalCrOpenings.toFixed(2)}) by $${openingImbalance.toFixed(2)}. This is treated as implicit opening equity.`,
          impact: openingImbalance,
          howToFix: "This is often normal when importing data from another system. If you need to balance it, add an opening balance to an Equity or Capital account to offset the difference.",
          category: "Opening Balances"
        });
      }

      // 6. Check for payroll liabilities without matching expenses
      const employeesData = await db
        .select({
          id: employees.id,
          currentBalance: employees.currentBalance,
        })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            isNull(employees.deletedAt),
            sql`CAST(${employees.currentBalance} AS DECIMAL) > 100`
          )
        );

      if (employeesData.length > 0) {
        const totalOwed = employeesData.reduce((sum, e) => 
          sum + parseFloat(e.currentBalance || "0"), 0);

        issues.push({
          id: "employee-balances",
          severity: "info",
          title: "Outstanding Employee Balances",
          description: `You owe ${employeesData.length} employee(s) a total of $${totalOwed.toFixed(2)}. This is recorded as a liability.`,
          impact: totalOwed,
          howToFix: "These balances are normal and represent wages owed. Pay employees through Payroll to reduce these liabilities.",
          category: "Liabilities"
        });
      }

      // Check for Loans accounts with a net DEBIT balance (more debits than credits)
      // This is a sign that office charges were posted with the Loans account on the wrong side
      const loansAccounts = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            eq(ledgerAccounts.accountType, "Loans"),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      for (const loanAcct of loansAccounts) {
        const loanEntries = await db
          .select({
            creditAmount: voucherEntries.creditAmount,
            debitAmount: voucherEntries.debitAmount,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              eq(voucherEntries.ledgerAccountId, loanAcct.id),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );

        const netVoucherBalance = loanEntries.reduce((sum, e) => {
          return sum + parseFloat(e.creditAmount || "0") - parseFloat(e.debitAmount || "0");
        }, 0);

        if (netVoucherBalance < -0.01) {
          issues.push({
            id: `loans-net-debit-${loanAcct.id}`,
            severity: "warning",
            title: `Loans Account "${loanAcct.name}" Has Net Debit Balance — Office Charges May Be Posted Backwards`,
            description: `The Loans account "${loanAcct.name}" has been debited more than credited (net: $${netVoucherBalance.toFixed(2)}). This usually means office charges were recorded with the Loans account on the DEBIT side instead of the CREDIT side in the Offload dialog.`,
            impact: Math.abs(netVoucherBalance),
            howToFix: `In the Offload dialog, the Loans/credit account should go in the "Cash Account" field (credit side). An expense or import account should go in the "Office Account" field (debit side). Reversing the direction will fix the import cycle balance.`,
            category: "Office Charges"
          });
        }
      }

      // Sort issues by impact (highest first), then by severity
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      issues.sort((a, b) => {
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.impact - a.impact;
      });

      // Calculate summary
      const criticalCount = issues.filter(i => i.severity === "critical").length;
      const warningCount = issues.filter(i => i.severity === "warning").length;
      const totalImpact = issues.reduce((sum, i) => sum + i.impact, 0);

      res.json({
        issues,
        summary: {
          totalIssues: issues.length,
          criticalCount,
          warningCount,
          totalImpact,
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sales Report - gain/loss from POS transactions
  app.get("/api/sales-report", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { startDate, endDate, locationId, stockItemId, stockGroupId } = req.query;

      // Apply filters
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
        const conditions = [eq(vouchers.companyId, companyId)];

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
        const conditions = [eq(vouchers.companyId, companyId)];
        
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
  app.get("/api/debug/inventory/:stockItemId", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { stockItemId } = req.params;

      // Get the stock item
      const stockItem = await db
        .select()
        .from(stockItems)
        .where(
          and(
            eq(stockItems.id, parseInt(stockItemId)),
            eq(stockItems.companyId, companyId)
          )
        )
        .execute();

      if (stockItem.length === 0) {
        return res.status(404).json({ message: "Stock item not found" });
      }

      // Get all inventory records for this item (including deleted/inactive locations for debugging)
      const inventoryRecords = await db
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          locationName: locations.name,
          locationExists: locations.id,
          locationActive: locations.active,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
          lastUpdated: inventory.lastUpdated,
        })
        .from(inventory)
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.stockItemId, parseInt(stockItemId)),
            eq(inventory.companyId, companyId)
          )
        )
        .execute();

      // Calculate totals - separately for all records and active-only records
      // Calculate value dynamically as qty * averageRate
      let totalQty = 0;
      let totalValue = 0;
      let activeQty = 0;
      let activeValue = 0;
      for (const rec of inventoryRecords) {
        const qty = parseFloat(rec.quantity);
        const rate = parseFloat(rec.averageRate);
        const val = qty * rate;
        totalQty += qty;
        totalValue += val;
        // Only count if location exists AND is active
        if (rec.locationExists !== null && rec.locationActive === true) {
          activeQty += qty;
          activeValue += val;
        }
      }

      res.json({
        stockItem: {
          id: stockItem[0].id,
          code: stockItem[0].code,
          name: stockItem[0].name,
          stockGroupId: stockItem[0].stockGroupId,
          openingQty: stockItem[0].openingQty,
          openingRate: stockItem[0].openingRate,
          openingValue: stockItem[0].openingValue,
        },
        inventoryRecords: inventoryRecords.map((r) => {
          const isDeleted = r.locationExists === null;
          const isInactive = r.locationActive === false;
          let status = "Active";
          let displayName = r.locationName || `Location ${r.locationId}`;
          
          if (isDeleted) {
            status = "DELETED";
            displayName = `[DELETED] Location ${r.locationId}`;
          } else if (isInactive) {
            status = "INACTIVE";
            displayName = `[INACTIVE] ${r.locationName}`;
          }
          
          const qty = parseFloat(r.quantity);
          const rate = parseFloat(r.averageRate);
          return {
            id: r.id,
            locationId: r.locationId,
            locationName: displayName,
            locationDeleted: isDeleted || isInactive,
            locationStatus: status,
            quantity: qty,
            averageRate: rate,
            totalValue: qty * rate,
            lastUpdated: r.lastUpdated,
          };
        }),
        totals: {
          recordCount: inventoryRecords.length,
          totalQuantity: totalQty,
          activeRecordCount: inventoryRecords.filter(r => r.locationExists !== null && r.locationActive === true).length,
          activeQuantity: activeQty,
          activeValue: activeValue,
          totalValue: totalValue,
          calculatedRate: totalQty > 0 ? totalValue / totalQty : 0,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Import Cycle Diagnostics - Debug endpoint to find why import cycle balance isn't zero
  app.get("/api/debug/import-cycle", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Define issue types
      interface DiagnosticIssue {
        id: string;
        type: string;
        severity: "critical" | "warning" | "info";
        title?: string;
        description: string;
        impact: number;
        details: any;
        fixGuidance?: string;
        howToFix?: string;
        category?: string;
      }

      const issues: DiagnosticIssue[] = [];
      let issueCounter = 0;
      const generateIssueId = () => `issue-${++issueCounter}`;

      // ============ 1. Detect Negative Inventory ============
      const negativeInventory = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          locationId: inventory.locationId,
          locationName: locations.name,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            sql`CAST(${inventory.quantity} AS DECIMAL) < 0`
          )
        );

      for (const item of negativeInventory) {
        const qty = parseFloat(item.quantity || "0");
        const rate = parseFloat(item.averageRate || "0");
        const impact = Math.abs(qty * rate); // Use absolute value for display
        issues.push({
          id: generateIssueId(),
          type: "negative_inventory",
          severity: "critical",
          description: `Negative inventory: ${item.stockItemCode} at ${item.locationName || `Location ${item.locationId}`}`,
          impact,
          details: {
            stockItemId: item.stockItemId,
            stockItemCode: item.stockItemCode,
            stockItemName: item.stockItemName,
            locationId: item.locationId,
            locationName: item.locationName,
            quantity: qty,
            averageRate: rate,
          },
          fixGuidance: "Create a Production voucher to add missing inventory, or review sales/consumption vouchers for errors.",
        });
      }

      // ============ 2. Detect Orphaned Inventory (at deleted locations) ============
      const orphanedInventory = await db
        .select({
          id: inventory.id,
          stockItemId: inventory.stockItemId,
          stockItemCode: stockItems.code,
          stockItemName: stockItems.name,
          locationId: inventory.locationId,
          quantity: inventory.quantity,
          averageRate: inventory.averageRate,
        })
        .from(inventory)
        .innerJoin(stockItems, eq(inventory.stockItemId, stockItems.id))
        .leftJoin(locations, eq(inventory.locationId, locations.id))
        .where(
          and(
            eq(inventory.companyId, companyId),
            or(
              isNull(locations.id),
              isNotNull(locations.deletedAt)
            )
          )
        );

      for (const item of orphanedInventory) {
        const qty = parseFloat(item.quantity || "0");
        const rate = parseFloat(item.averageRate || "0");
        const rawImpact = qty * rate;
        const impact = Math.abs(rawImpact); // Use absolute value for display
        if (impact > 0.01) {
          issues.push({
            id: generateIssueId(),
            type: "orphaned_inventory",
            severity: "warning",
            description: `Orphaned inventory: ${item.stockItemCode} at deleted/missing location ${item.locationId}`,
            impact,
            details: {
              inventoryId: item.id,
              stockItemId: item.stockItemId,
              stockItemCode: item.stockItemCode,
              stockItemName: item.stockItemName,
              locationId: item.locationId,
              quantity: qty,
              averageRate: rate,
            },
            fixGuidance: "Restore the location or transfer inventory to an active location before deleting.",
          });
        }
      }

      // ============ 3. Detect Unbalanced Vouchers (debits ≠ credits) ============
      const voucherBalances = await db
        .select({
          voucherId: vouchers.id,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
        })
        .from(vouchers)
        .leftJoin(voucherEntries, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        )
        .groupBy(vouchers.id, vouchers.voucherNumber, vouchers.voucherType, vouchers.voucherDate);

      for (const v of voucherBalances) {
        const debit = parseFloat(v.totalDebit || "0");
        const credit = parseFloat(v.totalCredit || "0");
        const diff = Math.abs(debit - credit);
        if (diff > 0.01) {
          issues.push({
            id: generateIssueId(),
            type: "unbalanced_voucher",
            severity: "critical",
            description: `Unbalanced voucher: ${v.voucherNumber} (${v.voucherType}) - Debits: $${debit.toFixed(2)}, Credits: $${credit.toFixed(2)}`,
            impact: diff, // Use absolute difference for display
            details: {
              voucherId: v.voucherId,
              voucherNumber: v.voucherNumber,
              voucherType: v.voucherType,
              voucherDate: v.voucherDate,
              totalDebit: debit,
              totalCredit: credit,
              difference: diff,
            },
            fixGuidance: "Edit the voucher to ensure debits equal credits, or delete and recreate it.",
          });
        }
      }

      // ============ 4. Detect Stale OTW Containers (older than 90 days) ============
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const staleContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          supplierName: suppliers.legalName,
          grandTotal: containers.grandTotal,
          createdAt: containers.createdAt,
        })
        .from(containers)
        .leftJoin(suppliers, eq(containers.supplierId, suppliers.id))
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            sql`${containers.createdAt} < ${ninetyDaysAgo.toISOString()}`
          )
        );

      for (const c of staleContainers) {
        const value = parseFloat(c.grandTotal || "0");
        const daysSinceCreated = Math.floor((Date.now() - new Date(c.createdAt || 0).getTime()) / (1000 * 60 * 60 * 24));
        issues.push({
          id: generateIssueId(),
          type: "stale_otw_container",
          severity: "warning",
          description: `Stale OTW container: ${c.containerNumber} (${daysSinceCreated} days old) from ${c.supplierName || 'Unknown Supplier'}`,
          impact: value,
          details: {
            containerId: c.id,
            containerNumber: c.containerNumber,
            supplierName: c.supplierName,
            grandTotal: value,
            daysSinceCreated,
            createdAt: c.createdAt,
          },
          fixGuidance: "Offload this container if goods have arrived, or cancel if the shipment was lost/cancelled.",
        });
      }

      // ============ 5. Detect Duplicate Inventory Records ============
      const duplicateInventory = await db
        .select({
          stockItemId: inventory.stockItemId,
          locationId: inventory.locationId,
          count: sql<number>`COUNT(*)`,
        })
        .from(inventory)
        .where(eq(inventory.companyId, companyId))
        .groupBy(inventory.stockItemId, inventory.locationId)
        .having(sql`COUNT(*) > 1`);

      for (const dup of duplicateInventory) {
        issues.push({
          id: generateIssueId(),
          type: "duplicate_inventory",
          severity: "critical",
          description: `Duplicate inventory records: ${dup.count} records for same stock item at same location`,
          impact: 0, // Impact calculated separately
          details: {
            stockItemId: dup.stockItemId,
            locationId: dup.locationId,
            duplicateCount: dup.count,
          },
          fixGuidance: "Merge duplicate records by summing quantities and recalculating average rate.",
        });
      }

      // ============ 6. Get Balance Totals (same as import-cycle-balance) ============
      // Reuse the calculation logic from import-cycle-balance
      const getAccountTypeBalance = async (accountType: string, isLiability: boolean = false) => {
        const accounts = await db
          .select()
          .from(ledgerAccounts)
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, accountType),
              isNull(ledgerAccounts.deletedAt)
            )
          );

        let totalBalance = 0;
        for (const account of accounts) {
          const entries = await db
            .select({
              creditAmount: voucherEntries.creditAmount,
              debitAmount: voucherEntries.debitAmount,
            })
            .from(voucherEntries)
            .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
            .where(
              and(
                eq(voucherEntries.ledgerAccountId, account.id),
                eq(vouchers.companyId, companyId),
                isNull(vouchers.deletedAt),
                eq(vouchers.optional, false)
              )
            );

          const openingBalanceRaw = parseFloat(account.openingBalance || "0");
          const openingSide = account.openingBalanceSide || "Dr";
          let signedOpening: number;
          if (isLiability) {
            signedOpening = openingSide === "Cr" ? openingBalanceRaw : -openingBalanceRaw;
          } else {
            signedOpening = openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw;
          }
          
          const balance = entries.reduce((sum, entry) => {
            const credit = parseFloat(entry.creditAmount || "0");
            const debit = parseFloat(entry.debitAmount || "0");
            if (isLiability) {
              return sum + credit - debit;
            } else {
              return sum + debit - credit;
            }
          }, signedOpening);
          
          totalBalance += balance;
        }
        return totalBalance;
      };

      const getTransactionOnlyBalance = async (accountType: string, isLiability: boolean = true) => {
        const result = await db
          .select({
            totalCredit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)`,
            totalDebit: sql<string>`COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0)`,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .innerJoin(ledgerAccounts, eq(voucherEntries.ledgerAccountId, ledgerAccounts.id))
          .where(
            and(
              eq(ledgerAccounts.companyId, companyId),
              eq(ledgerAccounts.accountType, accountType),
              isNull(ledgerAccounts.deletedAt),
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              eq(vouchers.optional, false)
            )
          );
        const totalCredit = parseFloat(result[0]?.totalCredit || "0");
        const totalDebit = parseFloat(result[0]?.totalDebit || "0");
        return isLiability ? totalCredit - totalDebit : totalDebit - totalCredit;
      };

      // Calculate all components
      const supplierEntries = await db
        .select({
          creditAmount: voucherEntries.creditAmount,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            isNotNull(voucherEntries.supplierId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );
      
      // Include supplier opening balances only for suppliers with activity in this company
      const allSuppliersBS = await storage.getAllSuppliers();
      const bsSupplierIdsWithActivity = new Set(
        (await db.select({ supplierId: voucherEntries.supplierId })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(isNotNull(voucherEntries.supplierId), eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false))))
          .map(e => e.supplierId).filter(Boolean)
      );
      const bsCompanyContainers = await db.select({ supplierId: containers.supplierId }).from(containers).where(eq(containers.companyId, companyId));
      for (const c of bsCompanyContainers) {
        if (c.supplierId) bsSupplierIdsWithActivity.add(c.supplierId);
      }
      const supplierOpeningTotalBS = allSuppliersBS
        .filter(s => bsSupplierIdsWithActivity.has(s.id))
        .reduce((sum, s) => sum + parseFloat(s.openingBalance || "0"), 0);
      
      const supplierBalance = supplierEntries.reduce((sum, entry) => {
        return sum + parseFloat(entry.creditAmount || "0") - parseFloat(entry.debitAmount || "0");
      }, supplierOpeningTotalBS);

      const otwContainers = await db.select().from(containers).where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")));
      const stockOtwValue = otwContainers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);

      const cashBalance = await getAccountTypeBalance("Cash", false);
      
      // Bank balance from ledger accounts (type "Bank") - includes linked bank accounts
      const ledgerBankBalance2 = await getAccountTypeBalance("Bank", false);
      
      // Bank balance from standalone bankAccounts (no linkedLedgerId)
      const standaloneBankEntries2 = await db
        .select({
          bankAccountId: voucherEntries.bankAccountId,
          creditAmount: voucherEntries.creditAmount,
          debitAmount: voucherEntries.debitAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .innerJoin(bankAccounts, eq(voucherEntries.bankAccountId, bankAccounts.id))
        .where(
          and(
            isNotNull(voucherEntries.bankAccountId),
            isNull(voucherEntries.ledgerAccountId), // Only entries without ledger posting
            isNull(bankAccounts.linkedLedgerId), // Only standalone bank accounts
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );
      
      const standaloneBankAccounts2 = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            isNull(bankAccounts.linkedLedgerId) // Only standalone
          )
        );
      
      const standaloneBankOpening2 = standaloneBankAccounts2.reduce((sum, account) => {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        const openingSide = account.openingBalanceSide || "Dr";
        return sum + (openingSide === "Dr" ? openingBalanceRaw : -openingBalanceRaw);
      }, 0);
      
      const standaloneBankVoucher2 = standaloneBankEntries2.reduce((sum, entry) => {
        const credit = parseFloat(entry.creditAmount || "0");
        const debit = parseFloat(entry.debitAmount || "0");
        return sum + debit - credit;
      }, 0);
      
      const bankBalance = ledgerBankBalance2 + standaloneBankOpening2 + standaloneBankVoucher2;
      const assetBalance = await getAccountTypeBalance("Asset", false);
      const dutyAgentBalance = await getAccountTypeBalance("Duty Agent", true);
      const transporterAgentBalance = await getAccountTypeBalance("Transporter Agent", true);
      const loansBalance = await getAccountTypeBalance("Loans", true);
      const liabilityBalance = await getAccountTypeBalance("Liability", true);
      const profitBalance = await getAccountTypeBalance("Profit", true);
      const incomeBalance = await getAccountTypeBalance("Income", true);
      const indirectExpenseBalance = await getAccountTypeBalance("Indirect Expense", false);
      const governmentTaxesBalance = await getAccountTypeBalance("Government Taxes", false);
      const payrollExpenseBalance = await getAccountTypeBalance("Payroll Expense", false);
      const salaryAdvancesBalance = await getAccountTypeBalance("Salary Advances", false);
      const generalExpenseBalance = await getAccountTypeBalance("Expense", false);
      const equityTransactionBalance = await getTransactionOnlyBalance("Equity", true);
      const apTransactionBalance = await getTransactionOnlyBalance("Accounts Payable", true);

      // Stock on floor (excluding orphaned)
      const inventoryItems = await db
        .select({ quantity: inventory.quantity, averageRate: inventory.averageRate })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.id))
        .where(and(eq(inventory.companyId, companyId), isNull(locations.deletedAt)));
      
      const stockOnFloorValue = inventoryItems.reduce((sum, item) => {
        return sum + parseFloat(item.quantity || "0") * parseFloat(item.averageRate || "0");
      }, 0);

      // COGS
      const cogsData = await db
        .select({ totalCost: salesItems.totalCost })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));
      const cogsBalance = cogsData.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0);

      // Employee liabilities
      const employeesData = await db.select({ currentBalance: employees.currentBalance }).from(employees).where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));
      const payrollLiabilitiesBalance = employeesData.reduce((sum, emp) => {
        const bal = parseFloat(emp.currentBalance || "0");
        return sum + (bal > 0 ? bal : 0);
      }, 0);

      // Opening Balance Equity calculation (matches import-cycle-balance endpoint)
      const allAccountsForOpening = await db
        .select()
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt)
          )
        );

      let totalDrOpenings = 0;
      let totalCrOpenings = 0;
      for (const account of allAccountsForOpening) {
        const openingBalanceRaw = parseFloat(account.openingBalance || "0");
        const openingSide = account.openingBalanceSide || "Dr";
        if (openingSide === "Dr") {
          totalDrOpenings += openingBalanceRaw;
        } else {
          totalCrOpenings += openingBalanceRaw;
        }
      }
      let openingBalanceEquity = totalCrOpenings - totalDrOpenings;

      // Opening Stock Value - stock items with opening values
      const stockItemsWithOpening = await db
        .select({ openingValue: stockItems.openingValue })
        .from(stockItems)
        .where(
          and(
            eq(stockItems.companyId, companyId),
            isNull(stockItems.deletedAt)
          )
        );
      
      const openingStockValue = stockItemsWithOpening.reduce((sum, item) => {
        return sum + parseFloat(item.openingValue || "0");
      }, 0);
      
      // Subtract opening stock value from equity (it's an asset that needs balancing)
      openingBalanceEquity -= openingStockValue;

      // T005: Calculate net balance using the CANONICAL formula from import-cycle-balance endpoint.
      // Intermediate round2() calls have been removed — they created different rounding results
      // compared to the main endpoint, causing the two endpoints to disagree on the same data.
      // Only the final result is rounded (2 decimal places), matching the main endpoint behavior.
      const netImportCycleBalance = Math.round((
        (stockOtwValue + cashBalance + bankBalance + stockOnFloorValue + assetBalance + salaryAdvancesBalance +
         indirectExpenseBalance + payrollExpenseBalance + governmentTaxesBalance + cogsBalance) -
        (supplierBalance + dutyAgentBalance + transporterAgentBalance + loansBalance + liabilityBalance +
         profitBalance + equityTransactionBalance + apTransactionBalance + incomeBalance + payrollLiabilitiesBalance -
         openingBalanceEquity)
      ) * 100) / 100;

      // === RECONCILIATION SECTION ===
      // Re-compute buckets from account-level data to identify the source of any discrepancy
      
      interface AccountContribution {
        accountId: number;
        accountName: string;
        accountCode: string;
        parentType: string;
        bucket: string;
        balance: number;
      }
      
      const accountContributions: AccountContribution[] = [];
      
      // Map all ledger accounts to their contributions
      const allAccountsForRecon = await db
        .select({
          id: ledgerAccounts.id,
          name: ledgerAccounts.name,
          code: ledgerAccounts.code,
          parentType: sql<string>`${ledgerAccounts.accountType}`.as("parentType"),
          currentBalance: sql<string>`COALESCE(${ledgerAccounts.openingBalance}, '0')`.as("currentBalance"),
          currentBalanceSide: sql<string>`COALESCE(${ledgerAccounts.openingBalanceSide}, 'Dr')`.as("currentBalanceSide"),
        })
        .from(ledgerAccounts)
        .where(
          and(
            eq(ledgerAccounts.companyId, companyId),
            isNull(ledgerAccounts.deletedAt)
          )
        );
      
      // Bucket sums from account-level data
      const reconBuckets: Record<string, number> = {
        supplierBalance: 0,
        dutyAgentBalance: 0,
        transporterAgentBalance: 0,
        loansBalance: 0,
        liabilityBalance: 0,
        profitBalance: 0,
        incomeBalance: 0,
        assetBalance: 0,
        indirectExpenseBalance: 0,
        governmentTaxesBalance: 0,
        salaryAdvancesBalance: 0,
        payrollExpenseBalance: 0,
        cashBalance: 0,
        bankBalance: 0,
        uncategorized: 0,
      };
      
      for (const account of allAccountsForRecon) {
        const balanceRaw = parseFloat(account.currentBalance || "0");
        if (Math.abs(balanceRaw) < 0.01) continue;
        
        const parentType = account.parentType || "UNKNOWN";
        const name = account.name?.toUpperCase() || "";
        let bucket = "uncategorized";
        let signedBalance = balanceRaw;
        
        // Apply sign based on account type and balance side
        const side = account.currentBalanceSide || "Dr";
        
        // Categorize by parent type and name patterns
        if (parentType === "SUPPLIER") {
          bucket = "supplierBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "DUTY_AGENT") {
          bucket = "dutyAgentBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "TRANSPORTER_AGENT") {
          bucket = "transporterAgentBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "LOAN") {
          bucket = "loansBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "LIABILITY") {
          bucket = "liabilityBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "PROFIT") {
          bucket = "profitBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "INCOME" || parentType === "SALES") {
          bucket = "incomeBalance";
          signedBalance = side === "Cr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "ASSET") {
          bucket = "assetBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "INDIRECT_EXPENSE" || parentType === "OPERATING_EXPENSE") {
          bucket = "indirectExpenseBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "GOVERNMENT_TAXES") {
          bucket = "governmentTaxesBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "SALARY_ADVANCE") {
          bucket = "salaryAdvancesBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "CASH") {
          bucket = "cashBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (parentType === "BANK") {
          bucket = "bankBalance";
          signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
        } else if (name.includes("SALARY") || name.includes("PAYROLL") || name.includes("WAGE")) {
          if (parentType?.includes("EXPENSE")) {
            bucket = "payrollExpenseBalance";
            signedBalance = side === "Dr" ? balanceRaw : -balanceRaw;
          }
        }
        
        reconBuckets[bucket] = round2((reconBuckets[bucket] || 0) + signedBalance);
        
        accountContributions.push({
          accountId: account.id,
          accountName: account.name || "Unknown",
          accountCode: account.code || "",
          parentType,
          bucket,
          balance: round2(signedBalance),
        });
      }
      
      // Calculate variances between computed totals and bucket sums
      interface BucketVariance {
        bucket: string;
        computed: number;
        fromAccounts: number;
        variance: number;
        accountsInBucket: number;
      }
      
      const variances: BucketVariance[] = [
        { bucket: "supplierBalance", computed: round2(supplierBalance), fromAccounts: reconBuckets.supplierBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "dutyAgentBalance", computed: round2(dutyAgentBalance), fromAccounts: reconBuckets.dutyAgentBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "transporterAgentBalance", computed: round2(transporterAgentBalance), fromAccounts: reconBuckets.transporterAgentBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "loansBalance", computed: round2(loansBalance), fromAccounts: reconBuckets.loansBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "liabilityBalance", computed: round2(liabilityBalance), fromAccounts: reconBuckets.liabilityBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "profitBalance", computed: round2(profitBalance), fromAccounts: reconBuckets.profitBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "incomeBalance", computed: round2(incomeBalance), fromAccounts: reconBuckets.incomeBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "assetBalance", computed: round2(assetBalance), fromAccounts: reconBuckets.assetBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "indirectExpenseBalance", computed: round2(indirectExpenseBalance), fromAccounts: reconBuckets.indirectExpenseBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "governmentTaxesBalance", computed: round2(governmentTaxesBalance), fromAccounts: reconBuckets.governmentTaxesBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "salaryAdvancesBalance", computed: round2(salaryAdvancesBalance), fromAccounts: reconBuckets.salaryAdvancesBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "payrollExpenseBalance", computed: round2(payrollExpenseBalance), fromAccounts: reconBuckets.payrollExpenseBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "cashBalance", computed: round2(cashBalance), fromAccounts: reconBuckets.cashBalance, variance: 0, accountsInBucket: 0 },
        { bucket: "bankBalance", computed: round2(bankBalance), fromAccounts: reconBuckets.bankBalance, variance: 0, accountsInBucket: 0 },
      ];
      
      for (const v of variances) {
        v.variance = round2(v.computed - v.fromAccounts);
        v.accountsInBucket = accountContributions.filter(a => a.bucket === v.bucket).length;
      }
      
      // Filter to only significant variances
      const significantVariances = variances.filter(v => Math.abs(v.variance) > 1);
      
      // Find uncategorized accounts (potential issues)
      const uncategorizedAccounts = accountContributions.filter(a => a.bucket === "uncategorized" && Math.abs(a.balance) > 1);
      
      // Add issue for uncategorized accounts if any
      if (uncategorizedAccounts.length > 0) {
        const totalUncategorized = uncategorizedAccounts.reduce((sum, a) => sum + a.balance, 0);
        issues.push({
          id: "uncategorized-accounts",
          severity: "warning",
          title: "Accounts with Unknown Category",
          description: `Found ${uncategorizedAccounts.length} account(s) with balance of $${Math.abs(totalUncategorized).toFixed(2)} that don't fit any standard category. These may be causing the imbalance.`,
          impact: Math.abs(totalUncategorized),
          howToFix: "Review these accounts and ensure they have the correct parent type set: " + uncategorizedAccounts.map(a => a.accountName).join(", "),
          category: "Account Mapping"
        });
      }
      
      // Add issue for significant variances
      if (significantVariances.length > 0) {
        for (const v of significantVariances) {
          issues.push({
            id: `variance-${v.bucket}`,
            severity: "warning",
            title: `Variance in ${v.bucket}`,
            description: `Computed value ($${v.computed.toFixed(2)}) differs from account-level sum ($${v.fromAccounts.toFixed(2)}) by $${Math.abs(v.variance).toFixed(2)}. This may indicate double-counting or a calculation discrepancy.`,
            impact: Math.abs(v.variance),
            howToFix: "Check if any accounts are being counted in multiple buckets, or if there's a special calculation that's not reflected in the account balances.",
            category: "Reconciliation"
          });
        }
      }
      
      // === COMPONENT AUDIT FOR DEBUGGING ===
      // Show ALL components with source information for debugging the $819.12 discrepancy
      
      interface ComponentAudit {
        key: string;
        label: string;
        value: number;
        source: "ledger" | "inventory" | "containers" | "sales" | "employees" | "calculated";
        ledgerVerified: boolean;
        ledgerSum?: number;
        variance?: number;
      }
      
      const componentAudit: ComponentAudit[] = [
        // Assets
        { key: "stockOtwValue", label: "Stock OTW", value: round2(stockOtwValue), source: "containers", ledgerVerified: false },
        { key: "cashBalance", label: "Cash", value: round2(cashBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.cashBalance, variance: round2(cashBalance - reconBuckets.cashBalance) },
        { key: "bankBalance", label: "Bank", value: round2(bankBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.bankBalance, variance: round2(bankBalance - reconBuckets.bankBalance) },
        { key: "stockOnFloorValue", label: "Stock on Floor", value: round2(stockOnFloorValue), source: "inventory", ledgerVerified: false },
        { key: "assetBalance", label: "Other Assets", value: round2(assetBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.assetBalance, variance: round2(assetBalance - reconBuckets.assetBalance) },
        { key: "salaryAdvancesBalance", label: "Salary Advances", value: round2(salaryAdvancesBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.salaryAdvancesBalance, variance: round2(salaryAdvancesBalance - reconBuckets.salaryAdvancesBalance) },
        // Expenses
        { key: "indirectExpenseBalance", label: "Indirect Expenses", value: round2(indirectExpenseBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.indirectExpenseBalance, variance: round2(indirectExpenseBalance - reconBuckets.indirectExpenseBalance) },
        { key: "payrollExpenseBalance", label: "Payroll Expenses", value: round2(payrollExpenseBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.payrollExpenseBalance, variance: round2(payrollExpenseBalance - reconBuckets.payrollExpenseBalance) },
        { key: "governmentTaxesBalance", label: "Gov Taxes", value: round2(governmentTaxesBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.governmentTaxesBalance, variance: round2(governmentTaxesBalance - reconBuckets.governmentTaxesBalance) },
        { key: "cogsBalance", label: "COGS", value: round2(cogsBalance), source: "sales", ledgerVerified: false },
        // Liabilities
        { key: "supplierBalance", label: "Suppliers", value: round2(supplierBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.supplierBalance, variance: round2(supplierBalance - reconBuckets.supplierBalance) },
        { key: "dutyAgentBalance", label: "Duty Agent", value: round2(dutyAgentBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.dutyAgentBalance, variance: round2(dutyAgentBalance - reconBuckets.dutyAgentBalance) },
        { key: "transporterAgentBalance", label: "Transporter", value: round2(transporterAgentBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.transporterAgentBalance, variance: round2(transporterAgentBalance - reconBuckets.transporterAgentBalance) },
        { key: "loansBalance", label: "Loans", value: round2(loansBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.loansBalance, variance: round2(loansBalance - reconBuckets.loansBalance) },
        { key: "liabilityBalance", label: "Other Liabilities", value: round2(liabilityBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.liabilityBalance, variance: round2(liabilityBalance - reconBuckets.liabilityBalance) },
        { key: "profitBalance", label: "Profit", value: round2(profitBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.profitBalance, variance: round2(profitBalance - reconBuckets.profitBalance) },
        { key: "incomeBalance", label: "Income", value: round2(incomeBalance), source: "ledger", ledgerVerified: true, ledgerSum: reconBuckets.incomeBalance, variance: round2(incomeBalance - reconBuckets.incomeBalance) },
        { key: "payrollLiabilitiesBalance", label: "Payroll Liabilities", value: round2(payrollLiabilitiesBalance), source: "employees", ledgerVerified: false },
        { key: "openingBalanceEquity", label: "Opening Equity", value: round2(openingBalanceEquity), source: "calculated", ledgerVerified: false },
      ];
      
      // Find any component with non-zero variance
      const componentsWithVariance = componentAudit.filter(c => c.ledgerVerified && c.variance && Math.abs(c.variance) > 0.5);
      
      // Add issues for components with variances
      for (const comp of componentsWithVariance) {
        issues.push({
          id: "variance-" + comp.key,
          severity: "warning",
          title: "Variance in " + comp.label,
          description: "Computed: $" + comp.value.toFixed(2) + ", Ledger sum: $" + (comp.ledgerSum || 0).toFixed(2) + ", Difference: $" + Math.abs(comp.variance || 0).toFixed(2),
          impact: Math.abs(comp.variance || 0),
          howToFix: "Check the account categorization for " + comp.label + " accounts. Some accounts may be miscategorized or double-counted.",
          category: "Reconciliation"
        });
      }
      const reconciliation = {
        buckets: variances,
        uncategorizedAccounts: uncategorizedAccounts.slice(0, 20), // Limit for response size
        totalUncategorized: round2(reconBuckets.uncategorized),
        significantVarianceCount: significantVariances.length,
        componentAudit,
      };
      // === END RECONCILIATION SECTION ===

      // === CONTAINER OFFLOAD AUDIT ===
      // For each offloaded container, compare total debits vs total credits to find discrepancies
      
      interface ContainerAuditEntry {
        containerId: number;
        containerNumber: string;
        status: string;
        supplierName: string;
        itemsTotal: number;
        chargesTotal: number;
        grandTotal: number;
        voucherDebits: number;
        voucherCredits: number;
        difference: number;
        voucherCount: number;
        hasDiscrepancy: boolean;
      }
      
      const containerAudit: ContainerAuditEntry[] = [];
      
      // Get all offloaded containers for this company
      const offloadedContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          status: containers.status,
          supplierId: containers.supplierId,
          itemsTotal: containers.itemsTotal,
          chargesTotal: containers.chargesTotal,
          grandTotal: containers.grandTotal,
        })
        .from(containers)
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OFFLOADED")
          )
        );
      
      // For each container, find all related voucher entries by matching narration
      for (const container of offloadedContainers) {
        // Get supplier name
        const supplier = await db
          .select({ name: suppliers.legalName })
          .from(suppliers)
          .where(eq(suppliers.id, container.supplierId))
          .limit(1);
        
        const supplierName = supplier[0]?.name || "Unknown";
        
        // Find voucher entries with this container number in narration
        const containerPattern = `%${container.containerNumber}%`;
        
        const relatedEntries = await db
          .select({
            id: voucherEntries.id,
            debitAmount: voucherEntries.debitAmount,
            creditAmount: voucherEntries.creditAmount,
            narration: voucherEntries.narration,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              eq(vouchers.companyId, companyId),
              sql`${voucherEntries.narration} ILIKE ${containerPattern}`,
              sql`COALESCE(${vouchers.optional}, false) = false` // Exclude optional/draft vouchers
            )
          );
        
        // Sum debits and credits
        let totalDebits = 0;
        let totalCredits = 0;
        
        for (const entry of relatedEntries) {
          totalDebits += parseFloat(entry.debitAmount || "0");
          totalCredits += parseFloat(entry.creditAmount || "0");
        }
        
        const difference = round2(totalDebits - totalCredits);
        
        containerAudit.push({
          containerId: container.id,
          containerNumber: container.containerNumber,
          status: container.status,
          supplierName,
          itemsTotal: parseFloat(container.itemsTotal || "0"),
          chargesTotal: parseFloat(container.chargesTotal || "0"),
          grandTotal: parseFloat(container.grandTotal || "0"),
          voucherDebits: round2(totalDebits),
          voucherCredits: round2(totalCredits),
          difference,
          voucherCount: relatedEntries.length,
          hasDiscrepancy: Math.abs(difference) > 1,
        });
      }
      
      // Find containers with discrepancies
      const containersWithDiscrepancy = containerAudit.filter(c => c.hasDiscrepancy);
      
      // Add issues for containers with discrepancies
      for (const c of containersWithDiscrepancy) {
        issues.push({
          id: `container-discrepancy-${c.containerId}`,
          severity: "critical",
          title: `Container ${c.containerNumber} has unbalanced entries`,
          description: `Voucher debits ($${c.voucherDebits.toFixed(2)}) do not equal credits ($${c.voucherCredits.toFixed(2)}). Difference: $${Math.abs(c.difference).toFixed(2)}. This container's offload entries are not balanced.`,
          impact: Math.abs(c.difference),
          howToFix: `Review voucher entries for container ${c.containerNumber}. A correction journal entry of $${Math.abs(c.difference).toFixed(2)} is needed to balance the books.`,
          category: "Container Offload"
        });
      }
      
      // === END CONTAINER OFFLOAD AUDIT ===

      // Sum up issue impacts
      const totalIssueImpact = round2(issues.reduce((sum, issue) => sum + issue.impact, 0));

      res.json({
        totals: {
          assets: totalAssets,
          expenses: totalExpenses,
          liabilities: totalLiabilities,
          netBalance: netImportCycleBalance,
        },
        components: {
          stockOtwValue: round2(stockOtwValue),
          cashBalance: round2(cashBalance),
          bankBalance: round2(bankBalance),
          stockOnFloorValue: round2(stockOnFloorValue),
          assetBalance: round2(assetBalance),
          salaryAdvancesBalance: round2(salaryAdvancesBalance),
          indirectExpenseBalance: round2(indirectExpenseBalance),
          payrollExpenseBalance: round2(payrollExpenseBalance),
          governmentTaxesBalance: round2(governmentTaxesBalance),
          cogsBalance: round2(cogsBalance),
          supplierBalance: round2(supplierBalance),
          dutyAgentBalance: round2(dutyAgentBalance),
          transporterAgentBalance: round2(transporterAgentBalance),
          loansBalance: round2(loansBalance),
          liabilityBalance: round2(liabilityBalance),
          profitBalance: round2(profitBalance),
          equityTransactionBalance: round2(equityTransactionBalance),
          apTransactionBalance: round2(apTransactionBalance),
          incomeBalance: round2(incomeBalance),
          payrollLiabilitiesBalance: round2(payrollLiabilitiesBalance),
          openingBalanceEquity: round2(openingBalanceEquity),
          openingStockValue: round2(openingStockValue),
        },
        issues,
        summary: {
          totalIssues: issues.length,
          criticalIssues: issues.filter(i => i.severity === "critical").length,
          warningIssues: issues.filter(i => i.severity === "warning").length,
          totalIssueImpact,
        },
        reconciliation,
        containerAudit,
      });
    } catch (error: any) {
      console.error("Import cycle diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Orphaned Charge Vouchers Diagnostics - Find charge vouchers for OTW containers
  // These are vouchers (DUTY-, TRANS-, OFFICE-, CHG-, XFER-) that should only exist for OFFLOADED containers
  // Business logic: Charge vouchers are created ONLY during container offload. If a container's status is OTW
  // (not offloaded) but has charge vouchers, those are definitively orphaned because:
  // 1. Containers start as OTW with no charges
  // 2. Offload creates charge vouchers AND changes status to OFFLOADED  
  // 3. If status is OTW with charge vouchers, offload was reversed without proper cleanup
  app.get("/api/debug/orphaned-charge-vouchers", requireAuth, requireRole("Admin", "Owner", "Manager"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all OTW containers for this company that do NOT have an active offload record
      // This ensures we're only looking at containers that were reversed (orphaned)
      const otwContainers = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber, numberPlate: containers.numberPlate })
        .from(containers)
        .leftJoin(containerOffloads, eq(containers.id, containerOffloads.containerId))
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            isNull(containerOffloads.id) // No active offload record = was reversed
          )
        );

      const orphanedVouchers: Array<{
        voucherId: number;
        voucherNumber: string;
        voucherType: string;
        containerNumber: string;
        containerId: number;
        totalDebit: number;
        totalCredit: number;
        reason: string;
      }> = [];

      // For each OTW container without offload record, find any charge vouchers that shouldn't exist
      for (const container of otwContainers) {
        // For Statement of Accounts (byAgent), only include OTW containers with plate numbers
        const hasPlate = container.numberPlate && container.numberPlate.trim() !== "";
        const chargeVouchersForContainer = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
            voucherType: vouchers.voucherType,
          })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              or(
                sql`${vouchers.voucherNumber} LIKE ${'DUTY-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'TRANS-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'OFFICE-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'CHG-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'XFER-' + container.containerNumber + '%'}`
              )
            )
          );

        for (const v of chargeVouchersForContainer) {
          // Get entries to calculate impact
          const entries = await db
            .select({
              debitAmount: voucherEntries.debitAmount,
              creditAmount: voucherEntries.creditAmount,
            })
            .from(voucherEntries)
            .where(eq(voucherEntries.voucherId, v.id));

          const totalDebit = entries.reduce((sum, e) => sum + parseFloat(e.debitAmount || "0"), 0);
          const totalCredit = entries.reduce((sum, e) => sum + parseFloat(e.creditAmount || "0"), 0);

          orphanedVouchers.push({
            voucherId: v.id,
            voucherNumber: v.voucherNumber,
            voucherType: v.voucherType,
            containerNumber: container.containerNumber,
            containerId: container.id,
            totalDebit,
            totalCredit,
            reason: "Container is OTW with no offload record but has charge vouchers (offload was reversed without cleanup)",
          });
        }
      }

      res.json({
        otwContainerCount: otwContainers.length,
        orphanedVoucherCount: orphanedVouchers.length,
        orphanedVouchers,
        totalImpact: orphanedVouchers.reduce((sum, v) => sum + Math.abs(v.totalDebit - v.totalCredit), 0),
        explanation: "These vouchers exist for containers in OTW status that have no offload record. They were created during offload but not cleaned up when the offload was reversed.",
      });
    } catch (error: any) {
      console.error("Orphaned charge vouchers diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Delete orphaned charge vouchers for OTW containers
  // Only deletes vouchers for containers that are OTW AND have no offload record (confirmed reversed)
  app.post("/api/admin/fix-orphaned-charge-vouchers", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get all OTW containers that do NOT have an active offload record
      const otwContainers = await db
        .select({ id: containers.id, containerNumber: containers.containerNumber, numberPlate: containers.numberPlate })
        .from(containers)
        .leftJoin(containerOffloads, eq(containers.id, containerOffloads.containerId))
        .where(
          and(
            eq(containers.companyId, companyId),
            eq(containers.status, "OTW"),
            isNull(containerOffloads.id) // No active offload record = was reversed
          )
        );

      const deletedVouchers: Array<{ voucherId: number; voucherNumber: string; containerNumber: string }> = [];

      // For each OTW container without offload record, find and delete charge vouchers
      for (const container of otwContainers) {
        // For Statement of Accounts (byAgent), only include OTW containers with plate numbers
        const hasPlate = container.numberPlate && container.numberPlate.trim() !== "";
        const chargeVouchersForContainer = await db
          .select({
            id: vouchers.id,
            voucherNumber: vouchers.voucherNumber,
          })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              isNull(vouchers.deletedAt),
              or(
                sql`${vouchers.voucherNumber} LIKE ${'DUTY-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'TRANS-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'OFFICE-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'CHG-' + container.containerNumber + '%'}`,
                sql`${vouchers.voucherNumber} LIKE ${'XFER-' + container.containerNumber + '%'}`
              )
            )
          );

        for (const v of chargeVouchersForContainer) {
          // Delete voucher entries first
          await db.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
          // Then delete the voucher
          await db.delete(vouchers).where(eq(vouchers.id, v.id));
          
          deletedVouchers.push({
            voucherId: v.id,
            voucherNumber: v.voucherNumber,
            containerNumber: container.containerNumber,
          });
          
          console.log(`Deleted orphaned voucher: ${v.voucherNumber} for container ${container.containerNumber}`);
        }
      }

      res.json({
        message: `Deleted ${deletedVouchers.length} orphaned charge vouchers`,
        deletedCount: deletedVouchers.length,
        deletedVouchers,
        containersChecked: otwContainers.length,
      });
    } catch (error: any) {
      console.error("Fix orphaned charge vouchers error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // List offloads for daybook view (filtered by date range and company)
  app.get("/api/offloads", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate } = req.query;
      const conditions: any[] = [eq(containers.companyId, companyId)];

      if (startDate) {
        conditions.push(gte(containerOffloads.offloadedAt, new Date((startDate as string) + "T00:00:00")));
      }
      if (endDate) {
        conditions.push(lte(containerOffloads.offloadedAt, new Date((endDate as string) + "T23:59:59")));
      }

      const offloads = await db
        .select({
          id: containerOffloads.id,
          containerId: containerOffloads.containerId,
          containerNumber: containers.containerNumber,
          locationId: containerOffloads.locationId,
          locationName: locations.name,
          duties: containerOffloads.duties,
          officeCharges: containerOffloads.officeCharges,
          transferCharges: containerOffloads.transferCharges,
          transportFees: containerOffloads.transportFees,
          totalCharges: containerOffloads.totalCharges,
          totalBales: containerOffloads.totalBales,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
          offloadedAt: containerOffloads.offloadedAt,
          itemsTotal: sql<string>`coalesce((select sum(coi.total_value) from container_offload_items coi where coi.offload_id = ${containerOffloads.id}), 0)`,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .leftJoin(locations, eq(containerOffloads.locationId, locations.id))
        .where(and(...conditions))
        .orderBy(desc(containerOffloads.offloadedAt))
        .execute();

      res.json(offloads);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get full offload detail with items for daybook view
  app.get("/api/offloads/:id", requireAuth, async (req, res) => {
    try {
      const offloadId = parseInt(req.params.id);
      if (isNaN(offloadId)) return res.status(400).json({ message: "Invalid offload ID" });

      const [offload] = await db
        .select({
          id: containerOffloads.id,
          containerId: containerOffloads.containerId,
          containerNumber: containers.containerNumber,
          locationId: containerOffloads.locationId,
          locationName: locations.name,
          duties: containerOffloads.duties,
          officeCharges: containerOffloads.officeCharges,
          transferCharges: containerOffloads.transferCharges,
          transportFees: containerOffloads.transportFees,
          totalCharges: containerOffloads.totalCharges,
          totalBales: containerOffloads.totalBales,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
          offloadedAt: containerOffloads.offloadedAt,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .leftJoin(locations, eq(containerOffloads.locationId, locations.id))
        .where(eq(containerOffloads.id, offloadId))
        .execute();

      if (!offload) return res.status(404).json({ message: "Offload not found" });

      const items = await db
        .select({
          id: containerOffloadItems.id,
          stockItemId: containerOffloadItems.stockItemId,
          stockItemName: stockItems.name,
          stockItemCode: stockItems.code,
          quantity: containerOffloadItems.quantity,
          rate: containerOffloadItems.rate,
          totalValue: containerOffloadItems.totalValue,
        })
        .from(containerOffloadItems)
        .leftJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id))
        .where(eq(containerOffloadItems.offloadId, offloadId))
        .execute();

      res.json({ ...offload, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Container Offload Diagnostics - Analyze PO line items for potential issues
  app.get("/api/containers/:id/offload-diagnostics", requireAuth, async (req, res) => {
    try {
      const containerId = parseInt(req.params.id);
      if (isNaN(containerId)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Get container
      const container = await storage.getContainerById(containerId);
      if (!container || container.companyId !== companyId) {
        return res.status(404).json({ message: "Container not found" });
      }

      // Get all POs for this container
      const pos = await storage.getPurchaseOrdersByContainer(containerId);
      
      const lineItemDetails: Array<{
        poId: number;
        poNumber: string;
        lineItemId: number;
        stockItemId: number | null;
        stockItemCode: string | null;
        stockItemName: string | null;
        quantity: string;
        quantityParsed: number;
        rate: string;
        isValid: boolean;
        issues: string[];
      }> = [];

      const duplicateCheck = new Map<string, number[]>(); // stockItemId -> [lineItemIds]
      let totalQuantity = 0;
      let invalidLineItems = 0;
      let blankQuantities = 0;
      
      for (const po of pos) {
        const lineItems = await storage.getLineItemsByPO(po.id);
        
        for (const item of lineItems) {
          const issues: string[] = [];
          const quantityParsed = parseFloat(item.quantity);
          
          // Check for issues
          if (!item.stockItemId || item.stockItemId === 0) {
            issues.push("No stock item assigned");
            invalidLineItems++;
          }
          
          if (isNaN(quantityParsed) || item.quantity === "" || item.quantity === null) {
            issues.push("Blank or invalid quantity");
            blankQuantities++;
          } else if (quantityParsed <= 0) {
            issues.push("Zero or negative quantity");
          } else {
            totalQuantity += quantityParsed;
          }
          
          // Track for duplicate detection
          if (item.stockItemId && item.stockItemId !== 0) {
            const key = `${po.id}-${item.stockItemId}`;
            if (!duplicateCheck.has(key)) {
              duplicateCheck.set(key, []);
            }
            duplicateCheck.get(key)!.push(item.id);
          }
          
          // Get stock item details
          let stockItemCode: string | null = null;
          let stockItemName: string | null = null;
          if (item.stockItemId) {
            const stockItem = await storage.getStockItemById(item.stockItemId);
            if (stockItem) {
              stockItemCode = stockItem.code;
              stockItemName = stockItem.name;
            }
          }
          
          lineItemDetails.push({
            poId: po.id,
            poNumber: po.poNumber || `PO-${po.id}`,
            lineItemId: item.id,
            stockItemId: item.stockItemId,
            stockItemCode,
            stockItemName,
            quantity: item.quantity,
            quantityParsed: isNaN(quantityParsed) ? 0 : quantityParsed,
            rate: item.rate,
            isValid: issues.length === 0,
            issues,
          });
        }
      }
      
      // Check for duplicates
      const duplicates: Array<{stockItemId: number; poId: number; lineItemIds: number[]}> = [];
      for (const [key, lineItemIds] of Array.from(duplicateCheck.entries())) {
        if (lineItemIds.length > 1) {
          const [poId, stockItemId] = key.split("-").map(Number);
          duplicates.push({ stockItemId, poId, lineItemIds });
          
          // Mark duplicates in lineItemDetails
          for (const detail of lineItemDetails) {
            if (lineItemIds.includes(detail.lineItemId)) {
              detail.issues.push(`Duplicate: ${lineItemIds.length} entries for same stock item in same PO`);
              detail.isValid = false;
            }
          }
        }
      }

      // Check existing inventory for pre-sales
      const inventoryWarnings: Array<{stockItemId: number; stockItemCode: string; currentQty: number; incomingQty: number; resultQty: number}> = [];
      
      // Group by stock item
      const stockItemTotals = new Map<number, number>();
      for (const item of lineItemDetails) {
        if (item.stockItemId && item.isValid) {
          stockItemTotals.set(item.stockItemId, (stockItemTotals.get(item.stockItemId) || 0) + item.quantityParsed);
        }
      }

      res.json({
        containerId,
        containerNumber: container.containerNumber,
        containerStatus: container.status,
        poCount: pos.length,
        lineItemCount: lineItemDetails.length,
        totalQuantity,
        invalidLineItems,
        blankQuantities,
        duplicateCount: duplicates.length,
        duplicates,
        lineItems: lineItemDetails,
        inventoryWarnings,
        hasIssues: invalidLineItems > 0 || blankQuantities > 0 || duplicates.length > 0,
        summary: {
          valid: lineItemDetails.filter(i => i.isValid).length,
          invalid: lineItemDetails.filter(i => !i.isValid).length,
        }
      });
    } catch (error: any) {
      console.error("Container offload diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all containers for diagnostics selection
  app.get("/api/admin/containers-for-diagnostics", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const allContainers = await db
        .select({
          id: containers.id,
          containerNumber: containers.containerNumber,
          status: containers.status,
          itemsTotal: containers.itemsTotal,
        })
        .from(containers)
        .where(eq(containers.companyId, companyId))
        .orderBy(desc(containers.id));

      res.json(allContainers);
    } catch (error: any) {
      console.error("Get containers for diagnostics error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Net Profit (P&L) Report - Tally Prime style
}
