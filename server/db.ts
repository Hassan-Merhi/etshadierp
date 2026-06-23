import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

// Database connection configuration
// Supports: DATABASE_URL (Render, external) or individual PG* variables (Replit)
let connectionString: string;

if (process.env.DATABASE_URL) {
  connectionString = process.env.DATABASE_URL;
  console.log("✓ Using DATABASE_URL for PostgreSQL connection");
} else if (
  process.env.PGHOST &&
  process.env.PGPORT &&
  process.env.PGUSER &&
  process.env.PGPASSWORD &&
  process.env.PGDATABASE
) {
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  console.log("✓ Using Replit PostgreSQL database");
} else {
  throw new Error("No database configuration found. Please set DATABASE_URL or provision a PostgreSQL database.");
}

console.log("Database connection endpoint:", connectionString.replace(/:[^:@]*@/, ":***@"));

// SSL: disabled for Replit local DB or when PGSSLMODE=disable, enabled for everything else.
const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

if (isLocalReplitDB) {
  console.log("ℹ️  SSL disabled for Replit local database (helium)");
} else if (sslExplicitlyDisabled) {
  console.warn("⚠️  SSL disabled via PGSSLMODE=disable");
} else {
  console.log("✓ SSL enabled for external database connection");
}

// Configurable via PG_POOL_MAX env var (default 10).
// Zero-downtime deploy runs two instances: 10*2 + session(1*2) = 22 connections,
// well within the Render 97-connection limit. Raise PG_POOL_MAX if the DB plan allows more.
const poolMax = Number(process.env.PG_POOL_MAX || 10);
console.log(`[DB Pool] max=${poolMax} (PG_POOL_MAX=${process.env.PG_POOL_MAX ?? "unset"})`);

export const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  max: poolMax,
  // Fail fast so requests error quickly rather than queuing indefinitely.
  connectionTimeoutMillis: 8000,
  // Release idle connections after 30 seconds.
  idleTimeoutMillis: 30000,
  // Keep the pool alive across idle periods instead of draining to zero.
  allowExitOnIdle: false,
});

// Log unexpected errors on idle clients.
pool.on("error", (err) => {
  console.error("[DB Pool] Idle client error:", err.message);
  logPoolStats("on-error");
});

// Log every new physical connection and every removal for diagnostics.
pool.on("connect", () => logPoolStats("connect"));
pool.on("remove", () => logPoolStats("remove"));

// Log when a client is acquired from the pool under pressure.
pool.on("acquire", () => {
  if (pool.waitingCount > 0) {
    logPoolStats("acquire-under-pressure");
  }
});

export function logPoolStats(trigger: string) {
  console.log(
    `[DB Pool] trigger=${trigger} total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
  );
}

export const db = drizzle(pool, { schema });
