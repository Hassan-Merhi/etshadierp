/**
 * Pure helpers and lookup tables for the SalesReportLegacy page.
 *
 * Extracted from SalesReportLegacy.tsx during the Phase 4 god-file split.
 */
import { formatNumber } from "@/lib/formatNumber";

export // Format number with commas, remove .00 if whole - handles string inputs
const formatNumericValue = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return formatNumber(num);
};

// For backwards compatibility

export // For backwards compatibility
const formatSmartNumber = (value: string | number | null | undefined) => {
  if (value == null) return "0";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return num % 1 === 0
    ? num.toLocaleString("en-US")
    : num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
