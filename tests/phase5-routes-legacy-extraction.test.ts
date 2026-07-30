import { existsSync, readFileSync } from "node:fs";

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("Phase 5 routesLegacy extraction", () => {
  it("keeps the retired routesLegacy path physically absent", () => {
    expect(existsSync(new URL("../server/routesLegacy.ts", import.meta.url))).toBe(false);
    const publicRoutes = read("server/routes.ts");
    expect(publicRoutes).toContain("registerApplicationRoutes(app)");
    expect(publicRoutes).not.toContain("registerLegacyRoutes");
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

  it("records the final physical retirement boundary", () => {
    const boundary = JSON.parse(read("config/legacy-route-boundaries.json")) as {
      version: number;
      description: string;
      files: unknown[];
    };
    expect(boundary.version).toBeGreaterThanOrEqual(9);
    expect(boundary.description).toContain("removed");
    expect(boundary.files).toEqual([]);
  });
});
