/**
 * Pure helpers and lookup tables for the FactoryImport page.
 *
 * Extracted from FactoryImport.tsx during the Phase 4 god-file split.
 */

import type {BaleRow, RawStockRow, SupplierRow} from "./types";

export const EMPTY_SUPPLIER: SupplierRow = { name: "", openingBalance: "0", contactPerson: "", phone: "", email: "" };

export const EMPTY_RAW_STOCK: RawStockRow = {
  containerNumber: "",
  supplierName: "",
  receivedKg: "",
  usedKg: "0",
  costPerKg: "",
  arrivalDate: "",
};

export const EMPTY_BALE: BaleRow = {
  baleCode: "",
  articleCode: "",
  productName: "",
  category: "",
  grade: "",
  weightKg: "",
  costPerKg: "0",
  status: "FINALIZED",
};

export function downloadTemplate(type: string) {
  window.open(`/api/factory/import/template/${type}`, "_blank");
}
