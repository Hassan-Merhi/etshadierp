import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("factory customer proforma summary payload", () => {
  it("keeps summaries line-free while preserving detail line data", () => {
    const source = readFileSync("server/routes/factory/customer-proformas/proformas.ts", "utf8");
    const summaryStart = source.indexOf('if (profile === "summary")');
    const fullListStart = source.indexOf("const rawProformasRes", summaryStart);

    if (summaryStart < 0 || fullListStart < 0) {
      throw new Error("Could not locate the summary and full-list branches");
    }

    const summaryBranch = source.slice(summaryStart, fullListStart);

    expect(summaryBranch).not.toContain("lines:");
    expect(source).toContain("res.json({ ...proforma, lines: enrichedLines });");
  });
});
