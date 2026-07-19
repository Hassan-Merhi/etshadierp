import type { Express } from "express";
import { registerRawStockCrudRoutes } from "./rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./rawStockBalanceRoutes";

// Legacy compatibility aggregator. The active production aggregator is
// ../factoryRawStockRoutes.ts, where explicit company-context middleware is mounted.
export function registerFactoryRawStockRoutes(app: Express) {
  registerRawStockCrudRoutes(app);
  registerRawStockOffloadRoutes(app);
  registerRawStockContainerRoutes(app);
  registerRawStockBalanceRoutes(app);
}
