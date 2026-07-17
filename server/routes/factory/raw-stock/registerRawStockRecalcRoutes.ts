import type { Express } from "express";
import { pool } from "../../../db";
import { registerRawStockRecalcRoutes as registerLegacyRawStockRecalcRoutes } from "./rawStockRecalcRoutes";

const UNDO_LOG_CREATE_TABLE_PATTERN = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+factory_recalc_undo_log/i;

/**
 * Register the raw-stock recalculation routes without allowing route registration
 * to mutate the database schema.
 *
 * The legacy route module still contains an idempotent CREATE TABLE call. The
 * schema is now owned exclusively by the versioned migration
 * migrations/20260717_factory_recalc_undo_log.sql. This narrow compatibility
 * guard prevents that one historical registration-time statement from executing
 * until the large route module is split and the obsolete helper can be deleted
 * directly without risking an unrelated rewrite.
 */
export function registerRawStockRecalcRoutes(app: Express): void {
  const mutablePool = pool as typeof pool & {
    query: (...args: any[]) => Promise<any>;
  };
  const originalQuery = mutablePool.query;

  mutablePool.query = function guardedRegistrationQuery(...args: any[]): Promise<any> {
    const sqlText = typeof args[0] === "string" ? args[0] : args[0]?.text;
    if (typeof sqlText === "string" && UNDO_LOG_CREATE_TABLE_PATTERN.test(sqlText)) {
      return Promise.resolve({ rows: [], rowCount: 0, command: "SKIPPED_RUNTIME_DDL", fields: [] });
    }
    return originalQuery.apply(pool, args as any);
  };

  try {
    registerLegacyRawStockRecalcRoutes(app);
  } finally {
    mutablePool.query = originalQuery;
  }
}
