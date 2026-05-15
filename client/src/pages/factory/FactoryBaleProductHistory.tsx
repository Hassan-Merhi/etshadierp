import { useQuery } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Calendar, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";

interface MonthlyBaleData {
  month: number;
  monthName: string;
  baleCount: number;
  balesIn: number;
  balesOut: number;
  balesPending: number;
  balesNet: number;
  totalWeight: number;
  totalWeightOut: number;
  totalWeightNet: number;
  totalCost: number;
  totalSellingValue: number;
}

interface BaleProductHistoryResponse {
  product: {
    id: number;
    name: string;
    articleCode: string;
    weightPerBaleKg: number;
    sellingPrice: string;
  };
  location: {
    id: number;
    name: string;
  };
  year: number;
  monthlyData: MonthlyBaleData[];
  grandTotal: {
    baleCount: number;
    balesIn: number;
    balesOut: number;
    balesPending: number;
    balesNet: number;
    totalWeight: number;
    totalWeightOut: number;
    totalWeightNet: number;
    totalCost: number;
    totalSellingValue: number;
  };
}

interface BaleDetail {
  id: number;
  baleCode: string;
  referenceNumber: string;
  weightKg: number;
  costPerKg: number;
  totalCost: number;
  status: string;
  isInLoadingOrder?: boolean;
  createdAt: string;
}

interface BaleDetailResponse {
  bales: BaleDetail[];
  sellingPrice: string;
}

export default function FactoryBaleProductHistory() {
  const { formatDisplayDate } = useDateFormat();
  const params = useParams();
  const productId = params.productId || "0";
  const locationId = params.locationId || "0";
  const [_location, navigate] = useLocation();
  const { formatAmount } = useCurrencyContext();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());

  useEscapeToParent("/factory/location-inventory");

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const hiddenCost = myAccess?.hiddenCostFields ?? [];

  const { data, isLoading, isError } = useQuery<BaleProductHistoryResponse>({
    queryKey: ["/api/factory/bale-product-history", productId, locationId, { year: selectedYear }],
    queryFn: async () => {
      const response = await fetch(
        `/api/factory/bale-product-history/${productId}/${locationId}?year=${selectedYear}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Failed to load" }));
        throw new Error(err.message || "Failed to load");
      }
      return response.json();
    },
    enabled: parseInt(productId) > 0 && parseInt(locationId) > 0,
    retry: false,
    staleTime: 60 * 1000,
  });

  const years = [];
  for (let y = currentYear; y >= currentYear - 5; y--) {
    years.push(y);
  }

  const chartData =
    data?.monthlyData.map((m) => ({
      name: m.monthName.substring(0, 3),
      "Bales In": m.balesIn,
      "Bales Out": m.balesOut,
    })) || [];

  const handleMonthClick = (month: number) => {
    navigate(
      `/factory/bale-product-history/${productId}/${locationId}/${selectedYear}/${month}`
    );
  };

  const formatNumber = (num: number, _decimals?: number) => {
    if (num % 1 === 0) return num.toLocaleString();
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${formatDisplayDate(d)} ${time}`;
  };


  if (isLoading) {
    return (
      <div className="container mx-auto p-3 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-64" data-testid="skeleton-title" />
        <Skeleton className="h-[400px] w-full" data-testid="skeleton-table" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto p-3 sm:p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/factory/location-inventory")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <PageHeader title="Bale Stock History" />
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-error-state">
            Unable to load bale history. The product or location may not exist for this company.
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasAnyData = data?.monthlyData && data.monthlyData.some((m) => m.balesIn > 0);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/factory/location-inventory")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <PageHeader title="Bale Stock History" />
            {data?.product && data?.location && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-product-info"
              >
                {data.product.name} ({data.product.articleCode}) —{" "}
                {data.location.name}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger
                className="w-[100px] sm:w-[120px]"
                data-testid="select-year"
              >
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg" data-testid="text-table-title">
            Monthly Bale Stock Movement — {selectedYear}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/factory/bale-product-history/${productId}/${locationId}/${selectedYear}/all`)}
            data-testid="button-show-all-bales"
          >
            Show All Months
          </Button>
        </CardHeader>
        <CardContent>
          {!hasAnyData && (
            <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-data">
              No bales recorded in {selectedYear}.
              {(data?.grandTotal.balesNet ?? 0) > 0 && (
                <span className="block mt-1">
                  Current stock (all-time): <strong>{formatNumber(data!.grandTotal.balesNet, 0)}</strong> bales in stock.
                </span>
              )}
            </p>
          )}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right text-green-600 dark:text-green-400">Bales IN</TableHead>
                  <TableHead className="text-right text-red-500 dark:text-red-400">Bales OUT</TableHead>
                  <TableHead className="text-right text-orange-500 dark:text-orange-400">Loading</TableHead>
                  <TableHead className="text-right font-semibold">Net (In Stock)</TableHead>
                  <TableHead className="text-right">KG In</TableHead>
                  <TableHead className="text-right">KG Net</TableHead>
                  {!hiddenCost.includes("bale_history_total_cost") && <TableHead className="text-right">Sell Value</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.monthlyData.map((month) => {
                  const hasData = month.balesIn > 0;
                  return (
                    <TableRow
                      key={month.month}
                      className={hasData ? "cursor-pointer hover:bg-muted/50" : ""}
                      onClick={() => hasData && handleMonthClick(month.month)}
                      data-testid={`row-month-${month.month}`}
                    >
                      <TableCell className="font-medium">{month.monthName}</TableCell>
                      <TableCell className="text-right font-mono text-green-600 dark:text-green-400">
                        {month.balesIn > 0 ? formatNumber(month.balesIn, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-500 dark:text-red-400">
                        {month.balesOut > 0 ? formatNumber(month.balesOut, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono text-orange-500 dark:text-orange-400">
                        {month.balesPending > 0 ? formatNumber(month.balesPending, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {month.balesIn > 0 ? formatNumber(month.balesNet, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {month.totalWeight > 0 ? formatNumber(month.totalWeight) : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {month.balesIn > 0 ? formatNumber(month.totalWeightNet) : ""}
                      </TableCell>
                      {!hiddenCost.includes("bale_history_total_cost") && (
                        <TableCell className="text-right font-mono">
                          {month.totalSellingValue > 0 ? formatAmount(month.totalSellingValue) : ""}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}

                <TableRow className="bg-muted/50 font-bold" data-testid="row-grand-total">
                  <TableCell>Grand Total</TableCell>
                  <TableCell className="text-right font-mono text-green-600 dark:text-green-400" data-testid="text-total-bales-in">
                    {formatNumber(data?.grandTotal.balesIn || 0, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-red-500 dark:text-red-400" data-testid="text-total-bales-out">
                    {formatNumber(data?.grandTotal.balesOut || 0, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-orange-500 dark:text-orange-400" data-testid="text-total-bales-pending">
                    {(data?.grandTotal.balesPending || 0) > 0 ? formatNumber(data?.grandTotal.balesPending || 0, 0) : ""}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid="text-total-bales-net">
                    {formatNumber(data?.grandTotal.balesNet || 0, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid="text-total-weight">
                    {formatNumber(data?.grandTotal.totalWeight || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(data?.grandTotal.totalWeightNet || 0)}
                  </TableCell>
                  {!hiddenCost.includes("bale_history_total_cost") && (
                    <TableCell className="text-right font-mono" data-testid="text-total-sell-value">
                      {formatAmount(data?.grandTotal.totalSellingValue || 0)}
                    </TableCell>
                  )}
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {data?.monthlyData.map((month) => {
              const hasData = month.balesIn > 0;
              return (
                <div
                  key={month.month}
                  className={`p-3 rounded-md border text-sm ${
                    hasData ? "cursor-pointer hover-elevate" : "opacity-50"
                  }`}
                  onClick={() => hasData && handleMonthClick(month.month)}
                  data-testid={`card-month-${month.month}`}
                >
                  <div className="font-medium text-base mb-2">{month.monthName}</div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-green-600 dark:text-green-400">IN</div>
                      <div className="font-mono text-green-600 dark:text-green-400">
                        {month.balesIn > 0 ? formatNumber(month.balesIn, 0) : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-red-500 dark:text-red-400">OUT</div>
                      <div className="font-mono text-red-500 dark:text-red-400">
                        {month.balesOut > 0 ? formatNumber(month.balesOut, 0) : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-orange-500 dark:text-orange-400">Loading</div>
                      <div className="font-mono text-orange-500 dark:text-orange-400">
                        {month.balesPending > 0 ? formatNumber(month.balesPending, 0) : "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Net</div>
                      <div className="font-mono font-semibold">
                        {month.balesIn > 0 ? formatNumber(month.balesNet, 0) : "-"}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                    <div>
                      <div className="text-muted-foreground">KG In</div>
                      <div className="font-mono">{month.totalWeight > 0 ? formatNumber(month.totalWeight) : "-"}</div>
                    </div>
                    {!hiddenCost.includes("bale_history_total_cost") && (
                      <div>
                        <div className="text-muted-foreground">Sell Value</div>
                        <div className="font-mono">{month.totalSellingValue > 0 ? formatAmount(month.totalSellingValue) : "-"}</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {data && (
              <div className="p-3 rounded-md border bg-muted/50 text-sm font-bold" data-testid="card-grand-total">
                <div className="mb-2">Grand Total</div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="text-green-600 dark:text-green-400 font-normal">IN</div>
                    <div className="font-mono text-green-600 dark:text-green-400">{formatNumber(data.grandTotal.balesIn, 0)}</div>
                  </div>
                  <div>
                    <div className="text-red-500 dark:text-red-400 font-normal">OUT</div>
                    <div className="font-mono text-red-500 dark:text-red-400">{formatNumber(data.grandTotal.balesOut, 0)}</div>
                  </div>
                  <div>
                    <div className="text-orange-500 dark:text-orange-400 font-normal">Pending</div>
                    <div className="font-mono text-orange-500 dark:text-orange-400">{formatNumber(data.grandTotal.balesPending, 0)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground font-normal">Net</div>
                    <div className="font-mono">{formatNumber(data.grandTotal.balesNet, 0)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg" data-testid="text-chart-title">
            Monthly IN / OUT Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-muted"
                />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: "var(--radius)",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="Bales In"
                  fill="hsl(142 76% 36%)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="Bales Out"
                  fill="hsl(0 84% 60%)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

export function FactoryBaleProductMonthDetail() {
  const params = useParams();
  const productId = params.productId || "0";
  const locationId = params.locationId || "0";
  const year = params.year || "0";
  const month = params.month || "0";
  const [_location, navigate] = useLocation();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();

  const backPath = `/factory/bale-product-history/${productId}/${locationId}`;

  useEscapeToParent(backPath);

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const hiddenCost = myAccess?.hiddenCostFields ?? [];

  const { data: responseData, isLoading } = useQuery<BaleDetailResponse>({
    queryKey: [
      "/api/factory/bale-product-history",
      productId,
      locationId,
      year,
      month,
    ],
    queryFn: async () => {
      const response = await fetch(
        `/api/factory/bale-product-history/${productId}/${locationId}/${year}/${month}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    enabled:
      parseInt(productId) > 0 &&
      parseInt(locationId) > 0 &&
      parseInt(year) > 0 &&
      parseInt(month) > 0,
  });

  const data = responseData?.bales;
  const sellingPricePerBale = parseFloat(responseData?.sellingPrice || "0");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredData = (data || []).filter((bale) => {
    const effectiveStatus = bale.status === "IN_STOCK" && bale.isInLoadingOrder ? "LOADING" : bale.status;
    if (statusFilter !== "all" && effectiveStatus !== statusFilter) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      if (
        !bale.baleCode?.toLowerCase().includes(t) &&
        !bale.referenceNumber?.toLowerCase().includes(t)
      ) return false;
    }
    return true;
  });

  const monthNames = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const monthName = monthNames[parseInt(month)] || month;

  const formatNumber = (num: number) => {
    if (num % 1 === 0) return num.toLocaleString();
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${formatDisplayDate(d)} ${time}`;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-3 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-64" data-testid="skeleton-title" />
        <Skeleton className="h-[400px] w-full" data-testid="skeleton-table" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(backPath)}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1
            className="text-lg sm:text-2xl font-bold"
            data-testid="text-page-title"
          >
            Bale Details — {monthName} {year}
          </h1>
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-bale-count"
          >
            <Package className="inline h-4 w-4 mr-1" />
            {data?.length || 0} bale(s)
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg" data-testid="text-detail-title">
            Bales for {monthName} {year}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filter bar — A3 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search bale code or ref #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-bale-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
                <SelectItem value="LOADING">Loading</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
                <SelectItem value="DISPATCHED">Dispatched</SelectItem>
                <SelectItem value="DELETED">Deleted</SelectItem>
              </SelectContent>
            </Select>
            {(searchTerm || statusFilter !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearchTerm(""); setStatusFilter("all"); }} data-testid="button-clear-filters">
                Clear
              </Button>
            )}
            <span className="text-sm text-muted-foreground ml-auto">{filteredData.length} bale(s)</span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Bale Code</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Weight (KG)</TableHead>
                  {!hiddenCost.includes("bale_history_cost_per_kg") && <TableHead className="text-right">Cost/KG</TableHead>}
                  {!hiddenCost.includes("bale_history_total_cost") && <TableHead className="text-right">Cost Price</TableHead>}
                  {!hiddenCost.includes("bale_history_total_cost") && <TableHead className="text-right">Sell Price</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Date/Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((bale) => {
                  const isLoading = bale.status === "IN_STOCK" && bale.isInLoadingOrder;
                  return (
                  <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                    <TableCell
                      className="font-medium font-mono"
                      data-testid={`text-bale-code-${bale.id}`}
                    >
                      {bale.baleCode}
                    </TableCell>
                    <TableCell data-testid={`text-reference-${bale.id}`}>
                      <button
                        className="font-mono text-sm text-primary underline-offset-2 hover:underline cursor-pointer"
                        onClick={() => navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.referenceNumber)}`)}
                        data-testid={`button-ref-lookup-${bale.id}`}
                      >
                        {bale.referenceNumber}
                      </button>
                    </TableCell>
                    <TableCell
                      className="text-right font-mono"
                      data-testid={`text-weight-${bale.id}`}
                    >
                      {formatNumber(Number(bale.weightKg))}
                    </TableCell>
                    {!hiddenCost.includes("bale_history_cost_per_kg") && (
                      <TableCell
                        className="text-right font-mono"
                        data-testid={`text-cost-per-kg-${bale.id}`}
                      >
                        {formatAmount(bale.costPerKg)}
                      </TableCell>
                    )}
                    {!hiddenCost.includes("bale_history_total_cost") && (
                      <TableCell
                        className="text-right font-mono"
                        data-testid={`text-total-cost-${bale.id}`}
                      >
                        {formatAmount(bale.totalCost)}
                      </TableCell>
                    )}
                    {!hiddenCost.includes("bale_history_total_cost") && (
                      <TableCell
                        className="text-right font-mono"
                        data-testid={`text-sell-price-${bale.id}`}
                      >
                        {sellingPricePerBale > 0 ? formatAmount(sellingPricePerBale) : "—"}
                      </TableCell>
                    )}
                    <TableCell data-testid={`text-status-${bale.id}`}>
                      {isLoading ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 no-default-active-elevate">
                          Loading
                        </Badge>
                      ) : bale.status === "DELETED" || bale.status === "REMOVED" ? (
                        <Badge variant="destructive">Deleted</Badge>
                      ) : bale.status === "DISPATCHED" ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Dispatched</Badge>
                      ) : (
                        <Badge variant="secondary">{bale.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-date-${bale.id}`}>
                      {formatDateTime(bale.createdAt)}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {(!data || data.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-muted-foreground py-8"
                      data-testid="text-no-data"
                    >
                      No bales found for this month
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {filteredData.map((bale) => {
              const isLoading = bale.status === "IN_STOCK" && bale.isInLoadingOrder;
              return (
              <div
                key={bale.id}
                className="p-3 rounded-md border text-sm"
                data-testid={`card-bale-${bale.id}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span
                    className="font-medium font-mono"
                    data-testid={`text-mobile-bale-code-${bale.id}`}
                  >
                    {bale.baleCode}
                  </span>
                  {isLoading ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 no-default-active-elevate" data-testid={`text-mobile-status-${bale.id}`}>
                      Loading
                    </Badge>
                  ) : (
                    <Badge variant="secondary" data-testid={`text-mobile-status-${bale.id}`}>
                      {bale.status}
                    </Badge>
                  )}
                </div>
                <div className="text-xs mb-2">
                  <button
                    className="font-mono text-primary underline-offset-2 hover:underline cursor-pointer"
                    onClick={() => navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.referenceNumber)}`)}
                    data-testid={`button-ref-lookup-mobile-${bale.id}`}
                  >
                    {bale.referenceNumber}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Weight</div>
                    <div className="font-mono">{formatNumber(Number(bale.weightKg))} KG</div>
                  </div>
                  {!hiddenCost.includes("bale_history_cost_per_kg") && (
                    <div>
                      <div className="text-muted-foreground">Cost/KG</div>
                      <div className="font-mono">{formatAmount(bale.costPerKg)}</div>
                    </div>
                  )}
                  {!hiddenCost.includes("bale_history_total_cost") && (
                    <div>
                      <div className="text-muted-foreground">Cost Price</div>
                      <div className="font-mono">{formatAmount(bale.totalCost)}</div>
                    </div>
                  )}
                  {!hiddenCost.includes("bale_history_total_cost") && (
                    <div>
                      <div className="text-muted-foreground">Sell Price</div>
                      <div className="font-mono">{sellingPricePerBale > 0 ? formatAmount(sellingPricePerBale) : "—"}</div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {formatDateTime(bale.createdAt)}
                </div>
              </div>
              );
            })}
            {filteredData.length === 0 && (
              <div
                className="text-center text-muted-foreground py-8"
                data-testid="text-no-data-mobile"
              >
                No bales found
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function FactoryBaleProductAllMonths() {
  const params = useParams();
  const productId = params.productId || "0";
  const locationId = params.locationId || "0";
  const year = params.year || "0";
  const [_location, navigate] = useLocation();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();

  const backPath = `/factory/bale-product-history/${productId}/${locationId}`;

  useEscapeToParent(backPath);

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[]; hiddenCostFields: string[] }>({
    queryKey: ["/api/factory/my-access"],
  });
  const hiddenCost = myAccess?.hiddenCostFields ?? [];
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: responseData, isLoading } = useQuery<BaleDetailResponse>({
    queryKey: ["/api/factory/bale-product-history", productId, locationId, "all-bales", { year }],
    queryFn: async () => {
      const response = await fetch(
        `/api/factory/bale-product-history/${productId}/${locationId}/all-bales?year=${year}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch");
      return response.json();
    },
    enabled: parseInt(productId) > 0 && parseInt(locationId) > 0,
  });

  const data = responseData?.bales;
  const sellingPricePerBale = parseFloat(responseData?.sellingPrice || "0");

  const filteredData = (data ?? []).filter((bale) => {
    const effectiveStatus = bale.status === "IN_STOCK" && bale.isInLoadingOrder ? "LOADING" : bale.status;
    if (statusFilter !== "all" && effectiveStatus !== statusFilter) return false;
    return true;
  });

  const formatNumber = (num: number) => {
    if (num % 1 === 0) return num.toLocaleString();
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${formatDisplayDate(d)} ${time}`;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-3 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-64" data-testid="skeleton-title" />
        <Skeleton className="h-[400px] w-full" data-testid="skeleton-table" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(backPath)}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-lg sm:text-2xl font-bold" data-testid="text-page-title">
            All Bale Details — {year}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="text-bale-count">
            <Package className="inline h-4 w-4 mr-1" />
            {filteredData.length}{statusFilter !== "all" ? ` of ${data?.length || 0}` : ""} bale(s)
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg" data-testid="text-detail-title">
              All Bales — {year}
            </CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]" data-testid="select-status-filter-all">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="IN_STOCK">In Stock</SelectItem>
                <SelectItem value="LOADING">Loading</SelectItem>
                <SelectItem value="SOLD">Sold</SelectItem>
                <SelectItem value="DISPATCHED">Dispatched</SelectItem>
                <SelectItem value="DELETED">Deleted</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table wrapperClassName="overflow-visible">
              <TableHeader className="sticky top-0 z-30 bg-background">
                <TableRow>
                  <TableHead>Bale Code</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Weight (KG)</TableHead>
                  {!hiddenCost.includes("bale_history_cost_per_kg") && <TableHead className="text-right">Cost/KG</TableHead>}
                  {!hiddenCost.includes("bale_history_total_cost") && <TableHead className="text-right">Cost Price</TableHead>}
                  {!hiddenCost.includes("bale_history_total_cost") && <TableHead className="text-right">Sell Price</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Date/Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((bale) => (
                  <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                    <TableCell className="font-medium font-mono" data-testid={`text-bale-code-${bale.id}`}>
                      {bale.baleCode}
                    </TableCell>
                    <TableCell data-testid={`text-reference-${bale.id}`}>
                      <button
                        className="font-mono text-sm text-primary underline-offset-2 hover:underline cursor-pointer"
                        onClick={() => navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.referenceNumber)}`)}
                        data-testid={`button-ref-lookup-${bale.id}`}
                      >
                        {bale.referenceNumber}
                      </button>
                    </TableCell>
                    <TableCell className="text-right font-mono" data-testid={`text-weight-${bale.id}`}>
                      {formatNumber(bale.weightKg)}
                    </TableCell>
                    {!hiddenCost.includes("bale_history_cost_per_kg") && (
                      <TableCell className="text-right font-mono" data-testid={`text-cost-per-kg-${bale.id}`}>
                        {formatAmount(bale.costPerKg)}
                      </TableCell>
                    )}
                    {!hiddenCost.includes("bale_history_total_cost") && (
                      <TableCell className="text-right font-mono" data-testid={`text-total-cost-${bale.id}`}>
                        {formatAmount(bale.totalCost)}
                      </TableCell>
                    )}
                    {!hiddenCost.includes("bale_history_total_cost") && (
                      <TableCell className="text-right font-mono" data-testid={`text-sell-price-${bale.id}`}>
                        {sellingPricePerBale > 0 ? formatAmount(sellingPricePerBale) : "—"}
                      </TableCell>
                    )}
                    <TableCell data-testid={`text-status-${bale.id}`}>
                      {bale.status === "IN_STOCK" && bale.isInLoadingOrder ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 no-default-active-elevate">
                          Loading
                        </Badge>
                      ) : bale.status === "DELETED" || bale.status === "REMOVED" ? (
                        <Badge variant="destructive">Deleted</Badge>
                      ) : bale.status === "DISPATCHED" ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Dispatched</Badge>
                      ) : (
                        <Badge variant="secondary">{bale.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" data-testid={`text-date-${bale.id}`}>
                      {formatDateTime(bale.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredData.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8" data-testid="text-no-data">
                      {statusFilter !== "all" ? "No bales match the selected status" : `No bales found for ${year}`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {filteredData.map((bale) => (
              <div key={bale.id} className="p-3 rounded-md border text-sm" data-testid={`card-bale-${bale.id}`}>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="font-medium font-mono" data-testid={`text-mobile-bale-code-${bale.id}`}>
                    {bale.baleCode}
                  </span>
                  <Badge variant="secondary" data-testid={`text-mobile-status-${bale.id}`}>
                    {bale.status}
                  </Badge>
                </div>
                <div className="text-xs mb-2">
                  <button
                    className="font-mono text-primary underline-offset-2 hover:underline cursor-pointer"
                    onClick={() => navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.referenceNumber)}`)}
                    data-testid={`button-ref-lookup-mobile-${bale.id}`}
                  >
                    {bale.referenceNumber}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Weight</div>
                    <div className="font-mono">{formatNumber(bale.weightKg)} KG</div>
                  </div>
                  {!hiddenCost.includes("bale_history_cost_per_kg") && (
                    <div>
                      <div className="text-muted-foreground">Cost/KG</div>
                      <div className="font-mono">{formatAmount(bale.costPerKg)}</div>
                    </div>
                  )}
                  {!hiddenCost.includes("bale_history_total_cost") && (
                    <div>
                      <div className="text-muted-foreground">Cost Price</div>
                      <div className="font-mono">{formatAmount(bale.totalCost)}</div>
                    </div>
                  )}
                  {!hiddenCost.includes("bale_history_total_cost") && (
                    <div>
                      <div className="text-muted-foreground">Sell Price</div>
                      <div className="font-mono">{sellingPricePerBale > 0 ? formatAmount(sellingPricePerBale) : "—"}</div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {formatDateTime(bale.createdAt)}
                </div>
              </div>
            ))}
            {(!data || data.length === 0) && (
              <div className="text-center text-muted-foreground py-8" data-testid="text-no-data-mobile">
                No bales found for {year}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
