#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireText = (source, text, message) => {
  if (!source.includes(text)) failures.push(message);
};
const rejectText = (source, text, message) => {
  if (source.includes(text)) failures.push(message);
};

const serviceWorker = read("client/public/sw.js");
const main = read("client/src/main.tsx");
const app = read("client/src/App.tsx");
const screenFeed = read("client/src/hooks/use-screen-feed.ts");
const presence = read("client/src/hooks/use-presence.ts");
const lazyImports = read("build/viteLazyHeavyImportsPlugin.ts");
const viteConfig = read("vite.config.ts");
const bandwidthDebug = read("server/middleware/bandwidthDebug.ts");
const operationalEvents = read("server/lib/operationalEvents.ts");
const hotspotGuard = read("client/src/lib/bandwidthPhase1HotspotGuard.ts");
const payloadGuard = read("client/src/lib/bandwidthPhase2PayloadGuard.ts");
const accountingGuard = read("client/src/lib/accountingRequestFetchGuard.ts");
const apiBridge = read("server/apiPaginationBridge.mjs");
const inventoryRoutes = read("server/routes/inventoryRoutes.ts");

requireText(serviceWorker, "HASHED_ASSET_RE", "Hashed production assets must be identified.");
requireText(serviceWorker, "cacheFirstHashedAsset(request)", "Hashed assets must use cache-first loading.");
requireText(serviceWorker, "if (cached) return cached;", "Cached hashed assets must be returned before network access.");
rejectText(main, 'url.searchParams.set("_sw"', "Service-worker activation must not auto-reload every tab.");
requireText(
  main,
  'new CustomEvent("erp:service-worker-updated"',
  "Service-worker activation must notify the update banner."
);
requireText(
  app,
  'window.addEventListener("erp:service-worker-updated"',
  "The update banner must handle service-worker updates."
);

rejectText(screenFeed, 'import html2canvas from "html2canvas"', "html2canvas must not be statically imported.");
requireText(screenFeed, 'import("html2canvas")', "html2canvas must load only when capture starts.");
requireText(screenFeed, "return await fn();", "The canvas guard must remain active across async capture.");
requireText(lazyImports, 'await import("@/lib/excelHelper")', "ExcelJS must load only after an export request.");
requireText(lazyImports, "StockInSalesReport.tsx", "The main Stock In and Sales report must be covered.");
requireText(lazyImports, "StockInSalesReportDetail.tsx", "The detail report must be covered.");
requireText(viteConfig, "lazyHeavyImportsPlugin()", "The lazy-heavy-import Vite plugin must remain enabled.");

requireText(presence, 'document.visibilityState === "visible"', "Presence heartbeats must pause in hidden tabs.");
requireText(bandwidthDebug, "totalApiResponseBytes", "Bandwidth snapshots must report total API bytes.");
requireText(
  bandwidthDebug,
  "totalStaticAssetResponseBytes",
  "Bandwidth snapshots must report total static-asset bytes."
);
requireText(bandwidthDebug, "isApiPath", "API rankings must exclude non-API paths.");
requireText(
  bandwidthDebug,
  "calculateRankScore",
  "The Program 6A ranking regression helper must remain available."
);
requireText(
  operationalEvents,
  "ranked: event.ranked",
  "Ranked endpoint rows must reach structured production logs."
);
requireText(
  operationalEvents,
  'else logger.info(event.message, context)',
  "Informational bandwidth snapshots must log at info level."
);

requireText(
  accountingGuard,
  'import "./bandwidthPhase1HotspotGuard";',
  "The Phase 1 hotspot guard must be installed before accounting fetch protection."
);
requireText(
  accountingGuard,
  'import "./bandwidthPhase2PayloadGuard";',
  "The Phase 2 payload guard must be installed before accounting fetch protection."
);
requireText(hotspotGuard, "/api\\/containers\\/otw-items", "OTW container items must be request-contained.");
requireText(hotspotGuard, "/api\\/factory\\/containers", "Factory containers must be request-contained.");
requireText(hotspotGuard, "/api\\/ledger-accounts", "Ledger accounts must be request-contained.");
requireText(hotspotGuard, "/api\\/factory\\/bale-products", "Bale products must be request-contained.");
requireText(hotspotGuard, "/api\\/factory\\/workers", "Factory workers must be request-contained.");
requireText(hotspotGuard, "/api\\/factory\\/mix-batches", "Mix batches must be request-contained.");
requireText(hotspotGuard, "/api\\/factory\\/raw-stock", "Raw-stock reads must be request-contained.");
requireText(hotspotGuard, "/api\\/accounts\\/all", "Accounts reads must be request-contained.");
requireText(hotspotGuard, "inFlightRequests", "Identical hotspot GETs must share one in-flight request.");
requireText(hotspotGuard, "writeGeneration", "Writes must prevent raced GETs from caching stale data.");
requireText(hotspotGuard, "writeGeneration += 1", "Every write boundary must advance the cache generation.");
requireText(hotspotGuard, "clearCache();", "Writes must clear short-lived hotspot snapshots.");
requireText(hotspotGuard, "waitUntilVisible(signal)", "Heavy hotspot reads must pause in hidden tabs.");
requireText(
  hotspotGuard,
  "x-bypass-request-storm-guard",
  "Operators must be able to bypass request snapshots explicitly."
);
requireText(
  hotspotGuard,
  "maxResponseBytes: 4_000_000",
  "The OTW response must use a bounded large-response allowance."
);
requireText(hotspotGuard, "MAX_CACHE_ENTRIES = 32", "The hotspot response cache must remain memory-bounded.");

requireText(payloadGuard, 'window.location.pathname !== "/inventory"', "Phase 2 profiles must be limited to Inventory Hub.");
requireText(payloadGuard, 'get("tab") === "on-the-way"', "Phase 2 profiles must be limited to the OTW tab.");
requireText(payloadGuard, 'return "otw-summary";', "The OTW tab must request compact container summaries.");
requireText(payloadGuard, 'return "stock-otw";', "The OTW tab must request grouped stock rows.");
requireText(payloadGuard, 'return "combined";', "Combined Inventory must request aggregated inventory rows.");
requireText(payloadGuard, 'return "combined-detail";', "Combined Inventory must request compact container details.");
requireText(payloadGuard, 'url.searchParams.set("profile", profile);', "Payload profiles must be explicit query parameters.");

requireText(apiBridge, "compactOtwContainerSummary", "The server must compact OTW container summaries.");
requireText(apiBridge, "compactStockOtwItems", "The server must aggregate Stock OTW line items.");
requireText(apiBridge, "compactCombinedContainerDetail", "The server must compact Combined Inventory container details.");
requireText(apiBridge, 'profile === "otw-summary"', "The OTW summary profile must remain opt-in.");
requireText(apiBridge, 'profile === "stock-otw"', "The grouped Stock OTW profile must remain opt-in.");
requireText(apiBridge, 'profile === "combined-detail"', "The compact detail profile must remain opt-in.");

requireText(inventoryRoutes, 'profile === "combined"', "Inventory must expose an opt-in combined summary profile.");
requireText(inventoryRoutes, "SUM(${inventory.quantity}::numeric)", "Combined inventory quantities must aggregate in SQL.");
requireText(inventoryRoutes, "SUM(${inventory.totalValue}::numeric)", "Combined inventory values must aggregate in SQL.");
requireText(inventoryRoutes, ".groupBy(", "Combined inventory must group by stock item rather than location row.");
requireText(inventoryRoutes, "pageSize: data.length", "Combined inventory must return its complete aggregated result.");

if (failures.length > 0) {
  console.error("Bandwidth phase verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Bandwidth phases 1-2 request and payload invariants verified.");
