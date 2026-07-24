import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useLocation } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ChevronDown,
  Coins,
  Download,
  Gauge,
  GitCompare,
  GitMerge,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  PeriodFilter,
  getDefaultPeriodValue,
  type PeriodFilterValue,
} from "@/components/ui/period-filter";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { formatNumber } from "@/lib/formatNumber";

interface LocationOption {
  id: number;
  name: string;
}

interface StockGroupOption {
  id: number;
  name: string;
}

type GroupingType = "daily" | "monthly" | "yearly";
type ProfitFilter = "all" | "positive" | "negative";

interface StockInSalesMetrics {
  stockInQty: number;
  stockInValue: number;
  stockInAvgRate: number;
  stockOutQty: number;
  totalSales: number;
  costOfSales: number;
  costProfit: number;
  avgProfitPerBale: number;
}

interface StockInSalesRow extends StockInSalesMetrics {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

interface StockInSalesResponse {
  generatedAt: string;
  filters: {
    startDate?: string;
    endDate?: string;
    grouping: GroupingType;
    profitFilter: ProfitFilter;
    locationIds: number[];
    stockGroupIds: number[];
    search?: string;
  };
  summary: StockInSalesMetrics;
  rows: StockInSalesRow[];
  rowCount: number;
}

interface MultiSelectFilterProps<T extends { id: number; name: string }> {
  label: string;
  singularLabel: string;
  items: T[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  testId: string;
}

function MultiSelectFilter<T extends { id: number; name: string }>({
  label,
  singularLabel,
  items,
  selectedIds,
  onChange,
  testId,
}: MultiSelectFilterProps<T>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid={testId}>
          {selectedIds.length === 0
            ? `All ${label}`
            : `${selectedIds.length} ${singularLabel}${selectedIds.length === 1 ? "" : "s"}`}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="max-h-72 space-y-1 overflow-y-auto">
          <div
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover-elevate"
            onClick={() => onChange([])}
            data-testid={`${testId}-all`}
          >
            <Checkbox checked={selectedIds.length === 0} className="h-4 w-4 pointer-events-none" />
            <span className="text-sm font-medium">All {label}</span>
          </div>
          <div className="my-1 border-t" />
          {items.map((item) => {
            const id = String(item.id);
            const selected = selectedIds.includes(id);
            return (
              <div
                key={item.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover-elevate"
                onClick={() =>
                  onChange(selected ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
                }
                data-testid={`${testId}-option-${item.id}`}
              >
                <Checkbox checked={selected} className="h-4 w-4 pointer-events-none" />
                <span className="text-sm">{item.name}</span>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">No options available</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface SummaryPillProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
  testId: string;
}

function SummaryPill({ label, value, icon: Icon, tone = "default", testId }: SummaryPillProps) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";

  return (
    <div className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm">
      <Icon className={`h-3.5 w-3.5 ${tone === "default" ? "text-muted-foreground" : toneClass}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold ${toneClass}`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

const EMPTY_METRICS: StockInSalesMetrics = {
  stockInQty: 0,
  stockInValue: 0,
  stockInAvgRate: 0,
  stockOutQty: 0,
  totalSales: 0,
  costOfSales: 0,
  costProfit: 0,
  avgProfitPerBale: 0,
};

export default function StockInSalesReport() {
  const [, navigate] = useLocation();
  const { selectedCompany } = useCompany();
  const { formatAmount, selectedCurrency, convertToDisplay } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();

  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("all_time"));
  const [grouping, setGrouping] = useState<GroupingType>("yearly");
  const [profitFilter, setProfitFilter] = useState<ProfitFilter>("all");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedStockGroups, setSelectedStockGroups] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setSelectedLocations([]);
    setSelectedStockGroups([]);
  }, [selectedCompany?.id]);

  const { data: locations = [] } = useQuery<LocationOption[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: stockGroups = [] } = useQuery<StockGroupOption[]>({
    queryKey: ["/api/stock-groups", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    staleTime: 5 * 60 * 1000,
  });

  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );
  const sortedStockGroups = useMemo(
    () => [...stockGroups].sort((a, b) => a.name.localeCompare(b.name)),
    [stockGroups]
  );

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (periodFilter.fromDate) params.set("startDate", periodFilter.fromDate);
    if (periodFilter.toDate) params.set("endDate", periodFilter.toDate);
    params.set("grouping", grouping);
    params.set("profitFilter", profitFilter);
    if (selectedLocations.length > 0) params.set("locationIds", selectedLocations.join(","));
    if (selectedStockGroups.length > 0) params.set("stockGroupIds", selectedStockGroups.join(","));
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/reports/stock-in-sales?${params.toString()}`;
  }, [periodFilter, grouping, profitFilter, selectedLocations, selectedStockGroups, debouncedSearch]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<StockInSalesResponse, Error>({
    queryKey: [queryUrl, selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const summary = data?.summary ?? EMPTY_METRICS;
  const rows = data?.rows ?? [];

  const formatSignedAmount = (value: number) =>
    value < 0 ? `-${formatAmount(Math.abs(value))}` : formatAmount(value);

  const formatRate = (value: number) => {
    if (selectedCurrency === "CFA") {
      return `CFA ${formatNumber(convertToDisplay(value), 2)}`;
    }
    return `$ ${formatNumber(value, 6)}`;
  };

  const formatPeriodLabel = (row: StockInSalesRow) => {
    if (grouping === "yearly") return row.periodKey;
    if (grouping === "monthly") {
      try {
        return format(parseISO(`${row.periodKey}-01`), "MMMM yyyy");
      } catch {
        return row.periodKey;
      }
    }
    try {
      return formatDisplayDate(parseISO(row.periodKey));
    } catch {
      return row.periodKey;
    }
  };

  const clearFilters = () => {
    setPeriodFilter(getDefaultPeriodValue("all_time"));
    setGrouping("yearly");
    setProfitFilter("all");
    setSelectedLocations([]);
    setSelectedStockGroups([]);
    setSearchTerm("");
    setDebouncedSearch("");
  };

  const profitTone = summary.costProfit > 0 ? "positive" : summary.costProfit < 0 ? "negative" : "default";
  const avgProfitTone =
    summary.avgProfitPerBale > 0 ? "positive" : summary.avgProfitPerBale < 0 ? "negative" : "default";

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 gap-1.5"
            onClick={() => navigate("/sales-report")}
            data-testid="button-back-stock-in-sales"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <PageHeader title="Stock In & Sales Report" />
            <p className="text-sm text-muted-foreground">
              Compare landed container stock with net sales, cost, and profit
              {selectedCompany?.name ? ` · ${selectedCompany.name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Location and stock-group comparison is added in Phase 4"
            data-testid="button-stock-in-sales-compare"
          >
            <GitCompare className="mr-2 h-4 w-4" />
            Compare
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled
            title="Excel and PDF exports are added in Phase 3"
            data-testid="button-stock-in-sales-export"
          >
            <Download className="h-4 w-4" />
            Export
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-busy={isLoading || isFetching}>
        {isLoading ? (
          Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-40 rounded-lg" />)
        ) : (
          <>
            <SummaryPill
              label="Stock In Qty"
              value={formatNumber(summary.stockInQty, 3)}
              icon={PackagePlus}
              testId="text-stock-in-qty"
            />
            <SummaryPill
              label="Stock In Value"
              value={formatAmount(summary.stockInValue)}
              icon={Coins}
              testId="text-stock-in-value"
            />
            <SummaryPill
              label="Avg In Rate"
              value={formatRate(summary.stockInAvgRate)}
              icon={Gauge}
              testId="text-stock-in-avg-rate"
            />
            <SummaryPill
              label="Stock Out Qty"
              value={formatNumber(summary.stockOutQty, 3)}
              icon={PackageMinus}
              testId="text-stock-out-qty"
            />
            <SummaryPill
              label="Total Sales"
              value={formatAmount(summary.totalSales)}
              icon={TrendingUp}
              testId="text-stock-in-sales-total-sales"
            />
            <SummaryPill
              label="Cost of Sales"
              value={formatAmount(summary.costOfSales)}
              icon={BarChart3}
              testId="text-stock-in-sales-cost"
            />
            <SummaryPill
              label="Cost Profit"
              value={formatSignedAmount(summary.costProfit)}
              icon={summary.costProfit < 0 ? TrendingDown : TrendingUp}
              tone={profitTone}
              testId="text-stock-in-sales-profit"
            />
            <SummaryPill
              label="Avg Profit/Bale"
              value={formatSignedAmount(summary.avgProfitPerBale)}
              icon={Scale}
              tone={avgProfitTone}
              testId="text-stock-in-sales-avg-profit"
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PeriodFilter
          value={periodFilter}
          onChange={setPeriodFilter}
          data-testid="period-filter-stock-in-sales-report"
        />

        <div
          className="flex h-9 cursor-default items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium"
          title={selectedCompany?.name || "Current Company"}
          data-testid="button-stock-in-sales-current-company"
        >
          <Building2 className="h-4 w-4" />
          Current Company
        </div>

        <div className="h-5 w-px bg-border" />

        <Select value={grouping} onValueChange={(value) => setGrouping(value as GroupingType)}>
          <SelectTrigger className="h-9 w-28" data-testid="select-stock-in-sales-grouping">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>

        <Select value={profitFilter} onValueChange={(value) => setProfitFilter(value as ProfitFilter)}>
          <SelectTrigger className="h-9 w-36" data-testid="select-stock-in-sales-profit-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Profits</SelectItem>
            <SelectItem value="positive">Positive Only</SelectItem>
            <SelectItem value="negative">Negative Only</SelectItem>
          </SelectContent>
        </Select>

        <div
          className="flex h-9 cursor-default items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          aria-label="Cash and credit sales merged"
          data-testid="button-stock-in-sales-merged"
        >
          <GitMerge className="h-4 w-4" />
          Merged
        </div>

        <MultiSelectFilter
          label="Locations"
          singularLabel="Location"
          items={sortedLocations}
          selectedIds={selectedLocations}
          onChange={setSelectedLocations}
          testId="button-stock-in-sales-location-filter"
        />

        <MultiSelectFilter
          label="Groups"
          singularLabel="Group"
          items={sortedStockGroups}
          selectedIds={selectedStockGroups}
          onChange={setSelectedStockGroups}
          testId="button-stock-in-sales-group-filter"
        />

        <Input
          placeholder="Search..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="h-9 w-44"
          data-testid="input-stock-in-sales-search"
        />

        <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-stock-in-sales-clear">
          Clear
        </Button>

        {isFetching && !isLoading && (
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing" />
        )}
      </div>

      <div>
        <p className="mb-3 text-xs text-muted-foreground">
          Stock in and sales by {grouping.charAt(0).toUpperCase() + grouping.slice(1)}
          {rows.length > 0 && ` · ${rows.length} row${rows.length === 1 ? "" : "s"}`}
        </p>

        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 text-xs font-semibold">Date</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Stock In Qty</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Stock In Value</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Avg In Rate</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Stock Out Qty</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Total Sales</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Cost</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Cost Profit</TableHead>
                  <TableHead className="h-9 text-right text-xs font-semibold">Avg Profit/Bale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 9 }).map((__, cellIndex) => (
                        <TableCell key={cellIndex}>
                          <Skeleton className={`h-4 ${cellIndex === 0 ? "w-24" : "ml-auto w-20"}`} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                          <TrendingDown className="h-5 w-5 text-destructive" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">Unable to load the report</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {error?.message || "The report request failed. Please try again."}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
                          <RefreshCw className="h-4 w-4" />
                          Retry
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <div className="flex flex-col items-center gap-2 py-10 text-center">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          <BarChart3 className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium">No stock-in or sales activity found</p>
                        <p className="text-xs text-muted-foreground">
                          Try adjusting the date range, locations, groups, or search
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((row) => {
                      const rowProfitTone =
                        row.costProfit > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : row.costProfit < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground";
                      const rowAvgProfitTone =
                        row.avgProfitPerBale > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : row.avgProfitPerBale < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground";

                      return (
                        <TableRow key={row.periodKey} data-testid={`row-stock-in-sales-${row.periodKey}`}>
                          <TableCell className="py-3 font-medium">{formatPeriodLabel(row)}</TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm">
                            {formatNumber(row.stockInQty, 3)}
                          </TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm">
                            {formatAmount(row.stockInValue)}
                          </TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm text-muted-foreground">
                            {formatRate(row.stockInAvgRate)}
                          </TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm">
                            {formatNumber(row.stockOutQty, 3)}
                          </TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm">
                            {formatAmount(row.totalSales)}
                          </TableCell>
                          <TableCell className="py-3 text-right font-mono text-sm text-muted-foreground">
                            {formatAmount(row.costOfSales)}
                          </TableCell>
                          <TableCell className={`py-3 text-right font-mono text-sm font-semibold ${rowProfitTone}`}>
                            {formatSignedAmount(row.costProfit)}
                          </TableCell>
                          <TableCell className={`py-3 text-right font-mono text-sm font-semibold ${rowAvgProfitTone}`}>
                            {formatSignedAmount(row.avgProfitPerBale)}
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                      <TableCell className="py-3 text-xs uppercase tracking-wide text-muted-foreground">Total</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">
                        {formatNumber(summary.stockInQty, 3)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">
                        {formatAmount(summary.stockInValue)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">
                        {formatRate(summary.stockInAvgRate)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">
                        {formatNumber(summary.stockOutQty, 3)}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatAmount(summary.totalSales)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">
                        {formatAmount(summary.costOfSales)}
                      </TableCell>
                      <TableCell
                        className={`py-3 text-right font-mono text-sm ${
                          summary.costProfit > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : summary.costProfit < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {formatSignedAmount(summary.costProfit)}
                      </TableCell>
                      <TableCell
                        className={`py-3 text-right font-mono text-sm ${
                          summary.avgProfitPerBale > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : summary.avgProfitPerBale < 0
                              ? "text-red-600 dark:text-red-400"
                              : ""
                        }`}
                      >
                        {formatSignedAmount(summary.avgProfitPerBale)}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
