import { useQuery } from "@tanstack/react-query";
import type { InventoryLocation as Location } from "./locationInventoryTypes";

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

interface UseLocationInventoryQueriesParams {
  waGroupDialogOpen: boolean;
  posUser?: any;
  companyId: number | undefined;
  selectedLocationLocal: Location | null;
  showZeroStock: boolean;
  fromDate: string;
  asOfDate: string;
  showAllStock: boolean;
  showNegativeStock: boolean;
}

export function useLocationInventoryQueries({
  waGroupDialogOpen,
  posUser,
  companyId,
  selectedLocationLocal,
  showZeroStock,
  fromDate,
  asOfDate,
  showAllStock,
  showNegativeStock,
}: UseLocationInventoryQueriesParams) {
  const { data: waChats = [], isLoading: waChatsLoading } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    enabled: waGroupDialogOpen,
    staleTime: 60_000,
  });

  const { data: allLocations = [], isLoading: allLocationsLoading } = useQuery<Location[]>({
    queryKey: companyId ? [`/api/locations?companyId=${companyId}`] : [],
    enabled: !posUser && !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  const locations = posUser ? posAssignedLocations : allLocations;
  const locationsLoading = posUser ? posLocationsLoading : allLocationsLoading;

  const { data: inventoryData = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && companyId
        ? [`/api/locations/${selectedLocationLocal.id}/inventory${showZeroStock ? "?includeZero=true" : ""}`, companyId]
        : [],
    queryFn: async () => {
      const url = `/api/locations/${selectedLocationLocal!.id}/inventory${showZeroStock ? "?includeZero=true" : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!companyId,
  });

  const { data: openingInventoryData = [], isLoading: openingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && fromDate && companyId
        ? [`/api/locations/${selectedLocationLocal.id}/inventory?asOfDate=${fromDate}`, companyId]
        : [],
    queryFn: async () => {
      const url = `/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${fromDate}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!fromDate && !!companyId,
  });

  const { data: closingInventoryData = [], isLoading: closingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && asOfDate && companyId
        ? [`/api/locations/${selectedLocationLocal.id}/inventory?asOfDate=${asOfDate}`, companyId]
        : [],
    queryFn: async () => {
      const url = `/api/locations/${selectedLocationLocal!.id}/inventory?asOfDate=${asOfDate}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!asOfDate && !!companyId,
  });

  const { data: allInventoryRaw, isLoading: allInventoryLoading } = useQuery<any>({
    queryKey: companyId ? ["/api/inventory", companyId] : [],
    queryFn: async () => {
      const res = await fetch("/api/inventory?page=1&pageSize=100", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: showAllStock && !!companyId,
    // Extended stale time: the full inventory list is expensive; avoid re-downloading
    // it on every mutation or focus event. Users can navigate away and back to refresh.
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });
  // Backend returns paginated { data, page, pageSize, total, totalPages }; extract array.
  const allInventoryData: any[] = Array.isArray(allInventoryRaw)
    ? allInventoryRaw
    : (allInventoryRaw?.data ?? []);

  const { data: allNegativeStock = [], isLoading: negativeStockLoading } = useQuery<any[]>({
    queryKey: companyId ? ["/api/inventory/negative", companyId] : [],
    queryFn: async () => {
      const res = await fetch("/api/inventory/negative", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !posUser && !!companyId && showNegativeStock && !selectedLocationLocal,
    staleTime: 30000,
  });

  const { data: categoriesList = [] } = useQuery<{ id: number; name: string; active: boolean }[]>({
    queryKey: companyId ? ["/api/stock-categories", companyId] : [],
    queryFn: async () => {
      const res = await fetch("/api/stock-categories", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    waChats,
    waChatsLoading,
    locations,
    locationsLoading,
    inventoryData,
    inventoryLoading,
    openingInventoryData,
    openingInventoryLoading,
    closingInventoryData,
    closingInventoryLoading,
    allInventoryData,
    allInventoryLoading,
    allNegativeStock,
    negativeStockLoading,
    categoriesList,
  };
}
