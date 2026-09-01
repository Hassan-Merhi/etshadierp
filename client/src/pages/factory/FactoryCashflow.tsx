import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, DollarSign, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

interface FreightPayment {
  vendor: string;
  amount: number;
  dueDate: string;
  remaining: number;
}

interface PayrollForecast {
  period: string;
  estimatedAmount: number;
  employeeCount?: number;
}

interface IncomeEntry {
  source: string;
  amount: number;
  expectedDate: string;
}

interface CashflowData {
  totalOutgoing: number;
  expectedIncome: number;
  netPosition: number;
  payrollEstimate: number;
  freightPayments: FreightPayment[];
  payrollForecast: PayrollForecast[];
  incomeEntries?: IncomeEntry[];
}

const PERIOD_OPTIONS = [30, 60, 90] as const;

function formatCurrency(value: number): string {
  const isWhole = Math.abs(value) % 1 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function FactoryCashflow() {
  const [days, setDays] = useState<number>(30);

  const { data, isLoading } = useQuery<CashflowData>({
    queryKey: ["/api/factory/cashflow", days],
    queryFn: async () => {
      const res = await fetch(`/api/factory/cashflow?days=${days}`);
      if (!res.ok) throw new Error("Failed to load cashflow forecast");
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Cash Flow Forecast" />
          <p className="text-muted-foreground mt-1">Projected cash flow for the next {days} days</p>
        </div>
        <div className="flex items-center gap-2" data-testid="period-selector">
          {PERIOD_OPTIONS.map((period) => (
            <Button
              key={period}
              variant={days === period ? "default" : "outline"}
              onClick={() => setDays(period)}
              data-testid={`button-period-${period}`}
            >
              {period} Days
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading cashflow forecast...</span>
        </div>
      ) : !data ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground" data-testid="text-no-data">
            No cashflow data available
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card data-testid="card-total-outgoing">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Outgoing</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-total-outgoing">
                  {formatCurrency(data.totalOutgoing)}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-expected-income">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Expected Income</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className="text-2xl font-bold text-green-600 dark:text-green-400"
                  data-testid="text-expected-income"
                >
                  {formatCurrency(data.expectedIncome)}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-net-position">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Position</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${data.netPosition >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid="text-net-position"
                >
                  {formatCurrency(data.netPosition)}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-payroll-estimate">
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Payroll Estimate</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-payroll-estimate">
                  {formatCurrency(data.payrollEstimate)}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-freight-payments">
            <CardHeader>
              <CardTitle>Upcoming Freight Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {!data.freightPayments || data.freightPayments.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground" data-testid="text-no-freight">
                    No upcoming freight payments
                  </p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Remaining</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.freightPayments.map((payment, idx) => (
                        <TableRow key={`${payment.vendor}-${idx}`} data-testid={`row-freight-${idx}`}>
                          <TableCell className="font-medium">{payment.vendor}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(payment.amount)}</TableCell>
                          <TableCell className="font-mono text-sm">{payment.dueDate}</TableCell>
                          <TableCell className="font-mono text-red-600 dark:text-red-400">
                            {formatCurrency(payment.remaining)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-payroll-forecast">
            <CardHeader>
              <CardTitle>Payroll Forecast</CardTitle>
            </CardHeader>
            <CardContent>
              {!data.payrollForecast || data.payrollForecast.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground" data-testid="text-no-payroll">
                    No payroll forecast data
                  </p>
                </div>
              ) : (
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Estimated Amount</TableHead>
                        <TableHead>Employees</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.payrollForecast.map((entry, idx) => (
                        <TableRow key={`${entry.period}-${idx}`} data-testid={`row-payroll-${idx}`}>
                          <TableCell className="font-medium">{entry.period}</TableCell>
                          <TableCell className="font-mono">{formatCurrency(entry.estimatedAmount)}</TableCell>
                          <TableCell>
                            {entry.employeeCount != null ? (
                              <Badge variant="outline">{entry.employeeCount}</Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {data.incomeEntries && data.incomeEntries.length > 0 && (
            <Card data-testid="card-expected-income-details">
              <CardHeader>
                <CardTitle>Expected Income</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Expected Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.incomeEntries.map((entry, idx) => (
                        <TableRow key={`${entry.source}-${idx}`} data-testid={`row-income-${idx}`}>
                          <TableCell className="font-medium">{entry.source}</TableCell>
                          <TableCell className="font-mono text-green-600 dark:text-green-400">
                            {formatCurrency(entry.amount)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{entry.expectedDate}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
