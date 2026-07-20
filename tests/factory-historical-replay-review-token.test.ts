import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay review token", () => {
  it("binds expiration and exact scope into the signed preparation", () => {
    const route = readFileSync(
      resolve(process.cwd(), "server/routes/factory/raw-stock/historicalReplayRoutesV4.ts"),
      "utf8"
    );
    expect(route).toContain("expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS");
    expect(route).toContain("scope: normalizedScope");
    expect(route).toContain("fingerprint");
  });
});
