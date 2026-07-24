import type { Express } from "express";
import { registerStatsNetProfitRoutes } from "./statsNetProfitRoutes";
import { registerStatsNetPositionRoutes } from "./statsNetPositionRoutes";
import { registerStatsDataRoutes } from "./statsDataRoutes";
import { registerStatsSalesRoutes } from "./statsSalesRoutes";
import { registerStatsReportsRoutes } from "./statsReportsRoutes";
import { registerStatsCountryActivityRoutes } from "./statsCountryActivityRoutes";
import { registerStockInSalesReportRoutes } from "./stockInSalesReportRoutes";

export function registerStatsRoutes(app: Express) {
  registerStatsNetProfitRoutes(app);
  registerStatsNetPositionRoutes(app);
  registerStatsDataRoutes(app);
  registerStatsSalesRoutes(app);
  registerStockInSalesReportRoutes(app);
  registerStatsReportsRoutes(app);
  registerStatsCountryActivityRoutes(app);
}
