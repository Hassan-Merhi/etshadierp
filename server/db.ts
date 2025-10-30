import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// Try using pooler endpoint for better connection reliability in serverless environments
// Transform: ep-xxx.c-2.region.aws.neon.tech -> ep-xxx-pooler.c-2.region.aws.neon.tech
const connectionString = process.env.DATABASE_URL.replace(
  /(@ep-[^.]+)(\.c-\d+\..*\.aws\.neon\.tech)/,
  '$1-pooler$2'
);

console.log('Database URL transformed:', connectionString !== process.env.DATABASE_URL);
console.log('Connection endpoint:', connectionString.replace(/:[^:@]*@/, ':***@'));

// Use HTTP-based connection (recommended for Replit)
const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
