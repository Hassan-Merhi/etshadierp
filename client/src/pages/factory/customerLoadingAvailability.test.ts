import { describe, expect, it } from "vitest";
import {
  buildAvailableStockMap,
  resolveAvailableStock,
  rewriteCustomerLoadingAllocationRequest,
  shouldIncludeAvailableStock,
} from "./customerLoadingAvailability";

describe("customer loading stock availability", () => {
  it("uses Stock Allocation free-to-promise values including zero and negatives", () => {
    const map = buildAvailableStockMap([
      { articleCode: "HMD-1", freeToPromise: 12 },
      { articleCode: "HMD-2", freeToPromise: 0 },
      { articleCode: "HMD-3", freeToPromise: -4 },
    ]);

    expect(resolveAvailableStock({ code: "legacy", articleCode: "hmd-1" }, map)).toBe(12);
    expect(resolveAvailableStock({ code: "HMD-2", articleCode: null }, map)).toBe(0);
    expect(resolveAvailableStock({ code: "HMD-3", articleCode: null }, map)).toBe(-4);
    expect(resolveAvailableStock({ code: "missing", articleCode: null }, map)).toBeNull();
  });

  it("supports all four zero and negative filter combinations", () => {
    const values = [12, 0, -4, null];
    const apply = (showZeroStock: boolean, showNegativeStock: boolean) =>
      values.filter((value) => shouldIncludeAvailableStock(value, { showZeroStock, showNegativeStock }));

    expect(apply(true, false)).toEqual([12, 0, null]);
    expect(apply(false, false)).toEqual([12, null]);
    expect(apply(true, true)).toEqual([12, 0, -4, null]);
    expect(apply(false, true)).toEqual([12, -4, null]);
  });

  it("keeps missing allocation rows visible instead of hiding products while allocation data is incomplete", () => {
    expect(shouldIncludeAvailableStock(null, { showZeroStock: false, showNegativeStock: false })).toBe(true);
  });

  it("rewrites only Customer Loading's exact allocation GET to the compact availability view", () => {
    expect(
      rewriteCustomerLoadingAllocationRequest(
        "/api/factory/v5/stock-allocation",
        undefined,
        "/factory/customer-loading"
      )
    ).toBe("/api/factory/v5/stock-allocation?view=availability");

    expect(
      rewriteCustomerLoadingAllocationRequest(
        "/api/factory/v5/stock-allocation",
        undefined,
        "/factory/stock-allocation-v5"
      )
    ).toBe("/api/factory/v5/stock-allocation");

    expect(
      rewriteCustomerLoadingAllocationRequest(
        "/api/factory/v5/stock-allocation?page=1",
        undefined,
        "/factory/customer-loading"
      )
    ).toBe("/api/factory/v5/stock-allocation?page=1");

    expect(
      rewriteCustomerLoadingAllocationRequest(
        "/api/factory/v5/stock-allocation",
        { method: "POST" },
        "/factory/customer-loading"
      )
    ).toBe("/api/factory/v5/stock-allocation");
  });
});
