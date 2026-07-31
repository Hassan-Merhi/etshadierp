/**
 * Pure helpers and lookup tables for the GroundScan page.
 *
 * Extracted from GroundScan.tsx during the Phase 4 god-file split.
 */

import type { GroundScanItem, ScannedBale } from "./types";

export function rowToScannedBale(r: GroundScanItem): ScannedBale {
  return {
    refCode: r.reference_number,
    articleCode: r.article_code || "",
    productName: r.product_name || "Unknown",
    weightKg: parseFloat(r.weight_kg || "0"),
    status: r.status || "",
    isInLoadingOrder: r.is_in_loading_order,
    scannedAt: new Date(r.scanned_at),
    dateBaleProduced: r.date_bale_produced ?? null,
    workerName: r.worker_name ?? null,
  };
}

export const STORAGE_KEY = "ground_scan_bales";

export const LOCATION_KEY = "ground_scan_locationId";

export function loadLocalBales(): ScannedBale[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as (Omit<ScannedBale, "scannedAt"> & { scannedAt: string })[];
    return parsed.map((b) => ({ ...b, scannedAt: new Date(b.scannedAt) }));
  } catch {
    return [];
  }
}
