import type { Express } from "express";
import { registerStatsNetProfitResilience } from "./statsNetProfitResilience";
import { registerStatsNetProfitRoutes } from "./statsNetProfitRoutes";
import { registerStatsNetPositionRoutes } from "./statsNetPositionRoutes";
import { registerStatsDataRoutes } from "./statsDataRoutes";
import { registerStatsSalesRoutes } from "./statsSalesRoutes";
import { registerStatsReportsRoutes } from "./statsReportsRoutes";
import { registerStatsCountryActivityRoutes } from "./statsCountryActivityRoutes";
import { registerStockInSalesReportRoutes } from "./stockInSalesReportRoutes";
import { registerSalesReportBandwidthRoutes } from "./salesReportBandwidthRoutes";

export function registerStatsRoutes(app: Express) {
  registerStatsNetProfitResilience(app);
  registerStatsNetProfitRoutes(app);
  registerStatsNetPositionRoutes(app);
  registerSalesReportBandwidthRoutes(app);
  registerStatsDataRoutes(app);
  registerStatsSalesRoutes(app);
  registerStockInSalesReportRoutes(app);
  registerStatsReportsRoutes(app);
  registerStatsCountryActivityRoutes(app);
}
