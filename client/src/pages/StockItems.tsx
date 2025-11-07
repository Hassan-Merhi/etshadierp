import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Package, Edit, FileSpreadsheet, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StockItemDetailsDialog } from "@/components/StockItemDetailsDialog";
import { StockItemEditDialog } from "@/components/StockItemEditDialog";
import { StockItemCreateDialog } from "@/components/StockItemCreateDialog";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  const [selectedStockItemId, setSelectedStockItemId] = useState<number | null>(null);
  const [selectedStockItemName, setSelectedStockItemName] = useState<string>("");
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editStockItemId, setEditStockItemId] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { toast } = useToast();

  const { data: stockItems = [], isLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups"],
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

  const filteredStockItems = stockItems.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.barcode && item.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStockGroupName = (stockGroupId: number | null) => {
    if (!stockGroupId) return "Uncategorized";
    const group = stockGroups.find(g => g.id === stockGroupId);
    return group ? `${group.code} - ${group.name}` : "Unknown";
  };

  const allFilteredSelected = filteredStockItems.length > 0 && 
    filteredStockItems.every(item => selectedIds.includes(item.id));

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
          <Link href="/import-stock-items">
            <Button variant="outline" className="gap-2" data-testid="button-import-items">
              <FileSpreadsheet className="h-4 w-4" />
              Import Items
            </Button>
          </Link>
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
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search by name, code, or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
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
                  <th className="text-right px-3 font-medium">Selling Price</th>
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
                          className="px-3 text-right font-mono cursor-pointer" 
                          onClick={() => handleStockItemClick(item.id, item.name)}
                          data-testid={`price-${item.id}`}
                        >
                          ${sellingPrice.toFixed(2)}
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
            Showing {filteredStockItems.length} of {stockItems.length} items
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
    </div>
  );
}
