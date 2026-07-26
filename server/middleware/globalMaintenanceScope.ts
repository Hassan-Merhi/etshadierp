import type { Request, Response } from "express";
import { logger } from "../lib/logger";
import { classifyGlobalMaintenanceRoute } from "../services/security/globalMaintenanceRoutePolicy";

export function enforceGlobalMaintenanceScope(req: Request, res: Response): boolean {
  const match = classifyGlobalMaintenanceRoute(req.method, req.path);
  if (!match) return true;

  // The legacy route's requireAuth middleware remains authoritative for
  // unauthenticated requests. This guard only narrows an authenticated role.
  if (!req.session.userId) return true;
  if (req.session.currentRole === "Developer") return true;

  logger.error(
    JSON.stringify({
      event: "global_maintenance_scope_denied",
      ts: new Date().toISOString(),
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
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
