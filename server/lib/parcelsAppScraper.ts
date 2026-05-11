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

import type { ParcelsAppShipment } from "./parcelsAppClient";

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
    require.resolve("puppeteer-extra");
    require.resolve("puppeteer-extra-plugin-stealth");
    require.resolve("puppeteer");
    return true;
  } catch {
    return false;
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
    // Lazy require so the server won't crash if the package is missing
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteerExtra = require("puppeteer-extra") as any;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const StealthPlugin  = require("puppeteer-extra-plugin-stealth") as any;
    puppeteerExtra.use(StealthPlugin());

    browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
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

    // Intercept ParcelsApp API responses (v2 and v3)
    page.on("response", async (response: any) => {
      const url: string = response.url();
      if (
        url.includes("parcelsapp.com") &&
        (url.includes("/api/v2/parcel") || url.includes("/api/v3/shipment") || url.includes("/api/v3/track"))
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
