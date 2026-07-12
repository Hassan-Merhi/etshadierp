import "./startupMigrationCoordinator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { logger } from "./lib/logger";

// Database connection configuration
// Supports: DATABASE_URL (Render, external) or individual PG* variables (Replit)
let connectionString: string;
let databaseSource: "DATABASE_URL" | "PG_ENV";

if (process.env.DATABASE_URL) {
  connectionString = process.env.DATABASE_URL;
  databaseSource = "DATABASE_URL";
} else if (
  process.env.PGHOST &&
  process.env.PGPORT &&
  process.env.PGUSER &&
  process.env.PGPASSWORD &&
  process.env.PGDATABASE
) {
  const { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  connectionString = `postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  databaseSource = "PG_ENV";
} else {
  throw new Error("No database configuration found. Please set DATABASE_URL or provision a PostgreSQL database.");
}

// SSL: disabled for Replit local DB or when PGSSLMODE=disable, enabled for everything else.
const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;

logger.info("Database configuration selected", {
  module: "database",
  action: "configure",
  source: databaseSource,
  sslEnabled: requiresSSL,
});

if (sslExplicitlyDisabled && !isLocalReplitDB) {
  logger.warn("Database SSL disabled by environment", {
    module: "database",
    action: "configure",
    setting: "PGSSLMODE=disable",
  });
}

// Configurable via PG_POOL_MAX env var (default 10).
// Zero-downtime deploy runs two instances: 10*2 + session(1*2) = 22 connections,
// well within the Render 97-connection limit. Raise PG_POOL_MAX if the DB plan allows more.
const poolMax = Number(process.env.PG_POOL_MAX || 10);
logger.info("Database pool configured", {
  module: "database",
  action: "pool-configure",
  max: poolMax,
  configuredValue: process.env.PG_POOL_MAX ?? "unset",
});

export const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  max: poolMax,
  // Fail fast so requests error quickly rather than queuing indefinitely.
  connectionTimeoutMillis: 8000,
  // Release idle connections after 30 seconds.
  idleTimeoutMillis: 30000,
  // Keep the pool alive across idle periods instead of draining to zero.
  allowExitOnIdle: false,
});

// Log unexpected errors on idle clients.
pool.on("error", (error) => {
  logger.error("Database pool idle-client error", {
    module: "database",
    action: "pool-error",
    error,
  });
  logPoolStats("on-error");
});

// Log every new physical connection and every removal for diagnostics.
pool.on("connect", () => logPoolStats("connect"));
pool.on("remove", () => logPoolStats("remove"));

// Log when a client is acquired from the pool under pressure.
pool.on("acquire", () => {
  if (pool.waitingCount > 0) {
    logPoolStats("acquire-under-pressure");
  }
});

export function logPoolStats(trigger: string) {
  const context = {
    module: "database",
    action: "pool-stats",
    trigger,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  if (trigger === "on-error" || pool.waitingCount > 0) {
    logger.warn("Database pool pressure", context);
  } else {
    logger.debug("Database pool stats", context);
  }
}

export const db = drizzle(pool, { schema });
