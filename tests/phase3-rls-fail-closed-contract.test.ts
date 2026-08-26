import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function walk(relativeDirectory: string): string[] {
  const directory = path.join(root, relativeDirectory);
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name).replaceAll(path.sep, "/");
    if (entry.isDirectory()) files.push(...walk(relativePath));
    else if (entry.isFile() && /\.(?:ts|mjs)$/.test(entry.name)) files.push(relativePath);
  }

  return files;
}

describe("Phase 3 RLS fail-closed contract", () => {
  it("does not retain the legacy missing-scope allow-all predicate", () => {
    const migration = read("migrations/0016_company_scope_rls_readiness.sql");

    expect(migration).toContain("app.current_company_id is required for tenant data access");
    expect(migration).toContain("erp_company_scope_maintenance_enabled()");
    expect(migration).toContain("erp_authorized_company_ids()");
    expect(migration).not.toMatch(/erp_current_company_id\(\)\s+IS\s+NULL\s+OR/i);
    expect(migration).not.toMatch(/current_company_id\s+IS\s+NULL\s+OR/i);
  });

  it("binds shared pool leases to an explicit tenant or maintenance state", () => {
    const database = read("server/db.ts");

    expect(database).toContain("getDatabaseScopeRuntimeContext");
    expect(database).toContain("app.company_scope_maintenance");
    expect(database).toContain("app.current_company_id");
    expect(database).toContain("app.authorized_company_ids");
    expect(database).toContain('signature: `tenant:${context.companyId}`');
    expect(database).toContain('authorizedCompanyIds: ""');
  });

  it("installs tenant database scope only after canonical request authorization", () => {
    const boundary = read("server/middleware/tenantIsolationBoundary.ts");

    expect(boundary).toContain("await assertCompaniesAccess(context.userId, secondaryCompanyIds)");
    expect(boundary).toContain("createTenantDatabaseScope(context.companyId, secondaryCompanyIds)");
    expect(boundary).toContain("runWithDatabaseScopeRuntimeContext(databaseScope, () => next())");
  });

  it("keeps the maintenance capability out of request routes and middleware", () => {
    const offenders = walk("server")
      .filter((file) => file.startsWith("server/routes/") || file.startsWith("server/middleware/"))
      .filter((file) => read(file).includes("runWithDatabaseMaintenanceScope"));

    expect(offenders).toEqual([]);
  });

  it("requires process-owned startup and scheduler work to opt into maintenance scope", () => {
    const startup = read("server/startupMigrationCoordinator.ts");
    const scheduler = read("server/services/scheduler/schedulerTickGuard.ts");
    const recovery = read("server/services/scheduler/daily-export.ts");

    expect(startup).toContain("app.company_scope_maintenance");
    expect(startup).toContain('["on", "", ""]');
    expect(scheduler).toContain("runWithDatabaseMaintenanceScope(`scheduler:${action}`, run)");
    expect(recovery).toContain('runWithDatabaseMaintenanceScope("daily-export-recovery"');
  });
});
