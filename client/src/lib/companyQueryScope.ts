import type { QueryClient, QueryKey } from "@tanstack/react-query";

const GLOBAL_QUERY_URLS = new Set([
  "/api/auth/me",
  "/api/user/companies",
  "/api/build-info",
  "/api/csrf-token",
  "/api/health",
  "/api/health/ready",
]);

/**
 * Builds a company-scoped cache key while keeping the real request URL first so
 * the shared query function continues to fetch the correct endpoint.
 */
export function companyQueryKey(
  url: string,
  companyId: number | string | null | undefined,
  ...parts: readonly unknown[]
): readonly unknown[] {
  return [url, companyId ?? "no-company", ...parts] as const;
}

export function isGlobalQueryKey(queryKey: QueryKey): boolean {
  const first = queryKey[0];
  return typeof first === "string" && GLOBAL_QUERY_URLS.has(first);
}

/**
 * Every cache entry except the small explicit global allow-list is treated as
 * company-session data. This also covers custom keys such as account-statement
 * that do not begin with /api/ but still contain company-owned records.
 */
export function isCompanySessionQueryKey(queryKey: QueryKey): boolean {
  return !isGlobalQueryKey(queryKey);
}

export async function cancelCompanySessionQueries(client: QueryClient): Promise<void> {
  await client.cancelQueries({
    predicate: (query) => isCompanySessionQueryKey(query.queryKey),
  });
}

export function removeCompanySessionQueries(client: QueryClient): void {
  client.removeQueries({
    predicate: (query) => isCompanySessionQueryKey(query.queryKey),
  });
}
