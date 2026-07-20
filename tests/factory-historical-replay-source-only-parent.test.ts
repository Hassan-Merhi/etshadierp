import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay source-only parent scope", () => {
  const source = readFileSync(
    resolve(process.cwd(), "server/services/factory/historical-replay/exactScopeFinal.ts"),
    "utf8"
  );

  it("promotes every source-correction parent into the exact batch scope", () => {
    expect(source).toContain("sourceCorrections.values()");
    expect(source).toContain("correction.batchId");
    expect(source).toContain("missingBatchIds");
    expect(source).toContain("...missingBatchIds");
  });

  it("rebuilds batch totals from the full source set and reclassifies bales", () => {
    expect(source).toContain("base._sourceInfos.filter");
    expect(source).toContain("sourceCorrections.get(source.sourceId)?.expectedCostPerKg");
    expect(source).toContain("classifyReplayBalesForBatches");
    expect(source).toContain("base.availableBaleIdsToUpdate = classification.availableIds");
  });
});
