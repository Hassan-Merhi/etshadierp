import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { DollarSign, TrendingUp, Wallet, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
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

  // Filter cash accounts with non-zero balance
  const displayedCashAccounts = allAccounts.filter(acc => {
    const balance = parseFloat(String(acc.balance || 0));
    return balance !== 0;
  });

  // Filter payable accounts with non-zero balance
  const displayedPayableAccounts = allPayableAccounts.filter(acc => {
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
          </div>
          
          {displayedCashAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No cash accounts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedCashAccounts.map((account) => {
                const balance = parseFloat(String(account.balance || 0));
                return (
                  <div key={account.accountId} className="flex items-center justify-between py-2 px-3 rounded hover-elevate" data-testid={`cash-account-row-${account.accountId}`}>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground">{account.code}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono text-green-600" data-testid={`text-balance-${account.accountId}`}>
                        {formatCurrency(balance)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {displayedCashAccounts.length > 0 && (
                <div className="border-t pt-2 mt-2 flex items-center justify-between py-2 px-3 bg-green-50 dark:bg-green-950/30 rounded font-bold">
                  <span>Total</span>
                  <span className="text-green-600 font-mono" data-testid="text-total-available">
                    {formatCurrency(
                      displayedCashAccounts.reduce((sum, account) => {
                        const balance = parseFloat(String(account.balance || 0));
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
          </div>
          
          {displayedPayableAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No payable accounts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedPayableAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between py-2 px-3 rounded hover-elevate" data-testid={`payable-account-row-${account.id}`}>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{account.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold font-mono text-red-600" data-testid={`text-payable-${account.id}`}>
                      {formatCurrency(Math.abs(account.balance))}
                    </p>
                  </div>
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
