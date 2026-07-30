export interface CompanyContextDecision {
  allowed: boolean;
  companyId: number | null;
  code: "COMPANY_CONTEXT_OK" | "COMPANY_CONTEXT_REQUIRED" | "COMPANY_CONTEXT_MISMATCH";
}

export function parsePositiveCompanyId(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function collectCompanyAssertions(
  containers: unknown[],
  fields: string[],
): number[] {
  const values: number[] = [];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    for (const field of fields) {
      const raw = (container as Record<string, unknown>)[field];
      if (raw === undefined || raw === null || raw === "") continue;
      const parsed = parsePositiveCompanyId(raw);
      if (parsed === null) return [-1];
      values.push(parsed);
    }
  }
  return values;
}

export function decideExplicitCompanyContext(
  session: any,
  requestAssertions: number[] = [],
  includeLegacyFactorySessionAssertion = true,
): CompanyContextDecision {
  const companyId = parsePositiveCompanyId(session?.currentCompanyId);
  if (!companyId) return { allowed: false, companyId: null, code: "COMPANY_CONTEXT_REQUIRED" };

  const assertions = [...requestAssertions];
  if (
    includeLegacyFactorySessionAssertion &&
    session?.factoryCompanyId !== undefined &&
    session?.factoryCompanyId !== null
  ) {
    const legacy = parsePositiveCompanyId(session.factoryCompanyId);
    if (legacy === null) return { allowed: false, companyId, code: "COMPANY_CONTEXT_MISMATCH" };
    assertions.push(legacy);
  }

  if (assertions.some((assertion) => assertion !== companyId)) {
    return { allowed: false, companyId, code: "COMPANY_CONTEXT_MISMATCH" };
  }
  return { allowed: true, companyId, code: "COMPANY_CONTEXT_OK" };
}
