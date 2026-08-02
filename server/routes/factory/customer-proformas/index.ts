/**
 * factoryCustomerProformaRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryCustomerProformaCrudRoutes } from "./proformas";
import { registerFactoryCustomerProformaLoadingRoutes } from "./create-loading";
import { registerFactoryCustomerProformaLineRoutes } from "./lines";
import { registerFactoryCustomerProformaBulkPricingRoutes } from "./bulk-and-pricing";
import { registerFactoryCustomerProformaTransferRoutes } from "./transfer";
import { registerFactoryStockAllocationRoutes } from "./stock-allocation";
import { registerFactoryCustomerProformaExportRoutes } from "./exports";
import { registerFactoryCustomerPriceListRoutes } from "./price-lists";

export function registerFactoryCustomerProformaRoutes(app: Express) {
  registerFactoryCustomerProformaCrudRoutes(app);
  registerFactoryCustomerProformaLoadingRoutes(app);
  registerFactoryCustomerProformaLineRoutes(app);
  registerFactoryCustomerProformaBulkPricingRoutes(app);
  registerFactoryCustomerProformaTransferRoutes(app);
  registerFactoryStockAllocationRoutes(app);
  registerFactoryCustomerProformaExportRoutes(app);
  registerFactoryCustomerPriceListRoutes(app);
}
