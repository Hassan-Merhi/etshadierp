/**
 * Pure helpers and lookup tables for the WasteDispatch page.
 *
 * Extracted from WasteDispatch.tsx during the Phase 4 god-file split.
 */

export function fmt(n: number) {
  if (n === 0) return "$0";
  const r = Math.round(n * 100) / 100;
  if (r % 1 === 0) return "$" + new Intl.NumberFormat("en-US").format(r);
  return "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r);
}

export function fmtKg(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

export function today() {
  return new Date().toLocaleDateString("en-CA");
}
