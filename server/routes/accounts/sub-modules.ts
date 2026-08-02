/**
 * accountRoutes: AccountSubModules endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { registerAccountTransactionRoutes } from "../accountTransactionRoutes";
import { registerAccountStatementRoutes } from "../accountStatementRoutes";

export function registerAccountSubModules(app: Express) {
  registerAccountTransactionRoutes(app);

  registerAccountStatementRoutes(app);
}
