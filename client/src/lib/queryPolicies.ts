export const QUERY_STALE_TIMES = {
  liveCount: 45_000,
  access: 5 * 60_000,
  settings: 15 * 60_000,
  referenceData: 30 * 60_000,
} as const;

export const QUERY_GC_TIMES = {
  liveCount: 10 * 60_000,
  access: 30 * 60_000,
  settings: 2 * 60 * 60_000,
  referenceData: 2 * 60 * 60_000,
} as const;

export const DEFAULT_QUERY_STALE_TIME = 5 * 60_000;

/**
 * Exact JSON endpoints whose values are stable reference data. Query strings do
 * not change the policy, while descendants such as /api/locations/1/inventory
 * deliberately do not inherit the long reference-data lifetime.
 */
export const STABLE_REFERENCE_API_ENDPOINTS = [
  "/api/ledger-accounts",
  "/api/ledger-accounts/parent-groups",
  "/api/locations",
  "/api/suppliers",
  "/api/customers",
  "/api/employees",
  "/api/bank-accounts",
  "/api/fixed-assets",
  "/api/stock-groups",
  "/api/stock-categories",
  "/api/stock-grades",
  "/api/stock-items/light",
  "/api/stock-items/all-code-aliases",
  "/api/worker-groups/with-members",
  "/api/employee-groups",
  "/api/user/companies",
  "/api/factory/bale-products",
  "/api/factory/workers",
  "/api/factory/employees",
  "/api/factory/cash-accounts",
  "/api/factory/customers",
  "/api/factory/suppliers",
  "/api/factory/worker-categories",
] as const;

export const STABLE_SETTINGS_API_ENDPOINTS = [
  "/api/company-settings",
  "/api/factory/settings",
  "/api/user/preferences",
] as const;

export const ACCESS_API_ENDPOINTS = ["/api/my-erp-pages", "/api/factory/my-access"] as const;

function apiPathname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pathname = value.split("?", 1)[0].replace(/\/+$/, "");
  return pathname || "/";
}

function matchesEndpoint(value: unknown, endpoints: readonly string[]): boolean {
  const pathname = apiPathname(value);
  return pathname !== null && endpoints.includes(pathname);
}

export function staleTimeForQueryKey(queryKey: readonly unknown[]): number {
  const requestUrl = queryKey[0];
  if (matchesEndpoint(requestUrl, STABLE_REFERENCE_API_ENDPOINTS)) {
    return QUERY_STALE_TIMES.referenceData;
  }
  if (matchesEndpoint(requestUrl, STABLE_SETTINGS_API_ENDPOINTS)) {
    return QUERY_STALE_TIMES.settings;
  }
  if (matchesEndpoint(requestUrl, ACCESS_API_ENDPOINTS)) {
    return QUERY_STALE_TIMES.access;
  }
  return DEFAULT_QUERY_STALE_TIME;
}

/** Poll only while this browser tab is visible. */
export function visibleTabInterval(intervalMs: number) {
  return () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return false;
    }
    return intervalMs;
  };
}

export const stableReferenceQueryPolicy = {
  staleTime: QUERY_STALE_TIMES.referenceData,
  gcTime: QUERY_GC_TIMES.referenceData,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const stableSettingsQueryPolicy = {
  staleTime: QUERY_STALE_TIMES.settings,
  gcTime: QUERY_GC_TIMES.settings,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export const accessQueryPolicy = {
  staleTime: QUERY_STALE_TIMES.access,
  gcTime: QUERY_GC_TIMES.access,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function liveCountQueryPolicy(intervalMs = 60_000) {
  return {
    staleTime: QUERY_STALE_TIMES.liveCount,
    gcTime: QUERY_GC_TIMES.liveCount,
    refetchInterval: visibleTabInterval(intervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  } as const;
}
