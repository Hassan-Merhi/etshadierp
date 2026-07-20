import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay completed batch option", () => {
  it("blocks downstream consumers when a changed completed parent is excluded", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactScopeV6.ts"),
      "utf8"
    );
    expect(source).toContain("COMPLETED_BATCH_REQUIRES_INCLUDE_COMPLETED");
    expect(source).toContain("UPSTREAM_COMPLETED_BATCH_EXCLUDED");
  });
});
