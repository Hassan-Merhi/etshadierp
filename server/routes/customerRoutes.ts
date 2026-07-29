import type { Express } from "express";

import { registerContainerSalesRoutes } from "./containers/containerSalesRoutes";
import { registerCustomerMasterRoutes } from "./customers/customerMasterRoutes";
import { registerCompanyTransferRoutes } from "./transfers/companyTransferRoutes";

export function registerCustomerRoutes(app: Express) {
  registerCustomerMasterRoutes(app);
  registerContainerSalesRoutes(app);
  registerCompanyTransferRoutes(app);
}
