/**
 * Pure helpers and lookup tables for the FactoryFinancialSnapshot page.
 *
 * Extracted from FactoryFinancialSnapshot.tsx during the Phase 4 god-file split.
 */

export const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

export const kg = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " kg";
