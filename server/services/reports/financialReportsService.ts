// ---------------------------------------------------------------------------
// Financial Reports Service
// Extracted from server/routes/stats/statsSalesRoutes.ts (Phase 9 refactor).
// Routes keep: auth, validation, req/res handling.
// This service: orchestrates storage/DB calls, returns plain data.
// API contracts (URL, params, response shape) are unchanged.
// ---------------------------------------------------------------------------

import { db } from "../../db";
import { storage } from "../../storage";
import { vouchers, voucherEntries } from "@shared/schema";
import { eq, and, isNull, inArray, isNotNull, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// getProfitLoss — /api/reports/profit-loss
// Returns income/expense breakdown and net profit for the given date range.
// ---------------------------------------------------------------------------
export async function getProfitLoss(
  companyId: number,
  startDate: string | undefined,
  endDate: string | undefined
): Promise<{
  incomeItems: Array<{ id: number; code: string; name: string; accountType: string; balance: number }>;
  expenseItems: Array<{ id: number; code: string; name: string; accountType: string; balance: number }>;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  startDate: string | null;
  endDate: string | null;
}> {
  // Get all ledger accounts for this company
  const companyAccounts = await storage.getAllLedgerAccounts(companyId, true); // Include hidden accounts for financial calculations

  const incomeAccounts = companyAccounts.filter((acc) => acc.accountType === "Income");
  const expenseAccounts = companyAccounts.filter(
    (acc) =>
      acc.accountType === "Expense" ||
      acc.accountType === "Indirect Expense" ||
      acc.accountType === "Direct Expense"
  );

  const incomeAccountIds = incomeAccounts.map((acc) => acc.id);
  const expenseAccountIds = expenseAccounts.map((acc) => acc.id);

  const plConditions: any[] = [
    eq(vouchers.companyId, companyId),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
  ];
  if (startDate) {
    plConditions.push(sql`${vouchers.voucherDate} >= ${startDate}`);
  }
  if (endDate) {
    plConditions.push(sql`${vouchers.voucherDate} <= ${endDate}`);
  }

  // Single JOIN query — replaces two-step (fetch voucher IDs → inArray entries)
  // Only fetch entries for income/expense accounts to avoid reading the whole table
  const allAccountIds = [...incomeAccountIds, ...expenseAccountIds];
  const companyEntries =
    allAccountIds.length > 0
      ? await db
          .select({
            ledgerAccountId: voucherEntries.ledgerAccountId,
            debitAmount: voucherEntries.debitAmount,
            creditAmount: voucherEntries.creditAmount,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(
            and(
              ...plConditions,
              isNotNull(voucherEntries.ledgerAccountId),
              inArray(voucherEntries.ledgerAccountId, allAccountIds)
            )
          )
          .execute()
      : [];

  // Calculate balances for each account
  const accountBalances = new Map<number, number>();

  for (const entry of companyEntries) {
    if (entry.ledgerAccountId) {
      const debit = parseFloat(entry.debitAmount || "0");
      const credit = parseFloat(entry.creditAmount || "0");
      const currentBalance = accountBalances.get(entry.ledgerAccountId) || 0;
      accountBalances.set(entry.ledgerAccountId, currentBalance + credit - debit);
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

  const totalIncome = incomeItems.reduce((sum, item) => sum + item.balance, 0);
  const totalExpenses = expenseItems.reduce((sum, item) => sum + item.balance, 0);
  const netProfit = totalIncome - totalExpenses;

  return {
    incomeItems,
    expenseItems,
    totalIncome,
    totalExpenses,
    netProfit,
    startDate: startDate || null,
    endDate: endDate || null,
  };
}

// ---------------------------------------------------------------------------
// getBalanceSheet — /api/reports/balance-sheet
// Returns assets, liabilities, equity as of the given date.
// ---------------------------------------------------------------------------
export async function getBalanceSheet(
  companyId: number,
  asOfDate: string | undefined
): Promise<{
  assets: {
    ledgers: Array<{ id: number; code: string; name: string; balance: number }>;
    banks: Array<{ id: number; code: string; name: string; balance: number }>;
    fixedAssets: Array<{ id: number; code: string; name: string; balance: number }>;
    total: number;
  };
  liabilities: {
    ledgers: Array<{ id: number; code: string; name: string; balance: number }>;
    suppliers: Array<{ id: number; code: string; name: string; balance: number }>;
    total: number;
  };
  equity: {
    accounts: Array<{ id: number; code: string; name: string; balance: number }>;
    total: number;
  };
  asOfDate: string | null;
}> {
  // Build conditions for voucher date filter
  const conditions: any[] = [eq(vouchers.companyId, companyId)];
  if (asOfDate) {
    conditions.push(lte(vouchers.voucherDate, asOfDate));
  }

  // Parallel fetch: all accounts + all entries (JOIN replaces two-step inArray)
  const [ledgers, banks, assets, employees, suppliers, allEntries] = await Promise.all([
    storage.getAllLedgerAccounts(companyId),
    storage.getAllBankAccounts(companyId),
    storage.getAllFixedAssets(companyId),
    storage.getAllEmployees(companyId),
    storage.getAllSuppliers(),
    db
      .select({
        voucherId: voucherEntries.voucherId,
        ledgerAccountId: voucherEntries.ledgerAccountId,
        bankAccountId: voucherEntries.bankAccountId,
        fixedAssetId: voucherEntries.fixedAssetId,
        supplierId: voucherEntries.supplierId,
        employeeId: voucherEntries.employeeId,
        debitAmount: voucherEntries.debitAmount,
        creditAmount: voucherEntries.creditAmount,
      })
      .from(voucherEntries)
      .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
      .where(and(...conditions))
      .execute(),
  ]);

  // Calculate balances
  const ledgerBalances = new Map<number, { debits: number; credits: number }>();
  const bankBalances = new Map<number, { debits: number; credits: number }>();
  const assetBalances = new Map<number, { debits: number; credits: number }>();
  const employeeBalances = new Map<number, { debits: number; credits: number }>();
  const supplierBalances = new Map<number, { debits: number; credits: number }>();

  for (const entry of allEntries) {
    const debit = parseFloat(entry.debitAmount || "0");
    const credit = parseFloat(entry.creditAmount || "0");

    if (entry.ledgerAccountId) {
      const existing = ledgerBalances.get(entry.ledgerAccountId) || { debits: 0, credits: 0 };
      ledgerBalances.set(entry.ledgerAccountId, {
        debits: existing.debits + debit,
        credits: existing.credits + credit,
      });
    }

    if (entry.bankAccountId) {
      const existing = bankBalances.get(entry.bankAccountId) || { debits: 0, credits: 0 };
      bankBalances.set(entry.bankAccountId, {
        debits: existing.debits + debit,
        credits: existing.credits + credit,
      });
    }

    if (entry.fixedAssetId) {
      const existing = assetBalances.get(entry.fixedAssetId) || { debits: 0, credits: 0 };
      assetBalances.set(entry.fixedAssetId, {
        debits: existing.debits + debit,
        credits: existing.credits + credit,
      });
    }

    if (entry.supplierId) {
      const existing = supplierBalances.get(entry.supplierId) || { debits: 0, credits: 0 };
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

    if (entry.employeeId) {
      const existing = employeeBalances.get(entry.employeeId) || { debits: 0, credits: 0 };
      employeeBalances.set(entry.employeeId, {
        debits: existing.debits + debit,
        credits: existing.credits + credit,
      });
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

  const bankAccountItems = banks.map((bank) => {
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
      const bal = supplierBalances.get(supplier.id) || { debits: 0, credits: 0 };
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

  const totalAssets = [...assetAccounts, ...bankAccountItems, ...fixedAssetAccounts].reduce(
    (sum, item) => sum + item.balance,
    0
  );

  const totalLiabilities = [...liabilityAccounts, ...supplierAccounts].reduce((sum, item) => sum + item.balance, 0);

  const totalEquity = equityAccounts.reduce((sum, item) => sum + item.balance, 0);

  return {
    assets: {
      ledgers: assetAccounts.filter((a) => a.balance !== 0),
      banks: bankAccountItems.filter((b) => b.balance !== 0),
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
  };
}
