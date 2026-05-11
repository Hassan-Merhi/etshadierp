/**
 * providerResolver.ts — Detect carrier from container number prefix and return
 * the ordered list of direct providers to try before falling back to ParcelsApp.
 *
 * Provider order per carrier:
 *   MAERSK: 1. Maersk official API (if credentials set)
 *           2. Maersk public page  (if MAERSK_PUBLIC_TRACKING_ENABLED=true)
 *   CMA:    1. CMA public page     (if CMA_PUBLIC_TRACKING_ENABLED=true)
 *   Other:  → ParcelsApp only
 */

import * as maerskProvider from "./maerskProvider";
import * as maerskPublicProvider from "./maerskPublicProvider";
import * as cmaPublicProvider from "./cmaPublicProvider";
import type { CarrierTrackResult } from "./types";

export type DetectedCarrier = "MAERSK" | "CMA" | "MSC" | "HAPAG" | "OTHER" | null;

// ── Prefix → carrier map ──────────────────────────────────────────────────────

const PREFIX_MAP: Record<string, DetectedCarrier> = {
  // ── Maersk Line (incl. Hamburg Süd, SafMarine, Seago subsidiaries) ─────────
  MAEU: "MAERSK", MRKU: "MAERSK", MSKU: "MAERSK", MRSU: "MAERSK",
  MCIU: "MAERSK", SUDU: "MAERSK", HASU: "MAERSK", TRHU: "MAERSK",
  TEMU: "MAERSK", SEAU: "MAERSK", PONU: "MAERSK", SEGU: "MAERSK",

  // ── CMA CGM (incl. ANL, APL, CNC) ─────────────────────────────────────────
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
   * Ordered list of direct-carrier providers to try before falling back to
   * ParcelsApp. Each entry is a zero-argument function that returns a result.
   * Empty array means go straight to ParcelsApp.
   */
  tryDirect: Array<() => Promise<CarrierTrackResult>>;
}

/**
 * Returns true if at least one non-ParcelsApp direct provider is available
 * (configured or enabled via env flag). Used to decide whether any direct
 * attempt is worth making.
 */
export function anyDirectProviderPossible(): boolean {
  return (
    maerskProvider.isConfigured() ||
    maerskPublicProvider.isEnabled() ||
    cmaPublicProvider.isEnabled()
  );
}

/**
 * Given a container number, return the detected carrier and the ordered list
 * of direct providers to attempt before falling back to ParcelsApp.
 */
export function resolveProvider(containerNumber: string): ProviderResolution {
  const detectedCarrier = detectCarrier(containerNumber);
  const tryDirect: Array<() => Promise<CarrierTrackResult>> = [];
  const directNames: string[] = [];

  // ── Maersk ────────────────────────────────────────────────────────────────
  if (detectedCarrier === "MAERSK") {
    if (maerskProvider.isConfigured()) {
      tryDirect.push(() => maerskProvider.track(containerNumber));
      directNames.push("maersk");
    }
    if (maerskPublicProvider.isEnabled()) {
      tryDirect.push(() => maerskPublicProvider.track(containerNumber));
      directNames.push("maersk_public");
    }
    console.log(
      `[ProviderResolver] container=${containerNumber} prefix=${containerNumber.slice(0, 4).toUpperCase()} ` +
        `detectedCarrier=MAERSK directProviders=[${directNames.join(", ") || "none"}]`,
    );
    return { detectedCarrier, tryDirect };
  }

  // ── CMA CGM ───────────────────────────────────────────────────────────────
  if (detectedCarrier === "CMA") {
    if (cmaPublicProvider.isEnabled()) {
      tryDirect.push(() => cmaPublicProvider.track(containerNumber));
      directNames.push("cma_public");
    }
    console.log(
      `[ProviderResolver] container=${containerNumber} prefix=${containerNumber.slice(0, 4).toUpperCase()} ` +
        `detectedCarrier=CMA directProviders=[${directNames.join(", ") || "none"}]`,
    );
    return { detectedCarrier, tryDirect };
  }

  // All other carriers (MSC, HAPAG, leasing, unknown) → ParcelsApp fallback
  console.log(
    `[ProviderResolver] container=${containerNumber} prefix=${containerNumber.slice(0, 4).toUpperCase()} ` +
      `detectedCarrier=${detectedCarrier ?? "unknown"} directProviders=[] → http/scraper/parcelsapp fallback`,
  );
  return { detectedCarrier, tryDirect: [] };
}
