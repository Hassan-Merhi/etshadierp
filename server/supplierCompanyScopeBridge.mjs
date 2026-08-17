import "./factoryBilingualSchemaBridge.mjs";
import "./factoryTrilingualSchemaBridge.mjs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { resolveDatabaseSsl } from "./lib/databaseSsl.mjs";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Teach supertest's HTTP client to hand back XLSX responses as a Buffer instead
 * of mangling them as text. This exists purely for the test suite.
 *
 * It has to be optional, because `npm start` preloads this bridge in production
 * via --import, and superagent arrives only as a dependency of supertest — a
 * devDependency. A static import here made a production-only install fail to
 * boot with ERR_MODULE_NOT_FOUND before the process ever reached the migration
 * work this bridge is actually here to do.
 */
try {
  const { default: superagent } = await import("superagent");
  superagent.parse[XLSX_MIME] = (response, callback) => {
    const chunks = [];
    response.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    response.on("end", () => callback(null, Buffer.concat(chunks)));
    response.on("error", (error) => callback(error));
  };
} catch {
  // superagent absent — a production install with no devDependencies. There is
  // no supertest to serve, so there is nothing to register.
}

const INSTALL_KEY = Symbol.for("erp.supplier-company-scope-migration.applied");

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;

  const { Pool } = pg;
  let connectionString;

  if (process.env.DATABASE_URL) {
    connectionString = process.env.DATABASE_URL;
  } else if (
    process.env.PGHOST &&
    process.env.PGPORT &&
    process.env.PGUSER &&
    process.env.PGPASSWORD &&
    process.env.PGDATABASE
  ) {
    const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
    connectionString = `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }

  if (!connectionString) {
    throw new Error(
      "Supplier company-scope migration could not start because no PostgreSQL configuration is available."
    );
  }

  const migrationSql = await readFile(
    new URL("../migrations/20260728_001_supplier_company_scope.sql", import.meta.url),
    "utf8"
  );

  const pool = new Pool({
    connectionString,
    ssl: resolveDatabaseSsl(connectionString),
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  });

  // The INSTALL_KEY guard above is per-process, and Vitest gives every test
  // file its own worker. So N processes reach this migration at once, each
  // taking the same table locks in whatever order their statements happen to
  // interleave, and Postgres resolves the tie by killing one with
  // "deadlock detected" — which this bridge rethrows, failing a test file that
  // has nothing to do with suppliers. A session-level advisory lock makes the
  // processes queue instead of collide; the first applies the migration and the
  // rest re-run it against a schema that already has everything, which the
  // migration is written to tolerate.
  const MIGRATION_LOCK_KEY = 8142690331;

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(migrationSql);
    } finally {
      // Session-scoped, so pool.end() would release it anyway; unlocking here
      // frees the next waiter without waiting for the pool to drain.
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
      client.release();
    }
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message: "Supplier company-scope migration applied",
        module: "supplier-company-scope-migration",
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        message: "Supplier company-scope migration failed",
        module: "supplier-company-scope-migration",
        error: error instanceof Error ? error.message : String(error),
      })
    );
    throw error;
  } finally {
    await pool.end();
  }
}
