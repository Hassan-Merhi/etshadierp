/**
 * parcelsAppScraper.ts — ParcelsApp website scraper via Puppeteer + stealth.
 *
 * Does NOT use the ParcelsApp API key or count against the API quota.
 * Strategy: load the real ParcelsApp tracking page in a headless Chrome with
 * the stealth plugin active, then intercept the page's own XHR/fetch response.
 * The page generates its own valid reCaptcha v3 token — we just capture the result.
 *
 * If reCaptcha detects the automation the API returns NO_TRACKER; we surface
 * blocked=true so the caller knows to fall back to the next provider.
 */

import { existsSync } from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import type { ParcelsAppShipment } from "./parcelsAppClient";

// createRequire lets us use require() from an ESM / "type":"module" context.
const _require = createRequire(import.meta.url);

/**
 * Returns the path to a usable Chromium binary, checking in order:
 *   1. PUPPETEER_EXECUTABLE_PATH env override
 *   2. System-installed chromium / chromium-browser / google-chrome (from Nix)
 *   3. Puppeteer's own downloaded Chrome binary
 */
function getChromiumPath(): string | null {
  // 1. Explicit env override
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. System Nix / PATH binaries
  for (const cmd of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const p = execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf8", timeout: 3000 }).trim();
      if (p && existsSync(p)) return p;
    } catch { /* not found, try next */ }
  }

  // 3. Puppeteer bundled Chrome
  try {
    const puppeteer = _require("puppeteer");
    const p: string = typeof puppeteer.executablePath === "function" ? puppeteer.executablePath() : "";
    if (p && existsSync(p)) return p;
  } catch { /* puppeteer not installed */ }

  return null;
}

export interface ScraperResult {
  success: boolean;
  shipment: ParcelsAppShipment | null;
  /** reCaptcha / bot-detection caught us */
  blocked: boolean;
  rawResponse?: unknown;
  error?: string;
}

const SCRAPER_TIMEOUT_MS = 90_000;
const NAV_TIMEOUT_MS     = 60_000;
const DATA_WAIT_MS       = 45_000;

export function isScraperAvailable(): boolean {
  try {
    _require.resolve("puppeteer-extra");
    _require.resolve("puppeteer-extra-plugin-stealth");
    _require.resolve("puppeteer");
    return !!getChromiumPath();
  } catch {
    return false;
  }
}

/**
 * Download the Puppeteer-managed Chrome binary if it is missing.
 * Safe to call on every server startup — exits immediately if Chrome
 * is already present.  Logs progress so deployment issues are visible.
 */
export async function ensureChromiumAvailable(): Promise<void> {
  if (isScraperAvailable()) {
    const chromePath = getChromiumPath();
    console.log("[Puppeteer] Chrome binary found — scraper ready.", chromePath);
    return;
  }

  // Packages missing → nothing we can do at runtime.
  try {
    _require.resolve("puppeteer");
  } catch {
    console.log("[Puppeteer] puppeteer package not found — skipping Chrome download.");
    return;
  }

  // Try downloading Puppeteer's bundled Chrome as a last resort
  try {
    const puppeteer = _require("puppeteer");
    const chromePath: string =
      typeof puppeteer.executablePath === "function"
        ? puppeteer.executablePath()
        : "";
    if (!chromePath) {
      console.log("[Puppeteer] Could not determine Chrome path — scraper unavailable.");
      return;
    }
    console.log("[Puppeteer] No Chrome found — attempting download (may take a minute)...");
    execSync("npx puppeteer browsers install chrome", {
      stdio: "inherit",
      timeout: 180_000,
    });
    if (existsSync(chromePath)) {
      console.log("[Puppeteer] Chrome download complete — scraper ready.");
    } else {
      console.warn("[Puppeteer] Chrome still not found after download — scraper unavailable.");
    }
  } catch (err: any) {
    console.warn("[Puppeteer] Chrome setup error:", err?.message ?? err);
  }
}

export async function scrapeTracking(containerNumber: string): Promise<ScraperResult> {
  if (!isScraperAvailable()) {
    return { success: false, shipment: null, blocked: false, error: "Puppeteer not installed" };
  }

  let browser: any = null;
  const timer = new AbortController();
  const hard = setTimeout(() => timer.abort(), SCRAPER_TIMEOUT_MS);

  try {
    const puppeteerExtra = _require("puppeteer-extra") as any;
    const StealthPlugin  = _require("puppeteer-extra-plugin-stealth") as any;
    puppeteerExtra.use(StealthPlugin());

    const chromePath = getChromiumPath();
    browser = await puppeteerExtra.launch({
      headless: "new" as any,   // new headless mode — more stable, better fingerprint
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",    // KEEP: prevents multiple Chrome processes; critical for memory on 2GB hosts
        // Anti-detection
        "--disable-blink-features=AutomationControlled",
        "--window-size=1280,800",
        // Memory reduction
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-client-side-phishing-detection",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-hang-monitor",
        "--disable-infobars",
        "--disable-notifications",
        "--disable-popup-blocking",
        "--disable-print-preview",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        "--metrics-recording-only",
        "--safebrowsing-disable-auto-update",
        "--password-store=basic",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    );

    let capturedData: unknown = null;
    let isBlocked = false;

    // Intercept ParcelsApp API responses (v2 and v3, all known endpoints)
    page.on("response", async (response: any) => {
      const url: string = response.url();
      if (
        url.includes("parcelsapp.com") &&
        (
          url.includes("/api/v2/parcel") ||
          url.includes("/api/v2/shipment") ||
          url.includes("/api/v3/shipment") ||
          url.includes("/api/v3/shipments") ||
          url.includes("/api/v3/track") ||
          url.includes("/api/v3/parcel")
        )
      ) {
        try {
          const json = await response.json().catch(() => null);
          if (!json) return;

          // Detect bot/captcha rejection
          if (
            json?.error === "NO_TRACKER" ||
            json?.blocked === true ||
            json?.status === "blocked" ||
            (typeof json?.error === "string" && /captcha|recaptcha|bot/i.test(json.error))
          ) {
            isBlocked = true;
            return;
          }

          // Accept any response that has shipments/parcels array
          if (json?.shipments?.length || json?.parcels?.length) {
            capturedData = json;
          }
        } catch {
          // ignore parse errors on unrelated requests
        }
      }
    });

    await page.goto(`https://parcelsapp.com/en/tracking/${encodeURIComponent(containerNumber)}`, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });

    // Wait up to DATA_WAIT_MS for data to arrive after navigation
    const deadline = Date.now() + DATA_WAIT_MS;
    while (!capturedData && !isBlocked && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
    }

    await browser.close();
    browser = null;
    clearTimeout(hard);

    if (isBlocked) {
      return {
        success: false,
        shipment: null,
        blocked: true,
        error: "reCaptcha detected automation — stealth plugin bypassed",
      };
    }

    if (!capturedData) {
      return {
        success: false,
        shipment: null,
        blocked: false,
        error: "No tracking data received from ParcelsApp page",
      };
    }

    const data = capturedData as any;
    const all: ParcelsAppShipment[] = data.shipments ?? data.parcels ?? [];
    const shipment =
      all.find((s: any) => s.trackingId === containerNumber || s.id === containerNumber) ??
      all[0] ??
      null;

    return {
      success: !!shipment,
      shipment,
      blocked: false,
      rawResponse: capturedData,
      error: shipment ? undefined : "No matching shipment in page response",
    };
  } catch (err: any) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    clearTimeout(hard);
    return {
      success: false,
      shipment: null,
      blocked: false,
      error: `Scraper error: ${err?.message ?? "Unknown"}`,
    };
  }
}
