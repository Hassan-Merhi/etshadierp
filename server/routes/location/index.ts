import type { Express } from "express";
import { registerCommonInventoryPerformanceRoutes } from "./commonInventoryPerformanceRoutes";
import { registerLocationCrudRoutes } from "./locationCrudRoutes";
import { registerLocationInventoryRoutes } from "./locationInventoryRoutes";
import { registerLocationReportRoutes } from "./locationReportRoutes";

export function registerLocationRoutes(app: Express) {
  registerCommonInventoryPerformanceRoutes(app);
  registerLocationCrudRoutes(app);
  registerLocationInventoryRoutes(app);
  registerLocationReportRoutes(app);
}
