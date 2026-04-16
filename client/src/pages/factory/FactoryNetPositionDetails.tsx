import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  Plus,
  Minus,
  Equal,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
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

interface FactoryNetPositionData {
  forUsTotal: number;
  onUsTotal: number;
  netPosition: number;
  netPositionLabel: string;
  forUs: { total: number; breakdown: BreakdownItem[]; accounts: AccountItem[] };
  onUs: { total: number; breakdown: BreakdownItem[]; accounts: AccountItem[] };
  supplierLiabilities: number;
  inventoryValue: number;
  rawMaterialValue: number;
  ledgerAssets: number;
  ledgerLiabilities: number;
}

function CategoryGroup({
  category,
  accounts,
  amountColor,
  formatAmount,
  accentColor,
}: {
  category: string;
  accounts: AccountItem[];
  amountColor: string;
  formatAmount: (n: number) => string;
  accentColor: string;
}) {
  const [open, setOpen] = useState(true);
  const total = accounts.reduce((s, a) => s + Math.abs(a.value), 0);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover-elevate text-sm font-semibold"
        data-testid={`button-category-${category.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span>{category}</span>
          <Badge variant="outline" className="text-xs font-normal">
            {accounts.length}
          </Badge>
        </div>
        <span className={`font-mono font-bold ${accentColor}`}>
          {formatAmount(total)}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {accounts.map((acc, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-2 text-sm"
              data-testid={`row-account-${i}`}
            >
              <span className="font-medium text-foreground">{acc.name}</span>
              <span className={`font-mono tabular-nums ${amountColor}`}>
                {formatAmount(Math.abs(acc.value))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  amountColor,
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
  amountColor: string;
  formatAmount: (n: number) => string;
}) {
  const [open, setOpen] = useState(true);

  const grouped = accounts.reduce<Record<string, AccountItem[]>>((acc, item) => {
    const cat = item.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const sortedCategories = Object.entries(grouped).sort(
    ([, a], [, b]) =>
      b.reduce((s, x) => s + Math.abs(x.value), 0) -
      a.reduce((s, x) => s + Math.abs(x.value), 0)
  );

  return (
    <Card data-testid={`card-${id}`} className="flex flex-col">
      <CardHeader
        className="cursor-pointer select-none pb-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={accentColor}>{icon}</span>
            <div>
              <CardTitle className={`flex items-center gap-2 text-lg ${accentColor}`}>
                {title}
              </CardTitle>
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-2xl font-bold font-mono ${totalColor}`}>
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
        <CardContent className="pt-0 flex-1 space-y-2">
          {sortedCategories.length > 0 ? (
            <>
              {sortedCategories.map(([cat, catAccounts]) => (
                <CategoryGroup
                  key={cat}
                  category={cat}
                  accounts={catAccounts}
                  amountColor={amountColor}
                  formatAmount={formatAmount}
                  accentColor={totalColor}
                />
              ))}
              <div className="flex justify-between items-center px-4 py-2.5 rounded-md bg-muted/60 font-bold text-sm mt-1">
                <span>{totalLabel}</span>
                <span className={`font-mono ${totalColor}`}>{formatAmount(total)}</span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-center py-4">No data recorded</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function FactoryNetPositionDetails() {
  const { formatAmount } = useCurrencyContext();

  const { data, isLoading, error, refetch, isFetching } = useQuery<FactoryNetPositionData>({
    queryKey: ["/api/factory/net-position"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/factory/net-position");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => (
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

  const net = data?.netPosition ?? 0;
  const isPositive = net >= 0;

  return (
    <div className="p-4 md:p-6 space-y-4 w-full">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Factory Net Position
          </h1>
          <p className="text-muted-foreground text-sm">
            Current factory financial standing — what we have vs what we owe
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          variant="outline"
          size="default"
          disabled={isFetching}
          data-testid="button-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

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
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-md ${isPositive ? "bg-green-100 dark:bg-green-900/40" : "bg-red-100 dark:bg-red-900/40"}`}>
              <span className={`text-sm font-medium ${isPositive ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                Net Position
              </span>
              <span className={`font-bold font-mono ${isPositive ? "text-green-600" : "text-red-600"}`}>
                {formatAmount(net)}
              </span>
            </div>
            <Badge variant={isPositive ? "default" : "destructive"} className="ml-auto sm:ml-2">
              {data?.netPositionLabel || "Net Position"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
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
          amountColor="text-green-600"
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
          amountColor="text-red-600"
          formatAmount={formatAmount}
        />
      </div>
    </div>
  );
}
