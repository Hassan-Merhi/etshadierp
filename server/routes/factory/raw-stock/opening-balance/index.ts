/**
 * rawStockBalanceRoutesLegacy route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerRawStockOpeningBalanceRoutes } from "./crud";
import { registerRawStockUnlinkedBaleRoutes } from "./unlinked-bales";
import { registerRawStockRecalculateUsedRoutes } from "./recalculate";

export function registerRawStockBalanceRoutes(app: Express) {
  registerRawStockOpeningBalanceRoutes(app);
  registerRawStockUnlinkedBaleRoutes(app);
  registerRawStockRecalculateUsedRoutes(app);
}
