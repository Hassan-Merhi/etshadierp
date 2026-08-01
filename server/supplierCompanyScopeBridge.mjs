import "./factoryBilingualSchemaBridge.mjs";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import superagent from "superagent";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

superagent.parse[XLSX_MIME] = (response, callback) => {
  const chunks = [];
  response.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error) => callback(error));
};

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

  const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;
  const migrationSql = await readFile(
    new URL("../migrations/20260728_001_supplier_company_scope.sql", import.meta.url),
    "utf8"
  );

  const pool = new Pool({
    connectionString,
    ssl: requiresSSL ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 1_000,
    allowExitOnIdle: true,
  });

  try {
    await pool.query(migrationSql);
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
