/**
 * factoryReportRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactorySupplierUsageReportRoutes } from "./supplier-usage";
import { registerFactoryMixBatchesByDateRoutes } from "./mix-batches";
import { registerFactoryMixBatchWhatsappRoutes } from "./whatsapp";

export function registerFactoryReportRoutes(app: Express, requireAuth: any, db: any) {
  registerFactorySupplierUsageReportRoutes(app, requireAuth, db);
  registerFactoryMixBatchesByDateRoutes(app, requireAuth, db);
  registerFactoryMixBatchWhatsappRoutes(app, requireAuth, db);
}
