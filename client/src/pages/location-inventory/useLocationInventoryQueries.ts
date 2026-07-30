import { useQuery } from "@tanstack/react-query";
import type { InventoryLocation as Location } from "./locationInventoryTypes";

interface InventoryItem {
  inventoryId: number | null;
  locationId: number;
  stockItemId: number;
  quantity: string;
  averageRate: string | null;
  totalValue: string | null;
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
    // Keep companyId as a second array element for cache scoping (different companies
    // get separate cache entries), but do NOT embed it in the URL.
    // The server reads the company from the session (req.session.currentCompanyId).
    // Putting ?companyId=X in the URL triggers requireAuth's cross-company guard,
    // which compares it against resolveActiveCompanyId(req) — that returns
    // factoryCompanyId first, causing 403s for admin users who have been in factory mode.
    queryKey: companyId ? ["/api/locations", companyId] : [],
    queryFn: async () => {
      const res = await fetch("/api/locations", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch locations: ${res.status}`);
      return res.json();
    },
    enabled: !posUser && !!companyId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  const locations = posUser ? posAssignedLocations : allLocations;
  const locationsLoading = posUser ? posLocationsLoading : allLocationsLoading;

  const inventoryBaseKey = selectedLocationLocal ? `/api/locations/${selectedLocationLocal.id}/inventory` : "";
  const compactInventoryUrl = selectedLocationLocal
    ? `${inventoryBaseKey}?profile=compact${showZeroStock ? "&includeZero=true" : ""}`
    : "";
  const { data: inventoryData = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    // Keep the canonical URL as the first key element so existing stock-write
    // invalidations continue to match every compact and historical profile.
    queryKey:
      selectedLocationLocal && companyId
        ? [inventoryBaseKey, companyId, "compact", showZeroStock ? "include-zero" : "non-zero"]
        : [],
    queryFn: async () => {
      const res = await fetch(compactInventoryUrl, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!companyId,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const { data: openingInventoryData = [], isLoading: openingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && fromDate && companyId
        ? [inventoryBaseKey, companyId, "compact", "as-of", fromDate]
        : [],
    queryFn: async () => {
      const url = `${inventoryBaseKey}?profile=compact&asOfDate=${fromDate}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!fromDate && !!companyId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: closingInventoryData = [], isLoading: closingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey:
      selectedLocationLocal && asOfDate && companyId
        ? [inventoryBaseKey, companyId, "compact", "as-of", asOfDate]
        : [],
    queryFn: async () => {
      const url = `${inventoryBaseKey}?profile=compact&asOfDate=${asOfDate}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedLocationLocal && !!asOfDate && !!companyId,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: allInventoryRaw, isLoading: allInventoryLoading } = useQuery<any[]>({
    // Canonical /api/inventory prefix preserves all existing write invalidations.
    queryKey: companyId ? ["/api/inventory", companyId, "matrix"] : [],
    queryFn: async () => {
      const res = await fetch("/api/inventory?profile=matrix", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      return Array.isArray(payload) ? payload : [];
    },
    enabled: showAllStock && !!companyId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: false,
  });
  const allInventoryData: any[] = Array.isArray(allInventoryRaw) ? allInventoryRaw : [];

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
