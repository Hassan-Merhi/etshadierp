import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  PackageMinus,
  PackagePlus,
  RefreshCw,
  Scale,
  TrendingDown,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useToast } from "@/hooks/use-toast";
import { ExcelJS, writeFile } from "@/lib/excelHelper";
import { formatNumber } from "@/lib/formatNumber";

interface Metrics {
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

interface Location {
  id: number;
  name: string;
}

interface StockInRow {
  id: number;
  activityDate: string;
  containerNumber: string;
  locationName: string;
  stockItemName: string;
  quantity: number;
  avgRate: number;
  totalValue: number;
}

interface StockOutRow {
  id: number;
  sourceType: "Sale" | "Credit Note" | "Debit Note";
  activityDate: string;
  isCreditSale: boolean | null;
  locationName: string;
  stockItemName: string;
  quantity: number;
  totalSales: number;
  totalCost: number;
  costProfit: number;
  avgProfitPerBale: number;
}

interface MovementRow {
  key: string;
  activityDate: string;
  movementType: "Transfer In" | "Transfer Out" | "Adjustment";
  locationId: number | null;
  counterpartyLocationId: number | null;
  stockItemName: string;
  quantity: number;
  unitRate: number;
  value: number;
  adjustmentType: string | null;
}

interface PagedRows<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  truncated: boolean;
}

interface DetailResponse {
  generatedAt: string;
  period: { startDate: string; endDate: string };
  summary: Metrics;
  stockIn: PagedRows<StockInRow>;
  stockOut: PagedRows<StockOutRow>;
}

interface MovementResponse {
  generatedAt: string;
  rows: MovementRow[];
  rowCount: number;
  truncated: boolean;
}

const EMPTY_METRICS: Metrics = {
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

function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">{formatNumber(total, 0)} rows</p>;
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2 print:hidden">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages} · {formatNumber(total, 0)} rows
      </p>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function compareDateLocationItem(
  a: { activityDate: string; locationName: string; stockItemName: string },
  b: { activityDate: string; locationName: string; stockItemName: string }
): number {
  const date = b.activityDate.localeCompare(a.activityDate);
  if (date !== 0) return date;
  const location = a.locationName.localeCompare(b.locationName, undefined, { numeric: true, sensitivity: "base" });
  if (location !== 0) return location;
  return a.stockItemName.localeCompare(b.stockItemName, undefined, { numeric: true, sensitivity: "base" });
}

export default function StockInSalesReportDetail() {
  const { selectedCompany } = useCompany();
  const { formatAmount, selectedCurrency, convertToDisplay } = useCurrencyContext();
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const [stockInPage, setStockInPage] = useState(1);
  const [stockOutPage, setStockOutPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  const periodLabel = params.get("periodLabel") || `${startDate} – ${endDate}`;
  const locationIds = params.get("locationIds") || "";
  const stockGroupIds = params.get("stockGroupIds") || "";
  const search = params.get("search") || "";

  const baseParams = useMemo(() => {
    const query = new URLSearchParams({ startDate, endDate });
    if (locationIds) query.set("locationIds", locationIds);
    if (stockGroupIds) query.set("stockGroupIds", stockGroupIds);
    if (search) query.set("search", search);
    return query;
  }, [startDate, endDate, locationIds, stockGroupIds, search]);

  const queryUrl = useMemo(() => {
    const query = new URLSearchParams(baseParams);
    query.set("stockInPage", String(stockInPage));
    query.set("stockOutPage", String(stockOutPage));
    query.set("limit", "100");
    return `/api/reports/stock-in-sales/detail?${query.toString()}`;
  }, [baseParams, stockInPage, stockOutPage]);
  const movementUrl = useMemo(() => `/api/reports/stock-in-sales/movements?${baseParams.toString()}`, [baseParams]);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<DetailResponse, Error>({
    queryKey: [queryUrl, selectedCompany?.id],
    enabled: !!selectedCompany?.id && !!startDate && !!endDate,
    staleTime: 30_000,
  });
  const { data: movements, isLoading: movementsLoading } = useQuery<MovementResponse, Error>({
    queryKey: [movementUrl, selectedCompany?.id],
    enabled: !!selectedCompany?.id && !!startDate && !!endDate,
    staleTime: 30_000,
  });
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
    staleTime: 60_000,
  });

  const locationNameById = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations]
  );
  const locationName = (id: number | null) => (id ? locationNameById.get(id) || `Location #${id}` : "—");
  const sourceLocationName = (row: MovementRow) =>
    row.movementType === "Transfer In" ? locationName(row.counterpartyLocationId) : locationName(row.locationId);
  const destinationLocationName = (row: MovementRow) =>
    row.movementType === "Transfer In"
      ? locationName(row.locationId)
      : row.movementType === "Transfer Out"
        ? locationName(row.counterpartyLocationId)
        : "—";

  const sortedMovements = useMemo(
    () =>
      [...(movements?.rows || [])].sort((a, b) => {
        const date = b.activityDate.localeCompare(a.activityDate);
        if (date !== 0) return date;
        const source = sourceLocationName(a).localeCompare(sourceLocationName(b), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (source !== 0) return source;
        const destination = destinationLocationName(a).localeCompare(destinationLocationName(b), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (destination !== 0) return destination;
        return a.stockItemName.localeCompare(b.stockItemName, undefined, { numeric: true, sensitivity: "base" });
      }),
    [movements?.rows, locationNameById]
  );

  const sortedStockIn = useMemo(
    () => [...(data?.stockIn.rows || [])].sort(compareDateLocationItem),
    [data?.stockIn.rows]
  );
  const sortedStockOut = useMemo(
    () => [...(data?.stockOut.rows || [])].sort(compareDateLocationItem),
    [data?.stockOut.rows]
  );

  const summary = data?.summary ?? EMPTY_METRICS;
  const money = (value: number) => (value < 0 ? `-${formatAmount(Math.abs(value))}` : formatAmount(value));
  const roundedMoney = (value: number) =>
    value < 0 ? `-${formatAmount(Math.round(Math.abs(value)))}` : formatAmount(Math.round(value));
  const signedQty = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value, 0)}`;
  const rate = (value: number) =>
    selectedCurrency === "CFA" ? `CFA ${formatNumber(convertToDisplay(value), 2)}` : `$ ${formatNumber(value, 6)}`;
  const displayDate = (value: string) => {
    try {
      return formatDisplayDate(parseISO(value));
    } catch {
      return value;
    }
  };

  const exportExcel = async () => {
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const exportParams = new URLSearchParams(baseParams);
      exportParams.set("exportAll", "true");
      const [detailResponse, movementResponse] = await Promise.all([
        fetch(`/api/reports/stock-in-sales/detail?${exportParams.toString()}`, { credentials: "include" }),
        fetch(`/api/reports/stock-in-sales/movements?${exportParams.toString()}`, { credentials: "include" }),
      ]);
      if (!detailResponse.ok || !movementResponse.ok) throw new Error("Failed to load export details");

      const exportData = (await detailResponse.json()) as DetailResponse;
      const exportMovements = (await movementResponse.json()) as MovementResponse;

      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [
        { header: "Metric", key: "metric", width: 28 },
        { header: "Value", key: "value", width: 20 },
      ];
      [
        ["Period", periodLabel],
        ["Opening Stock Qty", exportData.summary.openingStockQty],
        ["Opening Stock Value", exportData.summary.openingStockValue],
        ["Stock In Qty", exportData.summary.stockInQty],
        ["Stock In Value", exportData.summary.stockInValue],
        ["Stock Adjustments", exportData.summary.stockAdjustmentQty],
        ["Total Available Qty", exportData.summary.totalAvailableQty],
        ["Stock Out Qty", exportData.summary.stockOutQty],
        ["Sales Out Qty", exportData.summary.salesOutQty || 0],
        ["Transfer Out Qty", exportData.summary.transferOutQty || 0],
        ["Closing Stock Qty", exportData.summary.closingStockQty],
        ["Closing Stock Value", exportData.summary.closingStockValue],
        ["Total Sales", exportData.summary.totalSales],
        ["Cost of Sales", exportData.summary.costOfSales],
        ["Gross Profit", exportData.summary.costProfit],
        ["Average Profit / Bale", exportData.summary.avgProfitPerBale],
      ].forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
      summarySheet.getRow(1).font = { bold: true };

      const stockInSheet = workbook.addWorksheet("Container Stock In");
      stockInSheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Container", key: "container", width: 18 },
        { header: "Location", key: "location", width: 20 },
        { header: "Item", key: "item", width: 34 },
        { header: "Qty", key: "qty", width: 14 },
        { header: "Avg Rate", key: "rate", width: 16 },
        { header: "Value", key: "value", width: 18 },
      ];
      [...exportData.stockIn.rows].sort(compareDateLocationItem).forEach((row) =>
        stockInSheet.addRow({
          date: row.activityDate,
          container: row.containerNumber,
          location: row.locationName,
          item: row.stockItemName,
          qty: row.quantity,
          rate: row.avgRate,
          value: row.totalValue,
        })
      );
      stockInSheet.getRow(1).font = { bold: true };

      const movementSheet = workbook.addWorksheet("Inventory Movements");
      movementSheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Type", key: "type", width: 18 },
        { header: "Source Location", key: "source", width: 22 },
        { header: "Destination Location", key: "destination", width: 22 },
        { header: "Item", key: "item", width: 34 },
        { header: "Qty +/-", key: "qty", width: 14 },
        { header: "Rate", key: "rate", width: 16 },
        { header: "Value +/-", key: "value", width: 18 },
      ];
      [...exportMovements.rows]
        .sort((a, b) => {
          const date = b.activityDate.localeCompare(a.activityDate);
          if (date !== 0) return date;
          const source = sourceLocationName(a).localeCompare(sourceLocationName(b), undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (source !== 0) return source;
          return a.stockItemName.localeCompare(b.stockItemName, undefined, { numeric: true, sensitivity: "base" });
        })
        .forEach((row) =>
          movementSheet.addRow({
            date: row.activityDate,
            type: row.adjustmentType ? `${row.movementType} · ${row.adjustmentType}` : row.movementType,
            source: sourceLocationName(row),
            destination: destinationLocationName(row),
            item: row.stockItemName,
            qty: row.quantity,
            rate: row.unitRate,
            value: row.value,
          })
        );
      movementSheet.getRow(1).font = { bold: true };

      const salesSheet = workbook.addWorksheet("Sales and Returns");
      salesSheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Type", key: "type", width: 16 },
        { header: "Location", key: "location", width: 20 },
        { header: "Item", key: "item", width: 34 },
        { header: "Qty", key: "qty", width: 14 },
        { header: "Sales", key: "sales", width: 18 },
        { header: "Cost", key: "cost", width: 18 },
        { header: "Profit", key: "profit", width: 18 },
        { header: "Profit / Bale", key: "profitPerBale", width: 18 },
      ];
      [...exportData.stockOut.rows].sort(compareDateLocationItem).forEach((row) =>
        salesSheet.addRow({
          date: row.activityDate,
          type: row.sourceType === "Sale" && row.isCreditSale ? "Credit Sale" : row.sourceType,
          location: row.locationName,
          item: row.stockItemName,
          qty: row.quantity,
          sales: row.totalSales,
          cost: row.totalCost,
          profit: row.costProfit,
          profitPerBale: row.avgProfitPerBale,
        })
      );
      salesSheet.getRow(1).font = { bold: true };

      const safeLabel = periodLabel.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
      await writeFile(workbook, `stock-flow-detail-${safeLabel || format(new Date(), "yyyy-MM-dd")}.xlsx`);
      if (exportData.stockIn.truncated || exportData.stockOut.truncated || exportMovements.truncated) {
        toast({
          title: "Export capped",
          description: "At least one section reached the 20,000-row safety limit.",
          variant: "destructive",
        });
      }
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

  if (!startDate || !endDate) {
    return (
      <div className="container mx-auto p-6">
        <PageHeader title="Stock Flow Details" />
        <p className="mt-3 text-sm text-muted-foreground">A valid report period is required.</p>
        <Button className="mt-4" variant="outline" onClick={() => (window.location.href = "/stock-in-sales-report")}>
          Back to report
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mt-0.5 gap-1.5 print:hidden"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <PageHeader title="Stock Flow Details" />
            <p className="text-sm text-muted-foreground">
              {periodLabel}
              {selectedCompany?.name ? ` · ${selectedCompany.name}` : ""}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 print:hidden" disabled={isLoading || isExporting}>
              {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={exportExcel}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Export Excel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.print()}>
              <FileText className="mr-2 h-4 w-4" /> Export PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {isLoading
          ? Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)
          : [
              ["Opening Qty", formatNumber(summary.openingStockQty, 0)],
              ["Opening Value", roundedMoney(summary.openingStockValue)],
              ["Stock In Qty", formatNumber(summary.stockInQty, 0)],
              ["Adjustments", signedQty(summary.stockAdjustmentQty)],
              ["Available", formatNumber(summary.totalAvailableQty, 0)],
              ["Stock Out", formatNumber(summary.stockOutQty, 0)],
              ["Closing / In Hand", formatNumber(summary.closingStockQty, 0)],
              ["Closing Value", roundedMoney(summary.closingStockValue)],
              ["Gross Profit", roundedMoney(summary.costProfit)],
              ["Avg Profit / Bale", roundedMoney(summary.avgProfitPerBale)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-lg font-semibold">{value}</p>
              </div>
            ))}
      </div>

      <div className="rounded-xl border bg-muted/20 p-3 text-sm">
        <span className="font-medium">Outbound breakdown:</span> Sales/returns{" "}
        <span className="font-mono font-semibold">{formatNumber(summary.salesOutQty || 0, 0)}</span> · Transfer out{" "}
        <span className="font-mono font-semibold">{formatNumber(summary.transferOutQty || 0, 0)}</span> · Other out{" "}
        <span className="font-mono font-semibold">{formatNumber(summary.otherStockOutQty || 0, 0)}</span>. Transfers
        reduce stock but do not create sales or profit.
      </div>

      {isFetching && !isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground print:hidden">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Refreshing details
        </div>
      )}

      {isError ? (
        <div className="rounded-xl border border-destructive/30 p-8 text-center">
          <TrendingDown className="mx-auto h-6 w-6 text-destructive" />
          <p className="mt-3 text-sm font-medium">Unable to load details</p>
          <p className="mt-1 text-xs text-muted-foreground">{error?.message}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Inventory Movements</h2>
              <span className="text-xs text-muted-foreground">
                Transfers and stock adjustments · {formatNumber(movements?.rowCount || 0, 0)} lines
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="max-h-[520px] overflow-auto">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source Location</TableHead>
                      <TableHead>Destination Location</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty +/-</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Value +/-</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movementsLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={8}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : sortedMovements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          No transfers or stock adjustments found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedMovements.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell>{displayDate(row.activityDate)}</TableCell>
                          <TableCell>
                            {row.movementType}
                            {row.adjustmentType ? ` · ${row.adjustmentType}` : ""}
                          </TableCell>
                          <TableCell>{sourceLocationName(row)}</TableCell>
                          <TableCell>{destinationLocationName(row)}</TableCell>
                          <TableCell className="font-medium">{row.stockItemName}</TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.quantity < 0 ? "text-red-600" : row.quantity > 0 ? "text-emerald-600" : ""}`}
                          >
                            {signedQty(row.quantity)}
                          </TableCell>
                          <TableCell className="text-right font-mono">{rate(row.unitRate)}</TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.value < 0 ? "text-red-600" : row.value > 0 ? "text-emerald-600" : ""}`}
                          >
                            {money(row.value)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {movements?.truncated && (
                <p className="border-t px-3 py-2 text-xs text-amber-600">
                  Movement list reached the 20,000-row safety limit.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Container Stock In</h2>
              <span className="text-xs text-muted-foreground">{formatNumber(data?.stockIn.total || 0, 0)} lines</span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="overflow-x-auto">
                <Table className="min-w-[850px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Date</TableHead>
                      <TableHead>Container</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg Rate</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={7}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : sortedStockIn.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                          No direct container offloads found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedStockIn.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{displayDate(row.activityDate)}</TableCell>
                          <TableCell className="font-mono">{row.containerNumber}</TableCell>
                          <TableCell>{row.locationName}</TableCell>
                          <TableCell className="font-medium">{row.stockItemName}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(row.quantity, 0)}</TableCell>
                          <TableCell className="text-right font-mono">{rate(row.avgRate)}</TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(row.totalValue)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {data?.stockIn && (
                <Pagination
                  page={data.stockIn.page}
                  totalPages={data.stockIn.totalPages}
                  total={data.stockIn.total}
                  onChange={setStockInPage}
                />
              )}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Sales / Returns</h2>
              <span className="text-xs text-muted-foreground">
                Sales, credit notes and debit notes only · {formatNumber(data?.stockOut.total || 0, 0)} lines
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="overflow-x-auto">
                <Table className="min-w-[1050px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Profit/Bale</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={9}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : sortedStockOut.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                          No sales, credit notes, or debit notes found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedStockOut.map((row) => (
                        <TableRow key={`${row.sourceType}-${row.id}`}>
                          <TableCell>{displayDate(row.activityDate)}</TableCell>
                          <TableCell>
                            {row.sourceType === "Sale" && row.isCreditSale ? "Credit Sale" : row.sourceType}
                          </TableCell>
                          <TableCell>{row.locationName}</TableCell>
                          <TableCell className="font-medium">{row.stockItemName}</TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(row.quantity, 0)}</TableCell>
                          <TableCell className="text-right font-mono">{money(row.totalSales)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {money(row.totalCost)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono font-semibold ${row.costProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {money(row.costProfit)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono ${row.avgProfitPerBale >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {money(row.avgProfitPerBale)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {data?.stockOut && (
                <Pagination
                  page={data.stockOut.page}
                  totalPages={data.stockOut.totalPages}
                  total={data.stockOut.total}
                  onChange={setStockOutPage}
                />
              )}
            </div>
          </section>
        </>
      )}

      <div className="hidden print:block text-xs text-muted-foreground">
        Generated {format(new Date(), "yyyy-MM-dd HH:mm")}
      </div>
    </div>
  );
}
