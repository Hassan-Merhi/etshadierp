/**
 * Types for the FactoryStockAllocationV3 page.
 *
 * Extracted from FactoryStockAllocationV3.tsx during the Phase 4 god-file split.
 */

import {TABS} from "./utils";

export interface StockRow {
  articleCode: string;
  productName: string;
  inStockBales: number;
  inStockKg: string;
  expectedToLoadBales: number;
  expectedToLoadKg: string;
  loadingBales: number;
  loadingKg: string;
  ftpBales: number;
  ftpKg: string;
}

export interface V3Load {
  id: number;
  proformaId: number;
  proformaName: string;
  customerName: string;
  customerId: number;
  loadName: string;
  expectedLoadDate: string;
  notes: string | null;
  status: string;
  createdByName: string | null;
  createdAt: string;
  startedAt: string | null;
  finalizedAt: string | null;
  finalizedByName: string | null;
  cancelledAt: string | null;
  totalBales: number;
  scannedBales: number;
  totalWeightKg: string;
  scannedWeightKg: string;
}

export interface LoadBale {
  id: number;
  baleId: number;
  baleReference: string;
  articleCode: string | null;
  productName: string | null;
  weightKg: string;
  phase: string;
  addedByName: string | null;
  addedAt: string;
  removedByName: string | null;
  removedAt: string | null;
  baleStatus: string;
}

export interface ProformaLine {
  articleCode: string;
  productName: string;
  quantity: number;
}

export interface LoadDetail extends V3Load {
  bales: LoadBale[];
  proformaLines: ProformaLine[];
}

export interface Proforma {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  customerId: number;
  customerName: string;
  lineCount: number;
  totalQty: number;
  v3LoadCount: number;
  v3ActiveCount: number;
}

// ─────────────────────── Helpers ───────────────────────

export type Tab = (typeof TABS)[number];
