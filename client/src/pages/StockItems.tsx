import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Package, Edit, FileSpreadsheet, Trash2, Download, PlusCircle, MinusCircle, ChevronDown, Settings } from "lucide-react";
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
import { utils, writeFile, readFile, ExcelJS } from "@/lib/excelHelper";

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
  sellingPrice: string;
  active: boolean;
  companyId: number;
}

interface StockGroup {
  id: number;
  code: string;
  name: string;
}

export default function StockItems() {
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideStockRates = (myErpPages?.hiddenErpCostFields ?? []).includes("stock_rates");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<number | null>(null);
  const [selectedStockItemId, setSelectedStockItemId] = useState<number | null>(null);
  const [selectedStockItemName, setSelectedStockItemName] = useState<string>("");
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editStockItemId, setEditStockItemId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
  // Manual stock adjustment dialog state
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustStockItemId, setAdjustStockItemId] = useState<string>("");
  const [adjustLocationId, setAdjustLocationId] = useState<string>("");
  const [adjustQuantity, setAdjustQuantity] = useState<string>("");
  const [adjustType, setAdjustType] = useState<"add" | "subtract">("add");

  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();

  const { data: stockItems = [], isLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups"],
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
      toast({
        title: "Success",
        description: data.message || "Stock items deleted successfully",
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to delete stock items",
        variant: "destructive",
      });
    },
  });

  const updateUOMMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/stock-items/bulk-update-uom", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stock-items"] });
      toast({
        title: "Success",
        description: data.message || "UOM updated successfully",
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update UOM",
        variant: "destructive",
      });
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
      toast({
        title: "Success",
        description: data.message || "Stock adjusted successfully",
      });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to adjust stock",
        variant: "destructive",
      });
    },
  });

  const handleAdjustStock = async () => {
    if (!adjustStockItemId || !adjustLocationId || !adjustQuantity) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }
    const qty = parseFloat(adjustQuantity);
    if (isNaN(qty) || qty <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid quantity greater than 0",
        variant: "destructive",
      });
      return;
    }
    adjustStockMutation.mutate({
      stockItemId: parseInt(adjustStockItemId),
      locationId: parseInt(adjustLocationId),
      quantity: qty,
      type: adjustType,
    });
  };

  const handleSelectAll = async (checked: boolean) => {
    if (checked) {
      setSelectedIds(filteredStockItems.map(item => item.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectItem = async (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds(prev => [...prev, id]);
    } else {
      setSelectedIds(prev => prev.filter(itemId => itemId !== id));
    }
  };

  const handleDeleteClick = async () => {
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    deleteMutation.mutate(selectedIds);
    setDeleteDialogOpen(false);
  };

  const handleStockItemClick = async (stockItemId: number, stockItemName: string) => {
    setSelectedStockItemId(stockItemId);
    setSelectedStockItemName(stockItemName);
    setDetailsDialogOpen(true);
  };

  const handleEditClick = async (stockItemId: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click from firing
    setEditStockItemId(stockItemId);
    setEditDialogOpen(true);
  };

  const filteredStockItems = stockItems
    .filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.barcode && item.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
      if (selectedGroupFilter !== null) {
        return matchesSearch && item.stockGroupId === selectedGroupFilter;
      }
      return matchesSearch;
    })
    .sort((a, b) => a.id - b.id);

  const unassignedItems = stockItems.filter(item => !item.stockGroupId);

  const getStockGroupName = (stockGroupId: number | null) => {
    if (!stockGroupId) return "— No Group —";
    const group = stockGroups.find(g => g.id === stockGroupId);
    return group ? group.name : "Unknown";
  };

  const allFilteredSelected = filteredStockItems.length > 0 && 
    filteredStockItems.every(item => selectedIds.includes(item.id));

  const exportSalesHistory = async () => {
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Exports require a connection", variant: "destructive" }); return; }
    try {
      const res = await fetch("/api/stock-items/last-sales-export", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch sales history");
      const rows: {
        stockItemId: number;
        itemCode: string;
        itemName: string;
        voucherNumber: string;
        voucherDate: string;
        locationName: string;
        quantity: string;
        rate: string;
        amount: string;
        rn: number;
      }[] = await res.json();

      if (rows.length === 0) {
        toast({ title: "No sales data", description: "No sales history found for any item." });
        return;
      }

      const data: Record<string, string>[] = [];
      let lastItemId: number | null = null;
      for (const row of rows) {
        if (lastItemId !== null && row.stockItemId !== lastItemId) {
          data.push({});
        }
        lastItemId = row.stockItemId;
        data.push({
          "Item Code": row.itemCode,
          "Item Name": row.itemName,
          "Sale #": String(row.rn),
          "Voucher No.": row.voucherNumber || "",
          "Date": row.voucherDate ? new Date(row.voucherDate).toLocaleDateString() : "",
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
    } catch (error) {
      toast({
        title: "Export failed",
        description: "Could not export sales history",
        variant: "destructive",
      });
    }
  };

  const exportToExcel = async () => {
    try {
      const res = await fetch("/api/stock-item-location-prices/all", { credentials: "include" });
      const locationPrices: { stockItemId: number; locationId: number; locationName: string; sellingPrice: string }[] = res.ok ? await res.json() : [];

      const costDubaiRes = await fetch("/api/stock-items/cost-dubai", { credentials: "include" });
      const costDubaiData: { stockItemId: number; costDubai: string }[] = costDubaiRes.ok ? await costDubaiRes.json() : [];
      const costDubaiMap = new Map<number, string>();
      for (const cd of costDubaiData) {
        costDubaiMap.set(cd.stockItemId, cd.costDubai);
      }

      const priceMap = new Map<number, Map<string, string>>();
      for (const lp of locationPrices) {
        if (!priceMap.has(lp.stockItemId)) priceMap.set(lp.stockItemId, new Map());
        priceMap.get(lp.stockItemId)!.set(lp.locationName, lp.sellingPrice);
      }

      const sortedLocations = locations.map(l => l.name).sort();

      const data = stockItems.map(item => {
        const costDubai = costDubaiMap.get(item.id);
        const defaultPrice = item.sellingPrice || "0";
        const row: Record<string, string> = {
          Code: item.code,
          Name: item.name,
          Barcode: item.barcode || "",
          UOM: item.uom,
          "Stock Group": getStockGroupName(item.stockGroupId),
          "Default Selling Price": formatAmount(defaultPrice),
          "Cost Dubai": costDubai ? formatAmount(costDubai) : "",
        };
        for (const loc of sortedLocations) {
          const locPrice = priceMap.get(item.id)?.get(loc);
          // Fall back to default selling price if no location-specific price set
          row[`Price - ${loc}`] = formatAmount(locPrice ?? defaultPrice);
        }
        row["Active"] = item.active ? "Yes" : "No";
        return row;
      });
      const worksheet = utils.json_to_sheet(data);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, "Stock Items");
      await writeFile(workbook, "stock-items.xlsx");
    } catch (error) {
      toast({
        title: "Export failed",
        description: "Could not export stock items",
        variant: "destructive",
      });
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
              <DropdownMenuItem onClick={() => setAdjustDialogOpen(true)} data-testid="menu-adjust-stock">
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
              placeholder="Search by name, code, or barcode..."
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
        </div>

        {!isLoading && unassignedItems.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
            <span className="font-medium">Warning:</span>
            <span>{unassignedItems.length} item{unassignedItems.length > 1 ? "s are" : " is"} not assigned to any Stock Group. Please edit {unassignedItems.length > 1 ? "them" : "it"} and assign a group.</span>
          </div>
        )}

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
                      checked={allFilteredSelected}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="text-left px-3 font-medium sticky left-0 bg-muted z-10">Name</th>
                  <th className="text-left px-3 font-medium">Stock Group</th>
                  <th className="text-left px-3 font-medium">Status</th>
                  <th className="text-center px-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStockItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      {searchTerm ? "No items found matching your search" : "No stock items found"}
                    </td>
                  </tr>
                ) : (
                  filteredStockItems.map((item) => {
                    const sellingPrice = parseFloat(item.sellingPrice || "0");
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
                checked={allFilteredSelected}
                onCheckedChange={handleSelectAll}
                data-testid="checkbox-select-all-mobile"
              />
              <span className="text-sm text-muted-foreground">Select All</span>
            </div>
            {filteredStockItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? "No items found matching your search" : "No stock items found"}
              </div>
            ) : (
              filteredStockItems.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <Card
                    key={item.id}
                    className="p-3"
                    data-testid={`card-stock-item-${item.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                          data-testid={`checkbox-mobile-${item.id}`}
                        />
                      </div>
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => handleStockItemClick(item.id, item.name)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate" data-testid={`name-mobile-${item.id}`}>
                            {item.name}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
                          <div>
                            <span className="text-muted-foreground">Code: </span>
                            <span>{item.code}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">UOM: </span>
                            <span>{item.uom}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Group: </span>
                            <span data-testid={`group-mobile-${item.id}`}>{getStockGroupName(item.stockGroupId)}</span>
                          </div>
                          {!hideStockRates && <div>
                            <span className="text-muted-foreground">Price: </span>
                            <span>{formatAmount(item.sellingPrice)}</span>
                          </div>}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <Badge variant={item.active ? "default" : "secondary"} data-testid={`status-mobile-${item.id}`}>
                            {item.active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => handleEditClick(item.id, e)}
                        data-testid={`button-edit-mobile-${item.id}`}
                        className="gap-1 shrink-0"
                      >
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

        {!isLoading && filteredStockItems.length > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {filteredStockItems.length} of {stockItems.length} items (Use Location Prices tab to set per-location prices)
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
                  {stockItems.map((item) => (
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
            <Button 
              variant="outline" 
              onClick={() => setAdjustDialogOpen(false)}
              data-testid="button-adjust-cancel"
            >
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
