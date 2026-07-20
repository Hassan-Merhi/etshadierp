import { describe, expect, it } from "vitest";
import { REPLAY_ALGORITHM_VERSION } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay algorithm version", () => {
  it("invalidates tokens prepared before final phase 6 safety rules", () => {
    expect(REPLAY_ALGORITHM_VERSION).toBe("v6-final-static-safety");
  });
});
