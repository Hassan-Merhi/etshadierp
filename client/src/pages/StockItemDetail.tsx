import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Package, TrendingUp, MapPin } from "lucide-react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";

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
        <h1 className="text-3xl font-bold">{selectedItem?.name || "Loading..."}</h1>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Purchases Section */}
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" />
                Purchases
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {itemDetails.purchases.length > 0 ? (
                <div className="h-64 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemDetails.purchases.map((purchase, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm">{purchase.supplierName || "-"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatSmartNumber(purchase.quantity)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">${formatNumber(parseFloat(purchase.rate))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No purchase history
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sales Section */}
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Sales
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {itemDetails.sales.length > 0 ? (
                <div className="h-64 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
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
                          <TableCell className="text-sm">{formatDisplayDate(new Date(sale.saleDate))}</TableCell>
                          <TableCell className="text-sm">{sale.locationName || "-"}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatSmartNumber(sale.quantity)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">${formatNumber(parseFloat(sale.sellingPrice))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No sales history
                </div>
              )}
            </CardContent>
          </Card>

          {/* Inventory Locations Section - Full Width */}
          <Card className="lg:col-span-2 flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Current Inventory Locations
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {itemDetails.inventoryLocations.length > 0 ? (
                <div className="h-64 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
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
                          <TableCell className="text-sm">{loc.locationName}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {formatSmartNumber(loc.quantity)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            ${formatNumber(parseFloat(loc.averageRate))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            ${formatNumber(parseFloat(loc.totalValue))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No inventory at any location
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
