/**
 * Types for the Dashboard page.
 *
 * Extracted from Dashboard.tsx during the Phase 4 god-file split.
 */

export type ProfitData = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  forUsTotal: number;
  forUs: { total: number; breakdown: { name: string; value: number }[]; accounts: unknown[] };
  onUsTotal: number;
  onUs: { total: number; breakdown: { name: string; value: number }[]; accounts: unknown[] };
  expensesTotal: number;
  expenses: {
    total: number;
    breakdown: { name: string; value: number }[];
  };
  ownersCapital: number;
  netWorth: number;
  netPosition: number;
  netPositionLabel: string;
  netPositionBreakdown: {
    assets: {
      total: number;
      breakdown: { name: string; value: number }[];
    };
    liabilities: {
      total: number;
      breakdown: { name: string; value: number }[];
    };
    expenses: {
      total: number;
      breakdown: { name: string; value: number }[];
    };
    netPosition: number;
  };
  currency?: {
    rateConvention: "TRANSACTION_PER_BASE" | string;
    nativeDebitByCurrency: Record<string, string>;
    nativeCreditByCurrency: Record<string, string>;
    historicalBaseDebitTotal: string;
    historicalBaseCreditTotal: string;
    unresolvedLegacyEntryCount: number;
    unresolvedLegacyRawNet: string;
    totalsProvisional: boolean;
    provisionalReason: string | null;
    currentCashBankTranslationApplied?: boolean;
    historicalValuesLocked?: boolean;
  };
  currencyRevaluation?: {
    unresolvedAccountCount?: number;
    reportTotalsProvisional?: boolean;
    appliedToCurrentSnapshotOnly?: boolean;
  };
};

export type ImportCycleBalanceData = {
  netImportCycleBalance: number;
  components: {
    supplierBalance: number;
    stockOtwValue: number;
    dutyAgentBalance: number;
    transporterAgentBalance: number;
    loansBalance: number;
    cashBalance: number;
    bankBalance: number;
    directExpenseBalance: number;
    indirectExpenseBalance: number;
    incomeBalance: number;
    stockOnFloorValue: number;
    cogsBalance: number;
    payrollExpenseBalance: number;
    salaryAdvancesBalance: number;
    payrollLiabilitiesBalance: number;
  };
};

export type DashboardCashAccount = {
  id: number;
  accountType: string;
  accountId: number;
  displayOrder: number;
  account: {
    id: number;
    code: string;
    name: string;
    balance?: number;
    currentBalance?: number;
    openingBalance?: string;
    type: string;
  };
};

export type Account = {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
};

export type PayableAccount = {
  id: number;
  accountId: number;
  code: string;
  name: string;
  balance: number;
};

export type FactoryDashboardKPIs = {
  openingStockKg: string;
  closingStockKg: string;
  balesPressedToday: number;
  kgsUsedToday: string;
  totalBaleWeightToday: string;
  categories: { name: string; count: number; totalKg: number }[];
  balesDetail: {
    id: number;
    baleCode: string;
    productName: string | null;
    category: string | null;
    weightKg: string;
    pressedAt: string | null;
    status: string;
  }[];
};
