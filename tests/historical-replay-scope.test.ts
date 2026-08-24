import { describe, expect, it, vi } from "vitest";

vi.mock("../server/db", () => ({
  pool: { query: vi.fn() },
}));

import {
  buildHistoricalReplayScope,
  buildNotFinalizedClause,
  captureReplaySnapshot,
  computeReplayFingerprint,
  computeReplayWriteScope,
} from "../server/services/factory/historical-replay/scope";

function previewFixture() {
  return {
    summary: {
      totalReceivedContainers: 2,
      containersScanned: 2,
      omittedContainers: 0,
      canonicalContainerMismatches: 1,
      suppliersScanned: 2,
      safeSuppliers: 1,
      manualReviewSuppliers: 1,
      supplierPricedSourcesScanned: 2,
      sourceMismatches: 1,
      batchesToUpdate: 1,
      completedBatchesToUpdate: 0,
      balesToUpdate: 3,
      finalizedBalesToUpdate: 0,
      unresolvedFx: 1,
      missingDates: 0,
      quantityTimelineMismatches: 0,
      ambiguousEventOrdering: 0,
      scanCoverageError: false,
    },
    supplierRows: [
      {
        supplierId: 2,
        endingExpectedRate: 1.25,
        replayRemainingKg: 100,
        authoritativeRemainingKg: 100,
        currentStoredRate: 1.2,
        safeToRepair: true,
      },
      {
        supplierId: 1,
        endingExpectedRate: 1.5,
        replayRemainingKg: 50,
        authoritativeRemainingKg: 40,
        currentStoredRate: 1.4,
        safeToRepair: false,
      },
    ],
    sourceRows: [
      {
        sourceId: 20,
        supplierId: 2,
        containerId: null,
        batchId: 200,
        pricingBasis: "SUPPLIER_LOCKED_RATE",
        weightKg: 25,
        storedCostPerKg: 1,
        expectedHistoricalCostPerKg: 1.25,
        safeToRepair: true,
      },
      {
        sourceId: 10,
        supplierId: 1,
        containerId: 100,
        batchId: 100,
        pricingBasis: "CONTAINER_DIRECT",
        weightKg: 10,
        storedCostPerKg: 1,
        expectedHistoricalCostPerKg: 1.5,
        safeToRepair: false,
      },
    ],
    batchRows: [
      {
        batchId: 200,
        status: "OPEN",
        storedCostPerKg: 1,
        expectedCostPerKg: 1.25,
        storedTotalCost: 25,
        expectedTotalCost: 31.25,
      },
    ],
    containerRows: [
      {
        containerId: 300,
        supplierId: 2,
        fxUnresolved: false,
        storedCostPerKgUsd: 1,
        canonicalCostPerKgUsd: 1.25,
        storedTotalUsd: 100,
        canonicalTotalUsd: 125,
        safeToRepair: true,
      },
      {
        containerId: 301,
        supplierId: 2,
        fxUnresolved: true,
        storedCostPerKgUsd: 2,
        canonicalCostPerKgUsd: 2,
        storedTotalUsd: 200,
        canonicalTotalUsd: 200,
        safeToRepair: false,
      },
    ],
  };
}

describe("historical replay scope", () => {
  it("builds a deterministic fingerprint independent of supplier input ordering", () => {
    const preview = previewFixture();
    const options = { includeCompletedBatches: false, includeFinalizedBales: false };

    const first = computeReplayFingerprint(7, [2, 1], preview as never, options);
    const second = computeReplayFingerprint(7, [1, 2], preview as never, options);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it("filters unsafe and unresolved rows out of the fingerprint scope", () => {
    const preview = previewFixture();
    const baseline = computeReplayFingerprint(7, [2], preview as never, {
      includeCompletedBatches: true,
      includeFinalizedBales: true,
    });

    preview.sourceRows[1].storedCostPerKg = 999;
    preview.containerRows[1].storedTotalUsd = 999;
    preview.supplierRows[1].currentStoredRate = 999;

    expect(
      computeReplayFingerprint(7, [2], preview as never, {
        includeCompletedBatches: true,
        includeFinalizedBales: true,
      })
    ).toBe(baseline);
  });

  it("builds strict and permissive bale finalization clauses", () => {
    const strict = buildNotFinalizedClause(false);
    expect(strict).toContain("dispatch_batch_id IS NULL");
    expect(strict).toContain("customer_order_bales");
    expect(strict).toContain("factory_invoice_loading_bales");

    expect(buildNotFinalizedClause(true)).toBe("status NOT IN ('DELETED','REMOVED')");
  });

  it("captures all replay snapshot tables and substitutes safe empty-id sentinels", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 4 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ id: 6 }] });

    const result = await captureReplaySnapshot({ query } as never, 7, [], [], [], []);

    expect(result).toEqual({
      rawStockRows: [{ id: 1 }],
      mixBatchSources: [{ id: 2 }],
      mixBatches: [{ id: 3 }],
      bales: [{ id: 4 }],
      suppliers: [{ id: 5 }],
      containers: [{ id: 6 }],
    });
    expect(query).toHaveBeenCalledTimes(6);
    for (const call of query.mock.calls) {
      expect(JSON.stringify(call[1])).toContain("-1");
    }
  });

  it("returns an empty write scope when no preview supplier is safe", async () => {
    const preview = previewFixture();
    preview.supplierRows = preview.supplierRows.map((row) => ({ ...row, safeToRepair: false }));
    const query = vi.fn();

    const scope = await computeReplayWriteScope(
      7,
      [],
      preview as never,
      { includeCompletedBatches: false, includeFinalizedBales: false },
      { query } as never
    );

    expect([...scope.safeSupplierIds]).toEqual([]);
    expect([...scope.containerIds]).toEqual([]);
    expect([...scope.batchIdsToApply]).toEqual([]);
    expect([...scope.sourceIds]).toEqual([]);
    expect(scope.baleCount).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("builds the canonical empty public scope without querying when no suppliers are selected", async () => {
    const query = vi.fn();

    const scope = await buildHistoricalReplayScope({
      companyId: 7,
      selectedSupplierIds: new Set(),
      includeCompletedBatches: false,
      includeFinalizedBales: false,
      executor: { query } as never,
    });

    expect(scope).toEqual({
      supplierIds: [],
      containerIdsToUpdate: [],
      rawStockIdsToUpdate: [],
      sourceIdsToUpdate: [],
      batchIdsToUpdate: [],
      availableBaleIdsToUpdate: [],
      finalizedBaleIdsToUpdate: [],
      blockedBatches: [],
    });
    expect(query).not.toHaveBeenCalled();
  });
});
