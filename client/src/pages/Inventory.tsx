import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Upload, Download } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface InventoryItem {
  inventoryId: number;
  locationId: number;
  locationName: string | null;
  locationCode: string | null;
  stockItemId: number;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockItemCode: string;
  stockItemName: string;
  stockItemBarcode: string | null;
  stockItemUom: string;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockGroupCode: string | null;
}

export default function Inventory() {
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch all inventory across all locations for the current company
  const { data: inventory = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory"],
  });

  const filteredInventory = inventory.filter((item) =>
    item.stockItemName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.stockItemBarcode && item.stockItemBarcode.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (item.locationName && item.locationName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your stock across all locations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" data-testid="button-export">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button variant="outline" className="gap-2" data-testid="button-import">
            <Upload className="h-4 w-4" />
            Import Excel
          </Button>
          <Button className="gap-2" data-testid="button-add-item">
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search by name, barcode, or location..."
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
                  <th className="text-left px-4 font-medium">Product Name</th>
                  <th className="text-left px-4 font-medium">Code</th>
                  <th className="text-left px-4 font-medium">Barcode</th>
                  <th className="text-left px-4 font-medium">Group</th>
                  <th className="text-left px-4 font-medium">Location</th>
                  <th className="text-right px-4 font-medium">Stock</th>
                  <th className="text-left px-4 font-medium">UOM</th>
                  <th className="text-right px-4 font-medium">Avg Rate</th>
                  <th className="text-right px-4 font-medium">Total Value</th>
                  <th className="text-left px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-8 text-muted-foreground">
                      {searchTerm ? "No items found matching your search" : "No inventory items found"}
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((item) => {
                    const quantity = parseFloat(item.quantity);
                    const avgRate = parseFloat(item.averageRate);
                    const totalValue = parseFloat(item.totalValue);
                    
                    return (
                      <tr
                        key={item.inventoryId}
                        className="h-14 border-t hover-elevate"
                        data-testid={`row-inventory-${item.inventoryId}`}
                      >
                        <td className="px-4 font-medium">{item.stockItemName}</td>
                        <td className="px-4 font-mono text-muted-foreground">
                          {item.stockItemCode}
                        </td>
                        <td className="px-4 font-mono text-muted-foreground">
                          {item.stockItemBarcode || "-"}
                        </td>
                        <td className="px-4 text-muted-foreground">
                          {item.stockGroupName || "Uncategorized"}
                        </td>
                        <td className="px-4 text-muted-foreground">
                          {item.locationName || "-"}
                        </td>
                        <td className="px-4 text-right font-mono">{quantity.toFixed(2)}</td>
                        <td className="px-4">{item.stockItemUom}</td>
                        <td className="px-4 text-right font-mono">${avgRate.toFixed(2)}</td>
                        <td className="px-4 text-right font-mono">${totalValue.toFixed(2)}</td>
                        <td className="px-4">
                          <Badge
                            variant={quantity < 20 ? "destructive" : "secondary"}
                          >
                            {quantity < 20 ? "Low Stock" : "In Stock"}
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
      </Card>
    </div>
  );
}
