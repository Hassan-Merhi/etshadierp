/**
 * Pure helpers and lookup tables for the AnalyticsLegacy page.
 *
 * Extracted from AnalyticsLegacy.tsx during the Phase 4 god-file split.
 */

export function formatSmartNumber(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return "";
  const value = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(value)) return "";
  const isWholeNumber = value % 1 === 0;
  if (isWholeNumber) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
