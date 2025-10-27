import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { DollarSign, Package, TrendingUp, AlertTriangle } from "lucide-react";
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

//todo: remove mock functionality
const salesData = [
  { month: "Jan", sales: 45000, profit: 12000 },
  { month: "Feb", sales: 52000, profit: 15000 },
  { month: "Mar", sales: 48000, profit: 13500 },
  { month: "Apr", sales: 61000, profit: 18000 },
  { month: "May", sales: 55000, profit: 16500 },
  { month: "Jun", sales: 67000, profit: 21000 },
];

const lowStockItems = [
  { name: "Premium Cotton Bales", stock: 12, location: "Main Warehouse" },
  { name: "Denim Mix Bales", stock: 8, location: "East Branch" },
  { name: "Designer Labels Mix", stock: 5, location: "West Coast Hub" },
];

export default function Dashboard() {
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
          title="Total Revenue"
          value="$328,500"
          change="+12.5% from last month"
          changeType="positive"
          icon={DollarSign}
        />
        <KPICard
          title="Total Profit"
          value="$96,000"
          change="+8.2% from last month"
          changeType="positive"
          icon={TrendingUp}
        />
        <KPICard
          title="Stock Items"
          value="1,247"
          change="-3.1% from last month"
          changeType="negative"
          icon={Package}
        />
        <KPICard
          title="Low Stock Alerts"
          value="23"
          change="5 critical items"
          changeType="negative"
          icon={AlertTriangle}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-medium mb-4">Sales & Profit Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={salesData}>
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
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-medium mb-4">Monthly Sales</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={salesData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="month" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip />
              <Bar dataKey="sales" fill="hsl(var(--chart-1))" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-medium mb-4">Low Stock Alerts</h3>
        <div className="space-y-3">
          {lowStockItems.map((item, index) => (
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
                {item.stock} units
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
