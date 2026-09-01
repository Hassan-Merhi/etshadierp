/**
 * Pure helpers and lookup tables for the TransporterStatement page.
 *
 * Extracted from TransporterStatement.tsx during the Phase 4 god-file split.
 */

export function fmtNum(v: string | null | undefined): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtAmt(v: string | null): string {
  if (!v) return "";
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
