/**
 * containerAccountingRoutes route composition.
 *
 * Registration order matches the original single-file module exactly, except
 * for the standalone PO repair boundary which must run before the legacy
 * sync-all implementation. Express resolves first-match, so linked/root
 * companies fall through while standalone companies are repaired explicitly.
 */
import type { Express } from "express";
import { registerContainerNumberRoutes } from "./number";
import { registerContainerSyncVoucherRoutes } from "./sync-voucher";
import { registerStandalonePoRepairBoundary } from "./standalone-po-repair";
import { registerContainerCostingRoutes } from "./costing";

export function registerContainerAccountingRoutes(app: Express) {
  registerContainerNumberRoutes(app);
  registerContainerSyncVoucherRoutes(app);
  registerStandalonePoRepairBoundary(app);
  registerContainerCostingRoutes(app);
}
