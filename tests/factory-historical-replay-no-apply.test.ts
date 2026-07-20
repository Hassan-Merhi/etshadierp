import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay regression safety", () => {
  it("does not call the protected apply endpoint from test code", () => {
    const source = readFileSync(
      resolve(process.cwd(), "tests/factory-raw-material-moving-avg.test.ts"),
      "utf8"
    );
    expect(source).not.toContain("modeApiRequest");
    expect(source).not.toContain("apiRequest(");
  });
});
