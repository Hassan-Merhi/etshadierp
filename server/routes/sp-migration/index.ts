/**
 * Supplier-Partner migration route composition.
 *
 * Registration order matches the original single-file module exactly.
 */
import type { Express, RequestHandler } from "express";
import { privilegedMigrationRateLimit, privilegedRequestBudget } from "../../middleware/privilegedEndpointSecurity";
import { registerSpMigrationRunRoutes } from "./spMigrationRunRoutes";
import { registerSpMigrationSetupRoutes } from "./spMigrationSetupRoutes";
import { registerSpMigrationStockRoutes } from "./spMigrationStockRoutes";
import { registerSpMigrationSalesRoutes } from "./spMigrationSalesRoutes";
import { registerSpMigrationReconciliationRoutes } from "./spMigrationReconciliationRoutes";

const spMigrationRequestBudget = privilegedRequestBudget({
  maxBodyBytes: 1024 * 1024,
  maxCollectionItems: 2_000,
});
const spMigrationRateLimit: RequestHandler = (req, res, next) => privilegedMigrationRateLimit(req, res, next);
const spMigrationRequestBudgetMiddleware: RequestHandler = (req, res, next) => spMigrationRequestBudget(req, res, next);

export function registerSpMigrationRoutes(app: Express) {
  app.use("/api/sp/migration", spMigrationRateLimit, spMigrationRequestBudgetMiddleware);
  registerSpMigrationRunRoutes(app);
  registerSpMigrationSetupRoutes(app);
  registerSpMigrationStockRoutes(app);
  registerSpMigrationSalesRoutes(app);
  registerSpMigrationReconciliationRoutes(app);
}
