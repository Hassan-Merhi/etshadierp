import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay prepare snapshot", () => {
  it("uses one repeatable-read client for preview, scope and fingerprint", () => {
    const route = readFileSync(
      resolve(process.cwd(), "server/routes/factory/raw-stock/historicalReplayRoutesV4.ts"),
      "utf8"
    );
    expect(route).toContain("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(route).toContain("previewHistoricalCostReplayWithExecutor(executor");
    expect(route).toContain("buildHistoricalReplayScopeInternal");
    expect(route).toContain("computeReplayFingerprint");
  });
});
