import type { Express } from "express";
import { registerSupplierCrudRoutes } from "./suppliers/supplierCrudRoutes";
import { registerSupplierFxRoutes } from "./suppliers/supplierFxRoutes";
import { registerSupplierBalanceRoutes } from "./suppliers/supplierBalanceRoutes";
import { registerSupplierStatementRoutes } from "./suppliers/supplierStatementRoutes";
import { registerSupplierBrokerRoutes } from "./suppliers/supplierBrokerRoutes";

export function registerFactorySuppliersRoutes(app: Express) {
  registerSupplierCrudRoutes(app);
  registerSupplierFxRoutes(app);
  registerSupplierBalanceRoutes(app);
  registerSupplierStatementRoutes(app);
  registerSupplierBrokerRoutes(app);
}
