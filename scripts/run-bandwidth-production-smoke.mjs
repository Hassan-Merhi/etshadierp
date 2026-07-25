#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const BASE_URL = (process.env.ERP_BANDWIDTH_SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const USERNAME = process.env.ERP_BANDWIDTH_SMOKE_USERNAME || "";
const PASSWORD = process.env.ERP_BANDWIDTH_SMOKE_PASSWORD || "";
const AUTHENTICATED = Boolean(USERNAME && PASSWORD);
const ROUTE = process.env.ERP_BANDWIDTH_SMOKE_ROUTE || (AUTHENTICATED ? "/financial-overview" : "/login");
const TIMEOUT_MS = Number(process.env.ERP_BANDWIDTH_SMOKE_TIMEOUT_MS || 45_000);
const OUTPUT_DIR = path.resolve(process.env.ERP_BANDWIDTH_SMOKE_OUTPUT_DIR || "artifacts/bandwidth-smoke");
const HASHED_ASSET_RE = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|png|jpe?g|webp|gif|svg|ico)$/i;

const report = {
  baseUrl: BASE_URL,
  route: ROUTE,
  authenticated: AUTHENTICATED,
  startedAt: new Date().toISOString(),
  cacheHeaders: {},
  serviceWorker: {},
  phases: {},
  heavyLibraries: [],
  failures: [],
};

function sameOriginPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(BASE_URL).origin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

function cacheControlPasses(value, mode) {
  const normalized = String(value || "").toLowerCase();
  if (mode === "immutable") return normalized.includes("max-age=31536000") && normalized.includes("immutable");
  return normalized.includes("no-store") || normalized.includes("no-cache");
}

async function waitForSettledUi(page) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function login(page) {
  await page.waitForSelector('[data-testid="input-username"]', { visible: true, timeout: TIMEOUT_MS });
  await page.type('[data-testid="input-username"]', USERNAME);
  await page.type('[data-testid="input-password"]', PASSWORD);
  await page.click('[data-testid="button-login"]');
  await page.waitForFunction(
    () => window.location.pathname !== "/login" && Boolean(document.getElementById("main-content")),
    { timeout: TIMEOUT_MS },
  );
  await waitForSettledUi(page);
}

async function inspectCacheStorage(page) {
  return page.evaluate(async () => {
    if (!("caches" in window)) return { supported: false, cacheNames: [], urls: [] };
    const cacheNames = (await caches.keys()).filter((name) => name.startsWith("erp-"));
    const urls = [];
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      for (const request of requests) urls.push(request.url);
    }
    return { supported: true, cacheNames, urls };
  });
}

async function checkHeader(url, mode) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  const cacheControl = response.headers.get("cache-control") || "";
  return {
    url,
    status: response.status,
    cacheControl,
    passed: response.ok && cacheControlPasses(cacheControl, mode),
  };
}

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);
  page.setDefaultNavigationTimeout(TIMEOUT_MS);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  let phase = "initial";
  const responses = [];
  const browserErrors = [];

  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (!["document", "script", "stylesheet"].includes(request.resourceType())) return;
    const requestPath = sameOriginPath(request.url());
    if (!requestPath) return;
    const errorText = request.failure()?.errorText || "unknown";
    if (errorText !== "net::ERR_ABORTED") browserErrors.push(`${phase}: ${requestPath} failed (${errorText})`);
  });
  page.on("response", (response) => {
    const requestPath = sameOriginPath(response.url());
    if (!requestPath) return;
    if (!HASHED_ASSET_RE.test(requestPath)) return;
    responses.push({
      phase,
      path: requestPath,
      status: response.status(),
      resourceType: response.request().resourceType(),
      fromCache: response.fromCache(),
      fromServiceWorker: response.fromServiceWorker(),
    });
  });

  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle2", timeout: TIMEOUT_MS });
  await waitForSettledUi(page);
  if (AUTHENTICATED) await login(page);
  if (new URL(page.url()).pathname !== ROUTE) {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "networkidle2", timeout: TIMEOUT_MS });
    await waitForSettledUi(page);
  }

  const serviceWorkerReady = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false, ready: false, controlled: false };
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("service-worker-ready-timeout")), 15_000)),
    ]);
    return {
      supported: true,
      ready: true,
      controlled: Boolean(navigator.serviceWorker.controller),
    };
  });
  report.serviceWorker.initial = serviceWorkerReady;

  phase = "warm";
  await page.reload({ waitUntil: "networkidle2", timeout: TIMEOUT_MS });
  await waitForSettledUi(page);

  const warmCache = await inspectCacheStorage(page);
  const warmHashedPaths = [...new Set(
    responses
      .filter((entry) => entry.phase === "warm")
      .map((entry) => entry.path),
  )];
  const cachedPaths = new Set(
    warmCache.urls
      .map(sameOriginPath)
      .filter((value) => value && HASHED_ASSET_RE.test(value)),
  );
  const missingFromCache = warmHashedPaths.filter((assetPath) => !cachedPaths.has(assetPath));
  report.serviceWorker.afterWarm = {
    ...warmCache,
    cachedHashedAssetCount: cachedPaths.size,
    warmHashedAssetCount: warmHashedPaths.length,
    missingFromCache,
    controlled: await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  };

  phase = "repeat";
  await page.reload({ waitUntil: "networkidle2", timeout: TIMEOUT_MS });
  await waitForSettledUi(page);

  const repeatResponses = responses.filter((entry) => entry.phase === "repeat");
  const repeatNotServedLocally = repeatResponses.filter(
    (entry) => !entry.fromCache && !entry.fromServiceWorker,
  );

  for (const name of ["exceljs-vendor", "html2canvas-vendor"]) {
    const matches = responses.filter((entry) => entry.path.includes(name));
    if (matches.length > 0) report.heavyLibraries.push({ name, matches });
  }

  const firstAssetPath = responses.find((entry) => HASHED_ASSET_RE.test(entry.path))?.path;
  report.cacheHeaders.index = await checkHeader(`${BASE_URL}/`, "fresh");
  report.cacheHeaders.serviceWorker = await checkHeader(`${BASE_URL}/sw.js`, "fresh");
  if (firstAssetPath) {
    report.cacheHeaders.hashedAsset = await checkHeader(`${BASE_URL}${firstAssetPath}`, "immutable");
  }

  report.phases = {
    initial: responses.filter((entry) => entry.phase === "initial"),
    warm: responses.filter((entry) => entry.phase === "warm"),
    repeat: repeatResponses,
  };
  report.browserErrors = browserErrors;

  if (!serviceWorkerReady.supported || !serviceWorkerReady.ready) {
    report.failures.push("Service workers are unavailable or did not become ready.");
  }
  if (!report.serviceWorker.afterWarm.controlled) {
    report.failures.push("The warm reload was not controlled by the service worker.");
  }
  if (warmHashedPaths.length === 0) {
    report.failures.push("No hashed production assets were observed during the warm load.");
  }
  if (missingFromCache.length > 0) {
    report.failures.push(`Hashed assets missing from ERP Cache Storage: ${missingFromCache.join(", ")}`);
  }
  if (repeatResponses.length === 0) {
    report.failures.push("No hashed assets were observed during the repeat load.");
  }
  if (repeatNotServedLocally.length > 0) {
    report.failures.push(
      `Repeat load bypassed browser/service-worker cache for: ${repeatNotServedLocally.map((entry) => entry.path).join(", ")}`,
    );
  }
  if (report.heavyLibraries.length > 0) {
    report.failures.push(
      `Heavy libraries loaded on an ordinary route: ${report.heavyLibraries.map((entry) => entry.name).join(", ")}`,
    );
  }
  for (const [name, result] of Object.entries(report.cacheHeaders)) {
    if (!result.passed) report.failures.push(`${name} cache header check failed: ${result.cacheControl || "missing"}`);
  }
  report.failures.push(...browserErrors);

  await page.screenshot({ path: path.join(OUTPUT_DIR, "repeat-load.png"), fullPage: true });
  await page.close();
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.failures = [...new Set(report.failures)];
await fs.writeFile(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

if (!AUTHENTICATED) {
  console.log("Bandwidth smoke used the login route. Set ERP_BANDWIDTH_SMOKE_USERNAME and ERP_BANDWIDTH_SMOKE_PASSWORD for a full authenticated-route check.");
}

if (report.failures.length > 0) {
  console.error(`Bandwidth production smoke failed with ${report.failures.length} issue(s):`);
  for (const failure of report.failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Bandwidth production smoke passed: immutable headers, Cache Storage, repeat load and heavy-library deferral verified.");
console.log(`Report: ${path.join(OUTPUT_DIR, "report.json")}`);
