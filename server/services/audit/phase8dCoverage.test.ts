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
    "server/routes/admin/adminRepairRoutes.ts",
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
    const payroll = source("server/routes/employeeRoutes.ts");
    const guidance = source("docs/phase-8d-domain-auditing.md");

    expect(payroll).toContain('app.post("/api/payroll/runs"');
    expect(payroll).toContain('app.patch("/api/payroll/runs/:id"');
    expect(payroll).toContain('app.post("/api/payroll/runs/:id/undo"');
    expect(guidance).toContain("documented safety exception");
    expect(guidance).toContain("legacy multi-step payroll mutations");
  });
});
