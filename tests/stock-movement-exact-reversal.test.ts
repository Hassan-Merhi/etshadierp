import { describe, expect, it, vi } from "vitest";
import {
  buildExactStockMovementReversal,
  postExactStockMovementReversalTx,
  type ExactStockMovementReversalAdapter,
} from "../server/services/inventory/stockMovementReversal";
import type { StockMovementRecord } from "../server/services/inventory/stockMovementIntegrityService";

/** A stub transaction that can run the transaction-local tenant-scope statement. */
function stubTx(marker?: string) {
  return { marker, execute: vi.fn(async () => ({ rows: [] })) };
}

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

function adapter(locked: StockMovementRecord | null = original()): ExactStockMovementReversalAdapter {
  return {
    lockOriginalMovement: vi.fn().mockResolvedValue(locked),
    findExisting: vi.fn().mockResolvedValue(null),
    validateOwnership: vi.fn().mockResolvedValue(undefined),
    lockBalances: vi.fn().mockResolvedValue({ 8: "20" }),
    appendMovements: vi.fn(async ({ request, rows }) =>
      rows.map((row, index) => ({
        id: 1000 + index,
        companyId: request.companyId,
        stockItemId: request.stockItemId,
        locationId: row.locationId,
        quantityDelta: row.quantityDelta,
        unitCost: row.unitCost,
        movementKind: request.kind,
        sourceType: request.source.sourceType,
        sourceId: request.source.sourceId,
        reversalOfMovementId: request.reversalOfMovementId,
      }))
    ),
    recordIdempotency: vi.fn().mockResolvedValue(undefined),
    recordAudit: vi.fn().mockResolvedValue(undefined),
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

describe("postExactStockMovementReversalTx", () => {
  it("locks the original by company before posting its exact opposite", async () => {
    const mock = adapter();
    const tx = stubTx("same-transaction");
    const result = await postExactStockMovementReversalTx(
      tx,
      {
        companyId: 12,
        movementId: 901,
        occurredAt: "2026-08-13T00:00:00.000Z",
        source,
        actor: { userId: 5, reason: "correct transfer" },
      },
      mock
    );

    // The transaction-local company scope must be asserted before the original
    // row is read, so a compatible RLS policy guards that first lock too. It is
    // asserted again by the movement boundary this delegates to, so the count
    // is not pinned.
    expect(tx.execute).toHaveBeenCalled();
    expect(mock.lockOriginalMovement).toHaveBeenCalledWith({ tx, companyId: 12, movementId: 901 });
    expect(mock.validateOwnership).toHaveBeenCalledWith({
      tx,
      companyId: 12,
      stockItemId: 44,
      locationIds: [8],
    });
    expect(result.movements[0]).toMatchObject({
      companyId: 12,
      stockItemId: 44,
      locationId: 8,
      quantityDelta: "5.5",
      unitCost: "2.25",
      movementKind: "reversal",
      reversalOfMovementId: 901,
    });
  });

  it("fails closed when the original movement is absent from the requested company", async () => {
    const mock = adapter(null);
    await expect(
      postExactStockMovementReversalTx(
        stubTx(),
        {
          companyId: 12,
          movementId: 901,
          occurredAt: "2026-08-13T00:00:00.000Z",
          source,
        },
        mock
      )
    ).rejects.toMatchObject({ code: "STOCK_REVERSAL_ORIGINAL_NOT_FOUND" });
    expect(mock.appendMovements).not.toHaveBeenCalled();
  });

  it("rejects an adapter result that crosses company boundaries", async () => {
    const mock = adapter(original({ companyId: 99 }));
    await expect(
      postExactStockMovementReversalTx(
        stubTx(),
        {
          companyId: 12,
          movementId: 901,
          occurredAt: "2026-08-13T00:00:00.000Z",
          source,
        },
        mock
      )
    ).rejects.toMatchObject({ code: "STOCK_REVERSAL_COMPANY_MISMATCH" });
    expect(mock.appendMovements).not.toHaveBeenCalled();
  });
});
