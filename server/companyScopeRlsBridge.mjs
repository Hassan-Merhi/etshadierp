import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { resolveDatabaseSsl } from "./lib/databaseSsl.mjs";

const { Client } = pg;
const INSTALL_KEY = Symbol.for("erp.company-scope-rls-readiness.applied");
const STARTUP_LOCK_KEY = 741_220_261;
const REQUIRED_DIRECT_TABLES = [
  "vouchers",
  "customers",
  "ledger_accounts",
  "bank_accounts",
  "fixed_assets",
  "stock_groups",
  "stock_items",
  "inventory",
];

function resolveConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE) {
    return `postgresql://${encodeURIComponent(process.env.PGUSER)}:${encodeURIComponent(process.env.PGPASSWORD)}@${process.env.PGHOST}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE}`;
  }
  return "";
}

function log(level, message, extra = {}) {
  const method = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
  console[method](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      module: "company-scope-rls",
      action: "startup-ensure",
      ...extra,
    })
  );
}

export async function ensureCompanyScopeRlsReadiness() {
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error("Company-scope RLS migration could not start because no PostgreSQL configuration is available.");
  }

  const migrationSql = await readFile(
    new URL("../migrations/0016_company_scope_rls_readiness.sql", import.meta.url),
    "utf8"
  );
  const client = new Client({
    connectionString,
    ssl: resolveDatabaseSsl(connectionString),
    connectionTimeoutMillis: 15_000,
  });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '90s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [STARTUP_LOCK_KEY]);
    await client.query(migrationSql);

    const functionCheck = await client.query(`
      SELECT
        to_regprocedure('erp_current_company_id()') IS NOT NULL AS current_company_function,
        to_regprocedure('erp_company_scope_matches(integer)') IS NOT NULL AS scope_match_function
    `);
    const functionState = functionCheck.rows[0] || {};
    if (!functionState.current_company_function || !functionState.scope_match_function) {
      throw new Error("Company-scope RLS helper functions were not installed.");
    }

    const relationCheck = await client.query(
      `
        SELECT
          c.relname AS table_name,
          c.relrowsecurity AS rls_enabled,
          c.relforcerowsecurity AS rls_forced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY($1::text[])
      `,
      [[...REQUIRED_DIRECT_TABLES, "voucher_entries"]]
    );
    const relationState = new Map(
      relationCheck.rows.map((row) => [
        row.table_name,
        { enabled: row.rls_enabled === true, forced: row.rls_forced === true },
      ])
    );
    const existingTables = relationCheck.rows.map((row) => row.table_name);
    const rlsDisabled = existingTables.filter((tableName) => relationState.get(tableName)?.enabled !== true);
    if (rlsDisabled.length > 0) {
      throw new Error(`RLS was not enabled on: ${rlsDisabled.join(", ")}`);
    }

    const rlsNotForced = existingTables.filter((tableName) => relationState.get(tableName)?.forced !== true);
    if (rlsNotForced.length > 0) {
      throw new Error(`RLS was not forced on: ${rlsNotForced.join(", ")}`);
    }

    const policyCheck = await client.query(
      `
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
            (tablename = ANY($1::text[]) AND policyname = tablename || '_company_scope_policy')
            OR (tablename = 'voucher_entries' AND policyname = 'voucher_entries_company_scope_policy')
          )
      `,
      [REQUIRED_DIRECT_TABLES]
    );
    const policyTables = new Set(policyCheck.rows.map((row) => row.tablename));
    const missingPolicies = existingTables.filter((tableName) => !policyTables.has(tableName));
    if (missingPolicies.length > 0) {
      throw new Error(`Company-scope policy was not installed on: ${missingPolicies.join(", ")}`);
    }

    await client.query("COMMIT");
    log("INFO", "Company-scope RLS readiness verified", {
      tablesPresent: existingTables.length,
      policiesPresent: policyCheck.rows.length,
      forcedTables: existingTables.length,
      startupMigrationsEnabled: process.env.RUN_STARTUP_MIGRATIONS !== "false",
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    log("ERROR", "Company-scope RLS readiness failed; aborting startup", {
      errorCode: error?.code,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;
  await ensureCompanyScopeRlsReadiness();
}
