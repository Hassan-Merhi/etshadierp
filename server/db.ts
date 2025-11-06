import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";

// In development, prioritize Replit's built-in database
// In production, use DATABASE_URL (for Render/Neon)
let connectionString: string;

if (process.env.NODE_ENV === "development" && process.env.PGHOST) {
  // Use Replit's database in development
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=require`;
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
// SSL is required for production databases on Render
const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
