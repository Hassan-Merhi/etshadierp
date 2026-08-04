/**
 * Pure helpers and lookup tables for the PosTransferOrders page.
 *
 * Extracted from PosTransferOrders.tsx during the Phase 4 god-file split.
 */
import {format, parseISO} from "date-fns";

export function formatDate(dateStr: string) {
  try {
    return format(parseISO(dateStr), "MM/dd/yyyy");
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string | null | undefined) {
  if (!dateStr) return "";
  try {
    return format(parseISO(dateStr), "MM/dd/yyyy HH:mm");
  } catch {
    return dateStr;
  }
}

export function fmtQty(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

// ─── Right-side item search panel (results only — input lives in the bar) ──────
