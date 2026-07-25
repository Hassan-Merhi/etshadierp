export type ExplicitCompanyScopeDecision =
  | { kind: "none" }
  | { kind: "authorized-session"; companyId: number }
  | { kind: "requires-membership"; companyId: number }
  | { kind: "invalid"; source: "query" | "body" }
  | { kind: "conflict"; queryCompanyId: number; bodyCompanyId: number };

function parseCompanyId(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) || typeof value === "object") return "invalid";

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return "invalid";
  return parsed;
}

export function decideExplicitCompanyScope(input: {
  queryCompanyId?: unknown;
  bodyCompanyId?: unknown;
  currentCompanyId?: unknown;
  factoryCompanyId?: unknown;
}): ExplicitCompanyScopeDecision {
  const queryCompanyId = parseCompanyId(input.queryCompanyId);
  if (queryCompanyId === "invalid") return { kind: "invalid", source: "query" };

  const bodyCompanyId = parseCompanyId(input.bodyCompanyId);
  if (bodyCompanyId === "invalid") return { kind: "invalid", source: "body" };

  if (queryCompanyId !== null && bodyCompanyId !== null && queryCompanyId !== bodyCompanyId) {
    return { kind: "conflict", queryCompanyId, bodyCompanyId };
  }

  const companyId = queryCompanyId ?? bodyCompanyId;
  if (companyId === null) return { kind: "none" };

  const sessionCompanyIds = [input.currentCompanyId, input.factoryCompanyId]
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);

  if (sessionCompanyIds.includes(companyId)) {
    return { kind: "authorized-session", companyId };
  }

  return { kind: "requires-membership", companyId };
}
