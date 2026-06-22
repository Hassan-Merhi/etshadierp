import type { Express } from "express";
import { registerStockPriceListImportRoutes } from "./stockPriceListImportRoutes";
import { registerStockItemManageRoutes } from "./stockItemManageRoutes";

export function registerStockTransferAdjRoutes(app: Express) {
  registerStockPriceListImportRoutes(app);
  registerStockItemManageRoutes(app);
}
