import { describe, expect, it } from "vitest";
import { REPLAY_ALGORITHM_VERSION } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay algorithm version", () => {
  it("invalidates tokens prepared by incomplete v6 and first-v7 implementations", () => {
    expect(REPLAY_ALGORITHM_VERSION).toBe(
      "HISTORICAL_COST_REPLAY_V7_INVENTORY_OWNERSHIP_FINAL"
    );
  });
});
