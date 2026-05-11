/**
 * trackTraceScraper.ts — track-trace.com Puppeteer scraper.
 *
 * Strategy:
 *   1. Open https://www.track-trace.com/container (no hash — let the page load fully).
 *   2. Find the container-number input, type the number, press Enter / click Track.
 *   3. Wait up to 25 s for a results table or event list to appear.
 *   4. Extract ETA, status, location from the DOM + intercept any JSON responses.
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

const SCRAPER_TIMEOUT_MS = 90_000;
const NAV_TIMEOUT_MS     = 30_000;

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
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const ddMonYYYY = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{4})/);
  if (ddMonYYYY) {
    const months: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = months[ddMonYYYY[2].toLowerCase()];
    if (m) return `${ddMonYYYY[3]}-${m}-${ddMonYYYY[1].padStart(2,"0")}`;
  }
  const monDDYYYY = s.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (monDDYYYY) {
    const months: Record<string, string> = {
      jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
      jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12",
    };
    const m = months[monDDYYYY[1].toLowerCase()];
    if (m) return `${monDDYYYY[3]}-${m}-${monDDYYYY[2].padStart(2,"0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Candidate CSS selectors for the container-number input field. */
const INPUT_SELECTORS = [
  "input#ctnr",
  "input[name='ctnr']",
  "input[name='container']",
  "input[name='containernumber']",
  "input[id*='container' i]",
  "input[placeholder*='container' i]",
  "input[placeholder*='number' i]",
  "input[type='text']",
  "input[type='search']",
];

/** Candidate CSS selectors that indicate results have loaded. */
const RESULT_SELECTORS = [
  "table.result",
  "table.tracking",
  ".tracking-result",
  ".result-table",
  "table tbody tr td",
  "#result",
  "#tracking-result",
  ".container-result",
  ".shipment-events",
  // generic: any table with more than one row
  "table",
];

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

    // ── Step 1: load the base container page (no hash) ───────────────────────
    const baseUrl = "https://www.track-trace.com/container";
    console.log(`[TrackTrace] Navigating to ${baseUrl}`);
    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } catch (e) {
      console.log(`[TrackTrace] domcontentloaded timed out — continuing`);
    }

    // Let any JS init code run
    await new Promise((r) => setTimeout(r, 2000));

    // ── Step 2: find the input and type the container number ─────────────────
    let inputFound = false;
    for (const sel of INPUT_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (!el) continue;
        // Make sure it's visible
        const box = await el.boundingBox().catch(() => null);
        if (!box) continue;
        await el.click({ clickCount: 3 });
        await new Promise((r) => setTimeout(r, 200));
        await el.type(containerNumber, { delay: 60 });
        console.log(`[TrackTrace] Typed "${containerNumber}" into ${sel}`);
        inputFound = true;
        break;
      } catch { /* try next */ }
    }

    if (!inputFound) {
      console.log(`[TrackTrace] No input field found — falling back to hash URL`);
      try {
        await page.goto(`${baseUrl}#${encodeURIComponent(containerNumber)}`, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
      } catch { /* ignore timeout */ }
    } else {
      // ── Step 3: submit (Enter, then look for a submit button as fallback) ──
      await page.keyboard.press("Enter");
      console.log(`[TrackTrace] Pressed Enter to submit`);

      // If Enter didn't submit, try clicking a Track/Search button
      await new Promise((r) => setTimeout(r, 1500));
      const btnSelectors = [
        "button[type='submit']",
        "input[type='submit']",
        "button:contains('Track')",
        "a:contains('Track')",
        "#track-btn",
        ".track-btn",
        "button",
      ];
      for (const bSel of btnSelectors) {
        try {
          const btn = await page.$(bSel);
          if (!btn) continue;
          const box = await btn.boundingBox().catch(() => null);
          if (!box) continue;
          const txt: string = await page.evaluate((el: Element) => el.textContent ?? "", btn);
          if (/track|search|go|submit/i.test(txt) || bSel.includes("submit")) {
            await btn.click();
            console.log(`[TrackTrace] Clicked submit button: ${bSel} "${txt.trim()}"`);
            break;
          }
        } catch { /* try next */ }
      }
    }

    // ── Step 4: wait for results to appear ───────────────────────────────────
    console.log(`[TrackTrace] Waiting for results…`);
    let resultsFound = false;
    const waitStart = Date.now();
    const maxWaitMs = 25_000;

    while (Date.now() - waitStart < maxWaitMs) {
      for (const rSel of RESULT_SELECTORS) {
        try {
          const el = await page.$(rSel);
          if (!el) continue;
          const txt: string = await page.evaluate(
            (e: Element) => e.textContent ?? "", el,
          );
          // A real result will mention the container number or common status words
          if (
            txt.includes(containerNumber) ||
            /transit|departed|arrived|discharged|loaded|delivered|customs|gate|discharge|vessel|port/i.test(txt)
          ) {
            console.log(`[TrackTrace] Results detected via "${rSel}"`);
            resultsFound = true;
            break;
          }
        } catch { /* ignore */ }
      }
      if (resultsFound) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!resultsFound) {
      console.log(`[TrackTrace] No results detected after ${maxWaitMs / 1000}s — reading page anyway`);
      // Extra settle time
      await new Promise((r) => setTimeout(r, 3000));
    }

    // ── Step 5: dump page content for extraction + debugging ─────────────────
    const debugBodyText: string = await page.evaluate(
      () => document.body?.innerText?.slice(0, 4000) ?? "",
    ).catch(() => "");
    const debugHtml: string = await page.evaluate(
      () => document.documentElement?.innerHTML?.slice(0, 6000) ?? "",
    ).catch(() => "");
    console.log(`[TrackTrace] ${containerNumber} body snippet: ${debugBodyText.slice(0, 400)}`);

    // ── Step 6: extract tracking data from DOM ────────────────────────────────
    const extracted = await page.evaluate((cn: string) => {
      const bodyText = document.body?.innerText ?? "";

      const rows = Array.from(document.querySelectorAll("tr")).filter((tr) => {
        const text = tr.textContent ?? "";
        return (
          text.includes(cn) ||
          /transit|departed|arrived|discharged|loaded|delivered|customs|gate|on board|at sea|vessel|port/i.test(text)
        );
      });

      let bestEta: string | null = null;
      let bestStatus: string | null = null;
      let bestLocation: string | null = null;
      const events: Array<{ date: string; status: string; location: string }> = [];

      for (const row of rows.slice(0, 30)) {
        const cells = Array.from(row.querySelectorAll("td, th")).map((td) =>
          td.textContent?.trim() ?? "",
        );
        if (cells.length < 2) continue;

        for (const cell of cells) {
          if (!bestEta && (
            /\d{1,2}[-\/\s][A-Za-z]{3}[-\/\s]\d{4}/.test(cell) ||
            /\d{4}-\d{2}-\d{2}/.test(cell) ||
            /[A-Za-z]{3}\s+\d{1,2}[,\s]+\d{4}/.test(cell) ||
            /\d{2}\/\d{2}\/\d{4}/.test(cell)
          )) {
            bestEta = cell;
          }
          if (!bestStatus && /transit|departed|arrived|discharged|loaded|delivered|customs|gate out|on board|at sea/i.test(cell)) {
            bestStatus = cell;
          }
        }
        const meaningful = cells.filter((c) => c.length > 2 && c !== cn && !/^\d+$/.test(c));
        if (meaningful.length > 0 && !bestLocation) {
          bestLocation = meaningful[meaningful.length - 1];
        }
      }

      // Labelled ETA fields
      if (!bestEta) {
        document.querySelectorAll("td, th, span, div, label, b, strong").forEach((el) => {
          if (!bestEta && /^eta[:\s]*$/i.test(el.textContent?.trim() ?? "")) {
            const next = el.nextElementSibling?.textContent?.trim()
              ?? el.parentElement?.nextElementSibling?.textContent?.trim()
              ?? "";
            if (next && next !== "-" && next !== "—") bestEta = next;
          }
        });
      }

      // Full-body text scan
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

    const finalUrl: string = page.url();

    if (!extracted.bestStatus && !extracted.bestEta && !capturedJson) {
      const isBlocked = /captcha|robot|blocked|403|access denied|verify you are human/i.test(debugBodyText);
      if (isBlocked) {
        return {
          success: false, shipment: null, blocked: true,
          error: "track-trace: bot detection triggered",
          rawResponse: { debugBodyText: debugBodyText.slice(0, 1500), finalUrl },
        };
      }
      return {
        success: false, shipment: null, blocked: false,
        error: "track-trace: no tracking data found on page",
        rawResponse: {
          debugBodyText: debugBodyText.slice(0, 1500),
          debugHtml: debugHtml.slice(0, 3000),
          finalUrl,
          inputFound,
          resultsFound,
        },
      };
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
