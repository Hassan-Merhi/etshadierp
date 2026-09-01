/**
 * stockTransferAdjRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerLocationPriceGroupRoutes } from "./price-groups";
import { registerPosPriceListRoutes } from "./price-list";
import { registerStockItemImportRoutes } from "./imports";
import { registerStockItemWriteRoutes } from "./item-write";
import { registerStockItemHistoryRoutes } from "./item-history";
import { registerStockItemCodeAliasRoutes } from "./code-aliases";

export function registerStockTransferAdjRoutes(app: Express) {
  registerLocationPriceGroupRoutes(app);
  registerPosPriceListRoutes(app);
  registerStockItemImportRoutes(app);
  registerStockItemWriteRoutes(app);
  registerStockItemHistoryRoutes(app);
  registerStockItemCodeAliasRoutes(app);
}
