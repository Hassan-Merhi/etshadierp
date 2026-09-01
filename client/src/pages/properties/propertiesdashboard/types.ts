/**
 * Types for the PropertiesDashboard page.
 *
 * Extracted from PropertiesDashboard.tsx during the Phase 4 god-file split.
 */

export type ProfitData = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  forUsTotal: number;
  forUsBreakdown: { name: string; value: number }[];
  onUsTotal: number;
  onUsBreakdown: { name: string; value: number }[];
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
    assets: { total: number; breakdown: { name: string; value: number }[] };
    liabilities: { total: number; breakdown: { name: string; value: number }[] };
    expenses: { total: number; breakdown: { name: string; value: number }[] };
    netPosition: number;
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

export interface PropsCustomAccount {
  key: string;
  name: string;
  value: number;
  side: "have" | "owe" | "spent";
}
