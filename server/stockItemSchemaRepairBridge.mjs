import process from "node:process";
import pg from "pg";
import { resolveDatabaseSsl } from "./lib/databaseSsl.mjs";

const { Client } = pg;
const INSTALL_KEY = Symbol.for("erp.stock-item-schema-repair.applied");
const STARTUP_LOCK_KEY = 741_220_263;

const REQUIRED_COLUMNS = [
  ["reorder_level", "numeric(15,3) DEFAULT 0"],
  ["selling_price", "numeric(15,2) DEFAULT 0"],
  ["active", "boolean NOT NULL DEFAULT true"],
  ["deleted_at", "timestamp"],
  ["created_at", "timestamp NOT NULL DEFAULT now()"],
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
      module: "stock-item-schema-repair",
      action: "startup-ensure",
      ...extra,
    })
  );
}

export async function ensureStockItemSchemaReadiness() {
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error("Stock-item schema repair could not start because no PostgreSQL configuration is available.");
  }

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

    const tableCheck = await client.query("SELECT to_regclass('public.stock_items') AS table_name");
    if (!tableCheck.rows[0]?.table_name) {
      await client.query("COMMIT");
      log("INFO", "stock_items does not exist yet; deferred to normal startup migrations");
      return;
    }

    // stock_items is protected by FORCE RLS in production. This is a dedicated
    // startup-only schema repair connection, so establish the same explicit
    // maintenance capability used by the reviewed migration path.
    await client.query(
      `SELECT
         set_config('app.company_scope_maintenance', 'on', true),
         set_config('app.current_company_id', '', true),
         set_config('app.authorized_company_ids', '', true)`
    );

    for (const [columnName, columnDefinition] of REQUIRED_COLUMNS) {
      const exists = await client.query(
        `SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'stock_items'
            AND column_name = $1`,
        [columnName]
      );
      if (exists.rowCount) continue;

      // Both the identifier and definition come exclusively from the static
      // REQUIRED_COLUMNS list above; no request/user input reaches this DDL.
      await client.query(`ALTER TABLE stock_items ADD COLUMN ${columnName} ${columnDefinition}`);
      log("INFO", "Added missing stock_items column", { columnName });
    }

    const readiness = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stock_items'
          AND column_name = ANY($1::text[])`,
      [REQUIRED_COLUMNS.map(([name]) => name)]
    );
    const present = new Set(readiness.rows.map((row) => row.column_name));
    const missing = REQUIRED_COLUMNS.map(([name]) => name).filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(`stock_items schema is still missing required columns: ${missing.join(", ")}`);
    }

    await client.query("COMMIT");
    log("INFO", "Stock-item schema readiness verified", {
      requiredColumns: REQUIRED_COLUMNS.length,
      startupMigrationsEnabled: process.env.RUN_STARTUP_MIGRATIONS !== "false",
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    log("ERROR", "Stock-item schema readiness failed; aborting startup", {
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
  await ensureStockItemSchemaReadiness();
}
