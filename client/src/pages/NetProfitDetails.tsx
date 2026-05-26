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
  Equal,
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
  amountColor,
  amountPrefix,
  formatAmount,
  accentColor,
}: {
  category: string;
  accounts: AccountItem[];
  amountColor: (val: number) => string;
  amountPrefix: (val: number) => string;
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
          {accounts.map((acc, i) => {
            const ledgerBase = window.location.pathname.startsWith("/properties")
              ? "/properties/ledger-monthly"
              : "/ledger-monthly";
            return (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2 text-sm"
                data-testid={`row-account-${i}`}
              >
                {acc.id ? (
                  <button
                    type="button"
                    onClick={() => window.open(`${ledgerBase}/${acc.id}`, "_blank")}
                    className="font-medium text-foreground hover:underline text-left flex items-center gap-1"
                  >
                    {acc.name}
                    <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                ) : (
                  <span className="font-medium text-foreground">{acc.name}</span>
                )}
                <span className={`font-mono tabular-nums ${amountColor(acc.value)}`}>
                  {amountPrefix(acc.value)}{formatAmount(Math.abs(acc.value))}
                </span>
              </div>
            );
          })}
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
  amountColor: (val: number) => string;
  amountPrefix: (val: number) => string;
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
                  amountPrefix={amountPrefix}
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

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

export default function NetProfitDetails() {
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  // Local input state — updates freely as user types (no API trigger)
  const [fromInput, setFromInput] = useState<string>("");
  const [toInput, setToInput] = useState<string>("");
  // Committed state — only set on blur with a valid complete date (triggers API call)
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const isValidDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const commitFrom = (v: string) => { if (v === "" || isValidDate(v)) setFromDate(v); };
  const commitTo   = (v: string) => { if (v === "" || isValidDate(v)) setToDate(v); };

  const clearDates = () => {
    setFromInput(""); setToInput("");
    setFromDate(""); setToDate("");
  };

  // Calculation is cumulative up to toDate (balance-sheet approach).
  // fromDate is display-only — the API only receives toDate.
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
    <div className="p-4 md:p-6 space-y-4 w-full">
      {/* Header */}
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
          {/* Date range filter */}
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
                Net Position
              </span>
              <span className={`font-bold font-mono ${(data?.netPosition || 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatAmount(data?.netPosition || 0)}
              </span>
            </div>
            <Badge variant={(data?.netPosition || 0) >= 0 ? "default" : "destructive"} className="ml-auto sm:ml-2">
              {data?.netPositionLabel || "Net Position"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Assets + Liabilities side by side, full width */}
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
          amountColor={() => "text-red-600"}
          amountPrefix={() => ""}
          formatAmount={formatAmount}
        />
      </div>

      {/* SP Partner: Realized POS Profit section */}
      {(data?.spPosProfit ?? 0) !== 0 && (
        <Card data-testid="card-sp-pos-profit">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-blue-600">
                  <TrendingUp className="h-5 w-5" />
                </span>
                <div>
                  <CardTitle className="text-lg text-blue-600">Realized Profit (POS Sales)</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Supplier partner POS profit — calculated from actual sale &amp; cost per item
                  </p>
                </div>
              </div>
              <span className={`text-2xl font-bold font-mono ${(data?.spPosProfit ?? 0) >= 0 ? "text-blue-600" : "text-destructive"}`}>
                {formatAmount(data?.spPosProfit ?? 0)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="border border-border rounded-md overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium text-foreground">Supplier Partner POS Profit</span>
                <span className="font-mono tabular-nums text-blue-600">
                  {formatAmount(data?.spPosProfit ?? 0)}
                </span>
              </div>
              <div className="px-4 py-2 bg-muted/40 text-xs text-muted-foreground">
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
