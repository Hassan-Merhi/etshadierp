/**
 * Pure helpers and lookup tables for the SupplierProfitCheck page.
 *
 * Extracted from SupplierProfitCheck.tsx during the Phase 4 god-file split.
 */

import type { ColVisibility } from "./types";

export // ─── Column definitions ───────────────────────────────────────────────────────
const ALL_COLUMNS = [
  { key: "code", label: "Code", default: true },
  { key: "name", label: "Name", default: true },
  { key: "salesQty", label: "Sales Qty", default: true },
  { key: "avgSell", label: "Avg Sell", default: true },
  { key: "dubaiPrice", label: "Dubai Price", default: true },
  { key: "extraPerBale", label: "Extra / Bale", default: true },
  { key: "landingCost", label: "Landing Cost", default: true },
  { key: "costProfit", label: "Cost Profit", default: true },
  { key: "status", label: "Status", default: true },
  { key: "qtyToOrder", label: "Qty to Order", default: true },
  { key: "inventoryAvgCost", label: "Inventory Avg Cost", default: false },
  { key: "hassanPrice", label: "Hassan Price", default: false },
  { key: "hassanProfit", label: "Hassan Profit", default: false },
  { key: "currentStock", label: "Current Stock", default: false },
] as const;

export const DEFAULT_COL_VISIBILITY: ColVisibility = Object.fromEntries(
  ALL_COLUMNS.map((c) => [c.key, c.default])
) as ColVisibility;

export const STORAGE_KEY_COLS = "spc_col_visibility_v2";

export function loadColVisibility(): ColVisibility {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_COLS);
    if (saved) return { ...DEFAULT_COL_VISIBILITY, ...JSON.parse(saved) };
  } catch {
    // Storage is unavailable in private mode and can throw on quota; the value is a convenience, not state we need.
  }
  return { ...DEFAULT_COL_VISIBILITY };
}

// ─── Status options ───────────────────────────────────────────────────────────

export // ─── Status options ───────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "gaining", label: "Gaining", dot: "bg-emerald-500" },
  { value: "losing", label: "Losing", dot: "bg-red-500" },
  { value: "break_even", label: "Break Even", dot: "bg-blue-500" },
  { value: "no_sales_data", label: "No Data", dot: "bg-amber-500" },
  { value: "missing_po", label: "Missing PO Price", dot: "bg-orange-500" },
];

// ─── Interfaces ───────────────────────────────────────────────────────────────

export // ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
