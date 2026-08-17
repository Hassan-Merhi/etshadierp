import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveDatabaseSsl } from "../server/lib/databaseSsl.mjs";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const roleName = "wave_g_rls_probe_role";
const probeTable = "wave_g_rls_probe";

async function applyMigration(client: Client) {
  const sql = await readFile(path.join(process.cwd(), "migrations/0016_company_scope_rls_readiness.sql"), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

describeDatabase("company-scope RLS runtime", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl, ssl: resolveDatabaseSsl(databaseUrl) });
    await client.connect();

    // The migration must be safely replayable: startup can execute on every boot.
    await applyMigration(client);
    await applyMigration(client);

    await client.query(`DROP TABLE IF EXISTS ${probeTable}`);
    await client.query(`DROP ROLE IF EXISTS ${roleName}`);
    await client.query(`CREATE ROLE ${roleName} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    await client.query(
      `CREATE TABLE ${probeTable} (id serial PRIMARY KEY, company_id integer NOT NULL, marker text NOT NULL)`
    );
    await client.query(`ALTER TABLE ${probeTable} ENABLE ROW LEVEL SECURITY`);
    await client.query(`CREATE POLICY ${probeTable}_company_scope_policy ON ${probeTable}
      USING (erp_company_scope_matches(company_id))
      WITH CHECK (erp_company_scope_matches(company_id))`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${probeTable} TO ${roleName}`);
    await client.query(`GRANT USAGE, SELECT ON SEQUENCE ${probeTable}_id_seq TO ${roleName}`);
    await client.query(`INSERT INTO ${probeTable} (company_id, marker) VALUES (101, 'company-a'), (202, 'company-b')`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query("RESET ROLE").catch(() => {});
    await client.query(`DROP TABLE IF EXISTS ${probeTable}`).catch(() => {});
    await client.query(`DROP ROLE IF EXISTS ${roleName}`).catch(() => {});
    await client.end();
  });

  it("installs RLS and the expected policies on every present protected table", async () => {
    const protectedTables = [
      "vouchers",
      "customers",
      "ledger_accounts",
      "bank_accounts",
      "fixed_assets",
      "stock_groups",
      "stock_items",
      "inventory",
      "voucher_entries",
    ];
    const result = await client.query(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
              EXISTS (
                SELECT 1 FROM pg_policies p
                WHERE p.schemaname = 'public'
                  AND p.tablename = c.relname
                  AND p.policyname = CASE
                    WHEN c.relname = 'voucher_entries' THEN 'voucher_entries_company_scope_policy'
                    ELSE c.relname || '_company_scope_policy'
                  END
              ) AS policy_present
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [protectedTables]
    );

    for (const row of result.rows) {
      expect(row.rls_enabled, `${row.table_name} should have RLS enabled`).toBe(true);
      expect(row.policy_present, `${row.table_name} should have a company policy`).toBe(true);
    }
  });

  it("preserves legacy access when no company context is asserted", async () => {
    await client.query(`SET ROLE ${roleName}`);
    await client.query("RESET app.current_company_id");
    const result = await client.query(`SELECT marker FROM ${probeTable} ORDER BY marker`);
    expect(result.rows.map((row) => row.marker)).toEqual(["company-a", "company-b"]);
    await client.query("RESET ROLE");
  });

  it("isolates reads and rejects cross-company writes when context is asserted", async () => {
    await client.query(`SET ROLE ${roleName}`);
    await client.query("SELECT set_config('app.current_company_id', '101', false)");
    const result = await client.query(`SELECT marker FROM ${probeTable} ORDER BY marker`);
    expect(result.rows.map((row) => row.marker)).toEqual(["company-a"]);
    await expect(
      client.query(`INSERT INTO ${probeTable} (company_id, marker) VALUES (202, 'blocked')`)
    ).rejects.toMatchObject({ code: "42501" });
    await client.query("RESET ROLE");
  });

  it("fails closed for malformed and non-positive tenant assertions", async () => {
    await client.query(`SET ROLE ${roleName}`);
    await client.query("SELECT set_config('app.current_company_id', 'garbage', false)");
    await expect(client.query(`SELECT marker FROM ${probeTable}`)).rejects.toMatchObject({ code: "22P02" });
    await client.query("SELECT set_config('app.current_company_id', '0', false)");
    await expect(client.query(`SELECT marker FROM ${probeTable}`)).rejects.toMatchObject({ code: "22023" });
    await client.query("RESET app.current_company_id");
    await client.query("RESET ROLE");
  });

  it("does not leak transaction-local company scope after commit", async () => {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_company_id', '101', true)");
    expect((await client.query("SELECT erp_current_company_id() AS company_id")).rows[0].company_id).toBe(101);
    await client.query("COMMIT");
    expect((await client.query("SELECT erp_current_company_id() AS company_id")).rows[0].company_id).toBeNull();
  });
});
