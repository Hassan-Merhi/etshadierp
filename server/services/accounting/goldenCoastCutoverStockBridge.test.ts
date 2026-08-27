import { describe, expect, it } from "vitest";

import {
  GOLDEN_COAST_CUTOVER_STOCK_SOURCE,
  GoldenCoastCutoverStockBridgeError,
  assertGoldenCoastStockValueReconciles,
  planGoldenCoastCutoverStockBridge,
} from "./goldenCoastCutoverStockBridge";

const rows = [
  {
    locationId: 10,
    stockItemId: 101,
    stockItemCode: "GC-A",
    stockItemName: "Golden Coast A",
    quantity: "20",
    averageRate: "12.50",
    totalValue: "250.00",
  },
  {
    locationId: 11,
    stockItemId: 102,
    stockItemCode: "GC-B",
    stockItemName: "Golden Coast B",
    quantity: "5.5000",
    averageRate: "20",
    totalValue: "110.00",
  },
] as const;

describe("Golden Coast cutover stock bridge", () => {
  it("mirrors positive legacy ERP inventory into location-scoped opening FIFO lots", () => {
    const plan = planGoldenCoastCutoverStockBridge(rows);

    expect(plan.cutoverDate).toBe("2026-09-01");
    expect(plan.sourceType).toBe(GOLDEN_COAST_CUTOVER_STOCK_SOURCE);
    expect(plan.lots).toHaveLength(2);
    expect(plan.totalQuantity).toBe("25.5000");
    expect(plan.totalValueUsd).toBe("360.00");
    expect(plan.lots[0]).toMatchObject({
      locationId: 10,
      stockItemId: 101,
      articleCode: "GC-A",
      qtyIn: "20.0000",
      qtyRemaining: "20.0000",
      baseUnitCostUsd: "12.500000",
      landedUnitCostUsd: "0.000000",
      finalUnitCostUsd: "12.500000",
    });
  });

  it("does not invent FIFO lots for zero legacy stock", () => {
    const plan = planGoldenCoastCutoverStockBridge([
      ...rows,
      {
        locationId: 12,
        stockItemId: 103,
        stockItemCode: "GC-ZERO",
        quantity: "0",
        averageRate: "0",
        totalValue: "0",
      },
    ]);
    expect(plan.lots).toHaveLength(2);
    expect(plan.lots.some((lot) => lot.stockItemId === 103)).toBe(false);
  });

  it("requires a positive average cost for every positive opening quantity", () => {
    expect(() =>
      planGoldenCoastCutoverStockBridge([
        { locationId: 1, stockItemId: 2, stockItemCode: "BAD", quantity: "1", averageRate: "0", totalValue: "0" },
      ])
    ).toThrow(/must have a positive average rate/);
  });

  it("rejects duplicate item/location rows so the bridge cannot create duplicate opening lots", () => {
    expect(() => planGoldenCoastCutoverStockBridge([rows[0], rows[0]])).toThrow(/Duplicate legacy inventory row/);
  });

  it("rejects legacy value drift beyond the accounting tolerance", () => {
    expect(() =>
      planGoldenCoastCutoverStockBridge([
        { ...rows[0], totalValue: "249.90" },
      ])
    ).toThrow(GoldenCoastCutoverStockBridgeError);
  });

  it("accepts harmless cent-level storage rounding", () => {
    const plan = planGoldenCoastCutoverStockBridge([
      { locationId: 1, stockItemId: 2, stockItemCode: "ROUND", quantity: "3", averageRate: "1.333333", totalValue: "4.00" },
    ]);
    expect(plan.totalValueUsd).toBe("4.00");
  });

  it("reconciles opening FIFO value to the Phase 3 Stock in Hand opening balance", () => {
    const plan = planGoldenCoastCutoverStockBridge(rows);
    expect(() => assertGoldenCoastStockValueReconciles(plan.totalValueUsd, "360.00")).not.toThrow();
    expect(() => assertGoldenCoastStockValueReconciles(plan.totalValueUsd, "360.03")).toThrow(
      /does not reconcile to Phase 3 Stock in Hand/
    );
  });

  it("keeps item/location identity independent across companies by requiring the route to supply one company snapshot", () => {
    const plan = planGoldenCoastCutoverStockBridge([
      { locationId: 1, stockItemId: 1, stockItemCode: "A", quantity: "2", averageRate: "3", totalValue: "6" },
      { locationId: 2, stockItemId: 1, stockItemCode: "A", quantity: "4", averageRate: "3", totalValue: "12" },
    ]);
    expect(plan.lots.map((lot) => `${lot.locationId}:${lot.stockItemId}`)).toEqual(["1:1", "2:1"]);
    expect(plan.totalValueUsd).toBe("18.00");
  });
});
