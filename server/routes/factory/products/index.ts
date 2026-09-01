/**
 * factoryProductsRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryCategoryRoutes } from "./categoryRoutes";
import { registerFactoryProductReadRoutes } from "./productReadRoutes";
import { registerFactoryProductWriteRoutes } from "./productWriteRoutes";
import { registerFactoryProductCascadeRoutes } from "./productCascadeRoutes";
import { registerFactoryProductHistoryRoutes } from "./productHistoryRoutes";
import { registerFactoryProductBulkRoutes } from "./productBulkRoutes";
import { registerFactoryProductImportRoutes } from "./productImportRoutes";
import { registerFactoryProductImageRoutes } from "./productImageRoutes";
import { registerCustomerLoadingRoutes } from "./customerLoadingRoutes";

export function registerFactoryProductsRoutes(app: Express) {
  registerFactoryCategoryRoutes(app);
  registerCustomerLoadingRoutes(app);
  registerFactoryProductReadRoutes(app);
  registerFactoryProductWriteRoutes(app);
  registerFactoryProductCascadeRoutes(app);
  registerFactoryProductHistoryRoutes(app);
  registerFactoryProductBulkRoutes(app);
  registerFactoryProductImportRoutes(app);
  registerFactoryProductImageRoutes(app);
}
