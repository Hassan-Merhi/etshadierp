/**
 * orderPdfExportRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerOrderPendingExportRoutes } from "./pending";
import { registerOrderPdfRoutes } from "./order-pdf";
import { registerOrderLoadingStatusExportRoutes } from "./loading-status";

export function registerOrderPdfExportRoutes(app: Express) {
  registerOrderPendingExportRoutes(app);
  registerOrderPdfRoutes(app);
  registerOrderLoadingStatusExportRoutes(app);
}
