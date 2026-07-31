/**
 * Pure helpers and lookup tables for the FactoryStockAllocationV3 page.
 *
 * Extracted from FactoryStockAllocationV3.tsx during the Phase 4 god-file split.
 */

import type {Tab} from "./types";

export function fmtKg(kg: string | number) {
  return `${parseFloat(String(kg)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`;
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export const STATUS_COLORS: Record<string, string> = {
  expected_to_load: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  loading: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  finalized: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground",
};

export const STATUS_LABELS: Record<string, string> = {
  expected_to_load: "Expected to Load",
  loading: "Loading",
  finalized: "Finalized",
  cancelled: "Cancelled",
};

export const TABS = ["overview", "expected", "loading", "finalized", "proformas"] as const;

export const TAB_LABELS: Record<Tab, string> = {
  overview: "Stock Overview",
  expected: "Expected to Load",
  loading: "Loading",
  finalized: "Finalized",
  proformas: "Proformas",
};
