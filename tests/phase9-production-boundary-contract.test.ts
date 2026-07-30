import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

function expectInOrder(source: string, values: string[]) {
  let previousIndex = -1;
  for (const value of values) {
    const index = source.indexOf(value);
    expect(index, `${value} must be present`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

describe("Phase 9 production module and startup boundaries", () => {
  it("keeps every retired route registry physically absent", () => {
    for (const retiredPath of [
      "server/routesLegacy.ts",
      "server/routes/reportsRoutesLegacy.ts",
      "server/routes/authRoutesLegacy.ts",
      "server/routes/customerRoutesLegacy.ts",
    ]) {
      expect(fs.existsSync(path.join(root, retiredPath)), retiredPath).toBe(false);
    }
  });

  it("composes authentication and report routes directly", () => {
    const auth = read("server/routes/authRoutes.ts");
    const reports = read("server/routes/reportsRoutes.ts");

    expectInOrder(auth, [
      "registerCoreAuthRoutes(app)",
      "registerSessionRoutes(app)",
      "registerAuthAuditLogRoutes(app)",
      "registerUserAdministrationRoutes(app)",
      "registerUserAccessRoutes(app)",
      "registerCompanyAccessRoutes(app)",
      "registerUserPresenceRoutes(app)",
      "registerExchangeRateRoutes(app)",
    ]);
    expectInOrder(reports, [
      "registerReportsNetProfitStatementRoutes(app)",
      "registerReportsClosingStockRoutes(app)",
      "registerDashboardAccountRoutes(app)",
      "registerReportsContainerTrackingRoutes(app)",
      "registerReportsLedgerRoutes(app)",
      "registerReportsVoucherDetailRoutes(app)",
    ]);
    expect(auth).not.toContain("authRoutesLegacy");
    expect(reports).not.toContain("reportsRoutesLegacy");
  });

  it("does not render a form-context label outside FormField", () => {
    const source = read("client/src/pages/voucher-edit/SalesEditForm.tsx");
    expect(source).toContain('<p className="text-sm font-medium leading-none">Location</p>');
    expect(source).not.toContain("<FormLabel>Location</FormLabel>");
  });

  it("uses syntax-aware repository import resolution", () => {
    const audit = read("scripts/audit-relative-imports.mjs");
    expect(audit).toContain('import ts from "typescript"');
    expect(audit).toContain("ts.createSourceFile");
    expect(audit).toContain("ts.isImportDeclaration");
    expect(audit).toContain("ts.isExportDeclaration");
    expect(audit).toContain("ts.SyntaxKind.ImportKeyword");
    expect(audit).toContain('node.expression.text === "require"');
    expect(audit).toContain("RESOLUTION_EXTENSIONS");
    expect(audit).toContain("RETIRED_MODULES");
    expect(audit).toContain("cannot resolve relative import");
    expect(audit).toContain("imports retired module");
  });

  it("runs the import audit from the existing prebuild safety command", () => {
    const prebuild = read("scripts/verify-lockfile-registry.mjs");
    expect(prebuild).toContain('import { auditRelativeImports } from "./audit-relative-imports.mjs"');
    expect(prebuild).toContain("const importReport = auditRelativeImports()");
    expect(prebuild).toContain("PRODUCTION IMPORT BOUNDARY FAILED");
  });
});
