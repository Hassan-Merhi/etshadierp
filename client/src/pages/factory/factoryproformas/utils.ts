/**
 * Pure helpers and lookup tables for the FactoryProformas page.
 *
 * Extracted from FactoryProformas.tsx during the Phase 4 god-file split.
 */

import type { ProformaLine } from "./types";

export function effectivePricePerBale(line: ProformaLine): number {
  if (line.pricingMode === "per_kg" && line.pricePerKg && line.weightPerBaleKg) {
    const kg = parseFloat(line.weightPerBaleKg);
    const pkk = parseFloat(line.pricePerKg);
    if (kg > 0 && pkk > 0) return kg * pkk;
  }
  return parseFloat(line.pricePerBale) || 0;
}
