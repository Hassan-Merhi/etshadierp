import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const compositionPath = path.resolve(root, "server/routes/reportsRoutes.ts");
const legacyPath = path.resolve(root, "server/routes/reportsRoutesLegacy.ts");

const focusedRegistrars = [
  "registerReportsNetProfitStatementRoutes(app)",
  "registerReportsClosingStockRoutes(app)",
  "registerDashboardAccountRoutes(app)",
  "registerReportsContainerTrackingRoutes(app)",
  "registerReportsLedgerRoutes(app)",
  "registerReportsVoucherDetailRoutes(app)",
];

describe("report route composition", () => {
  it("registers every focused report domain in preserved order", () => {
    const source = fs.readFileSync(compositionPath, "utf8");
    let previousIndex = -1;

    for (const registrar of focusedRegistrars) {
      const index = source.indexOf(registrar);
      expect(index, `${registrar} must be registered`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(source).not.toContain("reportsRoutesLegacy");
    expect(source).not.toContain("registerLegacyReportsRoutes");
  });

  it("keeps the retired report compatibility path deleted", () => {
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it("keeps each extracted endpoint in a focused module", () => {
    const expectedRoutes: Array<[string, string]> = [
      ["reportsContainerTrackingRoutes.ts", 'app.get("/api/dashboard/container-tracking"'],
      ["reportsLedgerRoutes.ts", 'app.get("/api/reports/ledger-monthly-summary/:accountId"'],
      ["reportsLedgerRoutes.ts", 'app.get("/api/reports/ledger-vouchers/:accountId/:year/:month"'],
      ["reportsVoucherDetailRoutes.ts", 'app.get("/api/voucher-detail/:voucherId"'],
    ];

    for (const [fileName, route] of expectedRoutes) {
      const source = fs.readFileSync(path.resolve(root, "server/routes", fileName), "utf8");
      expect(source).toContain(route);
      expect(source).toContain("requireAuth");
    }
  });
});
