import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

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
    connectionString =
      `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}` +
      `@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }

  if (!connectionString) {
    throw new Error(
      "Supplier company-scope migration could not start because no PostgreSQL configuration is available."
    );
  }

  const isLocalReplitDB =
    process.env.PGHOST === "helium" || connectionString.includes("@helium:");
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;
  const isTestEnvironment = process.env.NODE_ENV === "test";

  const pool = new Pool({
    connectionString,
    ssl: requiresSSL ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  });

  try {
    if (isTestEnvironment) {
      // Disposable test databases begin empty, before any parent company or
      // supplier fixture exists. Install only the structural contract here;
      // production startup still runs the complete audited backfill below.
      await pool.query(`
        ALTER TABLE suppliers
          ADD COLUMN IF NOT EXISTS company_id INTEGER;

        ALTER TABLE suppliers
          DROP CONSTRAINT IF EXISTS suppliers_code_unique;

        DROP INDEX IF EXISTS suppliers_code_unique;

        CREATE INDEX IF NOT EXISTS suppliers_company_idx
          ON suppliers(company_id);

        CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_code_unique
          ON suppliers(company_id, code)
          WHERE company_id IS NOT NULL;

        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
              FROM pg_constraint
             WHERE conname = 'suppliers_company_id_fkey'
               AND conrelid = 'suppliers'::regclass
          ) THEN
            ALTER TABLE suppliers
              ADD CONSTRAINT suppliers_company_id_fkey
              FOREIGN KEY (company_id)
              REFERENCES companies(id)
              ON DELETE RESTRICT;
          END IF;
        END
        $$;
      `);

      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          message: "Supplier company-scope test schema applied",
          module: "supplier-company-scope-migration",
        })
      );
    } else {
      const migrationSql = await readFile(
        new URL("../migrations/20260728_001_supplier_company_scope.sql", import.meta.url),
        "utf8"
      );
      await pool.query(migrationSql);
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          message: "Supplier company-scope migration applied",
          module: "supplier-company-scope-migration",
        })
      );
    }
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
