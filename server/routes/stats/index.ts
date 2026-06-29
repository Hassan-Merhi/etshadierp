import type { Express } from "express";
import { registerStatsNetProfitRoutes } from "./statsNetProfitRoutes";
import { registerStatsNetPositionRoutes } from "./statsNetPositionRoutes";
import { registerStatsDataRoutes } from "./statsDataRoutes";
import { registerStatsSalesRoutes } from "./statsSalesRoutes";
import { registerStatsReportsRoutes } from "./statsReportsRoutes";
import { registerStatsCountryActivityRoutes } from "./statsCountryActivityRoutes";

export function registerStatsRoutes(app: Express) {
  registerStatsNetProfitRoutes(app);
  registerStatsNetPositionRoutes(app);
  registerStatsDataRoutes(app);
  registerStatsSalesRoutes(app);
  registerStatsReportsRoutes(app);
  registerStatsCountryActivityRoutes(app);
}
