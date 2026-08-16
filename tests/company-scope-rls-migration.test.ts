/**
 * Migration 0016 actually isolates tenants — proven by running it.
 *
 * `0016_company_scope_rls_readiness.sql` installs row-level security on the
 * eight tables that carry company_id plus voucher_entries, and it is
 * deliberately not applied automatically: the file says so, the runner refuses
 * to run without an explicit confirmation, and the production start command
 * does not invoke it. That is the right call for a policy change of this size.
 *
 * It also meant nobody had ever executed it. The only tests it had read the SQL
 * as text and asserted that certain words appeared in it, which proves the file
 * says "CREATE POLICY" and nothing about whether the policy isolates anything.
 * The day it is applied is the worst possible day to discover that a predicate
 * is inverted, that the compatibility fallback swallows a malformed tenant
 * assertion, or that voucher_entries — which has no company_id of its own — is
 * reachable across companies through its parent.
 *
 * So this runs it. Against a throwaway database, as an ordinary non-superuser
 * role (a superuser bypasses RLS entirely, so a test that used one would pass
 * no matter what the policies said), with rows belonging to two companies. The
 * scratch database is created and dropped here and shares nothing with the
 * suite database.
 */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION_SQL = readFileSync(
  path.join(process.cwd(), "migrations", "0016_company_scope_rls_readiness.sql"),
  "utf8"
);

const SCRATCH_DATABASE = "rls_migration_probe";
const PROBE_ROLE = "rls_migration_probe_role";
const PROBE_PASSWORD = "rls_migration_probe_password";

const HOME_COMPANY = 7;
const OTHER_COMPANY = 8;

/**
 * The scratch database on the same server, with everything else unchanged.
 *
 * The role goes in the URL rather than in the client options: node-postgres
 * applies the connection string after the option object, so a `user` option
 * beside a connection string that names postgres connects as postgres — which
 * would have made every assertion below pass as a superuser bypassing RLS.
 */
function scratchConnectionString(database: string, as?: { user: string; password: string }): string {
  const base = process.env.DATABASE_URL ?? "";
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (as) {
    url.username = as.user;
    url.password = as.password;
  }
  return url.toString();
}

function sslFor(connectionString: string): false | { rejectUnauthorized: boolean } {
  const localSocket = process.env.PGSSLMODE === "disable" || connectionString.includes("host=%2Ftmp");
  return localSocket ? false : { rejectUnauthorized: false };
}

async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString, ssl: sslFor(connectionString) });
  await client.connect();
  return client;
}

/**
 * The subset of the real schema the migration names: enough columns for the
 * policies to compile and for a row to belong to a company. Building this by
 * hand rather than importing the production schema keeps the test about the
 * policy predicates rather than about 200 unrelated columns.
 */
const SCRATCH_SCHEMA = `
  CREATE TABLE vouchers (id serial PRIMARY KEY, company_id integer NOT NULL, voucher_number text);
  CREATE TABLE customers (id serial PRIMARY KEY, company_id integer NOT NULL, name text);
  CREATE TABLE ledger_accounts (id serial PRIMARY KEY, company_id integer NOT NULL, name text);
  CREATE TABLE bank_accounts (id serial PRIMARY KEY, company_id integer NOT NULL, name text);
  CREATE TABLE fixed_assets (id serial PRIMARY KEY, company_id integer NOT NULL, name text);
  CREATE TABLE stock_groups (id serial PRIMARY KEY, company_id integer NOT NULL, name text);
  CREATE TABLE stock_items (id serial PRIMARY KEY, company_id integer NOT NULL, name text);
  CREATE TABLE inventory (id serial PRIMARY KEY, company_id integer NOT NULL, quantity numeric);
  CREATE TABLE voucher_entries (id serial PRIMARY KEY, voucher_id integer NOT NULL REFERENCES vouchers(id), amount numeric);
`;

let admin: Client | null = null;
let probe: Client | null = null;
let available = false;

/** Every table the migration puts a company_scope policy on. */
const SCOPED_TABLES = [
  "vouchers",
  "customers",
  "ledger_accounts",
  "bank_accounts",
  "fixed_assets",
  "stock_groups",
  "stock_items",
  "inventory",
];

async function scopeTo(value: string | null): Promise<void> {
  // Session-level, not transaction-local, so each test states its own scope and
  // no test inherits one. Production uses SET LOCAL inside a transaction; the
  // policy reads the same setting either way.
  if (value === null) {
    await probe!.query("SELECT set_config('app.current_company_id', '', false)");
    return;
  }
  await probe!.query("SELECT set_config('app.current_company_id', $1, false)", [value]);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;

  const server = await connect(process.env.DATABASE_URL);
  try {
    await server.query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE}`);
    await server.query(`CREATE DATABASE ${SCRATCH_DATABASE}`);
    await server.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
    await server.query(`CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'`);
  } finally {
    await server.end();
  }

  const scratchUrl = scratchConnectionString(SCRATCH_DATABASE);
  admin = await connect(scratchUrl);
  await admin.query(SCRATCH_SCHEMA);
  await admin.query(MIGRATION_SQL);

  await admin.query(`INSERT INTO vouchers (id, company_id, voucher_number) VALUES
    (1, ${HOME_COMPANY}, 'HOME-1'), (2, ${OTHER_COMPANY}, 'OTHER-1')`);
  await admin.query(`INSERT INTO voucher_entries (id, voucher_id, amount) VALUES
    (1, 1, '100'), (2, 2, '250')`);
  for (const table of SCOPED_TABLES) {
    if (table === "vouchers") continue;
    const column = table === "inventory" ? "quantity" : "name";
    const values = table === "inventory" ? ["5", "9"] : ["'home'", "'other'"];
    await admin.query(
      `INSERT INTO ${table} (company_id, ${column}) VALUES (${HOME_COMPANY}, ${values[0]}), (${OTHER_COMPANY}, ${values[1]})`
    );
  }

  // The probe deliberately does not own these tables: RLS is skipped for the
  // owner unless FORCE is set, and the migration explicitly does not FORCE.
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${PROBE_ROLE}`);

  probe = await connect(scratchConnectionString(SCRATCH_DATABASE, { user: PROBE_ROLE, password: PROBE_PASSWORD }));
  const who = await probe.query("SELECT usesuper FROM pg_user WHERE usename = current_user");
  // If this role were a superuser every assertion below would pass vacuously.
  expect(who.rows[0]?.usesuper, "the probe role must not bypass RLS").toBe(false);

  available = true;
}, 60_000);

afterAll(async () => {
  await probe?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (!process.env.DATABASE_URL) return;

  const server = await connect(process.env.DATABASE_URL).catch(() => null);
  if (!server) return;
  try {
    await server.query(`DROP DATABASE IF EXISTS ${SCRATCH_DATABASE}`).catch(() => {});
    await server.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`).catch(() => {});
  } finally {
    await server.end().catch(() => {});
  }
}, 60_000);

describe("company scope RLS migration 0016", () => {
  it("leaves every row readable while no transaction states a company", async () => {
    expect(available).toBe(true);
    await scopeTo(null);

    for (const table of SCOPED_TABLES) {
      const { rows } = await probe!.query(`SELECT count(*)::int AS total FROM ${table}`);
      // This is the compatibility promise that makes the migration safe to apply
      // before every write path adopts SET LOCAL. If it broke, applying 0016
      // would blank the application rather than isolate it.
      expect(rows[0].total, `${table} must stay fully visible without a company setting`).toBe(2);
    }
  });

  it("hides another company's rows the moment a company is stated", async () => {
    expect(available).toBe(true);
    await scopeTo(String(HOME_COMPANY));

    for (const table of SCOPED_TABLES) {
      const { rows } = await probe!.query(`SELECT company_id FROM ${table}`);
      expect(
        rows.map((row) => row.company_id),
        `${table} leaked another company's rows`
      ).toEqual([HOME_COMPANY]);
    }
  });

  it("refuses to write a row into another company", async () => {
    expect(available).toBe(true);
    await scopeTo(String(HOME_COMPANY));

    // A read-only policy would let a mis-scoped write plant a row that its own
    // company can then never see — the worst of both failures.
    await expect(
      probe!.query(`INSERT INTO customers (company_id, name) VALUES (${OTHER_COMPANY}, 'smuggled')`)
    ).rejects.toThrow(/row-level security/i);

    await expect(
      probe!.query(`UPDATE customers SET company_id = ${OTHER_COMPANY} WHERE company_id = ${HOME_COMPANY}`)
    ).rejects.toThrow(/row-level security/i);
  });

  it("accepts a write that stays inside the stated company", async () => {
    expect(available).toBe(true);
    await scopeTo(String(HOME_COMPANY));

    await probe!.query(`INSERT INTO customers (company_id, name) VALUES (${HOME_COMPANY}, 'legitimate')`);
    const { rows } = await probe!.query(`SELECT count(*)::int AS total FROM customers`);
    expect(rows[0].total).toBe(2);

    await probe!.query(`DELETE FROM customers WHERE name = 'legitimate'`);
  });

  it("fails closed on a malformed company setting instead of reading everything", async () => {
    expect(available).toBe(true);
    await scopeTo("not-a-number");

    // The dangerous alternative is treating an unparseable assertion as "no
    // assertion", which turns a corrupted tenant context into full visibility.
    await expect(probe!.query("SELECT count(*) FROM vouchers")).rejects.toThrow(/invalid input syntax/i);
  });

  it("rejects a non-positive company id rather than scoping to nothing", async () => {
    expect(available).toBe(true);

    for (const value of ["0", "-1"]) {
      await scopeTo(value);
      await expect(probe!.query("SELECT count(*) FROM vouchers")).rejects.toMatchObject({
        code: "22023",
      });
    }
  });

  it("scopes voucher entries through their parent voucher", async () => {
    expect(available).toBe(true);
    await scopeTo(String(HOME_COMPANY));

    // voucher_entries carries no company_id, so it is only isolated if the
    // policy walks the parent. This is the ledger detail rows — the table where
    // a leak is both most valuable to an attacker and least visible.
    const { rows } = await probe!.query("SELECT voucher_id FROM voucher_entries");
    expect(rows.map((row) => row.voucher_id)).toEqual([1]);

    await expect(probe!.query("INSERT INTO voucher_entries (voucher_id, amount) VALUES (2, '999')")).rejects.toThrow(
      /row-level security/i
    );
  });

  it("can be applied twice without stacking duplicate policies", async () => {
    expect(available).toBe(true);
    await admin!.query(MIGRATION_SQL);

    const { rows } = await admin!.query(
      `SELECT tablename, count(*)::int AS policies FROM pg_policies
       WHERE schemaname = 'public' AND policyname LIKE '%_company_scope_policy'
       GROUP BY tablename ORDER BY tablename`
    );

    // Two policies on one table are OR-ed, so a re-run that stacked a stale
    // permissive copy would quietly restore cross-company visibility.
    expect(rows).toHaveLength(SCOPED_TABLES.length + 1);
    for (const row of rows) {
      expect(row.policies, `${row.tablename} has ${row.policies} scope policies`).toBe(1);
    }

    await scopeTo(String(HOME_COMPANY));
    const { rows: after } = await probe!.query("SELECT company_id FROM vouchers");
    expect(after.map((row) => row.company_id)).toEqual([HOME_COMPANY]);
  });
});
