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
  it("registers every focused report domain in the composition root", () => {
    const source = fs.readFileSync(compositionPath, "utf8");

    for (const registrar of focusedRegistrars) {
      const registrarIndex = source.indexOf(registrar);
      expect(registrarIndex, `${registrar} must be registered`).toBeGreaterThan(-1);
    }
  });

  it("keeps the report entry point free of retired compatibility registrars", () => {
    const source = fs.readFileSync(compositionPath, "utf8");

    expect(source).not.toContain("registerLegacyReportsRoutes");
    expect(source).not.toContain("reportsRoutesLegacy");
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
