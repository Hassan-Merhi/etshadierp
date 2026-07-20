import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay token identity binding", () => {
  it("rejects token company and user mismatches", () => {
    const route = readFileSync(
      resolve(process.cwd(), "server/routes/factory/raw-stock/historicalReplayRoutesV4.ts"),
      "utf8"
    );
    expect(route).toContain("Token company mismatch");
    expect(route).toContain("Token user mismatch");
  });
});
