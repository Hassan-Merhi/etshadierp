import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
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

interface StockInSalesRow extends StockInSalesMetrics {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}
interface StockInSalesReconciliation {
  asOfDate: string;
  expectedClosingQty: number;
  expectedClosingValue: number;
  actualStockQty: number;
  actualStockValue: number;
  differenceQty: number;
  differenceValue: number;
  matches: boolean;
}
interface StockInSalesResponse {
  generatedAt: string;
  summary: StockInSalesMetrics;
  reconciliation: StockInSalesReconciliation;
  rows: StockInSalesRow[];
  rowCount: number;
}

function MultiSelectFilter<T extends { id: number; name: string }>({
  label,
  singularLabel,
  items,
  selectedIds,
  onChange,
  testId,
}: {
  label: string;
  singularLabel: string;
  items: T[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  testId: string;
}) {
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
    <div className="flex min-h-9 items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm">
      <Icon className={`h-3.5 w-3.5 ${tone === "default" ? "text-muted-foreground" : toneClass}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-semibold ${toneClass}`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

const EMPTY_METRICS: StockInSalesMetrics = {
  openingStockQty: 0,
  openingStockValue: 0,
  stockInQty: 0,
  stockInValue: 0,
  stockInAvgRate: 0,
  stockAdjustmentQty: 0,
  stockAdjustmentValue: 0,
  totalAvailableQty: 0,
  stockOutQty: 0,
  stockOutValue: 0,
  closingStockQty: 0,
  closingStockValue: 0,
  totalSales: 0,
  costOfSales: 0,
  costProfit: 0,
  avgProfitPerBale: 0,
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
  const sortedStockGroups = useMemo(() => [...stockGroups].sort((a, b) => a.name.localeCompare(b.name)), [stockGroups]);

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
  const reconciliation = data?.reconciliation;
  const formatSignedAmount = (value: number) => (value < 0 ? `-${formatAmount(Math.abs(value))}` : formatAmount(value));
  const formatSignedQty = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value, 3)}`;
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
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 22 },
      ];
      [
        ["Company", selectedCompany?.name || "Current Company"],
        ["Grouping", grouping],
        ["Opening Stock Qty", summary.openingStockQty],
        ["Opening Stock Value", summary.openingStockValue],
        ["Stock In Qty", summary.stockInQty],
        ["Stock In Value", summary.stockInValue],
        ["Stock Adjustment Qty", summary.stockAdjustmentQty],
        ["Stock Adjustment Value", summary.stockAdjustmentValue],
        ["Total Available Qty", summary.totalAvailableQty],
        ["Stock Out Qty", summary.stockOutQty],
        ["Sales Out Qty", summary.salesOutQty || 0],
        ["Transfer Out Qty", summary.transferOutQty || 0],
        ["Other Stock Out Qty", summary.otherStockOutQty || 0],
        ["Closing Stock Qty", summary.closingStockQty],
        ["Closing Stock Value", summary.closingStockValue],
        ["Total Sales", summary.totalSales],
        ["Cost of Sales", summary.costOfSales],
        ["Gross Profit", summary.costProfit],
        ["Average Profit / Bale", summary.avgProfitPerBale],
        ["Actual Inventory Qty", reconciliation?.actualStockQty || 0],
        ["Actual Inventory Value", reconciliation?.actualStockValue || 0],
        ["Inventory Difference Qty", reconciliation?.differenceQty || 0],
        ["Inventory Difference Value", reconciliation?.differenceValue || 0],
      ].forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
      summarySheet.getRow(1).font = { bold: true };

      const sheet = workbook.addWorksheet("Stock Flow");
      sheet.columns = [
        { header: "Period", key: "period", width: 20 },
        { header: "Opening Qty", key: "openingStockQty", width: 16 },
        { header: "Opening Value", key: "openingStockValue", width: 18 },
        { header: "Stock In Qty", key: "stockInQty", width: 16 },
        { header: "Stock In Value", key: "stockInValue", width: 18 },
        { header: "Adjustment Qty", key: "stockAdjustmentQty", width: 16 },
        { header: "Adjustment Value", key: "stockAdjustmentValue", width: 18 },
        { header: "Available", key: "totalAvailableQty", width: 16 },
        { header: "Stock Out", key: "stockOutQty", width: 16 },
        { header: "Sales Out", key: "salesOutQty", width: 16 },
        { header: "Transfer Out", key: "transferOutQty", width: 16 },
        { header: "Closing Qty", key: "closingStockQty", width: 16 },
        { header: "Closing Value", key: "closingStockValue", width: 18 },
        { header: "Sales", key: "totalSales", width: 18 },
        { header: "Cost of Sales", key: "costOfSales", width: 18 },
        { header: "Gross Profit", key: "costProfit", width: 18 },
        { header: "Avg Profit / Bale", key: "avgProfitPerBale", width: 18 },
      ];
      rows.forEach((row) => sheet.addRow({ period: formatPeriodLabel(row), ...row }));
      sheet.getRow(1).font = { bold: true };
      await writeFile(workbook, `stock-in-sales-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    } catch (exportError: unknown) {
      toast({
        title: "Export failed",
        description: (exportError instanceof Error ? exportError.message : "") || "Unable to create the Excel file.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    const headers = [
      "Period",
      "Opening Qty",
      "Opening Value",
      "Stock In Qty",
      "Stock In Value",
      "Adjustment Qty",
      "Adjustment Value",
      "Available",
      "Stock Out",
      "Sales Out",
      "Transfer Out",
      "Closing Qty",
      "Closing Value",
      "Sales",
      "Cost of Sales",
      "Gross Profit",
      "Avg Profit/Bale",
    ];
    const values = rows.map((row) => [
      formatPeriodLabel(row),
      row.openingStockQty,
      row.openingStockValue,
      row.stockInQty,
      row.stockInValue,
      row.stockAdjustmentQty,
      row.stockAdjustmentValue,
      row.totalAvailableQty,
      row.stockOutQty,
      row.salesOutQty || 0,
      row.transferOutQty || 0,
      row.closingStockQty,
      row.closingStockValue,
      row.totalSales,
      row.costOfSales,
      row.costProfit,
      row.avgProfitPerBale,
    ]);
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...values].map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `stock-in-sales-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  const profitTone = summary.costProfit > 0 ? "positive" : summary.costProfit < 0 ? "negative" : "default";
  const avgProfitTone =
    summary.avgProfitPerBale > 0 ? "positive" : summary.avgProfitPerBale < 0 ? "negative" : "default";
  const adjustmentTone =
    summary.stockAdjustmentQty > 0 ? "positive" : summary.stockAdjustmentQty < 0 ? "negative" : "default";

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
              Opening stock → inventory movements → stock in hand, sales, cost and profit
              {selectedCompany?.name ? ` · ${selectedCompany.name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={openComparison} data-testid="button-stock-in-sales-compare">
            <GitCompare className="mr-2 h-4 w-4" /> Compare
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" disabled={rows.length === 0 || isExporting}>
                {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export{" "}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportExcel}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Export Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}>
                <FileText className="mr-2 h-4 w-4" /> Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()}>
                <FileText className="mr-2 h-4 w-4" /> Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-busy={isLoading || isFetching}>
        {isLoading ? (
          Array.from({ length: 13 }).map((_, index) => <Skeleton key={index} className="h-9 w-40 rounded-lg" />)
        ) : (
          <>
            <SummaryPill
              label="Opening Stock Qty"
              value={formatNumber(summary.openingStockQty, 3)}
              icon={PackagePlus}
              testId="text-opening-stock-qty"
            />
            <SummaryPill
              label="Opening Stock Value"
              value={formatAmount(summary.openingStockValue)}
              icon={Coins}
              testId="text-opening-stock-value"
            />
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
              label="Stock Adjustments"
              value={formatSignedQty(summary.stockAdjustmentQty)}
              icon={Scale}
              tone={adjustmentTone}
              testId="text-stock-adjustments"
            />
            <SummaryPill
              label="Total Available Qty"
              value={formatNumber(summary.totalAvailableQty, 3)}
              icon={Gauge}
              testId="text-total-available-qty"
            />
            <SummaryPill
              label="Stock Out Qty"
              value={formatNumber(summary.stockOutQty, 3)}
              icon={PackageMinus}
              testId="text-stock-out-qty"
            />
            <SummaryPill
              label="Stock in Hand Qty"
              value={formatNumber(summary.closingStockQty, 3)}
              icon={PackageMinus}
              testId="text-stock-in-hand-qty"
            />
            <SummaryPill
              label="Stock in Hand Value"
              value={formatAmount(summary.closingStockValue)}
              icon={Coins}
              testId="text-stock-in-hand-value"
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
              label="Gross Profit"
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

      <div className="rounded-xl border bg-muted/20 p-3 text-sm">
        <span className="font-medium">Stock Out breakdown:</span> Sales/returns{" "}
        <span className="font-mono font-semibold">{formatNumber(summary.salesOutQty || 0, 3)}</span> · Transfer out{" "}
        <span className="font-mono font-semibold">{formatNumber(summary.transferOutQty || 0, 3)}</span> · Other out{" "}
        <span className="font-mono font-semibold">{formatNumber(summary.otherStockOutQty || 0, 3)}</span>. Only
        sales/returns feed Cost of Sales and Gross Profit.
      </div>

      {reconciliation && (
        <div
          className={`rounded-xl border p-4 ${reconciliation.matches ? "bg-emerald-500/5" : "bg-red-500/5"}`}
          data-testid="stock-in-sales-reconciliation"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                {reconciliation.matches ? (
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
                <p className="text-sm font-semibold">Inventory Reconciliation</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Expected closing stock is compared with Location Inventory as of {reconciliation.asOfDate}. Click a
                period row below to inspect its stock, transfers, adjustments, sales and returns.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Expected</span>{" "}
                <span className="ml-1 font-mono font-semibold">
                  {formatNumber(reconciliation.expectedClosingQty, 3)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Actual</span>{" "}
                <span className="ml-1 font-mono font-semibold">{formatNumber(reconciliation.actualStockQty, 3)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Difference</span>{" "}
                <span
                  className={`ml-1 font-mono font-semibold ${reconciliation.matches ? "text-emerald-600" : "text-red-600"}`}
                >
                  {formatSignedQty(reconciliation.differenceQty)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Value Difference</span>{" "}
                <span
                  className={`ml-1 font-mono font-semibold ${reconciliation.matches ? "text-emerald-600" : "text-red-600"}`}
                >
                  {formatSignedAmount(reconciliation.differenceValue)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <PeriodFilter
          value={periodFilter}
          onChange={setPeriodFilter}
          data-testid="period-filter-stock-in-sales-report"
        />
        <div
          className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium"
          title={selectedCompany?.name || "Current Company"}
        >
          <Building2 className="h-4 w-4" /> Current Company
        </div>
        <div className="h-5 w-px bg-border" />
        <Select value={grouping} onValueChange={(value) => setGrouping(value as GroupingType)}>
          <SelectTrigger className="h-9 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
        <Select value={profitFilter} onValueChange={(value) => setProfitFilter(value as ProfitFilter)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Profits</SelectItem>
            <SelectItem value="positive">Positive Only</SelectItem>
            <SelectItem value="negative">Negative Only</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          <GitMerge className="h-4 w-4" /> Merged
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
        />
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear
        </Button>
        {isFetching && !isLoading && (
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing" />
        )}
      </div>

      <div>
        <p className="mb-3 text-xs text-muted-foreground">
          Inventory flow and profitability by {grouping.charAt(0).toUpperCase() + grouping.slice(1)}
          {rows.length > 0 && ` · ${rows.length} row${rows.length === 1 ? "" : "s"}`} · Click any row to drill in
        </p>
        <div className="overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <Table className="min-w-[1900px]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Opening Qty</TableHead>
                  <TableHead className="text-right">Opening Value</TableHead>
                  <TableHead className="text-right">Stock In</TableHead>
                  <TableHead className="text-right">Stock In Value</TableHead>
                  <TableHead className="text-right">Adjustments</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Stock Out</TableHead>
                  <TableHead className="text-right">Closing Qty</TableHead>
                  <TableHead className="text-right">Closing Value</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Cost of Sales</TableHead>
                  <TableHead className="text-right">Gross Profit</TableHead>
                  <TableHead className="text-right">Avg Profit/Bale</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <TableRow key={index}>
                      {Array.from({ length: 15 }).map((__, cellIndex) => (
                        <TableCell key={cellIndex}>
                          <Skeleton className={`h-4 ${cellIndex === 0 ? "w-24" : "ml-auto w-20"}`} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={15}>
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <TrendingDown className="h-6 w-6 text-destructive" />
                        <p className="text-sm font-medium">Unable to load the report</p>
                        <p className="text-xs text-muted-foreground">{error?.message}</p>
                        <Button variant="outline" size="sm" onClick={() => refetch()}>
                          Retry
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15} className="py-10 text-center text-sm text-muted-foreground">
                      No stock or sales activity found for these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((row) => {
                      const profitClass =
                        row.costProfit > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : row.costProfit < 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground";
                      return (
                        <TableRow
                          key={row.periodKey}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => openDetail(row)}
                        >
                          <TableCell className="py-3 font-medium">{formatPeriodLabel(row)}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(row.openingStockQty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(row.openingStockValue)}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(row.stockInQty, 3)}</TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(row.stockInValue)}</TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.stockAdjustmentQty < 0 ? "text-red-600" : row.stockAdjustmentQty > 0 ? "text-emerald-600" : ""}`}
                          >
                            {formatSignedQty(row.stockAdjustmentQty)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(row.totalAvailableQty, 3)}
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(row.stockOutQty, 3)}</TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatNumber(row.closingStockQty, 3)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {formatAmount(row.closingStockValue)}
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(row.totalSales)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {formatAmount(row.costOfSales)}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-semibold ${profitClass}`}>
                            {formatSignedAmount(row.costProfit)}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-semibold ${profitClass}`}>
                            {formatSignedAmount(row.avgProfitPerBale)}
                          </TableCell>
                          <TableCell>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                      <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">Total</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(summary.openingStockQty, 3)}</TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(summary.openingStockValue)}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(summary.stockInQty, 3)}</TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(summary.stockInValue)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatSignedQty(summary.stockAdjustmentQty)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(summary.totalAvailableQty, 3)}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(summary.stockOutQty, 3)}</TableCell>
                      <TableCell className="text-right font-mono">{formatNumber(summary.closingStockQty, 3)}</TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(summary.closingStockValue)}</TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(summary.totalSales)}</TableCell>
                      <TableCell className="text-right font-mono">{formatAmount(summary.costOfSales)}</TableCell>
                      <TableCell className="text-right font-mono">{formatSignedAmount(summary.costProfit)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatSignedAmount(summary.avgProfitPerBale)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
      <div className="hidden print:block text-xs text-muted-foreground">
        Generated {format(new Date(), "yyyy-MM-dd HH:mm")}
      </div>
    </div>
  );
}
