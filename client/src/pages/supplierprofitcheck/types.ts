/**
 * Types for the SupplierProfitCheck page.
 *
 * Extracted from SupplierProfitCheck.tsx during the Phase 4 god-file split.
 */

import {ALL_COLUMNS} from "./utils";

export type ColKey = (typeof ALL_COLUMNS)[number]["key"];

export type ColVisibility = Record<ColKey, boolean>;

export // ─── Interfaces ───────────────────────────────────────────────────────────────
interface AnalysisRow {
  stockItemId: number;
  code: string;
  name: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  currentStock: number;
  salesQty: number;
  avgSellingPrice: number | null;
  groupSellingPrice: number | null;
  poPrice: number | null;
  poPriceSource: string;
  inventoryAvgCost: number;
  nCost: number;
  configPrice: number;
  offloadingCost: number;
  profitPercent: number | null;
  status: string;
  proformaQty: number | null;
  proformaBarcode: string | null;
  unresolved?: boolean;
}

export interface OtwContainer {
  id: number;
  container_number: string;
  eta: string | null;
  status: string;
  items_total: string | null;
  item_name: string | null;
  loaded_items_count: string;
}

export interface LocationGroup {
  id: number;
  name: string;
}

export interface ComputedRow extends AnalysisRow {
  landingCost: number | null;
  costProfit: number | null;
  costProfitPct: number | null;
  computedStatus: string;
  hassanProfit: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
