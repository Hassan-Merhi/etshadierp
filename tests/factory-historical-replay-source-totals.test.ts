import { describe, expect, it } from "vitest";
import { assertPersistedReplaySourceTotals } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay persisted source totals", () => {
  const scope: any = {
    supplierIds: [1], containerIdsToUpdate: [], rawStockIdsToUpdate: [],
    sourceIdsToUpdate: [30], batchIdsToUpdate: [40],
    availableBaleIdsToUpdate: [], finalizedBaleIdsToUpdate: [], blockedBatches: [],
  };

  it("accepts persisted batch and source arithmetic that agrees", async () => {
    const executor: any = {
      query: async () => ({ rows: [{
        batch_id: 40,
        batch_total: "125.000000",
        persisted_source_total: "125.000000",
        max_source_row_difference: "0.000000",
      }] }),
    };
    await expect(assertPersistedReplaySourceTotals(executor, 7, scope)).resolves.toBeUndefined();
  });

  it("rejects a persisted batch/source mismatch", async () => {
    const executor: any = {
      query: async () => ({ rows: [{
        batch_id: 40,
        batch_total: "125.000000",
        persisted_source_total: "120.000000",
        max_source_row_difference: "0.000000",
      }] }),
    };
    await expect(assertPersistedReplaySourceTotals(executor, 7, scope)).rejects.toThrow(
      /persisted source totals/
    );
  });
});
