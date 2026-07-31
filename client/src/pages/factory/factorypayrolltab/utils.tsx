/**
 * Pure helpers and lookup tables for the FactoryPayrollTab page.
 *
 * Extracted from FactoryPayrollTab.tsx during the Phase 4 god-file split.
 */

export const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  APPROVED: { label: "Approved", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  PAID: { label: "Paid", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

export function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

export function fmtDate(d: string | null | undefined, fmt: (d: string | Date) => string) {
  if (!d) return "—";
  return fmt(d);
}
