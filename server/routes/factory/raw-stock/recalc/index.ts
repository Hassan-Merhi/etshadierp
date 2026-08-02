/**
 * rawStockRecalcRoutesLegacy route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerRawStockRecalcPreviewRoutes } from "./preview";
import { registerRawStockZeroCostSourceRoutes } from "./zero-cost-sources";
import { registerRawStockAutoApplyFxRoutes } from "./auto-apply-fx";
import { registerRawStockRecalcAuditRoutes } from "./audits";
import { registerRawStockSupplierRateRoutes } from "./supplier-rate";
import { registerRawStockRecalcApplyAllRoutes } from "./fix-and-apply-all";
import { registerRawStockRecalcUndoRoutes } from "./undo";
import { registerRawStockPartialOffloadScanRoutes } from "./partial-offload-scan";

export function registerRawStockRecalcRoutes(app: Express) {
  registerRawStockRecalcPreviewRoutes(app);
  registerRawStockZeroCostSourceRoutes(app);
  registerRawStockAutoApplyFxRoutes(app);
  registerRawStockRecalcAuditRoutes(app);
  registerRawStockSupplierRateRoutes(app);
  registerRawStockRecalcApplyAllRoutes(app);
  registerRawStockRecalcUndoRoutes(app);
  registerRawStockPartialOffloadScanRoutes(app);
}
