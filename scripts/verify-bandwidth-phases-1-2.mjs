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
const lazyImports = read("build/viteLazyHeavyImportsPlugin.ts");
const viteConfig = read("vite.config.ts");

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

if (failures.length > 0) {
  console.error("Bandwidth phase verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Bandwidth phases 1 and 2 invariants verified.");
