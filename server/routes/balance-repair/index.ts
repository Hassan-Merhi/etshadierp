/**
 * balanceRepairRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express, RequestHandler } from "express";
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
const balanceRepairRateLimit: RequestHandler = (req, res, next) => privilegedMutationRateLimit(req, res, next);
const balanceRepairBudgetMiddleware: RequestHandler = (req, res, next) => balanceRepairBudget(req, res, next);
const balanceRepairConcurrencyMiddleware: RequestHandler = (req, res, next) => balanceRepairConcurrency(req, res, next);

export function registerBalanceRepairRoutes(app: Express) {
  app.use(
    "/api/admin/repair-balances",
    balanceRepairRateLimit,
    balanceRepairBudgetMiddleware,
    balanceRepairConcurrencyMiddleware
  );
  registerBalanceRepairScanRoutes(app);
  registerBalanceRepairApplyRoutes(app);
  registerBalanceRepairUndoRoutes(app);
}
