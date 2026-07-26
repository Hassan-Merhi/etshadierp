import type { Request, Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { companies, userCompanyRoles, users } from "@shared/schema";

function activeCompanyId(req: Request): number | null {
  return (
    (req.session as any).factoryCompanyId ??
    req.session.currentCompanyId ??
    null
  );
}

function parsePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadTargetUserCompanyScope(userId: string) {
  return db
    .select({ companyId: userCompanyRoles.companyId, role: userCompanyRoles.role })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));
}

async function guardSingleCompanyUserMutation(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const targetUserId = String(req.params.id ?? req.params.userId ?? "").trim();
  if (!targetUserId) {
    res.status(400).json({ code: "USER_ID_INVALID", message: "Invalid user ID" });
    return true;
  }

  const roles = await loadTargetUserCompanyScope(targetUserId);
  if (!roles.some((row) => row.companyId === companyId)) {
    res.status(404).json({ message: "User not found" });
    return true;
  }

  if (roles.some((row) => row.companyId !== companyId)) {
    res.status(409).json({
      code: "SHARED_USER_GLOBAL_MUTATION_BLOCKED",
      message: "This user belongs to multiple companies. Manage the company role instead of changing the shared account globally.",
    });
    return true;
  }

  return false;
}

async function guardRoleRecordCompany(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  const roleId = parsePositiveId(req.params.id);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }
  if (!roleId) {
    res.status(400).json({ code: "ROLE_ID_INVALID", message: "Invalid role ID" });
    return true;
  }

  const [roleRecord] = await db
    .select({ companyId: userCompanyRoles.companyId })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.id, roleId))
    .limit(1);

  if (!roleRecord || roleRecord.companyId !== companyId) {
    res.status(404).json({ message: "Role assignment not found" });
    return true;
  }

  const requestedCompanyId = req.body?.companyId;
  if (requestedCompanyId !== undefined && Number(requestedCompanyId) !== companyId) {
    res.status(403).json({
      code: "CROSS_COMPANY_ACCESS_DENIED",
      message: "Role assignments cannot be moved between companies.",
    });
    return true;
  }

  return false;
}

async function respondWithCompanyUsers(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      active: users.active,
      chatbotEnabled: users.chatbotEnabled,
      hiddenErpCostFields: users.hiddenErpCostFields,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(
      userCompanyRoles,
      and(eq(userCompanyRoles.userId, users.id), eq(userCompanyRoles.companyId, companyId))
    )
    .where(ne(userCompanyRoles.role, "Developer"));

  res.json(rows);
  return true;
}

async function respondWithCompanyRoles(req: Request, res: Response): Promise<boolean> {
  const companyId = activeCompanyId(req);
  if (!companyId) {
    res.status(403).json({ code: "COMPANY_CONTEXT_REQUIRED", message: "No company selected" });
    return true;
  }

  const roles = await db
    .select({
      id: userCompanyRoles.id,
      userId: userCompanyRoles.userId,
      companyId: userCompanyRoles.companyId,
      role: userCompanyRoles.role,
      assignedLocationId: userCompanyRoles.assignedLocationId,
      cashAccountId: userCompanyRoles.cashAccountId,
      posStation: userCompanyRoles.posStation,
      canSellNegativeStock: userCompanyRoles.canSellNegativeStock,
      posViewOnly: userCompanyRoles.posViewOnly,
      daybookEditDays: userCompanyRoles.daybookEditDays,
      canAccessCustomers: userCompanyRoles.canAccessCustomers,
      canDeleteRecords: userCompanyRoles.canDeleteRecords,
      createdAt: userCompanyRoles.createdAt,
      companyName: companies.name,
      companyCode: companies.code,
    })
    .from(userCompanyRoles)
    .innerJoin(companies, eq(companies.id, userCompanyRoles.companyId))
    .where(
      and(
        eq(userCompanyRoles.userId, req.params.userId),
        eq(userCompanyRoles.companyId, companyId)
      )
    );

  res.json(roles);
  return true;
}

/**
 * Runs inside requireAuth before legacy route middleware. Returns true when the
 * request has been fully handled or rejected; false means normal routing may continue.
 */
export async function interceptCompanyScopedUserAdministration(
  req: Request,
  res: Response
): Promise<boolean> {
  const role = req.session.currentRole;
  if (role !== "Admin" && role !== "Developer") return false;

  const method = req.method.toUpperCase();
  const path = req.path;

  if (method === "GET" && path === "/api/users") {
    return respondWithCompanyUsers(req, res);
  }
  if (method === "GET" && /^\/api\/users\/[^/]+\/company-roles$/.test(path)) {
    return respondWithCompanyRoles(req, res);
  }
  if ((method === "PATCH" || method === "DELETE") && /^\/api\/users\/[^/]+$/.test(path)) {
    return guardSingleCompanyUserMutation(req, res);
  }
  if (method === "POST" && /^\/api\/admin\/reset-password\/[^/]+$/.test(path)) {
    return guardSingleCompanyUserMutation(req, res);
  }
  if ((method === "PATCH" || method === "DELETE") && /^\/api\/user-company-roles\/[^/]+$/.test(path)) {
    return guardRoleRecordCompany(req, res);
  }

  return false;
}
