import type { Express } from "express";
import { registerStockLightRoutes } from "./stockLightRoutes";
import { registerStockGroupsItemsRoutes } from "./stockGroupsItemsRoutes";
import { registerStockTransferAdjRoutes } from "./stockTransferAdjRoutes";
import { registerStockMergeRoutes } from "./stockMergeRoutes";

export function registerStockRoutes(app: Express) {
  registerStockLightRoutes(app);
  registerStockGroupsItemsRoutes(app);
  registerStockTransferAdjRoutes(app);
  registerStockMergeRoutes(app);
}
