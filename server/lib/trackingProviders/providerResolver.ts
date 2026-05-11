/**
 * providerResolver.ts — Detect carrier from container number prefix and return
 * the correct direct provider to try before falling back to ParcelsApp.
 *
 * ISO container numbers: 4-letter owner code + 6 digits + 1 check digit.
 * The first 4 letters identify the equipment owner/operator.
 */

import * as maerskProvider from "./maerskProvider";
import type { CarrierTrackResult } from "./types";

export type DetectedCarrier = "MAERSK" | "CMA" | "MSC" | "HAPAG" | "OTHER" | null;

// ── Prefix → carrier map ──────────────────────────────────────────────────────

const PREFIX_MAP: Record<string, DetectedCarrier> = {
  // ── Maersk Line (incl. Hamburg Süd, SafMarine, Seago subsidiaries) ─────────
  MAEU: "MAERSK", MRKU: "MAERSK", MSKU: "MAERSK", MRSU: "MAERSK",
  MCIU: "MAERSK", SUDU: "MAERSK", HASU: "MAERSK", TRHU: "MAERSK",
  TEMU: "MAERSK", SEAU: "MAERSK", PONU: "MAERSK", SEGU: "MAERSK",

  // ── CMA CGM (incl. ANL, APL, CNC) — no provider yet, placeholder ──────────
  CMAU: "CMA", CGMU: "CMA", APMU: "CMA", APHU: "CMA",
  CXDU: "CMA", CAAU: "CMA", CAJU: "CMA", CAIU: "CMA",

  // ── MSC ───────────────────────────────────────────────────────────────────
  MSCU: "MSC", MEDU: "MSC", MSDU: "MSC",

  // ── Hapag-Lloyd ───────────────────────────────────────────────────────────
  HLCU: "HAPAG", HLXU: "HAPAG",

  // ── Leasing (Triton, Textainer, Gold Fields, etc.)
  //    Prefix only tells us the box owner, not the actual shipping line.
  //    ParcelsApp handles detection for these automatically.
  TCNU: "OTHER", TGBU: "OTHER", TCKU: "OTHER", TLLU: "OTHER",
  TCLU: "OTHER", TGHU: "OTHER", TIIU: "OTHER", UETU: "OTHER",
  ECMU: "OTHER", TXGI: "OTHER",
};

// Real ISO container numbers are 11 characters; skip obvious placeholders.
const MIN_LEN = 9;

export function detectCarrier(containerNumber: string): DetectedCarrier {
  const trimmed = containerNumber.trim();
  if (trimmed.length < MIN_LEN) return null;
  const prefix = trimmed.toUpperCase().slice(0, 4);
  return PREFIX_MAP[prefix] ?? null;
}

// ── Resolution result ─────────────────────────────────────────────────────────

export interface ProviderResolution {
  detectedCarrier: DetectedCarrier;
  /**
   * Call this to attempt direct-carrier tracking.
   * Null when no direct provider is available for this carrier
   * (not configured, or carrier has no provider wired yet).
   */
  tryDirect: (() => Promise<CarrierTrackResult>) | null;
}

/**
 * Given a container number, return the detected carrier and a function to
 * attempt direct tracking before falling back to ParcelsApp.
 */
export function resolveProvider(containerNumber: string): ProviderResolution {
  const detectedCarrier = detectCarrier(containerNumber);

  // ── Maersk ────────────────────────────────────────────────────────────────
  if (detectedCarrier === "MAERSK") {
    if (maerskProvider.isConfigured()) {
      return {
        detectedCarrier,
        tryDirect: () => maerskProvider.track(containerNumber),
      };
    }
    // Credentials not set — fall through to ParcelsApp
    return { detectedCarrier, tryDirect: null };
  }

  // ── CMA CGM — provider stub ready for when CMACGM_API_KEY is obtained ─────
  if (detectedCarrier === "CMA") {
    // TODO: wire cmaCgmProvider here when CMACGM_API_KEY is configured
    return { detectedCarrier, tryDirect: null };
  }

  // All other carriers (MSC, HAPAG, leasing, unknown) → ParcelsApp only
  return { detectedCarrier, tryDirect: null };
}
