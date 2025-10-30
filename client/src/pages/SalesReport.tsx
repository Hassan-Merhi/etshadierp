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
import { FileSpreadsheet, FileText, TrendingUp, TrendingDown } from "lucide-react";
import * as XLSX from "xlsx";
import { format } from "date-fns";

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
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
  createdAt: string;
}

export default function SalesReport() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedStockItem, setSelectedStockItem] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

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
  if (selectedLocation) queryParams.append("locationId", selectedLocation);
  if (selectedStockItem) queryParams.append("stockItemId", selectedStockItem);

  const queryString = queryParams.toString();
  const queryKey = queryString ? `/api/sales-report?${queryString}` : "/api/sales-report";

  // Fetch sales report data
  const { data: salesData = [], isLoading } = useQuery<SalesReportItem[]>({
    queryKey: [queryKey],
  });

  // Filter by search term (client-side)
  const filteredData = salesData.filter((item) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      item.voucherNumber.toLowerCase().includes(searchLower) ||
      item.stockItemName.toLowerCase().includes(searchLower) ||
      item.stockItemCode.toLowerCase().includes(searchLower) ||
      (item.locationName && item.locationName.toLowerCase().includes(searchLower))
    );
  });

  // Calculate totals
  const totals = filteredData.reduce(
    (acc, item) => ({
      quantity: acc.quantity + parseFloat(item.quantity),
      totalSales: acc.totalSales + parseFloat(item.totalSales),
      totalCost: acc.totalCost + parseFloat(item.totalCost),
      profit: acc.profit + parseFloat(item.profit),
    }),
    { quantity: 0, totalSales: 0, totalCost: 0, profit: 0 }
  );

  const handleClearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedLocation("");
    setSelectedStockItem("");
    setSearchTerm("");
  };

  const handleExportExcel = () => {
    const exportData = filteredData.map((item) => ({
      "Voucher #": item.voucherNumber,
      "Date": format(new Date(item.voucherDate), "MMM dd, yyyy"),
      "Location": item.locationName || "-",
      "Item Code": item.stockItemCode,
      "Item Name": item.stockItemName,
      "Quantity": parseFloat(item.quantity).toFixed(3),
      "Selling Price": parseFloat(item.sellingPrice).toFixed(2),
      "Cost Price": parseFloat(item.costPrice).toFixed(2),
      "Total Sales": parseFloat(item.totalSales).toFixed(2),
      "Total Cost": parseFloat(item.totalCost).toFixed(2),
      "Profit/Loss": parseFloat(item.profit).toFixed(2),
    }));

    // Add totals row
    exportData.push({
      "Voucher #": "TOTAL",
      "Date": "",
      "Location": "",
      "Item Code": "",
      "Item Name": "",
      "Quantity": totals.quantity.toFixed(3),
      "Selling Price": "",
      "Cost Price": "",
      "Total Sales": totals.totalSales.toFixed(2),
      "Total Cost": totals.totalCost.toFixed(2),
      "Profit/Loss": totals.profit.toFixed(2),
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
            disabled={filteredData.length === 0}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export Excel
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={filteredData.length === 0}
            data-testid="button-export-pdf"
          >
            <FileText className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <CardDescription>Total Cost</CardDescription>
            <CardTitle className="text-2xl">
              ${totals.totalCost.toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Profit/Loss</CardDescription>
            <CardTitle className={`text-2xl flex items-center gap-2 ${totals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.profit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              ${Math.abs(totals.profit).toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Profit Margin</CardDescription>
            <CardTitle className={`text-2xl ${totals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {totals.totalSales > 0 ? ((totals.profit / totals.totalSales) * 100).toFixed(1) : "0.0"}%
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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
          <CardTitle>Sales Transactions ({filteredData.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading sales data...
            </div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No sales transactions found. Try adjusting your filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Selling Price</TableHead>
                    <TableHead className="text-right">Cost Price</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead className="text-right">Profit/Loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((item) => (
                    <TableRow key={item.id} data-testid={`row-sale-${item.id}`}>
                      <TableCell className="font-medium">{item.voucherNumber}</TableCell>
                      <TableCell>{format(new Date(item.voucherDate), "MMM dd, yyyy")}</TableCell>
                      <TableCell>{item.locationName || "-"}</TableCell>
                      <TableCell>{item.stockItemCode}</TableCell>
                      <TableCell>{item.stockItemName}</TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(item.quantity).toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(item.sellingPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(item.costPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(item.totalSales).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${parseFloat(item.totalCost).toFixed(2)}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${parseFloat(item.profit) >= 0 ? "text-green-600" : "text-red-600"}`}>
                        ${parseFloat(item.profit).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell colSpan={5}>TOTAL</TableCell>
                    <TableCell className="text-right font-mono">
                      {totals.quantity.toFixed(3)}
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right font-mono">
                      ${totals.totalSales.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${totals.totalCost.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ${totals.profit.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
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
