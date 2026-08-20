import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { shouldInsertAdjustmentVoucherEntry } from "../server/storage/stock-ops/adjustmentVoucherEntryGuard";

describe("stock adjustment zero-value accounting guard", () => {
  it("treats Decimal zero as non-postable even though Decimal.isPositive considers +0 positive", () => {
    const zero = new Decimal(0);

    expect(zero.isPositive()).toBe(true);
    expect(shouldInsertAdjustmentVoucherEntry(zero, 123)).toBe(false);
  });

  it("allows only strictly positive totals with a resolved ledger account", () => {
    expect(shouldInsertAdjustmentVoucherEntry(new Decimal("0.000001"), 123)).toBe(true);
    expect(shouldInsertAdjustmentVoucherEntry(new Decimal(10), null)).toBe(false);
    expect(shouldInsertAdjustmentVoucherEntry(new Decimal(-1), 123)).toBe(false);
  });
});
