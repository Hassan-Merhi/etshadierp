import type { Express } from "express";
import { registerSupplierCrudRoutes } from "./suppliers/crud";
import { registerSupplierFxRoutes } from "./suppliers/fx";
import { registerSupplierBalanceRoutes } from "./suppliers/supplierBalanceRoutes";
import { registerSupplierStatementRoutes } from "./suppliers/supplierStatementRoutes";
import { registerSupplierBrokerRoutes } from "./suppliers/broker";
import { registerFactoryFxDiagnosticRoutes } from "./suppliers/fxDiagnosticRoutes";

export function registerFactorySuppliersRoutes(app: Express) {
  registerSupplierCrudRoutes(app);
  registerSupplierFxRoutes(app);
  registerSupplierBalanceRoutes(app);
  registerSupplierStatementRoutes(app);
  registerSupplierBrokerRoutes(app);
  registerFactoryFxDiagnosticRoutes(app);
}
