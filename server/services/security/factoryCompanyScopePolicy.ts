export interface FactoryCompanyCandidate {
  id: number;
  companyType: string;
  active: boolean;
}

function isFactoryType(companyType: string): boolean {
  return companyType === "factory" || companyType === "factory_v2";
}

export function chooseAuthorizedFactoryCompany(input: {
  pinnedFactoryId?: number | null;
  currentCompany?: FactoryCompanyCandidate | null;
  assignedFactoryIds: readonly number[];
}): number | null {
  const assigned = new Set(
    input.assignedFactoryIds.filter((id) => Number.isSafeInteger(id) && id > 0)
  );

  if (
    input.pinnedFactoryId &&
    Number.isSafeInteger(input.pinnedFactoryId) &&
    assigned.has(input.pinnedFactoryId)
  ) {
    return input.pinnedFactoryId;
  }

  const current = input.currentCompany;
  if (
    current &&
    current.active &&
    isFactoryType(current.companyType) &&
    assigned.has(current.id)
  ) {
    return current.id;
  }

  return input.assignedFactoryIds.find((id) => Number.isSafeInteger(id) && id > 0) ?? null;
}
