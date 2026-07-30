export interface DiagnosticIssue {
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

export interface ImportCycleBalanceSnapshot {
  issues: DiagnosticIssue[];
  stockOtwValue: number;
  cashBalance: number;
  bankBalance: number;
  stockOnFloorValue: number;
  assetBalance: number;
  salaryAdvancesBalance: number;
  indirectExpenseBalance: number;
  payrollExpenseBalance: number;
  governmentTaxesBalance: number;
  cogsBalance: number;
  supplierBalance: number;
  dutyAgentBalance: number;
  transporterAgentBalance: number;
  loansBalance: number;
  liabilityBalance: number;
  profitBalance: number;
  equityTransactionBalance: number;
  apTransactionBalance: number;
  incomeBalance: number;
  payrollLiabilitiesBalance: number;
  openingBalanceEquity: number;
  openingStockValue: number;
  generalExpenseBalance: number;
  netImportCycleBalance: number;
}

export interface AccountContribution {
  accountId: number;
  accountName: string;
  accountCode: string;
  parentType: string;
  bucket: string;
  balance: number;
}

export interface BucketVariance {
  bucket: string;
  computed: number;
  fromAccounts: number;
  variance: number;
  accountsInBucket: number;
}

export interface ComponentAudit {
  key: string;
  label: string;
  value: number;
  source: "ledger" | "inventory" | "containers" | "sales" | "employees" | "calculated";
  ledgerVerified: boolean;
  ledgerSum?: number;
  variance?: number;
}

export interface ContainerAuditEntry {
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
