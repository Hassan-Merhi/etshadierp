/**
 * Pure helpers and lookup tables for the FactoryDispatchBatchDetail page.
 *
 * Extracted from FactoryDispatchBatchDetail.tsx during the Phase 4 god-file split.
 */

export const RIDE_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
  LOADING: { label: "Loading", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  DISPATCHED: { label: "Dispatched", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  COMPLETED: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  CANCELLED: { label: "Cancelled", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

export const BATCH_STATUS_CONFIG = {
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
  LOADING: { label: "Loading", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  DISPATCHED: { label: "Dispatched", className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  INVOICED: { label: "Invoiced", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  CANCELLED: { label: "Cancelled", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
} as Record<string, { label: string; className: string }>;

export function fmt(n: number | string, decimals = 2) {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(v)) return "0";
  return v.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
