import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("factory customer proforma summary payload", () => {
  it("includes line data required by the loading progress screen", () => {
    const source = readFileSync("server/routes/factory/customer-proformas/proformas.ts", "utf8");

    expect(source).toContain('lines: linesByProforma.get(Number(row.id)) || []');
    expect(source).toContain("articleCode: line.article_code");
    expect(source).toContain("quantity: Number(line.quantity) || 0");
  });
});
