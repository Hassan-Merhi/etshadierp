import "./startupMigrationCoordinator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/schema";
import { logger } from "./lib/logger";
import { readDatabaseRuntimeConfig } from "./lib/databaseConfig";
import {
  logDatabasePoolSnapshot,
  logSlowDatabaseQuery,
} from "./lib/databaseTelemetry";
import {
  isRequestPerformanceContextActive,
  recordDatabaseQuery,
} from "./lib/requestPerformanceContext";

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

const isLocalReplitDB = process.env.PGHOST === "helium" || connectionString.includes("@helium:");
const sslExplicitlyDisabled = process.env.PGSSLMODE === "disable";
const requiresSSL = !isLocalReplitDB && !sslExplicitlyDisabled;
const databaseRuntimeConfig = readDatabaseRuntimeConfig();

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

logger.info("Database pool configured", {
  module: "database",
  action: "pool-configure",
  max: databaseRuntimeConfig.poolMax,
  min: databaseRuntimeConfig.poolMin,
  connectionTimeoutMillis: databaseRuntimeConfig.connectionTimeoutMillis,
  idleTimeoutMillis: databaseRuntimeConfig.idleTimeoutMillis,
  statementTimeoutMillis: databaseRuntimeConfig.statementTimeoutMillis,
  slowQueryThresholdMillis: databaseRuntimeConfig.slowQueryThresholdMillis,
});

export const pool = new Pool({
  connectionString,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
  max: databaseRuntimeConfig.poolMax,
  min: databaseRuntimeConfig.poolMin,
  connectionTimeoutMillis: databaseRuntimeConfig.connectionTimeoutMillis,
  idleTimeoutMillis: databaseRuntimeConfig.idleTimeoutMillis,
  allowExitOnIdle: false,
  options: `-c statement_timeout=${databaseRuntimeConfig.statementTimeoutMillis}`,
});

const originalPoolQuery = pool.query.bind(pool);
(pool as typeof pool & { query: typeof pool.query }).query = ((...args: Parameters<typeof pool.query>) => {
  const shouldRecordRequestQuery = isRequestPerformanceContextActive();
  const startedAt = performance.now();
  const result = originalPoolQuery(...args);

  const recordQueryCompletion = () => {
    const durationMillis = performance.now() - startedAt;

    if (shouldRecordRequestQuery) {
      recordDatabaseQuery(durationMillis);
    }

    logSlowDatabaseQuery(durationMillis, databaseRuntimeConfig.slowQueryThresholdMillis);
  };

  if (result && typeof (result as Promise<unknown>).finally === "function") {
    return (result as Promise<unknown>).finally(recordQueryCompletion);
  }

  recordQueryCompletion();
  return result;
}) as typeof pool.query;

pool.on("error", (error) => {
  logger.error("Database pool idle-client error", {
    module: "database",
    action: "pool-error",
    error,
  });
  logPoolStats("on-error");
});

pool.on("connect", () => logPoolStats("connect"));
pool.on("remove", () => logPoolStats("remove"));

const POOL_PRESSURE_GRACE_MS = 250;
let poolPressureTimer: NodeJS.Timeout | null = null;

pool.on("acquire", () => {
  if (pool.waitingCount === 0 || poolPressureTimer) return;

  poolPressureTimer = setTimeout(() => {
    poolPressureTimer = null;
    if (pool.waitingCount > 0) {
      logPoolStats("sustained-acquire-pressure");
    }
  }, POOL_PRESSURE_GRACE_MS);
  poolPressureTimer.unref();
});

export function logPoolStats(trigger: string) {
  logDatabasePoolSnapshot(pool, trigger);
}

export const db = drizzle(pool, { schema });
