/**
 * Pure helpers and lookup tables for the POSPriceList page.
 *
 * Extracted from POSPriceList.tsx during the Phase 4 god-file split.
 */

export const ALL_LOCATIONS_ID = -1;

export function formatQty(raw: string | number | null | undefined): string {
  if (raw == null) return "—";
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n) || n === 0) return "—";
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
