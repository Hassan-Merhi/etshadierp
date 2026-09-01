/**
 * voucherSalesUpdateRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerVoucherUpdateRoutes } from "./update";
import { registerVoucherOptionalUpdateRoutes } from "./optional";
import { registerVoucherSalesLineUpdateRoutes } from "./sales";

export function registerVoucherSalesUpdateRoutes(app: Express) {
  registerVoucherUpdateRoutes(app);
  registerVoucherOptionalUpdateRoutes(app);
  registerVoucherSalesLineUpdateRoutes(app);
}
