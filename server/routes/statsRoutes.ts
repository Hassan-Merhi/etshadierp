import type { Express } from "express";
import { registerStatsNetProfitRoutes } from "./stats/statsNetProfitRoutes";
import { registerStatsNetPositionRoutes } from "./stats/statsNetPositionRoutes";
import { registerStatsDataRoutes } from "./stats/statsDataRoutes";
import { registerStatsSalesRoutes } from "./stats/statsSalesRoutes";
import { registerStatsReportsRoutes } from "./stats/statsReportsRoutes";
import { registerStatsCountryActivityRoutes } from "./stats/statsCountryActivityRoutes";
import { registerStatsMultiCurrencyRoutes } from "./stats/statsMultiCurrencyRoutes";
import { registerStockInSalesReportRoutes } from "./stats/stockInSalesReportRoutes";

export function registerStatsRoutes(app: Express) {
  // Must be first: installs the response middleware that adjusts only live
  // cash/bank rows before the existing Net Position engine sends its response.
  registerStatsMultiCurrencyRoutes(app);
  registerStatsNetProfitRoutes(app);
  registerStatsNetPositionRoutes(app);
  registerStatsDataRoutes(app);
  registerStatsSalesRoutes(app);
  registerStockInSalesReportRoutes(app);
  registerStatsReportsRoutes(app);
  registerStatsCountryActivityRoutes(app);
}
