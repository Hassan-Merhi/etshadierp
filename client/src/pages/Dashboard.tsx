import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, Plus, X, Wallet } from "lucide-react";
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

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedAccountType, setSelectedAccountType] = useState<"ledger" | "bank">("ledger");
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  
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

  // Get available accounts (excluding ones already added)
  const availableAccounts = allAccounts.filter(acc => {
    const alreadyAdded = dashboardCashAccounts.some(
      dca => dca.accountType === acc.type.toLowerCase() && dca.accountId === acc.accountId
    );
    return !alreadyAdded;
  });

  const filteredAvailableAccounts = availableAccounts.filter(acc => 
    selectedAccountType === "bank" ? acc.type === "Bank" : acc.type === "Ledger"
  );

  // Filter cash accounts with non-zero balance
  const displayedCashAccounts = dashboardCashAccounts.filter(dca => {
    const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
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
          change={isLoading ? "" : `Expenses: ${formatCurrency(profitData?.totalExpenses || 0)}`}
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
                <Tooltip />
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
                <Tooltip />
                <Bar dataKey="sales" fill="hsl(var(--chart-1))" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Cash in Hand Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Cash in Hand
          </h3>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-cash-account">
                <Plus className="h-4 w-4 mr-1" />
                Add Account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Cash Account to Dashboard</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Account Type</label>
                  <Select
                    value={selectedAccountType}
                    onValueChange={(value: "ledger" | "bank") => {
                      setSelectedAccountType(value);
                      setSelectedAccountId(0);
                    }}
                  >
                    <SelectTrigger data-testid="select-account-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ledger">Ledger Account</SelectItem>
                      <SelectItem value="bank">Bank Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                      {filteredAvailableAccounts.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          No available accounts
                        </div>
                      ) : (
                        filteredAvailableAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.accountId.toString()}>
                            {account.name} ({account.code})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => {
                    if (selectedAccountId > 0) {
                      addAccountMutation.mutate({
                        accountType: selectedAccountType,
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
            <p>No cash accounts added yet</p>
            <p className="text-sm mt-1">Click "Add Account" to track cash accounts on your dashboard</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedCashAccounts.map((dca) => {
              const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
              return (
                <Card key={dca.id} className="p-4 relative" data-testid={`card-cash-account-${dca.id}`}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2 h-6 w-6"
                    onClick={() => removeAccountMutation.mutate(dca.id)}
                    data-testid={`button-remove-cash-account-${dca.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <div>
                    <p className="text-sm text-muted-foreground">{dca.account.name}</p>
                    <p className="text-xs text-muted-foreground">{dca.account.code}</p>
                    <p className="text-2xl font-bold font-mono mt-2" data-testid={`text-balance-${dca.id}`}>
                      {formatCurrency(balance)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {dca.account.type} Account
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
