import { describe, expect, it, vi } from "vitest";
import {
  createMixBatchCostTx,
  MixBatchCostingValidationError,
  type LockedSupplierCostState,
  type MixBatchCostingAdapter,
  type MixBatchCostingRequest,
} from "../server/services/factory/mixBatchCostingIntegrityService";

function request(): MixBatchCostingRequest {
  return {
    companyId: 1,
    batchId: "FMB-2026-0001",
    currency: "USD",
    occurredAt: "2026-07-18T00:00:00.000Z",
    components: [
      { supplierId: 10, quantityKg: "100", expectedUnitCostPerKg: "0.5", expectedRawStockVersion: 3 },
      { supplierId: 20, quantityKg: "200", expectedUnitCostPerKg: "0.8", expectedRawStockVersion: 7 },
    ],
    source: { sourceType: "factory_mix_batch", sourceId: "1", idempotencyKey: "mix:1" },
  };
}

function states(): LockedSupplierCostState[] {
  return [
    { supplierId: 10, currency: "USD", quantityKg: "1000", totalCost: "500", unitCostPerKg: "0.5", version: 3 },
    { supplierId: 20, currency: "USD", quantityKg: "500", totalCost: "400", unitCostPerKg: "0.8", version: 7 },
  ];
}

function adapter(overrides: Partial<MixBatchCostingAdapter> = {}): MixBatchCostingAdapter {
  return {
    findExisting: vi.fn().mockResolvedValue(null),
    validateOwnership: vi.fn().mockResolvedValue(undefined),
    lockSupplierStates: vi.fn().mockResolvedValue(states()),
    appendSupplierDeductions: vi.fn().mockResolvedValue(undefined),
    persistSupplierStates: vi.fn().mockResolvedValue(undefined),
    persistMixBatchCost: vi.fn().mockResolvedValue(undefined),
    recordIdempotency: vi.fn().mockResolvedValue(undefined),
    recordAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("mix-batch costing integrity", () => {
  it("uses locked supplier rates and preserves each supplier cost/kg", async () => {
    const deps = adapter();
    const result = await createMixBatchCostTx({}, request(), deps);

    expect(result.totalQuantityKg).toBe("300");
    expect(result.totalValue).toBe("210");
    expect(result.weightedUnitCostPerKg).toBe("0.7");
    expect(result.components[0]).toMatchObject({
      supplierId: 10,
      value: "50",
      afterQuantityKg: "900",
      afterTotalCost: "450",
      unitCostPerKg: "0.5",
    });
    expect(result.components[1]).toMatchObject({
      supplierId: 20,
      value: "160",
      afterQuantityKg: "300",
      afterTotalCost: "240",
      unitCostPerKg: "0.8",
    });
    expect(deps.persistSupplierStates).toHaveBeenCalledBefore(deps.persistMixBatchCost as any);
  });

  it("rejects a stale displayed supplier rate", async () => {
    const changed = request();
    changed.components[0].expectedUnitCostPerKg = "0.49";
    await expect(createMixBatchCostTx({}, changed, adapter())).rejects.toMatchObject({
      code: "MIX_BATCH_RATE_CONFLICT",
    });
  });

  it("rejects insufficient supplier stock before writes", async () => {
    const changed = request();
    changed.components[0].quantityKg = "1001";
    const deps = adapter();
    await expect(createMixBatchCostTx({}, changed, deps)).rejects.toMatchObject({
      code: "MIX_BATCH_INSUFFICIENT_STOCK",
    });
    expect(deps.appendSupplierDeductions).not.toHaveBeenCalled();
  });

  it("rejects stale raw-stock versions", async () => {
    const changed = request();
    changed.components[1].expectedRawStockVersion = 6;
    await expect(createMixBatchCostTx({}, changed, adapter())).rejects.toMatchObject({
      code: "MIX_BATCH_VERSION_CONFLICT",
    });
  });

  it("returns an existing idempotent result without locks or writes", async () => {
    const existing = {
      companyId: 1,
      batchId: "FMB-2026-0001",
      currency: "USD",
      totalQuantityKg: "300",
      totalValue: "210",
      weightedUnitCostPerKg: "0.7",
      components: [],
      idempotent: false,
    };
    const deps = adapter({ findExisting: vi.fn().mockResolvedValue(existing) });
    const result = await createMixBatchCostTx({}, request(), deps);
    expect(result.idempotent).toBe(true);
    expect(deps.validateOwnership).not.toHaveBeenCalled();
    expect(deps.lockSupplierStates).not.toHaveBeenCalled();
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it("rejects duplicate supplier components", async () => {
    const changed = request();
    changed.components[1].supplierId = 10;
    await expect(createMixBatchCostTx({}, changed, adapter())).rejects.toBeInstanceOf(
      MixBatchCostingValidationError
    );
  });
});
