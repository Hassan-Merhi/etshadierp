import type { Express } from "express";
import { registerStockGroupsItemsRoutes } from "./stock/stockGroupsItemsRoutes";
import { registerStockTransferAdjRoutes } from "./stock/stockTransferAdjRoutes";
import { registerStockMergeRoutes } from "./stock/stockMergeRoutes";

export function registerStockRoutes(app: Express) {
  registerStockGroupsItemsRoutes(app);
  registerStockTransferAdjRoutes(app);
  registerStockMergeRoutes(app);
}
