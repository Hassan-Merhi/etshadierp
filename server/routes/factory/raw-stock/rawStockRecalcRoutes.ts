import type { Express } from "express";
import { registerHistoricalReplayRoutesV4 } from "./historicalReplayRoutesV4";
import { registerRawStockRecalcRoutes as registerLegacyRawStockRecalcRoutes } from "./rawStockRecalcRoutesLegacy";

/**
 * Exact Historical Replay handlers are registered first and therefore own only
 * their two matching endpoints. The legacy module remains responsible for all
 * other raw-stock recalculation, audit, history, and undo endpoints.
 */
export function registerRawStockRecalcRoutes(app: Express): void {
  registerHistoricalReplayRoutesV4(app);
  registerLegacyRawStockRecalcRoutes(app);
}
