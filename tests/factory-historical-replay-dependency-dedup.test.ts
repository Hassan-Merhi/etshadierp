import { describe, expect, it } from "vitest";
import {
  buildSelectedSupplierCorrectionPlan,
  type BatchInfo,
  type SourceInfo,
} from "../server/services/factory/historicalCostReplay";

describe("Historical Replay dependency graph", () => {
  it("does not treat two source rows from the same upstream batch as a cycle", () => {
    const batches = new Map<number, BatchInfo>([
      [10, { batchId: 10, batchCode: "B10", batchDate: "2026-01-01", status: "ACTIVE", createdAt: 1, storedCostPerKg: 1, storedTotalCost: 100, totalWeightKg: 100 }],
      [20, { batchId: 20, batchCode: "B20", batchDate: "2026-01-02", status: "ACTIVE", createdAt: 2, storedCostPerKg: 1, storedTotalCost: 100, totalWeightKg: 100 }],
    ]);
    const sources: SourceInfo[] = [
      { sourceId: 1, batchId: 10, batchCode: "B10", batchDate: "2026-01-01", supplierId: 1, containerId: 100, sourceBatchId: null, weightKg: 100, storedCostPerKg: 1, storedTotalCost: 100, pricingBasis: "SUPPLIER_LOCKED_RATE", inventorySupplierId: 1 },
      { sourceId: 2, batchId: 20, batchCode: "B20", batchDate: "2026-01-02", supplierId: null, containerId: null, sourceBatchId: 10, weightKg: 40, storedCostPerKg: 1, storedTotalCost: 40, pricingBasis: "BATCH", inventorySupplierId: null },
      { sourceId: 3, batchId: 20, batchCode: "B20", batchDate: "2026-01-02", supplierId: null, containerId: null, sourceBatchId: 10, weightKg: 60, storedCostPerKg: 1, storedTotalCost: 60, pricingBasis: "BATCH", inventorySupplierId: null },
    ];

    const plan = buildSelectedSupplierCorrectionPlan({
      batchInfoMap: batches,
      sourceInfos: sources,
      selectedSupplierIds: new Set([1]),
      expectedRateAtBatch: new Map([["1:10", 2]]),
      canonicalRateByContainer: new Map(),
    });

    expect(plan.blockedBatches).toEqual([]);
    expect(plan.changedBatchCorrections.map((row) => row.batchId)).toEqual([10, 20]);
    expect([...plan.sourceCorrections.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
