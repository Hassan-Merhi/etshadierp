import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Phase 8D audit coverage", () => {
  it.each([
    "server/routes/accountRoutes.ts",
    "server/routes/admin/userManagementRoutes.ts",
    "server/routes/admin/companySettingsRoutes.ts",
    "server/routes/admin/importExportRoutes.ts",
    "server/routes/admin/repair/rebuild-inventory.ts",
  ])("keeps %s connected to awaited audit writes", (path) => {
    const contents = source(path);
    expect(contents).toContain("logAudit");
    expect(contents).toMatch(/await\s+logAudit\s*\(/);
  });

  it("keeps the compatibility adapter connected to the shared audit framework", () => {
    const contents = source("server/routes/helpers/auditWriteAdapter.ts");
    expect(contents).toContain('from "../../services/audit"');
    expect(contents).toMatch(/await\s+writeAuditEvent\s*\(/);
  });

  it("keeps the reviewed payroll exception visible until atomic integration is possible", () => {
    const runs = source("server/routes/erp-payroll/runs.ts");
    const lifecycle = source("server/routes/erp-payroll/runs-lifecycle.ts");
    const guidance = source("docs/phase-8d-domain-auditing.md");

    expect(runs).toContain('app.post("/api/payroll/runs"');
    expect(runs).toContain('app.patch("/api/payroll/runs/:id"');
    expect(lifecycle).toContain('app.post("/api/payroll/runs/:id/undo"');
    expect(guidance).toContain("documented safety exception");
    expect(guidance).toContain("legacy multi-step payroll mutations");
  });
});
