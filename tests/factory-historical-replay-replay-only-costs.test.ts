import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay cost-only writes", () => {
  it("writes only approved cost columns in final apply", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(source).toContain("SET cost_per_kg_usd = $1");
    expect(source).toContain("SET rate_per_kg_usd = $1");
    expect(source).toContain("SET cost_per_kg = $1");
    expect(source).not.toContain("SET used_kg");
    expect(source).not.toContain("SET received_kg");
    expect(source).not.toContain("SET status");
  });
});
