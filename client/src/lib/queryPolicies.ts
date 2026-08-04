import type { Query } from "@tanstack/react-query";

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

/**
 * Poll only while the tab is visible. TanStack Query also receives
 * refetchIntervalInBackground=false, but the explicit visibility check keeps
 * behaviour deterministic across browsers and test environments.
 */
export function visibleTabInterval(intervalMs: number) {
  return (_query: Query) => {
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
