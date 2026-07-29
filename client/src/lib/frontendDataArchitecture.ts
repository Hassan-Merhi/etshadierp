import type { QueryClient, QueryKey } from "@tanstack/react-query";

export type QueryParamValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryParamValue | readonly QueryParamValue[]>;

/** Build a stable URL so equivalent filters share one React Query cache entry. */
export function canonicalApiUrl(pathname: string, params?: QueryParams): string {
  if (!params) return pathname;
  const search = new URLSearchParams();

  for (const key of Object.keys(params).sort()) {
    const raw = params[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null || value === "") continue;
      search.append(key, String(value));
    }
  }

  const suffix = search.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

/** Keep the actual request URL first; company identity prevents cross-company reuse. */
export function companyDataKey(
  requestUrl: string,
  companyId: number | string | null | undefined,
  ...identity: readonly unknown[]
): readonly unknown[] {
  return [requestUrl, companyId ?? "no-company", ...identity] as const;
}

export function queryRequestUrl(queryKey: QueryKey): string | null {
  return typeof queryKey[0] === "string" ? queryKey[0] : null;
}

export function queryPathname(queryKey: QueryKey): string | null {
  const requestUrl = queryRequestUrl(queryKey);
  if (!requestUrl) return null;
  return requestUrl.split("?", 1)[0];
}

/** Exact family matching: /api/accounts matches itself and descendants, not /api/accounts-old. */
export function queryMatchesApiFamily(queryKey: QueryKey, family: string): boolean {
  const pathname = queryPathname(queryKey);
  if (!pathname) return false;
  const normalized = family.endsWith("/") ? family.slice(0, -1) : family;
  return pathname === normalized || pathname.startsWith(`${normalized}/`);
}

export function invalidateApiFamily(
  client: QueryClient,
  family: string,
  options: { refetchType?: "active" | "inactive" | "all" | "none" } = {},
): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => queryMatchesApiFamily(query.queryKey, family),
    refetchType: options.refetchType ?? "active",
  });
}

export function removeApiFamily(client: QueryClient, family: string): void {
  client.removeQueries({
    predicate: (query) => queryMatchesApiFamily(query.queryKey, family),
  });
}

export interface PaginatedPayload<T> {
  data?: T[];
  items?: T[];
  rows?: T[];
  results?: T[];
  total?: number;
  page?: number;
  limit?: number;
}

/** Normalize legacy array and paginated endpoint shapes without changing APIs. */
export function unwrapList<T>(payload: T[] | PaginatedPayload<T> | null | undefined): T[] {
  if (Array.isArray(payload)) return payload;
  if (!payload) return [];
  for (const candidate of [payload.data, payload.items, payload.rows, payload.results]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export const frontendQueryPolicies = {
  reference: {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  },
  operational: {
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  },
  live: {
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  },
} as const;
