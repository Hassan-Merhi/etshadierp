import type { Express } from "express";
import { pool } from "../../../db";
import { registerHistoricalReplayFullCompanyScopeRoutes } from "./historicalReplayFullCompanyScopeRoutes";
import { registerHistoricalReplayPhase6GuardRoutes } from "./historicalReplayPhase6GuardRoutes";
import { registerHistoricalReplayRoutesV4 } from "./historicalReplayRoutesV4";
import { registerRawStockRecalcRoutes as registerPreservedRawStockRecalcRoutes } from "./rawStockRecalcRoutesLegacy";

/**
 * The preserved legacy module still contains an old route-registration-time
 * CREATE TABLE call. Migration 0007 now owns that schema. Suppress only that one
 * synchronous registration query while retaining every legacy non-replay route.
 * The patch exists for one call stack only; normal pool.query is restored before
 * the event loop can process any other work.
 */
function registerLegacyRawStockRecalcRoutes(app: Express): void {
  const mutablePool = pool as any;
  const originalQuery = mutablePool.query;
  mutablePool.query = function guardedRegistrationQuery(...args: any[]) {
    const sqlText = typeof args[0] === "string" ? args[0] : args[0]?.text;
    if (
      typeof sqlText === "string"
      && /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+factory_recalc_undo_log/i.test(sqlText)
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    return originalQuery.apply(this, args);
  };
  try {
    registerPreservedRawStockRecalcRoutes(app);
  } finally {
    mutablePool.query = originalQuery;
  }
}

/**
 * The full-company scope middleware runs first, then the fail-closed safety/impact
 * guard, then the exact signed Prepare/Apply/Undo handlers. Legacy routes remain
 * available only for unrelated recalculation, audit, history, and non-replay undo.
 */
export function registerRawStockRecalcRoutes(app: Express): void {
  registerHistoricalReplayFullCompanyScopeRoutes(app);
  registerHistoricalReplayPhase6GuardRoutes(app);
  registerHistoricalReplayRoutesV4(app);
  registerLegacyRawStockRecalcRoutes(app);
}
