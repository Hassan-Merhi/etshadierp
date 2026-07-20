import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay one-use token requirement", () => {
  it("fails closed without token hash and atomic commit callback", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(source).toContain("!tokenHash || !issuedByUserId || !onCommit");
    expect(source).toContain("factory_replay_consumed_tokens");
    expect(source).toContain("ON CONFLICT (token_hash) DO NOTHING");
  });
});
