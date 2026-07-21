import { describe, expect, it } from "vitest";
import { REPLAY_ALGORITHM_VERSION } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay algorithm version", () => {
  it("invalidates tokens prepared before final phase 6 safety rules", () => {
    // V7 bumped the version; old v6 tokens are now invalid by the version check in exactApplyFinal.ts.
    expect(REPLAY_ALGORITHM_VERSION).toBe("HISTORICAL_COST_REPLAY_V7_INVENTORY_OWNERSHIP");
  });
});
