import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp, TrendingDown, LayoutList } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { formatNumber } from "@/lib/formatNumber";
import { Skeleton } from "@/components/ui/skeleton";

type PLFilter = "all" | "gain" | "loss";
type PLBasis = "config" | "cost";

interface SalesReportItem {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  locationId: number | null;
  locationName: string | null;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string;
  actualSellingPrice: string;
  configuredSellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  totalConfiguredCost: number;
  costProfit: string;
  costProfitPercentage: number;
  configuredProfit: number;
  configuredProfitPercentage: number;
  createdAt: string;
}

const formatNumericValue = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return formatNumber(num);
};

export default function SalesReportDetail() {
  const [, navigate] = useLocation();
  const { formatAmount } = useCurrencyContext();
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [plFilter, setPlFilter] = useState<PLFilter>("all");
  const [plBasis, setPlBasis] = useState<PLBasis>("config");

  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  const displayDate = params.get("displayDate") || startDate;
  const locationId = params.get("locationId") || "";
  const stockItemId = params.get("stockItemId") || "";
  const grouping = params.get("grouping") || "daily";

  const queryParams = new URLSearchParams();
  if (startDate) queryParams.append("startDate", startDate);
  if (endDate) queryParams.append("endDate", endDate);
  if (locationId && locationId !== "all") queryParams.append("locationId", locationId);
  if (stockItemId && stockItemId !== "all") queryParams.append("stockItemId", stockItemId);
  const queryString = queryParams.toString();

  const { data: items = [], isLoading } = useQuery<SalesReportItem[]>({
    queryKey: [`/api/sales-report?${queryString}`],
    enabled: !!startDate,
  });

  const sortedItems = [...items]
    .sort((a, b) => (a.locationName || "").localeCompare(b.locationName || ""))
    .filter((item) => {
      if (plFilter === "all") return true;
      const value = plBasis === "cost" ? parseFloat(item.costProfit) : item.configuredProfit;
      if (plFilter === "gain") return value > 0;
      if (plFilter === "loss") return value < 0;
      return true;
    });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "s") {
        if (selectedItemId == null) return;
        const item = sortedItems.find((i) => i.id === selectedItemId);
        if (item?.stockItemId) {
          e.preventDefault();
          navigate(`/stock-query/${item.stockItemId}`);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItemId, sortedItems, navigate]);

  const totalQty = sortedItems.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
  const totalSales = sortedItems.reduce((sum, item) => sum + parseFloat(item.totalSales || "0"), 0);
  const totalCost = sortedItems.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0);
  const totalConfiguredCost = sortedItems.reduce((sum, item) => sum + (item.totalConfiguredCost || 0), 0);
  const costProfit = totalSales - totalCost;
  const configuredProfit = totalSales - totalConfiguredCost;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 w-full min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sales-report")} data-testid="button-back-to-sales-report">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Sales Details — {displayDate}</h1>
          <p className="text-sm text-muted-foreground">
            All items sold {grouping === "daily" ? "on this day" : grouping === "monthly" ? "this month" : "this year"}
          </p>
        </div>
        <div className="flex flex-col gap-1 items-end" data-testid="filter-pl-toggle">
          <div className="flex items-center gap-1 rounded-md border p-1">
            <Button
              variant="ghost"
              size="sm"
              className={plFilter === "all" ? "toggle-elevate toggle-elevated" : "toggle-elevate"}
              onClick={() => setPlFilter("all")}
              data-testid="button-filter-all"
            >
              <LayoutList className="h-3.5 w-3.5 mr-1" />
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={plFilter === "gain" ? "toggle-elevate toggle-elevated text-green-600" : "toggle-elevate"}
              onClick={() => setPlFilter("gain")}
              data-testid="button-filter-gaining"
            >
              <TrendingUp className="h-3.5 w-3.5 mr-1" />
              Gaining
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={plFilter === "loss" ? "toggle-elevate toggle-elevated text-red-600" : "toggle-elevate"}
              onClick={() => setPlFilter("loss")}
              data-testid="button-filter-losing"
            >
              <TrendingDown className="h-3.5 w-3.5 mr-1" />
              Losing
            </Button>
          </div>
          {plFilter !== "all" && (
            <div className="flex items-center gap-1 rounded-md border p-1" data-testid="filter-basis-toggle">
              <span className="text-xs text-muted-foreground px-1">by:</span>
              <Button
                variant="ghost"
                size="sm"
                className={plBasis === "config" ? "toggle-elevate toggle-elevated" : "toggle-elevate"}
                onClick={() => setPlBasis("config")}
                data-testid="button-basis-config"
              >
                Config P/L
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={plBasis === "cost" ? "toggle-elevate toggle-elevated" : "toggle-elevate"}
                onClick={() => setPlBasis("cost")}
                data-testid="button-basis-cost"
              >
                Cost P/L
              </Button>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No sales data found for this period.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Total Qty</CardDescription>
                <CardTitle className="text-lg">{formatNumber(totalQty)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Total Sales</CardDescription>
                <CardTitle className="text-lg">{formatAmount(totalSales)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Cost Total</CardDescription>
                <CardTitle className="text-lg">{formatAmount(totalCost)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Cost Profit</CardDescription>
                <CardTitle className={`text-lg ${costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {costProfit < 0 ? "-" : ""}{formatAmount(costProfit)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Hassan's Total</CardDescription>
                <CardTitle className="text-lg">{formatAmount(totalConfiguredCost)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">Hassan's Profit</CardDescription>
                <CardTitle className={`text-lg ${configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {configuredProfit < 0 ? "-" : ""}{formatAmount(configuredProfit)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Sold Price</TableHead>
                      <TableHead className="text-right">Cost Price</TableHead>
                      <TableHead className="text-right">Hassan's Price</TableHead>
                      <TableHead className="text-right">Unit Profit</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">Cost Profit</TableHead>
                      <TableHead className="text-right">Cost %</TableHead>
                      <TableHead className="text-right">Hassan's Profit</TableHead>
                      <TableHead className="text-right">Hassan's %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedItems.map((item) => {
                      const unitProfit = parseFloat(item.actualSellingPrice) - parseFloat(item.costPrice);
                      const isSelected = selectedItemId === item.id;
                      return (
                        <TableRow
                          key={item.id}
                          data-testid={`row-detail-${item.id}`}
                          className={`cursor-pointer ${isSelected ? "bg-muted" : ""}`}
                          onClick={() => setSelectedItemId(isSelected ? null : item.id)}
                        >
                          <TableCell className="font-medium">
                            {(item.locationId || item.stockItemId) ? (
                              <a
                                href={item.locationId
                                  ? `/locations/${item.locationId}/stock-items/${item.stockItemId}/history`
                                  : `/stock-items/${item.stockItemId}/history`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline text-foreground"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`link-bale-${item.stockItemId}`}
                              >
                                {item.stockItemName}
                              </a>
                            ) : (
                              item.stockItemName
                            )}
                          </TableCell>
                          <TableCell>{item.locationName || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumericValue(item.quantity)}</TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(item.actualSellingPrice)}</TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(item.costPrice)}</TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(item.configuredSellingPrice)}</TableCell>
                          <TableCell className={`text-right font-mono ${unitProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {unitProfit < 0 ? "-" : ""}{formatAmount(unitProfit)}
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(item.totalCost)}</TableCell>
                          <TableCell className={`text-right font-mono ${parseFloat(item.costProfit) >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {parseFloat(item.costProfit) < 0 ? "-" : ""}{formatAmount(item.costProfit)}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${item.costProfitPercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.costProfitPercentage.toFixed(1)}%
                          </TableCell>
                          <TableCell className={`text-right font-mono ${item.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.configuredProfit < 0 ? "-" : ""}{formatAmount(item.configuredProfit)}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${item.configuredProfitPercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.configuredProfitPercentage.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter className="sticky bottom-0 bg-background border-t">
                    <TableRow className="font-semibold">
                      <TableCell colSpan={2}>Total ({sortedItems.length} items{plFilter !== "all" ? `, ${plFilter === "gain" ? "gaining" : "losing"} only` : ""})</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(totalQty)}</TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(totalCost)}</TableCell>
                      <TableCell className={`text-right font-mono ${costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {costProfit < 0 ? "-" : ""}{formatAmount(costProfit)}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell className={`text-right font-mono ${configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {configuredProfit < 0 ? "-" : ""}{formatAmount(configuredProfit)}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>

              <div className="md:hidden space-y-3 p-3">
                {sortedItems.map((item) => {
                  const unitProfit = parseFloat(item.actualSellingPrice) - parseFloat(item.costPrice);
                  const isSelected = selectedItemId === item.id;
                  return (
                    <Card
                      key={item.id}
                      className={`cursor-pointer ${isSelected ? "bg-muted" : ""}`}
                      onClick={() => setSelectedItemId(isSelected ? null : item.id)}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          {(item.locationId || item.stockItemId) ? (
                            <a
                              href={item.locationId
                                ? `/locations/${item.locationId}/stock-items/${item.stockItemId}/history`
                                : `/stock-items/${item.stockItemId}/history`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-sm hover:underline text-foreground"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`link-bale-mobile-${item.stockItemId}`}
                            >
                              {item.stockItemName}
                            </a>
                          ) : (
                            <span className="font-medium text-sm">{item.stockItemName}</span>
                          )}
                          <span className="text-xs text-muted-foreground">{item.locationName || "-"}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          <div><span className="text-muted-foreground">Qty: </span><span className="font-mono">{formatNumericValue(item.quantity)}</span></div>
                          <div><span className="text-muted-foreground">Sold: </span><span className="font-mono">{formatAmount(item.actualSellingPrice)}</span></div>
                          <div><span className="text-muted-foreground">Cost: </span><span className="font-mono">{formatAmount(item.costPrice)}</span></div>
                          <div><span className="text-muted-foreground">Total Cost: </span><span className="font-mono">{formatAmount(item.totalCost)}</span></div>
                        </div>
                        <div className="flex items-center justify-between gap-2 pt-1 border-t text-xs">
                          <span className={`font-mono font-semibold ${parseFloat(item.costProfit) >= 0 ? "text-green-600" : "text-red-600"}`}>
                            Cost: {parseFloat(item.costProfit) < 0 ? "-" : ""}{formatAmount(item.costProfit)} ({item.costProfitPercentage.toFixed(1)}%)
                          </span>
                          <span className={`font-mono font-semibold ${item.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            Config: {item.configuredProfit < 0 ? "-" : ""}{formatAmount(item.configuredProfit)} ({item.configuredProfitPercentage.toFixed(1)}%)
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
