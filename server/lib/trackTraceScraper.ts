/**
 * trackTraceScraper.ts — track-trace.com Puppeteer scraper.
 *
 * Strategy (zero DOM interaction — guaranteed no "detached frame" errors):
 *   1. Navigate to https://www.track-trace.com/container#<number> using
 *      networkidle2 — the site reads the hash and auto-submits the search.
 *   2. Wait 10 s for AJAX / iframe rendering to complete.
 *   3. Read ALL data via page.evaluate() — returns plain JS values, holds
 *      zero ElementHandle/frame references that can go stale.
 *   4. Parse results from body text and captured JSON responses.
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

    // ── Step 1: navigate with hash URL (auto-triggers the search) ─────────────
    // track-trace.com reads window.location.hash on load and runs the search.
    // networkidle2 waits until the AJAX tracking call completes (≤2 open reqs).
    const hashUrl = `https://www.track-trace.com/container#${encodeURIComponent(containerNumber)}`;
    console.log(`[TrackTrace] Navigating to ${hashUrl}`);
    try {
      await page.goto(hashUrl, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch {
      console.log(`[TrackTrace] networkidle2 timed out — continuing with what loaded`);
    }

    // ── Step 2: wait for hash-based pre-fill, then submit via evaluate() ────────
    // track-trace.com reads the hash and pre-fills the input but does NOT
    // auto-submit. We wait 4 s for the JS to settle, then click submit entirely
    // inside page.evaluate() — returns a plain boolean, holds zero frame refs.
    console.log(`[TrackTrace] Waiting 4 s for hash pre-fill…`);
    await new Promise((r) => setTimeout(r, 4_000));

    const submitResult: string = await page.evaluate((cn: string): string => {
      // Find the text input (track-trace uses a plain <input type=text>)
      const inputSels = [
        'input[name="query"]', 'input[name="number"]', 'input[name="container"]',
        'input[name="q"]', 'input[name="trackingNumber"]',
        '#number', '#query', '#container',
        'input[type="text"]',
      ];
      let input: HTMLInputElement | null = null;
      for (const sel of inputSels) {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (el) { input = el; break; }
      }
      if (!input) return "no_input_found";

      // Ensure the number is in the field
      if (!input.value) {
        input.value = cn;
        input.dispatchEvent(new Event("input",  { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // track-trace.com shows "Track direct" link after hash pre-fill.
      // Find it by text content first, then fall back to generic selectors.
      const allLinks = Array.from(document.querySelectorAll("a, button, input[type=submit], input[type=button]")) as HTMLElement[];

      // Priority 1: any element whose visible text matches "Track direct" or "Track"
      const directBtn = allLinks.find((el) => {
        const t = (el.textContent ?? "").trim().toLowerCase();
        return t === "track direct" || t === "track" || t === "go" || t === "search";
      });
      if (directBtn) { directBtn.click(); return `clicked_text:${directBtn.textContent?.trim()}`; }

      // Priority 2: submit inputs and buttons
      const submitSels = [
        'input[type="submit"]', 'button[type="submit"]',
        'button.btn', 'a.btn',
      ];
      for (const sel of submitSels) {
        const btn = document.querySelector(sel) as HTMLElement | null;
        if (btn) { btn.click(); return `clicked:${sel}`; }
      }

      // Last resort: submit the form directly
      const form = input.closest("form");
      if (form) { form.submit(); return "form_submitted"; }

      return "no_submit_found";
    }, containerNumber).catch(() => "evaluate_error");

    console.log(`[TrackTrace] Submit result: ${submitResult}`);

    // Wait for the tracking results to load after submission
    console.log(`[TrackTrace] Waiting 10 s for results to load…`);
    await new Promise((r) => setTimeout(r, 10_000));

    // ── Step 3: read everything via page.evaluate() ────────────────────────────
    // evaluate() runs JS inside the page context and returns plain JS values.
    // It does NOT hold a frame reference — safe across any internal navigation.
    const finalUrl: string = page.url();

    const debugBodyText: string = await page.evaluate(
      () => document.body?.innerText?.slice(0, 4000) ?? "",
    ).catch(() => "");

    const debugHtml: string = await page.evaluate(
      () => document.documentElement?.innerHTML?.slice(0, 8000) ?? "",
    ).catch(() => "");

    console.log(`[TrackTrace] url=${finalUrl}`);
    console.log(`[TrackTrace] ${containerNumber} body[0:400]: ${debugBodyText.slice(0, 400)}`);

    // ── Step 4: extract tracking data from the rendered page ──────────────────
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
    }, containerNumber).catch(() => ({
      bestEta: null, bestStatus: null, bestLocation: null, events: [], pageTitle: "",
    }));

    console.log(
      `[TrackTrace] ${containerNumber}: status="${extracted.bestStatus ?? "none"}" ` +
      `eta="${extracted.bestEta ?? "none"}" location="${extracted.bestLocation ?? "none"}"`,
    );

    if (!extracted.bestStatus && !extracted.bestEta && !capturedJson) {
      const isBlocked = /captcha|robot|blocked|403|access denied|verify you are human|datadome/i.test(debugBodyText);
      return {
        success: false,
        shipment: null,
        blocked: isBlocked,
        error: isBlocked
          ? "track-trace: bot detection triggered"
          : "track-trace: no tracking data found on page",
        rawResponse: {
          debugBodyText: debugBodyText.slice(0, 2000),
          debugHtml: debugHtml.slice(0, 3000),
          finalUrl,
          inputFound: true,
          resultsFound: false,
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
    const msg = err?.message ?? String(err) ?? "unknown error";
    console.error(`[TrackTrace] ${containerNumber}: unexpected error —`, msg);
    return {
      success: false,
      shipment: null,
      blocked: false,
      error: `track-trace: ${msg}`,
      rawResponse: { crashError: msg, stage: "browser_launch_or_navigation" },
    };
  } finally {
    clearTimeout(hardStop);
    try { await browser?.close(); } catch { /* ignore */ }
  }
}
