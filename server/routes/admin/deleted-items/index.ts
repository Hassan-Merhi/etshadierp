/**
 * deletedItemsRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerOrphanedRecordRoutes } from "./orphaned-records";
import { registerLocationSummaryRoutes } from "./location-summary";
import { registerDeletedItemsListRoutes } from "./list";
import { registerDeletedItemsRestoreRoutes } from "./restore";
import { registerDeletedItemsPermanentDeleteRoutes } from "./permanent-delete";

export function registerDeletedItemsRoutes(app: Express) {
  registerOrphanedRecordRoutes(app);
  registerLocationSummaryRoutes(app);
  registerDeletedItemsListRoutes(app);
  registerDeletedItemsRestoreRoutes(app);
  registerDeletedItemsPermanentDeleteRoutes(app);
}
