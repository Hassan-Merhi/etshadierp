/**
 * providerResolver.ts — Detect carrier from container number prefix and
 * resolve which direct provider (if any) should be tried before ParcelsApp.
 *
 * ISO container numbers: 4 letter owner code + 6 digits + 1 check digit.
 * The first 4 letters identify the owner/operator.
 */

import * as maerskProvider from "./maerskProvider";

/** Canonical carrier names used throughout the system. */
export type DetectedCarrier = "MAERSK" | "CMA" | "MSC" | "HAPAG" | "ONE" | "OOCL" | "AUTO" | null;

/** Maps the first 4-character ISO prefix to a carrier. */
const PREFIX_MAP: Record<string, DetectedCarrier> = {
  // ── Maersk Line (incl. Hamburg Süd, Seago, SafMarine subsidiaries) ──────
  MAEU: "MAERSK", MRKU: "MAERSK", MSKU: "MAERSK", MRSU: "MAERSK",
  MCIU: "MAERSK", SUDU: "MAERSK", HASU: "MAERSK", TRHU: "MAERSK",
  TEMU: "MAERSK", SEAU: "MAERSK", PONU: "MAERSK",

  // ── CMA CGM (incl. ANL, APL, CNC, MacAndrews) ───────────────────────────
  CMAU: "CMA", CGMU: "CMA", APMU: "CMA", APHU: "CMA",
  CXDU: "CMA", CAAU: "CMA", CAJU: "CMA", CAIU: "CMA",

  // ── MSC ─────────────────────────────────────────────────────────────────
  MSCU: "MSC", MEDU: "MSC", MSDU: "MSC",

  // ── Hapag-Lloyd ──────────────────────────────────────────────────────────
  HLCU: "HAPAG", HLXU: "HAPAG",

  // ── Ocean Network Express (ONE) ──────────────────────────────────────────
  ONEY: "ONE", ONEU: "ONE",

  // ── OOCL ────────────────────────────────────────────────────────────────
  OOLU: "OOCL", OOCU: "OOCL",

  // ── Leasing companies — carrier unknown from prefix alone ────────────────
  // Mark as AUTO so ParcelsApp handles detection.
  TCNU: "AUTO", TGBU: "AUTO", TCKU: "AUTO", TLLU: "AUTO",
  TCLU: "AUTO", TGHU: "AUTO", TIIU: "AUTO", UETU: "AUTO",
  ECMU: "AUTO", TXGI: "AUTO",
};

const MIN_LEN = 9; // Real ISO container numbers are 11 chars; accept 9+ to be safe.

/** Detect carrier from the first 4 characters of the container number. */
export function detectCarrier(containerNumber: string): DetectedCarrier {
  const trimmed = containerNumber.trim();
  if (trimmed.length < MIN_LEN) return null; // placeholder / dummy number
  const prefix = trimmed.toUpperCase().slice(0, 4);
  return PREFIX_MAP[prefix] ?? null; // null = truly unknown prefix
}

export interface ProviderResolution {
  detectedCarrier: DetectedCarrier;
  /**
   * Function that runs the direct carrier tracking attempt.
   * Returns null if no direct provider is available for this carrier
   * (e.g. not configured, or carrier has no provider implemented yet).
   */
  tryDirect: (() => Promise<import("./types").CarrierTrackResult>) | null;
}

/**
 * Given a container number (and optional manual hint), return the detected
 * carrier and a function to attempt direct tracking — or null if unavailable.
 */
export function resolveProvider(
  containerNumber: string,
  _carrierHint?: string | null,
): ProviderResolution {
  const detectedCarrier = detectCarrier(containerNumber);

  // ── Maersk ────────────────────────────────────────────────────────────────
  if (detectedCarrier === "MAERSK") {
    if (maerskProvider.isConfigured()) {
      return {
        detectedCarrier,
        tryDirect: () => maerskProvider.track(containerNumber),
      };
    }
    // Credentials not set → no direct provider, will fall to ParcelsApp
    return { detectedCarrier, tryDirect: null };
  }

  // ── CMA CGM (placeholder — provider added when credentials obtained) ──────
  if (detectedCarrier === "CMA") {
    // TODO: add cmaCgmProvider when CMACGM_API_KEY is configured
    return { detectedCarrier, tryDirect: null };
  }

  // All other carriers → no direct provider yet
  return { detectedCarrier: detectedCarrier, tryDirect: null };
}
