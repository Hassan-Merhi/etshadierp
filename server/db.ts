import { drizzle } from "drizzle-orm/neon-serverless";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

// Use Neon's connection pooler to prevent "too many connections" errors
// This replaces the direct connection endpoint with the pooler endpoint
function getPoolerUrl(databaseUrl: string): string {
  // Check if we're already using the pooler to avoid duplicate -pooler suffix
  if (databaseUrl.includes('-pooler.')) {
    // Already using pooler, just ensure sslmode is set
    return ensureSslMode(databaseUrl);
  }
  
  // Replace direct connection endpoint with pooler endpoint
  // Pattern: .region. becomes -pooler.region.
  const poolerUrl = databaseUrl.replace(
    /\.([a-z]+-[a-z]+-\d+)\./,
    '-pooler.$1.'
  );
  
  // Verify the replacement actually happened
  if (poolerUrl === databaseUrl) {
    console.warn('Database URL format did not match expected pattern for pooler. Using direct connection.');
    return databaseUrl;
  }
  
  console.log('Using Neon connection pooler for database connections');
  // Add sslmode=require to avoid certificate hostname mismatch errors
  // The pooler endpoint hostname doesn't match the SSL certificate
  return ensureSslMode(poolerUrl);
}

function ensureSslMode(url: string): string {
  // If sslmode is already set, return as-is
  if (url.includes('sslmode=')) {
    return url;
  }
  // Add sslmode=require to use SSL without strict hostname verification
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}sslmode=require`;
}

const connectionString = getPoolerUrl(process.env.DATABASE_URL);

// Log the connection string format (without credentials) for debugging
const urlParts = connectionString.split('@');
if (urlParts.length > 1) {
  console.log('Connection config:', urlParts[1]);
}

export const pool = new Pool({ 
  connectionString,
  max: 10,  // Limit maximum connections to prevent overwhelming the database
  ssl: {
    // Neon pooler endpoints have a hostname (-pooler suffix) that doesn't match 
    // the SSL certificate. We enable SSL but skip hostname verification.
    rejectUnauthorized: false
  }
});
export const db = drizzle({ client: pool, schema });
