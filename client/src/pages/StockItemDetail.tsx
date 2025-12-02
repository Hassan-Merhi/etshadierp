import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Package, TrendingUp, MapPin } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Skeleton } from "@/components/ui/skeleton";

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
  voucherId?: number;
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
  return num % 1 === 0 ? num.toString() : value.toString();
};

export default function StockItemDetail() {
  const { formatDisplayDate } = useDateFormat();
  const [_match, params] = useRoute("/stock-query/:id");
  const [_location, navigate] = useLocation();
  const itemId = params?.id ? parseInt(params.id) : null;

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const selectedItem = stockItems.find(item => item.id === itemId);

  const { data: itemDetails, isLoading: detailsLoading, error: detailsError } = useQuery<StockItemDetails>({
    queryKey: [`/api/stock-items/${itemId}/details`],
    enabled: !!itemId,
  });

  const handleBack = () => {
    navigate("/stock-query");
  };

  const handleSaleClick = (saleDate: string, voucherId?: number) => {
    if (!voucherId) return;
    // Normalize date to YYYY-MM-DD format (remove time if present)
    const normalizedDate = saleDate.split(' ')[0];
    navigate(`/pos-daybook?date=${normalizedDate}&voucherId=${voucherId}`);
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
          Purchase history, sales history, and current inventory locations
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
        <Tabs defaultValue="purchases" className="space-y-6">
          <TabsList>
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
                        <TableRow 
                          key={idx}
                          onClick={() => handleSaleClick(sale.saleDate, sale.voucherId)}
                          className={sale.voucherId ? "cursor-pointer hover-elevate" : ""}
                          data-testid={`row-sale-${idx}`}
                        >
                          <TableCell>{formatDisplayDate(new Date(sale.saleDate))}</TableCell>
                          <TableCell>{sale.locationName || "-"}</TableCell>
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
    </div>
  );
}
