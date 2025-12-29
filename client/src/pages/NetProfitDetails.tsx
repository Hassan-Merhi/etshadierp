import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  Minus,
  Equal,
  AlertCircle
} from "lucide-react";
import { Link } from "wouter";
import { formatNumber } from "@/lib/formatNumber";

interface BreakdownItem {
  name: string;
  value: number;
}

interface NetProfitData {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  forUs: { total: number; breakdown: BreakdownItem[] };
  onUs: { total: number; breakdown: BreakdownItem[] };
  income: { total: number; breakdown: BreakdownItem[] };
  expenses: { total: number; breakdown: BreakdownItem[] };
  netPosition: number;
  netPositionLabel: string;
  forUsTotal: number;
  onUsTotal: number;
  incomeTotal: number;
  expensesTotal: number;
}

export default function NetProfitDetails() {
  const { data, isLoading, error, refetch } = useQuery<NetProfitData>({
    queryKey: ["/api/stats/net-profit"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load data: {(error as Error).message}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const netProfit = data?.netProfit || 0;
  const isProfit = netProfit >= 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Net Profit Details</h1>
            <p className="text-muted-foreground">Detailed breakdown of income and expenses</p>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" data-testid="button-refresh">
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-income">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Total Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${formatNumber(data?.incomeTotal || 0)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">Added to profit</p>
          </CardContent>
        </Card>

        <Card data-testid="card-expenses">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Total Expenses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              ${formatNumber(data?.expensesTotal || 0)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">Subtracted from profit</p>
          </CardContent>
        </Card>

        <Card data-testid="card-net-profit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Net Profit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
              ${formatNumber(netProfit)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {isProfit ? 'Profit' : 'Loss'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-formula">
        <CardHeader>
          <CardTitle>Calculation Formula</CardTitle>
          <CardDescription>How Net Profit is calculated</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 text-lg flex-wrap">
            <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950 px-3 py-2 rounded-lg">
              <span className="font-semibold text-green-700 dark:text-green-300">Income</span>
              <span className="text-green-600">${formatNumber(data?.incomeTotal || 0)}</span>
            </div>
            <Minus className="h-5 w-5 text-muted-foreground" />
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">
              <span className="font-semibold text-red-700 dark:text-red-300">Expenses</span>
              <span className="text-red-600">${formatNumber(data?.expensesTotal || 0)}</span>
            </div>
            <Equal className="h-5 w-5 text-muted-foreground" />
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${isProfit ? 'bg-green-100 dark:bg-green-900' : 'bg-red-100 dark:bg-red-900'}`}>
              <span className={`font-semibold ${isProfit ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                Net Profit
              </span>
              <span className={isProfit ? 'text-green-600' : 'text-red-600'}>
                ${formatNumber(netProfit)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-income-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" />
              Income (Added)
            </CardTitle>
            <CardDescription>Revenue and income sources</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.income.breakdown && data.income.breakdown.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.income.breakdown.map((item, index) => (
                    <TableRow key={index} data-testid={`income-row-${index}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right text-green-600">
                        +${formatNumber(item.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>Total Income</TableCell>
                    <TableCell className="text-right text-green-600">
                      ${formatNumber(data?.incomeTotal || 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">No income recorded</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-expenses-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Minus className="h-5 w-5 text-red-600" />
              Expenses (Subtracted)
            </CardTitle>
            <CardDescription>Costs and expenses</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.expenses.breakdown && data.expenses.breakdown.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.expenses.breakdown.map((item, index) => (
                    <TableRow key={index} data-testid={`expense-row-${index}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right text-red-600">
                        -${formatNumber(Math.abs(item.value))}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>Total Expenses</TableCell>
                    <TableCell className="text-right text-red-600">
                      ${formatNumber(data?.expensesTotal || 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">No expenses recorded</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-net-position">
        <CardHeader>
          <CardTitle>Net Position Summary</CardTitle>
          <CardDescription>Full equity position including assets and liabilities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Assets (For Us)</p>
                <p className="text-xl font-bold text-green-600">${formatNumber(data?.forUsTotal || 0)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Liabilities (On Us)</p>
                <p className="text-xl font-bold text-red-600">${formatNumber(data?.onUsTotal || 0)}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Income</p>
                <p className="text-xl font-bold text-green-600">${formatNumber(data?.incomeTotal || 0)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Expenses</p>
                <p className="text-xl font-bold text-red-600">${formatNumber(data?.expensesTotal || 0)}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-lg font-mono bg-muted p-4 rounded-lg flex-wrap">
              <span className="text-green-600">{formatNumber(data?.forUsTotal || 0)}</span>
              <span className="text-muted-foreground">-</span>
              <span className="text-red-600">{formatNumber(data?.onUsTotal || 0)}</span>
              <span className="text-muted-foreground">+</span>
              <span className="text-green-600">{formatNumber(data?.incomeTotal || 0)}</span>
              <span className="text-muted-foreground">-</span>
              <span className="text-red-600">{formatNumber(data?.expensesTotal || 0)}</span>
              <span className="text-muted-foreground">=</span>
              <span className={`font-bold ${(data?.netPosition || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${formatNumber(data?.netPosition || 0)}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={data?.netPosition && data.netPosition >= 0 ? "default" : "destructive"}>
                {data?.netPositionLabel || "Net Position"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-assets-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              Assets Breakdown
            </CardTitle>
            <CardDescription>What we have or is owed to us</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.forUs.breakdown && data.forUs.breakdown.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.forUs.breakdown.map((item, index) => (
                    <TableRow key={index} data-testid={`asset-row-${index}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right text-green-600">
                        ${formatNumber(item.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">No assets recorded</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-liabilities-breakdown">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              Liabilities Breakdown
            </CardTitle>
            <CardDescription>What we owe to others</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.onUs.breakdown && data.onUs.breakdown.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.onUs.breakdown.map((item, index) => (
                    <TableRow key={index} data-testid={`liability-row-${index}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right text-red-600">
                        ${formatNumber(item.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">No liabilities recorded</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
