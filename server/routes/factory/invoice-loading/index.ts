/**
 * factoryInvoiceLoadingRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerInvoiceLoadingSessionRoutes } from "./sessions";
import { registerInvoiceLoadingScanRoutes } from "./scanning";
import { registerInvoiceLoadingLifecycleRoutes } from "./lifecycle";
import { registerInvoiceLoadingReportRoutes } from "./invoice-reports";
import { registerInvoiceLoadingSessionReportRoutes } from "./session-reports";
import { registerInvoiceRemainingProformaRoutes } from "./remaining-proforma";

export function registerFactoryInvoiceLoadingRoutes(app: Express) {
  registerInvoiceLoadingSessionRoutes(app);
  registerInvoiceLoadingScanRoutes(app);
  registerInvoiceLoadingLifecycleRoutes(app);
  registerInvoiceLoadingReportRoutes(app);
  registerInvoiceLoadingSessionReportRoutes(app);
  registerInvoiceRemainingProformaRoutes(app);
}
