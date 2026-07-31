/**
 * Pure helpers and lookup tables for the FactorySheetsAndSacks page.
 *
 * Extracted from FactorySheetsAndSacks.tsx during the Phase 4 god-file split.
 */

export const TYPES = ["Sheet", "Sack", "Other"] as const;

export const COLOR_PRESETS = [
  { label: "None", value: "" },
  { label: "Purple", value: "#9b59b6" },
  { label: "Green", value: "#27ae60" },
  { label: "Yellow", value: "#f1c40f" },
  { label: "Orange", value: "#e67e22" },
  { label: "Red", value: "#e74c3c" },
  { label: "Blue", value: "#2980b9" },
  { label: "White", value: "#dde3ea" },
  { label: "Black", value: "#2c3e50" },
  { label: "Olive", value: "#6d7d3b" },
  { label: "Teal", value: "#16a085" },
] as const;

export function fmt(n: string | number) {
  return parseFloat(String(n) || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtInt(n: string | number | null | undefined) {
  if (n == null || n === "") return "—";
  const v = parseInt(String(n));
  return isNaN(v) ? "—" : v.toLocaleString("en-US");
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function isoDate(d: Date) {
  // Use local calendar date, not UTC, so presets match the user's clock
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localDayOf(iso: string) {
  // Group log entries by local calendar day
  return isoDate(new Date(iso));
}

export function getPresetDates(preset: string): { from: string; to: string } {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  switch (preset) {
    case "today":
      return { from: isoDate(today), to: isoDate(today) };
    case "yesterday":
      return { from: isoDate(yesterday), to: isoDate(yesterday) };
    case "week":
      return { from: isoDate(weekStart), to: isoDate(today) };
    case "month":
      return { from: isoDate(monthStart), to: isoDate(today) };
    default:
      return { from: "", to: "" };
  }
}

export function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

// ─── Color Picker ─────────────────────────────────────────────────────────────

export // ─── Movement Log ─────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "Last 7 Days" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
];
