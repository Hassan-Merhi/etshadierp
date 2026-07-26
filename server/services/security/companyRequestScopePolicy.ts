export type ExplicitCompanyScopeDecision =
  | { kind: "none" }
  | { kind: "company"; companyId: number }
  | { kind: "invalid"; source: "query" | "body" }
  | { kind: "conflict"; queryCompanyId: number; bodyCompanyId: number };

function parseCompanyId(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) || typeof value === "object") return "invalid";

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return "invalid";
  return parsed;
}

/**
 * Parses caller-supplied company filters without authorizing them. Authorization
 * remains the responsibility of companyIsolationPolicy, which requires the
 * requested company to match the server-owned active session company exactly.
 */
export function decideExplicitCompanyScope(input: {
  queryCompanyId?: unknown;
  bodyCompanyId?: unknown;
}): ExplicitCompanyScopeDecision {
  const queryCompanyId = parseCompanyId(input.queryCompanyId);
  if (queryCompanyId === "invalid") return { kind: "invalid", source: "query" };

  const bodyCompanyId = parseCompanyId(input.bodyCompanyId);
  if (bodyCompanyId === "invalid") return { kind: "invalid", source: "body" };

  if (queryCompanyId !== null && bodyCompanyId !== null && queryCompanyId !== bodyCompanyId) {
    return { kind: "conflict", queryCompanyId, bodyCompanyId };
  }

  const companyId = queryCompanyId ?? bodyCompanyId;
  return companyId === null ? { kind: "none" } : { kind: "company", companyId };
}
