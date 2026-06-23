import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation as useRoute } from "wouter";
import {
  ArrowUpDown,
  Package,
  Warehouse,
  Search,
  X,
  ChevronDown,
  Download,
  List,
  Eye,
  Printer,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Layers,
  FileSpreadsheet,
  MessageCircle,
  Pencil,
  AlertCircle,
  Globe,
  MapPin,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { getDefaultPeriodValue } from "@/components/ui/period-filter";

import { LocationGrid } from "./location-inventory/LocationGrid";
import { InventoryTable } from "./location-inventory/InventoryTable";
import { CombinedStockView } from "./location-inventory/CombinedStockView";
import { LocationDialogs } from "./location-inventory/LocationDialogs";

interface Location {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  createdAt?: string;
  supplierPartnerPayableDeductionPerQty?: string | null;
}

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

interface StockGroupSummary {
  groupId: number | null;
  groupCode: string | null;
  groupName: string;
  totalQuantity: number;
  totalValue: number;
  averageRate: number;
  itemCount: number;
  items: InventoryItem[];
}

export default function LocationInventory({ posUser }: { posUser?: any } = {}) {
  const [selectedLocationLocal, setSelectedLocationLocal] = useState<Location | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StockGroupSummary | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number>(0);
  const [viewAllItems, setViewAllItems] = useState<boolean>(false);
  const [locationSearchTerm, setLocationSearchTerm] = useState("");
  const [groupSearchTerm, setGroupSearchTerm] = useState("");
  const [itemSearchTerm, setItemSearchTerm] = useState("");
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [showNegativeStock, setShowNegativeStock] = useState(false);
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [negativeSearchTerm, setNegativeSearchTerm] = useState("");
  const [showAllStock, setShowAllStock] = useState(false);
  const [allStockGroupFilter, setAllStockGroupFilter] = useState<string>("");
  const [allStockSearchTerm, setAllStockSearchTerm] = useState("");
  const [allStockLocationFilter, setAllStockLocationFilter] = useState<string>("");
  const [allStockCategoryFilter, setAllStockCategoryFilter] = useState<string[]>([]);
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string[]>([]);
  const [groupCategoryFilter, setGroupCategoryFilter] = useState<string>("");
  const tableRef = useRef<HTMLDivElement>(null);
  const [allStockSelectedRowIndex, setAllStockSelectedRowIndex] = useState<number>(-1);
  const [stockMovementOpen, setStockMovementOpen] = useState(false);
  const [stockMovementItem, setStockMovementItem] = useState<any>(null);
  const [stockMovementPeriod, setStockMovementPeriod] = useState<any>(() => getDefaultPeriodValue("this_month"));
  const [drillMonth, setDrillMonth] = useState<any>(null);
  const allStockTableRef = useRef<HTMLDivElement>(null);

  // Dialogs
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingLocation, setRenamingLocation] = useState<Location | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameDeductionInput, setRenameDeductionInput] = useState("");
  const [waGroupDialogOpen, setWaGroupDialogOpen] = useState(false);
  const [waGroupLocation, setWaGroupLocation] = useState<Location | null>(null);
  const [waGroupSearch, setWaGroupSearch] = useState("");
  const [waGroupSelectedId, setWaGroupSelectedId] = useState<string>("");
  const [createLocationOpen, setCreateLocationOpen] = useState(false);
  const [createLocationName, setCreateLocationName] = useState("");

  const { setSelectedLocation } = useLocation();
  const [_route, navigate] = useRoute();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;

  // Reset location/group selection and invalidate caches whenever the active company changes.
  useEffect(() => {
    setSelectedLocationLocal(null);
    setSelectedGroup(null);
    setViewAllItems(false);
    setLocationSearchTerm("");
    setGroupSearchTerm("");
    setItemSearchTerm("");
    queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stock-categories"] });
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrintWithOption = async (withCost: boolean) => {
    if (!selectedLocationLocal) return;
    try {
      const includeCost = withCost ? "1" : "0";
      const response = await fetch(
        `/api/locations/${selectedLocationLocal.id}/inventory/pdf?includeCost=${includeCost}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "PDF generation failed" }));
        toast({ title: "Export Failed", description: err.message, variant: "destructive" });
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = selectedLocationLocal.name.replace(/\s+/g, "_");
      const date = new Date().toLocaleDateString("en-CA");
      a.download = `${safeName}_Godown_${date}${withCost ? "_with_cost" : "_no_cost"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "PDF Downloaded" });
    } catch (error: any) {
      toast({ title: "Export Failed", description: error.message, variant: "destructive" });
    }
  };

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const renameLocationMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      supplierPartnerPayableDeductionPerQty,
    }: {
      id: number;
      name: string;
      supplierPartnerPayableDeductionPerQty?: number;
    }) => {
      const payload: Record<string, any> = { name };
      if (supplierPartnerPayableDeductionPerQty !== undefined)
        payload.supplierPartnerPayableDeductionPerQty = supplierPartnerPayableDeductionPerQty;
      const res = await apiRequest("PATCH", `/api/locations/${id}`, payload);
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: "Location renamed", description: `Renamed to "${updated.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) setSelectedLocationLocal(updated);
      setRenameDialogOpen(false);
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const createLocationMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/locations", { name });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Location created" });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      setCreateLocationOpen(false);
      setCreateLocationName("");
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const waGroupMutation = useMutation({
    mutationFn: async ({
      id,
      name,
      whatsappGroupChatId,
    }: {
      id: number;
      name: string;
      whatsappGroupChatId: string | null;
    }) => {
      const res = await apiRequest("PATCH", `/api/locations/${id}`, { name, whatsappGroupChatId });
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: updated.whatsappGroupChatId ? "WhatsApp group assigned" : "WhatsApp group removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) setSelectedLocationLocal(updated);
      setWaGroupDialogOpen(false);
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const openRenameDialog = (loc: Location, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setRenamingLocation(loc);
    setRenameInput(loc.name);
    setRenameDeductionInput(parseFloat(String(loc.supplierPartnerPayableDeductionPerQty ?? "0")).toString());
    setRenameDialogOpen(true);
  };

  const openWaGroupDialog = (loc: Location, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setWaGroupLocation(loc);
    setWaGroupSelectedId((loc as any).whatsappGroupChatId ?? "");
    setWaGroupSearch("");
    setWaGroupDialogOpen(true);
  };

  // ─── Queries ────────────────────────────────────────────────────────────────

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

  const { data: allInventoryData = [], isLoading: allInventoryLoading } = useQuery<any[]>({
    queryKey: companyId ? ["/api/inventory", companyId] : [],
    queryFn: async () => {
      const res = await fetch("/api/inventory", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: showAllStock && !!companyId,
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

  // ─── Derived data ────────────────────────────────────────────────────────────

  const allInventoryLocations = useMemo(() => {
    const locs = new Map<number, { id: number; name: string }>();
    allInventoryData.forEach((item: any) => {
      if (item.locationId && !locs.has(item.locationId))
        locs.set(item.locationId, { id: item.locationId, name: item.locationName || "" });
    });
    return [...locs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  const allInventoryGroups = useMemo(() => {
    const groups = new Map<string, { id: number | null; name: string }>();
    allInventoryData.forEach((item: any) => {
      const key = String(item.stockGroupId ?? "null");
      if (!groups.has(key))
        groups.set(key, { id: item.stockGroupId ?? null, name: item.stockGroupName || "Unassigned" });
    });
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  const combinedStockRows = useMemo(() => {
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
          qtyByLocation: {},
          totalQty: 0,
          weightedCostSum: 0,
          totalValue: 0,
        });
      }
      const row = itemMap.get(item.stockItemId)!;
      row.qtyByLocation[item.locationId] = (row.qtyByLocation[item.locationId] || 0) + qty;
      row.totalQty += qty;
      const avgRate = parseFloat(item.averageRate || "0");
      row.weightedCostSum += qty * avgRate;
      row.totalValue += parseFloat(item.totalValue || "0");
    });
    return [...itemMap.values()].map((row) => ({
      ...row,
      avgCost: row.totalQty > 0 ? row.weightedCostSum / row.totalQty : 0,
    }));
  }, [allInventoryData]);

  const filteredCombinedRows = useMemo(() => {
    return combinedStockRows
      .filter((row) => {
        if (allStockGroupFilter) {
          if (allStockGroupFilter === "null") {
            if (row.stockGroupId !== null) return false;
          } else {
            if (String(row.stockGroupId) !== allStockGroupFilter) return false;
          }
        }
        if (allStockCategoryFilter.length > 0) {
          const rowCatId = row.categoryId == null ? "none" : String(row.categoryId);
          if (!allStockCategoryFilter.includes(rowCatId)) return false;
        }
        if (allStockLocationFilter) {
          const matchingIds = allInventoryLocations.filter((l) => l.name === allStockLocationFilter).map((l) => l.id);
          const hasQty = matchingIds.some((id) => (row.qtyByLocation[id] || 0) > 0);
          if (!hasQty) return false;
        }
        if (allStockSearchTerm) {
          const s = allStockSearchTerm.toLowerCase();
          return row.stockItemName.toLowerCase().includes(s) || row.stockItemCode.toLowerCase().includes(s);
        }
        return true;
      })
      .sort(
        (a, b) => a.stockGroupName.localeCompare(b.stockGroupName) || a.stockItemName.localeCompare(b.stockItemName)
      );
  }, [
    combinedStockRows,
    allStockGroupFilter,
    allStockCategoryFilter,
    allStockLocationFilter,
    allStockSearchTerm,
    allInventoryLocations,
  ]);

  const openingInventoryMap = useMemo(() => {
    const map = new Map<number, number>();
    openingInventoryData.forEach((item: InventoryItem) => map.set(item.stockItemId, parseFloat(item.quantity || "0")));
    return map;
  }, [openingInventoryData]);

  const showMovement = !!(fromDate && asOfDate);
  const activeInventoryData = showMovement ? closingInventoryData : inventoryData;
  const activeInventoryLoading = showMovement ? closingInventoryLoading || openingInventoryLoading : inventoryLoading;

  // All items (respecting zero filter)
  const inventory: InventoryItem[] = showZeroStock
    ? activeInventoryData
    : activeInventoryData.filter((item) => parseFloat(item.quantity || "0") !== 0);

  // Stock groups built from inventory
  const stockGroups: StockGroupSummary[] = useMemo(() => {
    const groups: StockGroupSummary[] = [];
    inventory.forEach((item) => {
      const groupId = item.stockGroupId ?? null;
      let group = groups.find((g) => g.groupId === groupId);
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
        groups.push(group);
      }
      const qty = parseFloat(item.quantity || "0");
      group.totalQuantity += qty;
      group.totalValue += parseFloat(item.totalValue || "0");
      group.itemCount += 1;
      group.items.push(item);
    });
    groups.forEach((g) => {
      if (g.totalQuantity > 0) g.averageRate = g.totalValue / g.totalQuantity;
    });
    return groups.sort((a, b) => a.groupName.localeCompare(b.groupName));
  }, [inventory]);

  // Filter stock groups by search + category
  const filteredStockGroups = useMemo(() => {
    return stockGroups.filter((g) => {
      if (groupSearchTerm && !g.groupName.toLowerCase().includes(groupSearchTerm.toLowerCase())) return false;
      if (groupCategoryFilter) {
        if (
          !g.items.some((item) => {
            if (groupCategoryFilter === "none") return item.categoryId == null;
            return String(item.categoryId) === groupCategoryFilter;
          })
        )
          return false;
      }
      return true;
    });
  }, [stockGroups, groupSearchTerm, groupCategoryFilter]);

  // Items within the selected group, with search + category
  const filteredStockItems = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.items
      .filter((item) => {
        if (itemCategoryFilter.length > 0) {
          const itemCatId = item.categoryId == null ? "none" : String(item.categoryId);
          if (!itemCategoryFilter.includes(itemCatId)) return false;
        }
        if (!itemSearchTerm) return true;
        const s = itemSearchTerm.toLowerCase();
        return (
          (item.stockItemName || "").toLowerCase().includes(s) || (item.stockItemCode || "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
  }, [selectedGroup, itemSearchTerm, itemCategoryFilter]);

  // All items flat list (for view-all mode)
  const allItemsFiltered = useMemo(() => {
    return inventory
      .filter((item) => {
        if (!itemSearchTerm) return true;
        const s = itemSearchTerm.toLowerCase();
        return (
          (item.stockItemName || "").toLowerCase().includes(s) || (item.stockItemCode || "").toLowerCase().includes(s)
        );
      })
      .sort(
        (a, b) =>
          (a.stockGroupName || "").localeCompare(b.stockGroupName || "") ||
          a.stockItemName.localeCompare(b.stockItemName)
      );
  }, [inventory, itemSearchTerm]);

  // Totals across all stock groups
  const totalQty = stockGroups.reduce((s, g) => s + g.totalQuantity, 0);
  const totalValue = stockGroups.reduce((s, g) => s + g.totalValue, 0);
  const totalItems = stockGroups.reduce((s, g) => s + g.itemCount, 0);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleDeleteLocation = async () => {
    if (!selectedLocationLocal) return;
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", `/api/locations/${selectedLocationLocal.id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location Deleted", description: `${selectedLocationLocal.name} deleted` });
      setSelectedLocationLocal(null);
      setDeleteDialogOpen(false);
    } catch (error: any) {
      toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveStockGroup = async () => {
    if (!selectedLocationLocal || !selectedGroup) return;
    setIsArchiving(true);
    try {
      await apiRequest("POST", "/api/stock-group-archives", {
        locationId: selectedLocationLocal.id,
        stockGroupId: selectedGroup.groupId,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Stock Group Archived" });
      setSelectedGroup(null);
      setArchiveDialogOpen(false);
    } catch (error: any) {
      toast({ title: "Archive Failed", description: error.message, variant: "destructive" });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleExportInventory = async () => {
    if (!selectedLocationLocal) return;
    try {
      const response = await fetch(`/api/locations/${selectedLocationLocal.id}/inventory/export`, {
        credentials: "include",
      });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedLocationLocal.name}_inventory_${new Date().toLocaleDateString("en-CA")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Successful" });
    } catch (error: any) {
      toast({ title: "Export Failed", description: error.message, variant: "destructive" });
    }
  };

  const goBackToLocations = () => {
    setSelectedLocationLocal(null);
    setSelectedGroup(null);
    setViewAllItems(false);
    setGroupSearchTerm("");
    setItemSearchTerm("");
    setGroupCategoryFilter("");
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Location Inventory</h1>
          <p className="text-sm text-muted-foreground">Manage inventory across all locations</p>
        </div>
        {!posUser && selectedLocationLocal && (
          <Button
            variant={showNegativeStock ? "destructive" : "outline"}
            size="sm"
            className="gap-2"
            onClick={() => setShowNegativeStock(!showNegativeStock)}
            data-testid="button-negative-stock"
          >
            <AlertCircle className="h-4 w-4" /> Negative Stock
          </Button>
        )}
      </div>

      {/* ── Movement filter (only when a location is selected) ─────────────── */}
      {selectedLocationLocal && !viewAllItems && (
        <div className="flex flex-wrap items-center gap-3 px-6 py-2.5 border-b bg-muted/10 shrink-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">MOVEMENT</span>
          </div>
          <span className="text-xs text-muted-foreground">From</span>
          <div className="relative">
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 w-36 text-sm"
              data-testid="input-from-date"
            />
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">To</span>
          <div className="relative">
            <Input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="h-8 w-36 text-sm"
              data-testid="input-to-date"
            />
          </div>
          {(fromDate || asOfDate) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1"
              onClick={() => {
                setFromDate("");
                setAsOfDate("");
              }}
            >
              <X className="h-3 w-3" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* ── Main content area ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {showAllStock ? (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => setShowAllStock(false)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            </div>
            <CombinedStockView
              allInventoryLoading={allInventoryLoading}
              filteredCombinedRows={filteredCombinedRows}
              allInventoryData={allInventoryData}
              allInventoryLocations={allInventoryLocations}
              allInventoryGroups={allInventoryGroups}
              categoriesList={categoriesList}
              allStockSearchTerm={allStockSearchTerm}
              setAllStockSearchTerm={setAllStockSearchTerm}
              allStockGroupFilter={allStockGroupFilter}
              setAllStockGroupFilter={setAllStockGroupFilter}
              allStockLocationFilter={allStockLocationFilter}
              setAllStockLocationFilter={setAllStockLocationFilter}
              allStockCategoryFilter={allStockCategoryFilter}
              setAllStockCategoryFilter={setAllStockCategoryFilter}
              allStockSelectedRowIndex={allStockSelectedRowIndex}
              openMovement={(l, n, sId, sName) => {
                setStockMovementItem({ stockItemId: sId, stockItemName: sName, locationId: l, locationName: n });
                setStockMovementOpen(true);
              }}
              formatAmount={formatAmount}
              posUser={posUser}
              allStockTableRef={allStockTableRef}
            />
          </div>
        ) : (
          <div className="px-6 py-4 space-y-4">
            {/* ── Breadcrumb ───────────────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {!selectedLocationLocal ? (
                <span>Select Location</span>
              ) : (
                <>
                  <button
                    className="hover:underline hover:text-foreground transition-colors"
                    onClick={goBackToLocations}
                  >
                    Locations
                  </button>
                  <ChevronRight className="h-3.5 w-3.5" />
                  {selectedGroup ? (
                    <>
                      <button
                        className="hover:underline hover:text-foreground transition-colors"
                        onClick={() => {
                          setSelectedGroup(null);
                          setViewAllItems(false);
                          setItemSearchTerm("");
                        }}
                      >
                        {selectedLocationLocal.name}
                      </button>
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span className="text-foreground font-medium">{selectedGroup.groupName}</span>
                    </>
                  ) : viewAllItems ? (
                    <>
                      <button
                        className="hover:underline hover:text-foreground transition-colors"
                        onClick={() => {
                          setViewAllItems(false);
                          setItemSearchTerm("");
                        }}
                      >
                        {selectedLocationLocal.name}
                      </button>
                      <ChevronRight className="h-3.5 w-3.5" />
                      <span className="text-foreground font-medium">All Items</span>
                    </>
                  ) : (
                    <span className="text-foreground font-medium">{selectedLocationLocal.name}</span>
                  )}
                </>
              )}
            </div>

            {/* ── NO LOCATION SELECTED: grid header + cards ────────────────── */}
            {!selectedLocationLocal && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-bold">Location Inventory</h2>
                  {!posUser && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => setShowAllStock(true)}
                        data-testid="button-view-all-stock"
                      >
                        <Globe className="h-4 w-4" /> View All Stock
                      </Button>
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => setCreateLocationOpen(true)}
                        data-testid="button-create-location"
                      >
                        <Plus className="h-4 w-4" /> Create Location
                      </Button>
                    </div>
                  )}
                </div>
                <LocationGrid
                  locations={locations}
                  locationsLoading={locationsLoading}
                  selectedLocationLocal={selectedLocationLocal}
                  setSelectedLocationLocal={(loc) => {
                    setSelectedLocationLocal(loc as Location | null);
                    setSelectedGroup(null);
                    setViewAllItems(false);
                    setGroupSearchTerm("");
                    setItemSearchTerm("");
                    setGroupCategoryFilter("");
                  }}
                  locationSearchTerm={locationSearchTerm}
                  setLocationSearchTerm={setLocationSearchTerm}
                  posUser={posUser}
                  openRenameDialog={openRenameDialog}
                  openWaGroupDialog={openWaGroupDialog}
                />
              </>
            )}

            {/* ── LOCATION SELECTED, no group, no view-all: stock groups ───── */}
            {selectedLocationLocal && !selectedGroup && !viewAllItems && (
              <>
                {/* Location title + action buttons */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Warehouse className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h2 className="text-2xl font-bold truncate">{selectedLocationLocal.name}</h2>
                        {!posUser && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openRenameDialog(selectedLocationLocal)}
                              data-testid="button-rename-location"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openWaGroupDialog(selectedLocationLocal)}
                              data-testid="button-wa-location"
                              title={(selectedLocationLocal as any)?.whatsappGroupChatId ? "WhatsApp group assigned" : "Assign WhatsApp group"}
                            >
                              <MessageCircle className={`h-4 w-4 ${(selectedLocationLocal as any)?.whatsappGroupChatId ? "text-green-500" : ""}`} />
                            </Button>
                          </>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Stock Groups</p>
                    </div>
                  </div>

                  {/* Stats pills */}
                  {!activeInventoryLoading && (
                    <div className="flex items-center gap-2 flex-wrap text-sm shrink-0">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium text-xs">
                        <Layers className="h-3 w-3" />
                        {stockGroups.length} {stockGroups.length === 1 ? "Group" : "Groups"}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium text-xs">
                        <Package className="h-3 w-3" />
                        {totalItems} Items
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium text-xs">
                        {Math.floor(totalQty).toLocaleString()} BL total
                      </span>
                      {!posUser && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium text-xs">
                          {formatAmount(totalValue)} total value
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-export-dropdown">
                        <Download className="h-4 w-4" /> Export <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={handleExportInventory} data-testid="menu-export-excel">
                        <FileSpreadsheet className="h-4 w-4 mr-2" /> Export to Excel
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handlePrintWithOption(true)} data-testid="menu-export-pdf-cost">
                        <Printer className="h-4 w-4 mr-2" /> Export to PDF (with cost)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handlePrintWithOption(false)}
                        data-testid="menu-export-pdf-nocost"
                      >
                        <Printer className="h-4 w-4 mr-2" /> Export to PDF (without cost)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setViewAllItems(true);
                      setItemSearchTerm("");
                    }}
                    data-testid="button-view-all-items"
                  >
                    <List className="h-4 w-4" /> View All Stock Items
                  </Button>

                  <Button
                    variant={showZeroStock ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowZeroStock(!showZeroStock)}
                    data-testid="button-show-zero"
                  >
                    <Eye className="h-4 w-4" /> Show zero stock
                  </Button>

                  {!posUser && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 ml-auto"
                          data-testid="button-location-menu"
                        >
                          Location <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openRenameDialog(selectedLocationLocal)}>
                          <Pencil className="h-4 w-4 mr-2" /> Edit / Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openWaGroupDialog(selectedLocationLocal)}>
                          <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp Group
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteDialogOpen(true)}
                          data-testid="menu-delete-location"
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete Location
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Search + categories */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search stock groups by name..."
                      value={groupSearchTerm}
                      onChange={(e) => setGroupSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-group-search"
                    />
                  </div>
                  <Select
                    value={groupCategoryFilter || "all"}
                    onValueChange={(v) => setGroupCategoryFilter(v === "all" ? "" : v)}
                  >
                    <SelectTrigger className="w-48" data-testid="select-category-filter">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="none">Uncategorized</SelectItem>
                      {categoriesList.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Stock groups table */}
                {activeInventoryLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-12 rounded-lg border bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : filteredStockGroups.length === 0 ? (
                  <div className="py-16 text-center border-2 border-dashed rounded-lg text-muted-foreground">
                    {groupSearchTerm
                      ? "No groups match your search."
                      : showZeroStock
                        ? "No stock items found for this location."
                        : 'No items with stock. Toggle "Show zero stock" to see all items.'}
                  </div>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="text-left px-4 py-3 font-medium">Name</th>
                          <th className="text-center px-4 py-3 font-medium">Items</th>
                          <th className="text-right px-4 py-3 font-medium">Total Qty (BL)</th>
                          {!posUser && (
                            <>
                              <th className="text-right px-4 py-3 font-medium">Avg Rate</th>
                              <th className="text-right px-4 py-3 font-medium">Total Value</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStockGroups.map((g) => (
                          <tr
                            key={g.groupId}
                            className="border-b hover-elevate cursor-pointer"
                            onClick={() => {
                              setSelectedGroup(g);
                              setItemSearchTerm("");
                              setItemCategoryFilter([]);
                            }}
                            data-testid={`row-group-${g.groupId}`}
                          >
                            <td className="px-4 py-3 font-medium">{g.groupName}</td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant="secondary">{g.itemCount}</Badge>
                            </td>
                            <td className="px-4 py-3 text-right font-mono">
                              {Math.floor(g.totalQuantity).toLocaleString()}
                              <span className="ml-1 text-xs text-muted-foreground font-normal">BL</span>
                            </td>
                            {!posUser && (
                              <>
                                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                                  {formatAmount(g.averageRate)}
                                </td>
                                <td className="px-4 py-3 text-right font-mono font-semibold">
                                  {formatAmount(g.totalValue)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/50 border-t-2 font-semibold">
                          <td className="px-4 py-3 font-bold">Total</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant="secondary">
                              {filteredStockGroups.reduce((s, g) => s + g.itemCount, 0)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold">
                            {Math.floor(filteredStockGroups.reduce((s, g) => s + g.totalQuantity, 0)).toLocaleString()}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">BL</span>
                          </td>
                          {!posUser && (
                            <>
                              <td className="px-4 py-3" />
                              <td className="px-4 py-3 text-right font-mono font-bold">
                                {formatAmount(filteredStockGroups.reduce((s, g) => s + g.totalValue, 0))}
                              </td>
                            </>
                          )}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {filteredStockGroups.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Showing {filteredStockGroups.length} of {stockGroups.length} stock{" "}
                    {stockGroups.length === 1 ? "group" : "groups"}
                  </p>
                )}
              </>
            )}

            {/* ── STOCK GROUP SELECTED: items table ────────────────────────── */}
            {selectedLocationLocal && selectedGroup && !viewAllItems && (
              <>
                {/* Stats bar */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Layers className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedGroup.groupName}</h2>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>
                        <span className="font-semibold text-foreground">{selectedGroup.itemCount}</span> Items
                      </span>
                      <span>
                        <span className="font-semibold text-foreground font-mono">
                          {Math.floor(selectedGroup.totalQuantity).toLocaleString()}
                        </span>{" "}
                        BL total
                      </span>
                      {!posUser && (
                        <span>
                          <span className="font-semibold text-foreground">
                            {formatAmount(selectedGroup.totalValue)}
                          </span>{" "}
                          total value
                        </span>
                      )}
                    </div>
                  </div>
                  {!posUser && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => setArchiveDialogOpen(true)}
                      data-testid="button-archive-group"
                    >
                      <Trash2 className="h-4 w-4" /> Archive Group
                    </Button>
                  )}
                </div>

                {/* Search + category */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search items by name..."
                      value={itemSearchTerm}
                      onChange={(e) => setItemSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-item-search"
                    />
                  </div>
                  <Select
                    value={itemCategoryFilter[0] || "all"}
                    onValueChange={(v) => setItemCategoryFilter(v === "all" ? [] : [v])}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="none">Uncategorized</SelectItem>
                      {categoriesList.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <InventoryTable
                  filteredStockItems={filteredStockItems}
                  showMovement={showMovement}
                  openingInventoryMap={openingInventoryMap}
                  selectedRowIndex={selectedRowIndex}
                  setSelectedRowIndex={setSelectedRowIndex}
                  navigate={navigate}
                  formatAmount={formatAmount}
                  posUser={posUser}
                  itemSearchTerm={itemSearchTerm}
                  inventory={inventory}
                  selectedGroup={selectedGroup}
                />
              </>
            )}

            {/* ── VIEW ALL ITEMS ────────────────────────────────────────────── */}
            {selectedLocationLocal && viewAllItems && !selectedGroup && (
              <>
                {/* Stats */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                  <span className="font-semibold text-foreground">{totalItems}</span> Items
                  <span className="text-muted-foreground">·</span>
                  <span className="font-semibold text-foreground font-mono">
                    {Math.floor(totalQty).toLocaleString()}
                  </span>{" "}
                  BL total
                  {!posUser && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-semibold text-foreground">{formatAmount(totalValue)}</span> total value
                    </>
                  )}
                </div>

                {/* Search */}
                <div className="relative max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search items by name..."
                    value={itemSearchTerm}
                    onChange={(e) => setItemSearchTerm(e.target.value)}
                    className="pl-9"
                    data-testid="input-all-item-search"
                  />
                </div>

                <InventoryTable
                  filteredStockItems={allItemsFiltered}
                  showMovement={showMovement}
                  openingInventoryMap={openingInventoryMap}
                  selectedRowIndex={selectedRowIndex}
                  setSelectedRowIndex={setSelectedRowIndex}
                  navigate={navigate}
                  formatAmount={formatAmount}
                  posUser={posUser}
                  itemSearchTerm={itemSearchTerm}
                  inventory={inventory}
                  selectedGroup={null}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Location dialog */}
      <Dialog open={createLocationOpen} onOpenChange={setCreateLocationOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Location</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Label htmlFor="create-loc-name">Location Name</Label>
            <Input
              id="create-loc-name"
              value={createLocationName}
              onChange={(e) => setCreateLocationName(e.target.value)}
              placeholder="e.g. Warehouse A"
              data-testid="input-create-location-name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && createLocationName.trim()) {
                  createLocationMutation.mutate(createLocationName.trim());
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateLocationOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createLocationMutation.mutate(createLocationName.trim())}
              disabled={createLocationMutation.isPending || !createLocationName.trim()}
              data-testid="button-confirm-create-location"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* All other dialogs */}
      <LocationDialogs
        renameDialogOpen={renameDialogOpen}
        setRenameDialogOpen={setRenameDialogOpen}
        renamingLocation={renamingLocation}
        renameInput={renameInput}
        setRenameInput={setRenameInput}
        renameDeductionInput={renameDeductionInput}
        setRenameDeductionInput={setRenameDeductionInput}
        renameLocationMutation={renameLocationMutation}
        deleteDialogOpen={deleteDialogOpen}
        setDeleteDialogOpen={setDeleteDialogOpen}
        isDeleting={isDeleting}
        handleDeleteLocation={handleDeleteLocation}
        selectedLocationLocal={selectedLocationLocal}
        archiveDialogOpen={archiveDialogOpen}
        setArchiveDialogOpen={setArchiveDialogOpen}
        isArchiving={isArchiving}
        handleArchiveStockGroup={handleArchiveStockGroup}
        selectedGroup={selectedGroup}
        waGroupDialogOpen={waGroupDialogOpen}
        setWaGroupDialogOpen={setWaGroupDialogOpen}
        waChats={waChats}
        waChatsLoading={waChatsLoading}
        waGroupSearch={waGroupSearch}
        setWaGroupSearch={setWaGroupSearch}
        waGroupSelectedId={waGroupSelectedId}
        setWaGroupSelectedId={setWaGroupSelectedId}
        waGroupMutation={waGroupMutation}
        waGroupLocation={waGroupLocation}
        stockMovementOpen={stockMovementOpen}
        setStockMovementOpen={setStockMovementOpen}
        stockMovementItem={stockMovementItem}
        setStockMovementItem={setStockMovementItem}
        stockMovementPeriod={stockMovementPeriod}
        setStockMovementPeriod={setStockMovementPeriod}
        drillMonth={drillMonth}
        setDrillMonth={setDrillMonth}
        formatAmount={formatAmount}
        navigate={navigate}
      />
    </div>
  );
}
