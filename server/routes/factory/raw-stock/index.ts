import type { Express } from "express";
import { registerRawStockCrudRoutes } from "./rawStockCrudRoutes";
import { registerRawStockOffloadRoutes } from "./rawStockOffloadRoutes";
import { registerRawStockContainerRoutes } from "./rawStockContainerRoutes";
import { registerRawStockBalanceRoutes } from "./rawStockBalanceRoutes";
import { postOffloadHistoricalReplayMiddleware } from "./postOffloadHistoricalReplayMiddleware";
import { requirePostOffloadImpactPreview } from "./postOffloadImpactPreviewMiddleware";
import { registerPostOffloadImpactPreviewRoutes } from "./postOffloadImpactPreviewRoutes";
import { postOffloadReconciliationMiddleware } from "./postOffloadReconciliationMiddleware";

// Legacy compatibility aggregator. The active production aggregator is
// ../factoryRawStockRoutes.ts, where explicit company-context middleware is mounted.
export function registerFactoryRawStockRoutes(app: Express) {
  app.use("/api/factory/containers", requirePostOffloadImpactPreview);
  app.use("/api/factory/containers", postOffloadReconciliationMiddleware);
  app.use("/api/factory/containers", postOffloadHistoricalReplayMiddleware);
  registerRawStockCrudRoutes(app);
  registerRawStockOffloadRoutes(app);
  registerPostOffloadImpactPreviewRoutes(app);
  registerRawStockContainerRoutes(app);
  registerRawStockBalanceRoutes(app);
}
