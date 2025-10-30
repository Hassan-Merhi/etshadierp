import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { DollarSign, Package, TrendingUp, AlertTriangle } from "lucide-react";
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

type StockSummary = {
  totalStockItems: number;
  lowStockCount: number;
  criticalCount: number;
  lowStockItems: Array<{
    name: string;
    stock: number;
    location: string;
  }>;
};

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  
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

  // Fetch stock summary data
  const { data: stockSummary, isLoading: stockSummaryLoading } = useQuery<StockSummary>({
    queryKey: ["/api/stats/stock-summary", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/stock-summary", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock summary");
      return await response.json();
    },
    enabled: !!selectedCompany,
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <KPICard
          title="Stock Items"
          value={stockSummaryLoading ? "Loading..." : stockSummary?.totalStockItems.toString() || "0"}
          change="Total unique stock items"
          changeType="neutral"
          icon={Package}
          data-testid="kpi-stock-items"
        />
        <KPICard
          title="Low Stock Alerts"
          value={stockSummaryLoading ? "Loading..." : stockSummary?.lowStockCount.toString() || "0"}
          change={stockSummaryLoading ? "" : `${stockSummary?.criticalCount || 0} critical items`}
          changeType="negative"
          icon={AlertTriangle}
          data-testid="kpi-low-stock"
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

      <Card className="p-6">
        <h3 className="text-lg font-medium mb-4">Low Stock Alerts</h3>
        {stockSummaryLoading ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-muted-foreground">Loading stock data...</p>
          </div>
        ) : !stockSummary?.lowStockItems || stockSummary.lowStockItems.length === 0 ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-muted-foreground">No low stock items</p>
          </div>
        ) : (
          <div className="space-y-3">
            {stockSummary.lowStockItems.map((item, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-md border"
                data-testid={`alert-stock-${index}`}
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.location}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-mono font-medium text-destructive">
                  {item.stock.toFixed(2)} units
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
