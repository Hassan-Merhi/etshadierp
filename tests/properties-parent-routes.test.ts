import { describe, expect, it } from "vitest";
import { getParentRoute } from "../client/src/lib/parent-routes";

describe("Properties parent route registry", () => {
  it.each([
    ["/properties/create", "/properties/rentals?tab=warehouses"],
    ["/properties/transfer", "/properties/rentals"],
    ["/properties/rental/warehouses", "/properties/rentals?tab=warehouses"],
    ["/properties/rental/shops", "/properties/rentals?tab=shops"],
    ["/properties/rental/payments", "/properties/rentals?tab=payments"],
    ["/properties/voucher-detail/99", "/properties/vouchers"],
    ["/properties/vouchers/99/edit", "/properties/vouchers"],
    ["/properties/ledger-vouchers/12/2026/7", "/properties/ledger-monthly/12"],
    ["/properties/ledger-monthly/12", "/properties/accounts"],
    ["/properties/account-groups", "/properties/accounts"],
    ["/properties/net-position-details", "/properties/settings"],
    ["/properties/import-cycle-diagnostics", "/properties/settings"],
    ["/properties/inventory-repair", "/properties/settings"],
    ["/properties/company-data-reset", "/properties/settings"],
    ["/properties/orphaned-records", "/properties/settings"],
    ["/properties/deleted-items", "/properties/settings"],
    ["/properties/chatbot-settings", "/properties/settings"],
    ["/properties/balance-repair", "/properties/settings"],
  ])("maps %s to %s", (path, expected) => {
    expect(getParentRoute(path)).toBe(expected);
  });

  it("ignores query strings and hashes", () => {
    expect(getParentRoute("/properties/create?source=dashboard#form")).toBe(
      "/properties/rentals?tab=warehouses",
    );
  });

  it("does not invent parents for Properties roots", () => {
    expect(getParentRoute("/properties/daybook")).toBeNull();
    expect(getParentRoute("/properties/rentals")).toBeNull();
    expect(getParentRoute("/properties/accounts")).toBeNull();
    expect(getParentRoute("/properties/vouchers")).toBeNull();
    expect(getParentRoute("/properties/settings")).toBeNull();
    expect(getParentRoute("/properties/my-settings")).toBeNull();
  });
});
