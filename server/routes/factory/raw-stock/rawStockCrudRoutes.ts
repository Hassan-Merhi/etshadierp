import type { Express } from "express";
import { registerRawStockReceiptRoutes } from "./rawStockReceiptRoutes";
import { registerRawStockAdjRoutes } from "./rawStockAdjRoutes";

export function registerRawStockCrudRoutes(app: Express) {
  registerRawStockReceiptRoutes(app);
  registerRawStockAdjRoutes(app);
}
