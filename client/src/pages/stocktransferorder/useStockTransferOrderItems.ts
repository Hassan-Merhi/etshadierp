import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStockItemSearch } from "@/hooks/useStockItemSearch";
import type { LocationSummaryResponse, StockItemData } from "./types";

interface UseStockTransferOrderItemsOptions {
  companyId?: number;
  editVoucherId: number | null;
  existingTransfer: any;
  selectedLocationIds: number[];
}

export function useStockTransferOrderItems({
  companyId,
  editVoucherId,
  existingTransfer,
  selectedLocationIds,
}: UseStockTransferOrderItemsOptions) {
  const editStockItemIds = useMemo(
    () =>
      Array.from(
        new Set(
          ((existingTransfer?.items ?? []) as any[])
            .map((item) => Number(item.stockItemId))
            .filter((id) => id > 0)
        )
      ),
    [existingTransfer]
  );
  const { items: editStockItems } = useStockItemSearch<Pick<StockItemData, "id" | "name" | "code" | "uom">>({
    companyId,
    selectedIds: editStockItemIds,
    enabled: !!editVoucherId && editStockItemIds.length > 0,
    pageSize: 100,
  });
  const summaryQuery = useQuery<LocationSummaryResponse>({
    queryKey: ["/api/location-summary", { locationIds: selectedLocationIds.join(",") }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedLocationIds.length > 0) params.set("locationIds", selectedLocationIds.join(","));
      const response = await fetch(`/api/location-summary?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch location summary");
      return response.json();
    },
    enabled: selectedLocationIds.length > 0,
  });
  const stockItems = useMemo<StockItemData[]>(() => {
    const byId = new Map<number, StockItemData>();
    for (const group of summaryQuery.data?.stockGroups ?? []) {
      for (const item of group.items) byId.set(item.id, item);
    }
    for (const item of editStockItems) {
      if (!byId.has(item.id)) byId.set(item.id, { ...item, locationData: {} });
    }
    return Array.from(byId.values());
  }, [summaryQuery.data, editStockItems]);

  return { summaryData: summaryQuery.data, isLoading: summaryQuery.isLoading, stockItems };
}
