import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.resolve(root, relativePath), "utf8");

function expectInOrder(source: string, values: string[]) {
  let previousIndex = -1;
  for (const value of values) {
    const index = source.indexOf(value);
    expect(index, `${value} must be present`).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

const retiredFiles = [
  "server/routesLegacy.ts",
  "server/routes/authRoutesLegacy.ts",
  "server/routes/customerRoutesLegacy.ts",
  "server/routes/reportsRoutesLegacy.ts",
];

describe("Phase 2 backend module separation", () => {
  it("keeps the public route entry point as a focused composition root", () => {
    const source = read("server/routes.ts");
    expectInOrder(source, ["registerOperationalMonitoringRoutes(app)", "registerApplicationRoutes(app)"]);
    expect(source).not.toContain("registerLegacyRoutes");
    expect(source).not.toContain("app.get(");
    expect(source).not.toContain("app.post(");
    expect(source.split("\n").length).toBeLessThanOrEqual(30);
  });

  it("keeps supplier routes transport-only", () => {
    const source = read("server/routes/supplierRoutes.ts");
    expect(source).toContain("supplierService");
    expect(source).not.toContain('from "../db"');
    expect(source).not.toContain('from "../storage"');
    expect(source).not.toContain("@shared/schema");
    expect(source).not.toContain("drizzle-orm");
  });

  it("composes inventory read, adjustment, and movement modules", () => {
    const source = read("server/routes/inventoryRoutes.ts");
    expectInOrder(source, [
      "registerInventoryListRoutes(app)",
      "registerInventoryQuickAdjustRoutes(app)",
      "registerInventoryMovementRoutes(app)",
    ]);
    expect(source).not.toContain("db.transaction");
  });

  it("composes customer domains directly without a compatibility registrar", () => {
    const source = read("server/routes/customerRoutes.ts");
    expectInOrder(source, [
      "registerCustomerMasterRoutes(app)",
      "registerContainerSalesRoutes(app)",
      "registerCompanyTransferRoutes(app)",
    ]);
    expect(source).not.toContain("Legacy");
  });

  it("preserves container-sale and transfer accounting invariants", () => {
    const containerSales = read("server/routes/containers/containerSalesService.ts");
    const interCompany = read("server/routes/transfers/interCompanyTransferService.ts");
    const simpleTransfer = read("server/routes/transfers/simpleCompanyTransferService.ts");

    expect(containerSales).toContain("db.transaction");
    expect(containerSales).toContain('status: "SOLD"');
    expect(interCompany).toContain("IC-TO-");
    expect(interCompany).toContain("IC-FROM-");
    expect(simpleTransfer).toContain("TRANSFER-CLEARING");
    expect(simpleTransfer).toContain("deleteTransferVoucher");
  });

  it("composes auth and reporting domains directly", () => {
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
    expect(auth).not.toContain("LegacyAuth");
    expect(reports).not.toContain("LegacyReports");
  });

  it("keeps all retired route registry paths deleted", () => {
    for (const relativePath of retiredFiles) {
      expect(fs.existsSync(path.resolve(root, relativePath)), relativePath).toBe(false);
    }
  });
});
