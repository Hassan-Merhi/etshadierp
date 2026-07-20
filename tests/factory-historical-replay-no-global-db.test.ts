import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay transaction executor", () => {
  it("uses the transaction executor throughout the final apply path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(source).toContain("const executor = client as unknown as ReplayQueryExecutor");
    expect(source).toContain("buildExactHistoricalReplayScopeInternal");
    expect(source).toContain("loadReplayAuthoritativeInputDigest(executor");
    expect(source).not.toContain("await pool.query(");
  });
});
