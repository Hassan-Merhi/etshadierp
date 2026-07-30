#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(relativePath, text, label = text) {
  const content = source(relativePath);
  if (!content.includes(text)) failures.push(`${relativePath}: missing ${label}`);
}

function forbidText(relativePath, text, label = text) {
  const content = source(relativePath);
  if (content.includes(text)) failures.push(`${relativePath}: forbidden ${label}`);
}

function requireOrder(relativePath, first, second) {
  const content = source(relativePath);
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    failures.push(`${relativePath}: expected ${first} before ${second}`);
  }
}

function requireLineLimit(relativePath, maximum) {
  const count = source(relativePath).split(/\r?\n/).length;
  if (count > maximum) failures.push(`${relativePath}: ${count} lines exceeds ${maximum}`);
}

const performanceRoutes = "server/routes/location/commonInventoryPerformanceRoutes.ts";
for (const marker of [
  'req.query.profile !== "compact"',
  'req.query.profile !== "matrix"',
  'res.setHeader("X-Result-Profile", "compact")',
  'res.setHeader("X-Result-Profile", "matrix")',
  "jsonb_object_agg(location_name, quantity ORDER BY location_name)",
  "ExcelJS.stream.xlsx.WorkbookWriter",
  "stream: res",
]) {
  requireText(performanceRoutes, marker);
}
forbidText(performanceRoutes, "Math.min(5000", "5,000-row page cap");
requireText(performanceRoutes, "Math.min(250", "250-row page cap");
requireLineLimit(performanceRoutes, 700);

const inventoryHook = "client/src/pages/location-inventory/useLocationInventoryQueries.ts";
for (const marker of [
  "profile=compact",
  "/api/inventory?profile=matrix",
  "refetchOnWindowFocus: false",
]) {
  requireText(inventoryHook, marker);
}
for (const forbidden of ["PAGE_SIZE = 5000", "totalPages - 1", "remaining.flat()"] ) {
  forbidText(inventoryHook, forbidden);
}

const combinedRows = "client/src/pages/location-inventory/useCombinedStockRows.ts";
requireText(combinedRows, "qtyByLocationName");
requireText(combinedRows, "Array.isArray(item.locations)");
requireText(combinedRows, "if (matrixProfile)");

const factoryBandwidth = "server/routes/performance/phase10FactoryBandwidthRoutes.ts";
for (const marker of [
  'req.query.profile !== "summary"',
  '"/api/factory/customer-proformas/:id/lines"',
  'req.query.profile !== "selector"',
  'res.setHeader("X-Result-Profile", "selector")',
  "lineCount:",
  "totalQuantity:",
]) {
  requireText(factoryBandwidth, marker);
}
forbidText(factoryBandwidth, "ORDER BY COALESCE(p.is_active", "dependency on optional is_active column");
requireLineLimit(factoryBandwidth, 400);

const factoryRoutes = "server/routes/factoryRoutes.ts";
requireText(factoryRoutes, "registerPhase10FactoryBandwidthRoutes");
requireOrder(factoryRoutes, "registerPhase10FactoryBandwidthRoutes(app)", "registerFactoryStockRoutes(app)");
requireOrder(factoryRoutes, "registerPhase10FactoryBandwidthRoutes(app)", "registerFactoryCustomersRoutes(app)");

const locationRegistry = "server/routes/location/index.ts";
requireOrder(locationRegistry, "registerCommonInventoryPerformanceRoutes(app)", "registerLocationInventoryRoutes(app)");

const migration = "migrations/20260730_001_phase10_bandwidth_indexes.sql";
for (const indexName of [
  "inventory_company_stock_location_idx",
  "customer_proformas_company_customer_name_idx",
  "customer_proforma_lines_proforma_article_idx",
  "factory_workers_company_active_name_idx",
  "factory_bale_products_company_active_name_idx",
]) {
  requireText(migration, indexName);
}
requireText(migration, "CREATE INDEX IF NOT EXISTS");

if (failures.length > 0) {
  console.error("Phase 10 API bandwidth verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Phase 10 API performance and bandwidth contracts verified.");
