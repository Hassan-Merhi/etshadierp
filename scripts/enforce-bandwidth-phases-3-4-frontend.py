from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find {label}")
    return text.replace(old, new, 1)


def replace_block(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    if replacement in text:
        return text
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"Could not find start of {label}")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"Could not find end of {label}")
    return text[:start] + replacement + text[end:]


Path("client/src/pages/location-inventory/useLocationInventoryQueries.ts").write_text(r'''import { useQuery } from "@tanstack/react-query";
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

  const { data: inventorySummary = { groups: [], totals: { items: 0, quantity: 0, value: null } }, isLoading: inventorySummaryLoading } =
    useQuery<InventorySummary>({
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
    enabled:
      !!selectedLocationLocal &&
      !!companyId &&
      !showMovement &&
      (viewAllItems || selectedGroup !== null),
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
''')

Path("client/src/pages/location-inventory/useStockGroupSummaries.ts").write_text(r'''import { useMemo } from "react";
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
            groupCategoryFilter === "none"
              ? item.categoryId == null
              : String(item.categoryId) === groupCategoryFilter
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
''')

Path("client/src/pages/location-inventory/useCombinedStockRows.ts").write_text(r'''import { useMemo } from "react";

interface UseCombinedStockRowsParams {
  allInventoryData: any[];
  allLocations: any[];
  stockGroupsList: any[];
}

export function useCombinedStockRows({
  allInventoryData,
  allLocations,
  stockGroupsList,
}: UseCombinedStockRowsParams) {
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
''')

# Reusable pagination on location item views.
for file_name in ["AllItemsView.tsx", "StockGroupItemsView.tsx"]:
    path = Path("client/src/pages/location-inventory") / file_name
    text = path.read_text()
    inventory_import = 'import { InventoryTable } from "./InventoryTable";\n'
    pagination_import = 'import { PaginationBar } from "@/components/PaginationBar";\n'
    if pagination_import not in text:
      text = replace_once(text, inventory_import, inventory_import + pagination_import, f"{file_name} pagination import")
    interface_anchor = '  inventory: InventoryItem[];\n'
    interface_replacement = '''  inventory: InventoryItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
'''
    text = replace_once(text, interface_anchor, interface_replacement, f"{file_name} pagination prop")
    destructure_anchor = '  inventory,\n}: '
    destructure_replacement = '  inventory,\n  pagination,\n}: '
    text = replace_once(text, destructure_anchor, destructure_replacement, f"{file_name} pagination destructure")
    table_end = '''      />
'''
    pagination_render = '''      />
      {pagination && (
        <PaginationBar
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
        />
      )}
'''
    last_table = text.rfind(table_end)
    if last_table < 0:
      raise RuntimeError(f"Could not find table end in {file_name}")
    if "<PaginationBar" not in text:
      text = text[:last_table] + pagination_render + text[last_table + len(table_end):]
    path.write_text(text)

# Combined stock view uses server page metadata and a pagination bar.
path = Path("client/src/pages/location-inventory/CombinedStockView.tsx")
text = path.read_text()
button_import = 'import { Button } from "@/components/ui/button";\n'
pagination_import = 'import { PaginationBar } from "@/components/PaginationBar";\n'
if pagination_import not in text:
    text = replace_once(text, button_import, button_import + pagination_import, "combined pagination import")
interface_anchor = '  allStockTableRef: React.RefObject<HTMLDivElement>;\n'
interface_replacement = '''  allStockTableRef: React.RefObject<HTMLDivElement>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
'''
text = replace_once(text, interface_anchor, interface_replacement, "combined pagination prop")
destructure_anchor = '  allStockTableRef,\n}: CombinedStockViewProps)'
destructure_replacement = '  allStockTableRef,\n  pagination,\n}: CombinedStockViewProps)'
text = replace_once(text, destructure_anchor, destructure_replacement, "combined pagination destructure")
text = text.replace('{filteredCombinedRows.length.toLocaleString()}</span>\n            <span className="text-xs text-muted-foreground">Items</span>', '{pagination.total.toLocaleString()}</span>\n            <span className="text-xs text-muted-foreground">Items</span>', 1)
end_anchor = '''      </Card>
    </div>
'''
end_replacement = '''      </Card>
      <PaginationBar
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={pagination.onPageChange}
      />
    </div>
'''
text = replace_once(text, end_anchor, end_replacement, "combined pagination render")
path.write_text(text)

# Location Inventory page: hold page state, pass filters to the query hook, and render pagination.
path = Path("client/src/pages/LocationInventory.tsx")
text = path.read_text()
first_import = 'import { useLocation } from "@/contexts/LocationContext";\n'
react_import = 'import { useEffect, useState } from "react";\n'
if react_import not in text:
    text = replace_once(text, first_import, react_import + first_import, "LocationInventory React import")
company_anchor = '  const companyId = selectedCompany?.id;\n\n'
page_state = '''  const companyId = selectedCompany?.id;
  const [inventoryPage, setInventoryPage] = useState(1);
  const [allStockPage, setAllStockPage] = useState(1);

'''
text = replace_once(text, company_anchor, page_state, "LocationInventory page state")
query_destructure_anchor = '''    locationsLoading,
    inventoryData,
'''
query_destructure_replacement = '''    locationsLoading,
    inventorySummary,
    inventorySummaryLoading,
    inventoryData,
'''
text = replace_once(text, query_destructure_anchor, query_destructure_replacement, "inventory summary destructure")
text = replace_once(
    text,
    '''    inventoryLoading,
    openingInventoryData,''',
    '''    inventoryLoading,
    inventoryPagination,
    openingInventoryData,''',
    "inventory pagination destructure",
)
text = replace_once(
    text,
    '''    allInventoryData,
    allInventoryLoading,''',
    '''    allInventoryData,
    allInventoryLoading,
    allInventoryPagination,''',
    "combined pagination destructure",
)
text = replace_once(
    text,
    '''    categoriesList,
  } = useLocationInventoryQueries({''',
    '''    categoriesList,
    stockGroupsList,
  } = useLocationInventoryQueries({''',
    "stock group list destructure",
)
call_anchor = '''    selectedLocationLocal,
    showZeroStock,
'''
call_replacement = '''    selectedLocationLocal,
    selectedGroup,
    viewAllItems,
    showZeroStock,
'''
text = replace_once(text, call_anchor, call_replacement, "location query selected state")
call_end = '''    showAllStock,
    showNegativeStock,
  });
'''
call_end_replacement = '''    showAllStock,
    showNegativeStock,
    itemSearchTerm,
    itemCategoryFilter,
    inventoryPage,
    allStockPage,
    allStockSearchTerm,
    allStockGroupFilter,
    allStockLocationFilter,
    allStockCategoryFilter,
  });

  useEffect(() => {
    setInventoryPage(1);
  }, [
    selectedLocationLocal?.id,
    selectedGroup ? String(selectedGroup.groupId) : "no-group-selected",
    viewAllItems,
    itemSearchTerm,
    itemCategoryFilter.join(","),
    showZeroStock,
    showNegativeStock,
    fromDate,
    asOfDate,
  ]);

  useEffect(() => {
    setAllStockPage(1);
  }, [
    allStockSearchTerm,
    allStockGroupFilter,
    allStockLocationFilter,
    allStockCategoryFilter.join(","),
  ]);
'''
text = replace_once(text, call_end, call_end_replacement, "location query pagination args")
combined_hook_old = '''  const { allInventoryLocations, allInventoryGroups, filteredCombinedRows } = useCombinedStockRows({
    allInventoryData,
    allStockGroupFilter,
    allStockCategoryFilter,
    allStockLocationFilter,
    allStockSearchTerm,
  });
'''
combined_hook_new = '''  const { allInventoryLocations, allInventoryGroups, filteredCombinedRows } = useCombinedStockRows({
    allInventoryData,
    allLocations: locations,
    stockGroupsList,
  });
'''
text = replace_once(text, combined_hook_old, combined_hook_new, "combined server rows hook")
summary_call_anchor = '''  } = useStockGroupSummaries({
    openingInventoryData,
'''
summary_call_replacement = '''  } = useStockGroupSummaries({
    inventorySummary,
    openingInventoryData,
'''
text = replace_once(text, summary_call_anchor, summary_call_replacement, "summary query input")
text = replace_once(
    text,
    '''    closingInventoryData,
    openingInventoryLoading,''',
    '''    closingInventoryData,
    inventorySummaryLoading,
    openingInventoryLoading,''',
    "summary loading input",
)
combined_prop_anchor = '''              allStockTableRef={allStockTableRef}
            />'''
combined_prop_replacement = '''              allStockTableRef={allStockTableRef}
              pagination={{
                ...allInventoryPagination,
                onPageChange: setAllStockPage,
              }}
            />'''
text = replace_once(text, combined_prop_anchor, combined_prop_replacement, "combined pagination props")
for component in ["StockGroupItemsView", "AllItemsView"]:
    marker = '                inventory={inventory}\n              />'
    replacement = '''                inventory={inventory}
                pagination={
                  showMovement
                    ? undefined
                    : {
                        ...inventoryPagination,
                        onPageChange: setInventoryPage,
                      }
                }
              />'''
    text = replace_once(text, marker, replacement, f"{component} pagination props")
path.write_text(text)

# POS response type.
path = Path("client/src/pages/pos/pospricelist/types.ts")
text = path.read_text()
insert_anchor = '''export interface MasterPriceListResponse {
  masters: { id: number; name: string }[];
  items: MasterItem[];
}
'''
insert_replacement = '''export interface MasterPriceListResponse {
  masters: { id: number; name: string }[];
  items: MasterItem[];
}

export interface PaginatedPriceListResponse {
  data: PriceListItem[];
  groups: string[];
  counts: { total: number; priced: number; unpriced: number };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
'''
text = replace_once(text, insert_anchor, insert_replacement, "POS paginated response type")
path.write_text(text)

# POS screen: debounced server search/filter/pagination for single-location mode.
path = Path("client/src/pages/pos/POSPriceList.tsx")
text = path.read_text()
query_import = 'import { queryClient, apiRequest } from "@/lib/queryClient";\n'
new_imports = 'import { PaginationBar } from "@/components/PaginationBar";\nimport { useDebouncedValue } from "@/hooks/useDebouncedValue";\n'
if new_imports not in text:
    text = replace_once(text, query_import, query_import + new_imports, "POS pagination imports")
type_anchor = '''  POSPriceListProps,
  PriceListItem,
'''
type_replacement = '''  POSPriceListProps,
  PaginatedPriceListResponse,
  PriceListItem,
'''
text = replace_once(text, type_anchor, type_replacement, "POS paginated type import")
state_anchor = '  const [search, setSearch] = useState("");\n'
state_replacement = '''  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
'''
text = replace_once(text, state_anchor, state_replacement, "POS page state")
start_marker = '''  const {
    data: priceList = [],
    isLoading: priceListLoading,
'''
end_marker = '''

  // ── All-masters price list'''
new_query = '''  const pricePageSize = posUser ? 30 : 50;
  const {
    data: priceListResponse,
    isLoading: priceListLoading,
    isError: priceListError,
    error: priceListErrorObj,
  } = useQuery<PaginatedPriceListResponse>({
    queryKey: [
      "/api/pos/price-list",
      "paged",
      selectedLocationId,
      page,
      pricePageSize,
      debouncedSearch,
      groupFilter,
      showUnpriced,
      !!posUser,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        locationId: String(selectedLocationId),
        page: String(page),
        pageSize: String(pricePageSize),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (groupFilter !== "all") params.set("group", groupFilter);
      if (showUnpriced) params.set("unpriced", "true");
      if (posUser) params.set("availableOnly", "true");
      const res = await fetch(`/api/pos/price-list?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(body.message || "Failed to load price list");
      }
      return res.json();
    },
    enabled: !!selectedLocationId && !isAllMode,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
  const priceList = priceListResponse?.data ?? [];
'''
text = replace_block(text, start_marker, end_marker, new_query, "POS paged query")
stock_groups_old = '''  const stockGroups = useMemo(() => {
    const groups = new Set<string>();
    locationPricedList.forEach((item) => {
      if (item.stockGroupName) groups.add(item.stockGroupName);
    });
    return Array.from(groups).sort();
  }, [locationPricedList]);
'''
stock_groups_new = '''  const stockGroups = useMemo(() => {
    if (!isAllMode && priceListResponse?.groups) return priceListResponse.groups;
    const groups = new Set<string>();
    locationPricedList.forEach((item) => {
      if (item.stockGroupName) groups.add(item.stockGroupName);
    });
    return Array.from(groups).sort();
  }, [locationPricedList, isAllMode, priceListResponse?.groups]);
'''
text = replace_once(text, stock_groups_old, stock_groups_new, "POS server group options")
unpriced_old = '''  const unpricedCount = useMemo(
    () => locationPricedList.filter(isItemUnpriced).length,
    [locationPricedList, isAllMode]
  );
'''
unpriced_new = '''  const unpricedCount = useMemo(
    () =>
      isAllMode
        ? locationPricedList.filter(isItemUnpriced).length
        : (priceListResponse?.counts.unpriced ?? 0),
    [locationPricedList, isAllMode, priceListResponse?.counts.unpriced]
  );
  const totalItemCount = isAllMode
    ? locationPricedList.length
    : (priceListResponse?.counts.total ?? priceList.length);
  const pricedItemCount = isAllMode
    ? locationPricedList.length - unpricedCount
    : (priceListResponse?.counts.priced ?? Math.max(0, totalItemCount - unpricedCount));
'''
text = replace_once(text, unpriced_old, unpriced_new, "POS server counts")
filter_end = '''  }, [locationPricedList, search, groupFilter, showUnpriced, hiddenUnpricedGroups, isAllMode]);

  const selectedLocation'''
filter_end_replacement = '''  }, [locationPricedList, search, groupFilter, showUnpriced, hiddenUnpricedGroups, isAllMode]);

  useEffect(() => {
    setPage(1);
  }, [selectedLocationId, debouncedSearch, groupFilter, showUnpriced]);

  const selectedLocation'''
text = replace_once(text, filter_end, filter_end_replacement, "POS page reset")
text = text.replace("{locationPricedList.length}</p>", "{totalItemCount}</p>", 1)
text = text.replace("{locationPricedList.length - unpricedCount}", "{pricedItemCount}", 1)
text = text.replace("Showing {filteredItems.length} of {locationPricedList.length} items", "Showing {filteredItems.length} of {totalItemCount} items", 1)
count_anchor = '''                  <p className="text-xs text-muted-foreground text-right mt-2" data-testid="text-item-count">
                    Showing {filteredItems.length} of {totalItemCount} items
                    {canEdit && (
'''
# Pagination is added after the existing count paragraph block, immediately before the enclosing fragment closes.
count_end = '''                  </p>
                </>
'''
count_end_replacement = '''                  </p>
                  {!isAllMode && priceListResponse && (
                    <PaginationBar
                      page={priceListResponse.page}
                      pageSize={priceListResponse.pageSize}
                      total={priceListResponse.total}
                      totalPages={priceListResponse.totalPages}
                      onPageChange={setPage}
                    />
                  )}
                </>
'''
text = replace_once(text, count_end, count_end_replacement, "POS pagination render")
select_location_old = '''  const selectLocation = (id: number) => {
    setSelectedLocationId(id);
    setSearch("");
'''
select_location_new = '''  const selectLocation = (id: number) => {
    setSelectedLocationId(id);
    setPage(1);
    setSearch("");
'''
text = replace_once(text, select_location_old, select_location_new, "POS location page reset")
path.write_text(text)
