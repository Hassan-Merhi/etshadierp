import type { Request } from "express";

import { resolvePermissionCompanyId } from "../../services/security/activeCompanyPermissionPolicy";

/**
 * Resolve the company ID that owns the current request.
 *
 * Factory and Properties routes use the server-pinned factoryCompanyId. ERP,
 * POS, administration, audit, import/export, repair, and reporting routes use
 * currentCompanyId even when another browser tab has Factory mode open.
 * Historical ERP container document/freight aliases under /api/factory remain
 * scoped to currentCompanyId through the shared route policy.
 *
 * Never trust a company ID from the request query string or body. This helper
 * uses only server-owned session state and the request path.
 */
export function resolveActiveCompanyId(req: Request): number | null {
  const path = req.originalUrl?.split("?", 1)[0] || req.path || "/";
  return resolvePermissionCompanyId({
    path,
    currentCompanyId: req.session.currentCompanyId,
    factoryCompanyId: req.session.factoryCompanyId,
  });
}
