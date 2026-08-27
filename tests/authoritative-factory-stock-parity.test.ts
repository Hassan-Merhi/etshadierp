import { describe, expect, it } from "vitest";
import {
  buildArticleCodeStockCountRecord,
  buildAuthoritativeStockSnapshot,
  patchInventoryStockRows,
  patchVerificationSummaryStock,
} from "../server/services/factory/authoritativeStockPatch";

describe("authoritative factory stock parity", () => {
  const snapshot = buildAuthoritativeStockSnapshot([
    {
      productId: 8,
      articleCode: "HMD16008",
      baleCount: 1,
      totalWeight: 183.5,
    },
    {
      productId: 7,
      articleCode: "HMD16007",
      baleCount: 2,
      totalWeight: 348.6,
    },
    {
      productId: 12,
      articleCode: "HMD16012",
      baleCount: 5,
      totalWeight: 767.55,
    },
    {
      productId: 13,
      articleCode: "HMD16013",
      baleCount: 9,
      totalWeight: 1459.35,
    },
  ]);

  it("replaces gross in-stock totals with bales that are actually available", () => {
    const patched = patchInventoryStockRows(
      [
        {
          productId: 8,
          articleCode: "HMD16008",
          productName: "T-JEANS",
          baleCount: 6,
          loadingCount: 5,
          quantity: 6,
          totalWeight: 1101,
          totalCost: 0,
          productionPrice: 0,
        },
        {
          productId: 7,
          articleCode: "HMD16007",
          productName: "T-GARBAGE",
          baleCount: 20,
          loadingCount: 18,
          quantity: 20,
          totalWeight: 3486,
          totalCost: 0,
          productionPrice: 0,
        },
      ],
      snapshot
    ) as Array<Record<string, number>>;

    expect(patched[0].baleCount).toBe(1);
    expect(patched[0].loadingCount).toBe(0);
    expect(patched[0].quantity).toBe(1);
    expect(patched[0].totalWeight).toBeCloseTo(183.5, 6);

    expect(patched[1].baleCount).toBe(2);
    expect(patched[1].loadingCount).toBe(0);
    expect(patched[1].quantity).toBe(2);
    expect(patched[1].totalWeight).toBeCloseTo(348.6, 6);
  });

  it("makes verification stock match the same physical stock-in-hand snapshot", () => {
    const patched = patchVerificationSummaryStock(
      {
        proformaLines: [
          { articleCode: "HMD16008", stockQty: 5 },
          { articleCode: "HMD16013", stockQty: 21 },
        ],
        loadedItems: [
          { articleCode: "HMD16008", stockQty: 5 },
          { articleCode: "HMD16012", stockQty: 38 },
        ],
        comparison: [
          { articleCode: "HMD16008", stockQty: 5, stockTotalWeight: 1101 },
          { articleCode: "HMD16013", stockQty: 21, stockTotalWeight: 11675 },
        ],
      },
      snapshot
    ) as {
      proformaLines: Array<{ articleCode: string; stockQty: number }>;
      loadedItems: Array<{ articleCode: string; stockQty: number }>;
      comparison: Array<{ articleCode: string; stockQty: number; stockTotalWeight: number }>;
    };

    expect(patched.proformaLines).toEqual([
      { articleCode: "HMD16008", stockQty: 1 },
      { articleCode: "HMD16013", stockQty: 9 },
    ]);
    expect(patched.loadedItems).toEqual([
      { articleCode: "HMD16008", stockQty: 1 },
      { articleCode: "HMD16012", stockQty: 5 },
    ]);
    expect(patched.comparison[0].stockQty).toBe(1);
    expect(patched.comparison[0].stockTotalWeight).toBeCloseTo(183.5, 6);
    expect(patched.comparison[1].stockQty).toBe(9);
    expect(patched.comparison[1].stockTotalWeight).toBeCloseTo(1459.35, 6);
  });

  it("feeds the loading scan Stock column from the same stock-in-hand snapshot", () => {
    const counts = buildArticleCodeStockCountRecord(
      ["HMD16007", "HMD16008", "HMD16012", "HMD16013", "HMD16020"],
      snapshot
    );

    expect(counts).toEqual({
      HMD16007: 2,
      HMD16008: 1,
      HMD16012: 5,
      HMD16013: 9,
      HMD16020: 0,
    });
  });

  it("falls back to article code when a product id is unavailable", () => {
    const patched = patchVerificationSummaryStock(
      {
        loadedItems: [{ articleCode: " hmd16007 ", stockQty: 29 }],
        proformaLines: [],
        comparison: [],
      },
      snapshot
    ) as { loadedItems: Array<{ stockQty: number }> };

    expect(patched.loadedItems[0].stockQty).toBe(2);
  });

  it("includes historical article-only bales alongside product-linked bales", () => {
    const mixedSnapshot = buildAuthoritativeStockSnapshot([
      {
        productId: 8,
        articleCode: "HMD16008",
        baleCount: 1,
        totalWeight: 183.5,
      },
      {
        productId: null,
        articleCode: "HMD16008",
        baleCount: 2,
        totalWeight: 360.25,
      },
    ]);

    const patched = patchInventoryStockRows(
      [
        {
          productId: 8,
          articleCode: "HMD16008",
          baleCount: 1,
          totalWeight: 183.5,
        },
      ],
      mixedSnapshot
    ) as Array<{ baleCount: number; totalWeight: number }>;

    expect(patched[0].baleCount).toBe(3);
    expect(patched[0].totalWeight).toBeCloseTo(543.75, 6);
    expect(buildArticleCodeStockCountRecord(["HMD16008"], mixedSnapshot)).toEqual({ HMD16008: 3 });
  });
});
