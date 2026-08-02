import type { Express } from "express";
import { registerStockLightRoutes } from "./stockLightRoutes";
import { registerStockGroupsItemsRoutes } from "./groups-items";
import { registerStockTransferAdjRoutes } from "./transfer-adj";
import { registerStockMergeRoutes } from "./merge";

export function registerStockRoutes(app: Express) {
  registerStockLightRoutes(app);
  registerStockGroupsItemsRoutes(app);
  registerStockTransferAdjRoutes(app);
  registerStockMergeRoutes(app);
}
