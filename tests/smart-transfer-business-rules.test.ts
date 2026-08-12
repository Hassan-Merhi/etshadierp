import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const queryResults: unknown[][] = [];
  const buildSmartTransferSourceOptimizedPreview = vi.fn();
  const select = vi.fn(() => {
    const result = queryResults.shift() ?? [];
    const builder: {
      innerJoin: () => typeof builder;
      where: () => Promise<unknown[]>;
    } = {
      innerJoin: () => builder,
      where: async () => result,
    };
    return { from: () => builder };
  });
  return { queryResults, buildSmartTransferSourceOptimizedPreview, select };
});

vi.mock("../server/db", () => ({ db: { select: harness.select } }));
vi.mock("@shared/schema", () => ({
  salesItems: {
    stockItemId: "salesItems.stockItemId",
    quantity: "salesItems.quantity",
    voucherId: "salesItems.voucherId",
  },
  stockCategories: { id: "stockCategories.id", name: "stockCategories.name", companyId: "stockCategories.companyId" },
  stockGroups: {
    id: "stockGroups.id",
    name: "stockGroups.name",
    companyId: "stockGroups.companyId",
    deletedAt: "stockGroups.deletedAt",
  },
  vouchers: {
    id: "vouchers.id",
    companyId: "vouchers.companyId",
    voucherType: "vouchers.voucherType",
    optional: "vouchers.optional",
    deletedAt: "vouchers.deletedAt",
    locationId: "vouchers.locationId",
    voucherDate: "vouchers.voucherDate",
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
vi.mock("../server/services/smartTransferSourceOptimization", () => ({
  buildSmartTransferSourceOptimizedPreview: harness.buildSmartTransferSourceOptimizedPreview,
}));

import { buildSmartTransferBusinessRulePreview } from "../server/services/smartTransferBusinessRules";

function sourceLine(overrides: Record<string, unknown>) {
  return {
    stockItemId: 1,
    stockItemName: "Blue Widget",
    sourceLocationId: 11,
    sourceLocationName: "North Warehouse",
    availableAtSource: 40,
    calculatedNeed: 30,
    suggestedQuantity: 20,
    itemSuggestedTotal: 20,
    categoryId: 101,
    stockGroupId: 201,
    forecastDailyRate: 2,
    itemScore: 70,
    urgencyBand: "medium",
    sourceSelectionScore: 80,
    reason: "Forecast-backed transfer.",
    ...overrides,
  };
}

function sourcePreview(lines: unknown[], targetQuantity = 30) {
  return {
    readOnly: true,
    generatedAt: "2026-08-11T00:00:00.000Z",
    companyId: 4,
    destinationLocationId: 23,
    destinationLocationName: "Riverside Shop",
    sourceLocationIds: [11, 12],
    sourceLocationNames: ["North Warehouse", "South Warehouse"],
    targetQuantity,
    achievedQuantity: targetQuantity,
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
    warnings: ["Phase 2 is short by an obsolete amount"],
    summary: "Source optimization complete.",
    forecastingVersion: 1,
    sourceOptimizationVersion: 2,
  };
}

describe("smart transfer business-rule preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.queryResults.splice(0);
  });

  it("balances a real multi-item candidate pool against sales mix, caps, priorities, and source capacity", async () => {
    harness.buildSmartTransferSourceOptimizedPreview.mockResolvedValue(
      sourcePreview([
        sourceLine({}),
        sourceLine({ sourceLocationId: 12, sourceLocationName: "South Warehouse", availableAtSource: 8 }),
        sourceLine({
          stockItemId: 2,
          stockItemName: "Red Widget",
          sourceLocationId: 12,
          sourceLocationName: "South Warehouse",
          availableAtSource: 30,
          calculatedNeed: 25,
          categoryId: 102,
          stockGroupId: 202,
          forecastDailyRate: 1.5,
          itemScore: 65,
          sourceSelectionScore: 75,
        }),
        sourceLine({
          stockItemId: 3,
          stockItemName: "Green Widget",
          availableAtSource: 15,
          calculatedNeed: 12,
          categoryId: null,
          stockGroupId: null,
          forecastDailyRate: 0.5,
          itemScore: 55,
          urgencyBand: "critical",
        }),
      ])
    );
    harness.queryResults.push(
      [
        { stockItemId: 1, quantity: "18" },
        { stockItemId: 1, quantity: "12" },
        { stockItemId: 2, quantity: "10" },
        { stockItemId: 3, quantity: "2" },
      ],
      [
        { id: 101, name: "Core" },
        { id: 102, name: "Seasonal" },
      ],
      [
        { id: 201, name: "Widgets" },
        { id: 202, name: "Accessories" },
      ]
    );

    const result = await buildSmartTransferBusinessRulePreview(4, [11, 12], 23, 30, {
      asOfDate: "2026-08-11",
      maxItemSharePct: 40,
      maxCategorySharePct: 60,
      maxStockGroupSharePct: 60,
      minItemQuantity: 2,
      priorityCategoryIds: [102, 102, -1],
      priorityStockGroupIds: [202],
    });

    expect(result.businessRulesVersion).toBe(3);
    expect(result.achievedQuantity).toBe(30);
    expect(result.lines.reduce((sum, line) => sum + line.suggestedQuantity, 0)).toBe(30);
    expect(result.lines.find((line) => line.stockItemId === 2)).toMatchObject({
      categoryName: "Seasonal",
      stockGroupName: "Accessories",
    });
    expect(result.lines.find((line) => line.stockItemId === 3)).toMatchObject({
      categoryName: "Unassigned category",
      stockGroupName: "Unassigned stock group",
    });
    expect(result.businessRules.priorityCategoryIds).toEqual([102]);
    expect(result.businessRulesApplied).toEqual(
      expect.arrayContaining(["Priority-category boosts applied", "Priority stock-group boosts applied"])
    );
    expect(result.categoryMix.reduce((sum, row) => sum + row.quantity, 0)).toBe(30);
    expect(result.totalsBySource.reduce((sum, row) => sum + row.suggestedQuantity, 0)).toBe(30);
    expect(result.warnings).not.toContain("Phase 2 is short by an obsolete amount");
  });

  it("returns normalized rules without querying sales when there is no eligible quantity", async () => {
    harness.buildSmartTransferSourceOptimizedPreview.mockResolvedValue(sourcePreview([], 0));

    const result = await buildSmartTransferBusinessRulePreview(4, [11], 23, 0, {
      maxItemSharePct: 2,
      maxCategorySharePct: 120,
      preserveDestinationMix: false,
    });

    expect(result.lines).toEqual([]);
    expect(result.businessRules).toMatchObject({
      maxItemSharePct: 5,
      maxCategorySharePct: 100,
      preserveDestinationMix: false,
    });
    expect(harness.select).not.toHaveBeenCalled();
  });
});
