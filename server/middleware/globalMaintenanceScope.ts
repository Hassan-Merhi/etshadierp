import type { Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  classifyGlobalMaintenanceRoute,
  type GlobalMaintenanceRouteMatch,
} from "../services/security/globalMaintenanceRoutePolicy";

export function canAccessGlobalMaintenanceRoute(
  match: GlobalMaintenanceRouteMatch,
  role: string | null | undefined,
): boolean {
  if (role === "Developer") return true;

  // Account migration routes already require either Admin or Developer at the
  // route level. Keep the global-maintenance guard aligned with that contract
  // while leaving every other global maintenance operation Developer-only.
  return match.operation === "account-migration" && role === "Admin";
}

export function enforceGlobalMaintenanceScope(req: Request, res: Response): boolean {
  const match = classifyGlobalMaintenanceRoute(req.method, req.path);
  if (!match) return true;

  // The legacy route's requireAuth middleware remains authoritative for
  // unauthenticated requests. This guard only narrows an authenticated role.
  if (!req.session.userId) return true;
  if (canAccessGlobalMaintenanceRoute(match, req.session.currentRole)) return true;

  logger.error(
    JSON.stringify({
      event: "global_maintenance_scope_denied",
      ts: new Date().toISOString(),
      userId: req.session.userId ?? null,
      role: req.session.currentRole ?? null,
      companyId: req.session.currentCompanyId ?? null,
      method: req.method,
      path: req.path,
      operation: match.operation,
    })
  );
  res.status(403).json({
    message: "Developer access required for this global maintenance operation",
    code: "GLOBAL_MAINTENANCE_DEVELOPER_REQUIRED",
  });
  return false;
}
