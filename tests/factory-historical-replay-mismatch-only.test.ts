import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay mismatch-only scope", () => {
  it("filters container and raw-stock writes to actual mismatches", () => {
    const scope = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactScopeV6.ts"),
      "utf8"
    );
    const finalScope = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactScopeFinal.ts"),
      "utf8"
    );
    expect(scope).toContain("canonical.canonicalCostPerKgUsd - canonical.storedCostPerKgUsd");
    expect(scope).toContain("canonical.canonicalTotalUsd - canonical.storedTotalUsd");
    expect(finalScope).toContain("Math.abs(expected - stored) > 0.000001");
  });
});
