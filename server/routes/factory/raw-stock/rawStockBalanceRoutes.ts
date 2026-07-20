import type { Express } from "express";
import { registerOpeningBalanceAssignmentRoutesV5 } from "./openingBalanceAssignmentRoutesV5";
import { registerRawStockBalanceRoutes as registerLegacyRawStockBalanceRoutes } from "./rawStockBalanceRoutesLegacy";

/**
 * Register the transaction-safe assignment endpoint first. Express resolves it
 * before the preserved legacy endpoint with the same path; all unrelated raw-
 * stock balance routes remain unchanged in the legacy module.
 */
export function registerRawStockBalanceRoutes(app: Express): void {
  registerOpeningBalanceAssignmentRoutesV5(app);
  registerLegacyRawStockBalanceRoutes(app);
}
