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
// SSL is required for:
// - Production databases (always)
// - Replit's managed database (Neon, which always requires SSL even in dev)
// - When PGSSLMODE is explicitly set to require
// - When using DATABASE_URL (typically managed hosting)
// Default to SSL when using Replit's PGHOST unless PGSSLMODE is explicitly "disable"
const usingReplitDB = process.env.NODE_ENV === "development" && process.env.PGHOST;
const requiresSSL = process.env.NODE_ENV === "production" || 
                    (usingReplitDB && process.env.PGSSLMODE !== 'disable') ||
                    process.env.PGSSLMODE === 'require' ||
                    process.env.DATABASE_URL !== undefined;

const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
