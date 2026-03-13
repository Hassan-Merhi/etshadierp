import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

// Database connection configuration
// Supports: DATABASE_URL (Render, external) or individual PG* variables (Replit)
let connectionString: string;

if (process.env.DATABASE_URL) {
  // Use DATABASE_URL directly (Render, external databases)
  connectionString = process.env.DATABASE_URL;
  console.log('✓ Using DATABASE_URL for PostgreSQL connection');
} else if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE) {
  // Use Replit's database via individual connection variables
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  console.log('✓ Using Replit PostgreSQL database');
} else {
  throw new Error("No database configuration found. Please set DATABASE_URL or provision a PostgreSQL database.");
}

console.log('Database connection endpoint:', connectionString.replace(/:[^:@]*@/, ':***@'));

// Create PostgreSQL connection pool
// SSL Configuration Logic:
// - DISABLE SSL only for: Replit's local database (host: "helium") OR when PGSSLMODE="disable"
// - ENABLE SSL for: All other databases (production, Neon, Render, etc.) unless explicitly disabled
// This ensures external managed databases always use SSL while allowing local dev without SSL
const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

// Log SSL configuration for debugging
if (!requiresSSL && !isLocalReplitDB) {
  console.warn('⚠️  SSL disabled via PGSSLMODE=disable - ensure this is intentional for your environment');
} else if (isLocalReplitDB) {
  console.log('ℹ️  SSL disabled for Replit local database (helium)');
} else {
  console.log('✓ SSL enabled for external database connection');
}

const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  // Connection pool limits — critical for Render's basic PostgreSQL plan (~25 max connections total).
  // The session store uses its own separate pool, so keep this at 7 to leave headroom.
  max: 7,
  // Fail fast if no connection available within 10 seconds, rather than queuing indefinitely.
  connectionTimeoutMillis: 10000,
  // Release idle connections after 30 seconds to avoid holding unused slots.
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected error on idle client:', err.message);
});

export const db = drizzle(pool, { schema });
