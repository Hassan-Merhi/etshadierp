import type { Express } from "express";
import type { Server } from "http";

import { registerApplicationRoutes } from "./routes/applicationRoutes";
import { registerOperationalMonitoringRoutes } from "./routes/admin/operationalMonitoringRoutes";

export function registerRoutes(app: Express): Promise<Server> {
  registerOperationalMonitoringRoutes(app);
  return registerApplicationRoutes(app);
}
