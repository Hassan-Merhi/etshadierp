/**
 * Types for the BaleProducts page.
 *
 * Extracted from BaleProducts.tsx during the Phase 4 god-file split.
 */
import type { FactoryBaleProduct } from "@shared/schema";

export interface ImportPreviewRow {
  articleCode: string;
  name: string;
  category?: string;
  description?: string;
  weightPerBaleKg?: string;
  productionPrice?: number | string;
  sellingPrice?: number | string;
  active?: boolean;
}

export interface GroupedProduct {
  articleCode: string;
  name: string;
  count: number;
  items: FactoryBaleProduct[];
}
