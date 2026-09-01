import type { Express } from "express";

import { registerDashboardAccountRoutes } from "./reportsDashboardAccountRoutes";
import { registerReportsClosingStockRoutes } from "./reportsClosingStockRoutes";
import { registerReportsContainerTrackingRoutes } from "./reportsContainerTrackingRoutes";
import { registerReportsLedgerRoutes } from "./reportsLedgerRoutes";
import { registerReportsNetProfitStatementRoutes } from "./reportsNetProfitStatementRoutes";
import { registerReportsVoucherDetailRoutes } from "./reportsVoucherDetailRoutes";

export function registerReportsRoutes(app: Express) {
  registerReportsNetProfitStatementRoutes(app);
  registerReportsClosingStockRoutes(app);
  registerDashboardAccountRoutes(app);
  registerReportsContainerTrackingRoutes(app);
  registerReportsLedgerRoutes(app);
  registerReportsVoucherDetailRoutes(app);
}
