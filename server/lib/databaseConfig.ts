const DEFAULT_POOL_MAX = 10;
const DEFAULT_POOL_MIN = 2;
const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_SLOW_QUERY_MS = 1_000;

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value == null || value.trim() === "") return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }

  return parsed;
}

export interface DatabaseRuntimeConfig {
  poolMax: number;
  poolMin: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statementTimeoutMillis: number;
  slowQueryThresholdMillis: number;
}

export function readDatabaseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeConfig {
  const poolMax = readBoundedInteger(env.PG_POOL_MAX, DEFAULT_POOL_MAX, 1, 100);
  const requestedPoolMin = readBoundedInteger(env.PG_POOL_MIN, DEFAULT_POOL_MIN, 0, 20);

  return {
    poolMax,
    poolMin: Math.min(requestedPoolMin, poolMax),
    connectionTimeoutMillis: readBoundedInteger(
      env.PG_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
      1_000,
      60_000,
    ),
    idleTimeoutMillis: readBoundedInteger(
      env.PG_IDLE_TIMEOUT_MS,
      DEFAULT_IDLE_TIMEOUT_MS,
      10_000,
      600_000,
    ),
    statementTimeoutMillis: readBoundedInteger(
      env.PG_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    slowQueryThresholdMillis: readBoundedInteger(
      env.PG_SLOW_QUERY_MS,
      DEFAULT_SLOW_QUERY_MS,
      100,
      60_000,
    ),
  };
}
