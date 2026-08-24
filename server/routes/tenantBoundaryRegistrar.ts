import type { Express } from "express";

import { tenantCompanyParamBoundary, tenantIsolationBoundary } from "../middleware/tenantIsolationBoundary";
import { securityHeadersMiddleware } from "../security/securityHeaders";

/**
 * Installs the canonical security and tenant boundaries ahead of every API
 * registrar and before the SPA/static handlers that are mounted afterward.
 *
 * This lives beside the registrars rather than in server/routes.ts because that
 * entry point is a bounded file: it may name registrars but may not mount
 * middleware itself. Registration order is still the caller's — these
 * boundaries only guard routes registered after this call, so they run first.
 */
export function registerTenantIsolationBoundary(app: Express): void {
  app.use(securityHeadersMiddleware());
  app.use(tenantIsolationBoundary);
  app.param("companyId", tenantCompanyParamBoundary);
}
