import type { Express } from "express";
import type { Server } from "http";

import { tenantCompanyParamBoundary, tenantIsolationBoundary } from "./middleware/tenantIsolationBoundary";
import { registerApplicationRoutes } from "./routes/applicationRoutes";
import { registerOperationalMonitoringRoutes } from "./routes/admin/operationalMonitoringRoutes";

export function registerRoutes(app: Express): Promise<Server> {
  app.use(tenantIsolationBoundary);
  app.param("companyId", tenantCompanyParamBoundary);
  registerOperationalMonitoringRoutes(app);
  return registerApplicationRoutes(app);
}
