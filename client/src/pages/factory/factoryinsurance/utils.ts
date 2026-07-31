/**
 * Pure helpers and lookup tables for the FactoryInsurance page.
 *
 * Extracted from FactoryInsurance.tsx during the Phase 4 god-file split.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const currentYear = new Date().getFullYear();

export const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

// ─── Member Form Dialog ───────────────────────────────────────────────────────
