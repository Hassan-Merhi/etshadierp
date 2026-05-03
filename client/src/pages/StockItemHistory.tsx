import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useEscapeToParent } from "@/hooks/use-escape-to-parent";
import { ArrowLeft, Calendar } from "lucide-react";
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
import { useState } from "react";
import { PeriodFilter, getDefaultPeriodValue, type PeriodFilterValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
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

interface MonthlyData {
  month: number;
  monthName: string;
  inwardQty: number;
  inwardValue: number;
  outwardQty: number;
  outwardValue: number;
  closingQty: number;
  closingValue: number;
}

interface StockItemSummary {
  stockItem: {
    id: number;
    code: string;
    name: string;
    uom: string;
  };
  year: number;
  monthlyData: MonthlyData[];
  grandTotal: {
    inwardQty: number;
    inwardValue: number;
    outwardQty: number;
    outwardValue: number;
    closingQty: number;
    closingValue: number;
  };
}

export default function StockItemHistory() {
  const params = useParams();
  const stockItemId = parseInt(params.id || "0");
  const [_location, navigate] = useLocation();
  const { formatAmount } = useCurrencyContext();
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("this_year"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  useEscapeToParent("/stock-items");
  
  const { data, isLoading } = useQuery<StockItemSummary>({
    queryKey: [`/api/stock-items/${stockItemId}/monthly-summary`, { year: selectedYear, startDate: periodFilter.fromDate, endDate: periodFilter.toDate }],
    queryFn: async () => {
      const response = await fetch(`/api/stock-items/${stockItemId}/monthly-summary?year=${selectedYear}&startDate=${periodFilter.fromDate}&endDate=${periodFilter.toDate}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
    enabled: stockItemId > 0,
  });
  
  const years = [];
  for (let y = currentYear; y >= currentYear - 5; y--) {
    years.push(y);
  }
  
  const chartData = data?.monthlyData.map(m => ({
    name: m.monthName.substring(0, 3),
    Inwards: m.inwardQty,
    Outwards: m.outwardQty,
  })) || [];
  
  const handleMonthClick = (month: number) => {
    navigate(`/stock-items/${stockItemId}/history/${selectedYear}/${month}`);
  };
  
  const formatNumber = (num: number, decimals = 2) => {
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };
  
  if (isLoading) {
    return (
      <div className="container mx-auto p-3 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => window.history.back()} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <PageHeader title="Stock Item Monthly Summary" />
            {data?.stockItem && (
              <p className="text-sm text-muted-foreground" data-testid="text-item-name">
                {data.stockItem.name} ({data.stockItem.code})
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <PeriodFilter
            value={periodFilter}
            onChange={setPeriodFilter}
            data-testid="period-filter"
          />
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[100px] sm:w-[120px]" data-testid="select-year">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {years.map(y => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Monthly Summary - {selectedYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2} className="align-bottom border-r">Particulars</TableHead>
                  <TableHead colSpan={2} className="text-center border-r">Inwards</TableHead>
                  <TableHead colSpan={2} className="text-center border-r">Outwards</TableHead>
                  <TableHead colSpan={2} className="text-center">Closing Balance</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right border-r">Value</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right border-r">Value</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.monthlyData.map((month) => {
                  const hasData = month.inwardQty > 0 || month.outwardQty > 0 || month.closingQty !== 0;
                  return (
                    <TableRow 
                      key={month.month}
                      className={hasData ? "cursor-pointer hover:bg-muted/50" : ""}
                      onClick={() => hasData && handleMonthClick(month.month)}
                      data-testid={`row-month-${month.month}`}
                    >
                      <TableCell className="font-medium border-r">{month.monthName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {month.inwardQty > 0 ? formatNumber(month.inwardQty, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums border-r">
                        {month.inwardValue > 0 ? formatAmount(month.inwardValue) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {month.outwardQty > 0 ? formatNumber(month.outwardQty, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums border-r">
                        {month.outwardValue > 0 ? formatAmount(month.outwardValue) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {month.closingQty !== 0 ? formatNumber(month.closingQty, 0) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {month.closingValue !== 0 ? formatAmount(month.closingValue) : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
                
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="border-r">Grand Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(data?.grandTotal.inwardQty || 0, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums border-r">
                    {formatAmount(data?.grandTotal.inwardValue || 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(data?.grandTotal.outwardQty || 0, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums border-r">
                    {formatAmount(data?.grandTotal.outwardValue || 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(data?.grandTotal.closingQty || 0, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(data?.grandTotal.closingValue || 0)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {data?.monthlyData.map((month) => {
              const hasData = month.inwardQty > 0 || month.outwardQty > 0 || month.closingQty !== 0;
              return (
                <div
                  key={month.month}
                  className={`p-3 rounded-md border text-sm ${hasData ? "cursor-pointer hover-elevate" : "opacity-50"}`}
                  onClick={() => hasData && handleMonthClick(month.month)}
                  data-testid={`row-month-${month.month}`}
                >
                  <div className="font-medium text-base mb-2">{month.monthName}</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">In</div>
                      <div className="font-mono">{month.inwardQty > 0 ? formatNumber(month.inwardQty, 0) : "-"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Out</div>
                      <div className="font-mono">{month.outwardQty > 0 ? formatNumber(month.outwardQty, 0) : "-"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Closing</div>
                      <div className="font-mono font-medium">{month.closingQty !== 0 ? formatNumber(month.closingQty, 0) : "-"}</div>
                    </div>
                  </div>
                  {hasData && (
                    <div className="grid grid-cols-3 gap-2 text-xs mt-1">
                      <div className="font-mono text-muted-foreground">{month.inwardValue > 0 ? formatAmount(month.inwardValue) : ""}</div>
                      <div className="font-mono text-muted-foreground">{month.outwardValue > 0 ? formatAmount(month.outwardValue) : ""}</div>
                      <div className="font-mono text-muted-foreground">{month.closingValue !== 0 ? formatAmount(month.closingValue) : ""}</div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {data && (
              <div className="p-3 rounded-md border bg-muted/50 text-sm font-bold">
                <div className="mb-2">Grand Total</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground font-normal">In</div>
                    <div className="font-mono">{formatNumber(data.grandTotal.inwardQty, 0)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground font-normal">Out</div>
                    <div className="font-mono">{formatNumber(data.grandTotal.outwardQty, 0)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground font-normal">Closing</div>
                    <div className="font-mono">{formatNumber(data.grandTotal.closingQty, 0)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Monthly Activity Chart</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderColor: 'hsl(var(--border))',
                    borderRadius: 'var(--radius)',
                  }} 
                />
                <Legend />
                <Bar dataKey="Inwards" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Outwards" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
