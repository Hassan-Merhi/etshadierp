import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "server/routes/factory/customer-orders/bale-scanning/exchange.ts"),
  "utf8"
);

describe("container loading scan audit route shape", () => {
  it("keeps the original removal response unless scan audit is explicitly requested", () => {
    const auditBranch = source.indexOf('req.query.includeScanAudit === "1"');
    const removalsBranch = source.indexOf("const removals = await db");

    expect(auditBranch).toBeGreaterThan(0);
    expect(removalsBranch).toBeGreaterThan(auditBranch);
    expect(source).toContain("return res.json({ scanAudit });");
    expect(source).toContain("res.json(removals);");
  });
});
