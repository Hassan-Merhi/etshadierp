#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const lightRoute = read("server/routes/stock/stockLightRoutes.ts");
const stockRoutes = read("server/routes/stockRoutes.ts");
const queryKeys = read("client/src/lib/queryKeys.ts");
const bulkRename = read("client/src/pages/settings/BulkRenameTab.tsx");
const inventoryRoutes = read("server/routes/inventoryRoutes.ts");
const offlinePrep = read("client/src/lib/offlinePrep.ts");

assert(stockRoutes.includes("registerStockLightRoutes"), "The lightweight stock-item route must remain registered.");
assert(queryKeys.includes('"/api/stock-items/light"'), "The light query key must use the real lightweight URL.");
assert(bulkRename.includes('fetch("/api/stock-items/light"'), "Bulk Rename must not download the full stock-item contract.");
assert(offlinePrep.includes("/api/stock-items/light"), "Offline preparation must use the lightweight contract.");

for (const field of ["id", "code", "name", "barcode", "uom", "active", "stockGroupId", "categoryId", "gradeId"]) {
  assert(lightRoute.includes(`${field}: stockItems.${field}`), `Light stock-item contract is missing ${field}.`);
}
for (const forbidden of ["sellingPrice", "openingQty", "openingRate", "openingValue", "totalValue", "averageRate", "createdAt", "updatedAt"]) {
  assert(!lightRoute.includes(`${forbidden}: stockItems.${forbidden}`), `Light stock-item contract must not expose ${forbidden}.`);
}

assert(inventoryRoutes.includes("Math.min(250"), "Inventory list must retain a bounded maximum page size.");
assert(inventoryRoutes.includes("count(*)::int"), "Inventory list must retain an independent filtered count.");
assert(inventoryRoutes.includes(".limit(pageSizeNum)"), "Inventory list must retain server-side pagination.");
assert(inventoryRoutes.includes('"/api/inventory/movement/drill"'), "Stock movement drill endpoint is missing.");
assert(inventoryRoutes.includes("stockItemId, year, month required"), "Movement drill must remain explicitly month-bounded.");
assert(inventoryRoutes.includes("res.json({ months: monthlySummary, grandTotal: gt })"), "Movement summary must retain full-period totals.");
assert(inventoryRoutes.includes("res.json({ transactions, totals })"), "Movement drill must retain complete month totals.");

if (failures.length) {
  console.error("Program 6C contract verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 6C stock and inventory contracts verified.");
