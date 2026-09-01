/**
 * supplierCrudRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactorySupplierCrudRoutes } from "./suppliers";
import { registerFactorySupplierCategoryRoutes } from "./categories";
import { registerFactorySupplierPaymentRoutes } from "./payments";

export function registerSupplierCrudRoutes(app: Express) {
  registerFactorySupplierCrudRoutes(app);
  registerFactorySupplierCategoryRoutes(app);
  registerFactorySupplierPaymentRoutes(app);
}
