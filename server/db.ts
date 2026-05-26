import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

// Database connection configuration
// Supports: DATABASE_URL (Render, external) or individual PG* variables (Replit)
let connectionString: string;

if (process.env.DATABASE_URL) {
  connectionString = process.env.DATABASE_URL;
  console.log('✓ Using DATABASE_URL for PostgreSQL connection');
} else if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE) {
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  console.log('✓ Using Replit PostgreSQL database');
} else {
  throw new Error("No database configuration found. Please set DATABASE_URL or provision a PostgreSQL database.");
}

console.log('Database connection endpoint:', connectionString.replace(/:[^:@]*@/, ':***@'));

// SSL: disabled for Replit local DB or when PGSSLMODE=disable, enabled for everything else.
const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

if (isLocalReplitDB) {
  console.log('ℹ️  SSL disabled for Replit local database (helium)');
} else if (sslExplicitlyDisabled) {
  console.warn('⚠️  SSL disabled via PGSSLMODE=disable');
} else {
  console.log('✓ SSL enabled for external database connection');
}

// Single shared Pool for the entire application.
// Session store uses its own separate pool (server/index.ts, max 3).
// Render DB has max_connections=103; two instances during zero-downtime deploy:
//   Per instance: main(12) + session(3) = 15  →  2 instances = 30, well within 103.
// The real guard against pool exhaustion is lock_timeout on the migration client
// (server/index.ts) which prevents DDL locks from blocking user queries during deploys.
export const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  // 10 connections per instance. Render DB has max_connections=103.
  // Two instances during zero-downtime deploy: 10*2 + session(3*2) = 26, well within 103.
  // Kept deliberately low to leave headroom for zombie connections from previous deploys.
  max: 10,
  // Fail fast so requests get an error quickly rather than queuing indefinitely.
  connectionTimeoutMillis: 8000,
  // Release idle connections after 30 seconds.
  idleTimeoutMillis: 30000,
  // Keep the pool alive across idle periods instead of draining to zero.
  allowExitOnIdle: false,
});

// Log unexpected errors on idle clients.
pool.on('error', (err) => {
  console.error('[DB Pool] Idle client error:', err.message);
  logPoolStats('on-error');
});

// Log when a client is acquired from the pool.
pool.on('acquire', () => {
  // Only log when the pool is under pressure to avoid noise.
  if (pool.waitingCount > 0) {
    logPoolStats('acquire-under-pressure');
  }
});

export function logPoolStats(trigger: string) {
  console.log(
    `[DB Pool] trigger=${trigger} total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
  );
}

export const db = drizzle(pool, { schema });
