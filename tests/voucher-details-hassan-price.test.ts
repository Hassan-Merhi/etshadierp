import { describe, expect, it } from "vitest";
import { calculateHassanPriceMetrics } from "../server/routes/voucher-entries/hassan-price";

describe("Voucher Details Hassan price metrics", () => {
  it.each([
    { name: "RV CCR CR", sold: 440, hassan: 450, qty: 1, profit: -10, percentage: -2.2 },
    { name: "RV CCR II", sold: 230, hassan: 235, qty: 16, profit: -80, percentage: -2.1 },
    { name: "RV CCR III", sold: 135, hassan: 135, qty: 1, profit: 0, percentage: 0 },
    { name: "RV CCR MD II", sold: 130, hassan: 130, qty: 1, profit: 0, percentage: 0 },
  ])("calculates $name from the Price List selling price", ({ sold, hassan, qty, profit, percentage }) => {
    const result = calculateHassanPriceMetrics(sold, hassan, qty);

    expect(result).not.toBeNull();
    expect(result?.price).toBe(hassan);
    expect(result?.profit).toBeCloseTo(profit, 8);
    expect(result?.percentage).toBeCloseTo(percentage, 1);
  });

  it("returns null only when there is no positive Price List selling price", () => {
    expect(calculateHassanPriceMetrics(100, null, 1)).toBeNull();
    expect(calculateHassanPriceMetrics(100, 0, 1)).toBeNull();
  });
});
