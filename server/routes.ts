import type { Express } from "express";
import type { Server } from "http";

import { tenantCompanyParamBoundary, tenantIsolationBoundary } from "./middleware/tenantIsolationBoundary";
import { registerApplicationRoutes } from "./routes/applicationRoutes";
import { registerOperationalMonitoringRoutes } from "./routes/admin/operationalMonitoringRoutes";

export function registerRoutes(app: Express): Promise<Server> {
  registerOperationalMonitoringRoutes(app);
  app.use(tenantIsolationBoundary);
  app.param("companyId", tenantCompanyParamBoundary);
  return registerApplicationRoutes(app);
}
