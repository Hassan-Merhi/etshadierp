import type { Request, Response } from "express";

import { storage } from "../storage";

export type PrivilegedRole = "Admin" | "Owner" | "Developer";

export class CompanyAccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "CompanyAccessError";
  }
}

export interface CompanyAccessContext {
  userId: string;
  activeCompanyId: number;
  role: string;
}

export function parsePositiveCompanyId(value: unknown, label = "companyId"): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CompanyAccessError(400, `${label} must be a positive integer`, "INVALID_COMPANY_ID");
  }
  return parsed;
}

export function getCompanyAccessContext(req: Request): CompanyAccessContext {
  const userId = String(req.session?.userId ?? req.user?.id ?? "").trim();
  if (!userId) {
    throw new CompanyAccessError(401, "Authentication required", "AUTH_REQUIRED");
  }

  const activeCompanyId = parsePositiveCompanyId(req.session?.currentCompanyId, "activeCompanyId");
  const role = String(req.session?.currentRole ?? req.user?.role ?? "");
  return { userId, activeCompanyId, role };
}

export function isPrivilegedRole(role: string | null | undefined): role is PrivilegedRole {
  return role === "Admin" || role === "Owner" || role === "Developer";
}

/**
 * Resolves the companies available to a user using the same policy as the
 * company selector and set-company route.
 *
 * Developer accounts intentionally receive synthetic access to every company
 * in those routes. The shared boundary must mirror that policy; otherwise a
 * Developer can validly select a company and then have every protected data
 * endpoint reject it with COMPANY_ACCESS_DENIED. All other roles remain limited
 * to explicit user_company_roles assignments.
 */
export async function getAccessibleCompanyIds(userId: string): Promise<Set<number>> {
  const roles = await storage.getUserCompaniesWithRoles(userId);

  // A Developer may hold the role either per company (user_company_roles) or only
  // on the user record itself. set-company accepts the account-level role and
  // fabricates a company role for it, so the boundary must honour the same source
  // of truth — otherwise the selected company is unreachable for every data route.
  let isDeveloper = roles.some((entry) => entry.role === "Developer");
  if (!isDeveloper) {
    const user = await storage.getUser(userId);
    isDeveloper = (user as any)?.role === "Developer";
  }

  if (isDeveloper) {
    const companies = await storage.getAllCompanies();
    return new Set(
      companies
        .map((company) => Number(company.id))
        .filter((companyId: number) => Number.isInteger(companyId) && companyId > 0)
    );
  }

  return new Set(
    roles
      .map((entry) => Number(entry.companyId))
      .filter((companyId: number) => Number.isInteger(companyId) && companyId > 0)
  );
}

export async function assertCompanyAccess(userId: string, companyId: number): Promise<void> {
  const targetCompanyId = parsePositiveCompanyId(companyId);
  const accessible = await getAccessibleCompanyIds(userId);
  if (!accessible.has(targetCompanyId)) {
    throw new CompanyAccessError(403, "No access to this company", "COMPANY_ACCESS_DENIED");
  }
}

export async function assertCompaniesAccess(userId: string, companyIds: readonly number[]): Promise<void> {
  const normalized = [...new Set(companyIds.map((companyId) => parsePositiveCompanyId(companyId)))];
  const accessible = await getAccessibleCompanyIds(userId);
  const denied = normalized.filter((companyId) => !accessible.has(companyId));
  if (denied.length > 0) {
    throw new CompanyAccessError(403, "No access to one or more companies", "COMPANY_ACCESS_DENIED");
  }
}

/**
 * Resolves an explicitly requested company after checking both privilege and
 * canonical membership. This helper is for intentional cross-company tools;
 * ordinary tenant routes should use the active company and the strict global
 * tenant boundary instead of accepting an override.
 */
export async function resolveAuthorizedCompanyId(req: Request, requestedCompanyId?: unknown): Promise<number> {
  const context = getCompanyAccessContext(req);
  const hasOverride = requestedCompanyId !== undefined && requestedCompanyId !== null && requestedCompanyId !== "";
  const targetCompanyId = hasOverride
    ? parsePositiveCompanyId(requestedCompanyId, "requestedCompanyId")
    : context.activeCompanyId;

  if (targetCompanyId !== context.activeCompanyId && !isPrivilegedRole(context.role)) {
    throw new CompanyAccessError(403, "Cross-company access requires a privileged role", "CROSS_COMPANY_FORBIDDEN");
  }

  await assertCompanyAccess(context.userId, targetCompanyId);
  return targetCompanyId;
}

export async function assertActiveCompanyAccess(req: Request): Promise<CompanyAccessContext> {
  const context = getCompanyAccessContext(req);

  // set-company fabricates an all-company role only for account-level Developer
  // users. Admin/Owner/Manager sessions must always retain a real company-role
  // assignment; a stale or forged active company must fail closed.
  if (context.role === "Developer") {
    await assertCompanyAccess(context.userId, context.activeCompanyId);
    return context;
  }

  await assertCompanyAccess(context.userId, context.activeCompanyId);
  return context;
}

export function sendCompanyAccessError(res: Response, error: unknown, fallbackStatus = 500) {
  if (error instanceof CompanyAccessError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  return res.status(fallbackStatus).json({
    message: error instanceof Error ? error.message : "Request failed",
    code: "COMPANY_CONTEXT_FAILED",
  });
}
