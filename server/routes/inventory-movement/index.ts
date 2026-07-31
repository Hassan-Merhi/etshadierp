/**
 * inventoryMovementRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerInventoryMovementReportRoutes } from "./movement";
import { registerInventoryReconcileRoutes } from "./reconcile";
import { registerLocationVoucherRoutes } from "./location-vouchers";
import { registerLocationImportRoutes } from "./location-imports";

export function registerInventoryMovementRoutes(app: Express) {
  registerInventoryMovementReportRoutes(app);
  registerInventoryReconcileRoutes(app);
  registerLocationVoucherRoutes(app);
  registerLocationImportRoutes(app);
}
