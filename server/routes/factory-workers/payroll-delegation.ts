/**
 * factoryWorkerRoutes: FactoryWorkerPayrollDelegation endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, RequestHandler } from "express";
import { registerFactoryWorkerPayrollRoutes } from "../factoryWorkerPayrollRoutes";

export function registerFactoryWorkerPayrollDelegation(app: Express, _requireAuth: RequestHandler, _db: unknown) {
  // Register payroll sub-routes (includes /amount-due, /payrolls, advances, etc.)
  // MUST come before /:id so that /amount-due is not captured as a wildcard ID.
  registerFactoryWorkerPayrollRoutes(app);
}
