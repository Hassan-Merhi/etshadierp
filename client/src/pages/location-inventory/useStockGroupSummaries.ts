import { useMemo } from "react";
import type { InventoryItem, StockGroupSummary } from "./locationInventoryTypes";

interface InventorySummary {
  groups: Array<StockGroupSummary & { hasNegative?: boolean; categoryIds?: number[] }>;
  totals: { items: number; quantity: number; value: number | null };
}

interface UseStockGroupSummariesParams {
  inventorySummary: InventorySummary;
  openingInventoryData: any[];
  inventoryData: any[];
  closingInventoryData: any[];
  inventorySummaryLoading: boolean;
  openingInventoryLoading: boolean;
  closingInventoryLoading: boolean;
  inventoryLoading: boolean;
  fromDate: string;
  asOfDate: string;
  showZeroStock: boolean;
  showNegativeStock: boolean;
  groupSearchTerm: string;
  groupCategoryFilter: string;
  itemSearchTerm: string;
  itemCategoryFilter: string[];
  selectedGroup: StockGroupSummary | null;
}

function buildGroups(items: InventoryItem[]): StockGroupSummary[] {
  const groups = new Map<string, StockGroupSummary>();
  for (const item of items) {
    const groupId = item.stockGroupId ?? null;
    const key = String(groupId);
    let group = groups.get(key);
    if (!group) {
      group = {
        groupId,
        groupCode: item.stockGroupCode,
        groupName: item.stockGroupName || "Ungrouped",
        totalQuantity: 0,
        totalValue: 0,
        averageRate: 0,
        itemCount: 0,
        items: [],
      };
      groups.set(key, group);
    }
    const quantity = Number.parseFloat(item.quantity || "0");
    group.totalQuantity += quantity;
    group.totalValue += Number.parseFloat(item.totalValue || "0");
    group.itemCount += 1;
    group.items.push(item);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      averageRate: group.totalQuantity !== 0 ? group.totalValue / group.totalQuantity : 0,
    }))
    .sort((a, b) => a.groupName.localeCompare(b.groupName));
}

export function useStockGroupSummaries({
  inventorySummary,
  openingInventoryData,
  inventoryData,
  closingInventoryData,
  inventorySummaryLoading,
  openingInventoryLoading,
  closingInventoryLoading,
  inventoryLoading,
  fromDate,
  asOfDate,
  showNegativeStock,
  groupSearchTerm,
  groupCategoryFilter,
  itemSearchTerm,
  itemCategoryFilter,
  selectedGroup,
}: UseStockGroupSummariesParams) {
  const openingInventoryMap = useMemo(() => {
    const map = new Map<number, number>();
    openingInventoryData.forEach((item: InventoryItem) =>
      map.set(item.stockItemId, Number.parseFloat(item.quantity || "0"))
    );
    return map;
  }, [openingInventoryData]);

  const showMovement = Boolean(fromDate && asOfDate);
  const historicalInventory = useMemo(
    () =>
      closingInventoryData.filter(
        (item) => !showNegativeStock || Number.parseFloat(item.quantity || "0") < 0
      ) as InventoryItem[],
    [closingInventoryData, showNegativeStock]
  );
  const historicalGroups = useMemo(() => buildGroups(historicalInventory), [historicalInventory]);

  const inventory = (showMovement ? historicalInventory : inventoryData) as InventoryItem[];
  const stockGroups = showMovement ? historicalGroups : inventorySummary.groups;
  const activeInventoryLoading = showMovement
    ? closingInventoryLoading || openingInventoryLoading
    : inventorySummaryLoading || inventoryLoading;

  const filteredStockGroups = useMemo(() => {
    const search = groupSearchTerm.trim().toLowerCase();
    return stockGroups.filter((group: any) => {
      if (showNegativeStock) {
        const containsNegative = showMovement
          ? group.items.some((item: InventoryItem) => Number.parseFloat(item.quantity || "0") < 0)
          : Boolean(group.hasNegative);
        if (!containsNegative) return false;
      }
      if (search && !group.groupName.toLowerCase().includes(search)) return false;
      if (groupCategoryFilter) {
        if (showMovement) {
          const matches = group.items.some((item: InventoryItem) =>
            groupCategoryFilter === "none" ? item.categoryId == null : String(item.categoryId) === groupCategoryFilter
          );
          if (!matches) return false;
        } else {
          const categoryIds = (group.categoryIds ?? []).map(String);
          if (groupCategoryFilter === "none") {
            if (!categoryIds.includes("null") && categoryIds.length === group.itemCount) return false;
          } else if (!categoryIds.includes(groupCategoryFilter)) {
            return false;
          }
        }
      }
      return true;
    });
  }, [stockGroups, groupSearchTerm, groupCategoryFilter, showNegativeStock, showMovement]);

  const filteredStockItems = useMemo(() => {
    if (!selectedGroup) return [];
    if (!showMovement) return inventory;
    return selectedGroup.items
      .filter((item) => {
        if (showNegativeStock && Number.parseFloat(item.quantity || "0") >= 0) return false;
        if (itemCategoryFilter.length > 0) {
          const categoryId = item.categoryId == null ? "none" : String(item.categoryId);
          if (!itemCategoryFilter.includes(categoryId)) return false;
        }
        if (!itemSearchTerm) return true;
        const search = itemSearchTerm.toLowerCase();
        return (
          (item.stockItemName || "").toLowerCase().includes(search) ||
          (item.stockItemCode || "").toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
  }, [selectedGroup, inventory, itemSearchTerm, itemCategoryFilter, showNegativeStock, showMovement]);

  const allItemsFiltered = useMemo(() => {
    if (!showMovement) return inventory;
    return historicalInventory
      .filter((item) => {
        if (!itemSearchTerm) return true;
        const search = itemSearchTerm.toLowerCase();
        return (
          (item.stockItemName || "").toLowerCase().includes(search) ||
          (item.stockItemCode || "").toLowerCase().includes(search)
        );
      })
      .sort(
        (a, b) =>
          (a.stockGroupName || "").localeCompare(b.stockGroupName || "") ||
          a.stockItemName.localeCompare(b.stockItemName)
      );
  }, [historicalInventory, inventory, itemSearchTerm, showMovement]);

  const totalQty = showMovement
    ? historicalGroups.reduce((sum, group) => sum + group.totalQuantity, 0)
    : inventorySummary.totals.quantity;
  const totalValue = showMovement
    ? historicalGroups.reduce((sum, group) => sum + group.totalValue, 0)
    : Number(inventorySummary.totals.value ?? 0);
  const totalItems = showMovement
    ? historicalGroups.reduce((sum, group) => sum + group.itemCount, 0)
    : inventorySummary.totals.items;

  return {
    openingInventoryMap,
    showMovement,
    activeInventoryData: inventory,
    activeInventoryLoading,
    inventory,
    stockGroups,
    filteredStockGroups,
    filteredStockItems,
    allItemsFiltered,
    totalQty,
    totalValue,
    totalItems,
  };
}
