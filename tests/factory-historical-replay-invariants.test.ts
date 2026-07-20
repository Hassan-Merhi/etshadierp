import { describe, expect, it } from "vitest";
import {
  assertExactReplayCurrentCostsMatchApplied,
  assertExactReplayNonCostInvariants,
  type ExactReplaySnapshot,
} from "../server/services/factory/historicalCostReplay";

function snapshot(): ExactReplaySnapshot {
  return {
    containers: [],
    rawStockRows: [],
    mixBatchSources: [],
    mixBatches: [],
    bales: [{
      id: 50,
      costPerKg: "2.5",
      totalCost: "50",
      weightKg: "20",
      quantity: 1,
      status: "IN_STOCK",
      mixBatchId: 40,
      erpLocationId: 3,
      pressingBatchId: 8,
      finalizedAt: null,
      companyId: 7,
      deletedAt: null,
      nonCostState: {
        id: 50,
        company_id: 7,
        mix_batch_id: 40,
        weight_kg: "20",
        status: "IN_STOCK",
      },
    }],
    suppliers: [],
  };
}

describe("Historical Replay exact invariants", () => {
  it("allows cost-only changes", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.bales[0].costPerKg = "2.75";
    after.bales[0].totalCost = "55";
    expect(() => assertExactReplayNonCostInvariants(before, after)).not.toThrow();
  });

  it("rejects non-cost changes", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.bales[0].nonCostState = {
      ...after.bales[0].nonCostState,
      status: "SOLD",
    };
    expect(() => assertExactReplayNonCostInvariants(before, after)).toThrow(/non-cost column/);
  });

  it("blocks stale undo after a later cost edit", () => {
    const applied = snapshot();
    const current = structuredClone(applied);
    current.bales[0].totalCost = "999";
    expect(() => assertExactReplayCurrentCostsMatchApplied(applied, current)).toThrow(/undo blocked/);
  });
});
