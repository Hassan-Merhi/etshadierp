import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState } from "react";
import { DollarSign, TrendingDown, Wallet, Package, FileText, ChevronRight, ChevronDown } from "lucide-react";
import { format } from "date-fns";

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
  parentId?: number;
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

interface POSTransaction {
  id: number;
  voucherNumber: string;
  voucherDate: string;
  createdAt: string;
  description: string | null;
  totalAmount: number;
  totalQuantity: number;
  itemCount: number;
  items: any[];
}

export default function Financial() {
  const { selectedCompany } = useCompany();
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [detailsPeriod, setDetailsPeriod] = useState("all");
  const [selectedLocationForDetails, setSelectedLocationForDetails] = useState<number | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set());

  // Get all accounts
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
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

  // Get date range for details dialog
  const getDetailsDateRange = () => {
    const today = new Date();
    let startDate = "";
    let endDate = today.toISOString().split("T")[0];

    if (detailsPeriod === "today") {
      startDate = endDate;
    } else if (detailsPeriod === "month") {
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate = firstDayOfMonth.toISOString().split("T")[0];
    } else if (detailsPeriod === "year") {
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      startDate = firstDayOfYear.toISOString().split("T")[0];
    }

    return detailsPeriod === "all" ? {} : { startDate, endDate };
  };

  const detailsDateRange = getDetailsDateRange();

  // Get transactions for selected location
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<POSTransaction[]>({
    queryKey: ["/api/financial/sales", selectedLocationForDetails, "transactions", detailsDateRange],
    queryFn: async () => {
      const params = new URLSearchParams(detailsDateRange as Record<string, string>);
      const response = await fetch(
        `/api/financial/sales/${selectedLocationForDetails}/transactions?${params}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return response.json();
    },
    enabled: !!selectedLocationForDetails,
  });

  // Toggle account expansion
  const toggleAccount = (accountId: number) => {
    const newExpanded = new Set(expandedAccounts);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedAccounts(newExpanded);
  };

  // Group accounts by parent
  const groupAccountsByParent = (accountList: Account[]) => {
    const parentAccounts = accountList.filter(acc => !acc.parentId);
    const childAccounts = accountList.filter(acc => acc.parentId);
    
    const accountMap = new Map<number, Account[]>();
    childAccounts.forEach(child => {
      const parentId = child.parentId!;
      if (!accountMap.has(parentId)) {
        accountMap.set(parentId, []);
      }
      accountMap.get(parentId)!.push(child);
    });

    return { parentAccounts, accountMap };
  };

  // Calculate total for children
  const calculateChildrenTotal = (parentAccountId: number, accountMap: Map<number, Account[]>) => {
    const children = accountMap.get(parentAccountId) || [];
    return children.reduce((sum, acc) => sum + (acc.balance || 0), 0);
  };

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

  const liabilityAccounts = accounts.filter(
    (acc) => 
      (acc.type === "Ledger" && (
        acc.accountType === "Liability" ||
        acc.accountType === "Accounts Payable" ||
        acc.accountType === "Loans" ||
        acc.accountType === "Duty Agent" ||
        acc.accountType === "Transporter Agent"
      ))
  );

  // Calculate totals - properly handle parent-child relationships to avoid double counting
  const calculateTotal = (accountList: Account[]) => {
    // Get all account IDs that are parents of other accounts in this list
    const parentIds = new Set(accountList.filter(acc => acc.parentId).map(acc => acc.parentId!));
    
    // Sum only accounts that are NOT parents (leaf accounts)
    // This includes:
    // 1. Accounts with no children at all
    // 2. Child accounts whose parents are not in the filtered list
    return accountList
      .filter(acc => !parentIds.has(acc.accountId))
      .reduce((sum, acc) => sum + (acc.balance || 0), 0);
  };

  // Render hierarchical accounts
  const renderHierarchicalAccounts = (accountList: Account[]) => {
    const { parentAccounts, accountMap } = groupAccountsByParent(accountList);

    return (
      <>
        {parentAccounts.map((parent) => {
          const children = accountMap.get(parent.accountId) || [];
          const hasChildren = children.length > 0;
          const isExpanded = expandedAccounts.has(parent.accountId);
          const childrenTotal = hasChildren ? calculateChildrenTotal(parent.accountId, accountMap) : 0;

          return (
            <>
              <TableRow 
                key={parent.id} 
                data-testid={`row-account-${parent.id}`}
                className={hasChildren ? "hover-elevate cursor-pointer font-medium" : ""}
                onClick={() => hasChildren && toggleAccount(parent.accountId)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {hasChildren && (
                      isExpanded ? 
                        <ChevronDown className="h-4 w-4" data-testid={`icon-expanded-${parent.id}`} /> : 
                        <ChevronRight className="h-4 w-4" data-testid={`icon-collapsed-${parent.id}`} />
                    )}
                    <span>{parent.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  ${(hasChildren ? childrenTotal : parent.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
              </TableRow>
              {hasChildren && isExpanded && children.map((child) => (
                <TableRow key={child.id} data-testid={`row-account-${child.id}`}>
                  <TableCell className="pl-8 text-muted-foreground">
                    {child.name}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${child.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
              ))}
            </>
          );
        })}
      </>
    );
  };

  // Render hierarchical accounts for Cash tab (with Side column)
  const renderHierarchicalCashAccounts = (accountList: Account[]) => {
    const { parentAccounts, accountMap } = groupAccountsByParent(accountList);

    return (
      <>
        {parentAccounts.map((parent) => {
          const children = accountMap.get(parent.accountId) || [];
          const hasChildren = children.length > 0;
          const isExpanded = expandedAccounts.has(parent.accountId);
          const childrenTotal = hasChildren ? calculateChildrenTotal(parent.accountId, accountMap) : 0;

          return (
            <>
              <TableRow 
                key={parent.id} 
                data-testid={`row-account-${parent.id}`}
                className={hasChildren ? "hover-elevate cursor-pointer font-medium" : ""}
                onClick={() => hasChildren && toggleAccount(parent.accountId)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {hasChildren && (
                      isExpanded ? 
                        <ChevronDown className="h-4 w-4" data-testid={`icon-expanded-${parent.id}`} /> : 
                        <ChevronRight className="h-4 w-4" data-testid={`icon-collapsed-${parent.id}`} />
                    )}
                    <span>{parent.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  ${(hasChildren ? childrenTotal : parent.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {parent.balanceSide || "Dr"}
                </TableCell>
              </TableRow>
              {hasChildren && isExpanded && children.map((child) => (
                <TableRow key={child.id} data-testid={`row-account-${child.id}`}>
                  <TableCell className="pl-8 text-muted-foreground">
                    {child.name}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${child.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {child.balanceSide || "Dr"}
                  </TableCell>
                </TableRow>
              ))}
            </>
          );
        })}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Financial Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of expenses, assets, liabilities, cash, and sales
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
          <TabsTrigger value="liabilities" data-testid="tab-liabilities">
            Liabilities
          </TabsTrigger>
          <TabsTrigger value="indirect-expenses" data-testid="tab-indirect-expenses">
            Indirect Exp.
          </TabsTrigger>
          <TabsTrigger value="direct-expenses" data-testid="tab-direct-expenses">
            Direct Exp.
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
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(expenseAccounts)}
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
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(assetAccounts)}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* Liabilities Tab */}
        <TabsContent value="liabilities" className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <FileText className="h-5 w-5 text-red-500" />
                All Liability Accounts
              </h3>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono">
                  ${calculateTotal(liabilityAccounts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {accountsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : liabilityAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No liability accounts found
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(liabilityAccounts)}
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
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(indirectExpenseAccounts)}
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
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalAccounts(directExpenseAccounts)}
                </TableBody>
              </Table>
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
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Side</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renderHierarchicalCashAccounts(cashAccounts)}
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
      <Dialog open={!!selectedLocationForDetails} onOpenChange={(open) => {
        if (!open) {
          setSelectedLocationForDetails(null);
          setDetailsPeriod("all");
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh]" data-testid="dialog-sales-details">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Transaction Details</DialogTitle>
              <Select value={detailsPeriod} onValueChange={setDetailsPeriod}>
                <SelectTrigger className="w-40" data-testid="select-details-period">
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
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Summary Section */}
            {transactionsLoading ? (
              <div className="grid grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <Card className="p-4" data-testid="card-total-transactions">
                  <p className="text-sm text-muted-foreground mb-1">Total Transactions</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-total-transactions">
                    {transactions.length}
                  </p>
                </Card>
                <Card className="p-4" data-testid="card-total-quantity">
                  <p className="text-sm text-muted-foreground mb-1">Total Quantity Sold</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-total-quantity">
                    {transactions.reduce((sum, t) => sum + t.totalQuantity, 0)}
                  </p>
                </Card>
                <Card className="p-4" data-testid="card-total-amount">
                  <p className="text-sm text-muted-foreground mb-1">Total Amount Sold</p>
                  <p className="text-2xl font-bold font-mono" data-testid="text-total-amount">
                    ${transactions.reduce((sum, t) => sum + t.totalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </Card>
              </div>
            )}

            {/* Transactions Table */}
            {transactionsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-transactions">
                No transactions found for the selected period
              </p>
            ) : (
              <ScrollArea className="max-h-[400px]" data-testid="scroll-transactions">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Voucher Number</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((transaction) => (
                      <TableRow 
                        key={transaction.id} 
                        data-testid={`row-transaction-${transaction.id}`}
                        className="hover-elevate"
                      >
                        <TableCell data-testid={`text-date-${transaction.id}`}>
                          {format(new Date(transaction.voucherDate), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell className="font-medium" data-testid={`text-voucher-${transaction.id}`}>
                          {transaction.voucherNumber}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-items-${transaction.id}`}>
                          {transaction.itemCount}
                        </TableCell>
                        <TableCell className="text-right font-mono" data-testid={`text-quantity-${transaction.id}`}>
                          {transaction.totalQuantity}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium" data-testid={`text-amount-${transaction.id}`}>
                          ${transaction.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
