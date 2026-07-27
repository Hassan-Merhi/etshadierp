import type { Request } from "express";
import { eq } from "drizzle-orm";
import { userCompanyRoles } from "@shared/schema";
import { db } from "../../db";
import { resolveActiveCompanyId } from "../../routes/helpers/resolveActiveCompanyId";

export interface ActiveCompanyPermissionContext {
  userId: string;
  companyId: number;
  role: string;
  developerBypass: boolean;
}

export class ActiveCompanyPermissionContextError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
    public readonly code:
      | "ACTIVE_COMPANY_CONTEXT_REQUIRED"
      | "ACTIVE_COMPANY_ROLE_REQUIRED"
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

export function chooseActiveCompanyRole(
  companyId: number,
  rows: ReadonlyArray<{ companyId: number; role: string }>
): { role: string; developerBypass: boolean } | null {
  const activeRole = rows.find((row) => row.companyId === companyId);
  if (activeRole) {
    return {
      role: activeRole.role,
      developerBypass: activeRole.role === "Developer",
    };
  }

  if (rows.some((row) => row.role === "Developer")) {
    return { role: "Developer", developerBypass: true };
  }

  return null;
}

/**
 * Resolve the role used by role-feature permissions from canonical storage.
 * This intentionally does not trust session.currentRole because Factory and
 * Properties requests may use session.factoryCompanyId and because role changes
 * must take effect without waiting for a stale browser session to expire.
 */
export async function getActiveCompanyPermissionContext(
  req: Request
): Promise<ActiveCompanyPermissionContext> {
  if (req._activeCompanyPermissionContext) {
    return req._activeCompanyPermissionContext;
  }

  const userId = req.session.userId;
  const companyId = resolveActiveCompanyId(req);
  if (!userId || !companyId) {
    throw new ActiveCompanyPermissionContextError(
      "An active company session is required.",
      401,
      "ACTIVE_COMPANY_CONTEXT_REQUIRED"
    );
  }

  const rows = await db
    .select({ companyId: userCompanyRoles.companyId, role: userCompanyRoles.role })
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

  const context: ActiveCompanyPermissionContext = {
    userId,
    companyId,
    role: selected.role,
    developerBypass: selected.developerBypass,
  };
  req._activeCompanyPermissionContext = context;
  return context;
}
