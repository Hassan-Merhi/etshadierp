export type ScopedAdministrationAction =
  | "list-company-users"
  | "list-company-user-roles"
  | "mutate-global-user"
  | "mutate-company-role"
  | "cleanup-orphaned-charges"
  | "none";

export function classifyScopedAdministrationRequest(
  methodInput: string,
  path: string
): ScopedAdministrationAction {
  const method = methodInput.toUpperCase();

  if (method === "GET" && path === "/api/users") return "list-company-users";
  if (method === "GET" && /^\/api\/users\/[^/]+\/company-roles$/.test(path)) {
    return "list-company-user-roles";
  }
  if ((method === "PATCH" || method === "DELETE") && /^\/api\/users\/[^/]+$/.test(path)) {
    return "mutate-global-user";
  }
  if (method === "POST" && /^\/api\/admin\/reset-password\/[^/]+$/.test(path)) {
    return "mutate-global-user";
  }
  if (
    (method === "PATCH" || method === "DELETE") &&
    /^\/api\/user-company-roles\/[^/]+$/.test(path)
  ) {
    return "mutate-company-role";
  }
  if (method === "POST" && path === "/api/cleanup/orphaned-charges") {
    return "cleanup-orphaned-charges";
  }

  return "none";
}

export type SharedUserMutationDecision = "allow" | "not-found" | "shared-user-blocked";

export function decideSharedUserMutation(
  activeCompanyId: number,
  targetCompanyIds: readonly number[]
): SharedUserMutationDecision {
  const uniqueCompanyIds = [...new Set(targetCompanyIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueCompanyIds.includes(activeCompanyId)) return "not-found";
  if (uniqueCompanyIds.some((id) => id !== activeCompanyId)) return "shared-user-blocked";
  return "allow";
}
