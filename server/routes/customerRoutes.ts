import type { Express } from "express";

import { registerContainerSalesRoutes } from "./containers/containerSalesRoutes";
import { registerCustomerRoutes as registerCustomerLegacyRoutes } from "./customerRoutesLegacy";
import { registerCustomerMasterRoutes } from "./customers/customerMasterRoutes";
import { registerCompanyTransferRoutes } from "./transfers/companyTransferRoutes";

export function registerCustomerRoutes(app: Express) {
  // Focused modules register before the byte-for-byte compatibility registry so
  // migrated URLs use their service/repository boundaries while untouched legacy
  // endpoints continue to behave exactly as before.
  registerCustomerMasterRoutes(app);
  registerContainerSalesRoutes(app);
  registerCompanyTransferRoutes(app);
  registerCustomerLegacyRoutes(app);
}
