import { useDeferredValue, useMemo } from "react";

interface UseCombinedStockRowsParams {
  allInventoryData: any[];
  allStockGroupFilter: string;
  allStockCategoryFilter: string[];
  allStockLocationFilter: string;
  allStockSearchTerm: string;
}

export function useCombinedStockRows({
  allInventoryData,
  allStockGroupFilter,
  allStockCategoryFilter,
  allStockLocationFilter,
  allStockSearchTerm,
}: UseCombinedStockRowsParams) {
  const deferredSearchTerm = useDeferredValue(allStockSearchTerm);
  const matrixProfile = useMemo(
    () =>
      allInventoryData.some(
        (item: any) => item && typeof item.qtyByLocationName === "object" && Array.isArray(item.locations),
      ),
    [allInventoryData],
  );

  const allInventoryLocations = useMemo(() => {
    const locs = new Map<number | string, { id: number | string; name: string }>();
    allInventoryData.forEach((item: any) => {
      if (Array.isArray(item.locations)) {
        item.locations.forEach((location: any) => {
          const name = String(location?.name || "");
          if (!name) return;
          const key = location?.id ?? name;
          if (!locs.has(key)) locs.set(key, { id: key, name });
        });
        return;
      }
      if (item.locationId && !locs.has(item.locationId)) {
        locs.set(item.locationId, { id: item.locationId, name: item.locationName || "" });
      }
    });
    return [...locs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  const allInventoryGroups = useMemo(() => {
    const groups = new Map<string, { id: number | null; name: string }>();
    allInventoryData.forEach((item: any) => {
      const key = String(item.stockGroupId ?? "null");
      if (!groups.has(key)) {
        groups.set(key, { id: item.stockGroupId ?? null, name: item.stockGroupName || "Unassigned" });
      }
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  const combinedStockRows = useMemo(() => {
    if (matrixProfile) {
      return allInventoryData.map((item: any) => ({
        stockItemId: item.stockItemId,
        stockItemName: item.stockItemName || "",
        stockItemCode: item.stockItemCode || "",
        stockGroupId: item.stockGroupId ?? null,
        stockGroupName: item.stockGroupName || "Unassigned",
        categoryId: item.categoryId ?? null,
        categoryName: item.categoryName ?? null,
        qtyByLocationName: item.qtyByLocationName || {},
        totalQty: Number(item.totalQty || 0),
        avgCost: Number(item.avgCost || 0),
        totalValue: Number(item.totalValue || 0),
        searchText: `${item.stockItemName || ""} ${item.stockItemCode || ""}`.toLowerCase(),
      }));
    }

    const itemMap = new Map<number, any>();
    allInventoryData.forEach((item: any) => {
      const qty = parseFloat(item.quantity || "0");
      if (qty === 0) return;
      if (!itemMap.has(item.stockItemId)) {
        itemMap.set(item.stockItemId, {
          stockItemId: item.stockItemId,
          stockItemName: item.stockItemName || "",
          stockItemCode: item.stockItemCode || "",
          stockGroupId: item.stockGroupId ?? null,
          stockGroupName: item.stockGroupName || "Unassigned",
          categoryId: item.categoryId ?? null,
          categoryName: item.categoryName ?? null,
          qtyByLocationName: {} as Record<string, number>,
          totalQty: 0,
          weightedCostSum: 0,
          totalValue: 0,
        });
      }
      const row = itemMap.get(item.stockItemId)!;
      const locName = item.locationName || "";
      row.qtyByLocationName[locName] = (row.qtyByLocationName[locName] || 0) + qty;
      row.totalQty += qty;
      const avgRate = parseFloat(item.averageRate || "0");
      row.weightedCostSum += qty * avgRate;
      row.totalValue += parseFloat(item.totalValue || "0");
    });
    return [...itemMap.values()].map((row) => ({
      ...row,
      avgCost: row.totalQty > 0 ? row.weightedCostSum / row.totalQty : 0,
      searchText: `${row.stockItemName} ${row.stockItemCode}`.toLowerCase(),
    }));
  }, [allInventoryData, matrixProfile]);

  const filteredCombinedRows = useMemo(() => {
    const search = deferredSearchTerm.trim().toLowerCase();
    return combinedStockRows
      .filter((row) => {
        if (allStockGroupFilter) {
          if (allStockGroupFilter === "null") {
            if (row.stockGroupId !== null) return false;
          } else if (String(row.stockGroupId) !== allStockGroupFilter) {
            return false;
          }
        }
        if (allStockCategoryFilter.length > 0) {
          const rowCatId = row.categoryId == null ? "none" : String(row.categoryId);
          if (!allStockCategoryFilter.includes(rowCatId)) return false;
        }
        if (allStockLocationFilter && !((row.qtyByLocationName[allStockLocationFilter] || 0) > 0)) {
          return false;
        }
        if (search && !row.searchText.includes(search)) return false;
        return true;
      })
      .sort(
        (a, b) => a.stockGroupName.localeCompare(b.stockGroupName) || a.stockItemName.localeCompare(b.stockItemName),
      );
  }, [
    combinedStockRows,
    allStockGroupFilter,
    allStockCategoryFilter,
    allStockLocationFilter,
    deferredSearchTerm,
  ]);

  return { allInventoryLocations, allInventoryGroups, filteredCombinedRows };
}
