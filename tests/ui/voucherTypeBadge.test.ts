/**
 * Unit tests for client/src/lib/voucherTypeBadge.ts — maps a voucher type to
 * its badge style. Guards the known voucher taxonomy (Sales/Purchase/Payment/…)
 * and the safe fallback for unrecognised types.
 */
import { getVoucherTypeBadge } from "@/lib/voucherTypeBadge";

describe("getVoucherTypeBadge", () => {
  it("returns distinct, coloured styles for the core voucher types", () => {
    expect(getVoucherTypeBadge("Sales").className).toContain("blue");
    expect(getVoucherTypeBadge("Purchase").className).toContain("violet");
    expect(getVoucherTypeBadge("Payment").className).toContain("red");
    expect(getVoucherTypeBadge("Receipt").className).toContain("green");
    expect(getVoucherTypeBadge("Journal").className).toContain("slate");
  });

  it("treats both 'Stock Transfer' and 'StockTransfer' aliases as teal", () => {
    expect(getVoucherTypeBadge("Stock Transfer").className).toContain("teal");
    expect(getVoucherTypeBadge("StockTransfer").className).toContain("teal");
  });

  it("uses the 'outline' variant for known types", () => {
    expect(getVoucherTypeBadge("Sales").variant).toBe("outline");
  });

  it("falls back to a bare outline badge (no className) for unknown types", () => {
    const badge = getVoucherTypeBadge("Totally Unknown");
    expect(badge).toEqual({ variant: "outline" });
    expect(badge.className).toBeUndefined();
  });

  it("is case-sensitive — a lowercased known type falls back", () => {
    expect(getVoucherTypeBadge("sales")).toEqual({ variant: "outline" });
  });
});
