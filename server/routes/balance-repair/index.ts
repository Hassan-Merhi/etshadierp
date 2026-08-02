/**
 * balanceRepairRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerBalanceRepairScanRoutes } from "./scan";
import { registerBalanceRepairApplyRoutes } from "./apply";
import { registerBalanceRepairUndoRoutes } from "./undo";

export function registerBalanceRepairRoutes(app: Express) {
  registerBalanceRepairScanRoutes(app);
  registerBalanceRepairApplyRoutes(app);
  registerBalanceRepairUndoRoutes(app);
}
