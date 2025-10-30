import { drizzle } from "drizzle-orm/neon-serverless";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10,  // Limit maximum connections to prevent overwhelming the database
  connectionTimeoutMillis: 10000,  // 10 seconds to establish connection
  idleTimeoutMillis: 30000,  // 30 seconds before closing idle connections
  query_timeout: 30000  // 30 seconds max query execution time
});
export const db = drizzle({ client: pool, schema });
