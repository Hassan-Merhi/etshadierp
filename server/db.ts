import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// Remove all query parameters from DATABASE_URL (like sslmode, pooler, etc.)
const connectionString = process.env.DATABASE_URL.split('?')[0];

console.log('Initializing database connection (HTTP mode)...');
console.log('Connection string format:', connectionString.replace(/:[^:@]*@/, ':***@'));

// Use HTTP-based Neon client instead of WebSocket Pool
// This is much more reliable in Replit and other serverless environments
const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
