/**
 * factoryCustomersRoutes: FactoryCustomerSubModules endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { registerFactoryCustomerProformaRoutes } from "../customer-proformas";
import { registerFactoryCustomerOrderRoutes } from "../factoryCustomerOrderRoutes";

export function registerFactoryCustomerSubModules(app: Express) {
  registerFactoryCustomerProformaRoutes(app);
  registerFactoryCustomerOrderRoutes(app);
}
