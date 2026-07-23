/**
 * maerskDirectScraper.ts — Puppeteer-based Maersk tracking.
 *
 * Navigates to https://www.maersk.com/tracking/{container} with a stealth
 * headless browser, then intercepts the JSON API responses that Maersk's own
 * React app makes internally. Because the requests come from a real browser
 * session the Akamai/DataDome bot challenge is bypassed.
 *
 * Works for all Maersk-group prefixes: MAEU, MSKU, MRKU, MRSU,
 *   HASU, HJSC, HJCU, SUDU, SAFM (Hamburg Süd) etc.
 *
 * Memory strategy:
 *   - ONE shared Chrome process is kept alive across all scrape calls.
 *     Each scrape opens a new tab, uses it, then closes just the tab.
 *     This keeps memory at a flat ~300 MB instead of spiking per container.
 *   - A simple async mutex ensures only ONE scrape runs at a time, preventing
 *     concurrent Chrome tabs from stacking up.
 *   - If the shared browser crashes/disconnects it is automatically replaced
 *     on the next scrape call.
 *
 * Never throws — always returns a typed result.
 */

import { existsSync } from "fs";
import { logger } from "./logger";
import { execSync } from "child_process";
import { createRequire } from "module";
import type { CarrierTrackResult, TrackingEvent } from "./trackingProviders/types";
import { acquirePuppeteerSlot } from "./puppeteerSemaphore";

const _require = createRequire(import.meta.url);

function getChromiumPath(): string | null {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  for (const cmd of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8", timeout: 3000 }).trim();
      if (p && existsSync(p)) return p;
    } catch {
      /* not found */
    }
  }
  try {
    const puppeteer = _require("puppeteer");
    const p: string = typeof puppeteer.executablePath === "function" ? puppeteer.executablePath() : "";
    if (p && existsSync(p)) return p;
  } catch {
    /* not installed */
  }
  return null;
}

export function isMaerskDirectScraperAvailable(): boolean {
  try {
    _require.resolve("puppeteer-extra");
    _require.resolve("puppeteer-extra-plugin-stealth");
    _require.resolve("puppeteer");
    return !!getChromiumPath();
  } catch {
    return false;
  }
}

// ── Shared browser instance ───────────────────────────────────────────────────
// One Chrome process is kept alive and reused across all scrape calls.
// Replaced automatically if it crashes.

let _sharedBrowser: any = null;
let _stealthRegistered = false;

async function getSharedBrowser(): Promise<any> {
  // If we already have a live browser, verify it's still responsive
  if (_sharedBrowser) {
    try {
      await _sharedBrowser.pages(); // lightweight liveness check
      return _sharedBrowser;
    } catch {
      logger.warn("[MaerskDirect] Shared browser disconnected — relaunching");
      _sharedBrowser = null;
    }
  }

  const puppeteerExtra = _require("puppeteer-extra") as any;
  if (!_stealthRegistered) {
    const StealthPlugin = _require("puppeteer-extra-plugin-stealth") as any;
    puppeteerExtra.use(StealthPlugin());
    _stealthRegistered = true;
  }

  const chromePath = getChromiumPath();
  logger.info("[MaerskDirect] Launching shared Chrome instance…");
  _sharedBrowser = await puppeteerExtra.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,800",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-breakpad",
      "--disable-client-side-phishing-detection",
      "--disable-default-apps",
      "--disable-hang-monitor",
      "--disable-notifications",
      "--disable-sync",
      "--metrics-recording-only",
      "--password-store=basic",
      // Extra memory-saving flags
      "--js-flags=--max-old-space-size=256",
      "--disable-features=TranslateUI,BlinkGenPropertyTrees",
      "--renderer-process-limit=1",
    ],
  });

  // Auto-clear on crash so the next call relaunches cleanly
  _sharedBrowser.on("disconnected", () => {
    logger.warn("[MaerskDirect] Shared browser disconnected (crash or killed)");
    _sharedBrowser = null;
  });

  logger.info("[MaerskDirect] Shared Chrome instance ready");
  return _sharedBrowser;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a raw date/datetime string into a calendar date "YYYY-MM-DD"
 * WITHOUT shifting it across timezones.
 *
 * Maersk reports arrival dates in the LOCAL time of the port. Round-tripping
 * through Date#toISOString() re-expresses the instant in UTC, which can move
 * the calendar day forward or backward — e.g. "2024-05-10T22:00:00-05:00" is
 * "2024-05-11T03:00:00Z", so toISOString().slice(0,10) yields "2024-05-11",
 * one day AFTER the date Maersk actually shows. To stay faithful to the
 * carrier's displayed date we read the calendar part directly.
 */
export function formatEtaDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Fast path: string already begins with an ISO calendar date — take it
  // verbatim so an explicit offset never drags the day across midnight.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Otherwise let Date parse it (e.g. "May 10, 2024"), then read the LOCAL
  // calendar components rather than the UTC ones.
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Recursively walk any JSON object looking for ETA-named fields.
 * Returns { path, value: "YYYY-MM-DD" } for the first valid date found,
 * or null if none.  Only matches keys whose names explicitly mean
 * estimated/planned/scheduled arrival — never event dates.
 */
const DEEP_ETA_KEY_RE =
  /^(eta|estimatedArrival|estimatedTimeOfArrival|plannedArrival|plannedArrivalDate|scheduledArrival|predictiveEstimatedArrival|latestEstimatedArrival|arrivalDate|vesselArrival|portArrival|destinationEstimatedArrival)$/i;

export function deepScanForEta(obj: unknown, depth = 0): { path: string; value: string } | null {
  if (depth > 12 || !obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepScanForEta(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (DEEP_ETA_KEY_RE.test(k) && typeof v === "string" && v.trim()) {
      const value = formatEtaDate(v);
      if (value) return { path: k, value };
    }
    if (v && typeof v === "object") {
      const r = deepScanForEta(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function parseEvents(rawEvents: unknown[]): TrackingEvent[] {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents
    .map(
      (e: any): TrackingEvent => ({
        date: parseDate(e.eventDateTime ?? e.eventDate ?? e.timestamp ?? e.date ?? null),
        status: e.transportEventTypeCode ?? e.activityName ?? e.eventCode ?? e.activity ?? e.status ?? null,
        location:
          e.location?.portName ??
          e.location?.locationName ??
          e.location?.city ??
          e.portName ??
          e.locationName ??
          (typeof e.location === "string" ? e.location : null),
        description: e.description ?? e.eventDescription ?? e.activityName ?? null,
      })
    )
    .filter((e) => e.date !== null || e.status !== null)
    .sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.getTime() - a.date.getTime();
    });
}

const normContainer = (v: unknown): string => String(v ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * Pick the container the caller actually asked for out of a synergy/generic
 * `containers[]` array. Falls back to the first entry only when no match is
 * found — never blindly trusts index 0, since a response can carry several
 * containers (e.g. a bill-of-lading lookup) and [0] may be a different box.
 */
function pickContainer(list: any[], wantContainer?: string): any {
  if (!Array.isArray(list) || list.length === 0) return null;
  const wanted = wantContainer ? normContainer(wantContainer) : "";
  if (wanted) {
    const match = list.find(
      (c) => [c?.container_num, c?.containerNum, c?.containerNumber, c?.containerNo, c?.number].some((n) => normContainer(n) === wanted)
    );
    if (match) return match;
  }
  return list[0];
}

export function extractFromJson(
  data: unknown,
  wantContainer?: string
): {
  events: TrackingEvent[];
  eta: string | null;
  latestStatus: string | null;
  /** True when the structured Maersk "synergy" schema was recognised. */
  synergy: boolean;
} {
  if (!data || typeof data !== "object") return { events: [], eta: null, latestStatus: null, synergy: false };
  const d = data as Record<string, any>;

  // ── Maersk "synergy" tracking API format ─────────────────────────────────
  const synergyContainers: any[] = d.containers ?? [];
  if (synergyContainers.length > 0) {
    const c = pickContainer(synergyContainers, wantContainer);
    const locations: any[] = c.locations ?? [];

    if (locations.length > 0) {
      const allEvents: TrackingEvent[] = [];
      for (const loc of locations) {
        const locLabel = [loc.terminal, loc.city, loc.country].filter(Boolean).join(", ");
        for (const ev of loc.events ?? []) {
          const d = parseDate(ev.event_time ?? null);
          allEvents.push({
            date: d,
            status: ev.activity ?? null,
            location: locLabel,
            description: ev.vessel_name
              ? `${ev.activity ?? ""} via ${ev.vessel_name} ${ev.voyage_num ?? ""}`.trim()
              : (ev.activity ?? null),
          });
        }
      }

      allEvents.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.getTime() - a.date.getTime();
      });

      let etaRaw: string | null = c.eta_final_delivery ?? c.eta ?? d.eta_final_delivery ?? null;
      if (!etaRaw) {
        // Only look at the LAST location (final destination) for arrival/discharge
        // expected events. Do NOT fall back to earlier transit ports — those
        // expected events are departures, not the destination ETA.
        const lastLoc = locations[locations.length - 1];
        const lastLocEvents: any[] = lastLoc?.events ?? [];

        // Priority 1: expected Arrived / Discharged event at the last location
        const arrivalEv = lastLocEvents.find(
          (ev: any) =>
            ev.event_time_type === "EXPECTED" &&
            ev.event_time &&
            /arrived|discharged|discharge|arrival|delivered|delivery/i.test(ev.activity ?? "")
        );
        if (arrivalEv?.event_time) {
          etaRaw = arrivalEv.event_time;
        } else {
          // Priority 2: latest (by event_time) expected event at the last location
          const expectedAtDest = lastLocEvents
            .filter((ev: any) => ev.event_time_type === "EXPECTED" && ev.event_time)
            .sort((a: any, b: any) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
          if (expectedAtDest.length > 0) {
            // Pick the earliest future expected event as the true ETA
            const futureExpected = expectedAtDest
              .slice()
              .reverse()
              .find((ev: any) => new Date(ev.event_time).getTime() > Date.now());
            etaRaw = futureExpected?.event_time ?? expectedAtDest[expectedAtDest.length - 1]?.event_time ?? null;
          }
        }
      }

      const eta = formatEtaDate(etaRaw);

      let latestActualStatus: string | null = null;
      for (let i = locations.length - 1; i >= 0; i--) {
        for (const ev of (locations[i].events ?? []).slice().reverse()) {
          if (ev.event_time_type === "ACTUAL" && ev.activity) {
            latestActualStatus = ev.activity;
            break;
          }
        }
        if (latestActualStatus) break;
      }
      const statusFromField: string | null = c.status ?? null;
      const latestStatus = latestActualStatus ?? statusFromField;

      return { events: allEvents, eta, latestStatus, synergy: true };
    }
  }

  // ── Generic Maersk API format ─────────────────────────────────────────────
  const containers: any[] = d.shipment?.containers ?? d.data?.containers ?? d.trackingData?.containers ?? [];

  let rawEvents: unknown[] = [];
  let etaRaw: unknown = null;

  if (containers.length > 0) {
    const c = pickContainer(containers, wantContainer);
    rawEvents = c.containerEvents ?? c.events ?? c.milestones ?? c.movements ?? [];

    // portCalls: destination is the last entry or the one flagged isDestination.
    // NEVER use portCalls[0] — that is the origin.
    const cPortCalls: any[] = Array.isArray(c.portCalls) ? c.portCalls : [];
    const cDestCall =
      cPortCalls.find((p: any) => p.isDestination === true || p.isDestination === "true") ??
      (cPortCalls.length > 0 ? cPortCalls[cPortCalls.length - 1] : null);

    etaRaw =
      cDestCall?.eta ??
      cDestCall?.estimatedArrival ??
      c.eta ??
      c.estimatedTimeOfArrival ??
      c.estimatedArrival ??
      c.plannedArrivalDate ??
      null;
  }
  if (!rawEvents.length) {
    rawEvents = d.events ?? d.milestones ?? d.containerEvents ?? d.movements ?? d.data?.events ?? [];
  }
  if (!etaRaw) {
    // Top-level portCalls (some API shapes put them here)
    const dPortCalls: any[] = Array.isArray(d.portCalls) ? d.portCalls : [];
    const dDestCall =
      dPortCalls.find((p: any) => p.isDestination === true || p.isDestination === "true") ??
      (dPortCalls.length > 0 ? dPortCalls[dPortCalls.length - 1] : null);

    etaRaw =
      dDestCall?.eta ??
      dDestCall?.estimatedArrival ??
      d.eta ??
      d.estimatedTimeOfArrival ??
      d.estimatedArrival ??
      d.plannedArrivalDate ??
      d.portOfDischarge?.eta ??
      d.portOfDischarge?.estimatedArrival ??
      null;
  }

  const events = parseEvents(Array.isArray(rawEvents) ? rawEvents : []);
  const eta = formatEtaDate(etaRaw);

  return { events, eta, latestStatus: null, synergy: false };
}

const SCRAPER_TIMEOUT_MS = 90_000;
const NAV_TIMEOUT_MS = 30_000;
const API_WAIT_MS = 20_000;

const emptyResult = (containerNumber: string, error: string): CarrierTrackResult => ({
  success: false,
  provider: "maersk_scraper",
  carrier: "MAERSK",
  containerNumber,
  latestStatus: null,
  latestLocation: null,
  latestEventDate: null,
  latestDescription: null,
  eta: null,
  events: [],
  raw: null,
  error,
});

export async function scrapeMaerskDirect(containerNumber: string): Promise<CarrierTrackResult> {
  if (!isMaerskDirectScraperAvailable()) {
    return emptyResult(containerNumber, "Puppeteer not available");
  }

  // ── Acquire global Puppeteer slot (shared with ParcelsApp scraper) ───────
  // Returns a "no_data" result immediately when the queue is full.
  logger.info(`[MaerskDirect] ${containerNumber}: waiting for Puppeteer slot…`);
  let release: (() => void) | null = null;
  try {
    release = await acquirePuppeteerSlot();
  } catch (err: any) {
    if (err?.message === "PUPPETEER_QUEUE_FULL") {
      logger.warn(`[MaerskDirect] ${containerNumber}: Puppeteer queue full — skipping (server busy)`);
      return emptyResult(containerNumber, "PUPPETEER_QUEUE_FULL");
    }
    throw err;
  }
  logger.info(`[MaerskDirect] ${containerNumber}: Puppeteer slot acquired`);

  let page: any = null;
  const hardStop = setTimeout(() => {
    logger.warn(`[MaerskDirect] ${containerNumber}: hard timeout — closing page`);
    try {
      page?.close();
    } catch {
      /* ignore */
    }
  }, SCRAPER_TIMEOUT_MS);

  try {
    // ── Get/reuse shared browser (Option A: shared instance) ─────────────────
    const browser = await getSharedBrowser();
    page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    // ── Intercept ALL JSON responses from maersk.com domains ─────────────────
    // No isTracking filter — we capture everything and let extractFromJson
    // decide if it contains useful data.  Logging every URL + top-level keys
    // lets us diagnose what Maersk's SPA is actually calling.
    const capturedPayloads: Array<{ url: string; data: unknown }> = [];

    page.on("response", async (response: any) => {
      try {
        const url: string = response.url();
        if (!/maersk\.com/i.test(url) || /\.(png|jpg|gif|svg|woff|woff2|ttf|ico|css|js)(\?|$)/i.test(url)) return;

        const status: number = response.status();
        const ct: string = response.headers()?.["content-type"] ?? "";
        if (!ct.includes("json")) return;

        const json = await response.json().catch(() => null);
        if (!json || typeof json !== "object") return;

        const topKeys =
          typeof json === "object" && !Array.isArray(json)
            ? Object.keys(json as object)
                .slice(0, 10)
                .join(",")
            : "[array]";
        const etaScan = deepScanForEta(json);
        logger.info(
          `[MaerskDirect] ${containerNumber} JSON captured: ${url.slice(0, 110)}` +
            ` status=${status} keys=[${topKeys}]` +
            (etaScan ? ` ETA_FOUND: path=${etaScan.path} val=${etaScan.value}` : "")
        );
        capturedPayloads.push({ url, data: json });
      } catch {
        /* ignore */
      }
    });

    // ── Step 1: Warm up session on Maersk homepage ────────────────────────────
    // Visiting the homepage first establishes Akamai/bot-protection cookies so
    // subsequent requests to the tracking page are treated as legitimate.
    logger.info(`[MaerskDirect] ${containerNumber}: warming up session on maersk.com…`);
    try {
      await page.goto("https://www.maersk.com", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
    } catch {
      logger.info(`[MaerskDirect] ${containerNumber}: homepage warmup timed out — continuing`);
    }
    // Give Akamai cookies a moment to settle before hitting the tracking page.
    await new Promise((r) => setTimeout(r, 2_500));

    // ── Step 2: Navigate to Maersk's public tracking page ────────────────────
    // Use domcontentloaded — Maersk's SPA has continuous background polling
    // which means networkidle2 NEVER fires and always times out.
    const trackUrl = `https://www.maersk.com/tracking/${encodeURIComponent(containerNumber)}`;
    logger.info(`[MaerskDirect] ${containerNumber}: navigating to ${trackUrl}`);
    try {
      await page.goto(trackUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } catch {
      logger.info(`[MaerskDirect] ${containerNumber}: domcontentloaded timed out — continuing`);
    }

    // ── Wait for API responses to arrive ─────────────────────────────────────
    logger.info(`[MaerskDirect] ${containerNumber}: waiting up to ${API_WAIT_MS / 1000}s for Maersk API data…`);
    const pollStart = Date.now();
    while (Date.now() - pollStart < API_WAIT_MS) {
      const useful = capturedPayloads.find((p) => {
        const { events, eta } = extractFromJson(p.data);
        return events.length > 0 || !!eta || !!deepScanForEta(p.data);
      });
      if (useful) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const finalUrl: string = page.url();
    logger.info(`[MaerskDirect] ${containerNumber}: final URL: ${finalUrl}`);
    logger.info(`[MaerskDirect] ${containerNumber}: captured ${capturedPayloads.length} JSON response(s) total`);

    // ── Parse captured API responses ──────────────────────────────────────────
    // Maersk's SPA fires several JSON calls per page (schedules, autocomplete,
    // the real tracking payload). Returning on the FIRST payload that has any
    // data risks locking onto a partial response whose ETA is missing or stale,
    // while the authoritative tracking payload arrives a moment later. Instead
    // we score EVERY captured payload and keep the richest/most authoritative
    // one: the structured "synergy" schema wins over ad-hoc shapes, a real ETA
    // beats none, and more events break ties.
    let best: {
      score: number;
      events: TrackingEvent[];
      eta: string | null;
      latestStatus: string | null;
      url: string;
      data: unknown;
      deepPath?: string;
    } | null = null;

    for (const payload of capturedPayloads) {
      const { events, eta: jsonEta, latestStatus: parsedStatus, synergy } = extractFromJson(payload.data, containerNumber);

      // Also try the deep recursive scan in case extractFromJson missed a nested ETA key
      const deepEta = !jsonEta ? deepScanForEta(payload.data) : null;
      const eta = jsonEta ?? deepEta?.value ?? null;

      if (events.length === 0 && !eta) continue;

      const score = (synergy ? 1_000_000 : 0) + (eta ? 10_000 : 0) + events.length;
      if (!best || score > best.score) {
        best = { score, events, eta, latestStatus: parsedStatus, url: payload.url, data: payload.data, deepPath: deepEta?.path };
      }
    }

    if (best) {
      const latest = best.events[0] ?? null;
      const latestActual = best.events.find((e) => e.date && e.date <= new Date()) ?? latest;
      const status = best.latestStatus ?? latestActual?.status ?? latest?.status ?? null;
      logger.info(
        `[MaerskDirect] ${containerNumber}: success from ${best.url.slice(0, 80)} — ` +
          `status=${status ?? "?"} events=${best.events.length} eta=${best.eta ?? "none"} score=${best.score}` +
          (best.deepPath ? ` (deep-scan path=${best.deepPath})` : "")
      );
      return {
        success: true,
        provider: "maersk_scraper",
        carrier: "MAERSK",
        containerNumber,
        latestStatus: status,
        latestLocation: latestActual?.location ?? latest?.location ?? null,
        latestEventDate: latestActual?.date ?? latest?.date ?? null,
        latestDescription: latestActual?.description ?? latest?.description ?? null,
        eta: best.eta,
        events: best.events,
        raw: best.data,
      };
    }

    // ── Fallback A: __NEXT_DATA__ embedded in page ────────────────────────────
    // Maersk uses Next.js; the server-side render may embed tracking data in
    // the <script id="__NEXT_DATA__"> tag even when XHR capture missed it.
    const nextDataRaw: unknown = await page
      .evaluate(() => {
        const el = document.getElementById("__NEXT_DATA__");
        if (!el) return null;
        try {
          return JSON.parse(el.textContent ?? "");
        } catch {
          return null;
        }
      })
      .catch(() => null);

    if (nextDataRaw && typeof nextDataRaw === "object") {
      const { events, eta: ndEta, latestStatus: ndStatus } = extractFromJson(nextDataRaw, containerNumber);
      const deepEta = !ndEta ? deepScanForEta(nextDataRaw) : null;
      const eta = ndEta ?? deepEta?.value ?? null;
      if (events.length > 0 || eta) {
        logger.info(
          `[MaerskDirect] ${containerNumber}: __NEXT_DATA__ hit — ` +
            `events=${events.length} eta=${eta ?? "none"}` +
            (deepEta ? ` (deep-scan path=${deepEta.path})` : "")
        );
        const latest = events[0] ?? null;
        const latestActual = events.find((e) => e.date && e.date <= new Date()) ?? latest;
        return {
          success: true,
          provider: "maersk_scraper",
          carrier: "MAERSK",
          containerNumber,
          latestStatus: ndStatus ?? latestActual?.status ?? latest?.status ?? null,
          latestLocation: latestActual?.location ?? latest?.location ?? null,
          latestEventDate: latestActual?.date ?? latest?.date ?? null,
          latestDescription: latestActual?.description ?? latest?.description ?? null,
          eta,
          events,
          raw: { source: "__NEXT_DATA__" },
        };
      }
      logger.info(`[MaerskDirect] ${containerNumber}: __NEXT_DATA__ present but no useful data`);
    } else {
      logger.info(`[MaerskDirect] ${containerNumber}: no __NEXT_DATA__ found`);
    }

    // ── Fallback B: read rendered DOM text ────────────────────────────────────
    const bodyText: string = await page.evaluate(() => document.body?.innerText?.slice(0, 8000) ?? "").catch(() => "");

    logger.info(`[MaerskDirect] ${containerNumber} DOM[0:400]: ${bodyText.slice(0, 400)}`);

    // Detect bot-challenge / error pages before attempting DOM ETA extraction
    const isBlocked = /access denied|captcha|bot.challenge|403.forbidden|challenge.required|DataDome|Akamai/i.test(
      bodyText.slice(0, 1500)
    );
    const isErrorPage = /something went wrong|unexpected error|we.re working to fix/i.test(bodyText.slice(0, 1500));

    if (isBlocked) {
      logger.info(`[MaerskDirect] ${containerNumber}: bot challenge / blocked page detected`);
      return { ...emptyResult(containerNumber, "bot_challenge"), blocked: true };
    }
    if (isErrorPage) {
      logger.info(
        `[MaerskDirect] ${containerNumber}: Maersk error page detected — no tracking data served (bot detection or backend error)`
      );
      return emptyResult(containerNumber, "maersk_error_page");
    }

    // DOM ETA labels — look for any label that explicitly means estimated arrival
    const etaMatch = bodyText.match(
      /(?:ETA|Estimated\s+(?:time\s+of\s+)?[Aa]rrival|Expected\s+[Aa]rrival|Planned\s+[Aa]rrival|Destination\s+[Aa]rrival)[:\s]+([A-Za-z]{3}\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3}\.?\s+\d{4})/i
    );
    const statusMatch = bodyText.match(
      /(In Transit|Departed|Arrived|Discharged|Loaded|Delivered|Customs|Gate Out|On Board|At Sea|Vessel Arrived)/i
    );

    if (etaMatch || statusMatch) {
      const status = statusMatch?.[1] ?? null;
      const etaStr = etaMatch?.[1] ?? null;
      let eta: string | null = null;
      if (etaStr) {
        eta = formatEtaDate(
          etaStr.replace(
            /\bJan\b|\bFeb\b|\bMar\b|\bApr\b|\bMay\b|\bJun\b|\bJul\b|\bAug\b|\bSep\b|\bOct\b|\bNov\b|\bDec\b/i,
            (m) => m.slice(0, 3)
          )
        );
      }
      logger.info(
        `[MaerskDirect] ${containerNumber}: DOM label fallback — status=${status ?? "none"} eta=${eta ?? "none"}`
      );
      const fakeEvents: TrackingEvent[] = status
        ? [{ date: eta ? new Date(eta) : null, status, location: null, description: null }]
        : [];
      return {
        success: true,
        provider: "maersk_scraper",
        carrier: "MAERSK",
        containerNumber,
        latestStatus: status,
        latestLocation: null,
        latestEventDate: null,
        latestDescription: status,
        eta,
        events: fakeEvents,
        raw: { source: "dom_text", bodyText: bodyText.slice(0, 1000) },
      };
    }

    logger.info(`[MaerskDirect] ${containerNumber}: no tracking data found — 0 JSON captured, no ETA in DOM`);
    return emptyResult(containerNumber, "no_tracking_data_found");
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    logger.error(`[MaerskDirect] ${containerNumber}: unexpected error`, { error: msg });

    // If the browser crashed mid-scrape, clear the shared instance so next
    // call gets a fresh one
    if (/Protocol error|Target closed|Session closed|disconnected/i.test(msg)) {
      _sharedBrowser = null;
    }

    return emptyResult(containerNumber, `unexpected: ${msg}`);
  } finally {
    clearTimeout(hardStop);
    // Close just the tab, not the whole browser
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
    release?.();
    logger.info(`[MaerskDirect] ${containerNumber}: Puppeteer slot released`);
  }
}
