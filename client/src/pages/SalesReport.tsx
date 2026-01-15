import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/ui/date-picker-input";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileSpreadsheet, FileText, TrendingUp, TrendingDown, ChevronRight, RefreshCw, ChevronDown, Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as XLSX from "xlsx";
import { format, parseISO, startOfDay, startOfMonth, startOfYear } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
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
  createdAt: string;
}

interface DailySummary {
  date: string;
  displayDate: string;
  totalSales: number;
  totalCost: number;
  totalConfiguredCost: number;
  costProfit: number;
  configuredProfit: number;
  itemCount: number;
  items: SalesReportItem[];
}

type GroupingType = "daily" | "monthly" | "yearly";
type ProfitFilter = "all" | "positive" | "negative";

// Format currency: adds commas, removes .00 if whole number
const formatCurrency = (value: string | number): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';
  // If whole number, no decimals; otherwise 2 decimals
  if (num % 1 === 0) {
    return '$' + Math.abs(num).toLocaleString('en-US');
  }
  return '$' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

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
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedStockItem, setSelectedStockItem] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [grouping, setGrouping] = useState<GroupingType>("daily");
  const [profitFilter, setProfitFilter] = useState<ProfitFilter>("all");
  const [selectedDaySummary, setSelectedDaySummary] = useState<DailySummary | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();

  // Mutation to recalculate cost prices
  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (startDate) body.startDate = startDate;
      if (endDate) body.endDate = endDate;
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

  // Build query params
  const queryParams = new URLSearchParams();
  if (startDate) queryParams.append("startDate", startDate);
  if (endDate) queryParams.append("endDate", endDate);
  if (selectedLocation && selectedLocation !== "all") queryParams.append("locationId", selectedLocation);
  if (selectedStockItem && selectedStockItem !== "all") queryParams.append("stockItemId", selectedStockItem);

  const queryString = queryParams.toString();
  const queryKey = queryString ? `/api/sales-report?${queryString}` : "/api/sales-report";

  // Fetch sales report data
  const { data: salesData = [], isLoading } = useQuery<SalesReportItem[]>({
    queryKey: [queryKey],
  });

  // Group sales by date/month/year
  const groupedData: DailySummary[] = salesData.reduce((acc: DailySummary[], item) => {
    const itemDate = parseISO(item.voucherDate);
    let groupKey: string;
    let displayDate: string;

    if (grouping === "daily") {
      groupKey = format(startOfDay(itemDate), "yyyy-MM-dd");
      displayDate = formatDisplayDate(itemDate);
    } else if (grouping === "monthly") {
      groupKey = format(startOfMonth(itemDate), "yyyy-MM");
      displayDate = format(itemDate, "MMMM yyyy");
    } else {
      groupKey = format(startOfYear(itemDate), "yyyy");
      displayDate = format(itemDate, "yyyy");
    }

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

    if (existing) {
      existing.totalSales += totalSales;
      existing.totalCost += totalCost;
      existing.totalConfiguredCost += totalConfiguredCost;
      existing.costProfit += costProfit;
      existing.configuredProfit += configuredProfit;
      existing.itemCount += 1;
      existing.items.push(item);
    } else {
      acc.push({
        date: groupKey,
        displayDate,
        totalSales,
        totalCost,
        totalConfiguredCost,
        costProfit,
        configuredProfit,
        itemCount: 1,
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
    }),
    { totalSales: 0, totalCost: 0, totalConfiguredCost: 0, costProfit: 0, configuredProfit: 0 }
  );

  const handleClearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedLocation("");
    setSelectedStockItem("");
    setSearchTerm("");
    setProfitFilter("all");
  };

  const handleRowClick = (summary: DailySummary) => {
    setSelectedDaySummary(summary);
    setDetailsDialogOpen(true);
  };

  const handleExportExcel = () => {
    const exportData = groupedData.map((group) => ({
      "Date": group.displayDate,
      "Items Sold": group.itemCount,
      "Total Sales": formatNumber(group.totalSales),
      "Total Cost": formatNumber(group.totalCost),
      "Cost Profit": formatNumber(group.costProfit),
      "Configured Cost": formatNumber(group.totalConfiguredCost),
      "Configured Profit": formatNumber(group.configuredProfit),
    }));

    // Add totals row
    exportData.push({
      "Date": "TOTAL",
      "Items Sold": salesData.length,
      "Total Sales": formatNumber(totals.totalSales),
      "Total Cost": formatNumber(totals.totalCost),
      "Cost Profit": formatNumber(totals.costProfit),
      "Configured Cost": formatNumber(totals.totalConfiguredCost),
      "Configured Profit": formatNumber(totals.configuredProfit),
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Report");
    
    const fileName = `sales-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sales Report</h1>
          <p className="text-muted-foreground">
            Analyze profit and loss from POS transactions
          </p>
        </div>
        <div className="flex gap-2">
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Sales</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totals.totalSales)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Price Total</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totals.totalCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Profit</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.costProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {totals.costProfit < 0 ? '-' : ''}{formatCurrency(totals.costProfit)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Configured Price Total</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totals.totalConfiguredCost)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Configured Profit</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.configuredProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {totals.configuredProfit < 0 ? '-' : ''}{formatCurrency(totals.configuredProfit)}
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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
              <Label htmlFor="startDate">Start Date</Label>
              <DatePickerInput
                value={startDate}
                onChange={setStartDate}
                placeholder="Start date"
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <DatePickerInput
                value={endDate}
                onChange={setEndDate}
                placeholder="End date"
                data-testid="input-end-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Select
                value={selectedLocation}
                onValueChange={setSelectedLocation}
              >
                <SelectTrigger id="location" data-testid="select-location">
                  <SelectValue placeholder="All Locations" />
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
              <Label htmlFor="stockItem">Stock Item</Label>
              <Select
                value={selectedStockItem}
                onValueChange={setSelectedStockItem}
              >
                <SelectTrigger id="stockItem" data-testid="select-stock-item">
                  <SelectValue placeholder="All Items" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Items</SelectItem>
                  {stockItems.map((item: any) => (
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Items</TableHead>
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
                      className="cursor-pointer hover-elevate"
                      onClick={() => handleRowClick(group)}
                    >
                      <TableCell className="font-medium">{group.displayDate}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(group.itemCount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(group.totalSales)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(group.totalCost)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${group.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {group.costProfit < 0 ? '-' : ''}{formatCurrency(group.costProfit)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(group.totalConfiguredCost)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${group.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {group.configuredProfit < 0 ? '-' : ''}{formatCurrency(group.configuredProfit)}
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
                      {formatNumber(salesData.length)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(totals.totalSales)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(totals.totalCost)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {totals.costProfit < 0 ? '-' : ''}{formatCurrency(totals.costProfit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(totals.totalConfiguredCost)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {totals.configuredProfit < 0 ? '-' : ''}{formatCurrency(totals.configuredProfit)}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sales Details - {selectedDaySummary?.displayDate}</DialogTitle>
            <DialogDescription>
              All items sold on this {grouping === "daily" ? "day" : grouping === "monthly" ? "month" : "year"}
            </DialogDescription>
          </DialogHeader>
          
          {selectedDaySummary && (
            <div className="space-y-4">
              {/* Summary Cards - Sticky Header */}
              <div className="sticky top-0 z-10 bg-background pt-2 pb-3 -mx-6 px-6 border-b">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="text-xs">Total Qty</CardDescription>
                      <CardTitle className="text-lg">
                        {formatNumber(selectedDaySummary.items.reduce((sum, item) => sum + parseFloat(item.quantity), 0))}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="text-xs">Total Sales</CardDescription>
                      <CardTitle className="text-lg">
                        {formatCurrency(selectedDaySummary.totalSales)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="text-xs">Cost Total</CardDescription>
                      <CardTitle className="text-lg">
                        {formatCurrency(selectedDaySummary.totalCost)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="text-xs">Cost Profit</CardDescription>
                      <CardTitle className={`text-lg ${selectedDaySummary.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {selectedDaySummary.costProfit < 0 ? '-' : ''}{formatCurrency(selectedDaySummary.costProfit)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="text-xs">Hassan's Total</CardDescription>
                      <CardTitle className="text-lg">
                        {formatCurrency(selectedDaySummary.totalConfiguredCost)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription className="text-xs">Hassan's Profit</CardDescription>
                      <CardTitle className={`text-lg ${selectedDaySummary.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {selectedDaySummary.configuredProfit < 0 ? '-' : ''}{formatCurrency(selectedDaySummary.configuredProfit)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Sold Price</TableHead>
                      <TableHead className="text-right">Cost Price</TableHead>
                      <TableHead className="text-right">Hassan's Price</TableHead>
                      <TableHead className="text-right">Unit Profit</TableHead>
                      <TableHead className="text-right">Total Cost</TableHead>
                      <TableHead className="text-right">Cost Profit</TableHead>
                      <TableHead className="text-right">Cost %</TableHead>
                      <TableHead className="text-right">Hassan's Profit</TableHead>
                      <TableHead className="text-right">Hassan's %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDaySummary.items.map((item) => {
                      const unitProfit = parseFloat(item.configuredSellingPrice) - parseFloat(item.costPrice);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.stockItemName}</TableCell>
                          <TableCell>{item.locationName || "-"}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumericValue(item.quantity)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(item.actualSellingPrice)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(item.costPrice)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(item.configuredSellingPrice)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${unitProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {unitProfit < 0 ? '-' : ''}{formatCurrency(unitProfit)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(item.totalCost)}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${parseFloat(item.costProfit) >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {parseFloat(item.costProfit) < 0 ? '-' : ''}{formatCurrency(item.costProfit)}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${item.costProfitPercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.costProfitPercentage.toFixed(1)}%
                          </TableCell>
                          <TableCell className={`text-right font-mono ${item.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.configuredProfit < 0 ? '-' : ''}{formatCurrency(item.configuredProfit)}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${item.configuredProfitPercentage >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.configuredProfitPercentage.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
