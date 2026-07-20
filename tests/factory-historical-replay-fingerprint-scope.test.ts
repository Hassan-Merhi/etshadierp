import { describe, expect, it } from "vitest";
import { computeReplayFingerprint } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay fingerprint scope binding", () => {
  it("changes when an exact source ID changes", () => {
    const preview: any = {
      summary: {}, supplierRows: [], containerRows: [], sourceRows: [], batchRows: [],
      authoritativeInputDigest: "digest", authoritativeInputCounts: {},
    };
    const scope: any = {
      supplierIds: [1], containerIdsToUpdate: [], rawStockIdsToUpdate: [],
      sourceIdsToUpdate: [30], batchIdsToUpdate: [], availableBaleIdsToUpdate: [],
      finalizedBaleIdsToUpdate: [], blockedBatches: [],
    };
    const first = computeReplayFingerprint(7, [1], preview, {
      includeCompletedBatches: false, includeFinalizedBales: false,
    }, scope);
    const second = computeReplayFingerprint(7, [1], preview, {
      includeCompletedBatches: false, includeFinalizedBales: false,
    }, { ...scope, sourceIdsToUpdate: [31] });
    expect(first).not.toBe(second);
  });
});
