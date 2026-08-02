/**
 * Types for the FactoryStockAllocationV5 page.
 *
 * Extracted from FactoryStockAllocationV5.tsx during the Phase 4 god-file split.
 */

export /* ─── Types ───────────────────────────────────────────────────────────────── */
interface ContainerDetail {
  orderId: number;
  containerName: string;
  status: string;
  expectedQty: number;
  loadedQty: number;
  remainingQty: number;
}

export interface ProformaDetail {
  proformaId: number;
  proformaName: string;
  customerId: number;
  customerName: string;
  lineQty: number;
  containerCount: number;
  totalExpected: number;
  containers: ContainerDetail[];
}

export interface V5Row {
  articleCode: string;
  productName: string;
  categoryName?: string;
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  totalKg: number;
  proformaDetails: ProformaDetail[];
  isGarbageOrWipers?: boolean;
}

export interface V5Totals {
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  totalKg: number;
  shortageCount: number;
}

export interface V5Data {
  rows: V5Row[];
  totals: V5Totals;
  productNames: Record<string, string>;
}
