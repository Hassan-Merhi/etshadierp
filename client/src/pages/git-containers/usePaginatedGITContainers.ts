import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { EnrichedContainerRow, EtaFilterValue, GitContainersResponse } from "./gitContainerTypes";

interface PaginatedContainerFilters {
  allCompanies: boolean;
  page: number;
  pageSize: number;
  companyFilter: string;
  containerFilters: string[];
  supplierFilters: string[];
  transporterFilters: string[];
  agentFilters: string[];
  truckFilters: string[];
  locationFilters: string[];
  docsFilter: string;
  delayedFilter: string;
  freightFilter: string;
  etaFilter: EtaFilterValue;
  notesFilter: string;
  sortOrder: string;
  search: string;
  enabled: boolean;
}

const appendList = (params: URLSearchParams, key: string, values: string[]) => {
  if (values.length > 0) params.set(key, values.join(","));
};

export function usePaginatedGITContainers(filters: PaginatedContainerFilters) {
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      profile: "compact",
    });
    if (filters.allCompanies) params.set("allCompanies", "true");
    if (filters.companyFilter !== "ALL") params.set("company", filters.companyFilter);
    appendList(params, "containers", filters.containerFilters);
    appendList(params, "suppliers", filters.supplierFilters);
    appendList(params, "transporters", filters.transporterFilters);
    appendList(params, "agents", filters.agentFilters);
    appendList(params, "trucks", filters.truckFilters);
    appendList(params, "locations", filters.locationFilters);
    if (filters.docsFilter !== "ALL") params.set("docs", filters.docsFilter);
    if (filters.delayedFilter !== "ALL") params.set("delayedState", filters.delayedFilter);
    if (filters.freightFilter !== "ALL") params.set("freight", filters.freightFilter);
    if (filters.notesFilter !== "ALL") params.set("notes", filters.notesFilter);
    if (filters.sortOrder !== "DEFAULT") params.set("sort", filters.sortOrder);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (filters.etaFilter !== "ALL") {
      appendList(params, "etaDates", filters.etaFilter.selectedDates);
      if (filters.etaFilter.includeNoEta) params.set("includeNoEta", "true");
    }
    return `/api/git/containers?${params.toString()}`;
  }, [
    filters.allCompanies,
    filters.page,
    filters.pageSize,
    filters.companyFilter,
    filters.containerFilters.join(","),
    filters.supplierFilters.join(","),
    filters.transporterFilters.join(","),
    filters.agentFilters.join(","),
    filters.truckFilters.join(","),
    filters.locationFilters.join(","),
    filters.docsFilter,
    filters.delayedFilter,
    filters.freightFilter,
    filters.etaFilter === "ALL" ? "ALL" : JSON.stringify(filters.etaFilter),
    filters.notesFilter,
    filters.sortOrder,
    debouncedSearch,
  ]);

  const query = useQuery<GitContainersResponse>({
    queryKey: ["/api/git/containers", queryUrl],
    queryFn: async ({ signal }) => {
      const response = await fetch(queryUrl, { credentials: "include", signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Failed to load containers" }));
        throw new Error(body.message || "Failed to load containers");
      }
      return response.json();
    },
    enabled: filters.enabled,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });

  const loadContainerDetail = async (id: number): Promise<EnrichedContainerRow> => {
    const response = await fetch(`/api/git/containers/${id}`, { credentials: "include" });
    if (!response.ok) throw new Error("Failed to load container details");
    return response.json();
  };

  return { ...query, queryUrl, loadContainerDetail };
}
