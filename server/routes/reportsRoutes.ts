import type { Express } from "express";

import { registerDashboardAccountRoutes } from "./reportsDashboardAccountRoutes";
import { registerReportsClosingStockRoutes } from "./reportsClosingStockRoutes";
import { registerReportsContainerTrackingRoutes } from "./reportsContainerTrackingRoutes";
import { registerReportsNetProfitStatementRoutes } from "./reportsNetProfitStatementRoutes";
import { registerReportsRoutes as registerLegacyReportsRoutes } from "./reportsRoutesLegacy";

export function registerReportsRoutes(app: Express) {
  // Extracted report domains register first and shadow their historical copies.
  // All report endpoints not yet migrated remain available through the exact
  // compatibility registry, preserving URLs and response contracts.
  registerReportsNetProfitStatementRoutes(app);
  registerReportsClosingStockRoutes(app);
  registerDashboardAccountRoutes(app);
  registerReportsContainerTrackingRoutes(app);
  registerLegacyReportsRoutes(app);
}
