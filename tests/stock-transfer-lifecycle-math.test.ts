import { describe, expect, it } from "vitest";
import { aggregateSourceStockRequirements } from "../server/services/stockTransferLifecycle";

describe("stock transfer lifecycle source requirements", () => {
  it("aggregates duplicate item lines at the same source before stock validation", () => {
    const requirements = aggregateSourceStockRequirements([
      { sourceLocationId: 1, stockItemId: 10, quantity: 12 },
      { sourceLocationId: 1, stockItemId: 10, quantity: 8 },
      { sourceLocationId: 2, stockItemId: 10, quantity: 5 },
    ]);

    expect(requirements).toEqual([
      { sourceLocationId: 1, stockItemId: 10, quantity: 20 },
      { sourceLocationId: 2, stockItemId: 10, quantity: 5 },
    ]);
  });

  it("keeps the same item isolated across four source locations", () => {
    const requirements = aggregateSourceStockRequirements([
      { sourceLocationId: 4, stockItemId: 22, quantity: 9 },
      { sourceLocationId: 1, stockItemId: 22, quantity: 6 },
      { sourceLocationId: 3, stockItemId: 22, quantity: 8 },
      { sourceLocationId: 2, stockItemId: 22, quantity: 7 },
    ]);

    expect(requirements.map((row) => row.sourceLocationId)).toEqual([1, 2, 3, 4]);
    expect(requirements.reduce((sum, row) => sum + row.quantity, 0)).toBe(30);
  });
});
