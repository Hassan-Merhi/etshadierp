import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useRoute, useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Package, TrendingUp, MapPin, X, Calendar, ChevronDown } from "lucide-react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Skeleton } from "@/components/ui/skeleton";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { PageHeader } from "@/components/PageHeader";

type DatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "this-month"
  | "last-1-month"
  | "last-6-months"
  | "this-year"
  | "custom";

function getPresetDates(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);
  switch (preset) {
    case "all":
      return { from: "", to: "" };
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case "this-month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case "last-1-month": {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 1);
      return { from: fmt(from), to: today };
    }
    case "last-6-months": {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 6);
      return { from: fmt(from), to: today };
    }
    case "this-year": {
      const first = new Date(now.getFullYear(), 0, 1);
      return { from: fmt(first), to: today };
    }
    default:
      return { from: "", to: "" };
  }
}

const PRESET_LABELS: Record<DatePreset, string> = {
  all: "All Time",
  today: "Today",
  yesterday: "Yesterday",
  "this-month": "This Month",
  "last-1-month": "Last 1 Month",
  "last-6-months": "Last 6 Months",
  "this-year": "This Year",
  custom: "Custom Range",
};

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
  posStation?: number | null;
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
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return num % 1 === 0 ? num.toString() : value.toString();
};

export default function StockItemDetail() {
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [_match, params] = useRoute("/stock-query/:id");
  const [_location, navigate] = useLocation();
  const itemId = params?.id ? parseInt(params.id) : null;

  const [preset, setPreset] = useState<DatePreset>("this-month");
  const initialDates = useMemo(() => getPresetDates("this-month"), []);
  const [fromDate, setFromDate] = useState(initialDates.from);
  const [toDate, setToDate] = useState(initialDates.to);

  const applyPreset = (p: DatePreset) => {
    setPreset(p);
    if (p !== "custom") {
      const { from, to } = getPresetDates(p);
      setFromDate(from);
      setToDate(to);
    }
  };

  const { data: stockItems = [] } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
  });

  const selectedItem = stockItems.find((item) => item.id === itemId);

  const {
    data: itemDetails,
    isLoading: detailsLoading,
    error: detailsError,
    refetch: refetchDetails,
  } = useQuery<StockItemDetails>({
    queryKey: ["/api/stock-items", itemId, "details", fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const qs = params.toString();
      const res = await fetch(`/api/stock-items/${itemId}/details${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || res.statusText);
      }
      return res.json();
    },
    enabled: !!itemId,
  });

  const search = useSearch();
  const from = new URLSearchParams(search).get("from");

  const handleBack = () => {
    if (from === "pos-daybook") navigate("/pos-daybook");
    else if (from === "daybook") navigate("/daybook");
    else navigate("/stock-query");
  };

  useEscapeBack(handleBack);

  const handleSaleClick = (sale: Sale) => {
    if (!sale.voucherId) return;
    if (sale.posStation != null) {
      const normalizedDate = sale.saleDate.split(" ")[0];
      navigate(`/pos-daybook?date=${normalizedDate}&voucherId=${sale.voucherId}`);
    } else {
      navigate(`/vouchers/${sale.voucherId}/edit`);
    }
  };

  if (!itemId || (stockItems.length > 0 && !selectedItem)) {
    return (
      <div className="p-3 sm:p-6 space-y-6">
        <Button variant="ghost" onClick={handleBack} data-testid="button-back-to-stock-query" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Stock Query
        </Button>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">Stock item not found</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={handleBack} data-testid="button-back-to-stock-query" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to Stock Query</span>
          <span className="sm:hidden">Back</span>
        </Button>
      </div>

      <div>
        <PageHeader
          title={selectedItem?.name || "Loading..."}
          subtitle="Purchase history, sales history, and current inventory locations"
        />
      </div>

      {/* Date filter */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-date-preset">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{PRESET_LABELS[preset]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(
                [
                  "all",
                  "today",
                  "yesterday",
                  "this-month",
                  "last-1-month",
                  "last-6-months",
                  "this-year",
                ] as DatePreset[]
              ).map((p) => (
                <DropdownMenuItem
                  key={p}
                  onClick={() => applyPreset(p)}
                  className={preset === p ? "bg-accent" : ""}
                  data-testid={`option-preset-${p}`}
                >
                  {PRESET_LABELS[p]}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => applyPreset("custom")}
                className={preset === "custom" ? "bg-accent" : ""}
                data-testid="option-preset-custom"
              >
                Custom Range...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {preset === "custom" && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-from" className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input
                  id="filter-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-40"
                  data-testid="input-filter-from-date"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="filter-to" className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input
                  id="filter-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-40"
                  data-testid="input-filter-to-date"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyPreset("all")}
                className="gap-1.5 self-end"
                data-testid="button-clear-date-filter"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            </>
          )}

          {preset !== "all" && preset !== "custom" && fromDate && toDate && (
            <span className="text-sm text-muted-foreground">
              {fromDate} — {toDate}
            </span>
          )}

          {preset !== "all" && (
            <span className="text-xs text-muted-foreground">Filtering purchases &amp; sales by date</span>
          )}
        </div>
      </Card>

      {detailsLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : detailsError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Package className="h-10 w-10 opacity-25" />
          <p className="text-sm font-medium text-foreground">Failed to load stock item details</p>
          {(detailsError as any)?.message && (
            <p className="text-xs text-destructive max-w-md text-center">{(detailsError as any).message}</p>
          )}
          <Button variant="outline" size="sm" onClick={() => refetchDetails()} className="mt-1">
            Try again
          </Button>
        </div>
      ) : !itemDetails ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No details available for this stock item.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
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
                <>
                  <div className="h-64 overflow-y-auto">
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background">
                          <TableRow>
                            <TableHead>Container</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemDetails.purchases.map((purchase, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-sm font-mono">
                                {purchase.containerNumber || purchase.supplierName || "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {formatSmartNumber(purchase.quantity)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {formatAmount(parseFloat(purchase.rate))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter className="sticky bottom-0 bg-background border-t">
                          <TableRow className="font-semibold text-sm">
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right font-mono" data-testid="total-purchase-qty">
                              {formatSmartNumber(
                                itemDetails.purchases.reduce((s, p) => s + parseFloat(p.quantity || "0"), 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono" data-testid="total-purchase-value">
                              {formatAmount(itemDetails.purchases.reduce((s, p) => s + parseFloat(p.amount || "0"), 0))}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-2">
                      {itemDetails.purchases.map((purchase, idx) => (
                        <div key={idx} className="p-2 rounded-md border text-sm">
                          <div className="font-mono font-medium">
                            {purchase.containerNumber || purchase.supplierName || "-"}
                          </div>
                          <div className="flex justify-between mt-1 text-muted-foreground">
                            <span>Qty: {formatSmartNumber(purchase.quantity)}</span>
                            <span>Rate: {formatAmount(parseFloat(purchase.rate))}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">No purchase history</div>
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
                <>
                  <div className="h-64 overflow-y-auto">
                    <div className="hidden md:block">
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
                              onClick={() => handleSaleClick(sale)}
                              className={sale.voucherId ? "cursor-pointer hover-elevate" : ""}
                              data-testid={`row-sale-${idx}`}
                            >
                              <TableCell className="text-sm">{formatDisplayDate(new Date(sale.saleDate))}</TableCell>
                              <TableCell className="text-sm">{sale.locationName || "-"}</TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {formatSmartNumber(sale.quantity)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {formatAmount(parseFloat(sale.sellingPrice))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter className="sticky bottom-0 bg-background border-t">
                          <TableRow className="font-semibold text-sm">
                            <TableCell>Total</TableCell>
                            <TableCell></TableCell>
                            <TableCell className="text-right font-mono" data-testid="total-sales-qty">
                              {formatSmartNumber(
                                itemDetails.sales.reduce((s, sa) => s + parseFloat(sa.quantity || "0"), 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono" data-testid="total-sales-value">
                              {formatAmount(
                                itemDetails.sales.reduce((s, sa) => s + parseFloat(sa.totalSales || "0"), 0)
                              )}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-2">
                      {itemDetails.sales.map((sale, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSaleClick(sale)}
                          className={`p-2 rounded-md border text-sm ${sale.voucherId ? "cursor-pointer hover-elevate" : ""}`}
                          data-testid={`row-sale-${idx}`}
                        >
                          <div className="flex justify-between">
                            <span className="font-medium">{formatDisplayDate(new Date(sale.saleDate))}</span>
                            <span className="text-muted-foreground">{sale.locationName || "-"}</span>
                          </div>
                          <div className="flex justify-between mt-1 text-muted-foreground">
                            <span>Qty: {formatSmartNumber(sale.quantity)}</span>
                            <span>Rate: {formatAmount(parseFloat(sale.sellingPrice))}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">No sales history</div>
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
                <>
                  <div className="h-64 overflow-y-auto">
                    <div className="hidden md:block">
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
                                {formatAmount(parseFloat(loc.averageRate))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {formatAmount(parseFloat(loc.totalValue))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableFooter className="sticky bottom-0 bg-background border-t">
                          <TableRow className="font-semibold text-sm">
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right font-mono" data-testid="total-inventory-qty">
                              {formatSmartNumber(
                                itemDetails.inventoryLocations.reduce((s, l) => s + parseFloat(l.quantity || "0"), 0)
                              )}
                            </TableCell>
                            <TableCell></TableCell>
                            <TableCell className="text-right font-mono" data-testid="total-inventory-value">
                              {formatAmount(
                                itemDetails.inventoryLocations.reduce((s, l) => s + parseFloat(l.totalValue || "0"), 0)
                              )}
                            </TableCell>
                          </TableRow>
                        </TableFooter>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-2">
                      {itemDetails.inventoryLocations.map((loc) => (
                        <div key={loc.locationId} className="p-3 rounded-md border text-sm">
                          <div className="font-medium">{loc.locationName}</div>
                          <div className="grid grid-cols-3 gap-2 mt-2 text-muted-foreground">
                            <div>
                              <div className="text-xs">Qty</div>
                              <div className="font-mono">{formatSmartNumber(loc.quantity)}</div>
                            </div>
                            <div>
                              <div className="text-xs">Avg Rate</div>
                              <div className="font-mono">{formatAmount(parseFloat(loc.averageRate))}</div>
                            </div>
                            <div>
                              <div className="text-xs">Value</div>
                              <div className="font-mono font-medium">{formatAmount(parseFloat(loc.totalValue))}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
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
