export interface CompanyRoleIdentity {
  companyId: number;
  role: string;
}

export function chooseActiveCompanyRole(
  companyId: number,
  rows: ReadonlyArray<CompanyRoleIdentity>
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
