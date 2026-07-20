import { describe, expect, it } from "vitest";
import { normalizeReplayWriteScope } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay blocked batches", () => {
  it("keeps deterministic blocked reasons in exact scope", () => {
    const scope: any = {
      supplierIds: [1], containerIdsToUpdate: [], rawStockIdsToUpdate: [],
      sourceIdsToUpdate: [], batchIdsToUpdate: [], availableBaleIdsToUpdate: [],
      finalizedBaleIdsToUpdate: [],
      blockedBatches: [{ batchId: 2, batchCode: "B2", reasons: ["Z", "A", "A"] }],
    };
    expect(normalizeReplayWriteScope(scope).blockedBatches[0].reasons).toEqual(["A", "Z"]);
  });
});
