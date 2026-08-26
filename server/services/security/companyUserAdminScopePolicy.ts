export interface CompanyUserRoleRow {
  userId: string;
  companyId: number;
  role: string;
}

export function visibleUserIdsForCompany(rows: readonly CompanyUserRoleRow[], activeCompanyId: number): Set<string> {
  const developerUserIds = new Set(rows.filter((row) => row.role === "Developer").map((row) => row.userId));

  return new Set(
    rows
      .filter((row) => row.companyId === activeCompanyId && !developerUserIds.has(row.userId))
      .map((row) => row.userId)
  );
}

export function filterRolesForCompany<T extends { companyId: number }>(
  rows: readonly T[],
  activeCompanyId: number
): T[] {
  return rows.filter((row) => row.companyId === activeCompanyId);
}

export function isDeveloperTarget(rows: readonly CompanyUserRoleRow[], targetUserId: string): boolean {
  return rows.some((row) => row.userId === targetUserId && row.role === "Developer");
}

export function canAccessTargetUser(
  rows: readonly CompanyUserRoleRow[],
  targetUserId: string,
  activeCompanyId: number,
  actorRole: string
): boolean {
  const targetRows = rows.filter((row) => row.userId === targetUserId);
  if (!targetRows.some((row) => row.companyId === activeCompanyId)) return false;

  return actorRole === "Developer" || !isDeveloperTarget(targetRows, targetUserId);
}

export function canMutateGlobalUserAccount(
  rows: readonly CompanyUserRoleRow[],
  targetUserId: string,
  activeCompanyId: number,
  actorRole: string
): boolean {
  if (actorRole === "Developer") return true;

  const targetRows = rows.filter((row) => row.userId === targetUserId);
  if (targetRows.length === 0) return false;
  if (isDeveloperTarget(targetRows, targetUserId)) return false;

  return targetRows.every((row) => row.companyId === activeCompanyId);
}

export function canAssignExistingTargetUser(
  rows: readonly CompanyUserRoleRow[],
  targetUserId: string,
  actorRole: string
): boolean {
  return actorRole === "Developer" || !isDeveloperTarget(rows, targetUserId);
}

export function canAssignRole(actorRole: string, requestedRole: unknown): boolean {
  return requestedRole !== "Developer" || actorRole === "Developer";
}

export function canAssignCompany(actorRole: string, requestedCompanyId: unknown, activeCompanyId: number): boolean {
  if (actorRole === "Developer") return true;
  const parsedCompanyId = Number(requestedCompanyId);
  return Number.isInteger(parsedCompanyId) && parsedCompanyId > 0 && parsedCompanyId === activeCompanyId;
}
