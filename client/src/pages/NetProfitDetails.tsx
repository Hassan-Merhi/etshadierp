import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Plus,
  Minus,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Calendar,
  X,
  Download,
  MessageSquare,
  ExternalLink,
  MoreHorizontal,
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
} from "lucide-react";
import { Link } from "wouter";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface AccountItem {
  id?: number;
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
  spPosProfit?: number;
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

function CategoryGroup({
  category,
  accounts,
  side,
  formatAmount,
}: {
  category: string;
  accounts: AccountItem[];
  side: "asset" | "liability";
  formatAmount: (n: number) => string;
}) {
  const [open, setOpen] = useState(true);
  const total = accounts.reduce((s, a) => s + Math.abs(a.value), 0);
  const color = side === "asset"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
  const headerBg = side === "asset"
    ? "bg-emerald-50/60 dark:bg-emerald-950/30"
    : "bg-rose-50/60 dark:bg-rose-950/30";

  return (
    <div className="rounded-md overflow-hidden border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-3 py-2 ${headerBg} text-sm font-semibold hover-elevate`}
        data-testid={`button-category-${category.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-foreground">{category}</span>
          <span className="text-xs font-normal text-muted-foreground bg-background/60 rounded px-1.5 py-0.5">
            {accounts.length}
          </span>
        </div>
        <span className={`font-mono font-bold tabular-nums ${color}`}>
          {formatAmount(total)}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border/50">
          {accounts.map((acc, i) => {
            const ledgerBase = window.location.pathname.startsWith("/properties")
              ? "/properties/ledger-monthly"
              : "/ledger-monthly";
            return (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/30 transition-colors"
                data-testid={`row-account-${i}`}
              >
                {acc.id ? (
                  <button
                    type="button"
                    onClick={() => window.open(`${ledgerBase}/${acc.id}`, "_blank")}
                    className="text-foreground hover:text-foreground/80 text-left flex items-center gap-1 group"
                  >
                    <span>{acc.name}</span>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                  </button>
                ) : (
                  <span className="text-foreground">{acc.name}</span>
                )}
                <span className={`font-mono tabular-nums font-medium ${color}`}>
                  {formatAmount(Math.abs(acc.value))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidePanel({
  id,
  title,
  subtitle,
  side,
  total,
  accounts,
  formatAmount,
}: {
  id: string;
  title: string;
  subtitle?: string;
  side: "asset" | "liability";
  total: number;
  accounts: AccountItem[];
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

  const isAsset = side === "asset";
  const headerGradient = isAsset
    ? "from-emerald-500/10 to-transparent dark:from-emerald-500/15"
    : "from-rose-500/10 to-transparent dark:from-rose-500/15";
  const totalColor = isAsset
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
  const iconBg = isAsset
    ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400"
    : "bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400";
  const footerBg = isAsset
    ? "bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40"
    : "bg-rose-50/50 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-800/40";

  return (
    <Card data-testid={`card-${id}`} className="flex flex-col overflow-hidden">
      <div
        className={`bg-gradient-to-r ${headerGradient} px-5 py-4 cursor-pointer select-none`}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${iconBg}`}>
              {isAsset
                ? <ArrowUpRight className="h-4 w-4" />
                : <ArrowDownRight className="h-4 w-4" />
              }
            </div>
            <div>
              <div className={`font-semibold text-base ${totalColor}`}>{title}</div>
              {subtitle && (
                <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold font-mono tabular-nums ${totalColor}`}>
              {formatAmount(total)}
            </span>
            {open
              ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            }
          </div>
        </div>
      </div>

      {open && (
        <CardContent className="pt-3 pb-4 flex-1 space-y-2">
          {sortedCategories.length > 0 ? (
            <>
              {sortedCategories.map(([cat, catAccounts]) => (
                <CategoryGroup
                  key={cat}
                  category={cat}
                  accounts={catAccounts}
                  side={side}
                  formatAmount={formatAmount}
                />
              ))}
              <div className={`flex justify-between items-center px-3 py-2.5 rounded-md border font-semibold text-sm mt-2 ${footerBg}`}>
                <span className="text-muted-foreground">
                  {isAsset ? "Total Assets" : "Total Liabilities"}
                </span>
                <span className={`font-mono tabular-nums ${totalColor}`}>
                  {formatAmount(total)}
                </span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-center py-6 text-sm">No data recorded</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function todayStr() {
  return new Date().toLocaleDateString("en-CA");
}

export default function NetProfitDetails() {
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const [fromInput, setFromInput] = useState<string>("");
  const [toInput, setToInput] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const isValidDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const commitFrom = (v: string) => { if (v === "" || isValidDate(v)) setFromDate(v); };
  const commitTo   = (v: string) => { if (v === "" || isValidDate(v)) setToDate(v); };
  const clearDates = () => {
    setFromInput(""); setToInput("");
    setFromDate(""); setToDate("");
  };

  const queryParam = toDate ? `?toDate=${toDate}` : "";

  const { data, isLoading, error, refetch } = useQuery<NetProfitData>({
    queryKey: ["/api/stats/net-profit", toDate],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/stats/net-profit${queryParam}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const isFiltered = !!(fromDate || toDate);

  const sendWhatsApp = useMutation({
    mutationFn: () => {
      const today = new Date().toLocaleDateString("en-CA");
      const start = fromDate || fromInput || (() => {
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d.toLocaleDateString("en-CA");
      })();
      const end = toDate || toInput || today;
      return apiRequest("POST", "/api/whatsapp/send-net-position", { startDate: start, endDate: end });
    },
    onSuccess: async (res: any) => {
      const body = await res.json();
      toast({ title: "Sent via WhatsApp", description: body.message });
    },
    onError: async (err: any) => {
      const msg = err?.message || "WhatsApp send failed";
      toast({ title: "WhatsApp Error", description: msg, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
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

  const forUsTotal = data?.forUsTotal || 0;
  const onUsTotal  = data?.onUsTotal  || 0;
  const netPos     = data?.netPosition || 0;
  const isPositive = netPos >= 0;

  // Ratio bar: what fraction of total is assets
  const grandTotal = forUsTotal + onUsTotal;
  const assetPct   = grandTotal > 0 ? (forUsTotal / grandTotal) * 100 : 50;

  return (
    <div className="p-4 md:p-6 space-y-5 w-full">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Link href="/settings">
            <Button variant="ghost" size="icon" data-testid="button-back-settings">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <PageHeader title="Net Position Details" />
            <p className="text-muted-foreground text-sm">
              {fromDate && toDate
                ? `${fromDate} — ${toDate} (balances as of ${toDate})`
                : toDate
                ? `Balances as of ${toDate}`
                : fromDate
                ? `From ${fromDate} — present`
                : "Current balances — all time"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-1.5">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">From:</Label>
              <Input
                type="date"
                value={fromInput}
                max={toInput || todayStr()}
                onChange={(e) => setFromInput(e.target.value)}
                onBlur={(e) => commitFrom(e.target.value)}
                className="w-36 text-sm"
                data-testid="input-from-date"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">To:</Label>
              <Input
                type="date"
                value={toInput}
                min={fromInput || undefined}
                max={todayStr()}
                onChange={(e) => setToInput(e.target.value)}
                onBlur={(e) => commitTo(e.target.value)}
                className="w-36 text-sm"
                data-testid="input-to-date"
              />
            </div>
            {isFiltered && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearDates}
                data-testid="button-clear-date"
                title="Clear date filter"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="default" data-testid="button-actions-menu">
                <MoreHorizontal className="h-4 w-4 mr-2" />
                Actions
                <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                data-testid="button-export-excel"
                onClick={() => {
                  const url = toDate
                    ? `/api/stats/net-position-excel?toDate=${toDate}`
                    : "/api/stats/net-position-excel";
                  window.open(url, "_blank");
                }}
              >
                <Download className="h-4 w-4 mr-2 shrink-0" />
                Export (full)
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="button-export-monthly-excel"
                onClick={() => {
                  const today = new Date().toLocaleDateString("en-CA");
                  const start = fromDate || fromInput || (() => {
                    const d = new Date();
                    d.setFullYear(d.getFullYear() - 1);
                    return d.toLocaleDateString("en-CA");
                  })();
                  const end = toDate || toInput || today;
                  window.open(
                    `/api/reports/net-position-monthly-excel?startDate=${start}&endDate=${end}`,
                    "_blank"
                  );
                }}
              >
                <Download className="h-4 w-4 mr-2 shrink-0" />
                Monthly Excel
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="button-send-whatsapp"
                disabled={sendWhatsApp.isPending}
                onClick={() => sendWhatsApp.mutate()}
              >
                <MessageSquare className="h-4 w-4 mr-2 shrink-0 text-green-600" />
                {sendWhatsApp.isPending ? "Sending…" : "Send to WhatsApp"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="button-refresh"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4 mr-2 shrink-0" />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Summary hero ── */}
      <Card data-testid="card-formula" className="overflow-hidden">
        <CardContent className="p-0">
          {/* Three stat blocks */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {/* What We Have */}
            <div className="p-5 flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 shrink-0">
                <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                  What We Have
                </p>
                <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                  {formatAmount(forUsTotal)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data?.forUs.accounts?.length || 0} asset accounts
                </p>
              </div>
            </div>

            {/* What We Owe */}
            <div className="p-5 flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-900/50 shrink-0">
                <Scale className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                  What We Owe
                </p>
                <p className="text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 truncate">
                  {formatAmount(onUsTotal)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {data?.onUs.accounts?.length || 0} liability accounts
                </p>
              </div>
            </div>

            {/* Net Position */}
            <div className={`p-5 flex items-center gap-4 ${isPositive ? "bg-emerald-50/40 dark:bg-emerald-950/20" : "bg-rose-50/40 dark:bg-rose-950/20"}`}>
              <div className={`p-2.5 rounded-xl shrink-0 ${isPositive ? "bg-emerald-100 dark:bg-emerald-900/50" : "bg-rose-100 dark:bg-rose-900/50"}`}>
                {isPositive
                  ? <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  : <Minus className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                }
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
                  Net Position
                </p>
                <p className={`text-2xl font-bold font-mono tabular-nums truncate ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {formatAmount(netPos)}
                </p>
                <Badge
                  variant={isPositive ? "default" : "destructive"}
                  className="mt-1 text-xs"
                >
                  {data?.netPositionLabel || "Net Position"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Ratio bar */}
          <div className="px-5 pb-4 pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>Assets {assetPct.toFixed(0)}%</span>
              <span>Liabilities {(100 - assetPct).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-rose-200 dark:bg-rose-900/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 dark:bg-emerald-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, assetPct))}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Assets + Liabilities side by side ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <SidePanel
          id="assets"
          title="What We Have"
          subtitle={`${data?.forUs.accounts?.length || 0} asset accounts`}
          side="asset"
          total={forUsTotal}
          accounts={data?.forUs.accounts || []}
          formatAmount={formatAmount}
        />
        <SidePanel
          id="liabilities"
          title="What We Owe"
          subtitle={`${data?.onUs.accounts?.length || 0} liability accounts`}
          side="liability"
          total={onUsTotal}
          accounts={data?.onUs.accounts || []}
          formatAmount={formatAmount}
        />
      </div>

      {/* SP Partner: Realized POS Profit */}
      {(data?.spPosProfit ?? 0) !== 0 && (
        <Card data-testid="card-sp-pos-profit" className="overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500/10 to-transparent dark:from-blue-500/15 px-5 py-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-base text-blue-600 dark:text-blue-400">
                    Realized Profit (POS Sales)
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Supplier partner POS profit — calculated from actual sale &amp; cost per item
                  </div>
                </div>
              </div>
              <span className={`text-2xl font-bold font-mono tabular-nums ${(data?.spPosProfit ?? 0) >= 0 ? "text-blue-600 dark:text-blue-400" : "text-destructive"}`}>
                {formatAmount(data?.spPosProfit ?? 0)}
              </span>
            </div>
          </div>
          <CardContent className="pt-3 pb-4">
            <div className="rounded-md overflow-hidden border border-border/60">
              <div className="flex items-center justify-between px-3 py-2.5 text-sm">
                <span className="text-foreground">Supplier Partner POS Profit</span>
                <span className="font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                  {formatAmount(data?.spPosProfit ?? 0)}
                </span>
              </div>
              <div className="px-3 py-2 bg-muted/40 text-xs text-muted-foreground border-t border-border/50">
                Formula: Sum of (sale price − cost price) across all POS sale lines
                {toDate ? ` up to ${toDate}` : " (all time)"}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
