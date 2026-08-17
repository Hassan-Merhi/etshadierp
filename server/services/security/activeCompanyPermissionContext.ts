import type { Request } from "express";
import { eq } from "drizzle-orm";
import { userCompanyRoles } from "@shared/schema";
import { db } from "../../db";
import { chooseActiveCompanyRole, resolvePermissionCompanyId } from "./activeCompanyPermissionPolicy";

export interface ActiveCompanyPermissionContext {
  userId: string;
  companyId: number;
  role: string;
  developerBypass: boolean;
  assignedLocationId: number | null;
  cashAccountId: number | null;
  posStation: number | null;
  canSellNegativeStock: boolean;
  posViewOnly: boolean;
  daybookEditDays: number;
  canAccessCustomers: boolean;
  canDeleteRecords: boolean;
}

export class ActiveCompanyPermissionContextError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
    public readonly code: "ACTIVE_COMPANY_CONTEXT_REQUIRED" | "ACTIVE_COMPANY_ROLE_REQUIRED"
  ) {
    super(message);
    this.name = "ActiveCompanyPermissionContextError";
  }
}

declare module "express-serve-static-core" {
  interface Request {
    _activeCompanyPermissionContext?: ActiveCompanyPermissionContext;
  }
}

/**
 * Resolve active-company role and operational permission fields from canonical
 * storage. This intentionally does not trust cached session role/POS fields.
 * Factory and Properties use the pinned company; ordinary ERP/POS routes use
 * currentCompanyId even when another browser tab has Factory mode open.
 */
export async function getActiveCompanyPermissionContext(req: Request): Promise<ActiveCompanyPermissionContext> {
  if (req._activeCompanyPermissionContext) {
    return req._activeCompanyPermissionContext;
  }

  const userId = req.session.userId;
  const requestPath = req.originalUrl.split("?", 1)[0] || req.path;
  const companyId = resolvePermissionCompanyId({
    path: requestPath,
    currentCompanyId: req.session.currentCompanyId,
    factoryCompanyId: req.session.factoryCompanyId,
  });
  if (!userId || !companyId) {
    throw new ActiveCompanyPermissionContextError(
      "An active company session is required.",
      401,
      "ACTIVE_COMPANY_CONTEXT_REQUIRED"
    );
  }

  const rows = await db
    .select({
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
    })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));

  const selected = chooseActiveCompanyRole(companyId, rows);
  if (!selected) {
    throw new ActiveCompanyPermissionContextError(
      "You no longer have access to the active company.",
      403,
      "ACTIVE_COMPANY_ROLE_REQUIRED"
    );
  }

  const activeRow = rows.find((row) => row.companyId === companyId) ?? null;
  const context: ActiveCompanyPermissionContext = {
    userId,
    companyId,
    role: selected.role,
    developerBypass: selected.developerBypass,
    assignedLocationId: activeRow?.assignedLocationId ?? null,
    cashAccountId: activeRow?.cashAccountId ?? null,
    posStation: activeRow?.posStation ?? null,
    canSellNegativeStock: selected.developerBypass ? true : (activeRow?.canSellNegativeStock ?? false),
    posViewOnly: selected.developerBypass ? false : (activeRow?.posViewOnly ?? false),
    daybookEditDays: selected.developerBypass ? 9999 : (activeRow?.daybookEditDays ?? 0),
    canAccessCustomers: selected.developerBypass ? true : (activeRow?.canAccessCustomers ?? false),
    canDeleteRecords: selected.developerBypass ? true : (activeRow?.canDeleteRecords ?? false),
  };
  req._activeCompanyPermissionContext = context;
  return context;
}
