import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { InventoryLocation as Location, StockGroupSummary } from "./locationInventoryTypes";

interface InventoryItem {
  inventoryId: number | null;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
  stockItemActive: boolean | null;
  categoryId?: number | null;
  categoryName?: string | null;
}

interface InventoryPage {
  data: InventoryItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totals?: { quantity: number; value: number | null };
}

interface InventorySummary {
  groups: StockGroupSummary[];
  totals: { items: number; quantity: number; value: number | null };
}

interface CombinedInventoryPage {
  data: any[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface UseLocationInventoryQueriesParams {
  waGroupDialogOpen: boolean;
  posUser?: any;
  companyId: number | undefined;
  selectedLocationLocal: Location | null;
  selectedGroup: StockGroupSummary | null;
  viewAllItems: boolean;
  showZeroStock: boolean;
  fromDate: string;
  asOfDate: string;
  showAllStock: boolean;
  showNegativeStock: boolean;
  itemSearchTerm: string;
  itemCategoryFilter: string[];
  inventoryPage: number;
  allStockPage: number;
  allStockSearchTerm: string;
  allStockGroupFilter: string;
  allStockLocationFilter: string;
  allStockCategoryFilter: string[];
}

const EMPTY_INVENTORY_PAGE: InventoryPage = {
  data: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
};

const EMPTY_COMBINED_PAGE: CombinedInventoryPage = {
  data: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
};

export function useLocationInventoryQueries({
  waGroupDialogOpen,
  posUser,
  companyId,
  selectedLocationLocal,
  selectedGroup,
  viewAllItems,
  showZeroStock,
  fromDate,
  asOfDate,
  showAllStock,
  showNegativeStock,
  itemSearchTerm,
  itemCategoryFilter,
  inventoryPage,
  allStockPage,
  allStockSearchTerm,
  allStockGroupFilter,
  allStockLocationFilter,
  allStockCategoryFilter,
}: UseLocationInventoryQueriesParams) {
  const debouncedItemSearch = useDebouncedValue(itemSearchTerm, 250);
  const debouncedAllStockSearch = useDebouncedValue(allStockSearchTerm, 250);
  const showMovement = Boolean(fromDate && asOfDate);

  const { data: waChats = [], isLoading: waChatsLoading } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    enabled: waGroupDialogOpen,
    staleTime: 60_000,
  });

  const { data: allLocations = [], isLoading: allLocationsLoading } = useQuery<Location[]>({
    queryKey: companyId ? ["/api/locations", companyId] : [],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/locations", { credentials: "include", signal });
      if (!res.ok) throw new Error(`Failed to fetch locations: ${res.status}`);
      return res.json();
    },
    enabled: !posUser && !!companyId,
  });

  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  const locations = posUser ? posAssignedLocations : allLocations;
  const locationsLoading = posUser ? posLocationsLoading : allLocationsLoading;

  const {
    data: inventorySummary = { groups: [], totals: { items: 0, quantity: 0, value: null } },
    isLoading: inventorySummaryLoading,
  } = useQuery<InventorySummary>({
    queryKey:
      selectedLocationLocal && companyId
        ? ["/api/locations", selectedLocationLocal.id, "inventory-summary", companyId, showZeroStock]
        : [],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ summary: "true" });
      if (showZeroStock) params.set("includeZero", "true");
      const res = await fetch(`/api/locations/${selectedLocationLocal!.id}/inventory?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!companyId && !showMovement,
    staleTime: 30_000,
  });

  const { data: inventoryPageData = EMPTY_INVENTORY_PAGE, isLoading: inventoryLoading } = useQuery<InventoryPage>({
    queryKey:
      selectedLocationLocal && companyId
        ? [
            "/api/locations",
            selectedLocationLocal.id,
            "inventory-page",
            companyId,
            inventoryPage,
            debouncedItemSearch,
            selectedGroup?.groupId ?? "all",
            itemCategoryFilter.join(","),
            showZeroStock,
            showNegativeStock,
          ]
        : [],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ page: String(inventoryPage), pageSize: "50" });
      if (showZeroStock) params.set("includeZero", "true");
      if (showNegativeStock) params.set("negativeOnly", "true");
      if (debouncedItemSearch.trim()) params.set("search", debouncedItemSearch.trim());
      if (selectedGroup) params.set("groupId", selectedGroup.groupId == null ? "none" : String(selectedGroup.groupId));
      if (itemCategoryFilter.length === 1) params.set("categoryId", itemCategoryFilter[0]);
      const res = await fetch(`/api/locations/${selectedLocationLocal!.id}/inventory?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!companyId && !showMovement && (viewAllItems || selectedGroup !== null),
    placeholderData: (previous) => previous,
  });

  const { data: openingInventoryData = [], isLoading: openingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && showMovement && companyId
        ? [`/api/locations/${selectedLocationLocal.id}/inventory?asOfDate=${fromDate}`, companyId]
        : [],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${fromDate}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && showMovement && !!companyId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: closingInventoryData = [], isLoading: closingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && showMovement && companyId
        ? [`/api/locations/${selectedLocationLocal.id}/inventory?asOfDate=${asOfDate}`, companyId]
        : [],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${asOfDate}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && showMovement && !!companyId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const selectedAllStockLocationId = allStockLocationFilter
    ? locations.find((location) => location.name === allStockLocationFilter)?.id
    : undefined;

  const { data: allInventoryPage = EMPTY_COMBINED_PAGE, isLoading: allInventoryLoading } =
    useQuery<CombinedInventoryPage>({
      queryKey: companyId
        ? [
            "/api/inventory",
            "combined-page",
            companyId,
            allStockPage,
            debouncedAllStockSearch,
            allStockGroupFilter,
            selectedAllStockLocationId ?? null,
            allStockCategoryFilter.join(","),
          ]
        : [],
      queryFn: async ({ signal }) => {
        const params = new URLSearchParams({
          profile: "combined",
          page: String(allStockPage),
          pageSize: "50",
        });
        if (debouncedAllStockSearch.trim()) params.set("search", debouncedAllStockSearch.trim());
        if (allStockGroupFilter) params.set("stockGroupId", allStockGroupFilter);
        if (selectedAllStockLocationId) params.set("locationId", String(selectedAllStockLocationId));
        if (allStockCategoryFilter.length > 0) params.set("categoryIds", allStockCategoryFilter.join(","));
        const res = await fetch(`/api/inventory?${params.toString()}`, { credentials: "include", signal });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      enabled: showAllStock && !!companyId,
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: false,
      placeholderData: (previous) => previous,
    });

  const { data: allNegativeStock = [], isLoading: negativeStockLoading } = useQuery<any[]>({
    queryKey: companyId ? ["/api/inventory/negative", companyId] : [],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/inventory/negative", { credentials: "include", signal });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !posUser && !!companyId && showNegativeStock && !selectedLocationLocal,
    staleTime: 30_000,
  });

  const { data: categoriesList = [] } = useQuery<{ id: number; name: string; active: boolean }[]>({
    queryKey: companyId ? ["/api/stock-categories", companyId] : [],
    enabled: !!companyId,
  });

  const { data: stockGroupsList = [] } = useQuery<{ id: number; name: string; code?: string }[]>({
    queryKey: companyId ? ["/api/stock-groups", companyId] : [],
    enabled: !!companyId,
  });

  return {
    waChats,
    waChatsLoading,
    locations,
    locationsLoading,
    inventorySummary,
    inventorySummaryLoading,
    inventoryData: inventoryPageData.data,
    inventoryLoading,
    inventoryPagination: {
      page: inventoryPageData.page,
      pageSize: inventoryPageData.pageSize,
      total: inventoryPageData.total,
      totalPages: inventoryPageData.totalPages,
    },
    openingInventoryData,
    openingInventoryLoading,
    closingInventoryData,
    closingInventoryLoading,
    allInventoryData: allInventoryPage.data,
    allInventoryLoading,
    allInventoryPagination: {
      page: allInventoryPage.page,
      pageSize: allInventoryPage.pageSize,
      total: allInventoryPage.total,
      totalPages: allInventoryPage.totalPages,
    },
    allNegativeStock,
    negativeStockLoading,
    categoriesList,
    stockGroupsList,
  };
}
