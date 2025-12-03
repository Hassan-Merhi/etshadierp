import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, Plus, X, Wallet, ArrowUpRight, ArrowDownLeft } from "lucide-react";
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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ProfitData = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
};

type MonthlyData = {
  month: string;
  sales: number;
  profit: number;
};

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

  // Fetch all payable accounts (creditors)
  const { data: allPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/accounts/payables", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/accounts/payables", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch payable accounts");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard payable accounts
  const { data: dashboardPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
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

  // Filter cash accounts with non-zero balance
  const displayedCashAccounts = dashboardCashAccounts.filter(dca => {
    const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
    return balance !== 0;
  });

  // Get available payable accounts (excluding ones already added)
  const availablePayableAccounts = allPayableAccounts.filter(acc => {
    const alreadyAdded = dashboardPayableAccounts.some(dpa => dpa.id === acc.id);
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

      {/* Daily Cash Analysis Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Available Money (Left) */}
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
                    <Select
                      value={selectedAccountId.toString()}
                      onValueChange={(value) => setSelectedAccountId(parseInt(value))}
                    >
                      <SelectTrigger data-testid="select-account">
                        <SelectValue placeholder="Select an account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableCashAccounts.length === 0 ? (
                          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                            No available accounts
                          </div>
                        ) : (
                          availableCashAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.accountId.toString()}>
                              {account.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
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
                      <p className="text-xs text-muted-foreground">{dca.account.code}</p>
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
                    <Select
                      value={selectedPayableAccountId.toString()}
                      onValueChange={(value) => setSelectedPayableAccountId(parseInt(value))}
                    >
                      <SelectTrigger data-testid="select-payable-account">
                        <SelectValue placeholder="Select a supplier..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availablePayableAccounts.length === 0 ? (
                          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                            No available suppliers
                          </div>
                        ) : (
                          availablePayableAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
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
                    <p className="text-xs text-muted-foreground">{account.code}</p>
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
