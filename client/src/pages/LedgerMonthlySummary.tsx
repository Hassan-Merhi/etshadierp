import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, startOfYear, endOfYear, parseISO } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Loader2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MonthlyData {
  month: number;
  monthName: string;
  debit: number;
  credit: number;
  closingBalance: number;
}

interface LedgerMonthlySummaryData {
  account: {
    id: number;
    code: string;
    name: string;
  };
  openingBalance: number;
  months: MonthlyData[];
  grandTotal: {
    debit: number;
    credit: number;
    closingBalance: number;
  };
  dateRange: {
    startDate: string;
    endDate: string;
  };
}

function formatSmartNumber(value: number): string {
  if (value === 0) return "0.00";
  if (Math.abs(value) >= 1000000) {
    return (value / 1000000).toFixed(2) + "M";
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(2) + "K";
  }
  return value.toFixed(2);
}

function formatFullNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function LedgerMonthlySummary() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/ledger-monthly/:accountId");
  const accountId = params?.accountId ? parseInt(params.accountId) : null;

  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(
    format(startOfYear(new Date()), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(
    format(endOfYear(new Date()), "yyyy-MM-dd")
  );

  const { data, isLoading } = useQuery<LedgerMonthlySummaryData>({
    queryKey: ["/api/reports/ledger-monthly-summary", accountId, startDate, endDate],
    queryFn: async () => {
      const response = await fetch(
        `/api/reports/ledger-monthly-summary/${accountId}?startDate=${startDate}&endDate=${endDate}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch ledger monthly summary");
      return response.json();
    },
    enabled: !!accountId,
  });

  const chartData = data?.months.map((m) => ({
    name: m.monthName.substring(0, 3),
    debit: m.debit,
    credit: m.credit,
    balance: Math.abs(m.closingBalance),
  })) || [];

  const handleMonthClick = (month: number, year: number) => {
    navigate(`/ledger-vouchers/${accountId}/${year}/${month}`);
  };

  if (!accountId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Invalid account ID</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary text-primary-foreground p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/analytics")}
              className="text-primary-foreground hover:bg-primary/80"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm opacity-80">Ledger Monthly Summary</p>
              <h1 className="text-xl font-bold" data-testid="text-account-name">
                {data?.account?.name || "Loading..."}
              </h1>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-80">
              {startDate && endDate
                ? `${format(parseISO(startDate), "d/MMM/yy")} to ${format(parseISO(endDate), "d/MMM/yy")}`
                : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Date Filter */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Date Range Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <Label htmlFor="startDate" className="text-xs">
                  Start Date
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-40"
                  data-testid="input-start-date"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="endDate" className="text-xs">
                  End Date
                </Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-40"
                  data-testid="input-end-date"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDate(format(startOfYear(new Date()), "yyyy-MM-dd"));
                  setEndDate(format(endOfYear(new Date()), "yyyy-MM-dd"));
                }}
                data-testid="button-reset-dates"
              >
                This Year
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[400px] w-full" />
            <Skeleton className="h-[300px] w-full" />
          </div>
        ) : data ? (
          <>
            {/* Monthly Table */}
            <Card>
              <CardHeader className="pb-0">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {data.account.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(data.dateRange.startDate), "d/MMM/yy")} to{" "}
                      {format(parseISO(data.dateRange.endDate), "d/MMM/yy")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      Closing Balance
                    </p>
                    <p
                      className={`text-xl font-bold font-mono ${
                        data.grandTotal.closingBalance >= 0
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                      data-testid="text-closing-balance"
                    >
                      {formatFullNumber(Math.abs(data.grandTotal.closingBalance))}
                      {data.grandTotal.closingBalance >= 0 ? " Dr" : " Cr"}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Particulars</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead></TableHead>
                        <TableHead className="text-right">Closing Balance</TableHead>
                        <TableHead className="w-8"></TableHead>
                      </TableRow>
                      <TableRow className="bg-muted/30 text-xs">
                        <TableHead></TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* Opening Balance */}
                      <TableRow className="bg-muted/20">
                        <TableCell className="font-medium">
                          Opening Balance
                        </TableCell>
                        <TableCell></TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right font-mono">
                          {formatFullNumber(Math.abs(data.openingBalance))}
                          {data.openingBalance >= 0 ? " Dr" : " Cr"}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>

                      {/* Monthly rows */}
                      {data.months.map((month) => {
                        const year = parseISO(data.dateRange.startDate).getFullYear();
                        return (
                          <TableRow
                            key={month.month}
                            className="cursor-pointer hover-elevate"
                            onClick={() => handleMonthClick(month.month, year)}
                            data-testid={`row-month-${month.month}`}
                          >
                            <TableCell className="font-medium">
                              {month.monthName}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {month.debit > 0 ? formatFullNumber(month.debit) : ""}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {month.credit > 0 ? formatFullNumber(month.credit) : ""}
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                month.closingBalance >= 0
                                  ? ""
                                  : "text-red-600"
                              }`}
                            >
                              {formatFullNumber(Math.abs(month.closingBalance))}
                              {month.closingBalance >= 0 ? " Dr" : " Cr"}
                            </TableCell>
                            <TableCell>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                          </TableRow>
                        );
                      })}

                      {/* Grand Total */}
                      <TableRow className="bg-primary/10 font-bold border-t-2">
                        <TableCell>Grand Total</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatFullNumber(data.grandTotal.debit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatFullNumber(data.grandTotal.credit)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${
                            data.grandTotal.closingBalance >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatFullNumber(Math.abs(data.grandTotal.closingBalance))}
                          {data.grandTotal.closingBalance >= 0 ? " Dr" : " Cr"}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Bar Chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {data.grandTotal.closingBalance >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  Monthly Transactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                        tickFormatter={(value) => formatSmartNumber(value)}
                      />
                      <Tooltip
                        formatter={(value: number) => formatFullNumber(value)}
                        contentStyle={{
                          backgroundColor: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                        }}
                      />
                      <Bar
                        dataKey="debit"
                        fill="hsl(var(--destructive))"
                        name="Debit"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">Opening Balance</p>
                  <p className="text-lg font-bold font-mono">
                    {formatFullNumber(Math.abs(data.openingBalance))}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">Current Total</p>
                  <p className="text-lg font-bold font-mono">
                    {formatFullNumber(data.grandTotal.debit - data.grandTotal.credit)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">Closing Balance</p>
                  <p
                    className={`text-lg font-bold font-mono ${
                      data.grandTotal.closingBalance >= 0
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {formatFullNumber(Math.abs(data.grandTotal.closingBalance))}
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No data available</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
