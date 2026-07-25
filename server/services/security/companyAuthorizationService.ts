import { eq } from "drizzle-orm";
import { db } from "../../db";
import { userCompanyRoles } from "@shared/schema";

const COMPANY_MANAGEMENT_ROLES = new Set(["Admin", "Developer"]);

export class CompanyAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status = 403,
    public readonly code = "COMPANY_ACCESS_DENIED"
  ) {
    super(message);
    this.name = "CompanyAuthorizationError";
  }
}

export interface UserCompanyAuthorizationScope {
  isDeveloper: boolean;
  companyRoles: Map<number, string>;
}

export async function loadUserCompanyAuthorizationScope(
  userId: string
): Promise<UserCompanyAuthorizationScope> {
  const roles = await db
    .select({ companyId: userCompanyRoles.companyId, role: userCompanyRoles.role })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));

  return {
    isDeveloper: roles.some((row) => row.role === "Developer"),
    companyRoles: new Map(roles.map((row) => [row.companyId, row.role])),
  };
}

export function scopeAllowsCompanyMembership(
  scope: UserCompanyAuthorizationScope,
  companyId: number
): boolean {
  return scope.isDeveloper || scope.companyRoles.has(companyId);
}

export function scopeAllowsCompanyManagement(
  scope: UserCompanyAuthorizationScope,
  companyId: number
): boolean {
  if (scope.isDeveloper) return true;
  return COMPANY_MANAGEMENT_ROLES.has(scope.companyRoles.get(companyId) ?? "");
}

export async function assertUserCompanyMembership(userId: string, companyId: number): Promise<void> {
  const scope = await loadUserCompanyAuthorizationScope(userId);
  if (!scopeAllowsCompanyMembership(scope, companyId)) {
    throw new CompanyAuthorizationError(
      "You do not have access to the requested company.",
      403,
      "COMPANY_MEMBERSHIP_REQUIRED"
    );
  }
}

export async function assertUserCanManageCompany(userId: string, companyId: number): Promise<void> {
  const scope = await loadUserCompanyAuthorizationScope(userId);
  if (!scopeAllowsCompanyManagement(scope, companyId)) {
    throw new CompanyAuthorizationError(
      "You do not have permission to administer the requested company.",
      403,
      "COMPANY_ADMIN_REQUIRED"
    );
  }
}

export async function getManageableCompanyIds(userId: string): Promise<number[] | null> {
  const scope = await loadUserCompanyAuthorizationScope(userId);
  if (scope.isDeveloper) return null;

  return [...scope.companyRoles.entries()]
    .filter(([, role]) => COMPANY_MANAGEMENT_ROLES.has(role))
    .map(([companyId]) => companyId)
    .sort((left, right) => left - right);
}
