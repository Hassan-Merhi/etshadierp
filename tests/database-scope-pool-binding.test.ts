import { describe, expect, it } from "vitest";

import {
  createTenantDatabaseScope,
  runWithDatabaseMaintenanceScope,
  runWithDatabaseScopeRuntimeContext,
} from "../server/services/security/databaseScopeRuntimeContext";

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;

type ScopeSnapshot = {
  maintenance: string;
  company_id: string;
  authorized_company_ids: string;
};

async function readScope(): Promise<ScopeSnapshot> {
  const { pool } = await import("../server/db");
  const result = await pool.query<ScopeSnapshot>(`
    SELECT
      current_setting('app.company_scope_maintenance', true) AS maintenance,
      current_setting('app.current_company_id', true) AS company_id,
      current_setting('app.authorized_company_ids', true) AS authorized_company_ids
  `);
  return result.rows[0];
}

describeDatabase("database pool scope binding", () => {
  it("binds the active tenant before a pooled query", async () => {
    const snapshot = await runWithDatabaseScopeRuntimeContext(createTenantDatabaseScope(101), readScope);

    expect(snapshot).toEqual({
      maintenance: "off",
      company_id: "101",
      authorized_company_ids: "",
    });
  });

  it("does not widen every pooled query merely because a secondary company was verified", async () => {
    const snapshot = await runWithDatabaseScopeRuntimeContext(createTenantDatabaseScope(101, [202]), readScope);

    expect(snapshot).toEqual({
      maintenance: "off",
      company_id: "101",
      authorized_company_ids: "",
    });
  });

  it("marks process-owned maintenance work explicitly", async () => {
    const snapshot = await runWithDatabaseMaintenanceScope("phase-3-test", readScope);

    expect(snapshot).toEqual({
      maintenance: "on",
      company_id: "",
      authorized_company_ids: "",
    });
  });

  it("clears a previously leased maintenance identity before unscoped work", async () => {
    await runWithDatabaseMaintenanceScope("phase-3-reset-probe", readScope);
    const snapshot = await readScope();

    expect(snapshot).toEqual({
      maintenance: "off",
      company_id: "",
      authorized_company_ids: "",
    });
  });

  it("refuses to elevate an active tenant request into maintenance scope", () => {
    expect(() =>
      runWithDatabaseScopeRuntimeContext(createTenantDatabaseScope(101), () =>
        runWithDatabaseMaintenanceScope("forbidden-request-elevation", () => undefined)
      )
    ).toThrow(/cannot be elevated to maintenance/i);
  });
});
