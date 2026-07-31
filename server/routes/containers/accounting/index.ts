/**
 * containerAccountingRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerContainerNumberRoutes } from "./number";
import { registerContainerSyncVoucherRoutes } from "./sync-voucher";
import { registerContainerCostingRoutes } from "./costing";

export function registerContainerAccountingRoutes(app: Express) {
  registerContainerNumberRoutes(app);
  registerContainerSyncVoucherRoutes(app);
  registerContainerCostingRoutes(app);
}
