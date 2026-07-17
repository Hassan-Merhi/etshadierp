import type { Express } from "express";
import { registerRawStockCrudRoutes } from "./raw-stock/rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./raw-stock/rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./raw-stock/rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./raw-stock/rawStockBalanceRoutes";
import { registerRawStockRecalcRoutes } from "./raw-stock/registerRawStockRecalcRoutes";
import { registerRawStockDiagnosticRoutes } from "./raw-stock/rawStockDiagnosticRoutes";

export function registerFactoryRawStockRoutes(app: Express) {
  registerRawStockCrudRoutes(app);
  registerRawStockOffloadRoutes(app);
  registerRawStockContainerRoutes(app);
  registerRawStockBalanceRoutes(app);
  registerRawStockRecalcRoutes(app);
  registerRawStockDiagnosticRoutes(app);
}
