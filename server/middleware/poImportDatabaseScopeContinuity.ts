import type { NextFunction, Request, Response } from "express";

import {
  createTenantDatabaseScope,
  getDatabaseScopeRuntimeContext,
  runWithDatabaseScopeRuntimeContext,
} from "../services/security/databaseScopeRuntimeContext";

/**
 * Re-roots the already-authorized tenant database scope immediately before the
 * multipart PO Import parser. The canonical tenant isolation boundary remains
 * the authorization decision point; this middleware never widens access or
 * accepts a caller-supplied company id.
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
