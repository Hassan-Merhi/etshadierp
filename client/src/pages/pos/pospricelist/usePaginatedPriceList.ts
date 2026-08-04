import { useQuery } from "@tanstack/react-query";
import type { PaginatedPriceListResponse, PriceListItem } from "./types";

interface PosPriceListFilters {
  selectedLocationId: number | null;
  page: number;
  search: string;
  groupFilter: string;
  showUnpriced: boolean;
  posUser?: unknown;
  isAllMode: boolean;
}

type PriceListRequest = Omit<PosPriceListFilters, "isAllMode">;

function buildPriceListParams({ selectedLocationId, page, search, groupFilter, showUnpriced, posUser }: PriceListRequest) {
  const params = new URLSearchParams({
    locationId: String(selectedLocationId),
    page: String(page),
    pageSize: String(posUser ? 30 : 50),
  });
  if (search.trim()) params.set("search", search.trim());
  if (groupFilter !== "all") params.set("group", groupFilter);
  if (showUnpriced) params.set("unpriced", "true");
  if (posUser) params.set("availableOnly", "true");
  return params;
}

async function fetchPriceListPage(filters: PriceListRequest, signal?: AbortSignal): Promise<PaginatedPriceListResponse> {
  const response = await fetch(`/api/pos/price-list?${buildPriceListParams(filters).toString()}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(body.message || "Failed to load price list");
  }
  return response.json();
}

export function usePaginatedPriceList(filters: PosPriceListFilters) {
  const request: PriceListRequest = {
    selectedLocationId: filters.selectedLocationId,
    page: filters.page,
    search: filters.search,
    groupFilter: filters.groupFilter,
    showUnpriced: filters.showUnpriced,
    posUser: filters.posUser,
  };
  const query = useQuery<PaginatedPriceListResponse>({
    queryKey: [
      "/api/pos/price-list",
      "paged",
      filters.selectedLocationId,
      filters.page,
      filters.posUser ? 30 : 50,
      filters.search,
      filters.groupFilter,
      filters.showUnpriced,
      !!filters.posUser,
    ],
    queryFn: ({ signal }) => fetchPriceListPage(request, signal),
    enabled: !!filters.selectedLocationId && !filters.isAllMode,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
  return { ...query, response: query.data, items: query.data?.data ?? [] };
}

interface ExportPriceListOptions extends Omit<PriceListRequest, "page"> {
  hiddenUnpricedGroups: Set<string>;
}

export async function fetchFilteredPriceListForExport({
  hiddenUnpricedGroups,
  ...filters
}: ExportPriceListOptions): Promise<PriceListItem[]> {
  const firstPage = await fetchPriceListPage({ ...filters, page: 1 });
  const pages = [firstPage];
  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    pages.push(await fetchPriceListPage({ ...filters, page }));
  }
  return pages
    .flatMap((result) => result.data)
    .filter((item) => !filters.showUnpriced || !hiddenUnpricedGroups.has(item.stockGroupName || "(No Group)"));
}
