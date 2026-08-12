import { describe, expect, it } from "vitest";
import { buildExactStockMovementReversal } from "../server/services/inventory/stockMovementReversal";
import type { StockMovementRecord } from "../server/services/inventory/stockMovementIntegrityService";

const source = {
  sourceType: "stock-transfer-reversal",
  sourceId: "77",
  idempotencyKey: "stock-transfer:77:reverse:1",
};

function original(overrides: Partial<StockMovementRecord> = {}): StockMovementRecord {
  return {
    id: 901,
    companyId: 12,
    stockItemId: 44,
    locationId: 8,
    quantityDelta: "-5.500000",
    unitCost: "2.250000",
    movementKind: "transfer",
    sourceType: "stock-transfer",
    sourceId: "77",
    reversalOfMovementId: null,
    ...overrides,
  };
}

describe("buildExactStockMovementReversal", () => {
  it("reverses an outward movement using the exact original quantity, cost, tenant, item and location", () => {
    const result = buildExactStockMovementReversal({
      original: original(),
      occurredAt: "2026-08-13T00:00:00.000Z",
      source,
      actor: { userId: 5, username: "admin", reason: "correct transfer" },
    });

    expect(result).toMatchObject({
      companyId: 12,
      stockItemId: 44,
      kind: "reversal",
      quantity: "5.5",
      unitCost: "2.25",
      fromLocationId: null,
      toLocationId: 8,
      reversalOfMovementId: 901,
      allowNegativeStock: false,
    });
  });

  it("reverses an inward movement as an exact outward movement", () => {
    const result = buildExactStockMovementReversal({
      original: original({ quantityDelta: "5.500000" }),
      occurredAt: "2026-08-13T00:00:00.000Z",
      source,
    });

    expect(result.fromLocationId).toBe(8);
    expect(result.toLocationId).toBeNull();
    expect(result.quantity).toBe("5.5");
    expect(result.unitCost).toBe("2.25");
  });

  it("preserves decimal precision without Number arithmetic", () => {
    const result = buildExactStockMovementReversal({
      original: original({
        quantityDelta: "-0.123456789123456789",
        unitCost: "19.876543210987654321",
      }),
      occurredAt: "2026-08-13T00:00:00.000Z",
      source,
    });

    expect(result.quantity).toBe("0.123456789123456789");
    expect(result.unitCost).toBe("19.876543210987654321");
  });

  it("rejects zero movements instead of creating a meaningless reversal", () => {
    expect(() =>
      buildExactStockMovementReversal({
        original: original({ quantityDelta: "0" }),
        occurredAt: "2026-08-13T00:00:00.000Z",
        source,
      })
    ).toThrowError(expect.objectContaining({ code: "STOCK_REVERSAL_ORIGINAL_INVALID" }));
  });

  it("rejects reversal-of-reversal chains", () => {
    expect(() =>
      buildExactStockMovementReversal({
        original: original({ movementKind: "reversal", reversalOfMovementId: 700 }),
        occurredAt: "2026-08-13T00:00:00.000Z",
        source,
      })
    ).toThrowError(expect.objectContaining({ code: "STOCK_REVERSAL_CHAIN_INVALID" }));
  });
});
