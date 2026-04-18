import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Equal,
  RefreshCw,
  AlertCircle,
  Clock,
  CheckCircle2,
  PackageOpen,
} from "lucide-react";

interface BrokerBreakdownLine {
  label: string;
  native: string;
  usd: number;
}

interface AccountItem {
  name: string;
  code: string;
  value: number;
  category: string;
  breakdown?: BrokerBreakdownLine[];
}

interface BreakdownItem {
  name: string;
  value: number;
}

interface OrderItem {
  id: number;
  customerName: string;
  orderDate: string;
  grandTotal: number;
  totalQtyBales: number;
}

interface NetPositionData {
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
  pendingOrders: OrderItem[];
  verifiedOrders: OrderItem[];
  loadingOrders: OrderItem[];
  pendingTotal: number;
  verifiedTotal: number;
  loadingTotal: number;
}

function fmt(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SupplierRow({ acc, accentClass, index }: { acc: AccountItem; accentClass: string; index: number }) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = acc.breakdown && acc.breakdown.length > 0;

  return (
    <div className="divide-y divide-border" data-testid={`row-account-${index}`}>
      <div className="flex items-center justify-between px-4 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {hasBreakdown && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                data-testid={`button-breakdown-${index}`}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <p className="font-medium truncate">{acc.name}</p>
          </div>
          {acc.code && acc.code !== "SUPPLIER" && acc.code !== "CUSTOMER_DR" && acc.code !== "CUSTOMER_CR" && (
            <p className="text-xs text-muted-foreground font-mono">{acc.code}</p>
          )}
        </div>
        <span className={`font-mono text-sm ml-4 shrink-0 ${accentClass}`}>
          {fmt(acc.value)}
        </span>
      </div>
      {hasBreakdown && open && (
        <div className="bg-muted/20 px-4 py-2 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Calculation Breakdown</p>
          {acc.breakdown!.map((line, j) => {
            const isNegative = line.usd < 0;
            const isFx = line.label.includes("FX") || line.label.includes("Net Balance");
            return (
              <div key={j} className="flex items-center justify-between text-xs gap-4">
                <div className="min-w-0">
                  <span className="text-foreground/80">{line.label}</span>
                  {line.native && (
                    <span className="ml-2 font-mono text-muted-foreground">({line.native})</span>
                  )}
                </div>
                <span className={`font-mono shrink-0 ${isNegative ? "text-destructive" : isFx ? "text-muted-foreground" : accentClass}`}>
                  {line.usd !== 0 ? fmt(line.usd) : "—"}
                </span>
              </div>
            );
          })}
          <div className="border-t border-border mt-1 pt-1 flex justify-between text-xs font-semibold">
            <span>Total</span>
            <span className={`font-mono ${accentClass}`}>{fmt(acc.value)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  title,
  accounts,
  accentClass,
}: {
  title: string;
  accounts: AccountItem[];
  accentClass: string;
}) {
  const [open, setOpen] = useState(false);
  const total = accounts.reduce((s, a) => s + a.value, 0);
  if (accounts.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 hover-elevate bg-muted/30"
        onClick={() => setOpen((o) => !o)}
        data-testid={`toggle-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{title}</span>
          <Badge variant="outline" className="text-xs">
            {accounts.length}
          </Badge>
        </div>
        <span className={`font-mono text-sm font-semibold ${accentClass}`}>
          {fmt(total)}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {accounts.map((acc, i) => (
            <SupplierRow key={i} acc={acc} accentClass={accentClass} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function Side({
  label,
  sublabel,
  total,
  breakdown,
  accounts,
  colorClass,
  icon,
}: {
  label: string;
  sublabel: string;
  total: number;
  breakdown: BreakdownItem[];
  accounts: AccountItem[];
  colorClass: string;
  icon: React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);

  const grouped: Record<string, AccountItem[]> = {};
  for (const a of accounts) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }

  return (
    <Card data-testid={`card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-base">{label}</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-3xl font-bold font-mono ${colorClass}`} data-testid={`text-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          {fmt(total)}
        </p>

        {breakdown.length > 0 && (
          <div className="space-y-1.5">
            {breakdown.map((b, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{b.name}</span>
                <span className={`font-mono font-medium ${colorClass}`}>{fmt(b.value)}</span>
              </div>
            ))}
          </div>
        )}

        {accounts.length > 0 && (
          <>
            <Separator />
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
                onClick={() => setShowAll((v) => !v)}
                data-testid={`button-toggle-details-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {showAll ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {showAll ? "Hide" : "Show"} details ({accounts.length} item{accounts.length !== 1 ? "s" : ""})
              </button>
              {showAll && (
                <div className="space-y-2">
                  {Object.entries(grouped).map(([cat, accs]) => (
                    <CategoryGroup
                      key={cat}
                      title={cat}
                      accounts={accs}
                      accentClass={colorClass}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OrderGroup({
  label,
  orders,
  total,
  icon,
  accentClass,
  badgeClass,
}: {
  label: string;
  orders: OrderItem[];
  total: number;
  icon: React.ReactNode;
  accentClass: string;
  badgeClass: string;
}) {
  const [open, setOpen] = useState(true);
  if (orders.length === 0) return null;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 hover-elevate bg-muted/30"
        onClick={() => setOpen((o) => !o)}
        data-testid={`toggle-order-group-${label.toLowerCase()}`}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {icon}
          <span className="text-sm font-semibold">{label}</span>
          <Badge className={`text-xs ${badgeClass}`}>{orders.length}</Badge>
        </div>
        <span className={`font-mono text-sm font-bold ${accentClass}`}>{fmt(total)}</span>
      </button>
      {open && (
        <div className="divide-y divide-border">
          {orders.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between px-4 py-2.5 text-sm"
              data-testid={`row-order-${o.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-muted-foreground">#{o.id}</span>
                  <span className="font-medium truncate">{o.customerName}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-muted-foreground">{fmtDate(o.orderDate)}</span>
                  <span className="text-xs text-muted-foreground">{o.totalQtyBales} bale{o.totalQtyBales !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <span className={`font-mono text-sm font-semibold ml-4 shrink-0 ${accentClass}`}>
                {fmt(o.grandTotal)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FactoryNetPosition() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<NetPositionData>({
    queryKey: ["/api/factory/net-position"],
    queryFn: async () => {
      const res = await fetch("/api/factory/net-position", { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const isPositive = (data?.netPosition ?? 0) >= 0;
  const hasPendingVerified =
    (data?.pendingOrders?.length ?? 0) +
    (data?.verifiedOrders?.length ?? 0) +
    (data?.loadingOrders?.length ?? 0) > 0;

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Failed to load net position data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            Net Position
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            What we have vs what we owe — current standing
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Net Position Banner */}
      {isLoading ? (
        <Skeleton className="h-28 w-full rounded-md" />
      ) : (
        <Card className={`border-2 ${isPositive ? "border-green-500/30" : "border-red-500/30"}`} data-testid="card-net-position">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Net Position</p>
                <p
                  className={`text-4xl font-bold font-mono ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid="text-net-position"
                >
                  {data?.netPosition !== undefined && data.netPosition < 0 ? "-" : ""}
                  {fmt(Math.abs(data?.netPosition ?? 0))}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{data?.netPositionLabel}</p>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">What We Have</p>
                  <p className="text-lg font-semibold font-mono text-green-600 dark:text-green-400">
                    {fmt(data?.forUsTotal ?? 0)}
                  </p>
                </div>
                <div className="text-muted-foreground text-xl font-light">−</div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">What We Owe</p>
                  <p className="text-lg font-semibold font-mono text-red-600 dark:text-red-400">
                    {fmt(data?.onUsTotal ?? 0)}
                  </p>
                </div>
                <div className="text-muted-foreground text-xl font-light">=</div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Net</p>
                  <p className={`text-lg font-semibold font-mono ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {data?.netPosition !== undefined && data.netPosition < 0 ? "-" : ""}
                    {fmt(Math.abs(data?.netPosition ?? 0))}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* What We Have | What We Owe grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Side
            label="What We Have"
            sublabel="Assets owed to us — cash, inventory, receivables, customer balances (Dr)"
            total={data?.forUs.total ?? 0}
            breakdown={data?.forUs.breakdown ?? []}
            accounts={data?.forUs.accounts ?? []}
            colorClass="text-green-600 dark:text-green-400"
            icon={<TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />}
          />
          <Side
            label="What We Owe"
            sublabel="Liabilities — supplier balances and other payables"
            total={data?.onUs.total ?? 0}
            breakdown={data?.onUs.breakdown ?? []}
            accounts={data?.onUs.accounts ?? []}
            colorClass="text-red-600 dark:text-red-400"
            icon={<TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />}
          />
        </div>
      )}

      {/* Broker Balance Breakdown */}
      {!isLoading && (data?.onUs.accounts ?? []).some(a => a.code === "SUPPLIER" && a.breakdown?.length) && (
        <Card data-testid="card-broker-breakdown">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Broker Balance Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground">Step-by-step calculation for each broker supplier</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.onUs.accounts ?? [])
              .filter(a => a.code === "SUPPLIER" && a.breakdown?.length)
              .map((broker, bi) => (
                <div key={bi} className="border border-border rounded-md overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                    <span className="font-semibold text-sm">{broker.name}</span>
                    <span className="font-mono text-sm font-bold text-red-600 dark:text-red-400">{fmt(broker.value)}</span>
                  </div>
                  <div className="px-4 py-3 space-y-1.5">
                    {broker.breakdown!.map((line, j) => {
                      const isNeg = line.usd < 0;
                      const isFxOnly = line.usd === 0;
                      const isTotal = line.label.includes("Net Balance") || line.label.includes("× ");
                      return (
                        <div key={j} className={`flex items-center justify-between text-xs gap-4 ${isTotal ? "border-t border-border pt-1.5 mt-1" : ""}`}>
                          <div className="min-w-0">
                            <span className={isTotal ? "font-medium" : "text-foreground/80"}>{line.label}</span>
                            <span className="ml-2 font-mono text-muted-foreground">({line.native})</span>
                          </div>
                          <span className={`font-mono shrink-0 font-medium ${isNeg ? "text-destructive" : isFxOnly ? "text-muted-foreground" : "text-foreground"}`}>
                            {line.usd !== 0 ? fmt(line.usd) : "—"}
                          </span>
                        </div>
                      );
                    })}
                    <div className="border-t-2 border-border pt-2 mt-1 flex justify-between text-sm font-bold">
                      <span>Total Owed</span>
                      <span className="font-mono text-red-600 dark:text-red-400">{fmt(broker.value)}</span>
                    </div>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Upcoming Receivables — Pending, Verified & Loading Orders */}
      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-md" />
      ) : (
        <Card data-testid="card-upcoming-receivables">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Upcoming Receivables</CardTitle>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {(data?.pendingTotal ?? 0) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Pending: <span className="font-mono font-semibold text-amber-500 dark:text-amber-400">{fmt(data?.pendingTotal ?? 0)}</span>
                  </span>
                )}
                {(data?.verifiedTotal ?? 0) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Verified: <span className="font-mono font-semibold text-blue-500 dark:text-blue-400">{fmt(data?.verifiedTotal ?? 0)}</span>
                  </span>
                )}
                {(data?.loadingTotal ?? 0) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Loading: <span className="font-mono font-semibold text-purple-500 dark:text-purple-400">{fmt(data?.loadingTotal ?? 0)}</span>
                  </span>
                )}
                <span className="text-xs text-muted-foreground border-l border-border pl-3">
                  Total: <span className="font-mono font-semibold text-foreground">
                    {fmt((data?.pendingTotal ?? 0) + (data?.verifiedTotal ?? 0) + (data?.loadingTotal ?? 0))}
                  </span>
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Pending and Verified orders are included in "What We Have." Loading orders update live as bales are scanned.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasPendingVerified ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No pending, verified, or loading orders at this time.
              </p>
            ) : (
              <>
                <OrderGroup
                  label="Pending"
                  orders={data?.pendingOrders ?? []}
                  total={data?.pendingTotal ?? 0}
                  icon={<Clock className="h-4 w-4 text-amber-500" />}
                  accentClass="text-amber-500 dark:text-amber-400"
                  badgeClass="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                />
                <OrderGroup
                  label="Verified"
                  orders={data?.verifiedOrders ?? []}
                  total={data?.verifiedTotal ?? 0}
                  icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
                  accentClass="text-blue-500 dark:text-blue-400"
                  badgeClass="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                />
                <OrderGroup
                  label="Loading (In Progress)"
                  orders={data?.loadingOrders ?? []}
                  total={data?.loadingTotal ?? 0}
                  icon={<PackageOpen className="h-4 w-4 text-purple-500" />}
                  accentClass="text-purple-500 dark:text-purple-400"
                  badgeClass="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sub-totals info */}
      {!isLoading && data && (data.supplierLiabilities > 0 || data.ledgerAssets > 0 || data.inventoryValue > 0 || data.rawMaterialValue > 0) && (
        <Card data-testid="card-composition">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Equal className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Composition</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 text-sm">
              {data.inventoryValue > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Stock In Hand</p>
                  <p className="font-mono font-semibold text-green-600 dark:text-green-400" data-testid="text-inventory-value">{fmt(data.inventoryValue)}</p>
                  <p className="text-xs text-muted-foreground">Location inventory sell value</p>
                </div>
              )}
              {data.rawMaterialValue > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Raw Material Stock</p>
                  <p className="font-mono font-semibold text-green-600 dark:text-green-400" data-testid="text-raw-material-value">{fmt(data.rawMaterialValue)}</p>
                  <p className="text-xs text-muted-foreground">Raw materials stock value</p>
                </div>
              )}
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Ledger Assets</p>
                <p className="font-mono font-semibold text-green-600 dark:text-green-400">{fmt(data.ledgerAssets)}</p>
                <p className="text-xs text-muted-foreground">From accounting records</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Supplier Balances</p>
                <p className="font-mono font-semibold text-red-600 dark:text-red-400">{fmt(data.supplierLiabilities)}</p>
                <p className="text-xs text-muted-foreground">Raw material suppliers owed</p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Other Liabilities</p>
                <p className="font-mono font-semibold text-red-600 dark:text-red-400">{fmt(data.ledgerLiabilities)}</p>
                <p className="text-xs text-muted-foreground">From accounting records</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
