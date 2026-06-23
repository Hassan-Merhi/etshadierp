import type { Express } from "express";
import { registerStockGroupsItemsRoutes } from "./stock/stockGroupsItemsRoutes";
import { registerStockTransferAdjRoutes } from "./stock/stockTransferAdjRoutes";
import { registerStockMergeRoutes } from "./stock/stockMergeRoutes";
import { registerStockItemManageRoutes } from "./stock/stockItemManageRoutes";
import { registerStockPriceListImportRoutes } from "./stock/stockPriceListImportRoutes";

export function registerStockRoutes(app: Express) {
  registerStockGroupsItemsRoutes(app);
  registerStockTransferAdjRoutes(app);
  registerStockMergeRoutes(app);
  registerStockItemManageRoutes(app);
  registerStockPriceListImportRoutes(app);
}
