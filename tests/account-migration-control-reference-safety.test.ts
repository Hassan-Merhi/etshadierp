import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const adminRoutes = readFileSync("server/routes/adminRoutes.ts", "utf8");
const safeRoutes = readFileSync("server/routes/admin/accountMigrationSafeRoutes.ts", "utf8");
const controlReferences = readFileSync(
  "server/routes/admin/accountMigrationControlReferences.ts",
  "utf8",
);

describe("account migration POS control safety", () => {
  it("registers the safe execute and undo handlers before the legacy migration routes", () => {
    expect(adminRoutes).toContain("registerAccountMigrationSafeRoutes(app)");
    expect(adminRoutes.indexOf("registerAccountMigrationSafeRoutes(app)")).toBeLessThan(
      adminRoutes.indexOf("registerImportExportRoutes(app)"),
    );
  });

  it("detaches source-company cash-account references before moving ledger accounts", () => {
    expect(controlReferences).toContain("set({ cashAccountId: null })");
    expect(controlReferences).toContain("delete(userLocationCashAccounts)");
    const detachCall = safeRoutes.indexOf(
      "const controls = await detachAccountMigrationControlReferences",
    );
    const accountMove = safeRoutes.indexOf(".update(ledgerAccounts)", detachCall);
    expect(detachCall).toBeGreaterThan(-1);
    expect(accountMove).toBeGreaterThan(detachCall);
  });

  it("persists the control snapshot and restores it during undo", () => {
    expect(safeRoutes).toContain("controls,");
    expect(safeRoutes).toContain("ACCOUNT_MIGRATION_EXECUTE_SAFE");
    expect(safeRoutes).toContain("restoreAccountMigrationControlReferences");
    expect(controlReferences).toContain("insert(userLocationCashAccounts)");
  });

  it("keeps legacy undo compatibility for migrations made before the safety fix", () => {
    expect(safeRoutes).toContain("if (!audit) return next()");
    expect(safeRoutes).toContain("if (!saved) return next()");
  });
});
