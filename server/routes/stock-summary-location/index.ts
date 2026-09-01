/**
 * stockSummaryLocationRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerLocationMonthlySummaryRoutes } from "./monthly-summary";
import { registerLocationMonthlyDetailRoutes } from "./monthly-detail";
import { registerLocationMonthlyVoucherRoutes } from "./monthly-vouchers";
import { registerLocationStockTransactionRoutes } from "./transactions";

export function registerStockSummaryLocationRoutes(app: Express) {
  registerLocationMonthlySummaryRoutes(app);
  registerLocationMonthlyDetailRoutes(app);
  registerLocationMonthlyVoucherRoutes(app);
  registerLocationStockTransactionRoutes(app);
}
