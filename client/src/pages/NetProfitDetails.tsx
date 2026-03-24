import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  Plus,
  Minus,
  Equal,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
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
  income: { total: number; breakdown: BreakdownItem[]; accounts: AccountItem[] };
  expenses: { total: number; breakdown: BreakdownItem[]; accounts: AccountItem[] };
  netPosition: number;
  netPositionLabel: string;
  forUsTotal: number;
  onUsTotal: number;
  incomeTotal: number;
  expensesTotal: number;
}

function CollapsibleSection({
  id,
  title,
  subtitle,
  accentColor,
  icon,
  total,
  totalLabel,
  totalColor,
  accounts,
  showCategory,
  amountColor,
  amountPrefix,
  formatAmount,
}: {
  id: string;
  title: string;
  subtitle?: string;
  accentColor: string;
  icon: React.ReactNode;
  total: number;
  totalLabel: string;
  totalColor: string;
  accounts: AccountItem[];
  showCategory: boolean;
  amountColor: (val: number) => string;
  amountPrefix: (val: number) => string;
  formatAmount: (n: number) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card data-testid={`card-${id}`}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={accentColor}>{icon}</span>
            <div>
              <CardTitle className={`flex items-center gap-2 ${accentColor}`}>
                {title}
              </CardTitle>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xl font-bold font-mono ${totalColor}`}>
              {formatAmount(total)}
            </span>
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0">
          {accounts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  {showCategory && <TableHead>Category</TableHead>}
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acc, index) => (
                  <TableRow key={index} data-testid={`${id}-account-${index}`}>
                    <TableCell className="font-medium">{acc.name}</TableCell>
                    {showCategory && (
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {acc.category}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className={`text-right font-mono ${amountColor(acc.value)}`}>
                      {amountPrefix(acc.value)}{formatAmount(Math.abs(acc.value))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold bg-muted/50">
                  <TableCell colSpan={showCategory ? 2 : 1}>{totalLabel}</TableCell>
                  <TableCell className={`text-right font-mono ${totalColor}`}>
                    {formatAmount(total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-4">No data recorded</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function NetProfitDetails() {
  const { formatAmount } = useCurrencyContext();
  const { data, isLoading, error, refetch } = useQuery<NetProfitData>({
    queryKey: ["/api/stats/net-profit"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
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

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Net Profit Details
            </h1>
            <p className="text-muted-foreground text-sm">Breakdown of all accounts</p>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="default" data-testid="button-refresh">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Formula bar */}
      <Card data-testid="card-formula">
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/40 px-4 py-2.5 rounded-md">
              <span className="text-sm font-medium text-green-700 dark:text-green-300">What We Have</span>
              <span className="font-bold font-mono text-green-600">{formatAmount(data?.forUsTotal || 0)}</span>
            </div>
            <Minus className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 rounded-md">
              <span className="text-sm font-medium text-red-700 dark:text-red-300">What We Owe</span>
              <span className="font-bold font-mono text-red-600">{formatAmount(data?.onUsTotal || 0)}</span>
            </div>
            <Equal className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-md ${(data?.netPosition || 0) >= 0 ? "bg-green-100 dark:bg-green-900/40" : "bg-red-100 dark:bg-red-900/40"}`}>
              <span className={`text-sm font-medium ${(data?.netPosition || 0) >= 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                Net Profit
              </span>
              <span className={`font-bold font-mono ${(data?.netPosition || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatAmount(data?.netPosition || 0)}
              </span>
            </div>
            <Badge variant={(data?.netPosition || 0) >= 0 ? "default" : "destructive"} className="ml-auto sm:ml-2">
              {data?.netPositionLabel || "Net Profit"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Assets + Liabilities (collapsible) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CollapsibleSection
          id="assets"
          title="What We Have"
          subtitle={`${data?.forUs.accounts?.length || 0} asset accounts`}
          accentColor="text-green-600"
          icon={<Plus className="h-5 w-5" />}
          total={data?.forUsTotal || 0}
          totalLabel="Total Assets"
          totalColor="text-green-600"
          accounts={data?.forUs.accounts || []}
          showCategory={true}
          amountColor={() => "text-green-600"}
          amountPrefix={() => ""}
          formatAmount={formatAmount}
        />
        <CollapsibleSection
          id="liabilities"
          title="What We Owe"
          subtitle={`${data?.onUs.accounts?.length || 0} liability accounts`}
          accentColor="text-red-600"
          icon={<Minus className="h-5 w-5" />}
          total={data?.onUsTotal || 0}
          totalLabel="Total Liabilities"
          totalColor="text-red-600"
          accounts={data?.onUs.accounts || []}
          showCategory={true}
          amountColor={() => "text-red-600"}
          amountPrefix={() => ""}
          formatAmount={formatAmount}
        />
      </div>

      {/* Income + Expenses (collapsible) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CollapsibleSection
          id="income"
          title="Income"
          subtitle={`${data?.income.accounts?.length || 0} accounts`}
          accentColor="text-green-600"
          icon={<Plus className="h-5 w-5" />}
          total={data?.incomeTotal || 0}
          totalLabel="Total Income"
          totalColor="text-green-600"
          accounts={data?.income.accounts || []}
          showCategory={false}
          amountColor={(v) => (v >= 0 ? "text-green-600" : "text-red-600")}
          amountPrefix={(v) => (v >= 0 ? "+" : "-")}
          formatAmount={formatAmount}
        />
        <CollapsibleSection
          id="expenses"
          title="Expenses"
          subtitle={`${data?.expenses.accounts?.length || 0} accounts`}
          accentColor="text-red-600"
          icon={<Minus className="h-5 w-5" />}
          total={data?.expensesTotal || 0}
          totalLabel="Total Expenses"
          totalColor="text-red-600"
          accounts={data?.expenses.accounts || []}
          showCategory={false}
          amountColor={(v) => (v >= 0 ? "text-red-600" : "text-green-600")}
          amountPrefix={(v) => (v >= 0 ? "-" : "+")}
          formatAmount={formatAmount}
        />
      </div>
    </div>
  );
}
