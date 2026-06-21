import type { Express } from "express";
import { registerContainerCrudRoutes } from "./containers/containerCrudRoutes";
import { registerContainerTrackingRoutes } from "./containers/containerTrackingRoutes";
import { registerContainerAccountingRoutes } from "./containers/containerAccountingRoutes";
import { registerContainerFreightRoutes } from "./containers/containerFreightRoutes";
import { registerContainerOffloadRoutes } from "./containers/containerOffloadRoutes";
import { registerContainerDocumentsRoutes } from "./containers/containerDocumentsRoutes";
import { registerContainerCostingRoutes } from "./containers/containerCostingRoutes";

export function registerContainerRoutes(app: Express) {
  registerContainerCrudRoutes(app);
  registerContainerTrackingRoutes(app);
  registerContainerAccountingRoutes(app);
  registerContainerFreightRoutes(app);
  registerContainerOffloadRoutes(app);
  registerContainerDocumentsRoutes(app);
  registerContainerCostingRoutes(app);
}
