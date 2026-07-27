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
const requestStormGuard = read("client/src/lib/requestStormGuard.ts");
const paginationBridge = read("server/apiPaginationBridge.mjs");
const locationInventoryQueries = read("client/src/pages/location-inventory/useLocationInventoryQueries.ts");
const employeeGroupRoutes = read("server/routes/employeeGroupRoutes.ts");
const serverIndex = read("server/index.ts");

requireText(serviceWorker, "HASHED_ASSET_RE", "Hashed production assets must be identified.");
requireText(serviceWorker, "cacheFirstHashedAsset(request)", "Hashed assets must use cache-first loading.");
requireText(serviceWorker, "if (cached) return cached;", "Cached hashed assets must be returned before network access.");
rejectText(main, 'url.searchParams.set("_sw"', "Service-worker activation must not auto-reload every tab.");
requireText(main, 'new CustomEvent("erp:service-worker-updated"', "Service-worker activation must notify the update banner.");
requireText(app, 'window.addEventListener("erp:service-worker-updated"', "The update banner must handle service-worker updates.");

rejectText(screenFeed, 'import html2canvas from "html2canvas"', "html2canvas must not be statically imported.");
requireText(screenFeed, 'import("html2canvas")', "html2canvas must load only when capture starts.");
requireText(screenFeed, "return await fn();", "The canvas guard must remain active across async capture.");
requireText(lazyImports, 'await import("@/lib/excelHelper")', "ExcelJS must load only after an export request.");
requireText(lazyImports, "StockInSalesReport.tsx", "The main Stock In and Sales report must be covered.");
requireText(lazyImports, "StockInSalesReportDetail.tsx", "The detail report must be covered.");
requireText(viteConfig, "lazyHeavyImportsPlugin()", "The lazy-heavy-import Vite plugin must remain enabled.");

requireText(presence, 'document.visibilityState === "visible"', "Presence heartbeats must pause in hidden tabs.");
requireText(bandwidthDebug, "totalApiResponseBytes", "Bandwidth snapshots must report total API bytes.");
requireText(bandwidthDebug, "totalStaticAssetResponseBytes", "Bandwidth snapshots must report total static-asset bytes.");
requireText(bandwidthDebug, "isApiPath", "API rankings must exclude non-API paths.");
requireText(bandwidthDebug, "calculateRankScore", "The Program 6A ranking regression helper must remain available.");
requireText(operationalEvents, "ranked: event.ranked", "Ranked endpoint rows must reach structured production logs.");
requireText(operationalEvents, 'else logger.info(event.message, context)', "Informational bandwidth snapshots must log at info level.");

// Phase 1 — request-loop containment.
requireText(requestStormGuard, '/^\\/api\\/locations\\/\\d+\\/inventory$/', "Location inventory must be protected by the request storm guard.");
requireText(requestStormGuard, '/^\\/api\\/ledger-accounts$/', "Ledger account reads must be protected by the request storm guard.");
requireText(requestStormGuard, '/^\\/api\\/factory\\/containers$/', "Factory container reads must be protected by the request storm guard.");
requireText(requestStormGuard, 'headers.has("x-bypass-request-storm-guard")', "Operators must retain an explicit request-cache bypass.");
requireText(requestStormGuard, "Clear before the write and again after it finishes", "Read snapshots must be cleared on both sides of writes.");
requireText(requestStormGuard, "waitUntilVisible", "Heavy hidden-tab reads must remain deferred.");

// Phase 2 — compact payload profiles and active inventory adoption.
requireText(paginationBridge, "LOCATION_INVENTORY_FIELDS", "The compact location-inventory profile must remain defined.");
requireText(paginationBridge, "FACTORY_CONTAINER_COMPACT_FIELDS", "The compact factory-container profile must remain defined.");
requireText(paginationBridge, "STOCK_ITEM_IDENTITY_FIELDS", "The identity-only stock-item profile must remain defined.");
requireText(locationInventoryQueries, 'new URLSearchParams({ compact: "1" })', "Current location inventory must request the compact profile.");
requireText(locationInventoryQueries, 'new URLSearchParams({ asOfDate: fromDate, compact: "1" })', "Opening inventory must request the compact profile.");
requireText(locationInventoryQueries, 'new URLSearchParams({ asOfDate, compact: "1" })', "Closing inventory must request the compact profile.");

// Phase 3 — bounded database work and write-aware expensive-read reuse.
requireText(employeeGroupRoutes, "employeeGroupMembers.employeeGroupId", "Worker-group memberships must be bulk loaded.");
requireText(employeeGroupRoutes, "inArray(employees.id, employeeIds)", "Worker details must be fetched in one bounded query.");
rejectText(employeeGroupRoutes, "memberRecords.map(async", "Worker groups must not issue one employee query per member.");
requireText(paginationBridge, "expensiveGetTtls", "Expensive read models must use bounded short-lived reuse.");
requireText(paginationBridge, "writeGeneration", "Expensive read reuse must be invalidated by writes.");
requireText(paginationBridge, "generationAtStart === writeGeneration", "Reads racing a write must not populate stale cache entries.");
requireText(paginationBridge, 'this.req.method !== "GET"', "Every non-GET response must invalidate expensive reads.");

// Phase 4 — production asset delivery remains cache efficient and update safe.
requireText(serverIndex, 'res.setHeader("Cache-Control", "public, max-age=31536000, immutable")', "Hashed production assets must receive immutable one-year caching.");
requireText(serverIndex, 'res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")', "Application shell files must never be served stale.");
requireText(serverIndex, 'app.use("/assets", (_req, res)', "Missing assets must return 404 instead of the SPA shell.");

if (failures.length > 0) {
  console.error("Bandwidth phase verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Bandwidth phases 1-4 invariants verified.");
