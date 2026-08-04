import { useMemo } from "react";

interface UseCombinedStockRowsParams {
  allInventoryData: any[];
  allLocations: any[];
  stockGroupsList: any[];
}

export function useCombinedStockRows({ allInventoryData, allLocations, stockGroupsList }: UseCombinedStockRowsParams) {
  const allInventoryLocations = useMemo(
    () =>
      [...allLocations]
        .filter((location) => location?.id && location?.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [allLocations]
  );

  const allInventoryGroups = useMemo(() => {
    const groups = stockGroupsList.map((group) => ({ id: group.id, name: group.name }));
    if (allInventoryData.some((row) => row.stockGroupId == null)) {
      groups.push({ id: null, name: "Unassigned" });
    }
    return groups.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [stockGroupsList, allInventoryData]);

  const filteredCombinedRows = useMemo(
    () =>
      allInventoryData
        .map((row) => ({
          ...row,
          totalQty: Number.parseFloat(row.totalQty ?? row.quantity ?? "0"),
          avgCost: Number.parseFloat(row.avgCost ?? row.averageRate ?? "0"),
          totalValue: Number.parseFloat(row.totalValue ?? "0"),
          qtyByLocationName: Object.fromEntries(
            Object.entries(row.qtyByLocationName ?? {}).map(([name, quantity]) => [
              name,
              Number.parseFloat(String(quantity ?? "0")),
            ])
          ),
          stockGroupName: row.stockGroupName || "Unassigned",
        }))
        .sort(
          (a, b) =>
            String(a.stockGroupName).localeCompare(String(b.stockGroupName)) ||
            String(a.stockItemName).localeCompare(String(b.stockItemName))
        ),
    [allInventoryData]
  );

  return { allInventoryLocations, allInventoryGroups, filteredCombinedRows };
}
