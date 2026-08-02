/**
 * importCycleRoutes route composition.
 *
 * Registration order matches the original single-file module exactly.
 * Express resolves first-match, so reordering these calls can change which
 * handler serves a request - config/route-manifest.json pins the result.
 */
import type { Express } from "express";
import { registerImportCycleBalanceRoutes } from "./balance";
import { registerImportCycleDiagnosticRoutes } from "./diagnostics";

export function registerImportCycleRoutes(app: Express) {
  registerImportCycleBalanceRoutes(app);
  registerImportCycleDiagnosticRoutes(app);
}
