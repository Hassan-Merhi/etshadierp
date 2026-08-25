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
  transactionCurrency?: string | null;
  transactionDebitAmount?: string | null;
  transactionCreditAmount?: string | null;
  baseDebitAmount?: string | null;
  baseCreditAmount?: string | null;
  historicalExchangeRate?: string | null;
  rateConvention?: string | null;
  companyId?: number;
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
  setBankToEdit: (bank: null) => void;
  bankForm: any;
  onBankSubmit: (data: any) => void;
  updateBankMutation: any;
  deleteBankMutation: any;
  handleDeleteBankAccount: () => void;
  accountToEdit: any | null;
  setAccountToEdit: (acc: null) => void;
  supplierToEdit: any | null;
  setSupplierToEdit: (acc: null) => void;
  customerToEdit: any | null;
  setCustomerToEdit: (acc: null) => void;
  employeeToEdit: any | null;
  setEmployeeToEdit: (acc: null) => void;
  editForm: any;
  onEditSubmit: (data: any) => void;
  updateLedgerMutation: any;
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
  saveWaRuleMutation: any;
  waChatsLoading: boolean;
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
