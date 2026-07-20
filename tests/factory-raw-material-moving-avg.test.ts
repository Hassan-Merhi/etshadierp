import { beforeEach, describe, expect, it } from "vitest";
import {
  REPLAY_ALGORITHM_VERSION,
  assertExactReplayCurrentCostsMatchApplied,
  assertExactReplayNonCostInvariants,
  buildSelectedSupplierBatchClosure,
  buildSelectedSupplierCorrectionPlan,
  classifyReplayBalesForBatches,
  computeReplayFingerprint,
  normalizeReplayWriteScope,
  replayBaleIdsForScope,
  replaySupplierTimeline,
  replayWriteScopesEqual,
  sortEvents,
  type BatchInfo,
  type ExactReplaySnapshot,
  type HistoricalReplayPreviewResult,
  type ReplayWriteScope,
  type SourceInfo,
  type SupplierEvent,
} from "../server/services/factory/historicalCostReplay";
import {
  HISTORICAL_REPLAY_APPLY_PATH,
  clearHistoricalReplayPreparations,
  freezeHistoricalReplayApplyRequest,
  rememberHistoricalReplayPreparation,
} from "../client/src/lib/historicalReplayPreparedRequest";

function scope(overrides: Partial<ReplayWriteScope> = {}): ReplayWriteScope {
  return {
    supplierIds: [1],
    containerIdsToUpdate: [10],
    rawStockIdsToUpdate: [20],
    sourceIdsToUpdate: [30],
    batchIdsToUpdate: [40],
    availableBaleIdsToUpdate: [50],
    finalizedBaleIdsToUpdate: [51],
    blockedBatches: [],
    ...overrides,
  };
}

function preview(digest = "digest-a"): HistoricalReplayPreviewResult {
  return {
    summary: {
      totalReceivedContainers: 1,
      containersScanned: 1,
      omittedContainers: 0,
      canonicalContainerMismatches: 1,
      suppliersScanned: 1,
      safeSuppliers: 1,
      manualReviewSuppliers: 0,
      supplierPricedSourcesScanned: 1,
      sourceMismatches: 1,
      batchesToUpdate: 1,
      completedBatchesToUpdate: 0,
      balesToUpdate: 2,
      finalizedBalesToUpdate: 1,
      unresolvedFx: 0,
      missingDates: 0,
      quantityTimelineMismatches: 0,
      ambiguousEventOrdering: 0,
      scanCoverageError: false,
    },
    supplierRows: [{
      supplierId: 1,
      supplierName: "Supplier A",
      startingRate: 0,
      endingExpectedRate: 2.5,
      currentStoredRate: 2,
      replayRemainingKg: 100,
      authoritativeRemainingKg: 100,
      safeToRepair: true,
      reasons: [],
      eventCount: 2,
      affectedContainerCount: 1,
      affectedSourceCount: 1,
      affectedBatchCount: 1,
      affectedBaleCount: 2,
    }],
    containerRows: [{
      containerId: 10,
      containerNumber: "C-10",
      status: "OFFLOADED",
      supplierId: 1,
      eventDate: "2026-01-01",
      storedCostPerKgUsd: 2,
      canonicalCostPerKgUsd: 2.5,
      storedTotalUsd: 200,
      canonicalTotalUsd: 250,
      fxUnresolved: false,
      safeToRepair: true,
      reason: null,
      scanReason: "ACTIVE_RAW_STOCK",
    }],
    sourceRows: [{
      sourceId: 30,
      batchId: 40,
      batchCode: "B-40",
      batchDate: "2026-01-02",
      supplierId: 1,
      containerId: 10,
      pricingBasis: "SUPPLIER_LOCKED_RATE",
      storedCostPerKg: 2,
      expectedHistoricalCostPerKg: 2.5,
      storedTotalCost: 200,
      expectedTotalCost: 250,
      weightKg: 100,
      safeToRepair: true,
      reason: null,
    }],
    batchRows: [{
      batchId: 40,
      batchCode: "B-40",
      status: "ACTIVE",
      batchDate: "2026-01-02",
      storedCostPerKg: 2,
      expectedCostPerKg: 2.5,
      storedTotalCost: 200,
      expectedTotalCost: 250,
      affectedBales: 2,
    }],
    authoritativeInputDigest: digest,
    authoritativeInputCounts: { containers: 1, sources: 1 },
  } as HistoricalReplayPreviewResult;
}

function snapshot(): ExactReplaySnapshot {
  return {
    containers: [{
      id: 10,
      finalPayableAmount: "250",
      ratePerKgUsd: "2.5",
      finalPayableAmountUsd: "250",
      supplierId: 1,
      status: "OFFLOADED",
      actualReceivedKg: "100",
      totalKg: "100",
      declaredKg: "100",
      companyId: 7,
      nonCostState: { id: 10, company_id: 7, supplier_id: 1, status: "OFFLOADED" },
    }],
    rawStockRows: [{
      id: 20,
      costPerKg: "2",
      costPerKgUsd: "2.5",
      receivedKg: "100",
      usedKg: "25",
      containerId: 10,
      companyId: 7,
      deletedAt: null,
      nonCostState: { id: 20, company_id: 7, received_kg: "100", used_kg: "25" },
    }],
    mixBatchSources: [{
      id: 30,
      costPerKg: "2.5",
      totalCost: "125",
      supplierId: 1,
      containerId: 10,
      sourceBatchId: null,
      sourceType: "SUPPLIER_LOCKED_RATE",
      sourceId: null,
      weightKg: "50",
      quantityKg: "50",
      mixBatchId: 40,
      nonCostState: { id: 30, mix_batch_id: 40, weight_kg: "50" },
    }],
    mixBatches: [{
      id: 40,
      costPerKg: "2.5",
      totalCost: "125",
      totalWeightKg: "50",
      usedKg: "10",
      status: "ACTIVE",
      companyId: 7,
      deletedAt: null,
      nonCostState: { id: 40, company_id: 7, used_kg: "10", status: "ACTIVE" },
    }],
    bales: [{
      id: 50,
      costPerKg: "2.5",
      totalCost: "50",
      weightKg: "20",
      quantity: 1,
      status: "IN_STOCK",
      mixBatchId: 40,
      erpLocationId: 3,
      pressingBatchId: 8,
      finalizedAt: null,
      companyId: 7,
      deletedAt: null,
      nonCostState: { id: 50, company_id: 7, mix_batch_id: 40, weight_kg: "20" },
    }],
    suppliers: [{
      id: 1,
      currentRawMaterialCostPerKgUsd: "2.5",
      companyId: 7,
      nonCostState: { id: 1, company_id: 7, name: "Supplier A" },
    }],
  };
}

describe("moving-average chronology", () => {
  it("uses timestamps and blocks unresolved same-day receipt/consumption order", () => {
    const receipt: SupplierEvent = {
      kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 100,
      stableId: 1, receiptKg: 100, canonicalRateUsd: 2,
    };
    const consumption: SupplierEvent = {
      kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-01", createdAt: 200,
      stableId: 2, batchId: 40, consumptionKg: 50,
    };
    expect(sortEvents([consumption, receipt]).sorted.map((event) => event.stableId)).toEqual([1, 2]);
    expect(sortEvents([{ ...receipt, createdAt: 0 }, { ...consumption, createdAt: 0 }]).ambiguous).toBe(true);
  });

  it("preserves negative stock and floors only old quantity in the next receipt", async () => {
    const result = await replaySupplierTimeline(7, 1, "Supplier A", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 100, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-02", createdAt: 200, stableId: 2, batchId: 40, consumptionKg: 150 },
      { kind: "RECEIPT", effectiveDate: "2026-01-03", createdAt: 300, stableId: 3, receiptKg: 200, canonicalRateUsd: 3 },
    ], 150);
    expect(result.expectedRateAtBatch.get(40)).toBe(2);
    expect(result.replayRemainingKg).toBe(150);
    expect(result.endingRate).toBe(3);
  });
});

describe("selected supplier closure", () => {
  const batches = new Map<number, BatchInfo>([
    [10, { batchId: 10, batchCode: "B10", batchDate: "2026-01-02", status: "ACTIVE", createdAt: 10, storedCostPerKg: 1, storedTotalCost: 100, totalWeightKg: 100 }],
    [20, { batchId: 20, batchCode: "B20", batchDate: "2026-01-03", status: "ACTIVE", createdAt: 20, storedCostPerKg: 1, storedTotalCost: 50, totalWeightKg: 50 }],
    [30, { batchId: 30, batchCode: "B30", batchDate: "2026-01-04", status: "ACTIVE", createdAt: 30, storedCostPerKg: 4, storedTotalCost: 100, totalWeightKg: 25 }],
  ]);
  const sources: SourceInfo[] = [
    { sourceId: 1, batchId: 10, batchCode: "B10", batchDate: "2026-01-02", supplierId: 1, containerId: 100, sourceBatchId: null, weightKg: 100, storedCostPerKg: 1, storedTotalCost: 100, pricingBasis: "SUPPLIER_LOCKED_RATE" },
    { sourceId: 2, batchId: 20, batchCode: "B20", batchDate: "2026-01-03", supplierId: null, containerId: null, sourceBatchId: 10, weightKg: 50, storedCostPerKg: 1, storedTotalCost: 50, pricingBasis: "BATCH" },
    { sourceId: 3, batchId: 30, batchCode: "B30", batchDate: "2026-01-04", supplierId: 2, containerId: 200, sourceBatchId: null, weightKg: 25, storedCostPerKg: 4, storedTotalCost: 100, pricingBasis: "SUPPLIER_LOCKED_RATE" },
  ];

  it("includes downstream BATCH consumers but excludes unrelated suppliers", () => {
    const result = buildSelectedSupplierBatchClosure(sources, new Set([1]));
    expect([...result.closureBatchIds].sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it("creates corrections for selected supplier and downstream BATCH rows", () => {
    const plan = buildSelectedSupplierCorrectionPlan({
      batchInfoMap: batches,
      sourceInfos: sources,
      selectedSupplierIds: new Set([1]),
      expectedRateAtBatch: new Map([["1:10", 2]]),
      canonicalRateByContainer: new Map(),
    });
    expect(plan.changedBatchCorrections.map((row) => row.batchId)).toEqual([10, 20]);
    expect([...plan.sourceCorrections.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

describe("exact token scope", () => {
  it("normalizes scope and binds options, exact IDs and authoritative digest", () => {
    const normalized = normalizeReplayWriteScope(scope({ supplierIds: [2, 1, 1] }));
    expect(normalized.supplierIds).toEqual([1, 2]);
    expect(replayWriteScopesEqual(normalized, scope({ supplierIds: [1, 2] }))).toBe(true);

    const base = computeReplayFingerprint(7, [1], preview(), {
      includeCompletedBatches: false,
      includeFinalizedBales: false,
    }, scope());
    expect(computeReplayFingerprint(7, [1], preview("digest-b"), {
      includeCompletedBatches: false,
      includeFinalizedBales: false,
    }, scope())).not.toBe(base);
    expect(computeReplayFingerprint(7, [1], preview(), {
      includeCompletedBatches: true,
      includeFinalizedBales: false,
    }, scope())).not.toBe(base);
  });
});

describe("finalized bale classification", () => {
  it("uses only schema-supported status/finalized/order/loading signals", async () => {
    let sql = "";
    const result = await classifyReplayBalesForBatches({
      query: async (query: string, params?: any[]) => {
        sql = query;
        expect(params).toEqual([7, [40]]);
        return { rows: [
          { id: 50, mix_batch_id: 40, is_finalized: false },
          { id: 51, mix_batch_id: 40, is_finalized: true },
        ] };
      },
    }, 7, [40]);
    expect(result.availableIds).toEqual([50]);
    expect(result.finalizedIds).toEqual([51]);
    expect(sql).toContain("customer_order_bales");
    expect(sql).toContain("factory_invoice_loading_bales");
    expect(sql).not.toContain("dispatch_batch_id");
    expect(replayBaleIdsForScope(scope(), false)).toEqual([50]);
    expect(replayBaleIdsForScope(scope(), true)).toEqual([50, 51]);
  });
});

describe("cost-only invariants and stale undo", () => {
  it("allows cost changes but rejects any non-cost change", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.bales[0].totalCost = "55";
    expect(() => assertExactReplayNonCostInvariants(before, after)).not.toThrow();
    after.bales[0].nonCostState = { ...after.bales[0].nonCostState, status: "SOLD" };
    expect(() => assertExactReplayNonCostInvariants(before, after)).toThrow(/non-cost column/);
  });

  it("blocks undo after a later cost edit", () => {
    const applied = snapshot();
    const current = structuredClone(applied);
    current.bales[0].totalCost = "999";
    expect(() => assertExactReplayCurrentCostsMatchApplied(applied, current)).toThrow(/undo blocked/);
  });
});

describe("prepared client state", () => {
  beforeEach(() => clearHistoricalReplayPreparations());

  it("rebuilds apply from server-returned frozen state", () => {
    expect(rememberHistoricalReplayPreparation({
      confirmationToken: "signed",
      safeSupplierIds: [2, 1],
      frozenOptions: { includeCompletedBatches: true, includeFinalizedBales: false },
      algorithmVersion: REPLAY_ALGORITHM_VERSION,
      fingerprint: "fp",
    })).toBe(true);

    expect(freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "signed",
      supplierIds: [999],
      includeCompletedBatches: false,
      includeFinalizedBales: true,
    })).toEqual({
      dryRun: false,
      confirmationToken: "signed",
      supplierIds: [1, 2],
      includeCompletedBatches: true,
      includeFinalizedBales: false,
      algorithmVersion: REPLAY_ALGORITHM_VERSION,
      fingerprint: "fp",
    });
  });

  it("sends only the signed token when prepared memory is unavailable", () => {
    expect(freezeHistoricalReplayApplyRequest("POST", HISTORICAL_REPLAY_APPLY_PATH, {
      confirmationToken: "signed-after-reload",
      supplierIds: [999],
    })).toEqual({ dryRun: false, confirmationToken: "signed-after-reload" });
  });
});
