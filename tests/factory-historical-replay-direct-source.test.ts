import { describe, expect, it } from "vitest";
import {
  buildSelectedSupplierCorrectionPlan,
  type BatchInfo,
  type SourceInfo,
} from "../server/services/factory/historicalCostReplay";

describe("Historical Replay direct-container sources", () => {
  it("uses canonical landed cost for CONTAINER_DIRECT rows inside selected closure", () => {
    const batches = new Map<number, BatchInfo>([[
      10,
      {
        batchId: 10,
        batchCode: "B10",
        batchDate: "2026-01-02",
        status: "ACTIVE",
        createdAt: 10,
        storedCostPerKg: 1,
        storedTotalCost: 150,
        totalWeightKg: 150,
      },
    ]]);
    const sources: SourceInfo[] = [
      {
        sourceId: 1,
        batchId: 10,
        batchCode: "B10",
        batchDate: "2026-01-02",
        supplierId: 1,
        containerId: 100,
        sourceBatchId: null,
        weightKg: 100,
        storedCostPerKg: 1,
        storedTotalCost: 100,
        pricingBasis: "SUPPLIER_LOCKED_RATE",
        inventorySupplierId: 1,
      },
      {
        sourceId: 2,
        batchId: 10,
        batchCode: "B10",
        batchDate: "2026-01-02",
        supplierId: null,
        containerId: 200,
        sourceBatchId: null,
        weightKg: 50,
        storedCostPerKg: 1,
        storedTotalCost: 50,
        pricingBasis: "CONTAINER_DIRECT",
        // No inventorySupplierId — container has no supplier → CONTAINER_DIRECT unowned
        inventorySupplierId: null,
      },
    ];

    const plan = buildSelectedSupplierCorrectionPlan({
      batchInfoMap: batches,
      sourceInfos: sources,
      selectedSupplierIds: new Set([1]),
      expectedRateAtBatch: new Map([["1:10", 2]]),
      canonicalRateByContainer: new Map([[200, 3]]),
    });

    expect(plan.sourceCorrections.get(1)?.expectedCostPerKg).toBe(2);
    expect(plan.sourceCorrections.get(2)?.expectedCostPerKg).toBe(3);
    expect(plan.changedBatchCorrections[0].expectedTotalCost).toBe(350);
  });

  it("blocks the batch when a direct-container canonical cost is unresolved", () => {
    const batches = new Map<number, BatchInfo>([[
      10,
      {
        batchId: 10,
        batchCode: "B10",
        batchDate: "2026-01-02",
        status: "ACTIVE",
        createdAt: 10,
        storedCostPerKg: 1,
        storedTotalCost: 150,
        totalWeightKg: 150,
      },
    ]]);
    const sources: SourceInfo[] = [
      {
        sourceId: 1,
        batchId: 10,
        batchCode: "B10",
        batchDate: "2026-01-02",
        supplierId: 1,
        containerId: 100,
        sourceBatchId: null,
        weightKg: 100,
        storedCostPerKg: 1,
        storedTotalCost: 100,
        pricingBasis: "SUPPLIER_LOCKED_RATE",
        inventorySupplierId: 1,
      },
      {
        sourceId: 2,
        batchId: 10,
        batchCode: "B10",
        batchDate: "2026-01-02",
        supplierId: null,
        containerId: 200,
        sourceBatchId: null,
        weightKg: 50,
        storedCostPerKg: 1,
        storedTotalCost: 50,
        pricingBasis: "CONTAINER_DIRECT",
        inventorySupplierId: null,
      },
    ];

    const plan = buildSelectedSupplierCorrectionPlan({
      batchInfoMap: batches,
      sourceInfos: sources,
      selectedSupplierIds: new Set([1]),
      expectedRateAtBatch: new Map([["1:10", 2]]),
      canonicalRateByContainer: new Map(),
    });

    expect(plan.changedBatchCorrections).toEqual([]);
    expect(plan.blockedBatches[0].reasons).toContain("UNRESOLVED_FX");
  });
});
