import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Download, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

// Helper functions for number formatting
function formatAmount(num: number): string {
  const isWholeNumber = num % 1 === 0;
  if (isWholeNumber) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSmartNumber(num: number | string): string {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  const isWholeNumber = value % 1 === 0;
  if (isWholeNumber) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Type definitions for report data
interface AccountItem {
  id: number;
  code: string;
  name: string;
  accountType?: string;
  balance: number;
}

interface ProfitLossData {
  incomeItems: AccountItem[];
  expenseItems: AccountItem[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  startDate: string | null;
  endDate: string | null;
}

interface BalanceSheetData {
  assets: {
    ledgers: AccountItem[];
    banks: AccountItem[];
    fixedAssets: AccountItem[];
    total: number;
  };
  liabilities: {
    ledgers: AccountItem[];
    suppliers: AccountItem[];
    total: number;
  };
  equity: {
    accounts: AccountItem[];
    total: number;
  };
  asOfDate: string | null;
}

interface SalesItem {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  locationId: number;
  locationName: string;
  stockItemCode: string;
  stockItemName: string;
  stockGroupId: number;
  quantity: string;
  sellingPrice: string;
  costPrice: string;
  totalSales: string;
  totalCost: string;
  profit: string;
}

interface GroupedSalesRow {
  date: string;
  locationId: number;
  locationName: string;
  totalSales: number;
  totalProfit: number;
  vouchers: VoucherSummary[];
}

interface VoucherSummary {
  voucherId: number;
  voucherNumber: string;
  itemsCount: number;
  totalAmount: number;
}

interface SalesData {
  items: SalesItem[];
  summary: {
    totalQuantity: number;
    totalSales: number;
    totalCost: number;
    totalProfit: number;
    grossProfitMargin: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    locationId: string | null;
    stockGroupId: string | null;
  };
}

interface StockLocation {
  locationId: number;
  locationName: string;
  quantity: number;
  averageRate: number;
  totalValue: number;
}

interface StockMovementItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  locations: StockLocation[];
  totalQuantity: number;
  totalValue: number;
}

interface StockMovementData {
  items: StockMovementItem[];
  summary: {
    totalItems: number;
    grandTotalQuantity: number;
    grandTotalValue: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    locationId: string | null;
    stockGroupId: string | null;
  };
}

interface Container {
  id: number;
  containerNumber: string;
  supplierName: string;
  status: string;
  importDate: string;
  itemsTotal: string;
  chargesTotal: string;
  grandTotal: string;
}

interface ContainerData {
  containers: Container[];
  summary: {
    totalContainers: number;
    totalItemsTotal: number;
    totalChargesTotal: number;
    totalGrandTotal: number;
  };
  filters: {
    status: string | null;
    supplierId: string | null;
    startDate: string | null;
    endDate: string | null;
  };
}

interface RatiosData {
  ratios: {
    grossProfitMargin: number;
    netProfitMargin: number;
    currentRatio: number;
    debtToEquity: number;
  };
  underlying: {
    totalIncome: number;
    totalExpenses: number;
    totalSales: number;
    totalCost: number;
    grossProfit: number;
    netProfit: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
  };
}

interface Location {
  id: number;
  name: string;
}

interface StockGroup {
  id: number;
  name: string;
}

interface Supplier {
  id: number;
  name: string;
}

export default function Reports() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("profit-loss");
  
  // Sales dialog state
  const [salesDialogOpen, setSalesDialogOpen] = useState(false);
  const [selectedSalesRow, setSelectedSalesRow] = useState<GroupedSalesRow | null>(null);
  
  // Shared filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [locationId, setLocationId] = useState("");
  const [stockGroupId, setStockGroupId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [containerStatus, setContainerStatus] = useState("");

  // Fetch reference data
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: stockGroups = [] } = useQuery<StockGroup[]>({ queryKey: ["/api/stock-groups"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  // Build query strings
  const profitLossParams = new URLSearchParams();
  if (startDate) profitLossParams.set("startDate", startDate);
  if (endDate) profitLossParams.set("endDate", endDate);

  const balanceSheetParams = new URLSearchParams();
  if (asOfDate) balanceSheetParams.set("asOfDate", asOfDate);

  const salesParams = new URLSearchParams();
  if (startDate) salesParams.set("startDate", startDate);
  if (endDate) salesParams.set("endDate", endDate);
  if (locationId && locationId !== "all") salesParams.set("locationId", locationId);
  if (stockGroupId && stockGroupId !== "all") salesParams.set("stockGroupId", stockGroupId);

  const stockMovementParams = new URLSearchParams();
  if (startDate) stockMovementParams.set("startDate", startDate);
  if (endDate) stockMovementParams.set("endDate", endDate);
  if (locationId && locationId !== "all") stockMovementParams.set("locationId", locationId);
  if (stockGroupId && stockGroupId !== "all") stockMovementParams.set("stockGroupId", stockGroupId);

  const containerParams = new URLSearchParams();
  if (startDate) containerParams.set("startDate", startDate);
  if (endDate) containerParams.set("endDate", endDate);
  if (supplierId && supplierId !== "all") containerParams.set("supplierId", supplierId);
  if (containerStatus && containerStatus !== "all") containerParams.set("status", containerStatus);

  const ratiosParams = new URLSearchParams();
  if (startDate) ratiosParams.set("startDate", startDate);
  if (endDate) ratiosParams.set("endDate", endDate);

  // Fetch reports
  const profitLossUrl = `/api/reports/profit-loss${profitLossParams.toString() ? `?${profitLossParams.toString()}` : ''}`;
  const balanceSheetUrl = `/api/reports/balance-sheet${balanceSheetParams.toString() ? `?${balanceSheetParams.toString()}` : ''}`;
  const salesUrl = `/api/reports/sales${salesParams.toString() ? `?${salesParams.toString()}` : ''}`;
  const stockMovementUrl = `/api/reports/stock-movement${stockMovementParams.toString() ? `?${stockMovementParams.toString()}` : ''}`;
  const containerUrl = `/api/reports/containers${containerParams.toString() ? `?${containerParams.toString()}` : ''}`;
  const ratiosUrl = `/api/reports/ratios${ratiosParams.toString() ? `?${ratiosParams.toString()}` : ''}`;

  const { data: profitLossData, refetch: refetchProfitLoss, isLoading: loadingPL } = useQuery<ProfitLossData>({
    queryKey: [profitLossUrl],
    enabled: activeTab === "profit-loss",
  });

  const { data: balanceSheetData, refetch: refetchBalanceSheet, isLoading: loadingBS } = useQuery<BalanceSheetData>({
    queryKey: [balanceSheetUrl],
    enabled: activeTab === "balance-sheet",
  });

  const { data: salesData, refetch: refetchSales, isLoading: loadingSales } = useQuery<SalesData>({
    queryKey: [salesUrl],
    enabled: activeTab === "sales",
  });

  const { data: stockMovementData, refetch: refetchStockMovement, isLoading: loadingStock } = useQuery<StockMovementData>({
    queryKey: [stockMovementUrl],
    enabled: activeTab === "stock-movement",
  });

  const { data: containerData, refetch: refetchContainers, isLoading: loadingContainers } = useQuery<ContainerData>({
    queryKey: [containerUrl],
    enabled: activeTab === "containers",
  });

  const { data: ratiosData, refetch: refetchRatios, isLoading: loadingRatios } = useQuery<RatiosData>({
    queryKey: [ratiosUrl],
    enabled: activeTab === "ratios",
  });

  const handleGenerate = () => {
    switch (activeTab) {
      case "profit-loss":
        refetchProfitLoss();
        break;
      case "balance-sheet":
        refetchBalanceSheet();
        break;
      case "sales":
        refetchSales();
        break;
      case "stock-movement":
        refetchStockMovement();
        break;
      case "containers":
        refetchContainers();
        break;
      case "ratios":
        refetchRatios();
        break;
    }
    toast({ title: "Report Generated", description: "Data refreshed successfully" });
  };

  const exportToExcel = () => {
    let worksheetData: any[] = [];
    let fileName = "report";

    switch (activeTab) {
      case "profit-loss":
        if (!profitLossData) return;
        fileName = "Profit_Loss_Statement";
        worksheetData = [
          ["Profit & Loss Statement"],
          [`Period: ${startDate || "All"} to ${endDate || "All"}`],
          [],
          ["INCOME"],
          ["Code", "Account Name", "Amount"],
          ...profitLossData.incomeItems.map((item: any) => [item.code, item.name, item.balance]),
          [],
          ["Total Income", "", profitLossData.totalIncome],
          [],
          ["EXPENSES"],
          ["Code", "Account Name", "Amount"],
          ...profitLossData.expenseItems.map((item: any) => [item.code, item.name, item.balance]),
          [],
          ["Total Expenses", "", profitLossData.totalExpenses],
          [],
          ["NET PROFIT", "", profitLossData.netProfit],
        ];
        break;

      case "balance-sheet":
        if (!balanceSheetData) return;
        fileName = "Balance_Sheet";
        worksheetData = [
          ["Balance Sheet"],
          [`As of: ${asOfDate || "Current"}`],
          [],
          ["ASSETS"],
          ["Account Name", "Amount"],
          ...balanceSheetData.assets.ledgers.map((item: any) => [item.name, item.balance]),
          ...balanceSheetData.assets.banks.map((item: any) => [item.name, item.balance]),
          ...balanceSheetData.assets.fixedAssets.map((item: any) => [item.name, item.balance]),
          [],
          ["Total Assets", balanceSheetData.assets.total],
          [],
          ["LIABILITIES"],
          ["Account Name", "Amount"],
          ...balanceSheetData.liabilities.ledgers.map((item: any) => [item.name, item.balance]),
          ...balanceSheetData.liabilities.suppliers.map((item: any) => [item.name, item.balance]),
          [],
          ["Total Liabilities", balanceSheetData.liabilities.total],
          [],
          ["EQUITY"],
          ["Account Name", "Amount"],
          ...balanceSheetData.equity.accounts.map((item: any) => [item.name, item.balance]),
          [],
          ["Total Equity", balanceSheetData.equity.total],
        ];
        break;

      case "sales":
        if (!salesData) return;
        fileName = "Sales_Report";
        // Group sales by date and location
        const groupedSalesExport = salesData.items.reduce((acc: { [key: string]: any }, item: SalesItem) => {
          const key = `${item.voucherDate}_${item.locationId}`;
          if (!acc[key]) {
            acc[key] = {
              date: item.voucherDate,
              locationName: item.locationName,
              totalSales: 0,
              totalProfit: 0
            };
          }
          acc[key].totalSales += parseFloat(item.totalSales);
          acc[key].totalProfit += parseFloat(item.profit);
          return acc;
        }, {});
        
        worksheetData = [
          ["Sales Report"],
          [`Period: ${startDate || "All"} to ${endDate || "All"}`],
          [],
          ["Date", "Location", "Total Sales", "Total Profit"],
          ...Object.values(groupedSalesExport).map((row: any) => [
            row.date,
            row.locationName,
            row.totalSales,
            row.totalProfit,
          ]),
          [],
          ["TOTALS", "", salesData.summary.totalSales, salesData.summary.totalProfit],
          ["Gross Profit Margin", "", "", `${salesData.summary.grossProfitMargin.toFixed(2)}%`],
        ];
        break;

      case "stock-movement":
        if (!stockMovementData) return;
        fileName = "Stock_Movement";
        const stockRows: any[] = [];
        stockMovementData.items.forEach((item: any) => {
          stockRows.push([item.stockItemName, "", "", "", ""]);
          item.locations.forEach((loc: any) => {
            stockRows.push(["", loc.locationName, loc.quantity, loc.averageRate, loc.totalValue]);
          });
          stockRows.push(["Total", "", item.totalQuantity, "", item.totalValue]);
          stockRows.push([]);
        });
        worksheetData = [
          ["Stock Movement Report"],
          [`Period: ${startDate || "All"} to ${endDate || "All"}`],
          [],
          ["Item Name", "Location", "Quantity", "Avg Rate", "Total Value"],
          ...stockRows,
          ["GRAND TOTALS", "", stockMovementData.summary.grandTotalQuantity, "", stockMovementData.summary.grandTotalValue],
        ];
        break;

      case "containers":
        if (!containerData) return;
        fileName = "Container_Report";
        worksheetData = [
          ["Container Report"],
          [`Period: ${startDate || "All"} to ${endDate || "All"}`],
          [],
          ["Container Number", "Supplier", "Status", "Import Date", "Items Total", "Charges Total", "Grand Total"],
          ...containerData.containers.map((c: any) => [
            c.containerNumber,
            c.supplierName,
            c.status,
            c.importDate,
            c.itemsTotal,
            c.chargesTotal,
            c.grandTotal,
          ]),
          [],
          ["TOTALS", "", "", "", containerData.summary.totalItemsTotal, containerData.summary.totalChargesTotal, containerData.summary.totalGrandTotal],
        ];
        break;

      case "ratios":
        if (!ratiosData) return;
        fileName = "Ratio_Analysis";
        worksheetData = [
          ["Ratio Analysis"],
          [`Period: ${startDate || "All"} to ${endDate || "All"}`],
          [],
          ["Financial Ratios"],
          ["Ratio", "Value"],
          ["Gross Profit Margin", `${ratiosData.ratios.grossProfitMargin.toFixed(2)}%`],
          ["Net Profit Margin", `${ratiosData.ratios.netProfitMargin.toFixed(2)}%`],
          ["Current Ratio", ratiosData.ratios.currentRatio.toFixed(2)],
          ["Debt to Equity", ratiosData.ratios.debtToEquity.toFixed(2)],
          [],
          ["Underlying Data"],
          ["Metric", "Amount"],
          ["Total Income", ratiosData.underlying.totalIncome],
          ["Total Expenses", ratiosData.underlying.totalExpenses],
          ["Total Sales", ratiosData.underlying.totalSales],
          ["Total Cost", ratiosData.underlying.totalCost],
          ["Gross Profit", ratiosData.underlying.grossProfit],
          ["Net Profit", ratiosData.underlying.netProfit],
          ["Total Assets", ratiosData.underlying.totalAssets],
          ["Total Liabilities", ratiosData.underlying.totalLiabilities],
          ["Total Equity", ratiosData.underlying.totalEquity],
        ];
        break;
    }

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
    XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    toast({ title: "Excel Exported", description: "Report downloaded successfully" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="heading-reports">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate and export comprehensive business reports
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-6 w-full" data-testid="tabs-reports">
          <TabsTrigger value="profit-loss" data-testid="tab-profit-loss">P&L</TabsTrigger>
          <TabsTrigger value="balance-sheet" data-testid="tab-balance-sheet">Balance</TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-sales">Sales</TabsTrigger>
          <TabsTrigger value="stock-movement" data-testid="tab-stock">Stock</TabsTrigger>
          <TabsTrigger value="containers" data-testid="tab-containers">Containers</TabsTrigger>
          <TabsTrigger value="ratios" data-testid="tab-ratios">Ratios</TabsTrigger>
        </TabsList>

        {/* Filters Card */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {/* Date Range Filters */}
              {activeTab !== "balance-sheet" && (
                <>
                  <div>
                    <Label htmlFor="start-date">Start Date</Label>
                    <Input
                      id="start-date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      data-testid="input-start-date"
                    />
                  </div>
                  <div>
                    <Label htmlFor="end-date">End Date</Label>
                    <Input
                      id="end-date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      data-testid="input-end-date"
                    />
                  </div>
                </>
              )}

              {/* As Of Date Filter for Balance Sheet */}
              {activeTab === "balance-sheet" && (
                <div>
                  <Label htmlFor="as-of-date">As of Date</Label>
                  <Input
                    id="as-of-date"
                    type="date"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    data-testid="input-as-of-date"
                  />
                </div>
              )}

              {/* Location Filter */}
              {(activeTab === "sales" || activeTab === "stock-movement") && (
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Select value={locationId} onValueChange={setLocationId}>
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
              )}

              {/* Stock Group Filter */}
              {(activeTab === "sales" || activeTab === "stock-movement") && (
                <div>
                  <Label htmlFor="stock-group">Stock Group</Label>
                  <Select value={stockGroupId} onValueChange={setStockGroupId}>
                    <SelectTrigger id="stock-group" data-testid="select-stock-group">
                      <SelectValue placeholder="All Groups" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Groups</SelectItem>
                      {stockGroups.map((group: any) => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Supplier Filter */}
              {activeTab === "containers" && (
                <div>
                  <Label htmlFor="supplier">Supplier</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger id="supplier" data-testid="select-supplier">
                      <SelectValue placeholder="All Suppliers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Suppliers</SelectItem>
                      {suppliers.map((supplier: any) => (
                        <SelectItem key={supplier.id} value={supplier.id.toString()}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Container Status Filter */}
              {activeTab === "containers" && (
                <div>
                  <Label htmlFor="container-status">Status</Label>
                  <Select value={containerStatus} onValueChange={setContainerStatus}>
                    <SelectTrigger id="container-status" data-testid="select-container-status">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="OTW">On The Way</SelectItem>
                      <SelectItem value="Arrived">Arrived</SelectItem>
                      <SelectItem value="Offloaded">Offloaded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <Button onClick={handleGenerate} data-testid="button-generate">
                <RefreshCw className="h-4 w-4 mr-2" />
                Generate
              </Button>
              <Button onClick={exportToExcel} variant="outline" data-testid="button-export">
                <Download className="h-4 w-4 mr-2" />
                Export to Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Report Content */}
        <TabsContent value="profit-loss">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Profit & Loss Statement
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingPL ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : profitLossData ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-3">Income</h3>
                    <div className="space-y-2">
                      {profitLossData.incomeItems.map((item: any) => (
                        <div key={item.id} className="flex justify-between py-2 border-b" data-testid={`income-item-${item.id}`}>
                          <span className="text-sm">
                            <span className="font-mono text-muted-foreground mr-2">{item.code}</span>
                            {item.name}
                          </span>
                          <span className="font-mono">${item.balance.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-2 font-semibold">
                        <span>Total Income</span>
                        <span className="font-mono" data-testid="text-total-income">${profitLossData.totalIncome.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium mb-3">Expenses</h3>
                    <div className="space-y-2">
                      {profitLossData.expenseItems.map((item: any) => (
                        <div key={item.id} className="flex justify-between py-2 border-b" data-testid={`expense-item-${item.id}`}>
                          <span className="text-sm">
                            <span className="font-mono text-muted-foreground mr-2">{item.code}</span>
                            {item.name}
                          </span>
                          <span className="font-mono">${item.balance.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-2 font-semibold">
                        <span>Total Expenses</span>
                        <span className="font-mono" data-testid="text-total-expenses">${profitLossData.totalExpenses.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t-2 pt-4">
                    <div className="flex justify-between py-2">
                      <span className="text-lg font-bold">Net Profit</span>
                      <span className={`text-lg font-bold font-mono ${profitLossData.netProfit >= 0 ? "text-chart-2" : "text-destructive"}`} data-testid="text-net-profit">
                        ${profitLossData.netProfit.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No data available. Click Generate to load report.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="balance-sheet">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Balance Sheet
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingBS ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : balanceSheetData ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-3">Assets</h3>
                    <div className="space-y-2">
                      {balanceSheetData.assets.ledgers.length > 0 && (
                        <div className="ml-2 space-y-1">
                          <div className="text-sm font-medium text-muted-foreground">Ledger Accounts</div>
                          {balanceSheetData.assets.ledgers.map((item: any) => (
                            <div key={item.id} className="flex justify-between py-1 text-sm" data-testid={`asset-ledger-${item.id}`}>
                              <span>{item.name}</span>
                              <span className="font-mono">${formatAmount(item.balance)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {balanceSheetData.assets.banks.length > 0 && (
                        <div className="ml-2 space-y-1">
                          <div className="text-sm font-medium text-muted-foreground">Bank Accounts</div>
                          {balanceSheetData.assets.banks.map((item: any) => (
                            <div key={item.id} className="flex justify-between py-1 text-sm" data-testid={`asset-bank-${item.id}`}>
                              <span>{item.name}</span>
                              <span className="font-mono">${formatAmount(item.balance)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {balanceSheetData.assets.fixedAssets.length > 0 && (
                        <div className="ml-2 space-y-1">
                          <div className="text-sm font-medium text-muted-foreground">Fixed Assets</div>
                          {balanceSheetData.assets.fixedAssets.map((item: any) => (
                            <div key={item.id} className="flex justify-between py-1 text-sm" data-testid={`asset-fixed-${item.id}`}>
                              <span>{item.name}</span>
                              <span className="font-mono">${formatAmount(item.balance)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between py-2 font-semibold border-t">
                        <span>Total Assets</span>
                        <span className="font-mono" data-testid="text-total-assets">${formatAmount(balanceSheetData.assets.total)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium mb-3">Liabilities</h3>
                    <div className="space-y-2">
                      {balanceSheetData.liabilities.ledgers.length > 0 && (
                        <div className="ml-2 space-y-1">
                          <div className="text-sm font-medium text-muted-foreground">Ledger Accounts</div>
                          {balanceSheetData.liabilities.ledgers.map((item: any) => (
                            <div key={item.id} className="flex justify-between py-1 text-sm" data-testid={`liability-ledger-${item.id}`}>
                              <span>{item.name}</span>
                              <span className="font-mono">${formatAmount(item.balance)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {balanceSheetData.liabilities.suppliers.length > 0 && (
                        <div className="ml-2 space-y-1">
                          <div className="text-sm font-medium text-muted-foreground">Suppliers</div>
                          {balanceSheetData.liabilities.suppliers.map((item: any) => (
                            <div key={item.id} className="flex justify-between py-1 text-sm" data-testid={`liability-supplier-${item.id}`}>
                              <span>{item.name}</span>
                              <span className="font-mono">${formatAmount(item.balance)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between py-2 font-semibold border-t">
                        <span>Total Liabilities</span>
                        <span className="font-mono" data-testid="text-total-liabilities">${formatAmount(balanceSheetData.liabilities.total)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium mb-3">Equity</h3>
                    <div className="space-y-2">
                      {balanceSheetData.equity.accounts.map((item: any) => (
                        <div key={item.id} className="flex justify-between py-1 text-sm ml-2" data-testid={`equity-account-${item.id}`}>
                          <span>{item.name}</span>
                          <span className="font-mono">${formatAmount(item.balance)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between py-2 font-semibold border-t">
                        <span>Total Equity</span>
                        <span className="font-mono" data-testid="text-total-equity">${formatAmount(balanceSheetData.equity.total)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No data available. Click Generate to load report.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Sales Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingSales ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : salesData ? (
                <>
                  <div className="space-y-4">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b">
                          <tr>
                            <th className="text-left py-2">Date</th>
                            <th className="text-left py-2">Location</th>
                            <th className="text-right py-2">Total Sales</th>
                            <th className="text-right py-2">Total Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Group sales by date and location
                            const groupedSales = salesData.items.reduce((acc: { [key: string]: GroupedSalesRow }, item: SalesItem) => {
                              const key = `${item.voucherDate}_${item.locationId}`;
                              if (!acc[key]) {
                                acc[key] = {
                                  date: item.voucherDate,
                                  locationId: item.locationId,
                                  locationName: item.locationName,
                                  totalSales: 0,
                                  totalProfit: 0,
                                  vouchers: []
                                };
                              }
                              acc[key].totalSales += parseFloat(item.totalSales);
                              acc[key].totalProfit += parseFloat(item.profit);
                              
                              // Track vouchers
                              const voucherIndex = acc[key].vouchers.findIndex(v => v.voucherId === item.voucherId);
                              if (voucherIndex === -1) {
                                acc[key].vouchers.push({
                                  voucherId: item.voucherId,
                                  voucherNumber: item.voucherNumber,
                                  itemsCount: 1,
                                  totalAmount: parseFloat(item.totalSales)
                                });
                              } else {
                                acc[key].vouchers[voucherIndex].itemsCount += 1;
                                acc[key].vouchers[voucherIndex].totalAmount += parseFloat(item.totalSales);
                              }
                              
                              return acc;
                            }, {});

                            const groupedRows = Object.values(groupedSales);
                            
                            return groupedRows.map((row, idx) => (
                              <tr 
                                key={`${row.date}_${row.locationId}`}
                                className="border-b hover-elevate cursor-pointer" 
                                onClick={() => {
                                  setSelectedSalesRow(row);
                                  setSalesDialogOpen(true);
                                }}
                                data-testid={`sales-group-row-${idx}`}
                              >
                                <td className="py-2" data-testid={`text-date-${idx}`}>{row.date}</td>
                                <td className="py-2" data-testid={`text-location-${idx}`}>{row.locationName}</td>
                                <td className="py-2 text-right font-mono" data-testid={`text-sales-${idx}`}>${formatSmartNumber(row.totalSales)}</td>
                                <td className="py-2 text-right font-mono" data-testid={`text-profit-${idx}`}>${formatSmartNumber(row.totalProfit)}</td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                        <tfoot className="font-semibold border-t-2">
                          <tr>
                            <td colSpan={2} className="py-2">TOTALS</td>
                            <td className="py-2 text-right font-mono" data-testid="text-total-sales">${formatSmartNumber(salesData.summary.totalSales)}</td>
                            <td className="py-2 text-right font-mono" data-testid="text-total-profit">${formatSmartNumber(salesData.summary.totalProfit)}</td>
                          </tr>
                          <tr>
                            <td colSpan={3} className="py-2 text-right">Gross Profit Margin:</td>
                            <td className="py-2 text-right font-mono" data-testid="text-profit-margin">{formatSmartNumber(salesData.summary.grossProfitMargin)}%</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <Dialog open={salesDialogOpen} onOpenChange={setSalesDialogOpen}>
                    <DialogContent data-testid="dialog-sales-vouchers">
                      <DialogHeader>
                        <DialogTitle>
                          Vouchers - {selectedSalesRow?.locationName} ({selectedSalesRow?.date})
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="border-b">
                              <tr>
                                <th className="text-left py-2">Voucher Number</th>
                                <th className="text-right py-2">Items Count</th>
                                <th className="text-right py-2">Total Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedSalesRow?.vouchers.map((voucher, idx) => (
                                <tr 
                                  key={voucher.voucherId}
                                  className="border-b hover-elevate cursor-pointer"
                                  onClick={() => navigate(`/vouchers/${voucher.voucherId}`)}
                                  data-testid={`voucher-row-${idx}`}
                                >
                                  <td className="py-2 font-mono text-xs" data-testid={`text-voucher-number-${idx}`}>{voucher.voucherNumber}</td>
                                  <td className="py-2 text-right font-mono" data-testid={`text-voucher-items-${idx}`}>{formatSmartNumber(voucher.itemsCount)}</td>
                                  <td className="py-2 text-right font-mono" data-testid={`text-voucher-amount-${idx}`}>${formatSmartNumber(voucher.totalAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No data available. Click Generate to load report.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stock-movement">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Stock Movement Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingStock ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : stockMovementData ? (
                <div className="space-y-4">
                  {stockMovementData.items.map((item: any) => (
                    <div key={item.stockItemId} className="border rounded-md p-4" data-testid={`stock-item-${item.stockItemId}`}>
                      <div className="flex justify-between mb-2">
                        <div>
                          <div className="font-medium">{item.stockItemName}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">Total</div>
                          <div className="font-mono">{formatSmartNumber(item.totalQuantity)} units</div>
                          <div className="font-mono">${formatSmartNumber(item.totalValue)}</div>
                        </div>
                      </div>
                      <div className="space-y-1 mt-2 pt-2 border-t">
                        {item.locations.map((loc: any) => (
                          <div key={loc.locationId} className="flex justify-between text-sm" data-testid={`location-${loc.locationId}`}>
                            <span className="text-muted-foreground ml-4">{loc.locationName}</span>
                            <span className="font-mono">
                              {formatSmartNumber(loc.quantity)} × ${formatSmartNumber(loc.averageRate)} = ${formatSmartNumber(loc.totalValue)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="border-t-2 pt-4 font-semibold">
                    <div className="flex justify-between">
                      <span>Grand Totals</span>
                      <span className="font-mono" data-testid="text-grand-totals">
                        {formatSmartNumber(stockMovementData.summary.grandTotalQuantity)} units | ${formatSmartNumber(stockMovementData.summary.grandTotalValue)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No data available. Click Generate to load report.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="containers">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Container Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingContainers ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : containerData ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-2">Container #</th>
                          <th className="text-left py-2">Supplier</th>
                          <th className="text-left py-2">Status</th>
                          <th className="text-left py-2">Import Date</th>
                          <th className="text-right py-2">Items Total</th>
                          <th className="text-right py-2">Charges Total</th>
                          <th className="text-right py-2">Grand Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {containerData.containers.map((container: any) => (
                          <tr key={container.id} className="border-b" data-testid={`container-row-${container.id}`}>
                            <td className="py-2 font-mono">{container.containerNumber}</td>
                            <td className="py-2">{container.supplierName}</td>
                            <td className="py-2">{container.status}</td>
                            <td className="py-2">{container.importDate}</td>
                            <td className="py-2 text-right font-mono">${parseFloat(container.itemsTotal).toFixed(2)}</td>
                            <td className="py-2 text-right font-mono">${parseFloat(container.chargesTotal).toFixed(2)}</td>
                            <td className="py-2 text-right font-mono">${parseFloat(container.grandTotal).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="font-semibold border-t-2">
                        <tr>
                          <td colSpan={4} className="py-2">TOTALS</td>
                          <td className="py-2 text-right font-mono" data-testid="text-items-total">${containerData.summary.totalItemsTotal.toFixed(2)}</td>
                          <td className="py-2 text-right font-mono" data-testid="text-charges-total">${containerData.summary.totalChargesTotal.toFixed(2)}</td>
                          <td className="py-2 text-right font-mono" data-testid="text-grand-total">${containerData.summary.totalGrandTotal.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No data available. Click Generate to load report.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ratios">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Ratio Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingRatios ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : ratiosData ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-3">Financial Ratios</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border rounded-md p-4">
                        <div className="text-sm text-muted-foreground">Gross Profit Margin</div>
                        <div className="text-2xl font-bold font-mono" data-testid="text-gross-profit-margin">
                          {ratiosData.ratios.grossProfitMargin.toFixed(2)}%
                        </div>
                      </div>
                      <div className="border rounded-md p-4">
                        <div className="text-sm text-muted-foreground">Net Profit Margin</div>
                        <div className="text-2xl font-bold font-mono" data-testid="text-net-profit-margin">
                          {ratiosData.ratios.netProfitMargin.toFixed(2)}%
                        </div>
                      </div>
                      <div className="border rounded-md p-4">
                        <div className="text-sm text-muted-foreground">Current Ratio</div>
                        <div className="text-2xl font-bold font-mono" data-testid="text-current-ratio">
                          {ratiosData.ratios.currentRatio.toFixed(2)}
                        </div>
                      </div>
                      <div className="border rounded-md p-4">
                        <div className="text-sm text-muted-foreground">Debt to Equity</div>
                        <div className="text-2xl font-bold font-mono" data-testid="text-debt-to-equity">
                          {ratiosData.ratios.debtToEquity.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium mb-3">Underlying Data</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Income</span>
                        <span className="font-mono">${ratiosData.underlying.totalIncome.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Expenses</span>
                        <span className="font-mono">${ratiosData.underlying.totalExpenses.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Sales</span>
                        <span className="font-mono">${ratiosData.underlying.totalSales.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Cost</span>
                        <span className="font-mono">${ratiosData.underlying.totalCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b font-semibold">
                        <span>Gross Profit</span>
                        <span className="font-mono">${ratiosData.underlying.grossProfit.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b font-semibold">
                        <span>Net Profit</span>
                        <span className="font-mono">${ratiosData.underlying.netProfit.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Assets</span>
                        <span className="font-mono">${ratiosData.underlying.totalAssets.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Liabilities</span>
                        <span className="font-mono">${ratiosData.underlying.totalLiabilities.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-b">
                        <span className="text-sm">Total Equity</span>
                        <span className="font-mono">${ratiosData.underlying.totalEquity.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No data available. Click Generate to load report.</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
