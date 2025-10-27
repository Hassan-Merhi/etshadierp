import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Upload, Download } from "lucide-react";

//todo: remove mock functionality
const mockInventory = [
  { id: "1", name: "Premium Cotton Bales", barcode: "BAL001", stock: 45, location: "Main Warehouse", price: 450, fixedPrice: 500 },
  { id: "2", name: "Denim Mix Bales", barcode: "BAL002", stock: 32, location: "Main Warehouse", price: 380, fixedPrice: 420 },
  { id: "3", name: "Designer Labels Mix", barcode: "BAL003", stock: 18, location: "East Branch", price: 650, fixedPrice: 700 },
  { id: "4", name: "Summer Collection", barcode: "BAL004", stock: 28, location: "West Coast Hub", price: 420, fixedPrice: 480 },
  { id: "5", name: "Winter Apparel Mix", barcode: "BAL005", stock: 22, location: "Main Warehouse", price: 520, fixedPrice: 580 },
];

export default function Inventory() {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredInventory = mockInventory.filter((item) =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.barcode.toLowerCase().includes(searchTerm.toLowerCase())
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
            placeholder="Search by name or barcode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
            data-testid="input-search"
          />
        </div>

        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="h-12">
                <th className="text-left px-4 font-medium">Product Name</th>
                <th className="text-left px-4 font-medium">Barcode</th>
                <th className="text-left px-4 font-medium">Location</th>
                <th className="text-right px-4 font-medium">Stock</th>
                <th className="text-right px-4 font-medium">Cost Price</th>
                <th className="text-right px-4 font-medium">Fixed Price</th>
                <th className="text-left px-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredInventory.map((item) => (
                <tr
                  key={item.id}
                  className="h-14 border-t hover-elevate"
                  data-testid={`row-inventory-${item.id}`}
                >
                  <td className="px-4 font-medium">{item.name}</td>
                  <td className="px-4 font-mono text-muted-foreground">
                    {item.barcode}
                  </td>
                  <td className="px-4 text-muted-foreground">{item.location}</td>
                  <td className="px-4 text-right font-mono">{item.stock}</td>
                  <td className="px-4 text-right font-mono">${item.price}</td>
                  <td className="px-4 text-right font-mono">${item.fixedPrice}</td>
                  <td className="px-4">
                    <Badge
                      variant={item.stock < 20 ? "destructive" : "secondary"}
                    >
                      {item.stock < 20 ? "Low Stock" : "In Stock"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
