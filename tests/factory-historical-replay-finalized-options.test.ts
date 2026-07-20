import { describe, expect, it } from "vitest";
import { replayBaleIdsForScope } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay finalized bale option", () => {
  const scope: any = {
    supplierIds: [1], containerIdsToUpdate: [], rawStockIdsToUpdate: [],
    sourceIdsToUpdate: [], batchIdsToUpdate: [40],
    availableBaleIdsToUpdate: [50], finalizedBaleIdsToUpdate: [51], blockedBatches: [],
  };

  it("excludes finalized bales unless the prepared option authorizes them", () => {
    expect(replayBaleIdsForScope(scope, false)).toEqual([50]);
    expect(replayBaleIdsForScope(scope, true)).toEqual([50, 51]);
  });
});
