import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Phase 5 routesLegacy extraction", () => {
  it("keeps routesLegacy compatibility-only", () => {
    const legacy = read("server/routesLegacy.ts");
    expect(legacy).toContain("registerApplicationRoutes(app)");
    expect(legacy).not.toContain("app.get(");
    expect(legacy).not.toContain("app.post(");
    expect(legacy).not.toContain("app.use(");
    expect(legacy.split("\n").length).toBeLessThanOrEqual(14);
  });

  it("composes every extracted registrar", () => {
    const root = read("server/routes/applicationRoutes.ts");
    for (const marker of [
      "registerPermissionBoundaryRoutes(app)",
      "registerLegacyHealthRoutes(app)",
      "registerIntercompanyPosConfigRoutes(app)",
      "registerErpWorkerDocumentRoutes(app)",
      "registerSalaryAdvanceRoutes(app)",
      "return createServer(app)",
    ]) {
      expect(root).toContain(marker);
    }
  });

  it("preserves the extracted endpoint families", () => {
    expect(read("server/routes/pos/intercompanyPosConfigRoutes.ts")).toContain(
      "/api/intercompany-pos-config/dest-accounts",
    );
    expect(read("server/routes/employees/erpWorkerDocumentRoutes.ts")).toContain(
      "/api/erp-worker-docs/:id/download",
    );
    const advances = read("server/routes/employees/salaryAdvanceRoutes.ts");
    expect(advances).toContain("/api/salary-advances/reconcile");
    expect(advances).toContain("/api/salary-advance-deductions");
  });
});
