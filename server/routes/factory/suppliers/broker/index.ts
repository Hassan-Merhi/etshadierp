/**
 * supplierBrokerRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";

// buildBrokerStatement is used by five employee-pos modules, so the barrel
// re-exports it and their import path stays "../suppliers/broker".
export { buildBrokerStatement } from "./_helpers";
import { registerSupplierBrokerStatementRoutes } from "./statement";
import { registerSupplierBrokerVisualStatementRoutes } from "./visual-statement";
import { registerSupplierDirectContainerRoutes } from "./direct-containers";

export function registerSupplierBrokerRoutes(app: Express) {
  registerSupplierBrokerStatementRoutes(app);
  registerSupplierBrokerVisualStatementRoutes(app);
  registerSupplierDirectContainerRoutes(app);
}
