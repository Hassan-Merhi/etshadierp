/**
 * httpTrackingScraper.ts — Lightweight HTTP-only multi-carrier tracker.
 *
 * Detects the carrier from the container number prefix and tries that
 * carrier's own public API endpoint directly — no browser, no quota.
 *
 * Carrier coverage:
 *   MSC       → msc.com internal tracing API
 *   Hapag-Lloyd → hapag-lloyd.com traceback API
 *   COSCO      → coscoshipping.com cargo tracking
 *   Evergreen  → evergreen-line.com tracking
 *   Yang Ming  → yangmingusa.com tracking
 *   OOCL       → oocl.com tracking
 *   (fallback)  → ParcelsApp page HTML for any other carrier
 *
 * Never throws — always returns a typed result.
 */

import type { ParcelsAppShipment } from "./parcelsAppClient";

export interface HttpScraperResult {
  success: boolean;
  shipment: ParcelsAppShipment | null;
  rawResponse?: unknown;
  error?: string;
}

const TIMEOUT_MS = 12_000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const BASE_HEADERS: Record<string, string> = {
  "User-Agent": BROWSER_UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

export function isHttpScraperAvailable(): boolean {
  return true;
}

// ── Carrier prefix detection ───────────────────────────────────────────────────

function detectCarrier(containerNumber: string): string | null {
  const prefix = containerNumber.slice(0, 4).toUpperCase();
  // HASU = Hamburg Süd (Maersk-owned since 2017, tracked via Maersk)
  if (/^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM)/.test(prefix)) return "MAERSK";
  if (/^(MSCU|MSDU|MEDU|MSMU|MSWU)/.test(prefix)) return "MSC";
  if (/^(HLCU|HLXU)/.test(prefix)) return "HAPAG";
  if (/^(COSU|CBHU|CCLU|COSJ)/.test(prefix)) return "COSCO";
  if (/^(EVRU|EVRG|EMCU|EGHU)/.test(prefix)) return "EVERGREEN";
  if (/^(YMLU|YMLZ|YMMU)/.test(prefix)) return "YANGMING";
  if (/^(OOLU|OOCU|OOCL)/.test(prefix)) return "OOCL";
  if (/^(CMAU|CMDU|APZU)/.test(prefix)) return "CMA";
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function abort(ms: number): AbortController {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl;
}

function toShipment(
  containerNumber: string,
  status: string | null,
  location: string | null,
  eta: string | null,
  events: Array<{ date: string; status: string; location?: string; description?: string }>,
): ParcelsAppShipment {
  return {
    trackingId: containerNumber,
    done: true,
    attributes: {
      ...(status ? { status } : {}),
      ...(location ? { location } : {}),
      ...(eta ? { estimatedArrival: eta } : {}),
    },
    states: events,
  };
}

// ── MSC ────────────────────────────────────────────────────────────────────────

async function tryMsc(containerNumber: string): Promise<HttpScraperResult> {
  try {
    const ctrl = abort(TIMEOUT_MS);
    const resp = await fetch("https://www.msc.com/api/feature/tools/tracing/get-trace-results", {
      method: "POST",
      headers: { ...BASE_HEADERS, "Content-Type": "application/json", "Origin": "https://www.msc.com", "Referer": "https://www.msc.com/en/track-a-shipment" },
      body: JSON.stringify({ tracing_reference: containerNumber, language: "eng" }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return { success: false, shipment: null, error: `MSC HTTP ${resp.status}` };
    const data: any = await resp.json();
    const activities: any[] = data?.TrackingDetails?.TrackingActivities ?? data?.trackingActivities ?? [];
    if (!activities.length) return { success: false, shipment: null, error: "MSC: no activities" };
    const events = activities.map((a: any) => ({
      date: a.ActivityDate ?? a.date ?? "",
      status: a.ActivityDescription ?? a.description ?? "",
      location: a.Location ?? a.location ?? "",
    }));
    const latest = events[0];
    // Try dedicated ETA fields first, then scan activities for an ETA event.
    let etaRaw: string | null =
      data?.TrackingDetails?.ETA ??
      data?.TrackingDetails?.VesselETA ??
      data?.TrackingDetails?.EstimatedTimeOfArrival ??
      data?.TrackingDetails?.EstimatedArrival ??
      data?.eta ??
      null;
    if (!etaRaw) {
      const etaActivity = activities.find((a: any) => {
        const desc = ((a.ActivityDescription ?? a.description ?? "") as string).toLowerCase();
        return (
          desc.includes("estimated time of arrival") ||
          desc.includes("estimated arrival") ||
          desc === "eta"
        );
      });
      if (etaActivity) {
        etaRaw = etaActivity.ActivityDate ?? etaActivity.date ?? null;
      }
    }
    const shipment = toShipment(containerNumber, latest?.status ?? null, latest?.location ?? null, etaRaw, events);
    return { success: true, shipment, rawResponse: data };
  } catch (err: any) {
    return { success: false, shipment: null, error: `MSC: ${err?.message ?? "error"}` };
  }
}

// ── Hapag-Lloyd ────────────────────────────────────────────────────────────────

async function tryHapag(containerNumber: string): Promise<HttpScraperResult> {
  try {
    const ctrl = abort(TIMEOUT_MS);
    const resp = await fetch(
      `https://www.hapag-lloyd.com/api/containertraceback/${encodeURIComponent(containerNumber)}?requestorType=website`,
      { headers: { ...BASE_HEADERS, "Referer": "https://www.hapag-lloyd.com/en/online-business/track/track-by-container-id.html" }, signal: ctrl.signal },
    );
    if (!resp.ok) return { success: false, shipment: null, error: `Hapag HTTP ${resp.status}` };
    const data: any = await resp.json();
    const moves: any[] = data?.containerJourneys?.[0]?.containerMoves ?? data?.moves ?? [];
    if (!moves.length) return { success: false, shipment: null, error: "Hapag: no moves" };
    const events = moves.map((m: any) => ({
      date: m.eventDateTime ?? m.date ?? "",
      status: m.transportModeDescription ?? m.event ?? m.status ?? "",
      location: m.portOfCall ?? m.location ?? "",
    }));
    const latest = events[0];
    const etaRaw = data?.containerJourneys?.[0]?.eta ?? data?.eta ?? null;
    const shipment = toShipment(containerNumber, latest?.status ?? null, latest?.location ?? null, etaRaw, events);
    return { success: true, shipment, rawResponse: data };
  } catch (err: any) {
    return { success: false, shipment: null, error: `Hapag: ${err?.message ?? "error"}` };
  }
}

// ── COSCO ──────────────────────────────────────────────────────────────────────

async function tryCosco(containerNumber: string): Promise<HttpScraperResult> {
  try {
    const ctrl = abort(TIMEOUT_MS);
    const resp = await fetch(
      `https://elines.coscoshipping.com/ebusiness/cargoTracking?condition.cargoTrackNo=${encodeURIComponent(containerNumber)}`,
      { headers: { ...BASE_HEADERS, "Referer": "https://elines.coscoshipping.com/ebusiness/cargoTracking" }, signal: ctrl.signal },
    );
    if (!resp.ok) return { success: false, shipment: null, error: `COSCO HTTP ${resp.status}` };
    const data: any = await resp.json();
    const detail = data?.data?.content?.[0];
    if (!detail) return { success: false, shipment: null, error: "COSCO: no data" };
    const moves: any[] = detail.movementActivities ?? detail.activities ?? [];
    const events = moves.map((m: any) => ({
      date: m.eventDate ?? m.date ?? "",
      status: m.activity ?? m.status ?? "",
      location: m.location ?? "",
    }));
    const latest = events[0];
    const etaRaw = detail.estimatedArrivalDate ?? detail.eta ?? null;
    const shipment = toShipment(containerNumber, latest?.status ?? null, latest?.location ?? null, etaRaw, events);
    return { success: true, shipment, rawResponse: data };
  } catch (err: any) {
    return { success: false, shipment: null, error: `COSCO: ${err?.message ?? "error"}` };
  }
}

// ── Evergreen ──────────────────────────────────────────────────────────────────

async function tryEvergreen(containerNumber: string): Promise<HttpScraperResult> {
  try {
    const ctrl = abort(TIMEOUT_MS);
    const resp = await fetch(
      `https://www.evergreen-line.com/ese/jsp/ct_tracking_info.jsp?lang=en&q=${encodeURIComponent(containerNumber)}&sType=CT`,
      { headers: { ...BASE_HEADERS, "Referer": "https://www.evergreen-line.com/ese/jsp/cargotracking.jsp" }, signal: ctrl.signal },
    );
    if (!resp.ok) return { success: false, shipment: null, error: `Evergreen HTTP ${resp.status}` };
    const data: any = await resp.json();
    const moves: any[] = data?.EventList ?? data?.events ?? [];
    if (!moves.length) return { success: false, shipment: null, error: "Evergreen: no events" };
    const events = moves.map((m: any) => ({
      date: m.EventDate ?? m.date ?? "",
      status: m.EventName ?? m.status ?? "",
      location: m.PortName ?? m.location ?? "",
    }));
    const latest = events[0];
    const etaRaw = data?.ETA ?? data?.eta ?? null;
    const shipment = toShipment(containerNumber, latest?.status ?? null, latest?.location ?? null, etaRaw, events);
    return { success: true, shipment, rawResponse: data };
  } catch (err: any) {
    return { success: false, shipment: null, error: `Evergreen: ${err?.message ?? "error"}` };
  }
}

// ── Maersk HTML page (Next.js embedded data) ──────────────────────────────────

async function tryMaerskHtml(containerNumber: string): Promise<HttpScraperResult> {
  try {
    const ctrl = abort(15_000);
    const resp = await fetch(
      `https://www.maersk.com/tracking/${encodeURIComponent(containerNumber)}`,
      {
        headers: {
          ...BASE_HEADERS,
          "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
        },
        signal: ctrl.signal,
        redirect: "follow",
      },
    );
    if (!resp.ok) return { success: false, shipment: null, error: `Maersk page HTTP ${resp.status}` };
    const html = await resp.text();

    // Next.js pages embed data in <script id="__NEXT_DATA__">
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        const props = nextData?.props?.pageProps ?? {};
        const td = props?.tracking ?? props?.trackingData ?? props?.container ?? props?.shipment;
        if (td) {
          const rawEvents: any[] = td.events ?? td.movements ?? td.milestones ?? td.containers?.[0]?.events ?? [];
          if (rawEvents.length > 0) {
            const events = rawEvents.map((e: any) => ({
              date: e.eventDateTime ?? e.eventDate ?? e.timestamp ?? e.date ?? "",
              status: e.activityName ?? e.eventCode ?? e.status ?? e.description ?? "",
              location: e.location?.portName ?? e.portName ?? (typeof e.location === "string" ? e.location : "") ?? "",
            }));
            const latest = events[0];
            const etaRaw = td.eta ?? td.estimatedTimeOfArrival ?? td.estimatedArrival ?? null;
            return {
              success: true,
              shipment: toShipment(containerNumber, latest?.status ?? null, latest?.location ?? null, etaRaw, events),
              rawResponse: { source: "maersk_next_data", events: events.length },
            };
          }
        }
      } catch { /* parse error — continue */ }
    }

    // application/json script tags (some Next.js versions)
    for (const m of html.matchAll(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(m[1]);
        const events: any[] = data?.events ?? data?.movements ?? [];
        if (events.length > 0) {
          const mapped = events.map((e: any) => ({
            date: e.date ?? e.eventDateTime ?? "",
            status: e.status ?? e.activityName ?? "",
            location: e.location ?? e.portName ?? "",
          }));
          return {
            success: true,
            shipment: toShipment(containerNumber, mapped[0]?.status ?? null, mapped[0]?.location ?? null, null, mapped),
            rawResponse: { source: "maersk_json_script" },
          };
        }
      } catch { /* next */ }
    }

    const isBlocked = /captcha|datadome|challenge|cloudflare|blocked/i.test(html.slice(0, 2000));
    return { success: false, shipment: null, error: isBlocked ? "Maersk page: bot challenge" : "Maersk page: no tracking data in HTML" };
  } catch (err: any) {
    return { success: false, shipment: null, error: `Maersk page: ${err?.message ?? "error"}` };
  }
}

// ── ParcelsApp page HTML fallback (for unknown carriers) ──────────────────────

async function tryPageHtml(containerNumber: string): Promise<HttpScraperResult> {
  try {
    const ctrl = abort(TIMEOUT_MS);
    const resp = await fetch(
      `https://parcelsapp.com/en/tracking/${encodeURIComponent(containerNumber)}`,
      { headers: { ...BASE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*" }, signal: ctrl.signal },
    );
    if (!resp.ok) return { success: false, shipment: null, error: `Page HTML ${resp.status}` };
    const html = await resp.text();

    // Nuxt 2: window.__NUXT__ = { ... }
    const nuxt2 = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*(?:;?\s*<\/script>)/);
    if (nuxt2) {
      try {
        const parsed = JSON.parse(nuxt2[1]);
        const shipment = extractFromNuxt(parsed, containerNumber);
        if (shipment) return { success: true, shipment, rawResponse: parsed };
      } catch { /* continue */ }
    }

    // Nuxt 3: <script type="application/json">
    for (const m of html.matchAll(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const parsed = JSON.parse(m[1]);
        const shipment = extractFromNuxt(parsed, containerNumber);
        if (shipment) return { success: true, shipment, rawResponse: parsed };
      } catch { /* next */ }
    }

    return { success: false, shipment: null, error: "No embedded tracking data in page" };
  } catch (err: any) {
    return { success: false, shipment: null, error: `Page HTML: ${err?.message ?? "error"}` };
  }
}

function extractFromNuxt(payload: any, containerNumber: string): ParcelsAppShipment | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates: any[] = payload?.shipments ?? payload?.parcels ?? payload?.data?.shipments ?? payload?.data?.parcels ?? [];
  if (candidates.length) {
    const match = candidates.find((s: any) => s?.trackingId === containerNumber || s?.id === containerNumber) ?? candidates[0];
    if (match?.trackingId || match?.id) return match as ParcelsAppShipment;
  }
  for (const key of ["data", "state", "fetch", "nuxt", "payload"]) {
    if (payload[key] && typeof payload[key] === "object") {
      const found = extractFromNuxt(payload[key], containerNumber);
      if (found) return found;
    }
  }
  return null;
}

// ── Main entry point ───────────────────────────────────────────────────────────

export async function httpScrapeTracking(containerNumber: string): Promise<HttpScraperResult> {
  const carrier = detectCarrier(containerNumber);
  console.log(`[HttpScraper] ${containerNumber}: detected carrier=${carrier ?? "unknown"}`);

  let result: HttpScraperResult;

  switch (carrier) {
    case "MSC":
      result = await tryMsc(containerNumber);
      break;
    case "HAPAG":
      result = await tryHapag(containerNumber);
      break;
    case "COSCO":
      result = await tryCosco(containerNumber);
      break;
    case "EVERGREEN":
      result = await tryEvergreen(containerNumber);
      break;
    case "MAERSK":
      // Maersk's page is SSR-less — no data in HTML.
      // The real data comes from maersk_direct (Puppeteer intercept) which
      // runs after this scraper in the provider chain.
      result = { success: false, shipment: null, error: "Maersk page: no tracking data in HTML" };
      break;
    case "CMA":
      // CMA CGM is protected by DataDome — their page/HTML yields nothing.
      // ParcelsApp API handles CMA directly and is called after this scraper.
      result = { success: false, shipment: null, error: "CMA page: DataDome protected, use ParcelsApp API" };
      break;
    default:
      // For YANGMING, OOCL, and unknowns — try ParcelsApp page HTML.
      result = await tryPageHtml(containerNumber);
  }

  if (!result.success) {
    console.log(`[HttpScraper] ${containerNumber}: ${result.error ?? "no data"}`);
  } else {
    console.log(`[HttpScraper] ${containerNumber}: success via carrier=${carrier ?? "page"}`);
  }

  return result;
}
