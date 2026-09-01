/**
 * Pure helpers and lookup tables for the ProductionComparison page.
 *
 * Extracted from ProductionComparison.tsx during the Phase 4 god-file split.
 */

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function thisMonthRange(): [string, string] {
  const d = new Date();
  const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return [first, last];
}

export function lastMonthRange(): [string, string] {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10);
  const last = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
  return [first, last];
}

export function thisYearRange(): [string, string] {
  const y = new Date().getFullYear();
  return [`${y}-01-01`, `${y}-12-31`];
}

export function lastYearRange(): [string, string] {
  const y = new Date().getFullYear() - 1;
  return [`${y}-01-01`, `${y}-12-31`];
}

export function fmtDateRange(from: string, to: string) {
  if (from === to) return from;
  return `${from} → ${to}`;
}

// ── Grade derivation ─────────────────────────────────────────────────────────

export const GRADE_PREFIXES: [string, string][] = [
  ["HMD10", "CREAM"],
  ["HMD11", "#1"],
  ["HMD12", "#2"],
  ["HMD13", "#3"],
  ["HMD14", "#4"],
  ["HMD16", "Garbage"],
];

export function deriveGrade(articleCode: string): string {
  const code = (articleCode || "").toUpperCase();
  for (const [prefix, grade] of GRADE_PREFIXES) {
    if (code.startsWith(prefix)) return grade;
  }
  return "—";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export function fmtKg(n: number) {
  // Show 1 decimal only when needed (strips ".0" for whole numbers)
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

export function fmtMoney(n: number) {
  const sign = n < 0 ? "-" : "+";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtUsd(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pctChange(a: number, b: number): number | null {
  if (b === 0 && a === 0) return 0;
  if (b === 0) return null;
  return ((a - b) / b) * 100;
}

export function fmtPct(p: number | null) {
  if (p === null) return "N/A";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(1)}%`;
}

// ── MultiSelectFilter ─────────────────────────────────────────────────────────
