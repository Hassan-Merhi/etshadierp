import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const coveredMutationFiles = [
  "server/routes/inventoryRoutes.ts",
  "server/routes/stock/stockTransferAdjRoutes.ts",
  "server/routes/containers/containerCrudRoutes.ts",
  "server/routes/containers/containerOffloadRoutes.ts",
  "server/routes/containers/containerFreightWriteRoutes.ts",
];

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 8C domain audit coverage", () => {
  it.each(coveredMutationFiles)("keeps %s connected to the shared audit path", (path) => {
    const contents = source(path);

    expect(contents).toMatch(/\blogAudit\b/);
    expect(contents).toMatch(/await\s+logAudit\s*\(/);
  });

  it("keeps the compatibility adapter connected to the hardened audit framework", () => {
    const contents = source("server/routes/helpers/auditWriteAdapter.ts");

    expect(contents).toContain('from "../../services/audit"');
    expect(contents).toContain("await writeAuditEvent(params)");
  });
});
