import { describe, expect, it } from "vitest";
import {
  calculateDaysToSellThrough,
  calculateSellThroughPercentage,
  calendarDaysInclusive,
  classifyTransferPerformance,
} from "../server/services/smartTransferPerformance";

describe("smart transfer performance calculations", () => {
  it("calculates sell-through without exceeding 100 percent", () => {
    expect(calculateSellThroughPercentage(8, 10)).toBe(80);
    expect(calculateSellThroughPercentage(14, 10)).toBe(100);
    expect(calculateSellThroughPercentage(4, 0)).toBe(0);
  });

  it("counts calendar days inclusively", () => {
    expect(calendarDaysInclusive("2026-07-01", "2026-07-01")).toBe(1);
    expect(calendarDaysInclusive("2026-07-01", "2026-07-10")).toBe(10);
  });

  it("finds how many days it took cumulative sales to cover a transfer", () => {
    expect(
      calculateDaysToSellThrough(
        [
          { voucherDate: "2026-07-02", quantity: 3 },
          { voucherDate: "2026-07-04", quantity: 4 },
          { voucherDate: "2026-07-06", quantity: 5 },
        ],
        10,
        "2026-07-01"
      )
    ).toBe(6);
  });

  it("returns null when the transfer has not sold through", () => {
    expect(
      calculateDaysToSellThrough(
        [
          { voucherDate: "2026-07-02", quantity: 2 },
          { voucherDate: "2026-07-03", quantity: 1 },
        ],
        10,
        "2026-07-01"
      )
    ).toBeNull();
  });

  it("classifies high repeat sell-through as a strong seller", () => {
    expect(
      classifyTransferPerformance({
        olderTransferQty: 20,
        newerTransferQty: 30,
        salesAfterOlderTransfer: 19,
        salesAfterNewerTransfer: 27,
        currentDestinationQty: 2,
        latestWindowDays: 14,
      })
    ).toBe("strong_seller");
  });

  it("classifies unsold stock remaining at destination as overstocked", () => {
    expect(
      classifyTransferPerformance({
        olderTransferQty: 20,
        newerTransferQty: 20,
        salesAfterOlderTransfer: 0,
        salesAfterNewerTransfer: 0,
        currentDestinationQty: 38,
        latestWindowDays: 30,
      })
    ).toBe("overstocked");
  });

  it("classifies no sales and no remaining stock as no recent sales", () => {
    expect(
      classifyTransferPerformance({
        olderTransferQty: 0,
        newerTransferQty: 0,
        salesAfterOlderTransfer: 0,
        salesAfterNewerTransfer: 0,
        currentDestinationQty: 0,
        latestWindowDays: 10,
      })
    ).toBe("no_recent_sales");
  });
});
