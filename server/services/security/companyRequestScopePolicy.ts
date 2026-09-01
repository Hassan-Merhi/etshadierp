export type ExplicitCompanyScopeDecision =
  | { kind: "none" }
  | { kind: "company"; companyId: number }
  | { kind: "invalid"; source: "query" | "body" | "path" }
  | { kind: "conflict"; companyIds: number[] };

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
  pathCompanyId?: unknown;
}): ExplicitCompanyScopeDecision {
  const values: Array<{ source: "query" | "body" | "path"; value: unknown }> = [
    { source: "query", value: input.queryCompanyId },
    { source: "body", value: input.bodyCompanyId },
    { source: "path", value: input.pathCompanyId },
  ];

  const companyIds: number[] = [];
  for (const candidate of values) {
    const parsed = parseCompanyId(candidate.value);
    if (parsed === "invalid") return { kind: "invalid", source: candidate.source };
    if (parsed !== null) companyIds.push(parsed);
  }

  if (companyIds.length === 0) return { kind: "none" };

  const uniqueCompanyIds = [...new Set(companyIds)].sort((left, right) => left - right);
  if (uniqueCompanyIds.length > 1) {
    return { kind: "conflict", companyIds: uniqueCompanyIds };
  }

  return { kind: "company", companyId: uniqueCompanyIds[0] };
}
