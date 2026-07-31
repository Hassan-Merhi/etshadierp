/**
 * factoryDispatchBatchRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerDispatchBatchCrudRoutes } from "./batches";
import { registerDispatchTruckRideRoutes } from "./truck-rides";
import { registerDispatchBaleScanRoutes } from "./bale-scans";
import { registerDispatchTruckRideDispatchRoutes } from "./dispatch";
import { registerDispatchInvoiceRoutes } from "./invoicing";
import { registerDispatchBaleSearchRoutes } from "./bale-search";
import { registerDispatchReportRoutes } from "./reports";

export function registerDispatchBatchRoutes(app: Express) {
  registerDispatchBatchCrudRoutes(app);
  registerDispatchTruckRideRoutes(app);
  registerDispatchBaleScanRoutes(app);
  registerDispatchTruckRideDispatchRoutes(app);
  registerDispatchInvoiceRoutes(app);
  registerDispatchBaleSearchRoutes(app);
  registerDispatchReportRoutes(app);
}
