import type { Express } from "express";
import { registerContainerListPaginationRoutes } from "./containers/containerListPaginationRoutes";
import { registerContainerCrudRoutes } from "./containers/containerCrudRoutes";
import { registerContainerTrackingRoutes } from "./containers/containerTrackingRoutes";
import { registerContainerAccountingRoutes } from "./containers/containerAccountingRoutes";
import { registerContainerFreightRoutes } from "./containers/containerFreightRoutes";
import { registerContainerOffloadLifecycleGuard } from "./containers/containerOffloadLifecycleGuard";
import { registerCentralContainerOffloadRoute } from "./containers/centralContainerOffloadRoute";
import { registerContainerOffloadRoutes } from "./containers/containerOffloadRoutes";
import { registerContainerDocumentsRoutes } from "./containers/containerDocumentsRoutes";
import { registerContainerCostingRoutes } from "./containers/containerCostingRoutes";

export function registerContainerRoutes(app: Express) {
  // Tracking routes registered first: they include literal-path routes like
  // /api/containers/eta-tracking-summary and /api/containers/refresh-etas that
  // must be matched before containerCrudRoutes' /api/containers/:id, since Express
  // resolves routes strictly in registration order (not by specificity).
  registerContainerTrackingRoutes(app);
  // Explicit pagination requests are handled in SQL; legacy callers continue to
  // fall through to the compatibility readers below.
  registerContainerListPaginationRoutes(app);
  registerContainerCrudRoutes(app);
  registerContainerAccountingRoutes(app);
  registerContainerFreightRoutes(app);
  // Serialize and preflight the complete request, then commit reversal, inventory,
  // charge vouchers, replacement offload, and SP journals through one transaction.
  registerContainerOffloadLifecycleGuard(app);
  registerCentralContainerOffloadRoute(app);
  // Legacy reverse-offload and compatibility routes remain available; the central
  // POST/PATCH handlers above own all active offload creation and edit requests.
  registerContainerOffloadRoutes(app);
  registerContainerDocumentsRoutes(app);
  registerContainerCostingRoutes(app);
}
