/**
 * Types for the ProductionComparison page.
 *
 * Extracted from ProductionComparison.tsx during the Phase 4 god-file split.
 */

export interface ProductRow {
  articleCode: string;
  productName: string;
  categoryName: string;
  qty: number;
  totalWeightKg: number;
}

export interface SupplierDayRow {
  date: string;
  supplierName: string;
  totalKg: number;
  totalCost: number;
}

export interface ReportData {
  production: {
    totalBales: number;
    totalWeightKg: number;
    byProduct: ProductRow[];
  };
  summary?: {
    batchCost: number;
    productionValue: number;
    statusValue: number;
  };
  supplierMixBreakdown?: SupplierDayRow[];
}

export type Preset = "today-yesterday" | "month" | "year" | "custom";

export interface MergedRow {
  articleCode: string;
  productName: string;
  categoryName: string;
  grade: string;
  aQty: number;
  bQty: number;
  aKg: number;
  bKg: number;
}

// ── Formatting ────────────────────────────────────────────────────────────────
