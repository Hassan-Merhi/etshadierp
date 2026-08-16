/**
 * supplierProfitCheckRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerSupplierProfitLookupRoutes } from "./lookups";
import { registerSupplierProfitAnalyzeRoutes } from "./analyze";
import { registerSupplierProfitProformaRoutes } from "./proforma";
import { registerSupplierProfitExportRoutes } from "./export";
import { registerSupplierProfitPoOverrideRoutes } from "./po-overrides";
import { registerSupplierProfitImportRoutes } from "./import-by-codes";
import { registerSupplierProfitAddStockItemRoutes } from "./add-stock-item";

export function registerSupplierProfitCheckRoutes(app: Express, requireAuth: unknown) {
  registerSupplierProfitLookupRoutes(app, requireAuth);
  registerSupplierProfitAnalyzeRoutes(app, requireAuth);
  registerSupplierProfitProformaRoutes(app, requireAuth);
  registerSupplierProfitExportRoutes(app, requireAuth);
  registerSupplierProfitPoOverrideRoutes(app, requireAuth);
  registerSupplierProfitImportRoutes(app, requireAuth);
  registerSupplierProfitAddStockItemRoutes(app, requireAuth);
}
