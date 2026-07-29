import type { Express } from "express";

import { registerCustomerMasterRoutes } from "./customers/customerMasterRoutes";
import { registerCustomerRoutes as registerCustomerLegacyRoutes } from "./customerRoutesLegacy";

export function registerCustomerRoutes(app: Express) {
  // Customer master/accounting routes register first and shadow their legacy
  // compatibility handlers. Container sales, transfers, and the remaining
  // historical endpoints continue through the untouched legacy registry.
  registerCustomerMasterRoutes(app);
  registerCustomerLegacyRoutes(app);
}
