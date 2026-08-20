import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";

export interface LocationSummaryCell {
  quantity: number;
  rate: number;
  value: number;
}

export interface LocationSummaryItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  locationData: Record<number, LocationSummaryCell>;
}

export interface LocationSummaryGroup {
  id: number;
  code: string;
  name: string;
  locationData: Record<number, LocationSummaryCell>;
  items: LocationSummaryItem[];
}

export interface LocationSummaryPayload {
  stockGroups: LocationSummaryGroup[];
  grandTotals: Record<number, LocationSummaryCell>;
  asOfDate: string;
}

interface GroupItemsPayload {
  groupId: number;
  items: LocationSummaryItem[];
}

interface UseLocationSummaryBandwidthOptions {
  selectedLocationIds: number[];
  expandedGroups: Set<number>;
}

const LOCATION_SUMMARY_STALE_MS = 60_000;
const LOCATION_SUMMARY_GC_MS = 15 * 60_000;

function canonicalLocationIds(ids: readonly number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0))).sort((left, right) => left - right);
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    signal,
  });
  if (!response.ok) throw new Error(`Failed to load location summary (${response.status})`);
  return response.json() as Promise<T>;
}

/**
 * Bandwidth-optimized Location Summary reader.
 *
 * The first request contains only stock-group totals. Item rows are fetched one
 * stock group at a time when the user expands that group, so opening the page no
 * longer downloads every stock item across every selected location.
 *
 * Location IDs are canonicalized for network/cache identity while the page
 * keeps its own selection order for display. Date filters are deliberately not
 * part of this current-inventory endpoint: the legacy server route never used
 * startDate/endDate to calculate balances, and including them only created
 * duplicate multi-megabyte cache entries for identical data.
 */
export function useLocationSummaryBandwidth({
  selectedLocationIds,
  expandedGroups,
}: UseLocationSummaryBandwidthOptions) {
  const { selectedCompany } = useCompany();
  const locationIds = useMemo(() => canonicalLocationIds(selectedLocationIds), [selectedLocationIds]);
  const locationIdsKey = locationIds.join(",");
  const companyId = selectedCompany?.id ?? null;

  const summaryQuery = useQuery<LocationSummaryPayload>({
    queryKey: ["/api/location-summary", "summary", companyId, locationIdsKey],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        profile: "summary",
        locationIds: locationIdsKey,
      });
      return fetchJson<LocationSummaryPayload>(`/api/location-summary?${params.toString()}`, signal);
    },
    enabled: companyId !== null && locationIds.length > 0,
    staleTime: LOCATION_SUMMARY_STALE_MS,
    gcTime: LOCATION_SUMMARY_GC_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const expandedGroupIds = useMemo(() => {
    if (!summaryQuery.data?.stockGroups) return [] as number[];
    return summaryQuery.data.stockGroups
      .map((group) => group.id)
      .filter((groupId) => expandedGroups.has(groupId))
      .sort((left, right) => left - right);
  }, [summaryQuery.data?.stockGroups, expandedGroups]);

  const groupQueries = useQueries({
    queries: expandedGroupIds.map((groupId) => ({
      queryKey: ["/api/location-summary", "group", companyId, locationIdsKey, groupId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const params = new URLSearchParams({
          profile: "group",
          locationIds: locationIdsKey,
          groupId: String(groupId),
        });
        return fetchJson<GroupItemsPayload>(`/api/location-summary?${params.toString()}`, signal);
      },
      enabled: companyId !== null && locationIds.length > 0,
      staleTime: LOCATION_SUMMARY_STALE_MS,
      gcTime: LOCATION_SUMMARY_GC_MS,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  const data = useMemo<LocationSummaryPayload | undefined>(() => {
    if (!summaryQuery.data) return undefined;

    const itemsByGroup = new Map<number, LocationSummaryItem[]>();
    expandedGroupIds.forEach((groupId, index) => {
      const detail = groupQueries[index]?.data as GroupItemsPayload | undefined;
      if (detail?.groupId === groupId) itemsByGroup.set(groupId, detail.items);
    });

    return {
      ...summaryQuery.data,
      stockGroups: summaryQuery.data.stockGroups.map((group) => ({
        ...group,
        items: itemsByGroup.get(group.id) ?? [],
      })),
    };
  }, [summaryQuery.data, expandedGroupIds, groupQueries]);

  return {
    ...summaryQuery,
    data,
    isFetchingExpandedGroups: groupQueries.some((query) => query.isFetching),
  };
}
