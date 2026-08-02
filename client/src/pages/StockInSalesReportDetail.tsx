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
  TrendingDown,
  TrendingUp,
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
import { useErpText } from "@/i18n/modules/erp";

interface Metrics {
  stockInQty: number;
  stockInValue: number;
  stockInAvgRate: number;
  stockOutQty: number;
  totalSales: number;
  costOfSales: number;
  costProfit: number;
  avgProfitPerBale: number;
}

interface StockInRow {
  id: number;
  activityDate: string;
  containerId: number;
  containerNumber: string;
  offloadId: number;
  locationId: number;
  locationName: string;
  stockGroupId: number | null;
  stockGroupName: string;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: number;
  avgRate: number;
  totalValue: number;
}

interface StockOutRow {
  id: number;
  sourceType: "Sale" | "Credit Note" | "Debit Note";
  activityDate: string;
  voucherId: number;
  voucherNumber: string;
  isCreditSale: boolean | null;
  locationId: number | null;
  locationName: string;
  stockGroupId: number | null;
  stockGroupName: string;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: number;
  sellingRate: number;
  unitCost: number;
  totalSales: number;
  totalCost: number;
  costProfit: number;
  avgProfitPerBale: number;
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

const EMPTY_METRICS: Metrics = {
  stockInQty: 0,
  stockInValue: 0,
  stockInAvgRate: 0,
  stockOutQty: 0,
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
  if (totalPages <= 1) return <p className="text-xs text-muted-foreground">{formatNumber(total, 0)} rows</p>;
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

export default function StockInSalesReportDetail() {
  const tUi = useErpText();
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

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<DetailResponse, Error>({
    queryKey: [queryUrl, selectedCompany?.id],
    enabled: !!selectedCompany?.id && !!startDate && !!endDate,
    staleTime: 30_000,
  });

  const summary = data?.summary ?? EMPTY_METRICS;
  const money = (value: number) => (value < 0 ? `-${formatAmount(Math.abs(value))}` : formatAmount(value));
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
      const response = await fetch(`/api/reports/stock-in-sales/detail?${exportParams.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load export details");
      const exportData = (await response.json()) as DetailResponse;
      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [
        { header: "Metric", key: "metric", width: 28 },
        { header: "Value", key: "value", width: 20 },
      ];
      [
        ["Period", periodLabel],
        ["Stock In Qty", exportData.summary.stockInQty],
        ["Stock In Value", exportData.summary.stockInValue],
        ["Average In Rate", exportData.summary.stockInAvgRate],
        ["Stock Out Qty", exportData.summary.stockOutQty],
        ["Total Sales", exportData.summary.totalSales],
        ["Cost of Sales", exportData.summary.costOfSales],
        ["Cost Profit", exportData.summary.costProfit],
        ["Average Profit / Bale", exportData.summary.avgProfitPerBale],
      ].forEach(([metric, value]) => summarySheet.addRow({ metric, value }));
      summarySheet.getRow(1).font = { bold: true };

      const stockInSheet = workbook.addWorksheet("Stock In");
      stockInSheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Container", key: "container", width: 18 },
        { header: "Location", key: "location", width: 18 },
        { header: "Group", key: "group", width: 16 },
        { header: "Item Code", key: "code", width: 16 },
        { header: "Item", key: "item", width: 32 },
        { header: "Qty", key: "qty", width: 14 },
        { header: "Avg Rate", key: "rate", width: 16 },
        { header: "Value", key: "value", width: 18 },
      ];
      exportData.stockIn.rows.forEach((row) =>
        stockInSheet.addRow({
          date: row.activityDate,
          container: row.containerNumber,
          location: row.locationName,
          group: row.stockGroupName,
          code: row.stockItemCode,
          item: row.stockItemName,
          qty: row.quantity,
          rate: row.avgRate,
          value: row.totalValue,
        })
      );
      stockInSheet.getRow(1).font = { bold: true };

      const stockOutSheet = workbook.addWorksheet("Stock Out");
      stockOutSheet.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Type", key: "type", width: 16 },
        { header: "Voucher", key: "voucher", width: 18 },
        { header: "Location", key: "location", width: 18 },
        { header: "Group", key: "group", width: 16 },
        { header: "Item Code", key: "code", width: 16 },
        { header: "Item", key: "item", width: 32 },
        { header: "Qty", key: "qty", width: 14 },
        { header: "Selling Rate", key: "sellingRate", width: 16 },
        { header: "Unit Cost", key: "unitCost", width: 16 },
        { header: "Sales", key: "sales", width: 18 },
        { header: "Cost", key: "cost", width: 18 },
        { header: "Profit", key: "profit", width: 18 },
        { header: "Profit / Bale", key: "profitPerBale", width: 18 },
      ];
      exportData.stockOut.rows.forEach((row) =>
        stockOutSheet.addRow({
          date: row.activityDate,
          type: row.sourceType === "Sale" && row.isCreditSale ? "Credit Sale" : row.sourceType,
          voucher: row.voucherNumber,
          location: row.locationName,
          group: row.stockGroupName,
          code: row.stockItemCode,
          item: row.stockItemName,
          qty: row.quantity,
          sellingRate: row.sellingRate,
          unitCost: row.unitCost,
          sales: row.totalSales,
          cost: row.totalCost,
          profit: row.costProfit,
          profitPerBale: row.avgProfitPerBale,
        })
      );
      stockOutSheet.getRow(1).font = { bold: true };

      const safeLabel = periodLabel.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
      await writeFile(workbook, `stock-in-sales-detail-${safeLabel || format(new Date(), "yyyy-MM-dd")}.xlsx`);

      if (exportData.stockIn.truncated || exportData.stockOut.truncated) {
        toast({
          title: "Export capped",
          description: "The export reached the 20,000-row safety limit for at least one section.",
          variant: "destructive",
        });
      }
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

  if (!startDate || !endDate) {
    return (
      <div className="container mx-auto p-6">
        <PageHeader title={tUi("stock.in.sales.details")} />
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
            <PageHeader title={tUi("stock.in.sales.details")} />
            <p className="text-sm text-muted-foreground">
              {periodLabel}
              {selectedCompany?.name ? ` · ${selectedCompany.name}` : ""}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 print:hidden" disabled={isLoading || isExporting}>
              {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)
          : [
              ["Stock In Qty", formatNumber(summary.stockInQty, 3)],
              ["Stock In Value", formatAmount(summary.stockInValue)],
              ["Avg In Rate", rate(summary.stockInAvgRate)],
              ["Stock Out Qty", formatNumber(summary.stockOutQty, 3)],
              ["Total Sales", formatAmount(summary.totalSales)],
              ["Cost", formatAmount(summary.costOfSales)],
              ["Cost Profit", money(summary.costProfit)],
              ["Avg Profit / Bale", money(summary.avgProfitPerBale)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-lg font-semibold">{value}</p>
              </div>
            ))}
      </div>

      {isFetching && !isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground print:hidden">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Refreshing details
        </div>
      )}

      {isError ? (
        <div className="rounded-xl border border-destructive/30 p-8 text-center">
          <TrendingDown className="mx-auto h-6 w-6 text-destructive" />
          <p className="mt-3 text-sm font-medium">{tUi("unable.to.load.details")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{error?.message}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            {tUi("retry")}
          </Button>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" />
              <h2 className="text-lg font-semibold">{tUi("container.stock.in")}</h2>
              <span className="text-xs text-muted-foreground">{formatNumber(data?.stockIn.total || 0, 0)} lines</span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="overflow-x-auto">
                <Table className="min-w-[1050px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>{tUi("date")}</TableHead>
                      <TableHead>{tUi("container")}</TableHead>
                      <TableHead>{tUi("location")}</TableHead>
                      <TableHead>{tUi("group")}</TableHead>
                      <TableHead>{tUi("item")}</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">{tUi("avg.rate")}</TableHead>
                      <TableHead className="text-right">{tUi("value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, index) => (
                        <TableRow key={index}>
                          <TableCell colSpan={8}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (data?.stockIn.rows.length || 0) === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                          {tUi("no.direct.container.offloads.found")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.stockIn.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{displayDate(row.activityDate)}</TableCell>
                          <TableCell className="font-mono">{row.containerNumber}</TableCell>
                          <TableCell>{row.locationName}</TableCell>
                          <TableCell>{row.stockGroupName}</TableCell>
                          <TableCell>
                            <div className="font-medium">{row.stockItemName}</div>
                            <div className="text-xs text-muted-foreground">{row.stockItemCode}</div>
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatNumber(row.quantity, 3)}</TableCell>
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
              <h2 className="text-lg font-semibold">{tUi("stock.out.sales")}</h2>
              <span className="text-xs text-muted-foreground">{formatNumber(data?.stockOut.total || 0, 0)} lines</span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="overflow-x-auto">
                <Table className="min-w-[1350px]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>{tUi("date")}</TableHead>
                      <TableHead>{tUi("type")}</TableHead>
                      <TableHead>{tUi("voucher.2")}</TableHead>
                      <TableHead>{tUi("location")}</TableHead>
                      <TableHead>{tUi("group")}</TableHead>
                      <TableHead>{tUi("item")}</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">{tUi("sales.2")}</TableHead>
                      <TableHead className="text-right">{tUi("cost.2")}</TableHead>
                      <TableHead className="text-right">{tUi("profit")}</TableHead>
                      <TableHead className="text-right">{tUi("profit.bale")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, index) => (
                        <TableRow key={index}>
                          <TableCell colSpan={11}>
                            <Skeleton className="h-5 w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (data?.stockOut.rows.length || 0) === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                          {tUi("no.sales.credit.notes.or.debit.notes.found")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.stockOut.rows.map((row) => {
                        const positive = row.costProfit >= 0;
                        return (
                          <TableRow key={`${row.sourceType}-${row.id}`}>
                            <TableCell>{displayDate(row.activityDate)}</TableCell>
                            <TableCell>
                              {row.sourceType === "Sale" && row.isCreditSale ? "Credit Sale" : row.sourceType}
                            </TableCell>
                            <TableCell className="font-mono">{row.voucherNumber}</TableCell>
                            <TableCell>{row.locationName}</TableCell>
                            <TableCell>{row.stockGroupName}</TableCell>
                            <TableCell>
                              <div className="font-medium">{row.stockItemName}</div>
                              <div className="text-xs text-muted-foreground">{row.stockItemCode}</div>
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatNumber(row.quantity, 3)}</TableCell>
                            <TableCell className="text-right font-mono">{money(row.totalSales)}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {money(row.totalCost)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono font-semibold ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              {money(row.costProfit)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${row.avgProfitPerBale >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                            >
                              {money(row.avgProfitPerBale)}
                            </TableCell>
                          </TableRow>
                        );
                      })
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
