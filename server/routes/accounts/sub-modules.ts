/**
 * accountRoutes: AccountSubModules endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { registerHistoricalSupplierReferenceRoutes } from "./historicalSupplierReferenceRoutes";
import { registerAccountTransactionRoutes } from "../accountTransactionRoutes";
import { registerAccountStatementRoutes } from "../accountStatementRoutes";

export function registerAccountSubModules(app: Express) {
  // Supplier statements need the compatibility route first so legacy linked-child
  // POs can be shown as zero-impact references without changing any balances.
  registerHistoricalSupplierReferenceRoutes(app);
  registerAccountTransactionRoutes(app);

  registerAccountStatementRoutes(app);
}
