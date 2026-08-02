/**
 * Types for the FactoryPOS page.
 *
 * Extracted from FactoryPOS.tsx during the Phase 4 god-file split.
 */

export interface CartRow {
  id: string;
  productId: number | null;
  productName: string;
  articleCode: string;
  availableQty: number;
  quantity: number;
  unitPrice: number;
  weightPerBale: number;
}

export interface InventoryItem {
  productId: number;
  productName: string;
  articleCode: string;
  category: string | null;
  quantity: number;
  totalWeight: number;
  sellingPrice: string;
  referenceNumbers?: string[];
}

export interface ExpenseRow {
  id: string;
  accountId: string;
  description: string;
  amount: string;
}
