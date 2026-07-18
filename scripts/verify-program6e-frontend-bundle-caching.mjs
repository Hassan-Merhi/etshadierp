#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const lazyPages = read("client/src/lazyPages.ts");
const queryKeys = read("client/src/lib/queryKeys.ts");
const queryClient = read("client/src/lib/queryClient.ts");
const stockItems = read("client/src/pages/StockItems.tsx");

assert(lazyPages.includes('import { lazy } from "react"'), "Route-level React.lazy code splitting must remain enabled.");
assert((lazyPages.match(/lazy\(\(\) => import\(/g) || []).length >= 50, "Expected broad route-level code splitting coverage.");
assert(queryKeys.includes("normalizeFilters"), "Heavy query keys must retain normalized filter support.");
assert(queryKeys.includes('["/api/stock-items/light", companyId]'), "Light stock-item key must use the real lightweight URL.");
assert(queryClient.includes("refetchInterval: false"), "Global polling must remain disabled by default.");
assert(queryClient.includes("refetchOnWindowFocus: false"), "Window-focus refetch must remain disabled by default.");
assert(queryClient.includes("refetchOnMount: false"), "Mount refetch must remain disabled by default.");
assert(queryClient.includes("refetchOnReconnect: false"), "Reconnect refetch must remain disabled by default.");
assert(queryClient.includes("refetchType: \"active\""), "Heavy cache invalidations must retain active-query-only support.");
assert(queryClient.includes("keyStartsWith"), "URL-with-params invalidations must retain prefix-predicate support.");
assert(stockItems.includes('await import("@/lib/excelHelper")'), "StockItems Excel dependencies must remain dynamically imported.");
assert(!stockItems.match(/^import[^\n]+from\s+["']@\/lib\/excelHelper["']/m), "StockItems must not statically import the Excel helper.");

if (failures.length) {
  console.error("Program 6E frontend bundle/caching verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Program 6E frontend bundle and caching invariants verified.");
