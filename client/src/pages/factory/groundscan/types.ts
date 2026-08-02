/**
 * Types for the GroundScan page.
 *
 * Extracted from GroundScan.tsx during the Phase 4 god-file split.
 */

export interface StockLocation {
  id: number;
  name: string;
  count: number;
}

export interface ScannedBale {
  refCode: string;
  articleCode: string;
  productName: string;
  weightKg: number;
  status: string;
  isInLoadingOrder?: boolean;
  scannedAt: Date;
  dateBaleProduced: string | null;
  workerName: string | null;
}

export interface GroundScanItem {
  id: number;
  location_id: number | null;
  reference_number: string;
  article_code: string | null;
  product_name: string | null;
  weight_kg: string | null;
  status: string | null;
  is_in_loading_order: boolean;
  scanned_at: string;
  date_bale_produced: string | null;
  worker_name: string | null;
}
