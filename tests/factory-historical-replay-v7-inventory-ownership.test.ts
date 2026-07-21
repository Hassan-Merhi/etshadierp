import { describe, expect, it } from "vitest";
import {
  replaySupplierTimeline,
  type SourceInfo,
} from "../server/services/factory/historicalCostReplay";
import {
  resolveInventorySupplierId,
  requireInventorySupplierId,
} from "../server/services/factory/mixSourceInventoryOwnership";
import {
  connectedScopeIsComplete,
  expandConnectedSupplierClosure,
} from "../server/services/factory/historical-replay/supplierClosureV7Final";
import { REPLAY_ALGORITHM_VERSION } from "../server/services/factory/historical-replay/types";

function source(overrides: Partial<SourceInfo>): SourceInfo {
  return {
    sourceId: 1,
    batchId: 10,
    batchCode: "B10",
    batchDate: "2026-01-01",
    supplierId: 1,
    containerId: 100,
    sourceBatchId: null,
    weightKg: 10,
    storedCostPerKg: 1,
    storedTotalCost: 10,
    pricingBasis: "SUPPLIER_LOCKED_RATE",
    inventorySupplierId: 1,
    ...overrides,
  };
}

describe("final V7 algorithm version", () => {
  it("invalidates incomplete first-V7 confirmation tokens", () => {
    expect(REPLAY_ALGORITHM_VERSION).toBe(
      "HISTORICAL_COST_REPLAY_V7_INVENTORY_OWNERSHIP_FINAL"
    );
  });
});

describe("inventory ownership resolver", () => {
  it("keeps BATCH sources ownership-null", () => {
    expect(resolveInventorySupplierId({ sourceBatchId: 42, supplierId: 7 })).toBeNull();
  });

  it("uses supplier ownership without changing pricing basis", () => {
    expect(resolveInventorySupplierId({ supplierId: 7 })).toBe(7);
  });

  it("resolves a CONTAINER_DIRECT source to the container supplier", () => {
    expect(resolveInventorySupplierId({
      supplierId: null,
      containerId: 10,
      containerSupplierId: 8,
      sourceBatchId: null,
    })).toBe(8);
  });

  it("fails closed for an unowned non-BATCH source", () => {
    expect(() => requireInventorySupplierId(null, null)).toThrow(
      "INVENTORY_SUPPLIER_UNRESOLVED"
    );
  });
});

describe("connected multi-supplier closure", () => {
  it("expands through mixed suppliers and downstream BATCH dependencies", () => {
    const rows: SourceInfo[] = [
      source({ sourceId: 1, batchId: 10, supplierId: 1, inventorySupplierId: 1 }),
      source({ sourceId: 2, batchId: 10, supplierId: 2, inventorySupplierId: 2 }),
      source({
        sourceId: 3,
        batchId: 20,
        batchCode: "B20",
        supplierId: null,
        containerId: null,
        sourceBatchId: 10,
        pricingBasis: "BATCH",
        inventorySupplierId: null,
      }),
      source({
        sourceId: 4,
        batchId: 20,
        batchCode: "B20",
        supplierId: null,
        containerId: 300,
        sourceBatchId: null,
        pricingBasis: "CONTAINER_DIRECT",
        inventorySupplierId: 3,
      }),
    ];

    const closure = expandConnectedSupplierClosure(rows, new Set([1]));
    expect([...closure.supplierIds].sort()).toEqual([1, 2, 3]);
    expect([...closure.batchIds].sort()).toEqual([10, 20]);
    expect(connectedScopeIsComplete(rows, closure)).toBe(true);
  });

  it("marks a connected batch unresolved when ownership cannot be resolved", () => {
    const rows = [
      source({ sourceId: 1, batchId: 10, supplierId: 1, inventorySupplierId: 1 }),
      source({
        sourceId: 2,
        batchId: 10,
        supplierId: null,
        containerId: 200,
        pricingBasis: "CONTAINER_DIRECT",
        inventorySupplierId: null,
      }),
    ];
    const closure = expandConnectedSupplierClosure(rows, new Set([1]));
    expect([...closure.unresolvedBatchIds]).toEqual([10]);
    expect(connectedScopeIsComplete(rows, closure)).toBe(false);
  });
});

describe("supplier moving-average replay", () => {
  it("resets to the new receipt rate after old stock is fully consumed", async () => {
    const result = await replaySupplierTimeline(1, 1, "Supplier", 0, [
      {
        kind: "RECEIPT",
        effectiveDate: "2026-01-01",
        createdAt: 1,
        stableId: 1,
        receiptKg: 100,
        canonicalRateUsd: 2,
      },
      {
        kind: "BATCH_CONSUMPTION",
        effectiveDate: "2026-01-02",
        createdAt: 2,
        stableId: 2,
        batchId: 10,
        consumptionKg: 100,
      },
      {
        kind: "RECEIPT",
        effectiveDate: "2026-02-01",
        createdAt: 3,
        stableId: 3,
        receiptKg: 50,
        canonicalRateUsd: 5,
      },
    ], 50);

    expect(result.replayRemainingKg).toBe(50);
    expect(result.endingRate).toBe(5);
  });

  it("clamps only a residual within 0.001 kg", async () => {
    const tiny = await replaySupplierTimeline(1, 1, "Supplier", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-02", createdAt: 2, stableId: 2, batchId: 10, consumptionKg: 100.0005 },
      { kind: "RECEIPT", effectiveDate: "2026-02-01", createdAt: 3, stableId: 3, receiptKg: 50, canonicalRateUsd: 7 },
    ], 50);
    expect(tiny.endingRate).toBe(7);

    const realNegative = await replaySupplierTimeline(1, 1, "Supplier", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-02", createdAt: 2, stableId: 2, batchId: 10, consumptionKg: 101 },
    ], -1);
    expect(realNegative.replayRemainingKg).toBe(-1);
  });

  it("distinguishes quantity-only and valued ADD adjustments", async () => {
    const quantityOnly = await replaySupplierTimeline(1, 1, "Supplier", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "ADD_ADJUSTMENT", effectiveDate: "2026-01-02", createdAt: 2, stableId: 2, adjustKg: 50, costPerKgUsd: 8, valuationBasis: "QUANTITY_ONLY" },
    ], 150);
    expect(quantityOnly.endingRate).toBe(2);

    const valued = await replaySupplierTimeline(1, 1, "Supplier", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "ADD_ADJUSTMENT", effectiveDate: "2026-01-02", createdAt: 2, stableId: 2, adjustKg: 50, costPerKgUsd: 8, valuationBasis: "VALUED_TRANSFER" },
    ], 150);
    expect(valued.endingRate).toBeCloseTo(4, 8);
  });
});
