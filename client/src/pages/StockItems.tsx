import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Package, Edit, FileSpreadsheet, Trash2, Download, PlusCircle, MinusCircle, ChevronDown, Settings, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { StockItemDetailsDialog } from "@/components/StockItemDetailsDialog";
import { StockItemEditDialog } from "@/components/StockItemEditDialog";
import { StockItemCreateDialog } from "@/components/StockItemCreateDialog";
import { CombinedImportDialog } from "@/components/CombinedImportDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { utils, writeFile } from "@/lib/excelHelper";

interface Location {
  id: number;
  code: string;
  name: string;
}

interface StockItem {
  id: number;
  code: string;
  name: string;
  barcode: string | null;
  uom: string;
  stockGroupId: number | null;
  gradeId: number | null;
  categoryId: number | null;
  sellingPrice: string;
  active: boolean;
  companyId: number;
}

interface StockGroup {
  id: number;
  code: string;
  name: string;
}

interface StockGrade {
  id: number;
  name: string;
  active: boolean;
}

interface StockCategory {
  id: number;
  name: string;
  active: boolean;
}

interface PagedStockItemsResponse {
  data: StockItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 100;

export default function StockItems() {
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideStockRates = (myErpPages?.hiddenErpCostFields ?? []).includes("stock_rates");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<number | null>(null);
  const [selectedGradeFilter, setSelectedGradeFilter] = useState<number | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<number | "none" | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedStockItemId, setSelectedStockItemId] = useState<number | null>(null);
  const [selectedStockItemName, setSelectedStockItemName] = useState<string>("");
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editStockItemId, setEditStockItemId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustStockItemId, setAdjustStockItemId] = useState<string>("");
  const [adjustLocationId, setAdjustLocationId] = useState<string>("");
  const [adjustQuantity, setAdjustQuantity] = useState<string>("");
  const [adjustType, setAdjustType] = useState<"add" | "subtract">("add");

  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();

  // Debounce search input by 300 ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [selectedGroupFilter, selectedGradeFilter, selectedCategoryFilter]);

  // Paginated query — drives the main table
  const pagedQueryKey = [
    "/api/stock-items",
    { page: currentPage, pageSize: PAGE_SIZE, search: debouncedSearch, stockGroupId: selectedGroupFilter, gradeId: selectedGradeFilter, categoryId: selectedCategoryFilter },
  ];
  const { data: pagedData, isLoading } = useQuery<PagedStockItemsResponse>({
    queryKey: pagedQueryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (selectedGroupFilter !== null) params.set("stockGroupId", String(selectedGroupFilter));
      if (selectedGradeFilter !== null) params.set("gradeId", String(selectedGradeFilter));
      if (selectedCategoryFilter !== null) params.set("categoryId", String(selectedCategoryFilter));
      const res = await fetch(`/api/stock-items?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stock items");
      return res.json();
    },
  });

  const displayItems: StockItem[] = pagedData?.data ?? [];
  const totalItems = pagedData?.total ?? 0;
  const totalPages = pagedData?.totalPages ?? 1;

  // Flat (all items) query — used only by adjust-stock dialog dropdown and export
  const { data: allStockItems = [], refetch: refetchAllItems } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups"],
  });

  const { data: stockGrades = [] } = useQuery<StockGrade[]>({
    queryKey: ["/api/stock-grades"],
  });

  const { data: stockCategories = [] } = useQuery<StockCategory[]>({
    queryKey: ["/api/stock-categories"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      return await apiRequest("POST", "/api/stock-items/bulk-delete", { ids });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setSelectedIds([]);
      toast({ title: "Success", description: data.message || "Stock items deleted successfully" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete stock items", variant: "destructive" });
    },
  });


  const adjustStockMutation = useMutation({
    mutationFn: async (data: { stockItemId: number; locationId: number; quantity: number; type: "add" | "subtract" }) => {
      return await apiRequest("POST", "/api/inventory/quick-adjust", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      setAdjustDialogOpen(false);
      setAdjustStockItemId("");
      setAdjustLocationId("");
      setAdjustQuantity("");
      setAdjustType("add");
      toast({ title: "Success", description: data.message || "Stock adjusted successfully" });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to adjust stock", variant: "destructive" });
    },
  });

  const handleAdjustStock = async () => {
    if (!adjustStockItemId || !adjustLocationId || !adjustQuantity) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    const qty = parseFloat(adjustQuantity);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Error", description: "Please enter a valid quantity greater than 0", variant: "destructive" });
      return;
    }
    adjustStockMutation.mutate({
      stockItemId: parseInt(adjustStockItemId),
      locationId: parseInt(adjustLocationId),
      quantity: qty,
      type: adjustType,
    });
  };

  const handleOpenAdjustDialog = () => {
    refetchAllItems();
    setAdjustDialogOpen(true);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(displayItems.map(item => item.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectItem = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(itemId => itemId !== id));
    }
  };

  const handleDeleteClick = () => { setDeleteDialogOpen(true); };
  const handleConfirmDelete = () => { deleteMutation.mutate(selectedIds); setDeleteDialogOpen(false); };

  const handleStockItemClick = (stockItemId: number, stockItemName: string) => {
    setSelectedStockItemId(stockItemId);
    setSelectedStockItemName(stockItemName);
    setDetailsDialogOpen(true);
  };

  const handleEditClick = (stockItemId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditStockItemId(stockItemId);
    setEditDialogOpen(true);
  };

  const allPageSelected = displayItems.length > 0 && displayItems.every(item => selectedIds.includes(item.id));

  const getStockGroupName = (stockGroupId: number | null) => {
    if (!stockGroupId) return "— No Group —";
    const group = stockGroups.find(g => g.id === stockGroupId);
    return group ? group.name : "Unknown";
  };

  const getGradeName = (gradeId: number | null) => {
    if (!gradeId) return null;
    const grade = stockGrades.find(g => g.id === gradeId);
    return grade ? grade.name : null;
  };

  const getCategoryName = (categoryId: number | null) => {
    if (!categoryId) return null;
    const cat = stockCategories.find(c => c.id === categoryId);
    return cat ? cat.name : null;
  };

  const exportSalesHistory = async () => {
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const res = await fetch("/api/stock-items/last-sales-export", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sales history");
      const rows: {
        stockItemId: number; itemCode: string; itemName: string; voucherNumber: string;
        voucherDate: string; locationName: string; quantity: string; rate: string; amount: string; rn: number;
      }[] = await res.json();
      if (rows.length === 0) { toast({ title: "No sales data", description: "No sales history found for any item." }); return; }
      const data: Record<string, string>[] = [];
      let lastItemId: number | null = null;
      for (const row of rows) {
        if (lastItemId !== null && row.stockItemId !== lastItemId) data.push({});
        lastItemId = row.stockItemId;
        data.push({
          "Item Code": row.itemCode, "Item Name": row.itemName, "Sale #": String(row.rn),
          "Voucher No.": row.voucherNumber || "", "Date": row.voucherDate ? new Date(row.voucherDate).toLocaleDateString() : "",
          "Location": row.locationName || "",
          "Qty": row.quantity ? parseFloat(row.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "",
          "Rate": row.rate ? parseFloat(row.rate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
          "Amount": row.amount ? parseFloat(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
        });
      }
      const worksheet = utils.json_to_sheet(data);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Sales History");
      await writeFile(workbook, "stock-items-sales-history.xlsx");
    } catch {
      toast({ title: "Export failed", description: "Could not export sales history", variant: "destructive" });
    }
  };

  const exportToExcel = async () => {
    try {
      // Fetch all items explicitly for export (not limited to current page)
      const [allRes, pricesRes, costDubaiRes] = await Promise.all([
        fetch("/api/stock-items", { credentials: "include" }),
        fetch("/api/stock-item-location-prices/all", { credentials: "include" }),
        fetch("/api/stock-items/cost-dubai", { credentials: "include" }),
      ]);
      const allItems: StockItem[] = allRes.ok ? await allRes.json() : [];
      const locationPrices: { stockItemId: number; locationId: number; locationName: string; sellingPrice: string }[] = pricesRes.ok ? await pricesRes.json() : [];
      const costDubaiData: { stockItemId: number; costDubai: string }[] = costDubaiRes.ok ? await costDubaiRes.json() : [];
      const costDubaiMap = new Map<number, string>();
      for (const cd of costDubaiData) costDubaiMap.set(cd.stockItemId, cd.costDubai);
      const priceMap = new Map<number, Map<string, string>>();
      for (const lp of locationPrices) {
        if (!priceMap.has(lp.stockItemId)) priceMap.set(lp.stockItemId, new Map());
        priceMap.get(lp.stockItemId)!.set(lp.locationName, lp.sellingPrice);
      }
      const sortedLocations = locations.map(l => l.name).sort();
      const data = allItems.map(item => {
        const costDubai = costDubaiMap.get(item.id);
        const defaultPrice = item.sellingPrice || "0";
        const row: Record<string, string> = {
          Code: item.code, Name: item.name, Barcode: item.barcode || "", UOM: item.uom,
          "Stock Group": getStockGroupName(item.stockGroupId),
          "Grade": getGradeName(item.gradeId) || "",
          "Category": getCategoryName(item.categoryId) || "",
          "Default Selling Price": formatAmount(defaultPrice),
          "Cost Dubai": costDubai ? formatAmount(costDubai) : "",
        };
        for (const loc of sortedLocations) {
          const locPrice = priceMap.get(item.id)?.get(loc);
          row[`Price - ${loc}`] = formatAmount(locPrice ?? defaultPrice);
        }
        row["Active"] = item.active ? "Yes" : "No";
        return row;
      });
      const worksheet = utils.json_to_sheet(data);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Items");
      await writeFile(workbook, "stock-items.xlsx");
    } catch {
      toast({ title: "Export failed", description: "Could not export stock items", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Items"
        subtitle="Manage all stock items in your company"
      >
        <div className="flex flex-wrap gap-2">
          {selectedIds.length > 0 && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={handleDeleteClick}
              data-testid="button-delete-selected"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Delete</span> {selectedIds.length} {selectedIds.length === 1 ? 'Item' : 'Items'}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-manage-dropdown">
                <Settings className="h-4 w-4" />
                Manage
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCreateDialogOpen(true)} data-testid="menu-add-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportDialogOpen(true)} data-testid="menu-import">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleOpenAdjustDialog} data-testid="menu-adjust-stock">
                <Edit className="h-4 w-4 mr-2" />
                Adjust Stock
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToExcel} data-testid="menu-export">
                <Download className="h-4 w-4 mr-2" />
                Export Stock Items
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportSalesHistory} data-testid="menu-export-sales-history">
                <Download className="h-4 w-4 mr-2" />
                Export Sales History
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageHeader>

      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          <select
            value={selectedGroupFilter === null ? "all" : selectedGroupFilter}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedGroupFilter(val === "all" ? null : parseInt(val));
            }}
            className="w-full md:w-auto px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground"
            data-testid="select-stock-group"
          >
            <option value="all">All Groups</option>
            {stockGroups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
          <select
            value={selectedCategoryFilter === null ? "all" : selectedCategoryFilter}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedCategoryFilter(val === "all" ? null : val === "none" ? "none" : parseInt(val));
            }}
            className="w-full md:w-auto px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground"
            data-testid="select-category-filter"
          >
            <option value="all">All Categories</option>
            <option value="none">No Category</option>
            {stockCategories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
          <div className="hidden md:block rounded-md border overflow-hidden table-responsive">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-30">
                <tr className="h-12">
                  <th className="w-12 px-3">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="text-left px-3 font-medium sticky left-0 bg-muted z-10">Name</th>
                  <th className="text-left px-3 font-medium">Stock Group</th>
                  {stockCategories.length > 0 && <th className="text-left px-3 font-medium">Category</th>}
                  <th className="text-left px-3 font-medium">Status</th>
                  <th className="text-center px-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.length === 0 ? (
                  <tr>
                    <td colSpan={5 + (stockCategories.length > 0 ? 1 : 0)} className="text-center py-8 text-muted-foreground">
                      {debouncedSearch ? "No items found matching your search" : "No stock items found"}
                    </td>
                  </tr>
                ) : (
                  displayItems.map((item) => {
                    const isSelected = selectedIds.includes(item.id);
                    return (
                      <tr
                        key={item.id}
                        className="border-t hover-elevate h-12"
                        data-testid={`row-stock-item-${item.id}`}
                      >
                        <td className="px-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                            data-testid={`checkbox-${item.id}`}
                          />
                        </td>
                        <td
                          className="px-3 font-medium cursor-pointer sticky left-0 bg-background z-10"
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`name-${item.id}`}
                        >
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {item.name}
                          </div>
                        </td>
                        <td
                          className="px-3 text-sm cursor-pointer"
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`group-${item.id}`}
                        >
                          {getStockGroupName(item.stockGroupId)}
                        </td>
                        {stockCategories.length > 0 && (
                          <td
                            className="px-3 text-sm cursor-pointer"
                            onClick={() => handleStockItemClick(item.id, item.name)}
                            data-testid={`category-${item.id}`}
                          >
                            {getCategoryName(item.categoryId) ? (
                              <Badge variant="secondary" className="text-xs">{getCategoryName(item.categoryId)}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        )}
                        <td
                          className="px-3 cursor-pointer"
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`status-${item.id}`}
                        >
                          <Badge variant={item.active ? "default" : "secondary"}>
                            {item.active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-3 text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleEditClick(item.id, e)}
                            data-testid={`button-edit-${item.id}`}
                            className="gap-2"
                          >
                            <Edit className="h-4 w-4" />
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox
                checked={allPageSelected}
                onCheckedChange={handleSelectAll}
                data-testid="checkbox-select-all-mobile"
              />
              <span className="text-sm text-muted-foreground">Select All</span>
            </div>
            {displayItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {debouncedSearch ? "No items found matching your search" : "No stock items found"}
              </div>
            ) : (
              displayItems.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <Card key={item.id} className="p-3" data-testid={`card-stock-item-${item.id}`}>
                    <div className="flex items-start gap-3">
                      <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                          data-testid={`checkbox-mobile-${item.id}`}
                        />
                      </div>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleStockItemClick(item.id, item.name)}>
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate" data-testid={`name-mobile-${item.id}`}>{item.name}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
                          <div><span className="text-muted-foreground">Code: </span><span>{item.code}</span></div>
                          <div><span className="text-muted-foreground">UOM: </span><span>{item.uom}</span></div>
                          <div><span className="text-muted-foreground">Group: </span><span data-testid={`group-mobile-${item.id}`}>{getStockGroupName(item.stockGroupId)}</span></div>
                          {!hideStockRates && <div><span className="text-muted-foreground">Price: </span><span>{formatAmount(item.sellingPrice)}</span></div>}
                          {stockCategories.length > 0 && getCategoryName(item.categoryId) && (
                            <div><span className="text-muted-foreground">Category: </span><span data-testid={`category-mobile-${item.id}`}>{getCategoryName(item.categoryId)}</span></div>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <Badge variant={item.active ? "default" : "secondary"} data-testid={`status-mobile-${item.id}`}>
                            {item.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={(e) => handleEditClick(item.id, e)} data-testid={`button-edit-mobile-${item.id}`} className="gap-1 shrink-0">
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
          </>
        )}

        {/* Pagination controls */}
        {!isLoading && totalItems > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, totalItems)} of {totalItems} items
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 py-1 text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {selectedStockItemId && (
        <StockItemDetailsDialog
          open={detailsDialogOpen}
          onOpenChange={setDetailsDialogOpen}
          stockItemId={selectedStockItemId}
          stockItemName={selectedStockItemName}
        />
      )}

      <StockItemEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        stockItemId={editStockItemId}
      />

      <StockItemCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <CombinedImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.length} stock {selectedIds.length === 1 ? 'item' : 'items'}?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent data-testid="dialog-adjust-stock">
          <DialogHeader>
            <DialogTitle>Adjust Stock Manually</DialogTitle>
            <DialogDescription>
              Add or subtract quantity from a stock item at a specific location
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Stock Item</Label>
              <Select value={adjustStockItemId} onValueChange={setAdjustStockItemId}>
                <SelectTrigger data-testid="select-adjust-stock-item">
                  <SelectValue placeholder="Select stock item..." />
                </SelectTrigger>
                <SelectContent>
                  {allStockItems.map((item) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.code} - {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={adjustLocationId} onValueChange={setAdjustLocationId}>
                <SelectTrigger data-testid="select-adjust-location">
                  <SelectValue placeholder="Select location..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.code} - {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={adjustType === "add" ? "default" : "outline"}
                  className="flex-1 gap-2"
                  onClick={() => setAdjustType("add")}
                  data-testid="button-adjust-add"
                >
                  <PlusCircle className="h-4 w-4" />
                  Add (+)
                </Button>
                <Button
                  type="button"
                  variant={adjustType === "subtract" ? "destructive" : "outline"}
                  className="flex-1 gap-2"
                  onClick={() => setAdjustType("subtract")}
                  data-testid="button-adjust-subtract"
                >
                  <MinusCircle className="h-4 w-4" />
                  Subtract (-)
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={adjustQuantity}
                onChange={(e) => setAdjustQuantity(e.target.value)}
                placeholder="Enter quantity..."
                data-testid="input-adjust-quantity"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)} data-testid="button-adjust-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleAdjustStock}
              disabled={adjustStockMutation.isPending}
              data-testid="button-adjust-confirm"
            >
              {adjustStockMutation.isPending ? "Adjusting..." : `${adjustType === "add" ? "Add" : "Subtract"} Stock`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
