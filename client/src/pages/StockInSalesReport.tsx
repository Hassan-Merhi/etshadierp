import { useEffect, useMemo, useState, type LucideIcon } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  Coins,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  GitCompare,
  GitMerge,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useToast } from "@/hooks/use-toast";
import { ExcelJS, writeFile } from "@/lib/excelHelper";
import { formatNumber } from "@/lib/formatNumber";
import StockInSalesReportComparison from "./StockInSalesReportComparison";
import StockInSalesReportDetail from "./StockInSalesReportDetail";

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
            <Checkbox checked={selectedIds.length === 0} className="pointer-events-none h-4 w-4" />
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
                onClick={() => onChange(selected ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])}
                data-testid={`${testId}-option-${item.id}`}
              >
                <Checkbox checked={selected} className="pointer-events-none h-4 w-4" />
                <span className="text-sm">{item.name}</span>
              </div>
            );
          })}
          {items.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No options available</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SummaryPill({
  label,
  value,
  icon: Icon,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
  testId: string;
}) {
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
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "detail") {
    return <StockInSalesReportDetail />;
  }
  if (view === "comparison") {
    return <StockInSalesReportComparison />;
  }

  const { selectedCompany } = useCompany();
  const { formatAmount, selectedCurrency, convertToDisplay } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();

  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("all_time"));
  const [grouping, setGrouping] = useState<GroupingType>("yearly");
  const [profitFilter, setProfitFilter] = useState<ProfitFilter>("all");
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedStockGroups, setSelectedStockGroups] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

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

  const sortedLocations = useMemo(() => [...locations].sort((a, b) => a.name.localeCompare(b.name)), [locations]);
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
    staleTime: 30_000,
  });

  const summary = data?.summary ?? EMPTY_METRICS;
  const rows = data?.rows ?? [];
  const formatSignedAmount = (value: number) =>
    value < 0 ? `-${formatAmount(Math.abs(value))}` : formatAmount(value);
  const formatRate = (value: number) =>
    selectedCurrency === "CFA" ? `CFA ${formatNumber(convertToDisplay(value), 2)}` : `$ ${formatNumber(value, 6)}`;
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

  const openDetail = (row: StockInSalesRow) => {
    const params = new URLSearchParams({
      view: "detail",
      startDate: row.periodStart,
      endDate: row.periodEnd,
      periodLabel: formatPeriodLabel(row),
    });
    if (selectedLocations.length > 0) params.set("locationIds", selectedLocations.join(","));
    if (selectedStockGroups.length > 0) params.set("stockGroupIds", selectedStockGroups.join(","));
    if (debouncedSearch) params.set("search", debouncedSearch);
    window.location.assign(`/stock-in-sales-report?${params.toString()}`);
  };

  const openComparison = () => {
    const params = new URLSearchParams({ view: "comparison", grouping });
    if (periodFilter.fromDate) params.set("startDate", periodFilter.fromDate);
    if (periodFilter.toDate) params.set("endDate", periodFilter.toDate);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (selectedLocations[0]) params.set("sideALocationId", selectedLocations[0]);
    if (selectedLocations[1]) params.set("sideBLocationId", selectedLocations[1]);
    if (selectedStockGroups.length > 0) {
      params.set("sideAStockGroupIds", selectedStockGroups.join(","));
      params.set("sideBStockGroupIds", selectedStockGroups.join(","));
    }
    window.location.assign(`/stock-in-sales-report?${params.toString()}`);
  };

  const exportExcel = async () => {
    if (!data || rows.length === 0) return;
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [
        { header: "Metric", key: "metric", width: 28 },
        { header: "Value", key: "value", width: 20 },
      ];
      [
        ["Company", selectedCompany?.name || "Current Company"],
        ["Period", periodFilter.preset === "all_time" ? "All Time" : `${periodFilter.fromDate} to ${periodFilter.toDate}`],
        ["Grouping", grouping],
        ["Stock In Qty", summary.stockInQty],
        ["Stock In Value", summary.stockInValue],
        ["Average In Rate", summary.stockInAvgRate],
        ["Stock Out Qty", summary.stockOutQty],
        ["Total Sales", summary.totalSales],
        ["Cost of Sales", summary.costOfSales],
        ["Cost Profit", summary.costProfit],
        ["Average Profit / Bale", summary.avgProfitPerBale],
      ].forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
      summarySheet.getRow(1).font = { bold: true };

      const periodsSheet = workbook.addWorksheet("Periods");
      periodsSheet.columns = [
        { header: "Period", key: "period", width: 20 },
        { header: "Stock In Qty", key: "stockInQty", width: 16 },
        { header: "Stock In Value", key: "stockInValue", width: 18 },
        { header: "Avg In Rate", key: "stockInAvgRate", width: 16 },
        { header: "Stock Out Qty", key: "stockOutQty", width: 16 },
        { header: "Total Sales", key: "totalSales", width: 18 },
        { header: "Cost", key: "costOfSales", width: 18 },
        { header: "Cost Profit", key: "costProfit", width: 18 },
        { header: "Avg Profit / Bale", key: "avgProfitPerBale", width: 18 },
      ];
      rows.forEach((row) => periodsSheet.addRow({ period: formatPeriodLabel(row), ...row }));
      periodsSheet.getRow(1).font = { bold: true };
      periodsSheet.getColumn("stockInQty").numFmt = "#,##0.000";
      periodsSheet.getColumn("stockOutQty").numFmt = "#,##0.000";
      periodsSheet.getColumn("stockInAvgRate").numFmt = "#,##0.000000";
      periodsSheet.getColumn("avgProfitPerBale").numFmt = "#,##0.000000";
      ["stockInValue", "totalSales", "costOfSales", "costProfit"].forEach((key) => {
        periodsSheet.getColumn(key).numFmt = "#,##0.00";
      });

      await writeFile(workbook, `stock-in-sales-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    } catch (exportError: any) {
      toast({
        title: "Export failed",
        description: exportError?.message || "Unable to create the Excel file.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
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
            className="mt-0.5 gap-1.5 print:hidden"
            onClick={() => (window.location.href = "/sales-report")}
            data-testid="button-back-stock-in-sales"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <PageHeader title="Stock In & Sales Report" />
            <p className="text-sm text-muted-foreground">
              Compare landed container stock with net sales, cost, and profit
              {selectedCompany?.name ? ` · ${selectedCompany.name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={openComparison}
            data-testid="button-stock-in-sales-compare"
          >
            <GitCompare className="mr-2 h-4 w-4" /> Compare
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={rows.length === 0 || isExporting}
                data-testid="button-stock-in-sales-export"
              >
                {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportExcel} data-testid="menu-stock-in-sales-export-excel">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Export Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()} data-testid="menu-stock-in-sales-export-pdf">
                <FileText className="mr-2 h-4 w-4" /> Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-busy={isLoading || isFetching}>
        {isLoading ? (
          Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-40 rounded-lg" />)
        ) : (
          <>
            <SummaryPill label="Stock In Qty" value={formatNumber(summary.stockInQty, 3)} icon={PackagePlus} testId="text-stock-in-qty" />
            <SummaryPill label="Stock In Value" value={formatAmount(summary.stockInValue)} icon={Coins} testId="text-stock-in-value" />
            <SummaryPill label="Avg In Rate" value={formatRate(summary.stockInAvgRate)} icon={Gauge} testId="text-stock-in-avg-rate" />
            <SummaryPill label="Stock Out Qty" value={formatNumber(summary.stockOutQty, 3)} icon={PackageMinus} testId="text-stock-out-qty" />
            <SummaryPill label="Total Sales" value={formatAmount(summary.totalSales)} icon={TrendingUp} testId="text-stock-in-sales-total-sales" />
            <SummaryPill label="Cost of Sales" value={formatAmount(summary.costOfSales)} icon={BarChart3} testId="text-stock-in-sales-cost" />
            <SummaryPill label="Cost Profit" value={formatSignedAmount(summary.costProfit)} icon={summary.costProfit < 0 ? TrendingDown : TrendingUp} tone={profitTone} testId="text-stock-in-sales-profit" />
            <SummaryPill label="Avg Profit/Bale" value={formatSignedAmount(summary.avgProfitPerBale)} icon={Scale} tone={avgProfitTone} testId="text-stock-in-sales-avg-profit" />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <PeriodFilter value={periodFilter} onChange={setPeriodFilter} data-testid="period-filter-stock-in-sales-report" />
        <div className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium" title={selectedCompany?.name || "Current Company"}>
          <Building2 className="h-4 w-4" /> Current Company
        </div>
        <div className="h-5 w-px bg-border" />
        <Select value={grouping} onValueChange={(value) => setGrouping(value as GroupingType)}>
          <SelectTrigger className="h-9 w-28" data-testid="select-stock-in-sales-grouping"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent>
        </Select>
        <Select value={profitFilter} onValueChange={(value) => setProfitFilter(value as ProfitFilter)}>
          <SelectTrigger className="h-9 w-36" data-testid="select-stock-in-sales-profit-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Profits</SelectItem><SelectItem value="positive">Positive Only</SelectItem><SelectItem value="negative">Negative Only</SelectItem></SelectContent>
        </Select>
        <div className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          <GitMerge className="h-4 w-4" /> Merged
        </div>
        <MultiSelectFilter label="Locations" singularLabel="Location" items={sortedLocations} selectedIds={selectedLocations} onChange={setSelectedLocations} testId="button-stock-in-sales-location-filter" />
        <MultiSelectFilter label="Groups" singularLabel="Group" items={sortedStockGroups} selectedIds={selectedStockGroups} onChange={setSelectedStockGroups} testId="button-stock-in-sales-group-filter" />
        <Input placeholder="Search..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="h-9 w-44" data-testid="input-stock-in-sales-search" />
        <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-stock-in-sales-clear">Clear</Button>
        {isFetching && !isLoading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing" />}
      </div>

      <div>
        <p className="mb-3 text-xs text-muted-foreground">
          Stock in and sales by {grouping.charAt(0).toUpperCase() + grouping.slice(1)}
          {rows.length > 0 && ` · ${rows.length} row${rows.length === 1 ? "" : "s"}`} · Click any row to drill in
        </p>
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <Table className="min-w-[1180px]">
              <TableHeader><TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Date</TableHead><TableHead className="text-right">Stock In Qty</TableHead><TableHead className="text-right">Stock In Value</TableHead>
                <TableHead className="text-right">Avg In Rate</TableHead><TableHead className="text-right">Stock Out Qty</TableHead><TableHead className="text-right">Total Sales</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Cost Profit</TableHead><TableHead className="text-right">Avg Profit/Bale</TableHead><TableHead className="w-8" />
              </TableRow></TableHeader>
              <TableBody>
                {isLoading ? Array.from({ length: 6 }).map((_, index) => <TableRow key={index}>{Array.from({ length: 10 }).map((__, cellIndex) => <TableCell key={cellIndex}><Skeleton className={`h-4 ${cellIndex === 0 ? "w-24" : "ml-auto w-20"}`} /></TableCell>)}</TableRow>) :
                isError ? <TableRow><TableCell colSpan={10}><div className="flex flex-col items-center gap-3 py-10 text-center"><TrendingDown className="h-6 w-6 text-destructive" /><p className="text-sm font-medium">Unable to load the report</p><p className="text-xs text-muted-foreground">{error?.message}</p><Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div></TableCell></TableRow> :
                rows.length === 0 ? <TableRow><TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">No stock-in or sales activity found. Try adjusting the filters.</TableCell></TableRow> : <>
                  {rows.map((row) => {
                    const profitClass = row.costProfit > 0 ? "text-emerald-600 dark:text-emerald-400" : row.costProfit < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
                    const avgClass = row.avgProfitPerBale > 0 ? "text-emerald-600 dark:text-emerald-400" : row.avgProfitPerBale < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground";
                    return <TableRow key={row.periodKey} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(row)} data-testid={`row-stock-in-sales-${row.periodKey}`}>
                      <TableCell className="py-3 font-medium">{formatPeriodLabel(row)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatNumber(row.stockInQty, 3)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatAmount(row.stockInValue)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm text-muted-foreground">{formatRate(row.stockInAvgRate)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatNumber(row.stockOutQty, 3)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatAmount(row.totalSales)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm text-muted-foreground">{formatAmount(row.costOfSales)}</TableCell>
                      <TableCell className={`py-3 text-right font-mono text-sm font-semibold ${profitClass}`}>{formatSignedAmount(row.costProfit)}</TableCell>
                      <TableCell className={`py-3 text-right font-mono text-sm font-semibold ${avgClass}`}>{formatSignedAmount(row.avgProfitPerBale)}</TableCell>
                      <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                    </TableRow>;
                  })}
                  <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                    <TableCell className="py-3 text-xs uppercase tracking-wide text-muted-foreground">Total</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(summary.stockInQty, 3)}</TableCell>
                    <TableCell className="text-right font-mono">{formatAmount(summary.stockInValue)}</TableCell>
                    <TableCell className="text-right font-mono">{formatRate(summary.stockInAvgRate)}</TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(summary.stockOutQty, 3)}</TableCell>
                    <TableCell className="text-right font-mono">{formatAmount(summary.totalSales)}</TableCell>
                    <TableCell className="text-right font-mono">{formatAmount(summary.costOfSales)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSignedAmount(summary.costProfit)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSignedAmount(summary.avgProfitPerBale)}</TableCell><TableCell />
                  </TableRow>
                </>}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <div className="hidden print:block text-xs text-muted-foreground">Generated {format(new Date(), "yyyy-MM-dd HH:mm")}</div>
    </div>
  );
}
