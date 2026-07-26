const COMPANY_MANAGEMENT_ROLES = new Set(["Admin", "Developer"]);

export interface UserCompanyAuthorizationScope {
  isDeveloper: boolean;
  companyRoles: Map<number, string>;
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

export function manageableCompanyIds(scope: UserCompanyAuthorizationScope): number[] | null {
  if (scope.isDeveloper) return null;

  return [...scope.companyRoles.entries()]
    .filter(([, role]) => COMPANY_MANAGEMENT_ROLES.has(role))
    .map(([companyId]) => companyId)
    .sort((left, right) => left - right);
}
