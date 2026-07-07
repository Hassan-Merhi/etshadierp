import type { Express } from "express";
import { registerLocationCrudRoutes } from "./locationCrudRoutes";
import { registerLocationInventoryRoutes } from "./locationInventoryRoutes";
import { registerLocationReportRoutes } from "./locationReportRoutes";

export function registerLocationRoutes(app: Express) {
  registerLocationCrudRoutes(app);
  registerLocationInventoryRoutes(app);
  registerLocationReportRoutes(app);
}
