import { describe, expect, it } from "vitest";
import {
  normalizeReplayWriteScope,
  replayWriteScopesEqual,
} from "../server/services/factory/historicalCostReplay";

describe("Historical Replay signed scope", () => {
  it("normalizes exact IDs and blocked reasons deterministically", () => {
    const scope: any = {
      supplierIds: [2, 1, 1],
      containerIdsToUpdate: [11, 10],
      rawStockIdsToUpdate: [20],
      sourceIdsToUpdate: [30],
      batchIdsToUpdate: [40],
      availableBaleIdsToUpdate: [50],
      finalizedBaleIdsToUpdate: [51],
      blockedBatches: [{ batchId: 99, batchCode: "B99", reasons: ["Z", "A"] }],
    };
    const normalized = normalizeReplayWriteScope(scope);
    expect(normalized.supplierIds).toEqual([1, 2]);
    expect(normalized.containerIdsToUpdate).toEqual([10, 11]);
    expect(normalized.blockedBatches[0].reasons).toEqual(["A", "Z"]);
    expect(replayWriteScopesEqual(scope, normalized)).toBe(true);
  });

  it("detects any exact ID change", () => {
    const left: any = {
      supplierIds: [1], containerIdsToUpdate: [10], rawStockIdsToUpdate: [],
      sourceIdsToUpdate: [], batchIdsToUpdate: [], availableBaleIdsToUpdate: [],
      finalizedBaleIdsToUpdate: [], blockedBatches: [],
    };
    expect(replayWriteScopesEqual(left, {
      ...left,
      containerIdsToUpdate: [11],
    })).toBe(false);
  });
});
