/**
 * Types for the FactoryAdvancesTab page.
 *
 * Extracted from FactoryAdvancesTab.tsx during the Phase 4 god-file split.
 */

export interface AdvanceRecord {
  id: number;
  companyId: number;
  workerId: number;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  cashAccountId: number | null;
  notes: string | null;
  fullyPaid: boolean;
  repaymentType: string;
  createdAt: string;
  workerName: string;
}

export interface AuditAdvance {
  id: number;
  workerId: number;
  workerName: string;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  fullyPaid: boolean;
  caseType: "missing_voucher" | "no_repayment";
  repayments: { id: number; repaymentDate: string; amount: string; cashAccountId: number | null }[];
  missingVoucherRepayments: {
    id: number;
    repaymentDate: string;
    amount: string;
    cashAccountId: number | null;
  }[];
}

export interface RepaymentRecord {
  id: number;
  advanceId: number;
  workerId: number;
  repaymentDate: string;
  amount: string;
  cashAccountId: number | null;
  notes: string | null;
  createdAt: string;
  advanceDate: string;
  advanceAmount: string;
  advanceRemainingBalance: string;
  workerName: string;
  cashAccountName: string | null;
}

export interface CashAccount {
  id: number;
  name: string;
  code: string;
}

export interface DeductionRecord {
  id: number;
  companyId: number;
  workerId: number;
  workerName: string | null;
  amount: string;
  reason: string | null;
  deductionDate: string;
  applied: boolean;
  payrollId: number | null;
  createdAt: string;
}
