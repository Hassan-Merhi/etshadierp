import type { Express } from "express";
import type { Server } from "http";

import { registerApplicationRoutes } from "./routes/applicationRoutes";
import { registerOperationalMonitoringRoutes } from "./routes/admin/operationalMonitoringRoutes";
import { registerFactoryBilingualCatalogRoutes } from "./routes/factory/factoryBilingualCatalogRoutes";

export function registerRoutes(app: Express): Promise<Server> {
  registerOperationalMonitoringRoutes(app);
  // Phase 3 bilingual catalog GET routes are registered before the legacy Factory
  // registry so existing URLs gain shared resolver/search behavior without
  // duplicating or changing any write, costing, inventory, or accounting path.
  registerFactoryBilingualCatalogRoutes(app);
  return registerApplicationRoutes(app);
}
