import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp, TrendingDown, LayoutList, ChevronDown, ChevronRight } from "lucide-react";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { formatNumber } from "@/lib/formatNumber";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

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
  isCreditSale?: boolean;
  customerName?: string | null;
  createdAt: string;
  companyId?: number;
  companyCode?: string;
  companyName?: string;
}

interface LocationSummary {
  locationKey: string;
  locationId: number | null;
  locationName: string;
  totalQty: number;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  items: SalesReportItem[];
}

interface ItemGroup {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  totalQty: number;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  locationBreakdown: LocationSummary[];
}

const formatNumericValue = (value: string | number): string => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return formatNumber(num);
};

const profitColor = (v: number) =>
  v > 0 ? "text-green-600 dark:text-green-400" : v < 0 ? "text-red-600 dark:text-red-400" : "";

const LOCATION_PALETTE = [
  { dot: "bg-blue-500", text: "text-blue-700 dark:text-blue-300", badge: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700" },
  { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", badge: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700" },
  { dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-300", badge: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-700" },
  { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700" },
  { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300", badge: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-700" },
  { dot: "bg-cyan-500", text: "text-cyan-700 dark:text-cyan-300", badge: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700" },
  { dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-300", badge: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-700" },
  { dot: "bg-pink-500", text: "text-pink-700 dark:text-pink-300", badge: "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 border border-pink-200 dark:border-pink-700" },
];

export default function SalesReportDetail() {
  const [, navigate] = useLocation();
  const { formatAmount } = useCurrencyContext();
  const [plFilter, setPlFilter] = useState<PLFilter>("all");
  const [plBasis, setPlBasis] = useState<PLBasis>("config");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  useEscapeBack(() => window.history.back());

  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  const displayDate = params.get("displayDate") || startDate;
  const locationId = params.get("locationId") || "";
  const stockItemId = params.get("stockItemId") || "";
  const stockGroupId = params.get("stockGroupId") || "";
  const searchTerm = params.get("searchTerm") || "";
  const grouping = params.get("grouping") || "daily";
  const allCompanies = params.get("allCompanies") === "true";
  const companyFilter = params.get("companyFilter") || "";
  const isCreditSaleParam = params.get("isCreditSale");

  const queryParams = new URLSearchParams();
  if (startDate) queryParams.append("startDate", startDate);
  if (endDate) queryParams.append("endDate", endDate);
  if (locationId && locationId !== "all") queryParams.append("locationId", locationId);
  if (stockItemId && stockItemId !== "all") queryParams.append("stockItemId", stockItemId);
  if (stockGroupId && stockGroupId !== "all") queryParams.append("stockGroupId", stockGroupId);
  if (allCompanies && companyFilter) queryParams.append("companyFilter", companyFilter);
  const queryString = queryParams.toString();

  const apiBase = allCompanies ? "/api/dashboard/sales-report-all" : "/api/sales-report";
  const apiUrl = queryString ? `${apiBase}?${queryString}` : apiBase;

  const { data: items = [], isLoading } = useQuery<SalesReportItem[]>({
    queryKey: [apiUrl],
    enabled: !!startDate,
  });

  // Apply P/L filter, credit sale filter, and optional search term filter
  const filteredItems = items.filter((item) => {
    // Separate credit vs cash items based on which row was clicked
    if (isCreditSaleParam === "true" && !item.isCreditSale) return false;
    if (isCreditSaleParam === "false" && item.isCreditSale) return false;
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      const matches =
        (item.stockItemName || "").toLowerCase().includes(lower) ||
        (item.locationName || "").toLowerCase().includes(lower);
      if (!matches) return false;
    }
    if (plFilter === "all") return true;
    const value = plBasis === "cost" ? parseFloat(item.costProfit) : item.configuredProfit;
    if (plFilter === "gain") return value > 0;
    if (plFilter === "loss") return value < 0;
    return true;
  });

  // Group items by stock item name
  const itemGroupMap = new Map<number, ItemGroup>();
  filteredItems.forEach((item) => {
    if (!itemGroupMap.has(item.stockItemId)) {
      itemGroupMap.set(item.stockItemId, {
        stockItemId: item.stockItemId,
        stockItemName: item.stockItemName,
        stockItemCode: item.stockItemCode,
        totalQty: 0,
        totalSales: 0,
        totalCost: 0,
        totalConfiguredCost: 0,
        costProfit: 0,
        configuredProfit: 0,
        locationBreakdown: [],
      });
    }
    const g = itemGroupMap.get(item.stockItemId)!;
    const qty = parseFloat(item.quantity);
    g.totalQty += qty;
    g.totalSales += parseFloat(item.totalSales || "0");
    g.totalCost += parseFloat(item.totalCost || "0");
    g.totalConfiguredCost += item.totalConfiguredCost || 0;
    g.costProfit += parseFloat(item.costProfit || "0");
    g.configuredProfit += item.configuredProfit || 0;

    // Also track per-location breakdown within this item group
    // In all-companies mode, use composite key so same-named locations across companies are separate
    const locKey = allCompanies
      ? `${item.companyId ?? "?"}-${item.locationId ?? "no-location"}`
      : String(item.locationId ?? "no-location");
    const locDisplayName = allCompanies && item.companyCode
      ? `${item.companyCode} · ${item.locationName || "No Location"}`
      : (item.locationName || "No Location");
    let locSummary = g.locationBreakdown.find((l) => l.locationKey === locKey);
    if (!locSummary) {
      locSummary = {
        locationKey: locKey,
        locationId: item.locationId,
        locationName: locDisplayName,
        totalQty: 0,
        totalSales: 0,
        totalCost: 0,
        totalConfiguredCost: 0,
        costProfit: 0,
        configuredProfit: 0,
        items: [],
      };
      g.locationBreakdown.push(locSummary);
    }
    locSummary.totalQty += qty;
    locSummary.totalSales += parseFloat(item.totalSales || "0");
    locSummary.totalCost += parseFloat(item.totalCost || "0");
    locSummary.totalConfiguredCost += item.totalConfiguredCost || 0;
    locSummary.costProfit += parseFloat(item.costProfit || "0");
    locSummary.configuredProfit += item.configuredProfit || 0;
    locSummary.items.push(item);
  });

  const itemGroups = Array.from(itemGroupMap.values()).sort((a, b) =>
    a.stockItemName.localeCompare(b.stockItemName)
  );

  // Sort location breakdowns alphabetically
  itemGroups.forEach((g) => {
    g.locationBreakdown.sort((a, b) => a.locationName.localeCompare(b.locationName));
  });

  // Build a stable color map for all unique locations (all companies view or multiple locations)
  const allLocKeys = Array.from(new Set(filteredItems.map((i) =>
    allCompanies ? `${i.companyId ?? "?"}-${i.locationId ?? "no-location"}` : String(i.locationId ?? "no-location")
  )));
  const locationColorMap = new Map<string, typeof LOCATION_PALETTE[0]>();
  allLocKeys.forEach((key, idx) => {
    locationColorMap.set(key, LOCATION_PALETTE[idx % LOCATION_PALETTE.length]);
  });
  // Apply colors when multiple distinct locations exist (all-companies view or item sold in many locations)
  const multipleLocations = allLocKeys.length > 1;

  const toggleItem = (key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleLocation = (key: string) => {
    setExpandedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Compute unique customer name(s) for credit sale badge
  const creditCustomerNames = isCreditSaleParam === "true"
    ? [...new Set(
        filteredItems
          .map(item => item.customerName)
          .filter((n): n is string => !!n)
          .map(n => n.replace(/ - Customer Account$/i, "").trim())
      )]
    : [];
  const creditCustomerLabel = creditCustomerNames.length === 1
    ? creditCustomerNames[0]
    : creditCustomerNames.length > 1
      ? `${creditCustomerNames.length} customers`
      : null;

  const totalQty = filteredItems.reduce((sum, item) => sum + parseFloat(item.quantity), 0);
  const totalSales = filteredItems.reduce((sum, item) => sum + parseFloat(item.totalSales || "0"), 0);
  const totalCost = filteredItems.reduce((sum, item) => sum + parseFloat(item.totalCost || "0"), 0);
  const totalConfiguredCost = filteredItems.reduce((sum, item) => sum + (item.totalConfiguredCost || 0), 0);
  const costProfit = totalSales - totalCost;
  const configuredProfit = totalSales - totalConfiguredCost;

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 w-full min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()} data-testid="button-back-to-sales-report">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            Sales Details — {displayDate}
            {isCreditSaleParam === "true" && (
              <Badge variant="outline" className="text-sm text-amber-600 border-amber-400 dark:text-amber-400 dark:border-amber-600">
                Credit Sales{creditCustomerLabel ? ` · ${creditCustomerLabel}` : ""}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            All items sold {grouping === "daily" ? "on this day" : grouping === "monthly" ? "this month" : "this year"}
            {searchTerm && <span className="ml-1 text-muted-foreground/70">· filtered by "{searchTerm}"</span>}
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
                Hassan's P/L
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
          {/* Summary Cards */}
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
                <CardTitle className={`text-lg ${profitColor(costProfit)}`}>
                  {formatAmount(Math.abs(costProfit))}
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
                <CardTitle className={`text-lg ${profitColor(configuredProfit)}`}>
                  {formatAmount(Math.abs(configuredProfit))}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Item-grouped table */}
          <Card>
            <CardContent className="p-0">
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="w-6"></TableHead>
                      <TableHead>Item / Location</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price / Bale</TableHead>
                      <TableHead className="text-right">Total Sales</TableHead>
                      <TableHead className="text-right">Hassan's Price</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">Cost Profit</TableHead>
                      <TableHead className="text-right">Cost %</TableHead>
                      <TableHead className="text-right">Hassan's Profit</TableHead>
                      <TableHead className="text-right">Hassan's %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemGroups.map((group) => {
                      const itemKey = String(group.stockItemId);
                      const isExpanded = expandedItems.has(itemKey);
                      const costPct = group.totalSales > 0 ? (group.costProfit / group.totalSales) * 100 : 0;
                      const configPct = group.totalConfiguredCost > 0 ? (group.configuredProfit / group.totalConfiguredCost) * 100 : 0;
                      return (
                        <>
                          {/* Item summary row */}
                          <TableRow
                            key={`item-${itemKey}`}
                            data-testid={`row-item-${itemKey}`}
                            className="cursor-pointer bg-muted/30 hover-elevate font-medium"
                            onClick={() => toggleItem(itemKey)}
                          >
                            <TableCell className="py-2 pr-0 w-6">
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              }
                            </TableCell>
                            <TableCell className="py-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span>{group.stockItemName}</span>
                                {multipleLocations && group.locationBreakdown.length > 1 ? (
                                  <div className="flex items-center gap-1">
                                    {group.locationBreakdown.map((loc) => {
                                      const color = locationColorMap.get(loc.locationKey);
                                      return color ? (
                                        <span key={loc.locationKey} title={loc.locationName} className={`inline-block h-2 w-2 rounded-full ${color.dot}`} />
                                      ) : null;
                                    })}
                                    <span className="text-xs text-muted-foreground">{group.locationBreakdown.length} locs</span>
                                  </div>
                                ) : (
                                  <Badge variant="secondary" className="text-xs font-normal">
                                    {group.locationBreakdown.length} loc{group.locationBreakdown.length !== 1 ? "s" : ""}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono py-2">{formatNumber(group.totalQty)}</TableCell>
                            <TableCell className="text-right font-mono py-2">
                              {group.totalQty > 0 ? formatAmount(group.totalSales / group.totalQty) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono py-2">{formatAmount(group.totalSales)}</TableCell>
                            <TableCell className="text-right font-mono py-2">
                              {group.totalQty > 0 ? formatAmount(group.totalConfiguredCost / group.totalQty) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono py-2">{formatAmount(group.totalCost)}</TableCell>
                            <TableCell className={`text-right font-mono py-2 ${profitColor(group.costProfit)}`}>
                              {formatAmount(Math.abs(group.costProfit))}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm py-2 ${profitColor(costPct)}`}>
                              {Math.abs(costPct).toFixed(1)}%
                            </TableCell>
                            <TableCell className={`text-right font-mono py-2 ${profitColor(group.configuredProfit)}`}>
                              {formatAmount(Math.abs(group.configuredProfit))}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-sm py-2 ${profitColor(configPct)}`}>
                              {Math.abs(configPct).toFixed(1)}%
                            </TableCell>
                          </TableRow>

                          {/* Expanded: per-location totals */}
                          {isExpanded && group.locationBreakdown.map((loc) => {
                            const locRowKey = `${itemKey}-${loc.locationKey}`;
                            const isLocExpanded = expandedLocations.has(locRowKey);
                            const locCostPct = loc.totalSales > 0 ? (loc.costProfit / loc.totalSales) * 100 : 0;
                            const locConfigPct = loc.totalConfiguredCost > 0 ? (loc.configuredProfit / loc.totalConfiguredCost) * 100 : 0;
                            return (
                              <>
                                {/* Location summary row for this item */}
                                <TableRow
                                  key={`loc-${locRowKey}`}
                                  data-testid={`row-loc-${locRowKey}`}
                                  className="cursor-pointer hover-elevate text-sm"
                                  onClick={() => toggleLocation(locRowKey)}
                                >
                                  <TableCell className="py-1.5 pr-0 w-6 pl-8">
                                    {isLocExpanded
                                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    }
                                  </TableCell>
                                  <TableCell className="py-1.5 pl-4">
                                    <div className="flex items-center gap-2">
                                      {multipleLocations && (() => {
                                        const color = locationColorMap.get(loc.locationKey);
                                        return color ? (
                                          <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${color.dot}`} />
                                        ) : null;
                                      })()}
                                      <span className={multipleLocations ? (locationColorMap.get(loc.locationKey)?.text ?? "text-muted-foreground") : "text-muted-foreground"}>
                                        {loc.locationName}
                                      </span>
                                      {multipleLocations ? (
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-normal ${locationColorMap.get(loc.locationKey)?.badge ?? ""}`}>
                                          {loc.items.length} sale{loc.items.length !== 1 ? "s" : ""}
                                        </span>
                                      ) : (
                                        <Badge variant="outline" className="text-xs font-normal">
                                          {loc.items.length} sale{loc.items.length !== 1 ? "s" : ""}
                                        </Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right font-mono py-1.5">{formatNumber(loc.totalQty)}</TableCell>
                                  <TableCell className="text-right font-mono py-1.5">
                                    {loc.totalQty > 0 ? formatAmount(loc.totalSales / loc.totalQty) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono py-1.5">{formatAmount(loc.totalSales)}</TableCell>
                                  <TableCell className="text-right font-mono py-1.5">
                                    {loc.totalQty > 0 ? formatAmount(loc.totalConfiguredCost / loc.totalQty) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono py-1.5">{formatAmount(loc.totalCost)}</TableCell>
                                  <TableCell className={`text-right font-mono py-1.5 ${profitColor(loc.costProfit)}`}>
                                    {formatAmount(Math.abs(loc.costProfit))}
                                  </TableCell>
                                  <TableCell className={`text-right font-mono text-sm py-1.5 ${profitColor(locCostPct)}`}>
                                    {Math.abs(locCostPct).toFixed(1)}%
                                  </TableCell>
                                  <TableCell className={`text-right font-mono py-1.5 ${profitColor(loc.configuredProfit)}`}>
                                    {formatAmount(Math.abs(loc.configuredProfit))}
                                  </TableCell>
                                  <TableCell className={`text-right font-mono text-sm py-1.5 ${profitColor(locConfigPct)}`}>
                                    {Math.abs(locConfigPct).toFixed(1)}%
                                  </TableCell>
                                </TableRow>

                                {/* Individual sale records within this location */}
                                {isLocExpanded && loc.items.map((item) => (
                                  <TableRow
                                    key={item.id}
                                    data-testid={`row-detail-${item.id}`}
                                    className="text-xs bg-muted/10"
                                  >
                                    <TableCell className="py-1 w-6"></TableCell>
                                    <TableCell className="py-1 pl-10 text-muted-foreground">
                                      <span className="text-muted-foreground/60">{item.voucherDate?.slice(0, 10)}</span>
                                    </TableCell>
                                    <TableCell className="text-right font-mono py-1">{formatNumericValue(item.quantity)}</TableCell>
                                    <TableCell className="text-right font-mono py-1">{formatAmount(item.actualSellingPrice)}</TableCell>
                                    <TableCell className="text-right font-mono py-1">{formatAmount(item.totalSales)}</TableCell>
                                    <TableCell className="text-right font-mono py-1">{formatAmount(item.configuredSellingPrice)}</TableCell>
                                    <TableCell className="text-right font-mono py-1">{formatAmount(item.totalCost)}</TableCell>
                                    <TableCell className={`text-right font-mono py-1 ${profitColor(parseFloat(item.costProfit))}`}>
                                      {formatAmount(Math.abs(parseFloat(item.costProfit)))}
                                    </TableCell>
                                    <TableCell className={`text-right font-mono py-1 ${profitColor(item.costProfitPercentage)}`}>
                                      {Math.abs(item.costProfitPercentage).toFixed(1)}%
                                    </TableCell>
                                    <TableCell className={`text-right font-mono py-1 ${profitColor(item.configuredProfit)}`}>
                                      {formatAmount(Math.abs(item.configuredProfit))}
                                    </TableCell>
                                    <TableCell className={`text-right font-mono py-1 ${profitColor(item.configuredProfitPercentage)}`}>
                                      {Math.abs(item.configuredProfitPercentage).toFixed(1)}%
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </>
                            );
                          })}
                        </>
                      );
                    })}
                  </TableBody>
                  <TableFooter className="sticky bottom-0 bg-background border-t">
                    <TableRow className="font-semibold">
                      <TableCell></TableCell>
                      <TableCell>
                        Total ({itemGroups.length} item{itemGroups.length !== 1 ? "s" : ""}
                        {plFilter !== "all" ? `, ${plFilter === "gain" ? "gaining" : "losing"} only` : ""})
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(totalQty)}</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(totalSales)}</TableCell>
                      <TableCell></TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(totalCost)}</TableCell>
                      <TableCell className={`text-right font-mono ${profitColor(costProfit)}`}>
                        {formatAmount(Math.abs(costProfit))}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell className={`text-right font-mono ${profitColor(configuredProfit)}`}>
                        {formatAmount(Math.abs(configuredProfit))}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>

              {/* Mobile view — item-grouped cards */}
              <div className="md:hidden space-y-3 p-3">
                {itemGroups.map((group) => {
                  const itemKey = String(group.stockItemId);
                  const isExpanded = expandedItems.has(itemKey);
                  return (
                    <div key={itemKey}>
                      <Card
                        className={`cursor-pointer ${isExpanded ? "rounded-b-none border-b-0" : ""}`}
                        onClick={() => toggleItem(itemKey)}
                        data-testid={`card-item-${itemKey}`}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              }
                              <span className="font-medium text-sm">{group.stockItemName}</span>
                              {multipleLocations && group.locationBreakdown.length > 1 ? (
                                <div className="flex items-center gap-1">
                                  {group.locationBreakdown.map((loc) => {
                                    const color = locationColorMap.get(loc.locationKey);
                                    return color ? (
                                      <span key={loc.locationKey} title={loc.locationName} className={`inline-block h-2 w-2 rounded-full ${color.dot}`} />
                                    ) : null;
                                  })}
                                  <span className="text-xs text-muted-foreground">{group.locationBreakdown.length} locs</span>
                                </div>
                              ) : (
                                <Badge variant="secondary" className="text-xs font-normal">
                                  {group.locationBreakdown.length} loc{group.locationBreakdown.length !== 1 ? "s" : ""}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1 text-xs">
                            <div><span className="text-muted-foreground">Qty: </span><span className="font-mono">{formatNumber(group.totalQty)}</span></div>
                            <div><span className="text-muted-foreground">Sales: </span><span className="font-mono">{formatAmount(group.totalSales)}</span></div>
                            <div><span className="text-muted-foreground">Cost: </span><span className="font-mono">{formatAmount(group.totalCost)}</span></div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1 border-t text-xs">
                            <span className={`font-mono font-semibold ${profitColor(group.costProfit)}`}>
                              Cost P/L: {formatAmount(Math.abs(group.costProfit))}
                            </span>
                            <span className={`font-mono font-semibold ${profitColor(group.configuredProfit)}`}>
                              Hassan's P/L: {formatAmount(Math.abs(group.configuredProfit))}
                            </span>
                          </div>
                        </CardContent>
                      </Card>

                      {isExpanded && (
                        <div className="border border-t-0 rounded-b-md p-2 space-y-2 bg-background">
                          {group.locationBreakdown.map((loc) => {
                            const locRowKey = `${itemKey}-${loc.locationKey}`;
                            const isLocExpanded = expandedLocations.has(locRowKey);
                            return (
                              <div key={locRowKey}>
                                <Card
                                  className={`cursor-pointer ${isLocExpanded ? "rounded-b-none border-b-0" : ""}`}
                                  onClick={() => toggleLocation(locRowKey)}
                                  data-testid={`card-loc-${locRowKey}`}
                                >
                                  <CardContent className="p-2 space-y-1">
                                    <div className="flex items-center gap-2">
                                      {isLocExpanded
                                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                      }
                                      {multipleLocations && (() => {
                                        const color = locationColorMap.get(loc.locationKey);
                                        return color ? <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${color.dot}`} /> : null;
                                      })()}
                                      <span className={`text-sm font-medium ${multipleLocations ? (locationColorMap.get(loc.locationKey)?.text ?? "") : ""}`}>
                                        {loc.locationName}
                                      </span>
                                      {multipleLocations ? (
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-normal ${locationColorMap.get(loc.locationKey)?.badge ?? ""}`}>
                                          {loc.items.length} sale{loc.items.length !== 1 ? "s" : ""}
                                        </span>
                                      ) : (
                                        <Badge variant="outline" className="text-xs font-normal">
                                          {loc.items.length} sale{loc.items.length !== 1 ? "s" : ""}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-1 text-xs pl-5">
                                      <div><span className="text-muted-foreground">Qty: </span><span className="font-mono">{formatNumber(loc.totalQty)}</span></div>
                                      <div><span className="text-muted-foreground">Sales: </span><span className="font-mono">{formatAmount(loc.totalSales)}</span></div>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 pt-1 border-t text-xs pl-5">
                                      <span className={`font-mono ${profitColor(loc.costProfit)}`}>
                                        Cost: {formatAmount(Math.abs(loc.costProfit))}
                                      </span>
                                      <span className={`font-mono ${profitColor(loc.configuredProfit)}`}>
                                        Hassan's: {formatAmount(Math.abs(loc.configuredProfit))}
                                      </span>
                                    </div>
                                  </CardContent>
                                </Card>

                                {isLocExpanded && (
                                  <div className="border border-t-0 rounded-b-md p-2 space-y-1 bg-muted/10">
                                    {loc.items.map((item) => (
                                      <div key={item.id} className="text-xs p-1 border-b last:border-b-0">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-muted-foreground/60">{item.voucherDate?.slice(0, 10)}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-1 mt-1">
                                          <div><span className="text-muted-foreground">Qty: </span><span className="font-mono">{formatNumericValue(item.quantity)}</span></div>
                                          <div><span className="text-muted-foreground">Sales: </span><span className="font-mono">{formatAmount(item.totalSales)}</span></div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
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
