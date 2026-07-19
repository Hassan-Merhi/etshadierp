import { describe, expect, it } from "vitest";
import {
  applyRawStockCostEventTx,
  RawStockCostingValidationError,
  type RawStockCostEventRequest,
  type RawStockCostResult,
  type RawStockCostState,
} from "../server/services/factory/rawStockCostingIntegrityService";

function baseRequest(overrides: Partial<RawStockCostEventRequest> = {}): RawStockCostEventRequest {
  return {
    companyId: 1,
    supplierId: 7,
    kind: "offload",
    currency: "USD",
    quantityDeltaKg: "1000",
    costDelta: "500",
    occurredAt: "2026-07-18T00:00:00.000Z",
    source: { sourceType: "container", sourceId: "C-1", idempotencyKey: "container:C-1:offload" },
    ...overrides,
  };
}

function state(overrides: Partial<RawStockCostState> = {}): RawStockCostState {
  return {
    supplierId: 7,
    currency: "USD",
    quantityKg: "1000",
    totalCost: "500",
    unitCostPerKg: "0.5",
    version: 3,
    ...overrides,
  };
}

function adapter(current: RawStockCostState, existing: RawStockCostResult | null = null) {
  const calls: string[] = [];
  return {
    calls,
    impl: {
      findExisting: async () => {
        calls.push("findExisting");
        return existing;
      },
      validateOwnership: async () => calls.push("validateOwnership"),
      lockCurrentState: async () => {
        calls.push("lockCurrentState");
        return current;
      },
      appendCostEvent: async () => calls.push("appendCostEvent"),
      persistState: async () => calls.push("persistState"),
      recordIdempotency: async () => calls.push("recordIdempotency"),
      recordAudit: async () => calls.push("recordAudit"),
    },
  };
}

describe("factory raw-stock costing integrity", () => {
  it("recalculates weighted unit cost when a new offload adds quantity and cost", async () => {
    const fake = adapter(state());
    const result = await applyRawStockCostEventTx({}, baseRequest(), fake.impl);

    expect(result.after.quantityKg).toBe("2000");
    expect(result.after.totalCost).toBe("1000");
    expect(result.after.unitCostPerKg).toBe("0.5");
    expect(result.after.version).toBe(4);
    expect(fake.calls).toEqual([
      "findExisting",
      "validateOwnership",
      "lockCurrentState",
      "appendCostEvent",
      "persistState",
      "recordIdempotency",
      "recordAudit",
    ]);
  });

  it("preserves supplier unit cost when stock is deducted", async () => {
    const fake = adapter(state());
    const result = await applyRawStockCostEventTx(
      {},
      baseRequest({
        kind: "manual_adjustment",
        quantityDeltaKg: "-250",
        costDelta: "0",
        preserveUnitCost: true,
      }),
      fake.impl
    );

    expect(result.costDelta).toBe("-125");
    expect(result.after.quantityKg).toBe("750");
    expect(result.after.totalCost).toBe("375");
    expect(result.after.unitCostPerKg).toBe("0.5");
  });

  it("spreads a post-offload charge over remaining quantity", async () => {
    const fake = adapter(state());
    const result = await applyRawStockCostEventTx(
      {},
      baseRequest({
        kind: "post_offload_charge",
        quantityDeltaKg: "0",
        costDelta: "100",
        source: { sourceType: "charge", sourceId: "P-1", idempotencyKey: "charge:P-1" },
      }),
      fake.impl
    );

    expect(result.after.quantityKg).toBe("1000");
    expect(result.after.totalCost).toBe("600");
    expect(result.after.unitCostPerKg).toBe("0.6");
  });

  it("rejects depletion that leaves stranded cost", async () => {
    const fake = adapter(state());
    await expect(
      applyRawStockCostEventTx(
        {},
        baseRequest({
          kind: "manual_adjustment",
          quantityDeltaKg: "-1000",
          costDelta: "-400",
        }),
        fake.impl
      )
    ).rejects.toMatchObject({ code: "RAW_STOCK_ZERO_QUANTITY_COST_INVALID" });
  });

  it("rejects stale expected versions before writes", async () => {
    const fake = adapter(state());
    await expect(
      applyRawStockCostEventTx({}, baseRequest({ expectedVersion: 2 }), fake.impl)
    ).rejects.toMatchObject({ code: "RAW_STOCK_VERSION_CONFLICT" });
    expect(fake.calls).toEqual(["findExisting", "validateOwnership", "lockCurrentState"]);
  });

  it("returns existing idempotent result without ownership checks or writes", async () => {
    const prior: RawStockCostResult = {
      before: state(),
      after: state({ version: 4 }),
      quantityDeltaKg: "0",
      costDelta: "0",
      idempotent: false,
    };
    const fake = adapter(state(), prior);
    const result = await applyRawStockCostEventTx({}, baseRequest(), fake.impl);

    expect(result.idempotent).toBe(true);
    expect(fake.calls).toEqual(["findExisting"]);
  });

  it("rejects currency mismatch against the locked supplier state", async () => {
    const fake = adapter(state({ currency: "EUR" }));
    await expect(applyRawStockCostEventTx({}, baseRequest(), fake.impl)).rejects.toBeInstanceOf(
      RawStockCostingValidationError
    );
    await expect(applyRawStockCostEventTx({}, baseRequest(), adapter(state({ currency: "EUR" })).impl)).rejects.toMatchObject({
      code: "RAW_STOCK_CURRENCY_MISMATCH",
    });
  });
});
