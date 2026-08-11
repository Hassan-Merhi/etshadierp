import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const queryResults: unknown[][] = [];
  const buildSmartTransferForecastPreview = vi.fn();
  const select = vi.fn(() => {
    const result = queryResults.shift() ?? [];
    const builder: { innerJoin: () => typeof builder; where: () => Promise<unknown[]> } = {
      innerJoin: () => builder,
      where: async () => result,
    };
    return { from: () => builder };
  });
  return { queryResults, buildSmartTransferForecastPreview, select };
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
  stockTransferItems: {
    stockItemId: "stockTransferItems.stockItemId",
    sourceLocationId: "stockTransferItems.sourceLocationId",
    transferId: "stockTransferItems.transferId",
    quantity: "stockTransferItems.quantity",
  },
  stockTransferVouchers: {
    id: "stockTransferVouchers.id",
    voucherId: "stockTransferVouchers.voucherId",
    sourceLocationId: "stockTransferVouchers.sourceLocationId",
    inventoryApplied: "stockTransferVouchers.inventoryApplied",
    destinationLocationId: "stockTransferVouchers.destinationLocationId",
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));
vi.mock("../server/services/smartTransferForecasting", () => ({
  buildSmartTransferForecastPreview: harness.buildSmartTransferForecastPreview,
}));

import { buildSmartTransferSourceOptimizedPreview } from "../server/services/smartTransferSourceOptimization";

function forecastLine(overrides: Record<string, unknown>) {
  return {
    stockItemId: 1,
    stockItemName: "Blue Widget",
    sourceLocationId: 11,
    sourceLocationName: "North Warehouse",
    suggestedQuantity: 12,
    itemSuggestedTotal: 20,
    itemScore: 80,
    forecastDailyRate: 2,
    reason: "Forecast decision.",
    ...overrides,
  };
}

function forecastPreview(lines: unknown[]) {
  return {
    readOnly: true,
    generatedAt: "2026-08-11T00:00:00.000Z",
    companyId: 4,
    destinationLocationId: 23,
    destinationLocationName: "Riverside Shop",
    sourceLocationIds: [11, 12],
    sourceLocationNames: ["North Warehouse", "South Warehouse"],
    targetQuantity: 30,
    achievedQuantity: 30,
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
    warnings: ["source stock after reserve was insufficient in the old preview"],
    summary: "Forecast complete.",
    forecastingVersion: 1,
  };
}

describe("smart transfer source optimization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.queryResults.splice(0);
  });

  it("protects dynamic reserves and pending commitments while preferring a whole-item source with route history", async () => {
    harness.buildSmartTransferForecastPreview.mockResolvedValue(
      forecastPreview([
        forecastLine({ sourceLocationId: 11, suggestedQuantity: 12 }),
        forecastLine({ sourceLocationId: 12, sourceLocationName: "South Warehouse", suggestedQuantity: 8 }),
        forecastLine({
          stockItemId: 2,
          stockItemName: "Red Widget",
          sourceLocationId: 12,
          sourceLocationName: "South Warehouse",
          suggestedQuantity: 10,
          itemSuggestedTotal: 10,
          itemScore: 70,
          forecastDailyRate: 1,
        }),
      ])
    );
    harness.queryResults.push(
      [
        { stockItemId: 1, locationId: 11, quantity: "50", averageRate: "12.5" },
        { stockItemId: 1, locationId: 12, quantity: "24", averageRate: "13" },
        { stockItemId: 2, locationId: 12, quantity: "30", averageRate: "7" },
      ],
      [
        { stockItemId: 1, locationId: 11, voucherDate: "2026-08-10", quantity: "2" },
        { stockItemId: 1, locationId: 11, voucherDate: "2026-07-20", quantity: "5" },
        { stockItemId: 1, locationId: 12, voucherDate: "2026-08-09", quantity: "8" },
        { stockItemId: 2, locationId: 12, voucherDate: "2026-06-20", quantity: "1" },
      ],
      [
        { stockItemId: 1, sourceLocationId: 11, quantity: "4" },
        { stockItemId: 2, sourceLocationId: 12, quantity: "2" },
      ],
      [
        { stockItemId: 1, sourceLocationId: 11, quantity: "18", transferId: 501 },
        { stockItemId: 1, sourceLocationId: 11, quantity: "4", transferId: 502 },
        { stockItemId: 2, sourceLocationId: 12, quantity: "8", transferId: 503 },
      ]
    );

    const result = await buildSmartTransferSourceOptimizedPreview(4, [11, 12], 23, 30, {
      asOfDate: "2026-08-11",
    });

    expect(result.sourceOptimizationVersion).toBe(2);
    expect(result.achievedQuantity).toBe(30);
    expect(result.lines.reduce((sum, line) => sum + line.suggestedQuantity, 0)).toBe(30);
    expect(result.lines.find((line) => line.stockItemId === 1)).toMatchObject({
      sourcePendingCommitmentQty: 4,
      sourceHistoricalRouteCount: 2,
      sourceCanCoverWholeItem: true,
      sourceRank: 1,
    });
    expect(result.lines.every((line) => line.sourceSelectionReason.includes("source score"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("unposted committed unit"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("unnecessary source split"))).toBe(true);
    expect(result.warnings).not.toContain("source stock after reserve was insufficient in the old preview");
  });

  it("keeps an empty forecast read-only without database work", async () => {
    harness.buildSmartTransferForecastPreview.mockResolvedValue(forecastPreview([]));

    const result = await buildSmartTransferSourceOptimizedPreview(4, [11], 23, 0, {});

    expect(result).toMatchObject({ sourceOptimizationVersion: 2, lines: [] });
    expect(harness.select).not.toHaveBeenCalled();
  });
});
