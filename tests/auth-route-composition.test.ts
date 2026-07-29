import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compositionPath = path.resolve(process.cwd(), "server/routes/authRoutes.ts");

describe("auth route composition", () => {
  it("registers focused auth domains before the legacy registry", () => {
    const source = fs.readFileSync(compositionPath, "utf8");
    const legacyIndex = source.indexOf("registerLegacyAuthRoutes(app)");

    expect(legacyIndex).toBeGreaterThan(-1);
    expect(source.indexOf("registerSessionRoutes(app)")).toBeLessThan(legacyIndex);
    expect(source.indexOf("registerAuthAuditLogRoutes(app)")).toBeLessThan(legacyIndex);
  });

  it("keeps audit-log access in its focused module", () => {
    const focusedPath = path.resolve(process.cwd(), "server/routes/auth/auditLogRoutes.ts");
    const focusedSource = fs.readFileSync(focusedPath, "utf8");

    expect(focusedSource).toContain('app.get("/api/audit-log"');
    expect(focusedSource).toContain('requireExportAccess("exp_audit_log")');
    expect(focusedSource).toContain("resolveActiveCompanyId(req)");
  });
});
