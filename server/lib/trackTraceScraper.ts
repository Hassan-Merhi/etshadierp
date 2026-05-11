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

    // Use networkidle2 so we wait for the AJAX tracking queries to fire and settle
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch {
      // networkidle2 may time out on slow pages — continue with what loaded
      console.log(`[TrackTrace] networkidle2 timed out — reading page as-is`);
    }

    // Additional wait for JS-rendered results (track-trace fires async carrier queries)
    await new Promise((r) => setTimeout(r, 6000));

    // Dump page body text for debugging (stored in raw_response)
    const debugBodyText: string = await page.evaluate(
      () => document.body?.innerText?.slice(0, 3000) ?? "",
    );
    const debugHtml: string = await page.evaluate(
      () => document.documentElement?.innerHTML?.slice(0, 5000) ?? "",
    );
    console.log(`[TrackTrace] ${containerNumber} page text snippet: ${debugBodyText.slice(0, 300)}`);

    // Extract tracking data from the DOM
    const extracted = await page.evaluate((cn: string) => {
      const bodyText = document.body?.innerText ?? "";

      // ── Attempt 1: all <tr> rows that mention the container number or status words ──
      const rows = Array.from(document.querySelectorAll("tr")).filter((tr) => {
        const text = tr.textContent ?? "";
        return text.includes(cn) || /transit|departed|arrived|discharged|loaded|delivered|customs|gate/i.test(text);
      });

      let bestEta: string | null = null;
      let bestStatus: string | null = null;
      let bestLocation: string | null = null;
      const events: Array<{ date: string; status: string; location: string }> = [];

      for (const row of rows.slice(0, 20)) {
        const cells = Array.from(row.querySelectorAll("td, th")).map((td) =>
          td.textContent?.trim() ?? "",
        );
        if (cells.length < 2) continue;

        for (const cell of cells) {
          // Date patterns: 20-Jun-2025, Jun 20 2025, 2025-06-20, 20/06/2025
          if (!bestEta && (
            /\d{1,2}[-\/\s][A-Za-z]{3}[-\/\s]\d{4}/.test(cell) ||
            /\d{4}-\d{2}-\d{2}/.test(cell) ||
            /[A-Za-z]{3}\s+\d{1,2}[,\s]+\d{4}/.test(cell) ||
            /\d{2}\/\d{2}\/\d{4}/.test(cell)
          )) {
            bestEta = cell;
          }
          if (!bestStatus && /transit|departed|arrived|discharged|loaded|delivered|customs|gate out|on board/i.test(cell)) {
            bestStatus = cell;
          }
        }

        // Last meaningful non-container-number cell as location heuristic
        const meaningful = cells.filter((c) => c.length > 2 && c !== cn && !/^\d+$/.test(c));
        if (meaningful.length > 0 && !bestLocation) {
          bestLocation = meaningful[meaningful.length - 1];
        }
      }

      // ── Attempt 2: labelled ETA fields ────────────────────────────────────
      if (!bestEta) {
        // Look for any element whose text is exactly "ETA" and read the sibling/next
        document.querySelectorAll("td, th, span, div, label, b, strong").forEach((el) => {
          if (!bestEta && /^eta[:\s]*$/i.test(el.textContent?.trim() ?? "")) {
            const next = el.nextElementSibling?.textContent?.trim()
              ?? el.parentElement?.nextElementSibling?.textContent?.trim()
              ?? "";
            if (next && next !== "-" && next !== "—") bestEta = next;
          }
        });
      }

      // ── Attempt 3: full-body text scan ────────────────────────────────────
      if (!bestEta) {
        const etaMatch = bodyText.match(
          /ETA[:\s]*([A-Za-z]{3}[\s\-\/]\d{1,2}[\s\-\/,\s]*\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-\/][A-Za-z]{3}[\s\-\/]\d{4}|\d{2}\/\d{2}\/\d{4})/i,
        );
        if (etaMatch) bestEta = etaMatch[1];
      }
      if (!bestStatus) {
        const sm = bodyText.match(/(In Transit|Departed|Arrived|Discharged|Loaded|Delivered|Customs|Gate Out|On Board|At Sea)/i);
        if (sm) bestStatus = sm[1];
      }
      if (!bestLocation) {
        const lm = bodyText.match(/(?:POD|Port of Discharge|Location)[:\s]+([A-Z][A-Za-z\s,]+?)(?:\n|$)/i);
        if (lm) bestLocation = lm[1].trim();
      }

      return { bestEta, bestStatus, bestLocation, events, pageTitle: document.title };
    }, containerNumber);

    console.log(
      `[TrackTrace] ${containerNumber}: status="${extracted.bestStatus ?? "none"}" ` +
      `eta="${extracted.bestEta ?? "none"}" location="${extracted.bestLocation ?? "none"}"`,
    );

    // If we got absolutely nothing, check if we were blocked
    const finalUrl: string = page.url();
    if (!extracted.bestStatus && !extracted.bestEta && !capturedJson) {
      const isBlocked = /captcha|robot|blocked|403|access denied|verify you are human/i.test(debugBodyText);
      if (isBlocked) {
        return { success: false, shipment: null, blocked: true, error: "track-trace: bot detection triggered", rawResponse: { debugBodyText: debugBodyText.slice(0, 1000), finalUrl } };
      }
      return { success: false, shipment: null, blocked: false, error: "track-trace: no tracking data found on page", rawResponse: { debugBodyText: debugBodyText.slice(0, 1000), debugHtml: debugHtml.slice(0, 2000), finalUrl } };
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
      rawResponse: { extracted, capturedJson, finalUrl, debugBodyText: debugBodyText.slice(0, 1000) },
    };

  } catch (err: any) {
    console.error(`[TrackTrace] ${containerNumber}: unexpected error —`, err?.message ?? err);
    return { success: false, shipment: null, blocked: false, error: `track-trace: ${err?.message ?? "unknown error"}` };
  } finally {
    clearTimeout(hardStop);
    try { await browser?.close(); } catch { /* ignore */ }
  }
}
