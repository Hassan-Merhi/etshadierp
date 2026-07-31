/**
 * Types for the WasteDispatch page.
 *
 * Extracted from WasteDispatch.tsx during the Phase 4 god-file split.
 */

export interface Bale {
  id: number;
  referenceNumber: string;
  productName: string;
  categoryName: string;
  locationName: string;
  weightKg: number;
  totalCost: number;
}

export interface ProductGroup {
  key: string;
  productName: string;
  categoryName: string;
  bales: Bale[];
  totalWeight: number;
  totalCost: number;
  avgRate: number;
}
