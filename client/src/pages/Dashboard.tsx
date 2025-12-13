import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DollarSign, TrendingUp, Plus, X, Wallet, ArrowUpRight, ArrowDownLeft, Check, ChevronsUpDown, Truck, Percent } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type ProfitData = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
};

type ImportCycleBalanceData = {
  netImportCycleBalance: number;
  components: {
    supplierBalance: number;
    stockOtwValue: number;
    dutyAgentBalance: number;
    transporterAgentBalance: number;
    loansBalance: number;
    cashBalance: number;
    bankBalance: number;
    directExpenseBalance: number;
    indirectExpenseBalance: number;
    incomeBalance: number;
    stockOnFloorValue: number;
    cogsBalance: number;
    payrollExpenseBalance: number;
    salaryAdvancesBalance: number;
    payrollLiabilitiesBalance: number;
  };
};

type MonthlyData = {
  month: string;
  sales: number;
  profit: number;
};

type ExpenseBreakdownData = {
  name: string;
  value: number;
};

const EXPENSE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

type DashboardCashAccount = {
  id: number;
  accountType: string;
  accountId: number;
  displayOrder: number;
  account: {
    id: number;
    code: string;
    name: string;
    balance?: number;
    currentBalance?: number;
    openingBalance?: string;
    type: string;
  };
};

type Account = {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
};

type PayableAccount = {
  id: number;
  accountId: number;
  code: string;
  name: string;
  balance: number;
};

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddPayableDialogOpen, setIsAddPayableDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [selectedPayableAccountId, setSelectedPayableAccountId] = useState<number>(0);
  const [payableComboboxOpen, setPayableComboboxOpen] = useState(false);
  const [cashComboboxOpen, setCashComboboxOpen] = useState(false);
  
  // Fetch net profit data
  const { data: profitData, isLoading, isError } = useQuery<ProfitData>({
    queryKey: ["/api/stats/net-profit", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/net-profit", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch net profit");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch import cycle balance data
  const { data: importCycleData } = useQuery<ImportCycleBalanceData>({
    queryKey: ["/api/stats/import-cycle-balance", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/import-cycle-balance", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch import cycle balance");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch monthly sales and profit data
  const { data: monthlyData = [], isLoading: monthlyDataLoading } = useQuery<MonthlyData[]>({
    queryKey: ["/api/stats/monthly-data", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/monthly-data", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch monthly data");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch expense breakdown data for donut chart
  const { data: expenseBreakdownData = [], isLoading: expenseBreakdownLoading } = useQuery<ExpenseBreakdownData[]>({
    queryKey: ["/api/stats/expense-breakdown", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/expense-breakdown", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch expense breakdown");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard cash accounts
  const { data: dashboardCashAccounts = [] } = useQuery<DashboardCashAccount[]>({
    queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch all accounts for selection
  const { data: allAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch all payable accounts (ledger accounts with liability/payable type)
  const { data: allPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/accounts/all", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const allAccounts = await response.json();
      // Filter to show only payable/liability type accounts
      return allAccounts.filter((acc: any) => 
        acc.type && acc.type.toLowerCase() === "ledger"
      );
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard payable accounts (auto-refresh every 30 seconds)
  const { data: dashboardPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    refetchInterval: 30000,
  });

  // Add dashboard cash account mutation
  const addAccountMutation = useMutation({
    mutationFn: async (data: { accountType: string; accountId: number }) => {
      return await apiRequest("POST", "/api/dashboard-cash-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts"] });
      setIsAddDialogOpen(false);
      setSelectedAccountId(0);
      toast({
        title: "Success",
        description: "Account added to dashboard",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add account",
        variant: "destructive",
      });
    },
  });

  // Remove dashboard cash account mutation
  const removeAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/dashboard-cash-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts"] });
      toast({
        title: "Success",
        description: "Account removed from dashboard",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove account",
        variant: "destructive",
      });
    },
  });

  // Add dashboard payable account mutation
  const addPayableAccountMutation = useMutation({
    mutationFn: async (data: { supplierId: number }) => {
      return await apiRequest("POST", "/api/dashboard-payable-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-payable-accounts"] });
      setIsAddPayableDialogOpen(false);
      setSelectedPayableAccountId(0);
      toast({
        title: "Success",
        description: "Payable account added to dashboard",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add payable account",
        variant: "destructive",
      });
    },
  });

  // Remove dashboard payable account mutation
  const removePayableAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/dashboard-payable-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-payable-accounts"] });
      toast({
        title: "Success",
        description: "Payable account removed from dashboard",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove payable account",
        variant: "destructive",
      });
    },
  });

  // Get available cash accounts (excluding ones already added)
  const availableCashAccounts = allAccounts.filter(acc => {
    const alreadyAdded = dashboardCashAccounts.some(
      dca => dca.accountType === acc.type.toLowerCase() && dca.accountId === acc.accountId
    );
    return !alreadyAdded;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Show all added cash accounts (regardless of balance)
  const displayedCashAccounts = dashboardCashAccounts;

  // Get available payable accounts (excluding ones already added)
  const availablePayableAccounts = allPayableAccounts.filter(acc => {
    const alreadyAdded = dashboardPayableAccounts.some(dpa => dpa.accountId === acc.accountId);
    return !alreadyAdded;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Filter payable accounts with non-zero balance from dashboard payable accounts
  const displayedPayableAccounts = dashboardPayableAccounts.filter(acc => {
    const balance = Math.abs(acc.balance);
    return balance !== 0;
  });

  // Display error message if query fails
  if (isError) {
    return (
      <div className="space-y-6">
        <div className="text-destructive">Failed to load dashboard data. Please try again.</div>
      </div>
    );
  }

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your business performance
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          title="Total Income"
          value={isLoading ? "Loading..." : formatCurrency(profitData?.totalIncome || 0)}
          change="From all income accounts"
          changeType="positive"
          icon={DollarSign}
          data-testid="kpi-total-income"
        />
        <KPICard
          title="Net Profit"
          value={isLoading ? "Loading..." : formatCurrency(profitData?.netProfit || 0)}
          change="Income minus operating expenses"
          changeType={(profitData?.netProfit ?? 0) >= 0 ? "positive" : "negative"}
          icon={TrendingUp}
          data-testid="kpi-net-profit"
        />
        <KPICard
          title="Import Cycle Balance"
          value={!importCycleData ? "Loading..." : Math.abs(importCycleData.netImportCycleBalance) < 1 ? "$0.00" : formatCurrency(importCycleData.netImportCycleBalance)}
          change="Should be $0 when balanced"
          changeType={Math.abs(importCycleData?.netImportCycleBalance ?? 0) < 1 ? "positive" : "negative"}
          icon={Truck}
          
          data-testid="kpi-import-cycle-balance"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-medium mb-4">Sales & Profit Trend</h3>
          {monthlyDataLoading ? (
            <div className="flex items-center justify-center h-[280px]">
              <p className="text-muted-foreground">Loading chart data...</p>
            </div>
          ) : monthlyData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px]">
              <p className="text-muted-foreground">No sales data available</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip formatter={(value: number) => value.toFixed(2)} />
                <Line
                  type="monotone"
                  dataKey="sales"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-medium mb-4">Expense Breakdown</h3>
          {expenseBreakdownLoading ? (
            <div className="flex items-center justify-center h-[280px]">
              <p className="text-muted-foreground">Loading chart data...</p>
            </div>
          ) : expenseBreakdownData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px]">
              <p className="text-muted-foreground">No expense data available</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={expenseBreakdownData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {expenseBreakdownData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-medium mb-4">Monthly POS Sales</h3>
          {monthlyDataLoading ? (
            <div className="flex items-center justify-center h-[280px]">
              <p className="text-muted-foreground">Loading chart data...</p>
            </div>
          ) : monthlyData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px]">
              <p className="text-muted-foreground">No sales data available</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip formatter={(value: number) => value.toFixed(2)} />
                <Bar dataKey="sales" fill="hsl(var(--chart-1))" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Bottom Row: Profit Margin, Available Cash, Cash to Pay */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profit Margin */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <Percent className="h-5 w-5 text-blue-600" />
              Profit Margin
            </h3>
          </div>
          <div className="flex flex-col items-center justify-center py-6">
            {isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : (
              <>
                <p className={cn(
                  "text-4xl font-bold",
                  (profitData?.totalIncome ?? 0) > 0 && (profitData?.netProfit ?? 0) >= 0 
                    ? "text-green-600" 
                    : "text-red-600"
                )} data-testid="text-profit-margin">
                  {profitData?.totalIncome && profitData.totalIncome > 0
                    ? `${((profitData.netProfit / profitData.totalIncome) * 100).toFixed(1)}%`
                    : "0.0%"}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Net Profit / Total Income
                </p>
                <div className="mt-4 pt-4 border-t w-full text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Net Profit:</span>
                    <span className="font-medium">{formatCurrency(profitData?.netProfit ?? 0)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Total Income:</span>
                    <span className="font-medium">{formatCurrency(profitData?.totalIncome ?? 0)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Available Cash */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <ArrowDownLeft className="h-5 w-5 text-green-600" />
              Available
            </h3>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-cash-account">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Cash Account to Dashboard</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Account</label>
                    <Popover open={cashComboboxOpen} onOpenChange={setCashComboboxOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={cashComboboxOpen}
                          className="w-full justify-between"
                          data-testid="select-account"
                        >
                          {selectedAccountId > 0
                            ? availableCashAccounts.find((acc) => acc.accountId === selectedAccountId)?.name || "Select account..."
                            : "Search accounts..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search accounts..." />
                          <CommandList>
                            <CommandEmpty>No account found.</CommandEmpty>
                            <CommandGroup>
                              {availableCashAccounts.map((account) => (
                                <CommandItem
                                  key={account.id}
                                  value={account.name}
                                  onSelect={() => {
                                    setSelectedAccountId(account.accountId);
                                    setCashComboboxOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedAccountId === account.accountId ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {account.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Button
                    onClick={() => {
                      if (selectedAccountId > 0) {
                        const account = allAccounts.find(a => a.accountId === selectedAccountId);
                        addAccountMutation.mutate({
                          accountType: account?.type.toLowerCase() || "ledger",
                          accountId: selectedAccountId,
                        });
                      }
                    }}
                    disabled={selectedAccountId === 0 || addAccountMutation.isPending}
                    className="w-full"
                    data-testid="button-save-cash-account"
                  >
                    {addAccountMutation.isPending ? "Adding..." : "Add Account"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          
          {displayedCashAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No accounts added</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedCashAccounts.map((dca) => {
                const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
                return (
                  <div key={dca.id} className="flex items-center justify-between py-2 px-3 rounded hover-elevate group" data-testid={`cash-account-row-${dca.id}`}>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{dca.account.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono text-green-600" data-testid={`text-balance-${dca.id}`}>
                        {formatCurrency(balance)}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeAccountMutation.mutate(dca.id)}
                      data-testid={`button-remove-cash-account-${dca.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {displayedCashAccounts.length > 0 && (
                <div className="border-t pt-2 mt-2 flex items-center justify-between py-2 px-3 bg-green-50 dark:bg-green-950/30 rounded font-bold">
                  <span>Total</span>
                  <span className="text-green-600 font-mono" data-testid="text-total-available">
                    {formatCurrency(
                      displayedCashAccounts.reduce((sum, dca) => {
                        const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
                        return sum + balance;
                      }, 0)
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* To Pay (Right) */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-red-600" />
              To Pay
            </h3>
            <Dialog open={isAddPayableDialogOpen} onOpenChange={setIsAddPayableDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-payable-account">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Payable Account to Dashboard</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Supplier</label>
                    <Popover open={payableComboboxOpen} onOpenChange={setPayableComboboxOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={payableComboboxOpen}
                          className="w-full justify-between"
                          data-testid="select-payable-account"
                        >
                          {selectedPayableAccountId > 0
                            ? availablePayableAccounts.find((acc) => acc.accountId === selectedPayableAccountId)?.name || "Select account..."
                            : "Search accounts..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search accounts..." />
                          <CommandList>
                            <CommandEmpty>No account found.</CommandEmpty>
                            <CommandGroup>
                              {availablePayableAccounts.map((account) => (
                                <CommandItem
                                  key={account.accountId}
                                  value={account.name}
                                  onSelect={() => {
                                    setSelectedPayableAccountId(account.accountId);
                                    setPayableComboboxOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedPayableAccountId === account.accountId ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {account.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <Button
                    onClick={() => {
                      if (selectedPayableAccountId > 0) {
                        addPayableAccountMutation.mutate({
                          supplierId: selectedPayableAccountId,
                        });
                      }
                    }}
                    disabled={selectedPayableAccountId === 0 || addPayableAccountMutation.isPending}
                    className="w-full"
                    data-testid="button-save-payable-account"
                  >
                    {addPayableAccountMutation.isPending ? "Adding..." : "Add Account"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          
          {displayedPayableAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No payable accounts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedPayableAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between py-2 px-3 rounded hover-elevate group" data-testid={`payable-account-row-${account.id}`}>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{account.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold font-mono text-red-600" data-testid={`text-payable-${account.id}`}>
                      {formatCurrency(Math.abs(account.balance))}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removePayableAccountMutation.mutate(account.id)}
                    data-testid={`button-remove-payable-account-${account.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {displayedPayableAccounts.length > 0 && (
                <div className="border-t pt-2 mt-2 flex items-center justify-between py-2 px-3 bg-red-50 dark:bg-red-950/30 rounded font-bold">
                  <span>Total</span>
                  <span className="text-red-600 font-mono" data-testid="text-total-payable">
                    {formatCurrency(
                      displayedPayableAccounts.reduce((sum, acc) => sum + Math.abs(acc.balance), 0)
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
