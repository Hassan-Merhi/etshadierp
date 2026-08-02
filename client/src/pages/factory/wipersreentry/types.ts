/**
 * Types for the WipersReEntry page.
 *
 * Extracted from WipersReEntry.tsx during the Phase 4 god-file split.
 */
import type { FactoryBaleProduct } from "@shared/schema";

export interface CartItem {
  productId: number;
  product: FactoryBaleProduct;
  qty: number;
  weightPerBaleKg: number;
  finalizedBy: number | null;
}

export interface CreatedBale {
  id: number;
  referenceNumber: string;
  productName: string | null;
  articleCode: string | null;
  weightKg: string;
  stockEntryDate: string | null;
}
