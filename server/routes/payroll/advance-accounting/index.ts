/**
 * advanceAccountingRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerAdvanceRepayByMonthRoutes } from "./repay-by-month";
import { registerAdvanceCashRoutes } from "./cash";
import { registerAdvanceRepaymentAuditRoutes } from "./repayment-audit";
import { registerAdvanceRepaymentRoutes } from "./repayments";
import { registerAdvanceBulkRepayRoutes } from "./bulk-repay";

export function registerAdvanceAccountingRoutes(app: Express) {
  registerAdvanceRepayByMonthRoutes(app);
  registerAdvanceCashRoutes(app);
  registerAdvanceRepaymentAuditRoutes(app);
  registerAdvanceRepaymentRoutes(app);
  registerAdvanceBulkRepayRoutes(app);
}
