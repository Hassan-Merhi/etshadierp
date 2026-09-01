/**
 * Types for the FactoryImport page.
 *
 * Extracted from FactoryImport.tsx during the Phase 4 god-file split.
 */

export type ImportTab = "suppliers" | "raw-stock" | "bales" | "opening-stock" | "ob-edit";

export interface SupplierRow {
  name: string;
  openingBalance: string;
  contactPerson: string;
  phone: string;
  email: string;
}

export interface RawStockRow {
  containerNumber: string;
  supplierName: string;
  receivedKg: string;
  usedKg: string;
  costPerKg: string;
  arrivalDate: string;
}

export interface BaleRow {
  baleCode: string;
  articleCode: string;
  productName: string;
  category: string;
  grade: string;
  weightKg: string;
  costPerKg: string;
  status: string;
}

export interface OpeningStockRow {
  supplier: string;
  kg: string;
  costPerKg: string;
  currency: string;
  fxRateToUsd: string;
  openingDate: string;
  notes: string;
}
