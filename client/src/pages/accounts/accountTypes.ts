import type { Dispatch, SetStateAction } from "react";
import type { SubmitHandler, UseFormReturn } from "react-hook-form";
import type { BankAccount, InsertBankAccount, LedgerAccount, UpdateLedgerAccount } from "@shared/schema";

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

type BankFormValues = Omit<InsertBankAccount, "companyId">;
type EditLedgerFormValues = Omit<UpdateLedgerAccount, "id" | "companyId">;

interface PendingMutationState {
  isPending?: boolean;
}

interface SaveWaRuleMutation extends PendingMutationState {
  mutate: (rule: WaRule) => void;
}

export interface AccountDialogsProps {
  bankToEdit: BankAccount | null;
  setBankToEdit: Dispatch<SetStateAction<BankAccount | null>>;
  bankForm: UseFormReturn<BankFormValues>;
  onBankSubmit: SubmitHandler<BankFormValues>;
  updateBankMutation: PendingMutationState;
  deleteBankMutation: PendingMutationState;
  handleDeleteBankAccount: () => void;
  accountToEdit: LedgerAccount | null;
  setAccountToEdit: Dispatch<SetStateAction<LedgerAccount | null>>;
  supplierToEdit: Account | null;
  setSupplierToEdit: Dispatch<SetStateAction<Account | null>>;
  customerToEdit: Account | null;
  setCustomerToEdit: Dispatch<SetStateAction<Account | null>>;
  employeeToEdit: Account | null;
  setEmployeeToEdit: Dispatch<SetStateAction<Account | null>>;
  editForm: UseFormReturn<EditLedgerFormValues>;
  onEditSubmit: SubmitHandler<EditLedgerFormValues>;
  updateLedgerMutation: PendingMutationState;
  handleDeleteAccount: () => void;
  pendingDelete: (() => void) | null;
  setPendingDelete: Dispatch<SetStateAction<(() => void) | null>>;
  waRuleDialogOpen: boolean;
  setWaRuleDialogOpen: Dispatch<SetStateAction<boolean>>;
  waChatSearch: string;
  setWaChatSearch: Dispatch<SetStateAction<string>>;
  waRuleDraft: WaRule;
  setWaRuleDraft: Dispatch<SetStateAction<WaRule>>;
  filteredWaChats: WaChat[];
  saveWaRuleMutation: SaveWaRuleMutation;
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
