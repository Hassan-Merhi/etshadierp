import type { Plugin } from "vite";

import { heavyListPaginationPlugin as legacyHeavyListPaginationPlugin } from "./viteHeavyListPaginationPluginLegacy";

const STOCK_ENTRY_SUFFIX = "/client/src/pages/StockEntryHistory.tsx";

function transformStockEntryShell(source: string): string {
  const before = `      if (group.erpLocationId) gp.set("locationId", String(group.erpLocationId));\n      return {`;
  const after = `      if (group.erpLocationId) gp.set("locationId", String(group.erpLocationId));\n      if (statusFilter.length > 0) gp.set("status", statusFilter.join(","));\n      if (debouncedSearch.trim()) gp.set("search", debouncedSearch.trim());\n      return {`;
  const first = source.indexOf(before);
  if (first < 0) {
    throw new Error("[heavy-list-pagination] Missing transform target: stock-entry lazy expanded group filters");
  }
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error("[heavy-list-pagination] Ambiguous transform target: stock-entry lazy expanded group filters");
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

export function heavyListPaginationPlugin(): Plugin {
  const legacy = legacyHeavyListPaginationPlugin();
  const legacyTransform = legacy.transform;

  return {
    ...legacy,
    transform(source, id) {
      const normalizedId = id.replaceAll("\\", "/").split("?")[0];
      if (normalizedId.endsWith(STOCK_ENTRY_SUFFIX)) {
        return { code: transformStockEntryShell(source), map: null };
      }
      if (typeof legacyTransform !== "function") {
        throw new Error("[heavy-list-pagination] Expected legacy transform hook to be callable");
      }
      return legacyTransform.call(this, source, id);
    },
  };
}
