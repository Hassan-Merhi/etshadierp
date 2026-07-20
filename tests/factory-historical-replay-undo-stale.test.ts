import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay stale undo", () => {
  it("compares current costs and non-cost state before restoring", () => {
    const route = readFileSync(
      resolve(process.cwd(), "server/routes/factory/raw-stock/historicalReplayRoutesV4.ts"),
      "utf8"
    );
    expect(route).toContain("assertExactReplayNonCostInvariants(envelope.after, current)");
    expect(route).toContain("assertExactReplayCurrentCostsMatchApplied(envelope.after, current)");
    expect(route).toContain("undone_at IS NULL");
  });
});
