import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Plus,
  Minus,
  Equal,
  AlertCircle,
} from "lucide-react";
import { Link } from "wouter";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface AccountItem {
  name: string;
  code: string;
  value: number;
  category: string;
}

interface BreakdownItem {
  name: string;
  value: number;
}

interface NetProfitData {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  forUs: { total: number; breakdown: BreakdownItem[]; accounts: AccountItem[] };
  onUs: { total: number; breakdown: BreakdownItem[]; accounts: AccountItem[] };
  income: {
    total: number;
    breakdown: BreakdownItem[];
    accounts: AccountItem[];
  };
  expenses: {
    total: number;
    breakdown: BreakdownItem[];
    accounts: AccountItem[];
  };
  netPosition: number;
  netPositionLabel: string;
  forUsTotal: number;
  onUsTotal: number;
  incomeTotal: number;
  expensesTotal: number;
}

export default function NetProfitDetails() {
  const { formatAmount } = useCurrencyContext();
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
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button
              variant="ghost"
              size="icon"
              data-testid="button-back-settings"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Net Profit Details
            </h1>
            <p className="text-muted-foreground">
              Detailed breakdown of all accounts
            </p>
          </div>
        </div>
        <Button
          onClick={() => refetch()}
          variant="outline"
          data-testid="button-refresh"
        >
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
              {formatAmount(data?.incomeTotal || 0)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Added to profit
            </p>
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
              {formatAmount(data?.expensesTotal || 0)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Subtracted from profit
            </p>
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
            <div
              className={`text-2xl font-bold ${isProfit ? "text-green-600" : "text-red-600"}`}
            >
              {formatAmount(netProfit)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {isProfit ? "Profit" : "Loss"}
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 text-base sm:text-lg flex-wrap">
            <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950 px-3 py-2 rounded-lg">
              <span className="font-semibold text-green-700 dark:text-green-300">
                What We Have
              </span>
              <span className="text-green-600">
                {formatAmount(data?.forUsTotal || 0)}
              </span>
            </div>
            <Minus className="h-5 w-5 text-muted-foreground" />
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950 px-3 py-2 rounded-lg">
              <span className="font-semibold text-red-700 dark:text-red-300">
                What We Owe
              </span>
              <span className="text-red-600">
                {formatAmount(data?.onUsTotal || 0)}
              </span>
            </div>
            <Equal className="h-5 w-5 text-muted-foreground" />
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg ${(data?.netPosition || 0) >= 0 ? "bg-green-100 dark:bg-green-900" : "bg-red-100 dark:bg-red-900"}`}
            >
              <span
                className={`font-semibold ${(data?.netPosition || 0) >= 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}
              >
                Net Profit
              </span>
              <span
                className={
                  (data?.netPosition || 0) >= 0
                    ? "text-green-600"
                    : "text-red-600"
                }
              >
                {formatAmount(data?.netPosition || 0)}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <Badge
              variant={
                (data?.netPosition || 0) >= 0 ? "default" : "destructive"
              }
            >
              {data?.netPositionLabel || "Net Profit"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-income-accounts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" />
              Income Accounts (Added)
            </CardTitle>
            <CardDescription>
              {data?.income.accounts?.length || 0} accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.income.accounts && data.income.accounts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.income.accounts.map((acc, index) => (
                    <TableRow
                      key={index}
                      data-testid={`income-account-${index}`}
                    >
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {acc.code}
                      </TableCell>
                      <TableCell
                        className={`text-right ${acc.value >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {acc.value >= 0 ? "+" : "-"}{formatAmount(Math.abs(acc.value))}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold bg-muted/50">
                    <TableCell colSpan={2}>Total Income</TableCell>
                    <TableCell className="text-right text-green-600">
                      {formatAmount(data?.incomeTotal || 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No income recorded
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-expenses-accounts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Minus className="h-5 w-5 text-red-600" />
              Expense Accounts (Subtracted)
            </CardTitle>
            <CardDescription>
              {data?.expenses.accounts?.length || 0} accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.expenses.accounts && data.expenses.accounts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.expenses.accounts.map((acc, index) => (
                    <TableRow
                      key={index}
                      data-testid={`expense-account-${index}`}
                    >
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {acc.code}
                      </TableCell>
                      <TableCell
                        className={`text-right ${acc.value >= 0 ? "text-red-600" : "text-green-600"}`}
                      >
                        {acc.value >= 0 ? "-" : "+"}{formatAmount(Math.abs(acc.value))}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold bg-muted/50">
                    <TableCell colSpan={2}>Total Expenses</TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatAmount(data?.expensesTotal || 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No expenses recorded
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-assets-accounts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <Plus className="h-5 w-5" />
              Asset Accounts (What we have)
            </CardTitle>
            <CardDescription>
              {data?.forUs.accounts?.length || 0} accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.forUs.accounts && data.forUs.accounts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.forUs.accounts.map((acc, index) => (
                    <TableRow
                      key={index}
                      data-testid={`asset-account-${index}`}
                    >
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {acc.code}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {acc.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatAmount(acc.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold bg-muted/50">
                    <TableCell colSpan={3}>Total Assets</TableCell>
                    <TableCell className="text-right text-green-600">
                      {formatAmount(data?.forUsTotal || 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No assets recorded
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-liabilities-accounts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <Minus className="h-5 w-5" />
              Liability Accounts (What we owe)
            </CardTitle>
            <CardDescription>
              {data?.onUs.accounts?.length || 0} accounts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.onUs.accounts && data.onUs.accounts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.onUs.accounts.map((acc, index) => (
                    <TableRow
                      key={index}
                      data-testid={`liability-account-${index}`}
                    >
                      <TableCell className="font-medium">{acc.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {acc.code}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {acc.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatAmount(acc.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold bg-muted/50">
                    <TableCell colSpan={3}>Total Liabilities</TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatAmount(data?.onUsTotal || 0)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground text-center py-4">
                No liabilities recorded
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
