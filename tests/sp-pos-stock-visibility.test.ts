import { describe, expect, it } from "vitest";
import { buildPosInventory, type SpMovement } from "../client/src/pages/pos/hooks/posInventory";

function inventoryItem(overrides: Record<string, unknown> = {}) {
  return {
    stockItemId: 101,
    stockItemCode: "BB04",
    stockItemName: "Blue Bale",
    quantity: "8",
    averageRate: "3.50",
    lastSellingPrice: null,
    ...overrides,
  } as any;
}

function movement(overrides: Partial<SpMovement> = {}): SpMovement {
  return {
    id: 1,
    articleCode: "BB04",
    description: "Blue Bale",
    stockItemId: 101,
    locationId: 10,
    qtyRemaining: "8",
    finalUnitCostUsd: "4.25",
    ...overrides,
  };
}

describe("Supplier Partner POS stock visibility", () => {
  it("keeps selected-location inventory visible and overlays Supplier Partner cost", () => {
    const result = buildPosInventory([inventoryItem()], [movement()], true, 10);

    expect(result).toEqual([
      {
        code: "BB04",
        name: "Blue Bale",
        stock: 8,
        price: 4.25,
        configuredPrice: 4.25,
        stockItemId: 101,
      },
    ]);
  });

  it("does not hide visible inventory when legacy movement location metadata is stale", () => {
    const result = buildPosInventory([inventoryItem()], [movement({ locationId: 99 })], true, 10);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: "BB04", stock: 8, stockItemId: 101 });
  });

  it("uses a weighted Supplier Partner cost across remaining lots", () => {
    const result = buildPosInventory(
      [inventoryItem({ quantity: "4" })],
      [
        movement({ id: 1, qtyRemaining: "2", finalUnitCostUsd: "4" }),
        movement({ id: 2, qtyRemaining: "2", finalUnitCostUsd: "6" }),
      ],
      true,
      10
    );

    expect(result[0]).toMatchObject({ stock: 4, price: 5, configuredPrice: 5 });
  });

  it("keeps mapped movement-only stock visible when the inventory mirror is missing", () => {
    const result = buildPosInventory([], [movement({ qtyRemaining: "3" })], true, 10);

    expect(result).toEqual([
      {
        code: "BB04",
        name: "Blue Bale",
        stock: 3,
        price: 4.25,
        configuredPrice: 4.25,
        stockItemId: 101,
      },
    ]);
  });

  it("preserves normal ERP inventory behavior outside Supplier Partner companies", () => {
    const result = buildPosInventory(
      [inventoryItem({ lastSellingPrice: "7.25" })],
      [movement({ finalUnitCostUsd: "99" })],
      false,
      10
    );

    expect(result[0]).toMatchObject({ stock: 8, price: 7.25, configuredPrice: 7.25 });
  });
});
