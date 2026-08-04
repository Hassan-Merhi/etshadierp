import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildPaginationMeta,
  parseBoundedInteger,
  parseIdList,
  parsePagination,
  parseSearchQuery,
} from "../server/lib/pagination";
import { parseInventoryListFilters } from "../server/routes/inventory/inventoryRequestContext";

assert.deepEqual(
  parsePagination({ page: "3", pageSize: "5000" }, { defaultPageSize: 50, maxPageSize: 100 }),
  { page: 3, pageSize: 100, offset: 200 }
);
assert.equal(parseBoundedInteger("-10", 5, 1, 100), 1);
assert.deepEqual(buildPaginationMeta(201, 3, 100), {
  page: 3,
  pageSize: 100,
  total: 201,
  totalPages: 3,
});

assert.equal(parseSearchQuery(`  ${"x".repeat(200)}  `).length, 100);
assert.deepEqual(parseIdList("3,2,3,bad,-1,8"), [3, 2, 8]);

const filters = parseInventoryListFilters({
  query: {
    page: "2",
    pageSize: "5000",
    search: "  bale  ",
    stockGroupId: "none",
    categoryIds: "4,7,none",
    locationId: "12",
    profile: "combined",
  },
} as any);
assert.deepEqual(filters, {
  page: 2,
  pageSize: 100,
  search: "bale",
  locationId: 12,
  stockGroupId: undefined,
  unassignedStockGroup: true,
  categoryIds: [4, 7],
  includeUncategorized: true,
  profile: "combined",
});

const indexSource = fs.readFileSync("server/startup-schema/011-bandwidth-search-indexes.ts", "utf8");
for (const requiredIndex of [
  "stock_items_company_active_name_idx",
  "stock_items_name_trgm_idx",
  "stock_item_aliases_company_item_idx",
  "inventory_company_location_item_idx",
  "stock_item_location_prices_location_item_idx",
]) {
  assert.match(indexSource, new RegExp(requiredIndex));
}

console.log("Bandwidth phases 3-4 focused regression checks passed.");
