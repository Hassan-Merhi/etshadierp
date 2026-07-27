export interface IntercompanyActorScope {
  isDeveloper: boolean;
  companyRoles: Map<number, string>;
}

export function canManageIntercompanyCompany(
  scope: IntercompanyActorScope,
  companyId: number
): boolean {
  return scope.isDeveloper || scope.companyRoles.get(companyId) === "Admin";
}

export function canManageIntercompanyPair(
  scope: IntercompanyActorScope,
  sourceCompanyId: number,
  destCompanyId: number
): boolean {
  if (
    !Number.isSafeInteger(sourceCompanyId) ||
    sourceCompanyId <= 0 ||
    !Number.isSafeInteger(destCompanyId) ||
    destCompanyId <= 0 ||
    sourceCompanyId === destCompanyId
  ) {
    return false;
  }

  return (
    canManageIntercompanyCompany(scope, sourceCompanyId) &&
    canManageIntercompanyCompany(scope, destCompanyId)
  );
}

export function ledgersMatchIntercompanyPair(
  sourceLedgerCompanyId: number | null | undefined,
  destLedgerCompanyId: number | null | undefined,
  sourceCompanyId: number,
  destCompanyId: number
): boolean {
  return (
    sourceLedgerCompanyId === sourceCompanyId &&
    destLedgerCompanyId === destCompanyId
  );
}
