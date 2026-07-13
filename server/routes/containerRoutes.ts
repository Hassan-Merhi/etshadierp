import type { Express } from "express";
import { registerContainerCrudRoutes } from "./containers/containerCrudRoutes";
import { registerContainerTrackingRoutes } from "./containers/containerTrackingRoutes";
import { registerContainerAccountingRoutes } from "./containers/containerAccountingRoutes";
import { registerContainerFreightRoutes } from "./containers/containerFreightRoutes";
import { registerContainerOffloadRoutes } from "./containers/containerOffloadRoutes";
import { registerContainerDocumentsRoutes } from "./containers/containerDocumentsRoutes";
import { registerContainerCostingRoutes } from "./containers/containerCostingRoutes";

export function registerContainerRoutes(app: Express) {
  // Tracking routes registered first: they include literal-path routes like
  // /api/containers/eta-tracking-summary and /api/containers/refresh-etas that
  // must be matched before containerCrudRoutes' /api/containers/:id, since Express
  // resolves routes strictly in registration order (not by specificity).
  registerContainerTrackingRoutes(app);
  registerContainerCrudRoutes(app);
  registerContainerAccountingRoutes(app);
  registerContainerFreightRoutes(app);
  registerContainerOffloadRoutes(app);
  registerContainerDocumentsRoutes(app);
  registerContainerCostingRoutes(app);
}
