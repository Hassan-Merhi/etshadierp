/**
 * factoryCustomersRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerFactoryCustomerCrudRoutes } from "./crud";
import { registerFactoryCustomerStatementRoutes } from "./statement";
import { registerFactoryCustomerStatementPdfRoutes } from "./statement-pdf";
import { registerFactoryCustomerStatementExcelRoutes } from "./statement-excel";
import { registerFactoryCustomerMigrationRoutes } from "./migrations";
import { registerFactoryCustomerLogoRoutes } from "./logos";
import { registerFactoryCustomerSubModules } from "./sub-modules";

export function registerFactoryCustomersRoutes(app: Express) {
  registerFactoryCustomerCrudRoutes(app);
  registerFactoryCustomerStatementRoutes(app);
  registerFactoryCustomerStatementPdfRoutes(app);
  registerFactoryCustomerStatementExcelRoutes(app);
  registerFactoryCustomerMigrationRoutes(app);
  registerFactoryCustomerLogoRoutes(app);
  registerFactoryCustomerSubModules(app);
}
