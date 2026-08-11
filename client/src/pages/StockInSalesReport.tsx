import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Coins,
  Download,
  FileSpreadsheet,
  GitCompare,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PeriodFilter, getDefaultPeriodValue, type PeriodFilterValue } from "@/components/ui/period-filter";
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

interface LocationOption { id: number; name: string }
interface StockGroupOption { id: number; name: string }
type GroupingType = "daily" | "monthly" | "yearly";
type ProfitFilter = "all" | "positive" | "negative";

interface StockInSalesMetrics {
  openingStockQty: number;
  openingStockValue: number;
  stockInQty: number;
  stockInValue: number;
  stockInAvgRate: number;
  stockAdjustmentQty: number;
  stockAdjustmentValue: number;
  totalAvailableQty: number;
  stockOutQty: number;
  stockOutValue: number;
  closingStockQty: number;
  closingStockValue: number;
  totalSales: number;
  costOfSales: number;
  costProfit: number;
  avgProfitPerBale: number;
  salesOutQty?: number;
  salesOutValue?: number;
  transferOutQty?: number;
  transferOutValue?: number;
  otherStockOutQty?: number;
  otherStockOutValue?: number;
  netSalesQty?: number;
}

interface StockInSalesRow extends StockInSalesMetrics { periodKey: string; periodStart: string; periodEnd: string }
interface StockInSalesResponse { generatedAt: string; summary: StockInSalesMetrics; rows: StockInSalesRow[]; rowCount: number }

interface MultiSelectFilterProps<T extends { id: number; name: string }> {
  label: string; singularLabel: string; items: T[]; selectedIds: string[]; onChange: (ids: string[]) => void; testId: string;
}

function MultiSelectFilter<T extends { id: number; name: string }>({ label, singularLabel, items, selectedIds, onChange, testId }: MultiSelectFilterProps<T>) {
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="outline" size="sm" className="gap-1.5" data-testid={testId}>{selectedIds.length === 0 ? `All ${label}` : `${selectedIds.length} ${singularLabel}${selectedIds.length === 1 ? "" : "s"}`}<ChevronDown className="h-3 w-3" /></Button></PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start"><div className="max-h-72 space-y-1 overflow-y-auto">
        <div className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover-elevate" onClick={() => onChange([])} data-testid={`${testId}-all`}><Checkbox checked={selectedIds.length === 0} className="pointer-events-none h-4 w-4" /><span className="text-sm font-medium">All {label}</span></div>
        <div className="my-1 border-t" />
        {items.map((item) => { const id = String(item.id); const selected = selectedIds.includes(id); return <div key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover-elevate" onClick={() => onChange(selected ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])} data-testid={`${testId}-option-${item.id}`}><Checkbox checked={selected} className="pointer-events-none h-4 w-4" /><span className="text-sm">{item.name}</span></div>; })}
        {items.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No options available</p>}
      </div></PopoverContent>
    </Popover>
  );
}

function SummaryPill({ label, value, icon: Icon, tone = "default", testId }: { label: string; value: string; icon: LucideIcon; tone?: "default" | "positive" | "negative"; testId: string }) {
  const toneClass = tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : tone === "negative" ? "text-red-600 dark:text-red-400" : "text-foreground";
  return <div className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm"><Icon className={`h-3.5 w-3.5 ${tone === "default" ? "text-muted-foreground" : toneClass}`} /><span className="text-xs text-muted-foreground">{label}</span><span className={`font-mono text-sm font-semibold ${toneClass}`} data-testid={testId}>{value}</span></div>;
}

const EMPTY_METRICS: StockInSalesMetrics = {
  openingStockQty: 0, openingStockValue: 0, stockInQty: 0, stockInValue: 0, stockInAvgRate: 0, stockAdjustmentQty: 0, stockAdjustmentValue: 0, totalAvailableQty: 0, stockOutQty: 0, stockOutValue: 0, closingStockQty: 0, closingStockValue: 0, totalSales: 0, costOfSales: 0, costProfit: 0, avgProfitPerBale: 0,
};

export default function StockInSalesReport() {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "detail") return <StockInSalesReportDetail />;
  if (view === "comparison") return <StockInSalesReportComparison />;
  return <StockInSalesReportSummary />;
}

function StockInSalesReportSummary() {
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

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300); return () => window.clearTimeout(timer); }, [searchTerm]);
  useEffect(() => { setSelectedLocations([]); setSelectedStockGroups([]); }, [selectedCompany?.id]);

  const { data: locations = [] } = useQuery<LocationOption[]>({ queryKey: ["/api/locations", selectedCompany?.id], enabled: !!selectedCompany?.id, staleTime: 5 * 60 * 1000 });
  const { data: stockGroups = [] } = useQuery<StockGroupOption[]>({ queryKey: ["/api/stock-groups", selectedCompany?.id], enabled: !!selectedCompany?.id, staleTime: 5 * 60 * 1000 });
  const sortedLocations = useMemo(() => [...locations].sort((a, b) => a.name.localeCompare(b.name)), [locations]);
  const sortedStockGroups = useMemo(() => [...stockGroups].sort((a, b) => a.name.localeCompare(b.name)), [stockGroups]);

  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (periodFilter.fromDate) params.set("startDate", periodFilter.fromDate);
    if (periodFilter.toDate) params.set("endDate", periodFilter.toDate);
    params.set("grouping", grouping); params.set("profitFilter", profitFilter);
    if (selectedLocations.length > 0) params.set("locationIds", selectedLocations.join(","));
    if (selectedStockGroups.length > 0) params.set("stockGroupIds", selectedStockGroups.join(","));
    if (debouncedSearch) params.set("search", debouncedSearch);
    return `/api/reports/stock-in-sales?${params.toString()}`;
  }, [periodFilter, grouping, profitFilter, selectedLocations, selectedStockGroups, debouncedSearch]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<StockInSalesResponse, Error>({ queryKey: [queryUrl, selectedCompany?.id], enabled: !!selectedCompany?.id, staleTime: 30_000 });
  const summary = data?.summary ?? EMPTY_METRICS;
  const rows = data?.rows ?? [];
  const formatSignedAmount = (value: number) => value < 0 ? `-${formatAmount(Math.abs(value))}` : formatAmount(value);
  const formatRate = (value: number) => selectedCurrency === "CFA" ? `CFA ${formatNumber(convertToDisplay(value), 2)}` : `$ ${formatNumber(value, 6)}`;
  const formatPeriodLabel = (row: StockInSalesRow) => {
    if (grouping === "yearly") return row.periodKey;
    if (grouping === "monthly") { try { return format(parseISO(`${row.periodKey}-01`), "MMMM yyyy"); } catch { return row.periodKey; } }
    try { return formatDisplayDate(parseISO(row.periodKey)); } catch { return row.periodKey; }
  };

  const clearFilters = () => { setPeriodFilter(getDefaultPeriodValue("all_time")); setGrouping("yearly"); setProfitFilter("all"); setSelectedLocations([]); setSelectedStockGroups([]); setSearchTerm(""); setDebouncedSearch(""); };
  const openDetail = (row: StockInSalesRow) => {
    const params = new URLSearchParams({ view: "detail", startDate: row.periodStart, endDate: row.periodEnd, periodLabel: formatPeriodLabel(row) });
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
    if (selectedStockGroups.length > 0) { params.set("sideAStockGroupIds", selectedStockGroups.join(",")); params.set("sideBStockGroupIds", selectedStockGroups.join(",")); }
    window.location.assign(`/stock-in-sales-report?${params.toString()}`);
  };

  const exportExcel = async () => {
    if (!data || rows.length === 0) return;
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [{ header: "Metric", key: "metric", width: 28 }, { header: "Value", key: "value", width: 20 }];
      [["Company", selectedCompany?.name || "Current Company"], ["Period", periodFilter.preset === "all_time" ? "All Time" : `${periodFilter.fromDate} to ${periodFilter.toDate}`], ["Grouping", grouping], ["Opening Stock Qty", summary.openingStockQty], ["Opening Stock Value", summary.openingStockValue], ["Stock In Qty", summary.stockInQty], ["Stock In Value", summary.stockInValue], ["Stock Adjustments", summary.stockAdjustmentQty], ["Total Available", summary.totalAvailableQty], ["Stock Out Qty", summary.stockOutQty], ["Closing Stock Qty", summary.closingStockQty], ["Closing Stock Value", summary.closingStockValue], ["Total Sales", summary.totalSales], ["Cost of Sales", summary.costOfSales], ["Gross Profit", summary.costProfit], ["Average Profit / Bale", summary.avgProfitPerBale]].forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
      summarySheet.getRow(1).font = { bold: true };
      const periodsSheet = workbook.addWorksheet("Periods");
      periodsSheet.columns = [
        { header: "Period", key: "period", width: 20 }, { header: "Opening Qty", key: "openingStockQty", width: 16 }, { header: "Opening Value", key: "openingStockValue", width: 18 }, { header: "Stock In Qty", key: "stockInQty", width: 16 }, { header: "Stock In Value", key: "stockInValue", width: 18 }, { header: "Adjustments", key: "stockAdjustmentQty", width: 16 }, { header: "Available", key: "totalAvailableQty", width: 16 }, { header: "Stock Out", key: "stockOutQty", width: 16 }, { header: "Closing Qty", key: "closingStockQty", width: 16 }, { header: "Closing Value", key: "closingStockValue", width: 18 }, { header: "Sales", key: "totalSales", width: 18 }, { header: "Cost of Sales", key: "costOfSales", width: 18 }, { header: "Gross Profit", key: "costProfit", width: 18 }, { header: "Avg Profit / Bale", key: "avgProfitPerBale", width: 18 },
      ];
      rows.forEach((row) => periodsSheet.addRow({ period: formatPeriodLabel(row), ...row }));
      periodsSheet.getRow(1).font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      await writeFile(buffer, `Stock_In_Sales_${selectedCompany?.name || "Company"}.xlsx`);
    } catch (exportError) {
      toast({ title: "Export failed", description: exportError instanceof Error ? exportError.message : "Unable to export report", variant: "destructive" });
    } finally { setIsExporting(false); }
  };

  return <div className="space-y-4 p-4 md:p-6">
    <PageHeader title="Stock In & Sales" description="Inventory flow, stock continuity and profitability" />
    <div className="flex flex-wrap items-center gap-2">
      <PeriodFilter value={periodFilter} onChange={setPeriodFilter} />
      <Select value={grouping} onValueChange={(value) => setGrouping(value as GroupingType)}><SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yearly">Yearly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="daily">Daily</SelectItem></SelectContent></Select>
      <MultiSelectFilter label="Locations" singularLabel="Location" items={sortedLocations} selectedIds={selectedLocations} onChange={setSelectedLocations} testId="filter-locations" />
      <MultiSelectFilter label="Groups" singularLabel="Group" items={sortedStockGroups} selectedIds={selectedStockGroups} onChange={setSelectedStockGroups} testId="filter-stock-groups" />
      <Select value={profitFilter} onValueChange={(value) => setProfitFilter(value as ProfitFilter)}><SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Profit</SelectItem><SelectItem value="positive">Profit Only</SelectItem><SelectItem value="negative">Loss Only</SelectItem></SelectContent></Select>
      <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search item/group..." className="w-[220px]" />
      <Button variant="outline" size="sm" onClick={clearFilters}>Clear</Button>
      <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      <Button variant="outline" size="sm" onClick={openComparison}><GitCompare className="mr-1 h-4 w-4" />Compare</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" disabled={isExporting || rows.length === 0}><Download className="mr-1 h-4 w-4" />Export</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onClick={exportExcel}><FileSpreadsheet className="mr-2 h-4 w-4" />Excel</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div>

    {isLoading ? <div className="grid grid-cols-2 gap-2 md:grid-cols-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <div className="flex flex-wrap gap-2">
      <SummaryPill label="Opening Qty" value={formatNumber(summary.openingStockQty, 0)} icon={Scale} testId="summary-opening-qty" />
      <SummaryPill label="Opening Value" value={formatAmount(summary.openingStockValue)} icon={Coins} testId="summary-opening-value" />
      <SummaryPill label="Stock In Qty" value={formatNumber(summary.stockInQty, 0)} icon={PackagePlus} testId="summary-stock-in-qty" />
      <SummaryPill label="Stock In Value" value={formatAmount(summary.stockInValue)} icon={Coins} testId="summary-stock-in-value" />
      <SummaryPill label="Adjustments" value={formatNumber(summary.stockAdjustmentQty, 0)} icon={Scale} tone={summary.stockAdjustmentQty < 0 ? "negative" : summary.stockAdjustmentQty > 0 ? "positive" : "default"} testId="summary-adjustments" />
      <SummaryPill label="Available" value={formatNumber(summary.totalAvailableQty, 0)} icon={BarChart3} testId="summary-available" />
      <SummaryPill label="Stock Out" value={formatNumber(summary.stockOutQty, 0)} icon={PackageMinus} testId="summary-stock-out" />
      <SummaryPill label="Closing Qty" value={formatNumber(summary.closingStockQty, 0)} icon={Scale} testId="summary-closing-qty" />
      <SummaryPill label="Closing Value" value={formatAmount(summary.closingStockValue)} icon={Coins} testId="summary-closing-value" />
      <SummaryPill label="Sales" value={formatAmount(summary.totalSales)} icon={TrendingUp} testId="summary-sales" />
      <SummaryPill label="Cost" value={formatAmount(summary.costOfSales)} icon={TrendingDown} testId="summary-cost" />
      <SummaryPill label="Profit" value={formatSignedAmount(summary.costProfit)} icon={summary.costProfit >= 0 ? TrendingUp : TrendingDown} tone={summary.costProfit >= 0 ? "positive" : "negative"} testId="summary-profit" />
      <SummaryPill label="Avg Profit/Bale" value={formatRate(summary.avgProfitPerBale)} icon={BarChart3} tone={summary.avgProfitPerBale >= 0 ? "positive" : "negative"} testId="summary-avg-profit" />
    </div>}

    {isError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error?.message || "Unable to load report"}</div>}

    <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow>
      <TableHead>Period</TableHead><TableHead className="text-right">Opening Qty</TableHead><TableHead className="text-right">Opening Value</TableHead><TableHead className="text-right">Stock In</TableHead><TableHead className="text-right">Stock In Value</TableHead><TableHead className="text-right">Adjustments</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Stock Out</TableHead><TableHead className="text-right">Closing Qty</TableHead><TableHead className="text-right">Closing Value</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Avg Profit/Bale</TableHead><TableHead className="w-8" />
    </TableRow></TableHeader><TableBody>
      {rows.map((row) => <TableRow key={row.periodKey} className="cursor-pointer" onClick={() => openDetail(row)} data-testid={`stock-in-sales-row-${row.periodKey}`}>
        <TableCell className="font-medium">{formatPeriodLabel(row)}</TableCell><TableCell className="text-right font-mono">{formatNumber(row.openingStockQty, 0)}</TableCell><TableCell className="text-right font-mono">{formatAmount(row.openingStockValue)}</TableCell><TableCell className="text-right font-mono">{formatNumber(row.stockInQty, 0)}</TableCell><TableCell className="text-right font-mono">{formatAmount(row.stockInValue)}</TableCell><TableCell className={`text-right font-mono ${row.stockAdjustmentQty < 0 ? "text-red-600" : row.stockAdjustmentQty > 0 ? "text-emerald-600" : ""}`}>{formatNumber(row.stockAdjustmentQty, 0)}</TableCell><TableCell className="text-right font-mono">{formatNumber(row.totalAvailableQty, 0)}</TableCell><TableCell className="text-right font-mono">{formatNumber(row.stockOutQty, 0)}</TableCell><TableCell className="text-right font-mono font-semibold">{formatNumber(row.closingStockQty, 0)}</TableCell><TableCell className="text-right font-mono">{formatAmount(row.closingStockValue)}</TableCell><TableCell className="text-right font-mono">{formatAmount(row.totalSales)}</TableCell><TableCell className="text-right font-mono">{formatAmount(row.costOfSales)}</TableCell><TableCell className={`text-right font-mono ${row.costProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatSignedAmount(row.costProfit)}</TableCell><TableCell className="text-right font-mono">{formatRate(row.avgProfitPerBale)}</TableCell><TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
      </TableRow>)}
      {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={15} className="h-24 text-center text-muted-foreground">No report activity found for the selected filters.</TableCell></TableRow>}
    </TableBody></Table></div>
    {data && <p className="text-xs text-muted-foreground">{data.rowCount} period{data.rowCount === 1 ? "" : "s"}. Opening balances carry forward into each following period, including periods with no movement.</p>}
  </div>;
}
