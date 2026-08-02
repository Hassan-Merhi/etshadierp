/**
 * Types for the ERPWorkerDetail page.
 *
 * Extracted from ERPWorkerDetail.tsx during the Phase 4 god-file split.
 */

export interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  joinDate?: string;
  department?: string;
  employeeType: string;
  monthlySalary: string;
  openingBalance?: string;
  currentBalance?: string;
  totalDeposits?: string;
  totalWithdrawals?: string;
  active?: boolean;
}

export interface SalaryAdvance {
  id: number;
  companyId: number;
  employeeId: number;
  employeeCode?: string;
  employeeName?: string;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  fullyPaid: boolean;
  notes?: string;
  createdAt: string;
}

export interface ErpWorkerDoc {
  id: number;
  employeeId: number;
  companyId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  description?: string;
  uploadedBy?: string;
  uploadedAt: string;
}

export interface Transaction {
  id: number;
  voucherId?: number;
  voucherNumber?: string;
  voucherType?: string;
  voucherDate?: string;
  voucherDescription?: string;
  narration?: string;
  debitAmount?: string;
  creditAmount?: string;
}

export interface Props {
  worker: Employee;
  onBack: () => void;
  onEdit?: (worker: Employee) => void;
}
