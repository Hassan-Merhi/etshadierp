import { useState, useMemo, useEffect } from "react";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { FileSpreadsheet, FileText, TrendingUp, TrendingDown, ChevronRight, ChevronDown, Download, Building2, GitCompare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { utils, writeFile, readFile, ExcelJS } from "@/lib/excelHelper";
import { format, parseISO, startOfDay, startOfMonth, startOfYear, addDays } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { formatNumber } from "@/lib/formatNumber";

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
  createdAt: string;
  // Multi-company fields (only present in all-companies view)
  companyId?: number;
  companyCode?: string;
  companyName?: string;
}

interface DailySummary {
  date: string;       // compound key used for grouping (may have "-credit" suffix)
  dateKey: string;    // clean date key for API queries (no suffix)
  displayDate: string;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  itemCount: number;
  totalQty: number;
  isCreditSale: boolean;
  items: SalesReportItem[];
}

type GroupingType = "daily" | "monthly" | "yearly";
type ProfitFilter = "all" | "positive" | "negative";


// Format number with commas, remove .00 if whole - handles string inputs
const formatNumericValue = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return formatNumber(num);
};

// For backwards compatibility
const formatSmartNumber = (value: string | number | null | undefined) => {
  if (value == null) return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toLocaleString('en-US') : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function SalesReport() {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("today"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));

  // Keyboard date navigation: "-" = back 1 day, "+" or "=" = forward 1 day
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "textarea") return;
      if (tag === "input") {
        const inputType = (target as HTMLInputElement).type || "text";
        if (["text", "number", "email", "password", "search", "tel", "url"].includes(inputType)) return;
      }
      if (tag === "select") return;
      if (hasAnyOpenDialog()) return;

      const dateFmt = "yyyy-MM-dd";
      const isBack = e.key === "-" || e.code === "Minus";
      const isForward = (e.key === "+" && e.shiftKey) || (e.code === "Equal" && e.shiftKey) || e.key === "=";

      if (isBack) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate), -1), dateFmt),
          toDate: format(addDays(new Date(prev.toDate), -1), dateFmt),
          preset: "custom",
        }));
      } else if (isForward) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate), 1), dateFmt),
          toDate: format(addDays(new Date(prev.toDate), 1), dateFmt),
          preset: "custom",
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedStockItem, setSelectedStockItem] = useState<string>("all");
  const [selectedStockGroup, setSelectedStockGroup] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [grouping, setGrouping] = useState<GroupingType>("daily");
  const [profitFilter, setProfitFilter] = useState<ProfitFilter>("all");
  const [isMultiCompanyMode, setIsMultiCompanyMode] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedRowDate, setSelectedRowDate] = useState<string | null>(null);
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();

  // Fetch locations
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/locations"],
  });

  // Fetch stock items
  const { data: stockItems = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-items"],
  });

  // Fetch stock groups
  const { data: stockGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/stock-groups"],
  });

  // Filter stock items to those in the selected group
  const filteredStockItems = stockItems.filter((item: any) =>
    !selectedStockGroup || selectedStockGroup === "all" || item.stockGroupId === parseInt(selectedStockGroup)
  );

  // Resolve selected group name (for multi-company query)
  const selectedStockGroupName = stockGroups.find((g: any) => g.id === parseInt(selectedStockGroup))?.name || "";

  // Build query params for single-company mode
  const queryParams = new URLSearchParams();
  if (periodFilter.fromDate) queryParams.append("startDate", periodFilter.fromDate);
  if (periodFilter.toDate) queryParams.append("endDate", periodFilter.toDate);
  if (selectedLocation && selectedLocation !== "all") queryParams.append("locationId", selectedLocation);
  if (selectedStockItem && selectedStockItem !== "all") queryParams.append("stockItemId", selectedStockItem);
  if (selectedStockGroup && selectedStockGroup !== "all") queryParams.append("stockGroupId", selectedStockGroup);

  const queryString = queryParams.toString();
  const singleCompanyQueryKey = queryString ? `/api/sales-report?${queryString}` : "/api/sales-report";

  // Build query params for multi-company mode
  const multiCompanyParams = new URLSearchParams();
  if (periodFilter.fromDate) multiCompanyParams.append("startDate", periodFilter.fromDate);
  if (periodFilter.toDate) multiCompanyParams.append("endDate", periodFilter.toDate);
  // Note: locationId and stockItemId are company-specific so not passed in multi-company mode
  if (selectedCompanies.length > 0) multiCompanyParams.append("companyFilter", selectedCompanies.join(","));
  if (selectedStockGroup && selectedStockGroup !== "all" && selectedStockGroupName) {
    multiCompanyParams.append("stockGroupName", selectedStockGroupName);
  }

  const multiCompanyQueryString = multiCompanyParams.toString();
  const multiCompanyQueryKey = multiCompanyQueryString 
    ? `/api/dashboard/sales-report-all?${multiCompanyQueryString}` 
    : "/api/dashboard/sales-report-all";

  // Fetch sales report data (single company)
  const { data: singleCompanySalesData = [], isLoading: isLoadingSingle } = useQuery<SalesReportItem[]>({
    queryKey: [singleCompanyQueryKey],
    enabled: !isMultiCompanyMode,
  });

  // Fetch sales report data (all companies)
  const { data: allCompaniesSalesData = [], isLoading: isLoadingMulti } = useQuery<SalesReportItem[]>({
    queryKey: [multiCompanyQueryKey],
    enabled: isMultiCompanyMode,
  });

  // Use the appropriate data based on mode
  const salesData = isMultiCompanyMode ? allCompaniesSalesData : singleCompanySalesData;
  const isLoading = isMultiCompanyMode ? isLoadingMulti : isLoadingSingle;

  // Extract unique companies from multi-company data
  const companyFilterOptions = useMemo(() => {
    if (!isMultiCompanyMode || !allCompaniesSalesData.length) return [];
    const uniqueCompanies = new Map<string, string>();
    allCompaniesSalesData.forEach((item) => {
      if (item.companyCode && item.companyName) {
        uniqueCompanies.set(item.companyCode, item.companyName);
      }
    });
    return Array.from(uniqueCompanies.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [isMultiCompanyMode, allCompaniesSalesData]);

  // Group sales by date/month/year — credit sales get their own separate group
  const groupedData: DailySummary[] = salesData.reduce((acc: DailySummary[], item) => {
    const itemDate = parseISO(item.voucherDate);
    let dateKey: string;
    let displayDate: string;

    if (grouping === "daily") {
      dateKey = format(startOfDay(itemDate), "yyyy-MM-dd");
      displayDate = formatDisplayDate(itemDate);
    } else if (grouping === "monthly") {
      dateKey = format(startOfMonth(itemDate), "yyyy-MM");
      displayDate = format(itemDate, "MMMM yyyy");
    } else {
      dateKey = format(startOfYear(itemDate), "yyyy");
      displayDate = format(itemDate, "yyyy");
    }

    const isCredit = item.isCreditSale === true;
    // Separate group key so credit and cash rows never merge
    const groupKey = isCredit ? `${dateKey}-credit` : dateKey;

    // Filter by search term
    if (searchTerm) {
      const searchLower = (searchTerm || "").toLowerCase();
      const matches = 
        (item.stockItemName || "").toLowerCase().includes(searchLower) ||
        (item.locationName && (item.locationName || "").toLowerCase().includes(searchLower));
      if (!matches) return acc;
    }

    const existing = acc.find(g => g.date === groupKey);
    const totalSales = parseFloat(item.totalSales);
    const totalCost = parseFloat(item.totalCost);
    const totalConfiguredCost = item.totalConfiguredCost;
    const costProfit = parseFloat(item.costProfit);
    const configuredProfit = item.configuredProfit;

    const qty = parseFloat(item.quantity);

    if (existing) {
      existing.totalSales += totalSales;
      existing.totalCost += totalCost;
      existing.totalConfiguredCost += totalConfiguredCost;
      existing.costProfit += costProfit;
      existing.configuredProfit += configuredProfit;
      existing.itemCount += 1;
      existing.totalQty += qty;
      existing.items.push(item);
    } else {
      acc.push({
        date: groupKey,
        dateKey,
        displayDate,
        totalSales,
        totalCost,
        totalConfiguredCost,
        costProfit,
        configuredProfit,
        itemCount: 1,
        totalQty: qty,
        isCreditSale: isCredit,
        items: [item],
      });
    }

    return acc;
  }, []);

  // Sort by date descending (most recent first)
  groupedData.sort((a, b) => b.date.localeCompare(a.date));

  // Apply profit filter
  const filteredGroupedData = groupedData.filter(group => {
    if (profitFilter === "all") return true;
    if (profitFilter === "positive") return group.configuredProfit >= 0;
    if (profitFilter === "negative") return group.configuredProfit < 0;
    return true;
  });

  // Calculate totals
  const totals = filteredGroupedData.reduce(
    (acc, group) => ({
      totalSales: acc.totalSales + group.totalSales,
      totalCost: acc.totalCost + group.totalCost,
      totalConfiguredCost: acc.totalConfiguredCost + group.totalConfiguredCost,
      costProfit: acc.costProfit + group.costProfit,
      configuredProfit: acc.configuredProfit + group.configuredProfit,
      totalQty: acc.totalQty + group.totalQty,
    }),
    { totalSales: 0, totalCost: 0, totalConfiguredCost: 0, costProfit: 0, configuredProfit: 0, totalQty: 0 }
  );

  const handleClearFilters = () => {
    setPeriodFilter(getDefaultPeriodValue("today"));
    setSelectedLocation("all");
    setSelectedStockItem("all");
    setSelectedStockGroup("all");
    setSearchTerm("");
    setProfitFilter("all");
    setSelectedCompanies([]);
  };

  const [, navigate] = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "s" || e.key === "ß")) {
        if (!selectedStockItem || selectedStockItem === "all") return;
        e.preventDefault();
        navigate(`/stock-query/${selectedStockItem}`);
        return;
      }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (hasAnyOpenDialog()) return;
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (["input", "textarea", "select"].includes(tag)) return;
        if (filteredGroupedData.length === 0) return;
        e.preventDefault();
        setSelectedRowDate((prev) => {
          const idx = prev ? filteredGroupedData.findIndex((g) => g.date === prev) : -1;
          if (e.key === "ArrowDown") {
            return filteredGroupedData[idx < filteredGroupedData.length - 1 ? idx + 1 : 0].date;
          } else {
            return filteredGroupedData[idx > 0 ? idx - 1 : filteredGroupedData.length - 1].date;
          }
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedStockItem, navigate, filteredGroupedData]);

  useEffect(() => {
    if (!selectedRowDate) return;
    const el = document.querySelector(`[data-testid="row-sale-${selectedRowDate}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedRowDate]);

  const handleRowClick = (summary: DailySummary) => {
    setSelectedRowDate(summary.date);
    const params = new URLSearchParams();
    params.set("displayDate", summary.displayDate);
    params.set("grouping", grouping);
    // Always use the clean dateKey (not the compound group key) for API date params
    const dk = summary.dateKey;
    if (grouping === "daily") {
      params.set("startDate", dk);
      params.set("endDate", dk);
    } else if (grouping === "monthly") {
      const [y, m] = dk.split("-").map(Number);
      const start = `${dk}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${dk}-${String(lastDay).padStart(2, "0")}`;
      params.set("startDate", start);
      params.set("endDate", end);
    } else {
      params.set("startDate", `${dk}-01-01`);
      params.set("endDate", `${dk}-12-31`);
    }
    if (selectedLocation && selectedLocation !== "all") params.set("locationId", selectedLocation);
    if (selectedStockItem && selectedStockItem !== "all") params.set("stockItemId", selectedStockItem);
    if (selectedStockGroup && selectedStockGroup !== "all") params.set("stockGroupId", selectedStockGroup);
    if (searchTerm) params.set("searchTerm", searchTerm);
    params.set("isCreditSale", summary.isCreditSale ? "true" : "false");
    if (isMultiCompanyMode) {
      params.set("allCompanies", "true");
      if (selectedCompanies.length > 0) params.set("companyFilter", selectedCompanies.join(","));
    }
    window.open(`/sales-report/detail?${params.toString()}`, "_blank");
  };

  const handleExportExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Detailed Sales Report");

    const currencyCols = [5, 6, 7, 8, 9, 10, 11, 13];
    const percentCols = [12, 14];
    const profitCols = [8, 11, 12, 13, 14];
    
    worksheet.columns = [
      { header: "Location", key: "location", width: 15 },
      { header: "Item Code", key: "itemCode", width: 15 },
      { header: "Item Name", key: "itemName", width: 30 },
      { header: "Quantity", key: "quantity", width: 10 },
      { header: "Sold Price", key: "soldPrice", width: 12 },
      { header: "Cost Price", key: "costPrice", width: 12 },
      { header: "Hassan's Price", key: "hassansPrice", width: 14 },
      { header: "Unit Profit", key: "unitProfit", width: 12 },
      { header: "Total Sales", key: "totalSales", width: 12 },
      { header: "Total Cost", key: "totalCost", width: 12 },
      { header: "Cost Profit", key: "costProfit", width: 12 },
      { header: "Cost %", key: "costPercent", width: 10 },
      { header: "Hassan's Profit", key: "hassansProfit", width: 14 },
      { header: "Hassan's %", key: "hassansPercent", width: 12 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    headerRow.eachCell((cell) => {
      cell.border = {
        top: { style: "medium", color: { argb: "FF999999" } },
        bottom: { style: "medium", color: { argb: "FF999999" } },
        left: { style: "medium", color: { argb: "FF999999" } },
        right: { style: "medium", color: { argb: "FF999999" } },
      };
    });

    salesData.forEach((item) => {
      const unitProfit = parseFloat(item.actualSellingPrice) - parseFloat(item.costPrice);
      const row = worksheet.addRow({
        location: item.locationName || "N/A",
        itemCode: item.stockItemCode || "",
        itemName: item.stockItemName,
        quantity: parseFloat(item.quantity),
        soldPrice: parseFloat(item.actualSellingPrice),
        costPrice: parseFloat(item.costPrice),
        hassansPrice: parseFloat(item.configuredSellingPrice),
        unitProfit: unitProfit,
        totalSales: parseFloat(item.totalSales),
        totalCost: parseFloat(item.totalCost),
        costProfit: parseFloat(item.costProfit),
        costPercent: item.costProfitPercentage,
        hassansProfit: item.configuredProfit,
        hassansPercent: item.configuredProfitPercentage,
      });

      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: "medium", color: { argb: "FF999999" } },
          bottom: { style: "medium", color: { argb: "FF999999" } },
          left: { style: "medium", color: { argb: "FF999999" } },
          right: { style: "medium", color: { argb: "FF999999" } },
        };

        if (currencyCols.includes(colNumber)) {
          cell.numFmt = '"$"#,##0.00';
        }
        if (percentCols.includes(colNumber)) {
          cell.numFmt = '0.0"%"';
        }

        const val = typeof cell.value === "number" ? cell.value : parseFloat(String(cell.value || 0));
        if (profitCols.includes(colNumber) && !isNaN(val)) {
          if (val < 0) {
            cell.font = { color: { argb: "FFE57373" } };
          } else if (val > 0) {
            cell.font = { color: { argb: "FF4CAF50" } };
          }
        }
      });
    });

    const fileName = `detailed-sales-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    await writeFile(workbook, fileName);
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <PageHeader title="Sales Report" />
          <p className="text-muted-foreground">
            Analyze profit and loss from POS transactions
            {isMultiCompanyMode && " (All Companies)"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Period Filter */}
          <PeriodFilter
            value={periodFilter}
            onChange={setPeriodFilter}
            data-testid="period-filter-sales-report"
          />

          {/* Multi-company mode toggle */}
          <Button
            variant={isMultiCompanyMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !isMultiCompanyMode;
              setIsMultiCompanyMode(next);
              setSelectedCompanies([]);
              // Location and stock item IDs are company-specific — clear them when entering multi-company mode
              if (next) {
                setSelectedLocation("all");
                setSelectedStockItem("all");
                // If still on "this_month" default, switch to last 30 days so cross-company data is visible
                if (periodFilter.preset === "this_month") {
                  setPeriodFilter(getDefaultPeriodValue("today"));
                }
              }
            }}
            className="gap-2"
            data-testid="button-toggle-multi-company"
          >
            <Building2 className="w-4 h-4" />
            {isMultiCompanyMode ? "All Companies" : "Current Company"}
          </Button>

          {/* Company filter (only in multi-company mode) */}
          {isMultiCompanyMode && companyFilterOptions.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2" data-testid="button-company-filter">
                  <Building2 className="w-4 h-4" />
                  {selectedCompanies.length === 0 
                    ? "All Companies" 
                    : `${selectedCompanies.length} selected`}
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="end">
                <div className="space-y-1">
                  <div 
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer"
                    onClick={() => setSelectedCompanies([])}
                    data-testid="option-all-companies"
                  >
                    <Checkbox 
                      checked={selectedCompanies.length === 0} 
                      className="h-4 w-4"
                    />
                    <span className="text-sm font-medium">All Companies</span>
                  </div>
                  <div className="border-t my-1" />
                  {companyFilterOptions.map(([code, name]) => (
                    <div 
                      key={code}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover-elevate cursor-pointer"
                      onClick={() => {
                        setSelectedCompanies(prev => 
                          prev.includes(code) 
                            ? prev.filter(c => c !== code)
                            : [...prev, code]
                        );
                      }}
                      data-testid={`option-company-${code}`}
                    >
                      <Checkbox 
                        checked={selectedCompanies.includes(code)} 
                        className="h-4 w-4"
                      />
                      <span className="text-sm">{name}</span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <Button variant="outline" size="sm" onClick={() => navigate("/sales-report/comparison")} data-testid="button-compare-companies">
            <GitCompare className="w-4 h-4 mr-2" />
            Compare
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" disabled={groupedData.length === 0} data-testid="button-export-dropdown">
                <Download className="w-4 h-4" />
                Export
                <ChevronDown className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-excel">
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPDF} data-testid="menu-export-pdf">
                <FileText className="w-4 h-4 mr-2" />
                Export PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary Pills */}
      <div className="flex flex-wrap gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-48 rounded-lg" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Total Sales</span>
              <span className="font-semibold font-mono" data-testid="text-total-sales">{formatAmount(totals.totalSales)}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Cost Price</span>
              <span className="font-semibold font-mono" data-testid="text-total-cost">{formatAmount(totals.totalCost)}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              {totals.costProfit >= 0
                ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                : <TrendingDown className="h-4 w-4 text-red-500" />}
              <span className="text-muted-foreground">Cost Profit</span>
              <span className={`font-semibold font-mono ${totals.costProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-cost-profit">
                {totals.costProfit < 0 ? "-" : ""}{formatAmount(Math.abs(totals.costProfit))}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Configured Price</span>
              <span className="font-semibold font-mono" data-testid="text-configured-cost">{formatAmount(totals.totalConfiguredCost)}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              {totals.configuredProfit >= 0
                ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                : <TrendingDown className="h-4 w-4 text-red-500" />}
              <span className="text-muted-foreground">Configured Profit</span>
              <span className={`font-semibold font-mono ${totals.configuredProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-configured-profit">
                {totals.configuredProfit < 0 ? "-" : ""}{formatAmount(Math.abs(totals.configuredProfit))}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={grouping} onValueChange={(value) => setGrouping(value as GroupingType)}>
          <SelectTrigger className="w-32" data-testid="select-grouping">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="yearly">Yearly</SelectItem>
          </SelectContent>
        </Select>
        <Select value={profitFilter} onValueChange={(value) => setProfitFilter(value as ProfitFilter)}>
          <SelectTrigger className="w-40" data-testid="select-profit-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Profits</SelectItem>
            <SelectItem value="positive">Positive Only</SelectItem>
            <SelectItem value="negative">Negative Only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={selectedLocation} onValueChange={setSelectedLocation} disabled={isMultiCompanyMode}>
          <SelectTrigger className="w-40" data-testid="select-location">
            <SelectValue placeholder={isMultiCompanyMode ? "N/A (multi-co)" : "All Locations"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((loc: any) => (
              <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedStockGroup} onValueChange={(val) => { setSelectedStockGroup(val); setSelectedStockItem("all"); }}>
          <SelectTrigger className="w-36" data-testid="select-stock-group">
            <SelectValue placeholder="All Groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Groups</SelectItem>
            {stockGroups.map((g: any) => (
              <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedStockItem} onValueChange={setSelectedStockItem} disabled={isMultiCompanyMode}>
          <SelectTrigger className="w-44" data-testid="select-stock-item">
            <SelectValue placeholder={isMultiCompanyMode ? "N/A (multi-co)" : "All Items"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Items</SelectItem>
            {filteredStockItems.map((item: any) => (
              <SelectItem key={item.id} value={item.id.toString()}>{item.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-44"
          data-testid="input-search"
        />
        <Button variant="ghost" onClick={handleClearFilters} data-testid="button-clear-filters">
          Clear
        </Button>
      </div>

      {/* Data Table */}
      <div>
        <p className="text-xs text-muted-foreground mb-3">
          Sales by {grouping.charAt(0).toUpperCase() + grouping.slice(1)}
          {filteredGroupedData.length > 0 && ` · ${filteredGroupedData.length} row${filteredGroupedData.length !== 1 ? "s" : ""}`}
          {" · "}Click any row to drill in
        </p>
        <div className="border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="text-xs h-9 font-semibold">Date</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right hidden sm:table-cell">Items</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right">Qty</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right">Total Sales</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right hidden sm:table-cell">Cost Price</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right hidden sm:table-cell">Cost Profit</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right hidden sm:table-cell">Config. Price</TableHead>
                <TableHead className="text-xs h-9 font-semibold text-right hidden sm:table-cell">Config. Profit</TableHead>
                <TableHead className="text-xs h-9 w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-10 ml-auto" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                ))
              ) : filteredGroupedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                        <TrendingUp className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">No sales found</p>
                      <p className="text-xs text-muted-foreground">Try adjusting your date range or filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {filteredGroupedData.map((group) => (
                    <TableRow
                      key={group.date}
                      data-testid={`row-sale-${group.date}`}
                      className={`cursor-pointer hover:bg-muted/40${selectedRowDate === group.date ? " bg-muted/40" : ""}`}
                      onClick={() => handleRowClick(group)}
                    >
                      <TableCell className="font-medium py-3">
                        <div className="flex items-center gap-2">
                          {group.displayDate}
                          {group.isCreditSale && (
                            <Badge variant="secondary" className="text-xs no-default-active-elevate bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Credit</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm hidden sm:table-cell">{formatNumber(group.itemCount, 0)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatNumber(group.totalQty, 0)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm">{formatAmount(group.totalSales)}</TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm text-muted-foreground hidden sm:table-cell">{formatAmount(group.totalCost)}</TableCell>
                      <TableCell className={`py-3 text-right font-mono text-sm font-semibold hidden sm:table-cell ${group.costProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {group.costProfit < 0 ? "-" : ""}{formatAmount(Math.abs(group.costProfit))}
                      </TableCell>
                      <TableCell className="py-3 text-right font-mono text-sm text-muted-foreground hidden sm:table-cell">{formatAmount(group.totalConfiguredCost)}</TableCell>
                      <TableCell className={`py-3 text-right font-mono text-sm font-semibold hidden sm:table-cell ${group.configuredProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {group.configuredProfit < 0 ? "-" : ""}{formatAmount(Math.abs(group.configuredProfit))}
                      </TableCell>
                      <TableCell className="py-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="bg-muted/40 hover:bg-muted/40 font-semibold">
                    <TableCell className="py-3 text-xs uppercase tracking-wide text-muted-foreground">Total</TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm hidden sm:table-cell">{formatNumber(salesData.length, 0)}</TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm">{formatNumber(totals.totalQty, 0)}</TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm">{formatAmount(totals.totalSales)}</TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm hidden sm:table-cell">{formatAmount(totals.totalCost)}</TableCell>
                    <TableCell className={`py-3 text-right font-mono text-sm hidden sm:table-cell ${totals.costProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {totals.costProfit < 0 ? "-" : ""}{formatAmount(Math.abs(totals.costProfit))}
                    </TableCell>
                    <TableCell className="py-3 text-right font-mono text-sm hidden sm:table-cell">{formatAmount(totals.totalConfiguredCost)}</TableCell>
                    <TableCell className={`py-3 text-right font-mono text-sm hidden sm:table-cell ${totals.configuredProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {totals.configuredProfit < 0 ? "-" : ""}{formatAmount(Math.abs(totals.configuredProfit))}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .container * {
            visibility: visible;
          }
          .container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          button {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
