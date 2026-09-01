/**
 * Types for the VoucherDetailsDialog page.
 *
 * Extracted from VoucherDetailsDialog.tsx during the Phase 4 god-file split.
 */
import { Voucher, ViewVoucherEntry, Employee, LedgerAccount, BankAccount } from ".././types";

export interface VoucherDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedVoucher: Voucher | null;
  viewEntriesLoading: boolean;
  viewVoucherEntries: ViewVoucherEntry[];
  isStockTransferVoucher: boolean;
  voucherRevisions: any[];
  revisionsLoading: boolean;
  revisionsError: boolean;
  revisionsErrorMessage?: string;
  retryVoucherRevisions: () => void;
  formatAmount: (amt: any) => string;
  formatDisplayDate: (date: any) => string;
  formatDisplayTime: (date: string) => string;
  cashAccountBalance: string;
  entryBalances: Record<number, string>;
  purchaseOrderData: any;
  poSupplierBalance: string | null;
  selectedDialogRow: number | null;
  setSelectedDialogRow: (n: number | null) => void;
  employees?: Employee[];
  ledgerAccounts?: LedgerAccount[];
  bankAccounts?: BankAccount[];
  viewProfitFilter: "all" | "gain" | "loss" | "even";
  setViewProfitFilter: (v: "all" | "gain" | "loss" | "even") => void;
  user: any;
  handleEdit: (v: Voucher) => void;
  canEdit: (v: Voucher) => boolean;
  navigate: (path: string) => void;
}
