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
    } catch { /* not found */ }
  }
  try {
    const puppeteer = _require("puppeteer");
    const p: string = typeof puppeteer.executablePath === "function" ? puppeteer.executablePath() : "";
    if (p && existsSync(p)) return p;
  } catch { /* not installed */ }
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
      console.warn("[MaerskDirect] Shared browser disconnected — relaunching");
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
  console.log("[MaerskDirect] Launching shared Chrome instance…");
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
    console.warn("[MaerskDirect] Shared browser disconnected (crash or killed)");
    _sharedBrowser = null;
  });

  console.log("[MaerskDirect] Shared Chrome instance ready");
  return _sharedBrowser;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseEvents(rawEvents: unknown[]): TrackingEvent[] {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents
    .map((e: any): TrackingEvent => ({
      date: parseDate(
        e.eventDateTime ?? e.eventDate ?? e.timestamp ?? e.date ?? null,
      ),
      status:
        e.transportEventTypeCode ??
        e.activityName ??
        e.eventCode ??
        e.activity ??
        e.status ??
        null,
      location:
        e.location?.portName ??
        e.location?.locationName ??
        e.location?.city ??
        e.portName ??
        e.locationName ??
        (typeof e.location === "string" ? e.location : null),
      description:
        e.description ?? e.eventDescription ?? e.activityName ?? null,
    }))
    .filter((e) => e.date !== null || e.status !== null)
    .sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.getTime() - a.date.getTime();
    });
}

function extractFromJson(data: unknown): {
  events: TrackingEvent[];
  eta: string | null;
  latestStatus: string | null;
} {
  if (!data || typeof data !== "object") return { events: [], eta: null, latestStatus: null };
  const d = data as Record<string, any>;

  // ── Maersk "synergy" tracking API format ─────────────────────────────────
  const synergyContainers: any[] = d.containers ?? [];
  if (synergyContainers.length > 0) {
    const c = synergyContainers[0];
    const locations: any[] = c.locations ?? [];

    if (locations.length > 0) {
      const allEvents: TrackingEvent[] = [];
      for (const loc of locations) {
        const locLabel = [loc.terminal, loc.city, loc.country]
          .filter(Boolean).join(", ");
        for (const ev of (loc.events ?? [])) {
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

      let etaRaw: string | null =
        c.eta_final_delivery ??
        c.eta ??
        d.eta_final_delivery ??
        null;
      if (!etaRaw) {
        for (let i = locations.length - 1; i >= 0; i--) {
          for (const ev of (locations[i].events ?? []).slice().reverse()) {
            if (ev.event_time_type === "EXPECTED" && ev.event_time) {
              etaRaw = ev.event_time;
              break;
            }
          }
          if (etaRaw) break;
        }
      }

      const etaDate = parseDate(etaRaw);
      const eta = etaDate ? etaDate.toISOString().slice(0, 10) : null;

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

      return { events: allEvents, eta, latestStatus };
    }
  }

  // ── Generic Maersk API format ─────────────────────────────────────────────
  const containers: any[] =
    d.shipment?.containers ??
    d.data?.containers ??
    d.trackingData?.containers ??
    [];

  let rawEvents: unknown[] = [];
  let etaRaw: unknown = null;

  if (containers.length > 0) {
    const c = containers[0];
    rawEvents = c.containerEvents ?? c.events ?? c.milestones ?? c.movements ?? [];
    etaRaw = c.eta ?? c.estimatedTimeOfArrival ?? c.estimatedArrival ?? c.plannedArrivalDate ?? null;
  }
  if (!rawEvents.length) {
    rawEvents = d.events ?? d.milestones ?? d.containerEvents ?? d.movements ?? d.data?.events ?? [];
  }
  if (!etaRaw) {
    etaRaw = d.eta ?? d.estimatedTimeOfArrival ?? d.estimatedArrival ?? d.plannedArrivalDate ?? null;
  }

  const events = parseEvents(Array.isArray(rawEvents) ? rawEvents : []);
  const etaDate = parseDate(String(etaRaw ?? ""));
  const eta = etaDate ? etaDate.toISOString().slice(0, 10) : null;

  return { events, eta, latestStatus: null };
}

const SCRAPER_TIMEOUT_MS = 90_000;
const NAV_TIMEOUT_MS     = 30_000;
const API_WAIT_MS        = 20_000;

const emptyResult = (containerNumber: string, error: string): CarrierTrackResult => ({
  success: false,
  provider: "maersk_direct",
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
  console.log(`[MaerskDirect] ${containerNumber}: waiting for Puppeteer slot…`);
  const release = await acquirePuppeteerSlot();
  console.log(`[MaerskDirect] ${containerNumber}: Puppeteer slot acquired`);

  let page: any = null;
  const hardStop = setTimeout(() => {
    console.warn(`[MaerskDirect] ${containerNumber}: hard timeout — closing page`);
    try { page?.close(); } catch { /* ignore */ }
  }, SCRAPER_TIMEOUT_MS);

  try {
    // ── Get/reuse shared browser (Option A: shared instance) ─────────────────
    const browser = await getSharedBrowser();
    page = await browser.newPage();

    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    );

    // ── Intercept all JSON responses from maersk.com domains ─────────────────
    const capturedPayloads: Array<{ url: string; data: unknown }> = [];

    page.on("response", async (response: any) => {
      try {
        const url: string = response.url();
        if (
          !/maersk\.com/i.test(url) ||
          /\.(png|jpg|gif|svg|woff|woff2|ttf|ico|css|js)(\?|$)/i.test(url)
        ) return;

        const ct: string = response.headers()?.["content-type"] ?? "";
        if (!ct.includes("json")) return;

        const json = await response.json().catch(() => null);
        if (!json || typeof json !== "object") return;

        const str = JSON.stringify(json);
        const isTracking = /event|milestone|container|movement|transit|arrival|vessel/i.test(str);
        if (isTracking) {
          console.log(`[MaerskDirect] Captured API response from: ${url.slice(0, 100)}`);
          capturedPayloads.push({ url, data: json });
        }
      } catch { /* ignore */ }
    });

    // ── Navigate to Maersk's public tracking page ─────────────────────────────
    const trackUrl = `https://www.maersk.com/tracking/${encodeURIComponent(containerNumber)}`;
    console.log(`[MaerskDirect] Navigating to ${trackUrl}`);
    try {
      await page.goto(trackUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch {
      console.log(`[MaerskDirect] networkidle2 timed out — continuing`);
    }

    // ── Wait for API responses to arrive ─────────────────────────────────────
    console.log(`[MaerskDirect] Waiting up to ${API_WAIT_MS / 1000}s for Maersk API data…`);
    const pollStart = Date.now();
    while (Date.now() - pollStart < API_WAIT_MS) {
      const useful = capturedPayloads.find((p) => {
        const { events } = extractFromJson(p.data);
        return events.length > 0;
      });
      if (useful) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const finalUrl: string = page.url();
    console.log(`[MaerskDirect] Final URL: ${finalUrl}`);
    console.log(`[MaerskDirect] Captured ${capturedPayloads.length} API response(s)`);

    // ── Parse captured API responses ──────────────────────────────────────────
    for (const payload of capturedPayloads) {
      const { events, eta, latestStatus: parsedStatus } = extractFromJson(payload.data);
      if (events.length > 0 || eta) {
        const latest = events[0] ?? null;
        const latestActual = events.find((e) => e.date && e.date <= new Date()) ?? latest;
        const status = parsedStatus ?? latestActual?.status ?? latest?.status ?? null;
        console.log(
          `[MaerskDirect] ${containerNumber}: success from ${payload.url.slice(0, 80)} — ` +
          `status=${status ?? "?"} events=${events.length} eta=${eta ?? "none"}`,
        );
        return {
          success: true,
          provider: "maersk_direct",
          carrier: "MAERSK",
          containerNumber,
          latestStatus: status,
          latestLocation: latestActual?.location ?? latest?.location ?? null,
          latestEventDate: latestActual?.date ?? latest?.date ?? null,
          latestDescription: latestActual?.description ?? latest?.description ?? null,
          eta,
          events,
          raw: payload.data,
        };
      }
    }

    // ── Fallback: read rendered DOM text ──────────────────────────────────────
    const bodyText: string = await page.evaluate(
      () => document.body?.innerText?.slice(0, 6000) ?? "",
    ).catch(() => "");

    console.log(`[MaerskDirect] ${containerNumber} DOM[0:300]: ${bodyText.slice(0, 300)}`);

    const isBlocked = /access denied|captcha|bot|403|forbidden|challenge/i.test(bodyText.slice(0, 1000));
    if (isBlocked) {
      console.log(`[MaerskDirect] ${containerNumber}: bot challenge detected`);
      return { ...emptyResult(containerNumber, "bot_challenge"), blocked: true };
    }

    const etaMatch = bodyText.match(
      /(?:ETA|Estimated\s+Arrival|Expected\s+Arrival)[:\s]+([A-Za-z]{3}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/i,
    );
    const statusMatch = bodyText.match(
      /(In Transit|Departed|Arrived|Discharged|Loaded|Delivered|Customs|Gate Out|On Board|At Sea|Vessel Arrived)/i,
    );

    if (etaMatch || statusMatch) {
      const status = statusMatch?.[1] ?? null;
      const etaStr = etaMatch?.[1] ?? null;
      let eta: string | null = null;
      if (etaStr) {
        const d = new Date(etaStr);
        if (!isNaN(d.getTime())) eta = d.toISOString().slice(0, 10);
      }
      console.log(
        `[MaerskDirect] ${containerNumber}: DOM fallback — status=${status ?? "none"} eta=${eta ?? "none"}`,
      );
      const fakeEvents: TrackingEvent[] = status
        ? [{ date: eta ? new Date(eta) : null, status, location: null, description: null }]
        : [];
      return {
        success: true,
        provider: "maersk_direct",
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

    console.log(`[MaerskDirect] ${containerNumber}: no tracking data found`);
    return emptyResult(containerNumber, "no_tracking_data_found");

  } catch (err: any) {
    const msg = err?.message ?? String(err) ?? "unknown error";
    console.error(`[MaerskDirect] ${containerNumber}: unexpected error —`, msg);

    // If the browser crashed mid-scrape, clear the shared instance so next
    // call gets a fresh one
    if (/Protocol error|Target closed|Session closed|disconnected/i.test(msg)) {
      _sharedBrowser = null;
    }

    return emptyResult(containerNumber, `unexpected: ${msg}`);
  } finally {
    clearTimeout(hardStop);
    // Close just the tab, not the whole browser
    try { await page?.close(); } catch { /* ignore */ }
    release();
    console.log(`[MaerskDirect] ${containerNumber}: Puppeteer slot released`);
  }
}
