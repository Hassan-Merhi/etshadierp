import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "./useDebouncedValue";

export interface LightweightStockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  active: boolean;
  stockGroupId: number | null;
  categoryId: number | null;
  gradeId: number | null;
  aliases: string[];
}

interface StockItemPage<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface UseStockItemSearchOptions {
  companyId?: number;
  search?: string;
  selectedIds?: number[];
  locationId?: number | null;
  enabled?: boolean;
  pageSize?: number;
}

export function useStockItemSearch<T extends LightweightStockItem = LightweightStockItem>({
  companyId,
  search = "",
  selectedIds = [],
  locationId,
  enabled = true,
  pageSize = 50,
}: UseStockItemSearchOptions) {
  const debouncedSearch = useDebouncedValue(search, 250);
  const normalizedIds = Array.from(new Set(selectedIds.filter((id) => Number.isFinite(id) && id > 0))).slice(0, 100);

  const query = useQuery<StockItemPage<T>>({
    queryKey: [
      "/api/stock-items/light",
      "paged",
      companyId,
      debouncedSearch,
      normalizedIds.join(","),
      locationId ?? null,
      pageSize,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        page: "1",
        pageSize: String(Math.min(100, Math.max(1, pageSize))),
        paginated: "true",
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (normalizedIds.length > 0) params.set("ids", normalizedIds.join(","));
      if (locationId) params.set("locationId", String(locationId));
      const response = await fetch(`/api/stock-items/light?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error("Failed to search stock items");
      return response.json();
    },
    enabled: enabled && !!companyId,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    items: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    search: debouncedSearch,
  };
}
