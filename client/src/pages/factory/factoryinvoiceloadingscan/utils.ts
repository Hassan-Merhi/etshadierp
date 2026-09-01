/**
 * Pure helpers and lookup tables for the FactoryInvoiceLoadingScan page.
 *
 * Extracted from FactoryInvoiceLoadingScan.tsx during the Phase 4 god-file split.
 */

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── Main Page ──────────────────────────────────────────────────────────────────
