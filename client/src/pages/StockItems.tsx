import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Package, Edit, FileSpreadsheet, Trash2, Download, PlusCircle, MinusCircle } from "lucide-react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import * as XLSX from "xlsx";

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
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<number | null | "uncategorized">(null);
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
      toast({
        title: "Error",
        description: error.message || "Failed to adjust stock",
        variant: "destructive",
      });
    },
  });

  const handleAdjustStock = () => {
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

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(filteredStockItems.map(item => item.id));
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

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    deleteMutation.mutate(selectedIds);
    setDeleteDialogOpen(false);
  };

  const handleStockItemClick = (stockItemId: number, stockItemName: string) => {
    setSelectedStockItemId(stockItemId);
    setSelectedStockItemName(stockItemName);
    setDetailsDialogOpen(true);
  };

  const handleEditClick = (stockItemId: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click from firing
    setEditStockItemId(stockItemId);
    setEditDialogOpen(true);
  };

  const filteredStockItems = stockItems
    .filter((item) => {
      // Filter by search term
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.barcode && item.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
      
      // Filter by stock group
      if (selectedGroupFilter === "uncategorized") {
        return matchesSearch && !item.stockGroupId;
      } else if (selectedGroupFilter !== null) {
        return matchesSearch && item.stockGroupId === selectedGroupFilter;
      }
      return matchesSearch;
    })
    .sort((a, b) => a.id - b.id); // Sort chronologically by ID

  const getStockGroupName = (stockGroupId: number | null) => {
    if (!stockGroupId) return "Uncategorized";
    const group = stockGroups.find(g => g.id === stockGroupId);
    return group ? group.name : "Unknown";
  };

  const allFilteredSelected = filteredStockItems.length > 0 && 
    filteredStockItems.every(item => selectedIds.includes(item.id));

  const exportToExcel = () => {
    const data = stockItems.map(item => ({
      Code: item.code,
      Name: item.name,
      Barcode: item.barcode || "",
      UOM: item.uom,
      "Stock Group": getStockGroupName(item.stockGroupId),
      "Selling Price": item.sellingPrice,
      Active: item.active ? "Yes" : "No",
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stock Items");
    XLSX.writeFile(workbook, "stock-items.xlsx");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock Items</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all stock items in your company
          </p>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <Button 
              variant="destructive" 
              className="gap-2" 
              onClick={handleDeleteClick}
              data-testid="button-delete-selected"
            >
              <Trash2 className="h-4 w-4" />
              Delete {selectedIds.length} {selectedIds.length === 1 ? 'Item' : 'Items'}
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => updateUOMMutation.mutate()}
            disabled={updateUOMMutation.isPending}
            data-testid="button-update-uom"
          >
            {updateUOMMutation.isPending ? "Converting..." : "Convert Bale to BL"}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={exportToExcel}
            data-testid="button-export-items"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setImportDialogOpen(true)}
            data-testid="button-import-data"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setAdjustDialogOpen(true)}
            data-testid="button-adjust-stock"
          >
            <Edit className="h-4 w-4" />
            Adjust Stock
          </Button>
          <Button 
            className="gap-2" 
            onClick={() => setCreateDialogOpen(true)}
            data-testid="button-add-item"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex gap-4 mb-4">
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
              setSelectedGroupFilter(val === "all" ? null : val === "uncategorized" ? "uncategorized" : parseInt(val));
            }}
            className="px-3 py-2 border rounded-md text-sm"
            data-testid="select-stock-group"
          >
            <option value="all">All Groups</option>
            <option value="uncategorized">Uncategorized</option>
            {stockGroups.map(group => (
              <option key={group.id} value={group.id}>{group.name}</option>
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
          <div className="rounded-md border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="h-12">
                  <th className="w-12 px-3">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={handleSelectAll}
                      data-testid="checkbox-select-all"
                    />
                  </th>
                  <th className="text-left px-3 font-medium">Name</th>
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
                          className="px-3 font-medium cursor-pointer" 
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
