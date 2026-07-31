/**
 * containerLoadedItemsRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerContainerLoadedItemCrudRoutes } from "./crud";
import { registerContainerLoadedItemImportRoutes } from "./import";
import { registerContainerLoadedItemReportRoutes } from "./reports";
import { registerContainerLoadedItemSummaryRoutes } from "./summary";

export function registerContainerLoadedItemsRoutes(app: Express, requireAuth: any) {
  registerContainerLoadedItemCrudRoutes(app, requireAuth);
  registerContainerLoadedItemImportRoutes(app, requireAuth);
  registerContainerLoadedItemReportRoutes(app, requireAuth);
  registerContainerLoadedItemSummaryRoutes(app, requireAuth);
}
