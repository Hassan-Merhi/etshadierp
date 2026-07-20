import { describe, expect, it } from "vitest";
import { replaySupplierTimeline } from "../server/services/factory/historicalCostReplay";

describe("Historical Replay negative stock", () => {
  it("preserves signed remaining quantity while flooring only the next receipt denominator", async () => {
    const result = await replaySupplierTimeline(7, 1, "Supplier", 0, [
      { kind: "RECEIPT", effectiveDate: "2026-01-01", createdAt: 1, stableId: 1, receiptKg: 100, canonicalRateUsd: 2 },
      { kind: "BATCH_CONSUMPTION", effectiveDate: "2026-01-02", createdAt: 2, stableId: 2, batchId: 2, consumptionKg: 150 },
      { kind: "RECEIPT", effectiveDate: "2026-01-03", createdAt: 3, stableId: 3, receiptKg: 200, canonicalRateUsd: 3 },
    ] as any, 150);
    expect(result.replayRemainingKg).toBe(150);
    expect(result.endingRate).toBe(3);
  });
});
