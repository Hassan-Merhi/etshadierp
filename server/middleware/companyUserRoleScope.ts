import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { userCompanyRoles } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { resolveActiveCompanyId } from "../routes/helpers/resolveActiveCompanyId";
import { enforceGlobalMaintenanceScope } from "./globalMaintenanceScope";
import {
  canAccessTargetUser,
  filterRolesForCompany,
  visibleUserIdsForCompany,
  type CompanyUserRoleRow,
} from "../services/security/companyUserAdminScopePolicy";

async function loadRoleRows(userId?: string): Promise<CompanyUserRoleRow[]> {
  const query = db
    .select({
      userId: userCompanyRoles.userId,
      companyId: userCompanyRoles.companyId,
      role: userCompanyRoles.role,
    })
    .from(userCompanyRoles);

  return userId ? await query.where(eq(userCompanyRoles.userId, userId)) : await query;
}

function installJsonArrayFilter(res: Response, filter: (rows: any[]) => any[]): void {
  const originalJson = res.json.bind(res);
  (res as any).json = (body: unknown) =>
    originalJson(Array.isArray(body) ? filter(body) : body);
}

function deny(req: Request, res: Response, companyId: number, reason: string, message: string): false {
  logger.error(
    JSON.stringify({
      event: "company_user_role_scope_denied",
      ts: new Date().toISOString(),
      userId: req.session.userId ?? null,
      username: req.session.username ?? null,
      role: req.session.currentRole ?? null,
      companyId,
      method: req.method,
      path: req.path,
      reason,
    })
  );
  res.status(404).json({ message });
  return false;
}

export async function enforceCompanyUserRoleScope(
  req: Request,
  res: Response
): Promise<boolean> {
  // This middleware is the first Program 3A gateway registered before legacy
  // routes, so globally destructive maintenance checks run here as well.
  if (!enforceGlobalMaintenanceScope(req, res)) return false;

  const sessionUserId = req.session.userId;
  const actorRole = req.session.currentRole;
  const companyId = resolveActiveCompanyId(req);
  if (!sessionUserId || !actorRole || !companyId) return true;

  const method = req.method.toUpperCase();
  const path = req.path;

  if (method === "GET" && path === "/api/users") {
    const roleRows = await loadRoleRows();
    const visibleIds = visibleUserIdsForCompany(roleRows, companyId);
    installJsonArrayFilter(res, (rows) =>
      rows.filter((row) => typeof row?.id === "string" && visibleIds.has(row.id))
    );
    return true;
  }

  const rolesMatch = path.match(/^\/api\/users\/([^/]+)\/company-roles$/);
  if (method === "GET" && rolesMatch) {
    const targetUserId = decodeURIComponent(rolesMatch[1]);
    const targetRows = await loadRoleRows(targetUserId);
    if (!canAccessTargetUser(targetRows, targetUserId, companyId, actorRole)) {
      return deny(req, res, companyId, "USER_COMPANY_SCOPE_DENIED", "User not found");
    }
    installJsonArrayFilter(res, (rows) => filterRolesForCompany(rows, companyId));
    return true;
  }

  const roleMatch = path.match(/^\/api\/user-company-roles\/(\d+)$/);
  if (roleMatch && ["PATCH", "DELETE"].includes(method)) {
    const roleId = Number(roleMatch[1]);
    const [targetRole] = await db
      .select({
        userId: userCompanyRoles.userId,
        companyId: userCompanyRoles.companyId,
      })
      .from(userCompanyRoles)
      .where(eq(userCompanyRoles.id, roleId))
      .limit(1);

    if (!targetRole || targetRole.companyId !== companyId) {
      return deny(req, res, companyId, "ROLE_RECORD_SCOPE_DENIED", "Role not found");
    }

    const targetRows = await loadRoleRows(targetRole.userId);
    if (!canAccessTargetUser(targetRows, targetRole.userId, companyId, actorRole)) {
      return deny(req, res, companyId, "ROLE_TARGET_SCOPE_DENIED", "Role not found");
    }
  }

  return true;
}
