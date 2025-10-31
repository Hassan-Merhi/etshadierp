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

interface StockItemDetails {
  lastPurchase: {
    poNumber: string;
    poDate: string;
    supplierName: string;
    quantity: string;
    rate: string;
    amount: string;
  } | null;
  lastSale: {
    voucherNumber: string;
    saleDate: string;
    locationName: string | null;
    quantity: string;
    sellingPrice: string;
    totalSales: string;
  } | null;
  inventoryLocations: {
    locationId: number;
    locationName: string;
    locationCode: string;
    quantity: string;
    averageRate: string;
    totalValue: string;
  }[];
}

export default function StockQuery() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);

  const { data: stockItems = [], isLoading: stockItemsLoading } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const { data: itemDetails, isLoading: detailsLoading } = useQuery<StockItemDetails>({
    queryKey: ['stock-item-details', selectedItem?.id],
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
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
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
                      <TableCell className="font-medium">{item.code}</TableCell>
                      <TableCell>
                        <button
                          className="text-primary hover:underline text-left"
                          data-testid={`button-item-name-${item.id}`}
                        >
                          {item.name}
                        </button>
                      </TableCell>
                      <TableCell>{item.uom}</TableCell>
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
              {/* Last Purchase */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Last Purchase Order
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {itemDetails.lastPurchase ? (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">PO Number</p>
                        <p className="font-medium">{itemDetails.lastPurchase.poNumber}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Date</p>
                        <p className="font-medium">
                          {format(new Date(itemDetails.lastPurchase.poDate), "MMM dd, yyyy")}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Supplier</p>
                        <p className="font-medium">{itemDetails.lastPurchase.supplierName}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Quantity</p>
                        <p className="font-medium">{parseFloat(itemDetails.lastPurchase.quantity).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Rate</p>
                        <p className="font-medium">${parseFloat(itemDetails.lastPurchase.rate).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Amount</p>
                        <p className="font-medium">${parseFloat(itemDetails.lastPurchase.amount).toFixed(2)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No purchase history</p>
                  )}
                </CardContent>
              </Card>

              {/* Last Sale */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Last Sale
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {itemDetails.lastSale ? (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Voucher Number</p>
                        <p className="font-medium">{itemDetails.lastSale.voucherNumber}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Date</p>
                        <p className="font-medium">
                          {format(new Date(itemDetails.lastSale.saleDate), "MMM dd, yyyy")}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Location</p>
                        <p className="font-medium">{itemDetails.lastSale.locationName || "N/A"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Quantity</p>
                        <p className="font-medium">{parseFloat(itemDetails.lastSale.quantity).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Selling Price</p>
                        <p className="font-medium">${parseFloat(itemDetails.lastSale.sellingPrice).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total Sales</p>
                        <p className="font-medium">${parseFloat(itemDetails.lastSale.totalSales).toFixed(2)}</p>
                      </div>
                    </div>
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
                            <TableCell className="text-right">
                              {parseFloat(loc.quantity).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              ${parseFloat(loc.averageRate).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              ${parseFloat(loc.totalValue).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
