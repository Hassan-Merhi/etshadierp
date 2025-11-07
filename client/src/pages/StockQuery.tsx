import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Package, TrendingUp, MapPin } from "lucide-react";
import { format } from "date-fns";

interface StockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  stockGroupId: number | null;
  active: boolean;
}

interface Purchase {
  poNumber: string;
  poDate: string;
  supplierName: string;
  containerNumber: string | null;
  quantity: string;
  rate: string;
  amount: string;
}

interface Sale {
  voucherNumber: string;
  saleDate: string;
  locationName: string | null;
  quantity: string;
  sellingPrice: string;
  totalSales: string;
}

interface StockItemDetails {
  purchases: Purchase[];
  sales: Sale[];
  inventoryLocations: {
    locationId: number;
    locationName: string;
    locationCode: string;
    quantity: string;
    averageRate: string;
    totalValue: string;
  }[];
}

const formatSmartNumber = (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  // Remove .00 from whole numbers, preserve all decimals for fractional numbers
  return num % 1 === 0 ? num.toString() : value.toString();
};

export default function StockQuery() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);

  const { data: stockItems = [], isLoading: stockItemsLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: itemDetails, isLoading: detailsLoading } = useQuery<StockItemDetails>({
    queryKey: [`/api/stock-items/${selectedItem?.id}/details`],
    enabled: !!selectedItem,
  });

  const filteredItems = stockItems.filter(item =>
    item.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleItemClick = (item: StockItem) => {
    setSelectedItem(item);
  };

  const handleCloseDialog = (open: boolean) => {
    if (!open) {
      setSelectedItem(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Stock Query</h1>
        <p className="text-muted-foreground">
          Click on any item to view purchase history, sales history, and current inventory locations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search Stock Items</CardTitle>
          <CardDescription>Find items by code or name</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-stock-search"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {stockItemsLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading stock items...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No items found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => handleItemClick(item)}
                      data-testid={`row-stock-item-${item.id}`}
                    >
                      <TableCell>
                        <button
                          className="text-primary hover:underline text-left"
                          data-testid={`button-item-name-${item.id}`}
                        >
                          {item.name}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.active ? "default" : "secondary"}>
                          {item.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedItem} onOpenChange={handleCloseDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedItem?.name} ({selectedItem?.code})
            </DialogTitle>
          </DialogHeader>

          {detailsLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading details...</div>
          ) : itemDetails ? (
            <div className="space-y-6">
              {/* Purchases */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Purchases
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {itemDetails.purchases.length > 0 ? (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Container #</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemDetails.purchases.map((purchase, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{purchase.containerNumber || "N/A"}</TableCell>
                              <TableCell className="text-right font-mono">{formatSmartNumber(purchase.quantity)}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(purchase.rate).toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="mt-3 pt-3 border-t flex justify-end">
                        <div className="text-sm">
                          <span className="font-semibold">Total Quantity: </span>
                          <span className="font-mono">
                            {formatSmartNumber(
                              itemDetails.purchases.reduce((sum, p) => sum + parseFloat(p.quantity || "0"), 0)
                            )}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No purchase history</p>
                  )}
                </CardContent>
              </Card>

              {/* Sales */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Sales
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {itemDetails.sales.length > 0 ? (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Selling Price</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemDetails.sales.map((sale, idx) => (
                            <TableRow key={idx}>
                              <TableCell>{format(new Date(sale.saleDate), "MMM dd, yyyy")}</TableCell>
                              <TableCell>{sale.locationName || "N/A"}</TableCell>
                              <TableCell className="text-right font-mono">{formatSmartNumber(sale.quantity)}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(sale.sellingPrice).toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono">${parseFloat(sale.totalSales).toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="mt-3 pt-3 border-t flex justify-end gap-6">
                        <div className="text-sm">
                          <span className="font-semibold">Total Quantity: </span>
                          <span className="font-mono">
                            {formatSmartNumber(
                              itemDetails.sales.reduce((sum, s) => sum + parseFloat(s.quantity || "0"), 0)
                            )}
                          </span>
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold">Total Value: </span>
                          <span className="font-mono">
                            ${itemDetails.sales.reduce((sum, s) => sum + parseFloat(s.totalSales || "0"), 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sales history</p>
                  )}
                </CardContent>
              </Card>

              {/* Current Locations */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Current Inventory Locations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {itemDetails.inventoryLocations.length > 0 ? (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Avg Rate</TableHead>
                            <TableHead className="text-right">Total Value</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemDetails.inventoryLocations.map((loc) => (
                            <TableRow key={loc.locationId}>
                              <TableCell>
                                {loc.locationName} ({loc.locationCode})
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatSmartNumber(loc.quantity)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${parseFloat(loc.averageRate).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                ${parseFloat(loc.totalValue).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="mt-3 pt-3 border-t flex justify-end gap-6">
                        <div className="text-sm">
                          <span className="font-semibold">Total Quantity: </span>
                          <span className="font-mono">
                            {formatSmartNumber(
                              itemDetails.inventoryLocations.reduce((sum, loc) => sum + parseFloat(loc.quantity || "0"), 0)
                            )}
                          </span>
                        </div>
                        <div className="text-sm">
                          <span className="font-semibold">Total Value: </span>
                          <span className="font-mono">
                            ${itemDetails.inventoryLocations.reduce((sum, loc) => sum + parseFloat(loc.totalValue || "0"), 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No inventory at any location</p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
