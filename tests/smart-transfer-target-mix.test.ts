import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ buildSmartTransferBusinessRulePreview: vi.fn() }));

vi.mock("../server/services/smartTransferBusinessRules", () => ({
  buildSmartTransferBusinessRulePreview: harness.buildSmartTransferBusinessRulePreview,
}));

import { buildSmartTransferTargetBalancedPreview } from "../server/services/smartTransferTargetMix";

function line(overrides: Record<string, unknown>) {
  return {
    stockItemId: 1,
    stockItemName: "Blue Widget",
    sourceLocationId: 11,
    sourceLocationName: "North Warehouse",
    suggestedQuantity: 30,
    categoryId: 101,
    stockGroupId: 201,
    businessPriorityScore: 80,
    itemScore: 75,
    sourceSelectionScore: 90,
    forecastDailyRate: 2,
    mixAdjustmentReason: "Original balance.",
    reason: "Original source decision.",
    ...overrides,
  };
}

function fullPreview(lines: unknown[], achievedQuantity = 60) {
  return {
    readOnly: true,
    generatedAt: "2026-08-11T00:00:00.000Z",
    companyId: 4,
    destinationLocationId: 23,
    destinationLocationName: "Riverside Shop",
    sourceLocationIds: [11, 12],
    sourceLocationNames: ["North Warehouse", "South Warehouse"],
    targetQuantity: achievedQuantity,
    achievedQuantity,
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
    warnings: [],
    summary: "Full business-rule pool.",
    forecastingVersion: 1,
    sourceOptimizationVersion: 2,
    businessRulesVersion: 3,
    businessRules: {
      maxItemSharePct: 50,
      maxCategorySharePct: 70,
      maxStockGroupSharePct: 70,
      minItemQuantity: 1,
      preserveDestinationMix: true,
      priorityCategoryIds: [],
      priorityStockGroupIds: [],
    },
    businessRulesApplied: [],
    categoryMix: [
      {
        id: 101,
        name: "Core",
        targetSharePct: 60,
        finalSharePct: 60,
        quantity: 36,
        historicalSalesQty: 40,
        capped: false,
        priority: false,
      },
      {
        id: 102,
        name: "Seasonal",
        targetSharePct: 40,
        finalSharePct: 40,
        quantity: 24,
        historicalSalesQty: 20,
        capped: false,
        priority: false,
      },
    ],
    stockGroupMix: [
      {
        id: 201,
        name: "Widgets",
        targetSharePct: 60,
        finalSharePct: 60,
        quantity: 36,
        historicalSalesQty: 40,
        capped: false,
        priority: false,
      },
      {
        id: 202,
        name: "Accessories",
        targetSharePct: 40,
        finalSharePct: 40,
        quantity: 24,
        historicalSalesQty: 20,
        capped: false,
        priority: false,
      },
    ],
  };
}

describe("smart transfer manual target balancing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rebalances a smaller manual target across the complete demand pool and existing sources", async () => {
    harness.buildSmartTransferBusinessRulePreview.mockResolvedValue(
      fullPreview([
        line({ suggestedQuantity: 20 }),
        line({ sourceLocationId: 12, sourceLocationName: "South Warehouse", suggestedQuantity: 10 }),
        line({
          stockItemId: 2,
          stockItemName: "Red Widget",
          sourceLocationId: 12,
          sourceLocationName: "South Warehouse",
          suggestedQuantity: 30,
          categoryId: 102,
          stockGroupId: 202,
          businessPriorityScore: 70,
          itemScore: 65,
          sourceSelectionScore: 75,
          forecastDailyRate: 1.5,
        }),
      ])
    );

    const result = await buildSmartTransferTargetBalancedPreview(4, [11, 12], 23, 20, {});

    expect(result.targetQuantity).toBe(20);
    expect(result.achievedQuantity).toBe(20);
    expect(result.lines.reduce((sum, item) => sum + item.suggestedQuantity, 0)).toBe(20);
    expect(result.lines.every((item) => item.reason.includes("Manual target adjustment"))).toBe(true);
    expect(result.categoryMix.reduce((sum, row) => sum + row.quantity, 0)).toBe(20);
    expect(result.totalsBySource.reduce((sum, row) => sum + row.suggestedQuantity, 0)).toBe(20);
  });

  it("reports rather than inventing demand when a manual target exceeds the full pool", async () => {
    harness.buildSmartTransferBusinessRulePreview.mockResolvedValue(fullPreview([line({})], 30));

    const result = await buildSmartTransferTargetBalancedPreview(4, [11], 23, 45, {});

    expect(result).toMatchObject({
      targetQuantity: 45,
      achievedQuantity: 30,
      shortfallQuantity: 15,
      shortfall: true,
    });
    expect(result.warnings.at(-1)).toContain("did not invent extra demand");
  });

  it("preserves automatic-target behavior unchanged", async () => {
    const full = fullPreview([line({})], 30);
    harness.buildSmartTransferBusinessRulePreview.mockResolvedValue(full);

    const result = await buildSmartTransferTargetBalancedPreview(4, [11], 23, 0, {});

    expect(result).toBe(full);
  });
});
