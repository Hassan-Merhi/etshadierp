import type { Express } from "express";
import { registerStatsNetProfitRoutes } from "./stats/statsNetProfitRoutes";
import { registerStatsNetPositionRoutes } from "./stats/statsNetPositionRoutes";
import { registerStatsDataRoutes } from "./stats/statsDataRoutes";
import { registerStatsSalesRoutes } from "./stats/statsSalesRoutes";
import { registerStatsReportsRoutes } from "./stats/statsReportsRoutes";

export function registerStatsRoutes(app: Express) {
  registerStatsNetProfitRoutes(app);
  registerStatsNetPositionRoutes(app);
  registerStatsDataRoutes(app);
  registerStatsSalesRoutes(app);
  registerStatsReportsRoutes(app);
}
