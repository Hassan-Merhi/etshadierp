import type { SalaryAdvance } from "./payrollSchemas";
export function calculateAdvanceStats(advances: readonly SalaryAdvance[]) {
  const total = advances.reduce((s, a) => s + parseFloat(a.amount || "0"), 0);
  const outstanding = advances
    .filter((a) => !a.fullyPaid)
    .reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
  const active = advances.filter((a) => !a.fullyPaid).length;
  return { total, outstanding, active };
}
