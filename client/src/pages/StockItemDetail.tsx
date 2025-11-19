import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Package, TrendingUp, MapPin, History } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

interface VoucherHistoryEntry {
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  locationId: number | null;
  locationName: string | null;
  locationCode: string | null;
  quantityIn: string;
  quantityOut: string;
  rate: string;
  amount: string;
}

interface VoucherWithItems {
  id: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  description: string | null;
  createdAt: string;
  locationId: number | null;
  locationName?: string | null;
  salesItems?: {
    id: number;
    stockItemId: number;
    stockItemName: string;
    stockItemCode: string;
    quantity: string;
    sellingPrice: string;
    costPrice: string;
    totalSales: string;
    profit: string;
  }[];
}

const formatSmartNumber = (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toString() : value.toString();
};

export default function StockItemDetail() {
  const [_match, params] = useRoute("/stock-query/:id");
  const [_location, navigate] = useLocation();
  const itemId = params?.id ? parseInt(params.id) : null;
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);
  const [voucherDetailOpen, setVoucherDetailOpen] = useState(false);

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const selectedItem = stockItems.find(item => item.id === itemId);

  const { data: itemDetails, isLoading: detailsLoading, error: detailsError } = useQuery<StockItemDetails>({
    queryKey: [`/api/stock-items/${itemId}/details`],
    enabled: !!itemId,
  });

  const { data: voucherHistory = [], isLoading: historyLoading } = useQuery<VoucherHistoryEntry[]>({
    queryKey: [`/api/stock-items/${itemId}/voucher-history`],
    enabled: !!itemId,
  });

  const { data: voucherDetails, isLoading: voucherDetailsLoading } = useQuery<VoucherWithItems>({
    queryKey: selectedVoucherId ? [`/api/vouchers/${selectedVoucherId}`] : [],
    enabled: !!selectedVoucherId,
  });

  const handleBack = () => {
    navigate("/stock-query");
  };

  const handleVoucherClick = (voucherId: number, voucherType: string) => {
    if (voucherType === "Sales") {
      setSelectedVoucherId(voucherId);
      setVoucherDetailOpen(true);
    }
  };

  const handleEditInDaybook = () => {
    if (voucherDetails) {
      const voucherDate = voucherDetails.voucherDate;
      navigate(`/pos-daybook?date=${voucherDate}`);
    }
  };

  const getVoucherTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "Sales":
        return "default";
      case "Transfer":
        return "secondary";
      case "Production":
        return "outline";
      case "Consumption":
        return "destructive";
      default:
        return "secondary";
    }
  };

  if (!itemId || (stockItems.length > 0 && !selectedItem)) {
    return (
      <div className="p-6 space-y-6">
        <Button
          variant="ghost"
          onClick={handleBack}
          data-testid="button-back-to-stock-query"
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Stock Query
        </Button>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Stock item not found
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={handleBack}
          data-testid="button-back-to-stock-query"
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Stock Query
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold">
          {selectedItem?.name || "Loading..."} ({selectedItem?.code || ""})
        </h1>
        <p className="text-muted-foreground">
          Purchase history, sales history, voucher history, and current inventory locations
        </p>
      </div>

      {detailsLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : detailsError ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Failed to load stock item details. Please try again.
          </CardContent>
        </Card>
      ) : !itemDetails ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No details available for this stock item.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="voucher-history" className="space-y-6">
          <TabsList>
            <TabsTrigger value="voucher-history" data-testid="tab-voucher-history">
              <History className="h-4 w-4 mr-2" />
              Voucher History
            </TabsTrigger>
            <TabsTrigger value="purchases" data-testid="tab-purchases">
              <Package className="h-4 w-4 mr-2" />
              Purchases
            </TabsTrigger>
            <TabsTrigger value="sales" data-testid="tab-sales">
              <TrendingUp className="h-4 w-4 mr-2" />
              Sales
            </TabsTrigger>
            <TabsTrigger value="inventory" data-testid="tab-inventory">
              <MapPin className="h-4 w-4 mr-2" />
              Inventory Locations
            </TabsTrigger>
          </TabsList>

          <TabsContent value="voucher-history" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">All Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : voucherHistory.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Voucher #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Qty In</TableHead>
                        <TableHead className="text-right">Qty Out</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {voucherHistory.map((entry, idx) => (
                        <TableRow
                          key={idx}
                          onClick={() => handleVoucherClick(entry.voucherId, entry.voucherType)}
                          className={entry.voucherType === "Sales" ? "cursor-pointer hover-elevate" : ""}
                          data-testid={`row-voucher-${entry.voucherId}`}
                        >
                          <TableCell>{format(parseISO(entry.voucherDate), "MMM dd, yyyy")}</TableCell>
                          <TableCell className="font-mono">{entry.voucherNumber}</TableCell>
                          <TableCell>
                            <Badge variant={getVoucherTypeBadgeVariant(entry.voucherType)}>
                              {entry.voucherType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {entry.locationName ? `${entry.locationName} (${entry.locationCode})` : "N/A"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(entry.quantityIn) > 0 ? formatSmartNumber(entry.quantityIn) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(entry.quantityOut) > 0 ? formatSmartNumber(entry.quantityOut) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${parseFloat(entry.rate).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No transaction history
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="purchases" className="space-y-4">
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
          </TabsContent>

          <TabsContent value="sales" className="space-y-4">
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
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
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
          </TabsContent>
        </Tabs>
      )}

      {/* Voucher Detail Dialog (for Sales vouchers) */}
      <Dialog open={voucherDetailOpen} onOpenChange={setVoucherDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              Sales Voucher - {voucherDetails?.voucherNumber}
            </DialogTitle>
            {voucherDetails && (
              <div className="flex items-center gap-4 pt-2 text-sm text-muted-foreground">
                <span>{format(parseISO(voucherDetails.voucherDate), "MMM dd, yyyy")}</span>
                <span>•</span>
                <span>{voucherDetails.locationName || `Location ${voucherDetails.locationId}`}</span>
              </div>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {voucherDetailsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : voucherDetails?.salesItems && voucherDetails.salesItems.length > 0 ? (
              <div className="space-y-4">
                {voucherDetails.description && (
                  <div className="border-b pb-4">
                    <p className="text-sm font-medium text-muted-foreground">Notes</p>
                    <p className="text-sm mt-1">{voucherDetails.description}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Items Sold</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {voucherDetails.salesItems.map((item, idx) => (
                        <TableRow key={item.id || idx}>
                          <TableCell className="font-medium">
                            {item.stockItemName} ({item.stockItemCode})
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatSmartNumber(item.quantity)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${parseFloat(item.sellingPrice).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            ${parseFloat(item.totalSales).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <div className="flex justify-end pt-4 border-t mt-4">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Total Sales</p>
                      <p className="text-lg font-semibold font-mono">
                        ${voucherDetails.salesItems.reduce((sum, item) => sum + parseFloat(item.totalSales), 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No items found in this voucher
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setVoucherDetailOpen(false)}
              data-testid="button-close"
            >
              Close
            </Button>
            <Button
              onClick={handleEditInDaybook}
              data-testid="button-edit-in-daybook"
            >
              Edit in POS Daybook
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
