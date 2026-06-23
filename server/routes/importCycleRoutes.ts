import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, canDelete, requireNonPOS, checkPOSLocation } from "../auth";
import { upload, logAudit, getCurrentExchangeRate, calculateHistoricalLocationInventory } from "./_helpers";
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
  systemSettings,
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

// ---------------------------------------------------------------------------
// Lightweight in-process TTL cache — same 30s pattern as statsRoutes.ts.
// Keyed by companyId. Multiple dashboard users share one DB round-trip.
// ---------------------------------------------------------------------------
const _icCache = new Map<string, { data: any; expiresAt: number }>();
function _getCached(key: string): any | null {
  const e = _icCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _icCache.delete(key);
    return null;
  }
  return e.data;
}
function _setCached(key: string, data: any, ttlMs = 30_000): void {
  _icCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (_icCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _icCache) {
      if (v.expiresAt < now) _icCache.delete(k);
    }
  }
}

export function registerImportCycleRoutes(app: Express) {
  app.get("/api/stats/import-cycle-balance", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const _cacheKey = `import-cycle-balance:${companyId}`;
      const _cached = _getCached(_cacheKey);
      if (_cached) return res.json(_cached);

      // ── Single-pass voucher entry scan (same approach as /api/stats/net-profit)
      // Builds accountBalances + supplierBalancesMap in one query so all component
      // values are derived from identical data as the Net Position page.
      const companyEntries = await db
        .select({
          ledgerAccountId: voucherEntries.ledgerAccountId,
          supplierId: voucherEntries.supplierId,
          employeeId: voucherEntries.employeeId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), eq(vouchers.optional, false), isNull(vouchers.deletedAt)))
        .execute();

      const accountBalances = new Map<number, { debit: number; credit: number }>();
      const supplierBalancesMap = new Map<number, { debit: number; credit: number }>();

      for (const entry of companyEntries) {
        if (entry.ledgerAccountId) {
          const d = parseFloat(entry.debitAmount || "0");
          const c = parseFloat(entry.creditAmount || "0");
          const cur = accountBalances.get(entry.ledgerAccountId) || { debit: 0, credit: 0 };
          accountBalances.set(entry.ledgerAccountId, { debit: cur.debit + d, credit: cur.credit + c });
        }
        if (entry.supplierId) {
          const d = parseFloat(entry.debitAmount || "0");
          const c = parseFloat(entry.creditAmount || "0");
          const cur = supplierBalancesMap.get(entry.supplierId) || { debit: 0, credit: 0 };
          // Pure-credit or pure-debit only — avoids FX settlement double-counting
          // (identical filter to /api/stats/net-profit)
          if (c > 0 && d === 0) {
            supplierBalancesMap.set(entry.supplierId, { debit: cur.debit, credit: cur.credit + c });
          } else if (d > 0 && c === 0) {
            supplierBalancesMap.set(entry.supplierId, { debit: cur.debit + d, credit: cur.credit });
          }
        }
      }

      // All ledger accounts (including hidden) — same flag as net-profit route
      const companyAccounts = await storage.getAllLedgerAccounts(companyId, true);

      // Signed net balance for a single account (mirrors getAccountNetBalance from netPositionHelper)
      const nb = (acc: (typeof companyAccounts)[0]) => getAccountNetBalance(acc, accountBalances);

      // Sum net balances for accounts matching the given type(s)
      const sumNB = (types: string[]) =>
        companyAccounts.filter((a) => types.includes(a.accountType || "")).reduce((s, a) => s + nb(a), 0);

      // 1. Supplier Balance — same pure-debit/credit logic as /api/stats/net-profit
      const parentCompanyId = await storage.getParentCompanyId();
      const shouldIncludeSuppliers = parentCompanyId === null || companyId === parentCompanyId;

      let supplierLiabilities = 0;
      let supplierAssets = 0;
      if (shouldIncludeSuppliers) {
        const allSuppliers = await db.select().from(suppliers).where(isNull(suppliers.deletedAt)).execute();
        for (const sup of allSuppliers) {
          const bal = supplierBalancesMap.get(sup.id);
          if (!bal) continue;
          const opening = parseFloat(sup.openingBalance || "0");
          const netBalance = opening + bal.credit - bal.debit;
          if (netBalance > 0) supplierLiabilities += netBalance;
          else if (netBalance < 0) supplierAssets += Math.abs(netBalance);
        }
      }
      const supplierBalance = supplierLiabilities - supplierAssets;

      // 2. Stock OTW (containers with OTW status — asset)
      const otwContainers = await db
        .select()
        .from(containers)
        .where(and(eq(containers.companyId, companyId), eq(containers.status, "OTW")));
      const stockOtwValue = otwContainers.reduce((sum, c) => {
        const gTotal = parseFloat(c.grandTotal ?? "0");
        return sum + (gTotal || parseFloat(c.itemsTotal ?? "0"));
      }, 0);

      // 3-5. Duty Agent / Transporter Agent / Loans
      // NOTE: account type is "Loan" (singular) — matches netPositionHelper constants and DB values
      const dutyAgentBalance = Math.max(0, -sumNB(["Duty Agent"]));
      const transporterAgentBalance = Math.max(0, -sumNB(["Transporter Agent"]));
      const loansBalance = Math.max(0, -sumNB(["Loan"]));

      // 6. Cash (asset — positive debit balance)
      const cashBalance = Math.max(0, sumNB(["Cash"]));

      // 7. Bank — ledger "Bank" accounts + standalone bank accounts (no linked ledger)
      const ledgerBankBalance = Math.max(0, sumNB(["Bank"]));

      // Standalone bank accounts: entries where ledgerAccountId IS NULL and bank has no linkedLedgerId
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
            isNull(voucherEntries.ledgerAccountId),
            isNull(bankAccounts.linkedLedgerId),
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false)
          )
        );

      const standaloneBankAccounts = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.companyId, companyId),
            isNull(bankAccounts.deletedAt),
            isNull(bankAccounts.linkedLedgerId)
          )
        );

      const standaloneBankOpeningBalance = standaloneBankAccounts.reduce((sum, account) => {
        const raw = parseFloat(account.openingBalance || "0");
        const side = account.openingBalanceSide || "Dr";
        return sum + (side === "Dr" ? raw : -raw);
      }, 0);
      const standaloneBankVoucherBalance = standaloneBankAccountEntries.reduce((sum, entry) => {
        return sum + parseFloat(entry.debitAmount || "0") - parseFloat(entry.creditAmount || "0");
      }, 0);
      const bankBalance = ledgerBankBalance + standaloneBankOpeningBalance + standaloneBankVoucherBalance;

      // 8. Import Charges (directExpenseBalance) — accounts under IMPORT_CHARGES parent
      // Uses already-loaded companyAccounts + accountBalances map (no extra DB query)
      const importChargesParentAcc = companyAccounts.find((a) => a.code === "IMPORT_CHARGES");
      let directExpenseBalance = 0;
      if (importChargesParentAcc) {
        const importChargeIds = new Set([
          importChargesParentAcc.id,
          ...companyAccounts.filter((a) => a.parentId === importChargesParentAcc.id).map((a) => a.id),
        ]);
        for (const acc of companyAccounts) {
          if (importChargeIds.has(acc.id)) {
            directExpenseBalance += Math.max(0, nb(acc));
          }
        }
      }

      // 9. Indirect Expense
      const indirectExpenseBalance = Math.max(0, sumNB(["Indirect Expense"]));

      // 10. Income (credit balance = liability / revenue received)
      const incomeBalance = Math.max(0, -sumNB(["Income"]));

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
        .where(and(eq(inventory.companyId, companyId), isNull(locations.deletedAt)));

      const stockOnFloorValue = inventoryItems.reduce((sum, item) => {
        const qty = parseFloat(item.quantity || "0");
        const rate = parseFloat(item.averageRate || "0");
        return sum + qty * rate;
      }, 0);

      // 12. Cost of Goods Sold (calculated from salesItems for non-optional, non-deleted sales vouchers)
      // This represents inventory that was sold and is now an expense
      const cogsData = await db
        .select({
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)));

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

      // 13. Payroll Expenses (Expense accounts named salary / payroll / wage)
      const payrollExpenseBalance = companyAccounts
        .filter((a) => a.accountType === "Expense" && /salary|payroll|wage/i.test(a.name || ""))
        .reduce((s, a) => s + Math.max(0, nb(a)), 0);

      // 14. Salary Advances - outstanding advances given to employees (asset - recoverable)
      const advancesData = await db
        .select({
          remainingBalance: salaryAdvances.remainingBalance,
        })
        .from(salaryAdvances)
        .where(and(eq(salaryAdvances.companyId, companyId), eq(salaryAdvances.fullyPaid, false)));

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
        .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));

      const payrollLiabilitiesBalance = employeesData.reduce((sum, emp) => {
        const balance = parseFloat(emp.currentBalance || "0");
        // Only count positive balances (amounts owed to employees)
        return sum + (balance > 0 ? balance : 0);
      }, 0);

      // 16. Asset accounts (properties, guarantees, receivables — debit side)
      const assetBalance = Math.max(0, sumNB(["Asset", "Current Asset"]));

      // 17. General Expense (Purchases — excluded from formula to avoid double-counting stockOnFloor)
      const generalExpenseBalance = Math.max(0, sumNB(["Expense"]));

      // 18. Government Taxes
      const governmentTaxesBalance = Math.max(0, sumNB(["Government Taxes"]));

      // 19. Liability accounts
      const liabilityBalance = Math.max(0, -sumNB(["Liability"]));

      // 20. Profit / Retained Earnings (credit balance = liability)
      const profitBalance = Math.max(0, -sumNB(["Profit"]));

      // 20a. Equity — transactions only (opening balances are already counted in openingBalanceEquity)
      const equityTransactionBalance = (() => {
        let total = 0;
        for (const acc of companyAccounts) {
          if (acc.accountType !== "Equity") continue;
          const bal = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
          total += bal.credit - bal.debit;
        }
        return Math.max(0, total);
      })();

      // 20b. Accounts Payable — transactions only
      const apTransactionBalance = (() => {
        let total = 0;
        for (const acc of companyAccounts) {
          if (acc.accountType !== "Accounts Payable") continue;
          const bal = accountBalances.get(acc.id) || { debit: 0, credit: 0 };
          total += bal.credit - bal.debit;
        }
        return Math.max(0, total);
      })();

      // 21. Opening Balance Equity - automatically balance opening entries
      // When opening balances are added without matching entries (e.g., cash opening balance without
      // corresponding capital), this creates an imbalance. We calculate the net of all opening balances
      // and treat the difference as implicit equity/capital that should be on the liability side.
      // Calculate net opening balance equity using already-loaded companyAccounts
      let totalDrOpenings = 0;
      let totalCrOpenings = 0;

      for (const account of companyAccounts) {
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
        .where(and(eq(employees.companyId, companyId), isNull(employees.deletedAt)));

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
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)));

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
        stockOtwValue + // Asset (debit) - containers in transit
        cashBalance + // Asset (debit) - cash on hand
        bankBalance + // Asset (debit) - bank balances
        stockOnFloorValue + // Asset - inventory at cost (includes ALL offload charges capitalized)
        assetBalance + // Asset accounts (properties, guarantees, receivables)
        // directExpenseBalance is EXCLUDED - already capitalized into stockOnFloorValue
        indirectExpenseBalance + // Expense (debit) - operating expenses (includes PAYROLL_DEPOSIT_EXPENSE)
        payrollExpenseBalance + // Payroll/Salary expenses (Expense type) - worker salaries in import cycle
        governmentTaxesBalance + // Government Taxes (expense)
        cogsBalance + // COGS expense (debit) - balances inventory reduction on sales
        salaryAdvancesBalance - // Salary Advances (asset) - recoverable from employees
        (supplierBalance + // Liability (what we owe to suppliers)
          dutyAgentBalance + // Liability (what we owe to duty agents)
          transporterAgentBalance + // Liability (what we owe to transporters)
          loansBalance + // Liability (loans/borrowings - includes office charges)
          liabilityBalance + // Other Liability accounts
          profitBalance + // Profit/Equity (retained earnings)
          equityTransactionBalance + // Equity account transactions (capital injections, etc.)
          apTransactionBalance + // Accounts Payable transactions
          incomeBalance + // Income (sales revenue - credit)
          payrollLiabilitiesBalance - // Payroll Liabilities (what we owe employees)
          openingBalanceEquity); // Opening Balance Equity (implicit capital from opening balances)

      // Auto-adjust: silently keep the import cycle balance at 0 by computing and storing
      // the exact offset needed. This runs on every fetch so no manual action is needed.
      const autoAdjustKey = `equity_adjustment_${companyId}`;
      const storedEquityAdjustment = -netImportCycleBalance;
      if (Math.abs(netImportCycleBalance) > 0.01) {
        // Fire-and-forget — don't await so the response is not delayed
        db.insert(systemSettings)
          .values({ key: autoAdjustKey, value: storedEquityAdjustment.toFixed(2) })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: storedEquityAdjustment.toFixed(2), updatedAt: new Date() },
          })
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
      const traceAssetTotal =
        stockOtwValue + cashBalance + bankBalance + stockOnFloorValue + assetBalance + salaryAdvancesBalance;
      const traceExpenseTotal = indirectExpenseBalance + payrollExpenseBalance + governmentTaxesBalance + cogsBalance;
      // liabilitiesBeforeEquity is the raw sum, then we subtract openingBalanceEquity
      const traceLiabilitiesRaw =
        supplierBalance +
        dutyAgentBalance +
        transporterAgentBalance +
        loansBalance +
        liabilityBalance +
        profitBalance +
        equityTransactionBalance +
        apTransactionBalance +
        incomeBalance +
        payrollLiabilitiesBalance;
      const traceNetLiabilities = traceLiabilitiesRaw - openingBalanceEquity;

      // Verify: our trace matches the netImportCycleBalance exactly
      const traceNetBalance = traceAssetTotal + traceExpenseTotal - traceNetLiabilities;

      // Create precision trace showing exact calculation
      const precisionTrace = {
        formula: "(Assets + Expenses) - (Liabilities - Opening Equity) = Net Balance",
        calculation: {
          assetTotal: {
            value: traceAssetTotal,
            breakdown: {
              stockOtwValue,
              cashBalance,
              bankBalance,
              stockOnFloorValue,
              assetBalance,
              salaryAdvancesBalance,
            },
          },
          expenseTotal: {
            value: traceExpenseTotal,
            breakdown: { indirectExpenseBalance, payrollExpenseBalance, governmentTaxesBalance, cogsBalance },
          },
          liabilityTotal: {
            value: traceNetLiabilities,
            breakdown: {
              supplierBalance,
              dutyAgentBalance,
              transporterAgentBalance,
              loansBalance,
              liabilityBalance,
              profitBalance,
              equityTransactionBalance,
              apTransactionBalance,
              incomeBalance,
              payrollLiabilitiesBalance,
              openingBalanceEquityOffset: openingBalanceEquity, // positive value that reduces liabilities
            },
          },
        },
        rawNetBalance: netImportCycleBalance,
        storedEquityAdjustment,
        adjustedBalance: adjustedImportCycleBalance,
        finalRoundedBalance: roundedBalance,
        discrepancyExplanation:
          storedEquityAdjustment !== 0
            ? `An equity adjustment of ${storedEquityAdjustment.toFixed(2)} was applied to zero out the balance.`
            : Math.abs(netImportCycleBalance) < 50 && netImportCycleBalance !== 0
              ? `Small discrepancy of ${netImportCycleBalance.toFixed(2)} likely from accumulated rounding in weighted average cost calculations.`
              : null,
      };

      const _result = {
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
      };
      _setCached(_cacheKey, _result);
      res.json(_result);
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
        .where(and(eq(inventory.companyId, companyId), or(isNotNull(locations.deletedAt), isNull(locations.id))));

      if (orphanedInventory.length > 0) {
        const totalOrphanedValue = orphanedInventory.reduce((sum, inv) => sum + parseFloat(inv.totalValue || "0"), 0);

        if (totalOrphanedValue > 0) {
          issues.push({
            id: "orphaned-inventory",
            severity: "critical",
            title: "Orphaned Inventory at Deleted Locations",
            description: `You have ${orphanedInventory.length} inventory records worth $${totalOrphanedValue.toFixed(2)} at locations that have been deleted. This inventory is counted as an asset but doesn't exist in any active location.`,
            impact: totalOrphanedValue,
            howToFix:
              "Go to Settings > System Tools > View Deleted Items > Locations. Either restore the deleted location(s) and transfer the inventory elsewhere, or permanently delete the location which will also remove the orphaned inventory.",
            category: "Orphaned Data",
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
        const totalNegativeValue = negativeInventory.reduce(
          (sum, inv) => sum + Math.abs(parseFloat(inv.totalValue || "0")),
          0
        );

        issues.push({
          id: "negative-inventory",
          severity: "critical",
          title: "Negative Inventory Quantities",
          description: `You have ${negativeInventory.length} items with negative quantities. This shouldn't happen and indicates a data issue.`,
          impact: totalNegativeValue,
          howToFix:
            "Create a Production voucher to add the missing quantity back, or review recent Consumption/Sales vouchers that may have removed more than available.",
          category: "Data Integrity",
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
        const totalStaleValue = staleContainers.reduce((sum, c) => sum + parseFloat(c.grandTotal || "0"), 0);

        issues.push({
          id: "stale-containers",
          severity: "warning",
          title: "Containers In Transit for Over 90 Days",
          description: `You have ${staleContainers.length} container(s) worth $${totalStaleValue.toFixed(2)} that have been "On The Way" for more than 90 days. These may need to be offloaded or marked as lost.`,
          impact: totalStaleValue,
          howToFix:
            "Go to Containers, find the stale containers, and either Offload them to a location if they've arrived, or cancel them if they're lost.",
          category: "Pending Transactions",
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
        .where(and(eq(vouchers.companyId, companyId), isNull(vouchers.deletedAt), eq(vouchers.optional, false)))
        .groupBy(vouchers.id, vouchers.voucherNumber, vouchers.voucherType)
        .having(
          sql`ABS(COALESCE(SUM(CAST(${voucherEntries.debitAmount} AS DECIMAL)), 0) - COALESCE(SUM(CAST(${voucherEntries.creditAmount} AS DECIMAL)), 0)) > 0.01`
        );

      if (unbalancedVouchers.length > 0) {
        const totalImbalance = unbalancedVouchers.reduce((sum, v) => {
          const debits = parseFloat(v.totalDebits || "0");
          const credits = parseFloat(v.totalCredits || "0");
          return sum + Math.abs(debits - credits);
        }, 0);

        // Create detailed list of unbalanced vouchers
        const voucherDetails = unbalancedVouchers
          .slice(0, 10)
          .map((v) => {
            const debits = parseFloat(v.totalDebits || "0");
            const credits = parseFloat(v.totalCredits || "0");
            const diff = debits - credits;
            return `${v.voucherNumber} (${v.voucherType}): DR ${debits.toFixed(2)} - CR ${credits.toFixed(2)} = ${diff.toFixed(2)}`;
          })
          .join("; ");

        issues.push({
          id: "unbalanced-vouchers",
          severity: "critical",
          title: `Unbalanced Voucher Entries (${unbalancedVouchers.length})`,
          description: `${unbalancedVouchers.length} voucher(s) where debits don't equal credits. Total imbalance: ${totalImbalance.toFixed(2)}. Details: ${voucherDetails}${unbalancedVouchers.length > 10 ? "..." : ""}`,
          impact: totalImbalance,
          howToFix:
            "Edit these vouchers in the Daybook to correct the imbalance, ensuring total debits equal total credits.",
          category: "Data Integrity",
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
        .where(and(eq(ledgerAccounts.companyId, companyId), isNull(ledgerAccounts.deletedAt)));

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
          howToFix:
            "This is often normal when importing data from another system. If you need to balance it, add an opening balance to an Equity or Capital account to offset the difference.",
          category: "Opening Balances",
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
        const totalOwed = employeesData.reduce((sum, e) => sum + parseFloat(e.currentBalance || "0"), 0);

        issues.push({
          id: "employee-balances",
          severity: "info",
          title: "Outstanding Employee Balances",
          description: `You owe ${employeesData.length} employee(s) a total of $${totalOwed.toFixed(2)}. This is recorded as a liability.`,
          impact: totalOwed,
          howToFix:
            "These balances are normal and represent wages owed. Pay employees through Payroll to reduce these liabilities.",
          category: "Liabilities",
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
            category: "Office Charges",
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
      const criticalCount = issues.filter((i) => i.severity === "critical").length;
      const warningCount = issues.filter((i) => i.severity === "warning").length;
      const totalImpact = issues.reduce((sum, i) => sum + i.impact, 0);

      res.json({
        issues,
        summary: {
          totalIssues: issues.length,
          criticalCount,
          warningCount,
          totalImpact,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sales Report - gain/loss from POS transactions
}
