import { describe, expect, it } from "vitest";

import {
  buildPaginationMeta,
  parseBoundedInteger,
  parseIdList,
  parsePagination,
  parseSearchQuery,
} from "../server/lib/pagination";
import { parseInventoryListFilters } from "../server/routes/inventory/inventoryRequestContext";

describe("bandwidth phases 3-4 pagination contracts", () => {
  it("clamps page sizes and produces a stable offset", () => {
    expect(parsePagination({ page: "3", pageSize: "5000" }, { defaultPageSize: 50, maxPageSize: 100 })).toEqual({
      page: 3,
      pageSize: 100,
      offset: 200,
    });
    expect(parseBoundedInteger("-10", 5, 1, 100)).toBe(1);
    expect(buildPaginationMeta(201, 3, 100)).toEqual({ page: 3, pageSize: 100, total: 201, totalPages: 3 });
  });

  it("normalizes compact search and selected-item inputs", () => {
    expect(parseSearchQuery(`  ${"x".repeat(200)}  `)).toHaveLength(100);
    expect(parseIdList("3,2,3,bad,-1,8")).toEqual([3, 2, 8]);
  });

  it("bounds the canonical inventory list and parses server-side filters", () => {
    const req = {
      query: {
        page: "2",
        pageSize: "5000",
        search: "  bale  ",
        stockGroupId: "none",
        categoryIds: "4,7,none",
        locationId: "12",
        profile: "combined",
      },
    } as any;
    expect(parseInventoryListFilters(req)).toEqual({
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
  });
});
