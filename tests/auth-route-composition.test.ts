import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compositionPath = path.resolve(process.cwd(), "server/routes/authRoutes.ts");
const legacyPath = path.resolve(process.cwd(), "server/routes/authRoutesLegacy.ts");

const focusedRegistrars = [
  "registerCoreAuthRoutes(app)",
  "registerSessionRoutes(app)",
  "registerAuthAuditLogRoutes(app)",
  "registerUserAdministrationRoutes(app)",
  "registerUserAccessRoutes(app)",
  "registerCompanyAccessRoutes(app)",
  "registerUserPresenceRoutes(app)",
  "registerExchangeRateRoutes(app)",
];

describe("auth route composition", () => {
  it("registers every focused auth domain before the compatibility boundary", () => {
    const source = fs.readFileSync(compositionPath, "utf8");
    const legacyIndex = source.indexOf("registerLegacyAuthRoutes(app)");
    expect(legacyIndex).toBeGreaterThan(-1);
    for (const registrar of focusedRegistrars) {
      expect(source.indexOf(registrar)).toBeGreaterThan(-1);
      expect(source.indexOf(registrar)).toBeLessThan(legacyIndex);
    }
  });

  it("keeps the compatibility boundary free of HTTP handlers", () => {
    const source = fs.readFileSync(legacyPath, "utf8");
    expect(source).not.toMatch(/app\.(get|post|put|patch|delete)\s*\(/);
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(12);
  });

  it("keeps security-sensitive endpoints in focused modules", () => {
    const core = fs.readFileSync(path.resolve(process.cwd(), "server/routes/auth/coreAuthRoutes.ts"), "utf8");
    const users = fs.readFileSync(path.resolve(process.cwd(), "server/routes/auth/userAdministrationRoutes.ts"), "utf8");
    const access = fs.readFileSync(path.resolve(process.cwd(), "server/routes/auth/userAccessRoutes.ts"), "utf8");
    const companies = fs.readFileSync(path.resolve(process.cwd(), "server/routes/auth/companyAccessRoutes.ts"), "utf8");
    const audit = fs.readFileSync(path.resolve(process.cwd(), "server/routes/auth/auditLogRoutes.ts"), "utf8");

    expect(core).toContain('app.post("/api/auth/login"');
    expect(core).toContain("req.session.regenerate");
    expect(core).toContain('app.post("/api/auth/confirm-password"');
    expect(users).toContain('app.post("/api/user-company-roles"');
    expect(access).toContain('app.get("/api/my-locations"');
    expect(companies).toContain('app.post("/api/auth/set-company"');
    expect(audit).toContain('requireExportAccess("exp_audit_log")');
  });
});
