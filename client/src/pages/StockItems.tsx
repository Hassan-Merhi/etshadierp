import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StockItemDetailsDialog } from "@/components/StockItemDetailsDialog";

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

  const { data: stockItems = [], isLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups"],
  });

  const handleStockItemClick = (stockItemId: number, stockItemName: string) => {
    setSelectedStockItemId(stockItemId);
    setSelectedStockItemName(stockItemName);
    setDetailsDialogOpen(true);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock Items</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all stock items in your company
          </p>
        </div>
        <Button className="gap-2" data-testid="button-add-item">
          <Plus className="h-4 w-4" />
          Add Item
        </Button>
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
                  <th className="text-left px-4 font-medium">Code</th>
                  <th className="text-left px-4 font-medium">Name</th>
                  <th className="text-left px-4 font-medium">Barcode</th>
                  <th className="text-left px-4 font-medium">Stock Group</th>
                  <th className="text-left px-4 font-medium">UOM</th>
                  <th className="text-right px-4 font-medium">Selling Price</th>
                  <th className="text-left px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredStockItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground">
                      {searchTerm ? "No items found matching your search" : "No stock items found"}
                    </td>
                  </tr>
                ) : (
                  filteredStockItems.map((item) => {
                    const sellingPrice = parseFloat(item.sellingPrice || "0");
                    
                    return (
                      <tr
                        key={item.id}
                        className="border-t hover-elevate cursor-pointer h-12"
                        onClick={() => handleStockItemClick(item.id, item.name)}
                        data-testid={`row-stock-item-${item.id}`}
                      >
                        <td className="px-4 font-mono text-sm" data-testid={`code-${item.id}`}>
                          {item.code}
                        </td>
                        <td className="px-4 font-medium" data-testid={`name-${item.id}`}>
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {item.name}
                          </div>
                        </td>
                        <td className="px-4 font-mono text-sm text-muted-foreground" data-testid={`barcode-${item.id}`}>
                          {item.barcode || "-"}
                        </td>
                        <td className="px-4 text-muted-foreground" data-testid={`group-${item.id}`}>
                          {getStockGroupName(item.stockGroupId)}
                        </td>
                        <td className="px-4" data-testid={`uom-${item.id}`}>
                          {item.uom}
                        </td>
                        <td className="px-4 text-right font-mono" data-testid={`price-${item.id}`}>
                          ${sellingPrice.toFixed(2)}
                        </td>
                        <td className="px-4" data-testid={`status-${item.id}`}>
                          <Badge variant={item.active ? "default" : "secondary"}>
                            {item.active ? "Active" : "Inactive"}
                          </Badge>
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
    </div>
  );
}
