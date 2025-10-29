import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState } from "react";
import { DollarSign, TrendingUp, TrendingDown, Wallet, Package, FileText } from "lucide-react";

interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  accountType?: string;
  subType?: string;
  balance: number;
  balanceSide: string | null;
  active: boolean;
}

interface LocationSales {
  locationId: number;
  locationName: string;
  locationCode: string;
  totalSales: number;
  totalTransactions: number;
}

interface SalesDetail {
  locationId: number;
  totalQuantity: number;
  totalAmount: number;
  totalTransactions: number;
}

export default function Financial() {
  const { selectedCompany } = useCompany();
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedLocationForDetails, setSelectedLocationForDetails] = useState<number | null>(null);

  // Get all accounts
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Get net profit
  const { data: profitData, isLoading: profitLoading } = useQuery<{
    totalIncome: number;
    totalExpenses: number;
    netProfit: number;
  }>({
    queryKey: ["/api/stats/net-profit", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Get sales data
  const getDateRange = () => {
    const today = new Date();
    let startDate = "";
    let endDate = today.toISOString().split("T")[0];

    if (selectedPeriod === "today") {
      startDate = endDate;
    } else if (selectedPeriod === "month") {
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate = firstDayOfMonth.toISOString().split("T")[0];
    } else if (selectedPeriod === "year") {
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      startDate = firstDayOfYear.toISOString().split("T")[0];
    }

    return selectedPeriod === "all" ? {} : { startDate, endDate };
  };

  const dateRange = getDateRange();
  const { data: salesData = [], isLoading: salesLoading } = useQuery<LocationSales[]>({
    queryKey: ["/api/financial/sales", selectedCompany?.id, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams(dateRange as Record<string, string>);
      const response = await fetch(`/api/financial/sales?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch sales data");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Get details for selected location
  const { data: salesDetails } = useQuery<SalesDetail>({
    queryKey: ["/api/financial/sales", selectedLocationForDetails, "details", dateRange],
    queryFn: async () => {
      const params = new URLSearchParams(dateRange as Record<string, string>);
      const response = await fetch(
        `/api/financial/sales/${selectedLocationForDetails}/details?${params}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch sales details");
      return response.json();
    },
    enabled: !!selectedLocationForDetails,
  });

  // Filter accounts
  const cashAccounts = accounts.filter(
    (acc) => acc.type === "Bank" && (
      acc.name.toLowerCase().includes("cash") || 
      acc.code.toLowerCase().includes("cash")
    )
  );

  const assetAccounts = accounts.filter(
    (acc) =>
      acc.type === "Fixed Asset" ||
      (acc.type === "Ledger" && acc.accountType === "Asset") ||
      acc.type === "Bank"
  );

  const expenseAccounts = accounts.filter(
    (acc) => acc.type === "Ledger" && acc.accountType === "Expense"
  );

  const directExpenseAccounts = expenseAccounts.filter(
    (acc) => acc.subType === "Direct Expense"
  );

  const indirectExpenseAccounts = expenseAccounts.filter(
    (acc) => acc.subType === "Indirect Expense"
  );

  // Calculate totals
  const calculateTotal = (accountList: Account[]) => {
    return accountList.reduce((sum, acc) => sum + (acc.balance || 0), 0);
  };

  const profitPercent = profitData
    ? profitData.totalIncome > 0
      ? Math.min(100, Math.max(0, (profitData.netProfit / profitData.totalIncome) * 100))
      : 0
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Financial Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of expenses, assets, profit, cash, and sales
        </p>
      </div>

      <Tabs defaultValue="expenses">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="expenses" data-testid="tab-expenses">
            Expenses
          </TabsTrigger>
          <TabsTrigger value="assets" data-testid="tab-assets">
            Assets
          </TabsTrigger>
          <TabsTrigger value="indirect-expenses" data-testid="tab-indirect-expenses">
            Indirect Exp.
          </TabsTrigger>
          <TabsTrigger value="direct-expenses" data-testid="tab-direct-expenses">
            Direct Exp.
          </TabsTrigger>
          <TabsTrigger value="profit" data-testid="tab-profit">
            Profit
          </TabsTrigger>
          <TabsTrigger value="cash" data-testid="tab-cash">
            Cash
          </TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-sales">
            Sales
          </TabsTrigger>
        </TabsList>

        {/* Expenses Tab */}
        <TabsContent value="expenses" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-destructive" />
                All Expense Accounts
              </h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono">
                  ${calculateTotal(expenseAccounts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {accountsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : expenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No expense accounts found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenseAccounts.map((acc) => (
                    <TableRow key={acc.id} data-testid={`row-account-${acc.id}`}>
                      <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {acc.subType || "General"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Assets Tab */}
        <TabsContent value="assets" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                All Asset Accounts
              </h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono">
                  ${calculateTotal(assetAccounts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {accountsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : assetAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No asset accounts found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assetAccounts.map((acc) => (
                    <TableRow key={acc.id} data-testid={`row-account-${acc.id}`}>
                      <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {acc.type}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Indirect Expenses Tab */}
        <TabsContent value="indirect-expenses" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                Indirect Expense Accounts
              </h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono">
                  ${calculateTotal(indirectExpenseAccounts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {accountsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : indirectExpenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No indirect expense accounts found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {indirectExpenseAccounts.map((acc) => (
                    <TableRow key={acc.id} data-testid={`row-account-${acc.id}`}>
                      <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Direct Expenses Tab */}
        <TabsContent value="direct-expenses" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-red-500" />
                Direct Expense Accounts
              </h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono">
                  ${calculateTotal(directExpenseAccounts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {accountsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : directExpenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No direct expense accounts found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directExpenseAccounts.map((acc) => (
                    <TableRow key={acc.id} data-testid={`row-account-${acc.id}`}>
                      <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Profit Tab */}
        <TabsContent value="profit" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-medium mb-6 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              Profit Analysis
            </h3>
            {profitLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">Net Profit</p>
                  <p className={`text-4xl font-bold font-mono ${(profitData?.netProfit || 0) >= 0 ? "text-green-500" : "text-destructive"}`}>
                    ${(profitData?.netProfit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Profit Margin</span>
                      <span className="text-sm font-medium">{profitPercent.toFixed(1)}%</span>
                    </div>
                    <Progress value={profitPercent} className="h-3" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-1">Total Income</p>
                    <p className="text-2xl font-bold font-mono text-green-500">
                      ${(profitData?.totalIncome || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground mb-1">Total Expenses</p>
                    <p className="text-2xl font-bold font-mono text-destructive">
                      ${(profitData?.totalExpenses || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Cash Tab */}
        <TabsContent value="cash" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <Wallet className="h-5 w-5 text-green-500" />
                Cash Accounts
              </h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total Cash</p>
                <p className="text-2xl font-bold font-mono">
                  ${calculateTotal(cashAccounts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {accountsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : cashAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No cash accounts found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Side</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashAccounts.map((acc) => (
                    <TableRow key={acc.id} data-testid={`row-account-${acc.id}`}>
                      <TableCell className="font-mono text-sm">{acc.code}</TableCell>
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {acc.balanceSide || "Dr"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Sales Tab */}
        <TabsContent value="sales" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">POS Sales by Location</h3>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-40" data-testid="select-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {salesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : salesData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No sales data found for the selected period
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location Code</TableHead>
                    <TableHead>Location Name</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesData.map((sale) => (
                    <TableRow 
                      key={sale.locationId} 
                      data-testid={`row-sales-${sale.locationId}`}
                      className="hover-elevate"
                    >
                      <TableCell className="font-mono text-sm">{sale.locationCode}</TableCell>
                      <TableCell className="font-medium">{sale.locationName}</TableCell>
                      <TableCell className="text-right font-mono">
                        {sale.totalTransactions}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${sale.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLocationForDetails(sale.locationId)}
                          data-testid={`button-view-details-${sale.locationId}`}
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sales Detail Dialog */}
      <Dialog open={!!selectedLocationForDetails} onOpenChange={(open) => !open && setSelectedLocationForDetails(null)}>
        <DialogContent data-testid="dialog-sales-details">
          <DialogHeader>
            <DialogTitle>Sales Details</DialogTitle>
          </DialogHeader>
          {salesDetails && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border rounded-md">
                  <p className="text-sm text-muted-foreground mb-1">Total Transactions</p>
                  <p className="text-2xl font-bold font-mono">
                    {salesDetails.totalTransactions}
                  </p>
                </div>
                <div className="p-4 border rounded-md">
                  <p className="text-sm text-muted-foreground mb-1">Total Amount</p>
                  <p className="text-2xl font-bold font-mono">
                    ${salesDetails.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
              <div className="p-4 border rounded-md">
                <p className="text-sm text-muted-foreground mb-1">Average Per Transaction</p>
                <p className="text-xl font-bold font-mono">
                  ${salesDetails.totalTransactions > 0 
                    ? (salesDetails.totalAmount / salesDetails.totalTransactions).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : "0.00"}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
