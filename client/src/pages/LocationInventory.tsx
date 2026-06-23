import { useState, useEffect, useRef, useMemo } from "react";
import { useCursorNav } from "@/contexts/CursorNavContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "@/contexts/LocationContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useLocation as useRoute } from "wouter";
import { cn } from "@/lib/utils";
import { ArrowUpDown, Package, Warehouse, Search, X, ChevronDown, Download, List, Eye, Printer, ShoppingCart, Trash2, ArrowLeft, ArrowRight, Layers, FileSpreadsheet, MessageCircle, Pencil, AlertCircle, Globe } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useReactToPrint } from "react-to-print";
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
  inventoryId: number;
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
  const { registerCursorNav, clearCursorNav } = useCursorNav();
  const [viewAllItems, setViewAllItems] = useState<boolean>(false);
  const [printWithCost, setPrintWithCost] = useState<boolean>(false);
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
  const tableRef = useRef<HTMLDivElement>(null);

  const [allStockSelectedRowIndex, setAllStockSelectedRowIndex] = useState<number>(-1);
  const [stockMovementOpen, setStockMovementOpen] = useState(false);
  const [stockMovementItem, setStockMovementItem] = useState<any>(null);
  const [stockMovementPeriod, setStockMovementPeriod] = useState<any>(() => getDefaultPeriodValue("this_month"));
  const [drillMonth, setDrillMonth] = useState<any>(null);
  const allStockTableRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { setSelectedLocation } = useLocation();
  const [_route, navigate] = useRoute();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const isSpCompany = selectedCompany?.companyType === "supplier_partner";

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

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `${(selectedLocationLocal?.name || "Stock").replace(/\s+/g, "_")}_STK_${new Date().toLocaleDateString('en-CA')}`,
  });

  const handlePrintWithOption = async (withCost: boolean) => {
    setPrintWithCost(withCost);
    setViewAllItems(true);
    setTimeout(() => handlePrint(), 150);
  };

  const renameLocationMutation = useMutation({
    mutationFn: async ({ id, name, supplierPartnerPayableDeductionPerQty }: { id: number; name: string; supplierPartnerPayableDeductionPerQty?: number }) => {
      const payload: Record<string, any> = { name };
      if (supplierPartnerPayableDeductionPerQty !== undefined) {
        payload.supplierPartnerPayableDeductionPerQty = supplierPartnerPayableDeductionPerQty;
      }
      const res = await apiRequest("PATCH", `/api/locations/${id}`, payload);
      return res.json();
    },
    onSuccess: (updated) => {
      toast({ title: "Location renamed", description: `Renamed to "${updated.name}".` });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      if (selectedLocationLocal?.id === updated.id) setSelectedLocationLocal(updated);
      setRenameDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openRenameDialog = (loc: Location, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setRenamingLocation(loc);
    setRenameInput(loc.name);
    setRenameDeductionInput(parseFloat(String(loc.supplierPartnerPayableDeductionPerQty ?? "0")).toString());
    setRenameDialogOpen(true);
  };

  const { data: waChats = [], isLoading: waChatsLoading } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    enabled: waGroupDialogOpen,
    staleTime: 60_000,
  });

  const waGroupMutation = useMutation({
    mutationFn: async ({ id, name, whatsappGroupChatId }: { id: number; name: string; whatsappGroupChatId: string | null }) => {
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

  const openWaGroupDialog = (loc: Location, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setWaGroupLocation(loc);
    setWaGroupSelectedId((loc as any).whatsappGroupChatId ?? "");
    setWaGroupSearch("");
    setWaGroupDialogOpen(true);
  };

  const { data: allLocations = [], isLoading: allLocationsLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
    enabled: !posUser,
    staleTime: 5 * 60 * 1000,
  });

  const { data: posAssignedLocations = [], isLoading: posLocationsLoading } = useQuery<Location[]>({
    queryKey: posUser ? ["/api/my-locations"] : [],
    enabled: !!posUser,
  });

  const locations = posUser ? posAssignedLocations : allLocations;
  const locationsLoading = posUser ? posLocationsLoading : allLocationsLoading;

  const { data: inventoryData = [], isLoading: inventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal ? [`/api/locations/${selectedLocationLocal.id}/inventory`] : [],
    enabled: !!selectedLocationLocal,
  });

  const { data: openingInventoryData = [], isLoading: openingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal && fromDate ? [`/api/locations/${selectedLocationLocal.id}/inventory?asOfDate=${fromDate}`] : [],
    enabled: !!selectedLocationLocal && !!fromDate,
  });

  const { data: closingInventoryData = [], isLoading: closingInventoryLoading } = useQuery<InventoryItem[]>({
    queryKey: selectedLocationLocal && asOfDate ? [`/api/locations/${selectedLocationLocal.id}/inventory?asOfDate=${asOfDate}`] : [],
    enabled: !!selectedLocationLocal && !!asOfDate,
  });

  const { data: allInventoryData = [], isLoading: allInventoryLoading } = useQuery<any[]>({
    queryKey: ["/api/inventory"],
    enabled: showAllStock,
    staleTime: 30000,
  });

  const { data: categoriesList = [] } = useQuery<{ id: number; name: string; active: boolean }[]>({
    queryKey: ["/api/stock-categories"],
    staleTime: 5 * 60 * 1000,
  });

  const allInventoryLocations = useMemo(() => {
    const locs = new Map<number, { id: number; name: string }>();
    allInventoryData.forEach((item: any) => {
      if (item.locationId && !locs.has(item.locationId)) locs.set(item.locationId, { id: item.locationId, name: item.locationName || "" });
    });
    return [...locs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allInventoryData]);

  const allInventoryGroups = useMemo(() => {
    const groups = new Map<string, { id: number | null; name: string }>();
    allInventoryData.forEach((item: any) => {
      const key = String(item.stockGroupId ?? "null");
      if (!groups.has(key)) groups.set(key, { id: item.stockGroupId ?? null, name: item.stockGroupName || "Unassigned" });
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
    return [...itemMap.values()].map((row) => ({ ...row, avgCost: row.totalQty > 0 ? row.weightedCostSum / row.totalQty : 0 }));
  }, [allInventoryData]);

  const filteredCombinedRows = useMemo(() => {
    return combinedStockRows.filter((row) => {
      if (allStockGroupFilter) {
        if (allStockGroupFilter === "null") { if (row.stockGroupId !== null) return false; }
        else { if (String(row.stockGroupId) !== allStockGroupFilter) return false; }
      }
      if (allStockCategoryFilter.length > 0) {
        const rowCatId = row.categoryId == null ? "none" : String(row.categoryId);
        if (!allStockCategoryFilter.includes(rowCatId)) return false;
      }
      if (allStockLocationFilter) {
        const locId = parseInt(allStockLocationFilter, 10);
        if ((row.qtyByLocation[locId] || 0) === 0) return false;
      }
      if (allStockSearchTerm) {
        const s = allStockSearchTerm.toLowerCase();
        return row.stockItemName.toLowerCase().includes(s) || row.stockItemCode.toLowerCase().includes(s);
      }
      return true;
    }).sort((a, b) => a.stockGroupName.localeCompare(b.stockGroupName) || a.stockItemName.localeCompare(b.stockItemName));
  }, [combinedStockRows, allStockGroupFilter, allStockCategoryFilter, allStockLocationFilter, allStockSearchTerm]);

  const openingInventoryMap = useMemo(() => {
    const map = new Map<number, number>();
    openingInventoryData.forEach((item: InventoryItem) => map.set(item.stockItemId, parseFloat(item.quantity || "0")));
    return map;
  }, [openingInventoryData]);

  const showMovement = !!(fromDate && asOfDate);
  const activeInventoryData = showMovement ? closingInventoryData : inventoryData;
  const activeInventoryLoading = showMovement ? (closingInventoryLoading || openingInventoryLoading) : inventoryLoading;
  const inventory = showZeroStock ? activeInventoryData : activeInventoryData.filter(item => parseFloat(item.quantity || "0") !== 0);

  const stockGroups: StockGroupSummary[] = inventory
    .reduce((groups, item) => {
      const groupId = item.stockGroupId ?? null;
      let group = groups.find(g => g.groupId === groupId);
      if (!group) {
        group = { groupId, groupCode: item.stockGroupCode, groupName: item.stockGroupName || "Ungrouped", totalQuantity: 0, totalValue: 0, averageRate: 0, itemCount: 0, items: [] };
        groups.push(group);
      }
      const qty = parseFloat(item.quantity || "0");
      group.totalQuantity += qty;
      group.totalValue += parseFloat(item.totalValue || "0");
      group.itemCount += 1;
      group.items.push(item);
      return groups;
    }, [] as StockGroupSummary[]);

  stockGroups.forEach(g => { if (g.totalQuantity > 0) g.averageRate = g.totalValue / g.totalQuantity; });
  const filteredStockGroups = stockGroups.filter(g => !groupSearchTerm || g.groupName.toLowerCase().includes(groupSearchTerm.toLowerCase())).sort((a, b) => a.groupName.localeCompare(b.groupName));

  const filteredStockItems = useMemo(() => {
    if (!selectedGroup) return [];
    return selectedGroup.items.filter(item => {
      if (itemCategoryFilter.length > 0) {
        const itemCatId = item.categoryId == null ? "none" : String(item.categoryId);
        if (!itemCategoryFilter.includes(itemCatId)) return false;
      }
      if (!itemSearchTerm) return true;
      const s = itemSearchTerm.toLowerCase();
      return (item.stockItemName || "").toLowerCase().includes(s) || (item.stockItemCode || "").toLowerCase().includes(s);
    }).sort((a, b) => a.stockItemName.localeCompare(b.stockItemName));
  }, [selectedGroup, itemSearchTerm, itemCategoryFilter]);

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
    } finally { setIsDeleting(false); }
  };

  const handleArchiveStockGroup = async () => {
    if (!selectedLocationLocal || !selectedGroup) return;
    setIsArchiving(true);
    try {
      await apiRequest("POST", "/api/stock-group-archives", { locationId: selectedLocationLocal.id, stockGroupId: selectedGroup.groupId });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Stock Group Archived" });
      setSelectedGroup(null);
      setArchiveDialogOpen(false);
    } catch (error: any) {
      toast({ title: "Archive Failed", description: error.message, variant: "destructive" });
    } finally { setIsArchiving(false); }
  };

  const handleExportInventory = async () => {
    if (!selectedLocationLocal) return;
    try {
      const response = await fetch(`/api/locations/${selectedLocationLocal.id}/inventory/export`, { credentials: 'include' });
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedLocationLocal.name}_inventory_${new Date().toLocaleDateString('en-CA')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      toast({ title: "Export Successful" });
    } catch (error: any) { toast({ title: "Export Failed", description: error.message, variant: "destructive" }); }
  };

  const handleUseLocation = (loc: Location) => {
    setSelectedLocation({ id: loc.id, name: loc.name });
    navigate("/pos");
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6 p-3 md:p-6 w-full min-w-0">
      <PageHeader title="Location Inventory" subtitle="Manage inventory across all locations">
        {!posUser && (
          <Button variant={showAllStock ? "default" : "outline"} size="sm" onClick={() => setShowAllStock(!showAllStock)} className="gap-2">
            <Globe className="h-4 w-4" /> All Locations View
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-md bg-muted/30 border">
        <div className="flex items-center gap-1.5 shrink-0 mr-1"><ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Movement</span></div>
        <div className="h-4 w-px bg-border shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-32 text-xs" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-8 w-32 text-xs" />
          {(fromDate || asOfDate) && <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setAsOfDate(""); }} className="h-8 px-2 text-xs"><X className="h-3 w-3 mr-1" /> Clear</Button>}
        </div>
      </div>

      {!showAllStock ? (
        <>
          <LocationGrid locations={locations} locationsLoading={locationsLoading} selectedLocationLocal={selectedLocationLocal} setSelectedLocationLocal={(loc) => setSelectedLocationLocal(loc as Location | null)} locationSearchTerm={locationSearchTerm} setLocationSearchTerm={setLocationSearchTerm} posUser={posUser} />
          {selectedLocationLocal && !selectedGroup && !viewAllItems && (
            <div>
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Warehouse className="h-5 w-5 text-primary" /></div>
                  <div><div className="flex items-center gap-2"><h1 className="text-xl md:text-2xl font-bold">{selectedLocationLocal.name}</h1>{!posUser && <Button variant="ghost" size="icon" onClick={() => openRenameDialog(selectedLocationLocal)}><Pencil className="h-4 w-4" /></Button>}</div><p className="text-xs text-muted-foreground uppercase">Stock Groups</p></div>
                </div>
                <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
                  <Button variant="outline" onClick={handleExportInventory} className="gap-2"><Download className="w-4 h-4" /> Export</Button>
                  <Button variant="outline" onClick={() => setViewAllItems(true)} className="gap-2"><List className="w-4 h-4" /> View All</Button>
                  <Button variant={showZeroStock ? "default" : "outline"} onClick={() => setShowZeroStock(!showZeroStock)} className="gap-2"><Eye className="w-4 h-4" /> Zero</Button>
                  {!posUser && <Button variant="destructive" onClick={() => setDeleteDialogOpen(true)} className="gap-2"><Trash2 className="w-4 h-4" /> Delete</Button>}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeInventoryLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-xl border bg-card animate-pulse" />
                  ))
                ) : filteredStockGroups.length === 0 ? (
                  <div className="col-span-full py-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
                    {showZeroStock ? "No stock items found for this location." : "No items with stock. Toggle 'Zero' to see all items."}
                  </div>
                ) : (
                  filteredStockGroups.map(g => (
                    <Card key={g.groupId} className="hover-elevate cursor-pointer" onClick={() => setSelectedGroup(g)}>
                      <CardContent className="p-4"><h3 className="font-bold">{g.groupName}</h3><p className="text-sm text-muted-foreground">{g.itemCount} Items · {Math.floor(g.totalQuantity)} BL</p></CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          )}
          {selectedGroup && (
            <div className="space-y-4">
              <div className="flex items-center justify-between"><Button variant="ghost" onClick={() => setSelectedGroup(null)}><ArrowLeft className="mr-2 h-4 w-4" /> Back to groups</Button><h2 className="text-xl font-bold">{selectedGroup.groupName}</h2></div>
              <InventoryTable filteredStockItems={filteredStockItems} showMovement={showMovement} openingInventoryMap={openingInventoryMap} selectedRowIndex={selectedRowIndex} setSelectedRowIndex={setSelectedRowIndex} navigate={navigate} formatAmount={formatAmount} posUser={posUser} itemSearchTerm={itemSearchTerm} inventory={inventory} selectedGroup={selectedGroup} />
            </div>
          )}
        </>
      ) : (
        <CombinedStockView allInventoryLoading={allInventoryLoading} filteredCombinedRows={filteredCombinedRows} allInventoryData={allInventoryData} allInventoryLocations={allInventoryLocations} allInventoryGroups={allInventoryGroups} categoriesList={categoriesList} allStockSearchTerm={allStockSearchTerm} setAllStockSearchTerm={setAllStockSearchTerm} allStockGroupFilter={allStockGroupFilter} setAllStockGroupFilter={setAllStockGroupFilter} allStockLocationFilter={allStockLocationFilter} setAllStockLocationFilter={setAllStockLocationFilter} allStockCategoryFilter={allStockCategoryFilter} setAllStockCategoryFilter={setAllStockCategoryFilter} allStockSelectedRowIndex={allStockSelectedRowIndex} openMovement={(l, n, e) => { setStockMovementItem({ stockItemId: 0, stockItemName: "", locationId: l, locationName: n }); setStockMovementOpen(true); }} formatAmount={formatAmount} posUser={posUser} allStockTableRef={allStockTableRef} />
      )}

      <LocationDialogs renameDialogOpen={renameDialogOpen} setRenameDialogOpen={setRenameDialogOpen} renamingLocation={renamingLocation} renameInput={renameInput} setRenameInput={setRenameInput} renameDeductionInput={renameDeductionInput} setRenameDeductionInput={setRenameDeductionInput} renameLocationMutation={renameLocationMutation} deleteDialogOpen={deleteDialogOpen} setDeleteDialogOpen={setDeleteDialogOpen} isDeleting={isDeleting} handleDeleteLocation={handleDeleteLocation} selectedLocationLocal={selectedLocationLocal} archiveDialogOpen={archiveDialogOpen} setArchiveDialogOpen={setArchiveDialogOpen} isArchiving={isArchiving} handleArchiveStockGroup={handleArchiveStockGroup} selectedGroup={selectedGroup} waGroupDialogOpen={waGroupDialogOpen} setWaGroupDialogOpen={setWaGroupDialogOpen} waChats={waChats} waChatsLoading={waChatsLoading} waGroupSearch={waGroupSearch} setWaGroupSearch={setWaGroupSearch} waGroupSelectedId={waGroupSelectedId} setWaGroupSelectedId={setWaGroupSelectedId} waGroupMutation={waGroupMutation} waGroupLocation={waGroupLocation} stockMovementOpen={stockMovementOpen} setStockMovementOpen={setStockMovementOpen} stockMovementItem={stockMovementItem} setStockMovementItem={setStockMovementItem} stockMovementPeriod={stockMovementPeriod} setStockMovementPeriod={setStockMovementPeriod} drillMonth={drillMonth} setDrillMonth={setDrillMonth} formatAmount={formatAmount} navigate={navigate} />
    </div>
  );
}
