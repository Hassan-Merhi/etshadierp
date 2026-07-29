import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compositionPath = path.resolve(process.cwd(), "server/routes/reportsRoutes.ts");

const focusedRegistrars = [
  "registerReportsNetProfitStatementRoutes(app)",
  "registerReportsClosingStockRoutes(app)",
  "registerDashboardAccountRoutes(app)",
  "registerReportsContainerTrackingRoutes(app)",
  "registerReportsLedgerRoutes(app)",
  "registerReportsVoucherDetailRoutes(app)",
];

describe("report route composition", () => {
  it("registers every focused report domain before the compatibility boundary", () => {
    const source = fs.readFileSync(compositionPath, "utf8");
    const legacyIndex = source.indexOf("registerLegacyReportsRoutes(app)");

    expect(legacyIndex).toBeGreaterThan(-1);
    for (const registrar of focusedRegistrars) {
      const registrarIndex = source.indexOf(registrar);
      expect(registrarIndex, `${registrar} must be registered`).toBeGreaterThan(-1);
      expect(registrarIndex, `${registrar} must precede the legacy boundary`).toBeLessThan(legacyIndex);
    }
  });

  it("keeps migrated endpoints out of the legacy compatibility file", () => {
    const legacyPath = path.resolve(process.cwd(), "server/routes/reportsRoutesLegacy.ts");
    const legacySource = fs.readFileSync(legacyPath, "utf8");

    for (const method of ["get", "post", "put", "patch", "delete"]) {
      expect(legacySource).not.toContain(`app.${method}(`);
    }
  });

  it("keeps each extracted endpoint in a focused module", () => {
    const expectedRoutes: Array<[string, string]> = [
      ["reportsContainerTrackingRoutes.ts", 'app.get("/api/dashboard/container-tracking"'],
      ["reportsLedgerRoutes.ts", 'app.get("/api/reports/ledger-monthly-summary/:accountId"'],
      ["reportsLedgerRoutes.ts", 'app.get("/api/reports/ledger-vouchers/:accountId/:year/:month"'],
      ["reportsVoucherDetailRoutes.ts", 'app.get("/api/voucher-detail/:voucherId"'],
    ];

    for (const [fileName, route] of expectedRoutes) {
      const source = fs.readFileSync(path.resolve(process.cwd(), "server/routes", fileName), "utf8");
      expect(source).toContain(route);
      expect(source).toContain("requireAuth");
    }
  });
});
