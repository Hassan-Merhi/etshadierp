export type AdminCompanyScopeDecision =
  | { kind: "none" }
  | { kind: "match"; companyId: number }
  | { kind: "invalid"; source: "query" | "body" | "path" }
  | { kind: "conflict"; companyIds: number[] }
  | { kind: "cross-company"; requestedCompanyId: number; activeCompanyId: number | null };

function parseCompanyId(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) || typeof value === "object") return "invalid";
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

export function decideAdminCompanyScope(input: {
  activeCompanyId?: unknown;
  queryCompanyId?: unknown;
  bodyCompanyId?: unknown;
  pathCompanyId?: unknown;
}): AdminCompanyScopeDecision {
  const sources = [
    ["query", parseCompanyId(input.queryCompanyId)],
    ["body", parseCompanyId(input.bodyCompanyId)],
    ["path", parseCompanyId(input.pathCompanyId)],
  ] as const;

  for (const [source, value] of sources) {
    if (value === "invalid") return { kind: "invalid", source };
  }

  const supplied = sources
    .map(([, value]) => value)
    .filter((value): value is number => typeof value === "number");
  if (supplied.length === 0) return { kind: "none" };

  const unique = [...new Set(supplied)];
  if (unique.length > 1) return { kind: "conflict", companyIds: unique };

  const active = parseCompanyId(input.activeCompanyId);
  const requestedCompanyId = unique[0];
  if (active === "invalid" || active === null || requestedCompanyId !== active) {
    return {
      kind: "cross-company",
      requestedCompanyId,
      activeCompanyId: typeof active === "number" ? active : null,
    };
  }

  return { kind: "match", companyId: requestedCompanyId };
}
