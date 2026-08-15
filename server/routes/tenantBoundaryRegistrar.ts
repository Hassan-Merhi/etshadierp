import type { Express } from "express";

import { tenantCompanyParamBoundary, tenantIsolationBoundary } from "../middleware/tenantIsolationBoundary";

/**
 * Installs the canonical tenant boundary ahead of every API registrar.
 *
 * This lives beside the registrars rather than in server/routes.ts because that
 * entry point is a bounded file: it may name registrars but may not mount
 * middleware itself. Registration order is still the caller's — the boundary
 * only guards routes registered after this call, so it runs first.
 */
export function registerTenantIsolationBoundary(app: Express): void {
  app.use(tenantIsolationBoundary);
  app.param("companyId", tenantCompanyParamBoundary);
}
