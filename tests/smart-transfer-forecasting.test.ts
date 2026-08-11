import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const queryResults: unknown[][] = [];
  const buildSmartTransferPreview = vi.fn();
  const loadOtwStockByItem = vi.fn();
  const select = vi.fn(() => {
    const result = queryResults.shift() ?? [];
    const builder: { innerJoin: () => typeof builder; where: () => Promise<unknown[]> } = {
      innerJoin: () => builder,
      where: async () => result,
    };
    return { from: () => builder };
  });
  return { queryResults, buildSmartTransferPreview, loadOtwStockByItem, select };
});

vi.mock("../server/db", () => ({ db: { select: harness.select } }));
vi.mock("@shared/schema", () => ({
  inventory: {
    stockItemId: "inventory.stockItemId",
    locationId: "inventory.locationId",
    quantity: "inventory.quantity",
    averageRate: "inventory.averageRate",
    companyId: "inventory.companyId",
  },
  salesItems: {
    stockItemId: "salesItems.stockItemId",
    voucherId: "salesItems.voucherId",
    quantity: "salesItems.quantity",
  },
  vouchers: {
    id: "vouchers.id",
    voucherDate: "vouchers.voucherDate",
    companyId: "vouchers.companyId",
    voucherType: "vouchers.voucherType",
    optional: "vouchers.optional",
    deletedAt: "vouchers.deletedAt",
    locationId: "vouchers.locationId",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  gte: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, value: null }),
  lte: (column: unknown, value: unknown) => ({ column, value }),
}));
vi.mock("../server/services/smartTransferAllocation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/smartTransferAllocation")>();
  return { ...actual, buildSmartTransferPreview: harness.buildSmartTransferPreview };
});
vi.mock("../server/services/stockTransferAnalysis", () => ({
  loadOtwStockByItem: harness.loadOtwStockByItem,
}));

import { buildSmartTransferForecastPreview } from "../server/services/smartTransferForecasting";

function previewLine(overrides: Record<string, unknown>) {
  return {
    stockItemId: 1,
    stockItemName: "Blue Widget",
    stockItemCode: "BLUE",
    uom: "pcs",
    stockGroupId: 201,
    categoryId: 101,
    sourceLocationId: 11,
    sourceLocationName: "North Warehouse",
    availableAtSource: 30,
    sourceCurrentStock: 30,
    sourceReserveQty: 0,
    sourceAverageRate: 12.5,
    destinationStock: 2,
    otwQty: 0,
    effectiveDestinationStock: 2,
    olderTransferQty: 20,
    newerTransferQty: 15,
    salesAfterOlderTransfer: 18,
    salesAfterNewerTransfer: 14,
    totalSalesSinceOlderTransfer: 32,
    olderSellThroughPercentage: 90,
    newerSellThroughPercentage: 93,
    overallSellThroughPercentage: 92,
    averageSalesPerDay: 1.2,
    latestSalesPerDay: 1.8,
    estimatedDaysOfStockRemaining: 2,
    classification: "strong_seller",
    classificationLabel: "Strong seller",
    suggestedQuantity: 15,
    itemSuggestedTotal: 15,
    calculatedNeed: 20,
    confidence: 0.8,
    reason: "Historical demand.",
    ...overrides,
  };
}

function basePreview(lines: unknown[]) {
  return {
    readOnly: true,
    generatedAt: "2026-08-11T00:00:00.000Z",
    companyId: 4,
    destinationLocationId: 23,
    destinationLocationName: "Riverside Shop",
    sourceLocationIds: [11, 12],
    sourceLocationNames: ["North Warehouse", "South Warehouse"],
    targetQuantity: 45,
    achievedQuantity: 45,
    shortfallQuantity: 0,
    shortfall: false,
    includeOtw: true,
    targetCoverageDays: 30,
    stockGroupIds: [],
    categoryIds: [],
    lines,
    excludedItems: [],
    totalsBySource: [],
    history: {},
    warnings: ["Existing preview is short by 1 suitable calculated demand"],
    summary: "Historical preview complete.",
  };
}

describe("smart transfer demand forecasting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.queryResults.splice(0);
  });

  it("re-ranks multi-item demand using sales windows, source reserves, stockout timing, and OTW reliability", async () => {
    harness.buildSmartTransferPreview.mockResolvedValue(
      basePreview([
        previewLine({}),
        previewLine({
          stockItemId: 2,
          stockItemName: "Red Widget",
          stockItemCode: "RED",
          sourceLocationId: 12,
          sourceLocationName: "South Warehouse",
          destinationStock: 8,
          classification: "good_seller",
          classificationLabel: "Good seller",
          overallSellThroughPercentage: 75,
          averageSalesPerDay: 0.7,
          latestSalesPerDay: 0.9,
        }),
        previewLine({
          stockItemId: 3,
          stockItemName: "Green Widget",
          stockItemCode: "GREEN",
          destinationStock: 1,
          classification: "normal_seller",
          classificationLabel: "Normal seller",
          overallSellThroughPercentage: 55,
          averageSalesPerDay: 0.1,
          latestSalesPerDay: 0.1,
        }),
      ])
    );
    harness.queryResults.push(
      [
        { stockItemId: 1, voucherDate: "2026-08-10", quantity: "8" },
        { stockItemId: 1, voucherDate: "2026-07-25", quantity: "12" },
        { stockItemId: 1, voucherDate: "2026-06-01", quantity: "10" },
        { stockItemId: 2, voucherDate: "2026-08-09", quantity: "2" },
        { stockItemId: 2, voucherDate: "2026-07-20", quantity: "12" },
        { stockItemId: 3, voucherDate: "2026-05-20", quantity: "1" },
      ],
      [
        { stockItemId: 1, locationId: 11, quantity: "50", averageRate: "12.5" },
        { stockItemId: 1, locationId: 12, quantity: "20", averageRate: "13" },
        { stockItemId: 2, locationId: 12, quantity: "40", averageRate: "7.25" },
        { stockItemId: 3, locationId: 11, quantity: "10", averageRate: "4" },
      ],
      [
        { stockItemId: 1, locationId: 11, quantity: "6" },
        { stockItemId: 1, locationId: 12, quantity: "1" },
        { stockItemId: 2, locationId: 12, quantity: "4" },
      ]
    );
    harness.loadOtwStockByItem.mockResolvedValue({
      otwQtyByItem: new Map([
        [1, 15],
        [2, 10],
      ]),
      otwDetailsByItem: new Map([
        [
          1,
          [
            { quantity: "10", matchType: "exact", eta: "2026-08-13", trackingStatus: "At sea" },
            { quantity: "5", matchType: "unknown", eta: "2026-07-30", trackingStatus: "Unknown" },
          ],
        ],
        [2, [{ quantity: "10", matchType: "exact", eta: "2026-08-09", trackingStatus: "Arrived" }]],
      ]),
    });

    const result = await buildSmartTransferForecastPreview(4, [11, 12], 23, 35, {
      asOfDate: "2026-08-11",
      includeOtw: true,
    });

    expect(result.forecastingVersion).toBe(1);
    expect(result.targetQuantity).toBe(35);
    expect(result.lines.reduce((sum, line) => sum + line.suggestedQuantity, 0)).toBe(result.achievedQuantity);
    expect(result.lines[0]).toMatchObject({
      forecastSales7Days: expect.any(Number),
      forecastSales30Days: expect.any(Number),
      forecastSales90Days: expect.any(Number),
      itemScore: expect.any(Number),
      scoreBreakdown: expect.objectContaining({ stockoutUrgency: expect.any(Number) }),
    });
    expect(result.lines.some((line) => line.weightedOtwQty > 0)).toBe(true);
    expect(result.totalsBySource.reduce((sum, row) => sum + row.suggestedQuantity, 0)).toBe(result.achievedQuantity);
    expect(result.warnings).not.toContain("Existing preview is short by 1 suitable calculated demand");
    expect(result.warnings.some((warning) => warning.includes("OTW quantities discounted"))).toBe(true);
  });

  it("preserves an explicit target when the base preview has no candidates", async () => {
    harness.buildSmartTransferPreview.mockResolvedValue(basePreview([]));

    const result = await buildSmartTransferForecastPreview(4, [11], 23, 12, {});

    expect(result).toMatchObject({
      forecastingVersion: 1,
      targetQuantity: 12,
      achievedQuantity: 0,
      shortfallQuantity: 12,
      shortfall: true,
      lines: [],
    });
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("auto-sizes a low-history forecast without loading OTW when it is disabled", async () => {
    harness.buildSmartTransferPreview.mockResolvedValue(
      basePreview([
        previewLine({
          totalSalesSinceOlderTransfer: 2,
          olderSellThroughPercentage: 20,
          newerSellThroughPercentage: 10,
          overallSellThroughPercentage: 15,
          classification: "slow_seller",
          classificationLabel: "Slow seller",
          latestSalesPerDay: 0.4,
          averageSalesPerDay: 0.2,
        }),
      ])
    );
    harness.queryResults.push(
      [{ stockItemId: 1, voucherDate: "2026-08-10", quantity: "2" }],
      [{ stockItemId: 1, locationId: 11, quantity: "6", averageRate: "12.5" }],
      []
    );

    const result = await buildSmartTransferForecastPreview(4, [11], 23, 0, {
      asOfDate: "2026-08-11",
      includeOtw: false,
    });

    expect(result.targetQuantity).toBeGreaterThan(0);
    expect(result.lines[0]).toMatchObject({ forecastSales90Days: 2, weightedOtwQty: 0 });
    expect(result.warnings.some((warning) => warning.includes("limited 90-day sales history"))).toBe(true);
    expect(harness.loadOtwStockByItem).not.toHaveBeenCalled();
  });
});
