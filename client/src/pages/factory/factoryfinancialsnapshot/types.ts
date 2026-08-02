/**
 * Types for the FactoryFinancialSnapshot page.
 *
 * Extracted from FactoryFinancialSnapshot.tsx during the Phase 4 god-file split.
 */

export interface SnapshotData {
  baleWeightTotal: number;
  baleCount: number;
  baleValueTotal: number;
}

export interface NetPositionAccount {
  name: string;
  code: string;
  value: number;
  category: string;
  id?: number;
  breakdown?: { label: string; native: string; usd: number }[];
}

export interface NetPositionData {
  asOf?: string;
  rawMaterialValue: number;
  balanceOnTableValue: number;
  supplierLiabilities: number;
  supplierOverpayments?: number;
  forUs: { total: number; accounts: NetPositionAccount[] };
  onUs: { total: number; accounts: NetPositionAccount[] };
}

export type PinnedRow = { id: number; accountId: string; accountType: string; accountName: string };

export type CardKey = "agent" | "freight" | "advance" | "cashbank";
