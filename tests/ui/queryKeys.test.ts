/**
 * Unit tests for client/src/lib/queryKeys.ts — the shared React Query key
 * factories. Correctness here is what makes callers of the same data share a
 * cache and dedupe requests, so the normalisation rules (drop empties, sort
 * keys, keep the real URL first) are pinned down explicitly.
 */
import {
  normalizeFilters,
  factoryKeys,
  inventoryKeys,
  stockItemKeys,
  analyticsKeys,
} from "@/lib/queryKeys";

describe("normalizeFilters", () => {
  it("returns undefined for null/undefined/empty input", () => {
    expect(normalizeFilters(null)).toBeUndefined();
    expect(normalizeFilters(undefined)).toBeUndefined();
    expect(normalizeFilters({})).toBeUndefined();
  });

  it("drops undefined, null, and empty-string values", () => {
    expect(normalizeFilters({ a: undefined, b: null, c: "" })).toBeUndefined();
    expect(normalizeFilters({ a: 1, b: null, c: "" })).toEqual({ a: 1 });
  });

  it("keeps falsy-but-meaningful values (0, false)", () => {
    expect(normalizeFilters({ a: 0, b: false })).toEqual({ a: 0, b: false });
  });

  it("sorts keys so equal filters produce an identical object", () => {
    const out = normalizeFilters({ page: 2, limit: 10, date: "2026-01-01" });
    expect(Object.keys(out as object)).toEqual(["date", "limit", "page"]);
  });

  it("produces value-equal output regardless of input key order", () => {
    expect(normalizeFilters({ a: 1, b: 2 })).toEqual(normalizeFilters({ b: 2, a: 1 }));
  });
});

describe("factory / inventory key factories", () => {
  it("puts the real URL first, then company, then normalised filters", () => {
    expect(factoryKeys.bales(7, { page: 2, empty: "" })).toEqual([
      "/api/factory/bales",
      7,
      { page: 2 },
    ]);
  });

  it("normalises filters to undefined when nothing meaningful is passed", () => {
    expect(inventoryKeys.list(1, {})).toEqual(["/api/inventory", 1, undefined]);
  });

  it("distinct factory endpoints use distinct URLs", () => {
    expect(factoryKeys.daybook(1)[0]).toBe("/api/factory/daybook");
    expect(factoryKeys.stockAllocation(1)[0]).toBe("/api/factory/v5/stock-allocation");
  });
});

describe("stockItemKeys", () => {
  it("keeps light and full lists on separate cache URLs", () => {
    // The light list must not share a cache with the heavy full endpoint.
    expect(stockItemKeys.light(1)[0]).toBe("/api/stock-items/light");
    expect(stockItemKeys.full(1)[0]).toBe("/api/stock-items");
    expect(stockItemKeys.light(1)[0]).not.toBe(stockItemKeys.full(1)[0]);
  });
});

describe("analyticsKeys", () => {
  it("builds date-scoped account keys", () => {
    expect(analyticsKeys.accounts(3, "2026-01-01", "2026-01-31")).toEqual([
      "/api/accounts/all",
      3,
      "2026-01-01",
      "2026-01-31",
    ]);
  });

  it("normalises the financial-sales date range", () => {
    expect(analyticsKeys.financialSales(3, { to: "2026-02-01", from: "" })).toEqual([
      "/api/financial/sales",
      3,
      { to: "2026-02-01" },
    ]);
  });

  it("exposes stable global keys with no company scoping", () => {
    expect(analyticsKeys.suppliers()).toEqual(["/api/suppliers"]);
    expect(analyticsKeys.userCompanies()).toEqual(["/api/user/companies"]);
  });
});
