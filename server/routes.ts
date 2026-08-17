import type { Express } from "express";
import type { Server } from "http";

import { registerApplicationRoutes } from "./routes/applicationRoutes";
import { registerOperationalMonitoringRoutes } from "./routes/admin/operationalMonitoringRoutes";
import { registerTenantIsolationBoundary } from "./routes/tenantBoundaryRegistrar";
import { registerOperationalVoucherRequestBoundary } from "./services/accounting/operationalVoucherRequestBoundary";

export function registerRoutes(app: Express): Promise<Server> {
  registerTenantIsolationBoundary(app);
  registerOperationalVoucherRequestBoundary(app);
  registerOperationalMonitoringRoutes(app);
  return registerApplicationRoutes(app);
}
