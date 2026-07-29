import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function expectBefore(source: string, first: string, second: string) {
  expect(source.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(second)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
}

describe("Phase 2 backend module separation", () => {
  it("keeps the public route entry point as a composition root", () => {
    const source = read("server/routes.ts");
    expect(source).toContain("registerLegacyRoutes(app)");
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
    expect(source).toContain("registerInventoryListRoutes(app)");
    expect(source).toContain("registerInventoryQuickAdjustRoutes(app)");
    expect(source).toContain("registerInventoryMovementRoutes(app)");
    expect(source).not.toContain("db.transaction");
  });

  it("registers focused customer domains before compatibility routes", () => {
    const source = read("server/routes/customerRoutes.ts");
    expectBefore(source, "registerCustomerMasterRoutes(app)", "registerCustomerLegacyRoutes(app)");
    expectBefore(source, "registerContainerSalesRoutes(app)", "registerCustomerLegacyRoutes(app)");
    expectBefore(source, "registerCompanyTransferRoutes(app)", "registerCustomerLegacyRoutes(app)");
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

  it("registers session and focused reporting routes before compatibility routes", () => {
    const auth = read("server/routes/authRoutes.ts");
    const reports = read("server/routes/reportsRoutes.ts");

    expectBefore(auth, "registerSessionRoutes(app)", "registerLegacyAuthRoutes(app)");
    expectBefore(
      reports,
      "registerReportsNetProfitStatementRoutes(app)",
      "registerLegacyReportsRoutes(app)",
    );
    expectBefore(reports, "registerReportsClosingStockRoutes(app)", "registerLegacyReportsRoutes(app)");
    expectBefore(reports, "registerDashboardAccountRoutes(app)", "registerLegacyReportsRoutes(app)");
  });

  it("keeps compatibility registries explicit and reviewable", () => {
    for (const path of [
      "server/routesLegacy.ts",
      "server/routes/authRoutesLegacy.ts",
      "server/routes/customerRoutesLegacy.ts",
      "server/routes/reportsRoutesLegacy.ts",
    ]) {
      expect(read(path)).toContain("export");
    }
  });
});
