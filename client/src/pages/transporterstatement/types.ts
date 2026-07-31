/**
 * Types for the TransporterStatement page.
 *
 * Extracted from TransporterStatement.tsx during the Phase 4 god-file split.
 */

export interface Transporter {
  id: number;
  name: string;
  code: string;
  accountType: string;
  openingBalance: string | null;
  openingBalanceSide: string | null;
}

export interface StatementRow {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  narration: string;
  debit: string | null;
  credit: string | null;
  runningBalance: string;
  numberPlate: string | null;
  offloadDate: string | null;
  dateToBePaid: string | null;
  hasManualDueDate: boolean;
  containerNumber: string | null;
  status: "unpaid" | "partial" | "paid" | null;
  paidAmount: string | null;
}

export interface StatementResponse {
  account: {
    id: number;
    name: string;
    code: string;
    openingBalance: string | null;
    openingBalanceSide: string | null;
  };
  paymentTermsDays: number;
  openingBalance: string;
  closingBalance: string;
  rows: StatementRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
