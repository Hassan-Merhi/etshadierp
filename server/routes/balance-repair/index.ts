/**
 * balanceRepairRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import {
  privilegedConcurrencyLimit,
  privilegedMutationRateLimit,
  privilegedRequestBudget,
} from "../../middleware/privilegedEndpointSecurity";
import { registerBalanceRepairScanRoutes } from "./scan";
import { registerBalanceRepairApplyRoutes } from "./apply";
import { registerBalanceRepairUndoRoutes } from "./undo";

const balanceRepairBudget = privilegedRequestBudget({ maxBodyBytes: 256 * 1024, maxCollectionItems: 500 });
const balanceRepairConcurrency = privilegedConcurrencyLimit({ scope: "balance-repair" });

export function registerBalanceRepairRoutes(app: Express) {
  app.use("/api/admin/repair-balances", privilegedMutationRateLimit, balanceRepairBudget, balanceRepairConcurrency);
  registerBalanceRepairScanRoutes(app);
  registerBalanceRepairApplyRoutes(app);
  registerBalanceRepairUndoRoutes(app);
}
