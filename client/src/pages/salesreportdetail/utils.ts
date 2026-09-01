/**
 * Pure helpers and lookup tables for the SalesReportDetail page.
 *
 * Extracted from SalesReportDetail.tsx during the Phase 4 god-file split.
 */
import { formatNumber } from "@/lib/formatNumber";

export const formatNumericValue = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return formatNumber(num);
};

export const profitColor = (v: number) =>
  v > 0 ? "text-green-600 dark:text-green-400" : v < 0 ? "text-red-600 dark:text-red-400" : "";

export const LOCATION_PALETTE = [
  {
    dot: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-300",
    badge:
      "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700",
  },
  {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    badge:
      "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700",
  },
  {
    dot: "bg-violet-500",
    text: "text-violet-700 dark:text-violet-300",
    badge:
      "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700",
  },
  {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    badge:
      "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700",
  },
  {
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    badge:
      "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700",
  },
  {
    dot: "bg-cyan-500",
    text: "text-cyan-700 dark:text-cyan-300",
    badge:
      "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700",
  },
  {
    dot: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-300",
    badge:
      "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700",
  },
  {
    dot: "bg-pink-500",
    text: "text-pink-700 dark:text-pink-300",
    badge:
      "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 border border-pink-200 dark:border-pink-700",
  },
];
