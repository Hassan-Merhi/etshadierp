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
import { FileSpreadsheet, FileText, TrendingUp, TrendingDown, ChevronRight, RefreshCw, ChevronDown, Download, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { utils, writeFile, readFile, ExcelJS } from "@/lib/excelHelper";
import { format, parseISO, startOfDay, startOfMonth, startOfYear } from "date-fns";
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
const formatSmartNumber = (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toLocaleString('en-US') : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function SalesReport() {
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("last_1_month"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedStockItem, setSelectedStockItem] = useState<string>("");
  const [selectedStockGroup, setSelectedStockGroup] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [grouping, setGrouping] = useState<GroupingType>("daily");
  const [profitFilter, setProfitFilter] = useState<ProfitFilter>("all");
  const [isMultiCompanyMode, setIsMultiCompanyMode] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedRowDate, setSelectedRowDate] = useState<string | null>(null);
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();

  // Mutation to recalculate cost prices
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (periodFilter.fromDate) body.startDate = periodFilter.fromDate;
      if (periodFilter.toDate) body.endDate = periodFilter.toDate;
      if (selectedLocation && selectedLocation !== "all") body.locationId = parseInt(selectedLocation);
      if (selectedStockItem && selectedStockItem !== "all") body.stockItemId = parseInt(selectedStockItem);
      
      return apiRequest("POST", "/api/sales-report/recalculate-costs", body);
    },
    onSuccess: (data: any) => {
      toast({
        title: "Cost Prices Updated",
        description: `Updated ${data.updatedCount} of ${data.totalChecked} sales items`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sales-report"] });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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
    setPeriodFilter(getDefaultPeriodValue("last_1_month"));
    setSelectedLocation("");
    setSelectedStockItem("");
    setSelectedStockGroup("");
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
    navigate(`/sales-report/detail?${params.toString()}`);
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
          <h1 className="text-3xl font-bold">Sales Report</h1>
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
                setSelectedLocation("");
                setSelectedStockItem("");
                // If still on "this_month" default, switch to last 30 days so cross-company data is visible
                if (periodFilter.preset === "this_month") {
                  setPeriodFilter(getDefaultPeriodValue("last_1_month"));
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Sales</CardDescription>
            <CardTitle className="text-2xl">
              {formatAmount(totals.totalSales)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Price Total</CardDescription>
            <CardTitle className="text-2xl">
              {formatAmount(totals.totalCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Profit</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.costProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {totals.costProfit < 0 ? '-' : ''}{formatAmount(totals.costProfit)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Configured Price Total</CardDescription>
            <CardTitle className="text-2xl">
              {formatAmount(totals.totalConfiguredCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Configured Profit</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.configuredProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {totals.configuredProfit < 0 ? '-' : ''}{formatAmount(totals.configuredProfit)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="space-y-2">
              <Label htmlFor="grouping">View By</Label>
              <Select
                value={grouping}
                onValueChange={(value) => setGrouping(value as GroupingType)}
              >
                <SelectTrigger id="grouping" data-testid="select-grouping">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profitFilter">Profit Filter</Label>
              <Select
                value={profitFilter}
                onValueChange={(value) => setProfitFilter(value as ProfitFilter)}
              >
                <SelectTrigger id="profitFilter" data-testid="select-profit-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Profits</SelectItem>
                  <SelectItem value="positive">Positive Only</SelectItem>
                  <SelectItem value="negative">Negative Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Select
                value={selectedLocation}
                onValueChange={setSelectedLocation}
                disabled={isMultiCompanyMode}
              >
                <SelectTrigger id="location" data-testid="select-location">
                  <SelectValue placeholder={isMultiCompanyMode ? "N/A (multi-co)" : "All Locations"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id.toString()}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockGroup">Stock Group</Label>
              <Select
                value={selectedStockGroup}
                onValueChange={(val) => {
                  setSelectedStockGroup(val);
                  setSelectedStockItem(""); // reset item when group changes
                }}
              >
                <SelectTrigger id="stockGroup" data-testid="select-stock-group">
                  <SelectValue placeholder="All Groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {stockGroups.map((g: any) => (
                    <SelectItem key={g.id} value={g.id.toString()}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stockItem">Stock Item</Label>
              <Select
                value={selectedStockItem}
                onValueChange={setSelectedStockItem}
                disabled={isMultiCompanyMode}
              >
                <SelectTrigger id="stockItem" data-testid="select-stock-item">
                  <SelectValue placeholder={isMultiCompanyMode ? "N/A (multi-co)" : "All Items"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Items</SelectItem>
                  {filteredStockItems.map((item: any) => (
                    <SelectItem key={item.id} value={item.id.toString()}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search"
              />
            </div>
          </div>
          <div className="mt-4">
            <Button
              variant="outline"
              onClick={handleClearFilters}
              data-testid="button-clear-filters"
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>Sales by {grouping.charAt(0).toUpperCase() + grouping.slice(1)} ({filteredGroupedData.length})</CardTitle>
          <CardDescription>Click on any row to view detailed breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading sales data...
            </div>
          ) : filteredGroupedData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sales transactions found. Try adjusting your filters.
            </div>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total Qty</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Cost Price Total</TableHead>
                    <TableHead className="text-right">Cost Profit</TableHead>
                    <TableHead className="text-right">Configured Price Total</TableHead>
                    <TableHead className="text-right">Configured Profit</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroupedData.map((group) => (
                    <TableRow 
                      key={group.date} 
                      data-testid={`row-sale-${group.date}`}
                      className={`cursor-pointer hover-elevate${selectedRowDate === group.date ? " bg-muted" : ""}`}
                      onClick={() => handleRowClick(group)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {group.displayDate}
                          {group.isCreditSale && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-400 dark:text-amber-400 dark:border-amber-600">Credit</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(group.itemCount, 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(group.totalQty, 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatAmount(group.totalSales)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatAmount(group.totalCost)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${group.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {group.costProfit < 0 ? '-' : ''}{formatAmount(group.costProfit)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatAmount(group.totalConfiguredCost)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${group.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {group.configuredProfit < 0 ? '-' : ''}{formatAmount(group.configuredProfit)}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell>TOTAL</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(salesData.length, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(totals.totalQty, 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatAmount(totals.totalSales)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatAmount(totals.totalCost)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {totals.costProfit < 0 ? '-' : ''}{formatAmount(totals.costProfit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatAmount(totals.totalConfiguredCost)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {totals.configuredProfit < 0 ? '-' : ''}{formatAmount(totals.configuredProfit)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="md:hidden space-y-3">
              {filteredGroupedData.map((group) => (
                <Card 
                  key={group.date}
                  data-testid={`row-sale-${group.date}`}
                  className={`cursor-pointer hover-elevate${selectedRowDate === group.date ? " bg-muted" : ""}`}
                  onClick={() => handleRowClick(group)}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{group.displayDate}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Items: </span>
                        <span className="font-mono">{formatNumber(group.itemCount, 0)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Qty: </span>
                        <span className="font-mono">{formatNumber(group.totalQty, 0)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Sales: </span>
                        <span className="font-mono">{formatAmount(group.totalSales)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cost: </span>
                        <span className="font-mono">{formatAmount(group.totalCost)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Cost Profit: </span>
                        <span className={`font-mono font-semibold ${group.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {group.costProfit < 0 ? '-' : ''}{formatAmount(group.costProfit)}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Config Profit: </span>
                        <span className={`font-mono font-semibold ${group.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {group.configuredProfit < 0 ? '-' : ''}{formatAmount(group.configuredProfit)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <Card className="bg-muted/50">
                <CardContent className="p-4">
                  <div className="font-bold text-sm mb-2">TOTAL</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Sales: </span>
                      <span className="font-mono font-semibold">{formatAmount(totals.totalSales)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cost: </span>
                      <span className="font-mono font-semibold">{formatAmount(totals.totalCost)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cost Profit: </span>
                      <span className={`font-mono font-semibold ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {totals.costProfit < 0 ? '-' : ''}{formatAmount(totals.costProfit)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Config Profit: </span>
                      <span className={`font-mono font-semibold ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {totals.configuredProfit < 0 ? '-' : ''}{formatAmount(totals.configuredProfit)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            </>
          )}
        </CardContent>
      </Card>

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
