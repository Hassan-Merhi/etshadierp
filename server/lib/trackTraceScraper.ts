/**
 * trackTraceScraper.ts — track-trace.com Puppeteer scraper.
 *
 * track-trace.com is one of the oldest container-tracking aggregators
 * (est. ~2000). It queries multiple carrier sources and shows the results
 * on its own page — importantly without Cloudflare/Akamai bot protection.
 *
 * Strategy:
 *   1. Open https://www.track-trace.com/container with the container number
 *      in the URL hash / query.
 *   2. Wait for the results table to appear (up to 30 s).
 *   3. Read ETA, status, and location straight from the DOM.
 *   4. Intercept any XHR responses that carry JSON tracking data as a bonus.
 *
 * Never throws — always returns a typed result.
 */

import { existsSync } from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import type { ParcelsAppShipment } from "./parcelsAppClient";

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

export interface TrackTraceResult {
  success: boolean;
  shipment: ParcelsAppShipment | null;
  blocked: boolean;
  rawResponse?: unknown;
  error?: string;
}

const SCRAPER_TIMEOUT_MS = 75_000;
const NAV_TIMEOUT_MS     = 30_000;
const RESULT_WAIT_MS     = 30_000;

export function isTrackTraceScraper(): boolean {
  try {
    _require.resolve("puppeteer-extra");
    _require.resolve("puppeteer-extra-plugin-stealth");
    _require.resolve("puppeteer");
    return !!getChromiumPath();
  } catch {
    return false;
  }
}

/** Parse a date string into YYYY-MM-DD. Returns null if unparseable. */
function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "-" || s === "—" || s.toLowerCase() === "n/a") return null;
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD-Mon-YYYY  e.g. 20-Jun-2025
  const ddMonYYYY = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{4})/);
  if (ddMonYYYY) {
    const months: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = months[ddMonYYYY[2].toLowerCase()];
    if (m) return `${ddMonYYYY[3]}-${m}-${ddMonYYYY[1].padStart(2,"0")}`;
  }
  // Mon DD YYYY  e.g. Jun 20 2025
  const monDDYYYY = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (monDDYYYY) {
    const months: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = months[monDDYYYY[1].toLowerCase()];
    if (m) return `${monDDYYYY[3]}-${m}-${monDDYYYY[2].padStart(2,"0")}`;
  }
  // Try native Date parse as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export async function scrapeTrackTrace(containerNumber: string): Promise<TrackTraceResult> {
  if (!isTrackTraceScraper()) {
    return { success: false, shipment: null, blocked: false, error: "Puppeteer not available" };
  }

  let browser: any = null;
  const hardStop = setTimeout(() => { try { browser?.close(); } catch { /* ignore */ } }, SCRAPER_TIMEOUT_MS);

  try {
    const puppeteerExtra = _require("puppeteer-extra") as any;
    const StealthPlugin  = _require("puppeteer-extra-plugin-stealth") as any;
    puppeteerExtra.use(StealthPlugin());

    const chromePath = getChromiumPath();
    browser = await puppeteerExtra.launch({
      headless: "new" as any,
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
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
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    );

    // Capture any JSON responses that might carry tracking data
    let capturedJson: unknown = null;
    page.on("response", async (response: any) => {
      try {
        const url: string = response.url();
        if (!url.includes("track-trace.com")) return;
        const ct: string = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const json = await response.json().catch(() => null);
        if (json && typeof json === "object" && !capturedJson) capturedJson = json;
      } catch { /* ignore */ }
    });

    // track-trace uses hash-based routing: /container#CONTAINERNUMBER
    const url = `https://www.track-trace.com/container#${encodeURIComponent(containerNumber)}`;
    console.log(`[TrackTrace] Loading ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // Wait for results — track-trace renders a table with class "tracing" or
    // individual carrier result rows. We wait for any content row to appear.
    const resultSelector = [
      "table.tracing",
      ".tracking-result",
      ".container-result",
      "#tracing-result",
      ".ttr-result",
      "div[id^='result']",
      "div.result-row",
      "td.carrier-name",
    ].join(", ");

    try {
      await page.waitForSelector(resultSelector, { timeout: RESULT_WAIT_MS });
    } catch {
      // Selector not found — still try to read whatever the page rendered
      console.log(`[TrackTrace] No result selector matched — reading page anyway`);
    }

    // Give JS a moment to populate the result data
    await new Promise((r) => setTimeout(r, 3000));

    // Extract tracking data from the DOM
    const extracted = await page.evaluate((cn: string) => {
      // Helper: get trimmed text of first element matching selector
      function getText(root: Element | Document, sel: string): string {
        const el = root.querySelector(sel);
        return el?.textContent?.trim() ?? "";
      }

      // ── Attempt 1: standard track-trace results table ─────────────────────
      // track-trace shows one row per carrier with columns:
      //   Carrier | Container | BL | Status | Vessel | POL | ETA | POD | ...
      const rows = Array.from(document.querySelectorAll("tr")).filter((tr) => {
        const text = tr.textContent ?? "";
        return text.includes(cn) || text.match(/transit|departed|arrived|discharged|loaded/i);
      });

      let bestEta: string | null = null;
      let bestStatus: string | null = null;
      let bestLocation: string | null = null;
      const events: Array<{ date: string; status: string; location: string }> = [];

      for (const row of rows.slice(0, 10)) {
        const cells = Array.from(row.querySelectorAll("td, th")).map((td) =>
          td.textContent?.trim() ?? "",
        );
        if (cells.length < 3) continue;

        // Look for date-like cells (ETA / POD date)
        for (const cell of cells) {
          if (/\d{1,2}[-\/\s][A-Za-z]{3}[-\/\s]\d{4}/.test(cell) ||
              /\d{4}-\d{2}-\d{2}/.test(cell) ||
              /[A-Za-z]{3}\s+\d{1,2}\s+\d{4}/.test(cell)) {
            if (!bestEta) bestEta = cell;
          }
          if (/transit|departed|arrived|discharged|loaded|customs|port/i.test(cell) && !bestStatus) {
            bestStatus = cell;
          }
        }

        // Heuristic: last meaningful cell may be a port/location
        const meaningfulCells = cells.filter((c) => c.length > 1 && c !== cn);
        if (meaningfulCells.length > 0 && !bestLocation) {
          bestLocation = meaningfulCells[meaningfulCells.length - 1];
        }
      }

      // ── Attempt 2: look for labelled fields ───────────────────────────────
      if (!bestEta) {
        const etaLabels = Array.from(document.querySelectorAll("*")).filter((el) =>
          /^eta$/i.test(el.textContent?.trim() ?? ""),
        );
        for (const label of etaLabels.slice(0, 3)) {
          const sibling =
            label.nextElementSibling?.textContent?.trim() ??
            (label.parentElement?.nextElementSibling?.textContent?.trim());
          if (sibling && sibling !== "-") { bestEta = sibling; break; }
        }
      }

      // ── Attempt 3: scan all text for date patterns near "ETA" ─────────────
      if (!bestEta) {
        const bodyText = document.body?.innerText ?? "";
        const etaMatch = bodyText.match(/ETA[:\s]+([A-Za-z]{3}[\s\-\/]\d{1,2}[\s\-\/]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-\/][A-Za-z]{3}[\s\-\/]\d{4})/i);
        if (etaMatch) bestEta = etaMatch[1];
      }

      if (!bestStatus) {
        const bodyText = document.body?.innerText ?? "";
        const statusMatch = bodyText.match(/(In Transit|Departed|Arrived|Discharged|Loaded|Customs|Gate Out|On Board)/i);
        if (statusMatch) bestStatus = statusMatch[1];
      }

      return { bestEta, bestStatus, bestLocation, events, pageTitle: document.title };
    }, containerNumber);

    console.log(
      `[TrackTrace] ${containerNumber}: status="${extracted.bestStatus ?? "none"}" ` +
      `eta="${extracted.bestEta ?? "none"}" location="${extracted.bestLocation ?? "none"}"`,
    );

    // If we got absolutely nothing, check if we were redirected to an error page
    const finalUrl: string = page.url();
    if (!extracted.bestStatus && !extracted.bestEta && !capturedJson) {
      const pageText: string = await page.evaluate(() => document.body?.innerText?.slice(0, 500) ?? "");
      const isBlocked = /captcha|robot|blocked|403|access denied/i.test(pageText);
      if (isBlocked) {
        return { success: false, shipment: null, blocked: true, error: "track-trace: bot detection triggered" };
      }
      return { success: false, shipment: null, blocked: false, error: "track-trace: no tracking data found on page" };
    }

    const eta = parseDate(extracted.bestEta);
    const status = extracted.bestStatus ?? null;
    const location = extracted.bestLocation ?? null;

    const shipment: ParcelsAppShipment = {
      trackingId: containerNumber,
      done: true,
      attributes: {
        ...(status ? { status } : {}),
        ...(location ? { location } : {}),
        ...(eta ? { estimatedArrival: eta } : {}),
      },
      states: extracted.events.length > 0
        ? extracted.events
        : (status ? [{ date: new Date().toISOString().slice(0, 10), status, location: location ?? "" }] : []),
    };

    return {
      success: true,
      shipment,
      blocked: false,
      rawResponse: { extracted, capturedJson, finalUrl },
    };

  } catch (err: any) {
    console.error(`[TrackTrace] ${containerNumber}: unexpected error —`, err?.message ?? err);
    return { success: false, shipment: null, blocked: false, error: `track-trace: ${err?.message ?? "unknown error"}` };
  } finally {
    clearTimeout(hardStop);
    try { await browser?.close(); } catch { /* ignore */ }
  }
}
