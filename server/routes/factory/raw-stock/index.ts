import type { Express } from "express";
import { registerRawStockCrudRoutes } from "./rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./rawStockBalanceRoutes";

export function registerFactoryRawStockRoutes(app: Express) {
  registerRawStockCrudRoutes(app);
  registerRawStockOffloadRoutes(app);
  registerRawStockContainerRoutes(app);
  registerRawStockBalanceRoutes(app);
}
