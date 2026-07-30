/**
 * Supplier-Partner migration route composition.
 *
 * Registration order matches the original single-file module exactly.
 */
import type { Express } from "express";
import { registerSpMigrationRunRoutes } from "./spMigrationRunRoutes";
import { registerSpMigrationSetupRoutes } from "./spMigrationSetupRoutes";
import { registerSpMigrationStockRoutes } from "./spMigrationStockRoutes";
import { registerSpMigrationSalesRoutes } from "./spMigrationSalesRoutes";
import { registerSpMigrationReconciliationRoutes } from "./spMigrationReconciliationRoutes";

export function registerSpMigrationRoutes(app: Express) {
  registerSpMigrationRunRoutes(app);
  registerSpMigrationSetupRoutes(app);
  registerSpMigrationStockRoutes(app);
  registerSpMigrationSalesRoutes(app);
  registerSpMigrationReconciliationRoutes(app);
}
