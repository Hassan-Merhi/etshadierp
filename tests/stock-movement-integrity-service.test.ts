import { describe, expect, it, vi } from "vitest";
import {
  postStockMovementTx,
  StockMovementValidationError,
  validateStockMovementRequest,
  type StockMovementAdapter,
  type StockMovementRequest,
} from "../server/services/inventory/stockMovementIntegrityService";

const base: StockMovementRequest = {
  companyId: 1,
  stockItemId: 10,
  kind: "transfer",
  quantity: "5.500000",
  unitCost: "2.250000",
  fromLocationId: 100,
  toLocationId: 200,
  occurredAt: "2026-07-18T00:00:00.000Z",
  source: {
    sourceType: "stock-transfer",
    sourceId: "77",
    idempotencyKey: "stock-transfer:77:post",
  },
};

function adapter(balance = "10"): StockMovementAdapter {
  return {
    findExisting: vi.fn().mockResolvedValue(null),
    validateOwnership: vi.fn().mockResolvedValue(undefined),
    lockBalances: vi.fn().mockResolvedValue({ 100: balance, 200: "0" }),
    appendMovements: vi.fn(async ({ request, rows }) =>
      rows.map((row, index) => ({
        id: index + 1,
        companyId: request.companyId,
        stockItemId: request.stockItemId,
        locationId: row.locationId,
        quantityDelta: row.quantityDelta,
        unitCost: row.unitCost,
        movementKind: request.kind,
        sourceType: request.source.sourceType,
        sourceId: request.source.sourceId,
      }))
    ),
    recordIdempotency: vi.fn().mockResolvedValue(undefined),
    recordAudit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("validateStockMovementRequest", () => {
  it("creates equal and opposite transfer rows at one unit cost", () => {
    const result = validateStockMovementRequest(base);
    expect(result.rows).toEqual([
      { locationId: 100, quantityDelta: "-5.5", unitCost: "2.25" },
      { locationId: 200, quantityDelta: "5.5", unitCost: "2.25" },
    ]);
    expect(result.value).toBe("12.375");
  });

  it("rejects transfers to the same location", () => {
    expect(() => validateStockMovementRequest({ ...base, toLocationId: 100 })).toThrowError(
      expect.objectContaining<Partial<StockMovementValidationError>>({
        code: "STOCK_MOVEMENT_LOCATIONS_INVALID",
      })
    );
  });

  it("requires explicit linkage for reversals", () => {
    expect(() =>
      validateStockMovementRequest({
        ...base,
        kind: "reversal",
        fromLocationId: 100,
        toLocationId: null,
      })
    ).toThrowError(
      expect.objectContaining<Partial<StockMovementValidationError>>({
        code: "STOCK_MOVEMENT_REVERSAL_REQUIRED",
      })
    );
  });
});

describe("postStockMovementTx", () => {
  it("locks balances before appending immutable movement rows", async () => {
    const mock = adapter();
    const result = await postStockMovementTx({}, base, mock);

    expect(result.idempotent).toBe(false);
    expect(result.movements).toHaveLength(2);
    expect(mock.validateOwnership).toHaveBeenCalledOnce();
    expect(mock.lockBalances).toHaveBeenCalledOnce();
    expect(mock.appendMovements).toHaveBeenCalledOnce();
    expect(mock.recordIdempotency).toHaveBeenCalledOnce();
    expect(mock.recordAudit).toHaveBeenCalledOnce();
  });

  it("rejects an issue that would create negative stock", async () => {
    const mock = adapter("4");
    await expect(postStockMovementTx({}, base, mock)).rejects.toMatchObject<
      Partial<StockMovementValidationError>
    >({ code: "STOCK_MOVEMENT_INSUFFICIENT_QUANTITY" });
    expect(mock.appendMovements).not.toHaveBeenCalled();
  });

  it("returns an existing idempotent result without writes", async () => {
    const mock = adapter();
    vi.mocked(mock.findExisting).mockResolvedValue({
      movements: [],
      quantity: "5.5",
      value: "12.375",
      idempotent: false,
    });

    const result = await postStockMovementTx({}, base, mock);
    expect(result.idempotent).toBe(true);
    expect(mock.validateOwnership).not.toHaveBeenCalled();
    expect(mock.appendMovements).not.toHaveBeenCalled();
    expect(mock.recordAudit).not.toHaveBeenCalled();
  });
});
