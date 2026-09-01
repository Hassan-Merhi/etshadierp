import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  canonicalApiUrl,
  canonicalSetValues,
  frontendQueryPolicies,
  paginatedCompanyDataKey,
  type CompanyIdentity,
  type QueryParams,
} from "@/lib/frontendDataArchitecture";
import type { EnrichedContainerRow, EtaFilterValue, GitContainersResponse } from "./gitContainerTypes";

interface PaginatedContainerFilters {
  companyIdentity: CompanyIdentity;
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

const compactSet = (values: readonly string[]): string | undefined => {
  const normalized = canonicalSetValues(values);
  return normalized.length > 0 ? normalized.join(",") : undefined;
};

export function usePaginatedGITContainers(filters: PaginatedContainerFilters) {
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const queryUrl = useMemo(() => {
    const etaDates = filters.etaFilter === "ALL" ? undefined : compactSet(filters.etaFilter.selectedDates);
    const params: QueryParams = {
      page: filters.page,
      pageSize: filters.pageSize,
      profile: "compact",
      allCompanies: filters.allCompanies ? true : undefined,
      company: filters.companyFilter !== "ALL" ? filters.companyFilter : undefined,
      containers: compactSet(filters.containerFilters),
      suppliers: compactSet(filters.supplierFilters),
      transporters: compactSet(filters.transporterFilters),
      agents: compactSet(filters.agentFilters),
      trucks: compactSet(filters.truckFilters),
      locations: compactSet(filters.locationFilters),
      docs: filters.docsFilter !== "ALL" ? filters.docsFilter : undefined,
      delayedState: filters.delayedFilter !== "ALL" ? filters.delayedFilter : undefined,
      freight: filters.freightFilter !== "ALL" ? filters.freightFilter : undefined,
      notes: filters.notesFilter !== "ALL" ? filters.notesFilter : undefined,
      sort: filters.sortOrder !== "DEFAULT" ? filters.sortOrder : undefined,
      search: debouncedSearch.trim() || undefined,
      etaDates,
      includeNoEta:
        filters.etaFilter !== "ALL" && filters.etaFilter.includeNoEta ? true : undefined,
    };
    return canonicalApiUrl("/api/git/containers", params);
  }, [filters.etaFilter, filters.page, filters.pageSize, filters.allCompanies, filters.companyFilter, filters.containerFilters, filters.supplierFilters, filters.transporterFilters, filters.agentFilters, filters.truckFilters, filters.locationFilters, filters.docsFilter, filters.delayedFilter, filters.freightFilter, filters.notesFilter, filters.sortOrder, debouncedSearch]);

  const query = useQuery<GitContainersResponse>({
    queryKey: paginatedCompanyDataKey(
      queryUrl,
      filters.companyIdentity,
      filters.page,
      filters.pageSize,
      "git-containers",
      filters.allCompanies ? "all-accessible" : "active-company",
    ),
    queryFn: async ({ signal }) => {
      const response = await fetch(queryUrl, { credentials: "include", signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Failed to load containers" }));
        throw new Error(body.message || "Failed to load containers");
      }
      return response.json();
    },
    enabled: filters.enabled,
    ...frontendQueryPolicies.operational,
    staleTime: 45_000,
    placeholderData: (previous) => previous,
  });

  const loadContainerDetail = async (id: number, companyId: number): Promise<EnrichedContainerRow> => {
    const detailUrl = canonicalApiUrl(`/api/git/containers/${id}`, { companyId });
    const response = await fetch(detailUrl, { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "Failed to load container details" }));
      throw new Error(body.message || "Failed to load container details");
    }
    return response.json();
  };

  return { ...query, queryUrl, loadContainerDetail };
}
