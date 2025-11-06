import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { FileSpreadsheet, FileText, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { format, parseISO, startOfDay, startOfMonth, startOfYear } from "date-fns";

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
  configuredProfit: number;
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

const formatSmartNumber = (value: string | number) => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num % 1 === 0 ? num.toString() : value.toString();
};

export default function SalesReport() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedStockItem, setSelectedStockItem] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [grouping, setGrouping] = useState<GroupingType>("daily");
  const [selectedDaySummary, setSelectedDaySummary] = useState<DailySummary | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

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
      displayDate = format(itemDate, "MMM dd, yyyy");
    } else if (grouping === "monthly") {
      groupKey = format(startOfMonth(itemDate), "yyyy-MM");
      displayDate = format(itemDate, "MMMM yyyy");
    } else {
      groupKey = format(startOfYear(itemDate), "yyyy");
      displayDate = format(itemDate, "yyyy");
    }

    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const matches = 
        item.stockItemName.toLowerCase().includes(searchLower) ||
        (item.locationName && item.locationName.toLowerCase().includes(searchLower));
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

  // Calculate totals
  const totals = groupedData.reduce(
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
  };

  const handleRowClick = (summary: DailySummary) => {
    setSelectedDaySummary(summary);
    setDetailsDialogOpen(true);
  };

  const handleExportExcel = () => {
    const exportData = groupedData.map((group) => ({
      "Date": group.displayDate,
      "Items Sold": group.itemCount,
      "Total Sales": group.totalSales.toFixed(2),
      "Total Cost": group.totalCost.toFixed(2),
      "Cost Profit": group.costProfit.toFixed(2),
      "Configured Cost": group.totalConfiguredCost.toFixed(2),
      "Configured Profit": group.configuredProfit.toFixed(2),
    }));

    // Add totals row
    exportData.push({
      "Date": "TOTAL",
      "Items Sold": salesData.length,
      "Total Sales": totals.totalSales.toFixed(2),
      "Total Cost": totals.totalCost.toFixed(2),
      "Cost Profit": totals.costProfit.toFixed(2),
      "Configured Cost": totals.totalConfiguredCost.toFixed(2),
      "Configured Profit": totals.configuredProfit.toFixed(2),
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
          <Button
            variant="outline"
            onClick={handleExportExcel}
            disabled={groupedData.length === 0}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={groupedData.length === 0}
            data-testid="button-export-pdf"
          >
            <FileText className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Sales</CardDescription>
            <CardTitle className="text-2xl">
              ${totals.totalSales.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Price Total</CardDescription>
            <CardTitle className="text-2xl">
              ${totals.totalCost.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost Profit</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.costProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              ${Math.abs(totals.costProfit).toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Configured Price Total</CardDescription>
            <CardTitle className="text-2xl">
              ${totals.totalConfiguredCost.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Configured Profit</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.configuredProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              ${Math.abs(totals.configuredProfit).toFixed(2)}
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
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
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
          <CardTitle>Sales by {grouping.charAt(0).toUpperCase() + grouping.slice(1)} ({groupedData.length})</CardTitle>
          <CardDescription>Click on any row to view detailed breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading sales data...
            </div>
          ) : groupedData.length === 0 ? (
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
                  {groupedData.map((group) => (
                    <TableRow 
                      key={group.date} 
                      data-testid={`row-sale-${group.date}`}
                      className="cursor-pointer hover-elevate"
                      onClick={() => handleRowClick(group)}
                    >
                      <TableCell className="font-medium">{group.displayDate}</TableCell>
                      <TableCell className="text-right font-mono">
                        {group.itemCount}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${group.totalSales.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${group.totalCost.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${group.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        ${group.costProfit.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${group.totalConfiguredCost.toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${group.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                        ${group.configuredProfit.toFixed(2)}
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
                      {salesData.length}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${totals.totalSales.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${totals.totalCost.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${totals.costProfit.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${totals.totalConfiguredCost.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${totals.configuredProfit.toFixed(2)}
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
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs">Total Sales</CardDescription>
                    <CardTitle className="text-lg">
                      ${selectedDaySummary.totalSales.toFixed(2)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs">Cost Total</CardDescription>
                    <CardTitle className="text-lg">
                      ${selectedDaySummary.totalCost.toFixed(2)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs">Cost Profit</CardDescription>
                    <CardTitle className={`text-lg ${selectedDaySummary.costProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${selectedDaySummary.costProfit.toFixed(2)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs">Configured Total</CardDescription>
                    <CardTitle className="text-lg">
                      ${selectedDaySummary.totalConfiguredCost.toFixed(2)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription className="text-xs">Configured Profit</CardDescription>
                    <CardTitle className={`text-lg ${selectedDaySummary.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${selectedDaySummary.configuredProfit.toFixed(2)}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Actual Price</TableHead>
                      <TableHead className="text-right">Cost Price</TableHead>
                      <TableHead className="text-right">Configured Price</TableHead>
                      <TableHead className="text-right">Total Sales</TableHead>
                      <TableHead className="text-right">Cost Profit</TableHead>
                      <TableHead className="text-right">Configured Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedDaySummary.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.stockItemName}</TableCell>
                        <TableCell>{item.locationName || "-"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatSmartNumber(item.quantity)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(item.actualSellingPrice).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(item.costPrice).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(item.configuredSellingPrice).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${parseFloat(item.totalSales).toFixed(2)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${parseFloat(item.costProfit) >= 0 ? "text-green-600" : "text-red-600"}`}>
                          ${parseFloat(item.costProfit).toFixed(2)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${item.configuredProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                          ${item.configuredProfit.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
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
