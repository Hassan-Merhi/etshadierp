import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

// Always use PGHOST variables (freshly created Replit database)
// PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE are created by Replit's database provisioning
let connectionString: string;

if (process.env.PGHOST && process.env.PGPORT && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE) {
  // Use Replit's database via individual connection variables
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  console.log('✓ Using Replit PostgreSQL database');
} else {
  throw new Error("No database configuration found. Please provision a PostgreSQL database for your Replit project.");
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
