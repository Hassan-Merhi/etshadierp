import { describe, expect, it } from "vitest";
import { sortEvents } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay ambiguous order", () => {
  it("marks same-day receipt and consumption with missing timestamps ambiguous", () => {
    const result = sortEvents([
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 0, stableId: 1 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-01", createdAt: 0, stableId: 2 },
    ] as any);
    expect(result.ambiguous).toBe(true);
  });
});
