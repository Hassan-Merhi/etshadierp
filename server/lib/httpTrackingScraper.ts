/**
 * httpTrackingScraper.ts — Lightweight HTTP-only container tracker.
 *
 * Tries two approaches without launching any browser:
 *   1. POST to ParcelsApp's internal tracking API (works when reCAPTCHA
 *      is absent or the session is treated as trusted).
 *   2. Fetch the tracking page HTML and extract the embedded Nuxt JSON
 *      payload that Nuxt SSR inlines for the initial page load.
 *
 * Never throws — always returns a typed result so the caller can decide
 * whether to continue down the provider chain.
 */

import type { ParcelsAppShipment } from "./parcelsAppClient";

export interface HttpScraperResult {
  success: boolean;
  shipment: ParcelsAppShipment | null;
  rawResponse?: unknown;
  error?: string;
}

const TIMEOUT_MS = 15_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Always returns true — no binary or key required for plain HTTP. */
export function isHttpScraperAvailable(): boolean {
  return true;
}

/**
 * Attempt 1: call ParcelsApp's internal tracking API directly.
 * Skips the Puppeteer/reCAPTCHA flow — works when the origin header
 * alone is enough to satisfy the server, fails silently otherwise.
 */
async function tryDirectApi(containerNumber: string): Promise<HttpScraperResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch("https://parcelsapp.com/api/v3/shipments/tracking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": BROWSER_UA,
        "Origin": "https://parcelsapp.com",
        "Referer": `https://parcelsapp.com/en/tracking/${encodeURIComponent(containerNumber)}`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({ trackingId: containerNumber, language: "en" }),
      signal: controller.signal,
    });
    clearTimeout(tid);

    if (!resp.ok) return { success: false, shipment: null, error: `HTTP ${resp.status}` };

    const data: any = await resp.json();
    if (data?.error || data?.blocked) {
      return { success: false, shipment: null, error: data.error ?? "blocked" };
    }

    const all: ParcelsAppShipment[] = data?.shipments ?? data?.parcels ?? [];
    const shipment =
      all.find((s: any) => s.trackingId === containerNumber || s.id === containerNumber) ??
      all[0] ??
      null;

    return { success: !!shipment, shipment, rawResponse: data };
  } catch (err: any) {
    clearTimeout(tid);
    return { success: false, shipment: null, error: err?.message ?? "fetch error" };
  }
}

/**
 * Attempt 2: fetch the page HTML and extract the Nuxt SSR payload.
 * Nuxt 2 embeds JSON as `window.__NUXT__ = {...}`, Nuxt 3 embeds it in
 * `<script type="application/json" data-island-uid>` tags.
 */
async function tryPageHtml(containerNumber: string): Promise<HttpScraperResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(
      `https://parcelsapp.com/en/tracking/${encodeURIComponent(containerNumber)}`,
      {
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
      },
    );
    clearTimeout(tid);

    if (!resp.ok) return { success: false, shipment: null, error: `HTML fetch HTTP ${resp.status}` };

    const html = await resp.text();

    // ── Nuxt 2: window.__NUXT__ = { ... } ──────────────────────────────────
    const nuxt2 = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*(?:;?\s*<\/script>)/);
    if (nuxt2) {
      try {
        const parsed = JSON.parse(nuxt2[1]);
        const shipment = extractFromNuxtPayload(parsed, containerNumber);
        if (shipment) return { success: true, shipment, rawResponse: parsed };
      } catch { /* continue */ }
    }

    // ── Nuxt 3: <script type="application/json" ...> ────────────────────────
    const jsonScripts = [...html.matchAll(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of jsonScripts) {
      try {
        const parsed = JSON.parse(m[1]);
        const shipment = extractFromNuxtPayload(parsed, containerNumber);
        if (shipment) return { success: true, shipment, rawResponse: parsed };
      } catch { /* next */ }
    }

    return { success: false, shipment: null, error: "No embedded tracking data found in page HTML" };
  } catch (err: any) {
    clearTimeout(tid);
    return { success: false, shipment: null, error: err?.message ?? "page fetch error" };
  }
}

/** Walk the Nuxt payload tree looking for a ParcelsAppShipment-like object. */
function extractFromNuxtPayload(payload: any, containerNumber: string): ParcelsAppShipment | null {
  if (!payload || typeof payload !== "object") return null;

  // Direct arrays
  const candidates: any[] = payload?.shipments ?? payload?.parcels ?? payload?.data?.shipments ?? payload?.data?.parcels ?? [];
  if (candidates.length) {
    const match =
      candidates.find((s: any) => s?.trackingId === containerNumber || s?.id === containerNumber) ??
      candidates[0];
    if (match?.trackingId || match?.id) return match as ParcelsAppShipment;
  }

  // Recurse one level into common Nuxt payload keys
  for (const key of ["data", "state", "fetch", "nuxt", "payload"]) {
    if (payload[key] && typeof payload[key] === "object") {
      const found = extractFromNuxtPayload(payload[key], containerNumber);
      if (found) return found;
    }
  }

  return null;
}

/** Main entry point — tries both approaches and returns the first success. */
export async function httpScrapeTracking(containerNumber: string): Promise<HttpScraperResult> {
  const apiResult = await tryDirectApi(containerNumber);
  if (apiResult.success) return apiResult;

  const pageResult = await tryPageHtml(containerNumber);
  if (pageResult.success) return pageResult;

  return {
    success: false,
    shipment: null,
    error: `HTTP scraper: ${apiResult.error ?? "api failed"} / ${pageResult.error ?? "page failed"}`,
  };
}
