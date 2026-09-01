/**
 * Types for the FactoryInsurance page.
 *
 * Extracted from FactoryInsurance.tsx during the Phase 4 god-file split.
 */

export interface InsuranceMember {
  id: number;
  companyId: number;
  name: string;
  nationality: string | null;
  positionWorking: string | null;
  insuranceNumber: string | null;
  startDate: string;
  amount: string;
  dob: string | null;
  notes: string | null;
  active: boolean;
  ledgerAccountId: number | null;
  createdAt: string;
}

export interface LedgerEntry {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  description: string | null;
  debitAmount: string | null;
  creditAmount: string | null;
  narration: string | null;
}

export interface InsuranceImportRow {
  sheetName: string;
  monthStart: string;
  name: string;
  amount: string;
  startDate: string;
  nationality?: string;
  positionWorking?: string;
  insuranceNumber?: string;
  dob?: string;
  notes?: string;
}

export interface InsuranceImportIssue {
  sheetName: string;
  row?: number;
  message: string;
}

export interface InsuranceImportPreview {
  rows: InsuranceImportRow[];
  errors: InsuranceImportIssue[];
  warnings: InsuranceImportIssue[];
  recognizedSheets: Array<{ sheetName: string; monthStart: string; rowCount: number }>;
  ignoredSheets: string[];
}
