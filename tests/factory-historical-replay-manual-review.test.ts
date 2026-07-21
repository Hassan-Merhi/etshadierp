import { describe, expect, it } from "vitest";
import {
  buildSelectedSupplierCorrectionPlan,
  type BatchInfo,
  type SourceInfo,
} from "../server/services/factory/historicalCostReplay";

describe("Historical Replay manual review", () => {
  it("blocks a selected batch containing a manual-review source", () => {
    const batches = new Map<number, BatchInfo>([[1, {
      batchId: 1, batchCode: "B1", batchDate: "2026-01-01", status: "ACTIVE",
      createdAt: 1, storedCostPerKg: 1, storedTotalCost: 100, totalWeightKg: 100,
    }]]);
    const sources: SourceInfo[] = [
      { sourceId: 1, batchId: 1, batchCode: "B1", batchDate: "2026-01-01", supplierId: 1, containerId: 10, sourceBatchId: null, weightKg: 50, storedCostPerKg: 1, storedTotalCost: 50, pricingBasis: "SUPPLIER_LOCKED_RATE", inventorySupplierId: 1 },
      { sourceId: 2, batchId: 1, batchCode: "B1", batchDate: "2026-01-01", supplierId: null, containerId: null, sourceBatchId: null, weightKg: 50, storedCostPerKg: 1, storedTotalCost: 50, pricingBasis: "MANUAL_REVIEW", inventorySupplierId: null },
    ];
    const plan = buildSelectedSupplierCorrectionPlan({
      batchInfoMap: batches,
      sourceInfos: sources,
      selectedSupplierIds: new Set([1]),
      expectedRateAtBatch: new Map([["1:1", 2]]),
      canonicalRateByContainer: new Map(),
    });
    expect(plan.changedBatchCorrections).toEqual([]);
    expect(plan.blockedBatches[0].reasons).toContain("MANUAL_REVIEW_SOURCE");
  });
});
