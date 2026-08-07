/**
 * Types for the FactoryPayroll page.
 *
 * Extracted from FactoryPayroll.tsx during the Phase 4 god-file split.
 */

export interface PayrollRecord {
  id: number;
  companyId: number;
  workerId: number;
  periodStart: string;
  periodEnd: string;
  baseSalary: string;
  baleEarnings: string;
  kgEarnings: string;
  overtimePay: string;
  bonuses: string;
  productionBonus: string;
  pendingProductionBonus: string;
  rejectedProductionBonus: string;
  suggestedProductionBonus: string;
  productionBonusPendingCount: number;
  productionBonusApprovedCount: number;
  productionBonusRejectedCount: number;
  otherBonuses: string;
  deductions: string;
  advances: string;
  netSalary: string;
  balesCount: number;
  kgProcessed: string;
  overtimeHours: string;
  status: string;
  notes: string | null;
  workerName: string;
  workerCode: string;
  workerPosition: string;
  workerSalaryType: string;
  workerDepartment: string;
}

export interface Company {
  id: number;
  code: string;
  name: string;
}
