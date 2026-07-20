import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Historical Replay company scope", () => {
  it("keeps every final apply update company-scoped", () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/services/factory/historical-replay/exactApplyFinal.ts"),
      "utf8"
    );
    expect(source).toContain("AND company_id = $3");
    expect(source).toContain("AND company_id = $4");
    expect(source).toContain("mb.company_id = $5");
  });
});
