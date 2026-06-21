import type { Express } from "express";
import { registerStockGroupsItemsRoutes } from "./stockGroupsItemsRoutes";
import { registerStockTransferAdjRoutes } from "./stockTransferAdjRoutes";
import { registerStockMergeRoutes } from "./stockMergeRoutes";

export function registerStockRoutes(app: Express) {
  registerStockGroupsItemsRoutes(app);
  registerStockTransferAdjRoutes(app);
  registerStockMergeRoutes(app);
}
