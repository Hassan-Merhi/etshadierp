/**
 * supplierBalanceRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerSupplierBalanceSingleRoutes } from "./single";
import { registerSupplierWithBalancesRoutes } from "./with-balances";

export function registerSupplierBalanceRoutes(app: Express) {
  registerSupplierBalanceSingleRoutes(app);
  registerSupplierWithBalancesRoutes(app);
}
