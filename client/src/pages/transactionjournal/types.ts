/**
 * Types for the TransactionJournal page.
 *
 * Extracted from TransactionJournal.tsx during the Phase 4 god-file split.
 */

export interface JournalVoucher {
  id: number;
  companyId: number;
  companyName: string;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  totalAmount: string;
  currency: "USD" | "CFA";
  optional: boolean;
  description: string | null;
  narration: string | null;
  deletedAt: string | null;
}

export interface SummaryRow {
  companyId: number;
  companyName: string;
  currency: string;
  voucherCount: number;
  totalDebits: string | null;
  totalCredits: string | null;
}

export interface CompanyOption {
  id: number;
  name: string;
}

export interface JournalResponse {
  vouchers: JournalVoucher[];
  total: number;
  page: number;
  totalPages: number;
  summary: SummaryRow[];
  companies: CompanyOption[];
}

export interface VoucherEntry {
  id: number;
  ledgerAccountId: number | null;
  customerId: number | null;
  accountName: string | null;
  debitAmount: string;
  creditAmount: string;
  narration: string | null;
}

export interface VoucherDetail {
  voucher: JournalVoucher;
  entries: VoucherEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
