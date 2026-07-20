import type { Pool } from "pg";
import { logger } from "./logger";

export interface DatabasePoolSnapshot {
  total: number;
  idle: number;
  active: number;
  waiting: number;
  utilizationRatio: number;
}

export function readDatabasePoolSnapshot(pool: Pool): DatabasePoolSnapshot {
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const active = Math.max(0, total - idle);

  return {
    total,
    idle,
    active,
    waiting: pool.waitingCount,
    utilizationRatio: total > 0 ? active / total : 0,
  };
}

export function logDatabasePoolSnapshot(pool: Pool, trigger: string): void {
  const snapshot = readDatabasePoolSnapshot(pool);
  const context = {
    module: "database",
    action: "pool-stats",
    trigger,
    ...snapshot,
    utilizationPercent: Math.round(snapshot.utilizationRatio * 100),
  };

  if (trigger === "on-error" || snapshot.waiting > 0) {
    logger.warn("Database pool pressure", context);
    return;
  }

  logger.debug("Database pool stats", context);
}

export function logSlowDatabaseQuery(durationMillis: number, thresholdMillis: number): void {
  if (durationMillis < thresholdMillis) return;

  logger.warn("Slow database query", {
    module: "database",
    action: "slow-query",
    durationMillis: Math.round(durationMillis),
    thresholdMillis,
  });
}
