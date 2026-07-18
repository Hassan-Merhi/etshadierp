import { describe, expect, it, vi } from "vitest";
import { requireRawStockSensitiveInput } from "../server/services/security/rawStockSensitiveInputGuard";

function run(path: string, body: unknown) {
  const req: any = { method: "POST", path, body };
  const response: any = {
    statusCode: 200,
    payload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  const next = vi.fn();
  requireRawStockSensitiveInput(req, response, next);
  return { req, response, next };
}

describe("raw-stock sensitive input guard", () => {
  it("accepts and freezes an exact recalc apply payload", () => {
    const result = run("/api/factory/raw-stock/recalc/apply", {
      containerIds: [3, 7],
      confirm: true,
      confirmationToken: "signed-token",
      includeCompletedBatches: false,
      includeHistoricalContainers: false,
      reason: "Correct audited landed cost",
      idempotencyKey: "recalc:company:1:batch:44",
    });

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.response.statusCode).toBe(200);
    expect(Object.isFrozen(result.req.body)).toBe(true);
  });

  it("rejects unknown fields before route logic", () => {
    const result = run("/api/factory/raw-stock/recalc/auto-apply-fx", {
      containerIds: [1],
      reason: "Apply approved FX rate",
      idempotencyKey: "fx:company:1:container:1",
      adminOverride: true,
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(result.response.statusCode).toBe(400);
    expect(result.response.payload).toEqual({ message: "Invalid request" });
  });

  it("rejects duplicate, non-integer, and non-positive identifiers", () => {
    for (const ids of [[1, 1], [1.5], [0], [-1], ["1"]]) {
      const result = run("/api/factory/raw-stock/recalc/auto-apply-fx", {
        containerIds: ids,
        reason: "Apply approved FX rate",
        idempotencyKey: "fx:company:1:batch:1",
      });
      expect(result.response.statusCode).toBe(400);
      expect(result.next).not.toHaveBeenCalled();
    }
  });

  it("rejects oversized identifier arrays", () => {
    const result = run("/api/factory/raw-stock/recalc/apply", {
      containerIds: Array.from({ length: 501 }, (_, index) => index + 1),
      reason: "Correct audited landed cost",
      idempotencyKey: "recalc:company:1:batch:large",
    });

    expect(result.response.statusCode).toBe(400);
    expect(result.next).not.toHaveBeenCalled();
  });

  it("rejects manual rates outside the selected source set", () => {
    const result = run("/api/factory/raw-stock/recalc/zero-cost-sources/apply", {
      sourceIds: [10],
      manualRates: { "11": 0.55 },
      reason: "Repair approved source rate",
      idempotencyKey: "source:company:1:repair:10",
    });

    expect(result.response.statusCode).toBe(400);
    expect(result.next).not.toHaveBeenCalled();
  });

  it("rejects unsafe object structure", () => {
    const polluted = Object.create(null);
    polluted.sourceIds = [10];
    polluted.manualRates = Object.create(null);
    polluted.manualRates.constructor = 1;
    polluted.reason = "Repair approved source rate";
    polluted.idempotencyKey = "source:company:1:repair:unsafe";

    const result = run("/api/factory/raw-stock/recalc/zero-cost-sources/apply", polluted);
    expect(result.response.statusCode).toBe(400);
    expect(result.next).not.toHaveBeenCalled();
  });

  it("requires strict positive integer identifiers for direct repairs", () => {
    const supplier = run("/api/factory/raw-stock/supplier-rate/recompute", {
      supplierId: "12",
      reason: "Recompute approved supplier rate",
      idempotencyKey: "supplier:company:1:rate:12",
    });
    const undo = run("/api/factory/raw-stock/recalc/undo", {
      undoLogId: 0,
      reason: "Undo incorrect recalculation",
      idempotencyKey: "undo:company:1:log:0",
    });

    expect(supplier.response.statusCode).toBe(400);
    expect(undo.response.statusCode).toBe(400);
  });
});
