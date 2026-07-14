import type { Express } from "express";
import { registerSupplierCrudRoutes } from "./supplierCrudRoutes";
import { registerSupplierFxRoutes } from "./supplierFxRoutes";
import { registerSupplierBalanceRoutes } from "./supplierBalanceRoutes";
import { registerSupplierStatementRoutes } from "./supplierStatementRoutes";
import { registerSupplierBrokerRoutes } from "./supplierBrokerRoutes";
import { registerFactoryFxDiagnosticRoutes } from "./fxDiagnosticRoutes";

export function registerFactorySuppliersRoutes(app: Express) {
  registerSupplierCrudRoutes(app);
  registerSupplierFxRoutes(app);
  registerSupplierBalanceRoutes(app);
  registerSupplierStatementRoutes(app);
  registerSupplierBrokerRoutes(app);
  registerFactoryFxDiagnosticRoutes(app);
}
