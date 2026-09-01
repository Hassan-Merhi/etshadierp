import type { Express, NextFunction, Request, Response } from "express";

import { tenantCompanyParamBoundary, tenantIsolationBoundary } from "../middleware/tenantIsolationBoundary";
import { browserMutationFailClosedBoundary } from "../security/browserMutationBoundary";
import { securityHeadersMiddleware } from "../security/securityHeaders";
import {
  createTenantDatabaseScope,
  getDatabaseScopeRuntimeContext,
  runWithDatabaseScopeRuntimeContext,
} from "../services/security/databaseScopeRuntimeContext";

/**
 * Re-roots the already-authorized tenant database scope immediately before the
 * multipart PO Import parser. The canonical tenantIsolationBoundary above is
 * still the authorization decision point; this middleware never widens access
 * or accepts a caller-supplied company id.
 *
 * Multipart parsing introduces an additional asynchronous middleware hop before
 * the route reads stock_items. Production has shown that this path can arrive at
 * the database without the request AsyncLocalStorage scope, which makes the
 * fail-closed stock_items RLS policy reject an otherwise authorized request.
 * Re-establishing the session-owned company scope here keeps RLS enabled while
 * ensuring every PostgreSQL lease for the parse request receives the tenant GUCs.
 */
export function poImportDatabaseScopeContinuityBoundary(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return next();

  const companyId = Number(req.session.currentCompanyId);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return next();

  const currentScope = getDatabaseScopeRuntimeContext();
  if (currentScope?.kind === "tenant" && currentScope.companyId !== companyId) {
    return res.status(403).json({
      code: "PO_IMPORT_COMPANY_SCOPE_MISMATCH",
      message: "PO Import company scope does not match the active company.",
    });
  }

  const tenantScope =
    currentScope?.kind === "tenant"
      ? currentScope
      : createTenantDatabaseScope(companyId, [], "active-company");

  return runWithDatabaseScopeRuntimeContext(tenantScope, () => next());
}

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
  app.use(browserMutationFailClosedBoundary);
  app.use(tenantIsolationBoundary);
  app.use("/api/po-import/parse", poImportDatabaseScopeContinuityBoundary);
  app.param("companyId", tenantCompanyParamBoundary);
}
