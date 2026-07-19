import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
const LOCK_KEY = 748392105;

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function loadMigrations() {
  const names = (await readdir(MIGRATIONS_DIR))
    .filter((name) => /^\d{8}_\d{3}_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    return { name, sql, checksum: checksum(sql) };
  }));
}

async function ensureHistory(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration_history (
      migration_name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_ms INTEGER NOT NULL,
      app_version TEXT,
      applied_by TEXT NOT NULL DEFAULT CURRENT_USER
    )
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureHistory(client);
    const migrations = await loadMigrations();
    const applied = await client.query("SELECT migration_name, checksum FROM schema_migration_history ORDER BY migration_name");
    const appliedByName = new Map(applied.rows.map((row) => [row.migration_name, row.checksum]));

    for (const migration of migrations) {
      const previousChecksum = appliedByName.get(migration.name);
      if (previousChecksum && previousChecksum !== migration.checksum) {
        throw new Error(`Checksum mismatch for applied migration ${migration.name}`);
      }
      if (previousChecksum) {
        console.log(`skip ${migration.name}`);
        continue;
      }

      const started = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migration_history
            (migration_name, checksum, execution_ms, app_version)
           VALUES ($1,$2,$3,$4)`,
          [migration.name, migration.checksum, Date.now() - started, process.env.APP_VERSION ?? null],
        );
        await client.query("COMMIT");
        console.log(`applied ${migration.name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const unknown = applied.rows.filter((row) => !migrations.some((migration) => migration.name === row.migration_name));
    if (unknown.length > 0) {
      throw new Error(`Database contains migrations missing from repository: ${unknown.map((row) => row.migration_name).join(", ")}`);
    }
  } finally {
    try { await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]); } catch {}
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
