import type { Request } from "express";

import { storage } from "../storage";

export type PrivilegedRole = "Admin" | "Owner" | "Developer";

export class CompanyAccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
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

function parsePositiveCompanyId(value: unknown, label = "companyId"): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CompanyAccessError(400, `${label} must be a positive integer`, "INVALID_COMPANY_ID");
  }
  return parsed;
}

export function getCompanyAccessContext(req: Request): CompanyAccessContext {
  const userId = req.session?.userId;
  if (!userId) {
    throw new CompanyAccessError(401, "Authentication required", "AUTH_REQUIRED");
  }

  const activeCompanyId = parsePositiveCompanyId(req.session?.currentCompanyId, "activeCompanyId");
  const role = String(req.user?.role ?? "");
  return { userId, activeCompanyId, role };
}

export function isPrivilegedRole(role: string | null | undefined): role is PrivilegedRole {
  return role === "Admin" || role === "Owner" || role === "Developer";
}

export async function getAccessibleCompanyIds(userId: string): Promise<Set<number>> {
  const roles = await storage.getUserCompaniesWithRoles(userId);
  return new Set(
    roles
      .map((entry: any) => Number(entry.companyId))
      .filter((companyId: number) => Number.isInteger(companyId) && companyId > 0),
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
 * Resolves a company-scoped request. A query/body override is accepted only for
 * privileged roles, and privileged users must still hold an explicit role in
 * the requested company. This prevents Admin/Developer endpoints from becoming
 * unrestricted cross-tenant reads.
 */
export async function resolveAuthorizedCompanyId(
  req: Request,
  requestedCompanyId?: unknown,
): Promise<number> {
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
  await assertCompanyAccess(context.userId, context.activeCompanyId);
  return context;
}

export function sendCompanyAccessError(res: any, error: unknown, fallbackStatus = 500) {
  if (error instanceof CompanyAccessError) {
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
  return res.status(fallbackStatus).json({ message: error instanceof Error ? error.message : "Request failed" });
}
