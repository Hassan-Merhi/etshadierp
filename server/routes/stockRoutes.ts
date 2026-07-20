import type { Express } from "express";
import { registerStockLightRoutes } from "./stock/stockLightRoutes";
import { registerStockGroupsItemsRoutes } from "./stock/stockGroupsItemsRoutes";
import { registerStockTransferAdjRoutes } from "./stock/stockTransferAdjRoutes";
import { registerStockMergeRoutes } from "./stock/stockMergeRoutes";
import { registerStockItemManageRoutes } from "./stock/stockItemManageRoutes";
import { registerStockPriceListImportRoutes } from "./stock/stockPriceListImportRoutes";

export function registerStockRoutes(app: Express) {
  // Light route MUST be first — prevents /api/stock-items/:id from swallowing "light" as a param
  registerStockLightRoutes(app);
  registerStockGroupsItemsRoutes(app);
  registerStockTransferAdjRoutes(app);
  registerStockMergeRoutes(app);
  registerStockItemManageRoutes(app);
  registerStockPriceListImportRoutes(app);
}
