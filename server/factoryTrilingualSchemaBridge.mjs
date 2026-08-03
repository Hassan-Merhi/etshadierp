import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const INSTALL_KEY = Symbol.for("erp.factory-trilingual-schema.applied");

function connectionStringFromEnvironment() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (
    process.env.PGHOST &&
    process.env.PGPORT &&
    process.env.PGUSER &&
    process.env.PGPASSWORD &&
    process.env.PGDATABASE
  ) {
    const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
    return `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }
  return "";
}

async function ensureFactoryTrilingualSchema() {
  const connectionString = connectionStringFromEnvironment();
  if (!connectionString) {
    throw new Error("Factory trilingual schema could not start because no PostgreSQL configuration is available.");
  }

  const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
  const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
  const { Client } = pg;
  const client = new Client({
    connectionString,
    ssl: !isLocalReplitDB && !sslExplicitlyDisabled ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 15_000,
  });

  const frenchSql = await readFile(
    new URL("../migrations/20260802_001_factory_french_catalog_snapshots.sql", import.meta.url),
    "utf8",
  );
  const languagePreferenceSql = await readFile(
    new URL("../migrations/20260802_002_user_language_preferences.sql", import.meta.url),
    "utf8",
  );

  try {
    await client.connect();
    await client.query(frenchSql);
    await client.query(languagePreferenceSql);
    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public.bale_recode_items') IS NOT NULL THEN
          ALTER TABLE public.bale_recode_items
            ADD COLUMN IF NOT EXISTS product_id INTEGER;
        END IF;
      END
      $$;
    `);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "INFO",
      message: "Factory multilingual schema and language preferences verified",
      module: "factory-trilingual-schema",
    }));
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message: "Factory trilingual schema verification failed",
      module: "factory-trilingual-schema",
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = ensureFactoryTrilingualSchema();
}

await globalThis[INSTALL_KEY];
