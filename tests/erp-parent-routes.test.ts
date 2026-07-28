import { describe, expect, it } from "vitest";
import { getParentRoute } from "../client/src/lib/parent-routes";

describe("ERP parent route registry", () => {
  it.each([
    ["/suppliers/42/edit", "/parties?tab=suppliers"],
    ["/suppliers/42/proformas", "/parties?tab=suppliers"],
    ["/pos/edit/77", "/pos"],
    ["/purchase-orders/7/edit", "/containers"],
    ["/containers/7/verification", "/containers/7"],
    ["/containers/7", "/containers"],
    ["/ledger-vouchers/12/2026/7", "/ledger-monthly/12"],
    ["/ledger-monthly/12", "/accounts"],
    ["/voucher-detail/99", "/vouchers"],
    ["/stock-query/15", "/stock?tab=query"],
    ["/stock-items/15/history/2026/7", "/stock-items/15/history"],
    ["/stock-items/15/history", "/stock?tab=items"],
    ["/locations/3/stock-items/15/vouchers/2026/7", "/locations/3/stock-items/15/history"],
    ["/locations/3/stock-items/15/history", "/inventory?tab=by-location"],
    ["/erp/rental/payments", "/erp/rental/shops"],
    ["/sp/gc-migration", "/sp/setup?tab=migration"],
    ["/inventory-repair", "/settings"],
  ])("maps %s to %s", (path, expected) => {
    expect(getParentRoute(path)).toBe(expected);
  });

  it("ignores query strings and hashes", () => {
    expect(getParentRoute("/stock-query/15?tab=summary#top")).toBe("/stock?tab=query");
  });

  it("does not invent parents for ERP roots", () => {
    expect(getParentRoute("/tracking")).toBeNull();
    expect(getParentRoute("/inventory")).toBeNull();
    expect(getParentRoute("/accounts")).toBeNull();
  });
});
