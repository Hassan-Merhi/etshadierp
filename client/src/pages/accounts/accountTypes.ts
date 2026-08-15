export interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
  balanceSide: string | null;
  openingBalance?: number;
  openingBalanceSide?: string | null;
  active: boolean;
  isHidden?: boolean;
  subType?: string;
  parentId?: number;
  accountType?: string;
}

export interface Transaction {
  entryId: number;
  voucherId: number;
  debitAmount: string;
  creditAmount: string;
  narration: string;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  effectiveDate?: string | null;
  voucherDescription: string;
  currency?: string;
}

export interface GroupedVoucher {
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  effectiveDate?: string | null;
  voucherDescription: string;
  narration: string;
  totalDebit: number;
  totalCredit: number;
  runningBalance?: number;
  runningBalanceCurrency?: string;
  currency?: string;
}

export interface WaRule {
  id?: number;
  enabled: boolean;
  whatsappChatId: string;
  sendOnPayment: boolean;
  sendOnReceipt: boolean;
  sendOnJournal: boolean;
}

export interface WaChat {
  id: string;
  name: string;
  type: string;
}

export interface AccountDialogsProps {
  bankToEdit: any | null;
  setBankToEdit: (bank: any | null) => void;
  bankForm: unknown;
  onBankSubmit: (data: any) => void;
  updateBankMutation: unknown;
  deleteBankMutation: unknown;
  handleDeleteBankAccount: () => void;
  accountToEdit: any | null;
  setAccountToEdit: (acc: any | null) => void;
  supplierToEdit: any | null;
  setSupplierToEdit: (acc: any | null) => void;
  customerToEdit: any | null;
  setCustomerToEdit: (acc: any | null) => void;
  employeeToEdit: any | null;
  setEmployeeToEdit: (acc: any | null) => void;
  editForm: unknown;
  onEditSubmit: (data: any) => void;
  updateLedgerMutation: unknown;
  handleDeleteAccount: () => void;
  pendingDelete: (() => void) | null;
  setPendingDelete: (fn: (() => void) | null) => void;
  waRuleDialogOpen: boolean;
  setWaRuleDialogOpen: (open: boolean) => void;
  waChatSearch: string;
  setWaChatSearch: (search: string) => void;
  waRuleDraft: WaRule;
  setWaRuleDraft: (rule: WaRule) => void;
  filteredWaChats: WaChat[];
  saveWaRuleMutation: unknown;
  waChatsLoading: boolean;
}

export interface AccountStatementViewProps {
  selectedAccount: Account;
  onClose: () => void;
  periodFilter: unknown;
  setPeriodFilter: (filter: any) => void;
  vouchersWithBalance: unknown[];
  closingBalance: number;
  openingBalance: number;
  transactionsLoading: boolean;
  transactionError?: string | null;
  selectedVoucherIds: Set<number>;
  toggleSelectAll: () => void;
  setShowBulkDeleteConfirm: (show: boolean) => void;
  filterCurrency: string;
  setFilterCurrency: (updater: any) => void;
  showDeletedVouchers: boolean;
  setShowDeletedVouchers: (updater: any) => void;
  currentUser: unknown;
  formatAmount: (amt: number) => string;
  hideBalances: boolean;
  printRef: React.RefObject<HTMLDivElement>;
  appMode: string;
  formatDisplayDate: (date: Date | string) => string;
  toggleVoucherSelection: (id: number) => void;
  handleOpenVoucher: (v: any) => void;
  waRule: WaRule | null;
  openWaRuleDialog: () => void;
  sendWaStatementMutation: unknown;
  isMultiCurrency: boolean;
  ledgerCurrencyBalances?: unknown[];
  isBrokerSupplier: boolean;
  brokerStatementData: unknown;
  factorySupplierStatement: unknown;
  factoryStatementLoading: boolean;
  brokerStatementLoading: boolean;
  handlePrint: () => void;
  exportLang: "en" | "fr" | "ar";
  setExportLang: (lang: "en" | "fr" | "ar") => void;
  exportLabels: unknown;
}

export interface AccountTableProps {
  filteredAccounts: unknown[];
  expandedParents: Set<string>;
  toggleParent: (id: string) => void;
  handleAccountChange: (id: string) => void;
  hideBalances: boolean;
  formatAmount: (amt: number) => string;
  onEdit?: (account: any) => void;
}

export const exportLabels: Record<
  string,
  {
    ledger: string;
    type: string;
    debit: string;
    credit: string;
    runningBalance: string;
    date: string;
    notes: string;
    openingBalance: string;
    accountStatement: string;
    language: string;
  }
> = {
  en: {
    ledger: "Ledger",
    type: "Type",
    debit: "Debit",
    credit: "Credit",
    runningBalance: "Running Balance",
    date: "Date",
    notes: "Notes",
    openingBalance: "Opening Balance",
    accountStatement: "Account Statement",
    language: "English",
  },
  fr: {
    ledger: "Compte",
    type: "Type",
    debit: "Débit",
    credit: "Crédit",
    runningBalance: "Solde courant",
    date: "Date",
    notes: "Notes",
    openingBalance: "Solde d'ouverture",
    accountStatement: "Relevé de compte",
    language: "Français",
  },
  ar: {
    ledger: "الحساب",
    type: "النوع",
    debit: "مدين",
    credit: "دائن",
    runningBalance: "الرصيد",
    date: "التاريخ",
    notes: "ملاحظات",
    openingBalance: "الرصيد الافتتاحي",
    accountStatement: "كشف حساب",
    language: "عربي",
  },
};
