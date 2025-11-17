import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

// In development, prioritize Replit's built-in database
// In production, use DATABASE_URL (for Render/Neon)
let connectionString: string;

if (process.env.NODE_ENV === "development" && process.env.PGHOST) {
  // Use Replit's database in development (SSL enabled by default for Neon)
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  console.log('Using Replit database for development');
} else if (process.env.DATABASE_URL) {
  // Use DATABASE_URL for production (Render)
  connectionString = process.env.DATABASE_URL;
  console.log('Using DATABASE_URL for production');
} else {
  throw new Error("No database configuration found. Did you forget to provision a database?");
}

console.log('Database connection endpoint:', connectionString.replace(/:[^:@]*@/, ':***@'));

// Create PostgreSQL connection pool
// SSL Configuration Logic:
// - DISABLE SSL only for: Replit's local database (host: "helium") OR when PGSSLMODE="disable"
// - ENABLE SSL for: All other databases (production, Neon, Render, etc.) unless explicitly disabled
// This ensures external managed databases always use SSL while allowing local dev without SSL
const isLocalReplitDB = process.env.PGHOST === "helium";
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
});

export const db = drizzle(pool, { schema });
