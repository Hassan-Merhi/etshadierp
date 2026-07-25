#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const APPLY_FLAG = "--apply";
const REQUIRED_CONFIRMATION = "APPLY_VERSIONED_MIGRATIONS";
const LOCK_NAME = "etshadierp:versioned-migrations";

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

if (!process.argv.includes(APPLY_FLAG)) {
  fail(
    "Refusing to run migrations without --apply. Use npm run verify:migrations first, then run the explicit apply command.",
    2,
  );
}

if (process.env.MIGRATION_CONFIRMATION !== REQUIRED_CONFIRMATION) {
  fail(
    `Refusing to run migrations. Set MIGRATION_CONFIRMATION=${REQUIRED_CONFIRMATION} for this one command only.`,
    2,
  );
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) fail("DATABASE_URL is required.", 2);

const isLocalReplitDb = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSsl = !isLocalReplitDb && !sslExplicitlyDisabled;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(repoRoot, "migrations");

const client = new Client({
  connectionString,
  ssl: requiresSsl ? { rejectUnauthorized: false } : false,
});

let lockHeld = false;

try {
  await client.connect();
  await client.query("SET lock_timeout = '30s'");
  await client.query("SET statement_timeout = '5min'");

  const lockResult = await client.query(
    "SELECT pg_try_advisory_lock(hashtext($1::text)) AS locked",
    [LOCK_NAME],
  );
  lockHeld = lockResult.rows[0]?.locked === true;
  if (!lockHeld) {
    throw new Error("Another versioned migration process already holds the migration lock.");
  }

  const db = drizzle(client);
  console.log(`Applying registered migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Versioned migrations completed successfully.");
} catch (error) {
  console.error("Versioned migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (lockHeld) {
    await client.query("SELECT pg_advisory_unlock(hashtext($1::text))", [LOCK_NAME]).catch(() => {});
  }
  await client.end().catch(() => {});
}
