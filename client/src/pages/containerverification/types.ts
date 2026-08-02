/**
 * Types for the ContainerVerification page.
 *
 * Extracted from ContainerVerification.tsx during the Phase 4 god-file split.
 */

export interface LoadedItem {
  id: number;
  containerId: number;
  barcode: string;
  itemName: string | null;
  qty: number;
  weightPerBale: string | null;
  pricePerBale: string | null;
}

export interface ComparisonItem {
  barcode: string;
  itemName: string;
  expectedQty: number;
  loadedQty: number;
  expectedWeightPerBale: number;
  loadedWeightPerBale: number;
  expectedWeightTotal: number;
  loadedWeightTotal: number;
  expectedPricePerBale: number;
  loadedPricePerBale: number;
  expectedTotalValue: number;
  loadedTotalValue: number;
  statusQty: string;
  priceStatus: string;
  priceDiffPerBale: number;
  totalPriceDiff: number;
}

export interface AliasConflict {
  aliasCode: string;
  aliasedToCode: string;
  aliasedToName: string;
  ownerCode: string;
  ownerName: string;
}

export interface VerificationResult {
  proforma: { id: number; reference: string };
  containerId: number;
  supplierId: number;
  comparison: ComparisonItem[];
  aliasConflicts?: AliasConflict[];
}
