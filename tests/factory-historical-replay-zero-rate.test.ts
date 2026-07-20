import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay zero supplier rate", () => {
  it("persists an approved zero ending rate instead of treating it like NULL", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(source).toContain("expectedRate.lt(0)");
    expect(source).toContain("expectedRate.toFixed(8)");
    expect(source).toContain("Always persist the exact replay result");
    expect(source).not.toContain("endingExpectedRate > 0");
  });
});
