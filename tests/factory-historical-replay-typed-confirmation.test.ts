import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay typed confirmation", () => {
  it("requires the exact phrase before the UI can submit apply", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/pages/factory/production-raw-stock/RawStockRecalculate.tsx"),
      "utf8"
    );
    expect(source).toContain("APPLY HISTORICAL REPLAY");
    expect(source).toContain("replayConfirmText !== REPLAY_CONFIRM_PHRASE");
  });
});
