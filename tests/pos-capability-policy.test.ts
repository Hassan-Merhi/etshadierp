import { describe, expect, it } from "vitest";
import {
  hasRequestedDiscount,
  isCreditSaleRequested,
  requestedPosSaleCapabilities,
} from "../server/services/security/posCapabilityPolicy";

describe("POS capability policy", () => {
  it("detects credit sales from supported request values", () => {
    expect(isCreditSaleRequested({ isCreditSale: true })).toBe(true);
    expect(isCreditSaleRequested({ isCreditSale: "true" })).toBe(true);
    expect(isCreditSaleRequested({ isCreditSale: false })).toBe(false);
  });

  it("detects header-level and line-level discounts", () => {
    expect(hasRequestedDiscount({ discountAmount: 5 })).toBe(true);
    expect(hasRequestedDiscount({ items: [{ discountPercent: "10" }] })).toBe(true);
    expect(hasRequestedDiscount({ items: [{ discountPercent: 0 }] })).toBe(false);
  });

  it("returns all capabilities required by a sale submission", () => {
    expect(
      requestedPosSaleCapabilities({
        method: "POST",
        path: "/api/pos/sales",
        body: { isCreditSale: true, discount: 2 },
        hasPriceOverride: true,
      })
    ).toEqual([
      "pos_perm_credit_sale",
      "pos_perm_discount",
      "pos_perm_override_price",
    ]);
  });

  it("does not classify unrelated POS requests", () => {
    expect(
      requestedPosSaleCapabilities({
        method: "GET",
        path: "/api/pos/sales",
        body: { isCreditSale: true },
        hasPriceOverride: true,
      })
    ).toEqual([]);
  });
});
