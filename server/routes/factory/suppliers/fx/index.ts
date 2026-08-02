/**
 * supplierFxRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerSupplierFxTransferRoutes } from "./transfers";
import { registerSupplierBulkFxPrefetchRoutes } from "./bulk-prefetch";
import { registerSupplierBulkFxSettlementRoutes } from "./bulk-settlement";

export function registerSupplierFxRoutes(app: Express) {
  registerSupplierFxTransferRoutes(app);
  registerSupplierBulkFxPrefetchRoutes(app);
  registerSupplierBulkFxSettlementRoutes(app);
}
