/**
 * stockGroupsItemsRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerStockGroupRoutes } from "./groups";
import { registerStockGradeRoutes } from "./grades";
import { registerStockCategoryRoutes } from "./categories";
import { registerStockItemRoutes } from "./items";
import { registerStockItemBulkRoutes } from "./bulk-ops";
import { registerStockItemLookupRoutes } from "./lookups";
import { registerStockItemDetailRoutes } from "./item-detail";
import { registerStockItemLocationPriceRoutes } from "./location-prices";

export function registerStockGroupsItemsRoutes(app: Express) {
  registerStockGroupRoutes(app);
  registerStockGradeRoutes(app);
  registerStockCategoryRoutes(app);
  registerStockItemRoutes(app);
  registerStockItemBulkRoutes(app);
  registerStockItemLookupRoutes(app);
  registerStockItemDetailRoutes(app);
  registerStockItemLocationPriceRoutes(app);
}
