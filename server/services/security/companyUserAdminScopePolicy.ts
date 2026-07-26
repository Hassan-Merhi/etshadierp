export interface CompanyUserRoleRow {
  userId: string;
  companyId: number;
  role: string;
}

export function visibleUserIdsForCompany(
  rows: readonly CompanyUserRoleRow[],
  activeCompanyId: number
): Set<string> {
  const developerUserIds = new Set(
    rows.filter((row) => row.role === "Developer").map((row) => row.userId)
  );

  return new Set(
    rows
      .filter(
        (row) => row.companyId === activeCompanyId && !developerUserIds.has(row.userId)
      )
      .map((row) => row.userId)
  );
}

export function filterRolesForCompany<T extends { companyId: number }>(
  rows: readonly T[],
  activeCompanyId: number
): T[] {
  return rows.filter((row) => row.companyId === activeCompanyId);
}

export function canAccessTargetUser(
  rows: readonly CompanyUserRoleRow[],
  targetUserId: string,
  activeCompanyId: number,
  actorRole: string
): boolean {
  const targetRows = rows.filter((row) => row.userId === targetUserId);
  if (!targetRows.some((row) => row.companyId === activeCompanyId)) return false;

  const targetIsDeveloper = targetRows.some((row) => row.role === "Developer");
  return actorRole === "Developer" || !targetIsDeveloper;
}

export function canAssignRole(actorRole: string, requestedRole: unknown): boolean {
  return requestedRole !== "Developer" || actorRole === "Developer";
}
