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
 * Never throws — always returns a typed result.
 */

import { existsSync } from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import type { CarrierTrackResult, TrackingEvent } from "./trackingProviders/types";

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
  // Shape: { containers: [{ container_num, eta_final_delivery, status,
  //           locations: [{ city, terminal, events: [{ activity, event_time, event_time_type }] }] }] }
  const synergyContainers: any[] = d.containers ?? [];
  if (synergyContainers.length > 0) {
    const c = synergyContainers[0];
    const locations: any[] = c.locations ?? [];

    if (locations.length > 0) {
      // Flatten all location events into a single sorted list
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

      // Sort: actual events first (newest first), then expected (nearest first)
      allEvents.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.getTime() - a.date.getTime();
      });

      // ETA: prefer explicit eta_final_delivery, else last EXPECTED event time
      let etaRaw: string | null =
        c.eta_final_delivery ??
        c.eta ??
        d.eta_final_delivery ??
        null;
      if (!etaRaw) {
        // Find the last EXPECTED event (furthest in the future)
        const expectedEvents = allEvents
          .filter((e) => e.date)
          .filter((_, i, arr) => {
            // We need access to original event_time_type — re-extract
            return true;
          });
        // Walk locations in reverse to find last expected event
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

      // Latest status: most recent ACTUAL event
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

  // ── Generic Maersk API format (containerEvents, events, milestones) ───────
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
const API_WAIT_MS        = 20_000; // how long to wait for Maersk's API responses

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

  let browser: any = null;
  const hardStop = setTimeout(
    () => { try { browser?.close(); } catch { /* ignore */ } },
    SCRAPER_TIMEOUT_MS,
  );

  try {
    const puppeteerExtra = _require("puppeteer-extra") as any;
    const StealthPlugin  = _require("puppeteer-extra-plugin-stealth") as any;
    puppeteerExtra.use(StealthPlugin());

    const chromePath = getChromiumPath();
    browser = await puppeteerExtra.launch({
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
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    );

    // ── Intercept all JSON responses from maersk.com domains ─────────────────
    // Maersk's React app calls its own API (www.maersk.com/api/tracking/... or
    // api.maersk.com/...) to load tracking data. We capture those responses.
    const capturedPayloads: Array<{ url: string; data: unknown }> = [];

    page.on("response", async (response: any) => {
      try {
        const url: string = response.url();
        // Only intercept maersk-related endpoints
        if (
          !/maersk\.com/i.test(url) ||
          /\.(png|jpg|gif|svg|woff|woff2|ttf|ico|css|js)(\?|$)/i.test(url)
        ) return;

        const ct: string = response.headers()?.["content-type"] ?? "";
        if (!ct.includes("json")) return;

        const json = await response.json().catch(() => null);
        if (!json || typeof json !== "object") return;

        const str = JSON.stringify(json);
        // Only keep responses that look like tracking data
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
        // Most-recent event = first after sort (newest first)
        const latest = events[0] ?? null;
        // Prefer the explicit "last actual event" status over events[0] which
        // may be a future EXPECTED event after sorting newest→oldest
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

    // Check if blocked
    const isBlocked = /access denied|captcha|bot|403|forbidden|challenge/i.test(bodyText.slice(0, 1000));
    if (isBlocked) {
      console.log(`[MaerskDirect] ${containerNumber}: bot challenge detected`);
      return { ...emptyResult(containerNumber, "bot_challenge"), blocked: true };
    }

    // Try to extract status/ETA from rendered text
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
    return emptyResult(containerNumber, `unexpected: ${msg}`);
  } finally {
    clearTimeout(hardStop);
    try { await browser?.close(); } catch { /* ignore */ }
  }
}
