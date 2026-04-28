import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Package,
  Layers,
  Scale,
  TrendingUp,
  TrendingDown,
  Wallet,
  Truck,
  UserRound,
  RefreshCw,
  HardHat,
  BarChart3,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Plus,
  X,
  Search,
} from "lucide-react";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { useToast } from "@/hooks/use-toast";

interface SnapshotData {
  baleWeightTotal: number;
  baleCount: number;
  baleValueTotal: number;
}

interface NetPositionAccount {
  name: string;
  code: string;
  value: number;
  category: string;
  id?: number;
  breakdown?: { label: string; native: string; usd: number }[];
}

interface NetPositionData {
  rawMaterialValue: number;
  supplierLiabilities: number;
  forUs: { total: number; accounts: NetPositionAccount[] };
  onUs: { total: number; accounts: NetPositionAccount[] };
}

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const kg = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + " kg";

function KpiCard({
  icon: Icon,
  title,
  value,
  sub,
  color = "default",
  loading = false,
}: {
  icon: any;
  title: string;
  value: string;
  sub?: string;
  color?: "default" | "green" | "amber" | "red" | "blue" | "purple";
  loading?: boolean;
}) {
  const iconColors: Record<string, string> = {
    default: "text-muted-foreground",
    green: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
    blue: "text-blue-500",
    purple: "text-purple-500",
  };
  const valueColors: Record<string, string> = {
    default: "text-foreground",
    green: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-purple-600 dark:text-purple-400",
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-md shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`kpi-card-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${iconColors[color]}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground font-medium truncate">{title}</p>
            <p className={`text-lg font-semibold font-mono mt-0.5 ${valueColors[color]}`} data-testid={`value-${title.toLowerCase().replace(/\s+/g, "-")}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title, color }: { title: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-3.5 w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
  );
}

type PinnedRow = { id: number; accountId: string; accountType: string; accountName: string };
type CardKey = "agent" | "freight" | "advance" | "cashbank";

export default function FactoryFinancialSnapshot() {
  useEscapeBack();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [cashBankExpanded, setCashBankExpanded] = useState(false);
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [freightExpanded, setFreightExpanded] = useState(false);
  const [supplierExpanded, setSupplierExpanded] = useState(false);
  const [customerExpanded, setCustomerExpanded] = useState(false);
  const [advanceExpanded, setAdvanceExpanded] = useState(false);

  const [pickerFor, setPickerFor] = useState<CardKey | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const { data: snapshot, isLoading: loadingSnapshot, refetch: refetchSnapshot, dataUpdatedAt: snapUpdated } =
    useQuery<SnapshotData>({ queryKey: ["/api/factory/financial-snapshot"] });

  const { data: netPosition, isLoading: loadingNP, refetch: refetchNP } =
    useQuery<NetPositionData>({ queryKey: ["/api/factory/net-position"] });

  const { data: agentAccounts, isLoading: loadingAgents, refetch: refetchAgents } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/agent-accounts"] });

  const { data: freightAccountRows, isLoading: loadingFreight } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/freight-accounts"] });

  const { data: cashbankPinned, isLoading: loadingCashbank } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/snapshot-pinned-accounts/cashbank"] });

  const { data: advancePinned, isLoading: loadingAdvancePinned } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/snapshot-pinned-accounts/advance"] });

  const addAccountMutation = useMutation({
    mutationFn: ({ type, body }: { type: CardKey; body: { accountId: string; accountType: string; accountName: string } }) => {
      if (type === "agent") return apiRequest("POST", "/api/agent-accounts", body);
      if (type === "freight") return apiRequest("POST", "/api/freight-accounts", body);
      return apiRequest("POST", `/api/snapshot-pinned-accounts/${type}`, body);
    },
    onSuccess: (_data, { type }) => {
      if (type === "agent") queryClient.invalidateQueries({ queryKey: ["/api/agent-accounts"] });
      else if (type === "freight") queryClient.invalidateQueries({ queryKey: ["/api/freight-accounts"] });
      else queryClient.invalidateQueries({ queryKey: [`/api/snapshot-pinned-accounts/${type}`] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeAccountMutation = useMutation({
    mutationFn: ({ type, accountId }: { type: CardKey; accountId: string }) => {
      if (type === "agent") return apiRequest("DELETE", `/api/agent-accounts/${encodeURIComponent(accountId)}`);
      if (type === "freight") return apiRequest("DELETE", `/api/freight-accounts/${encodeURIComponent(accountId)}`);
      return apiRequest("DELETE", `/api/snapshot-pinned-accounts/${type}/${encodeURIComponent(accountId)}`);
    },
    onSuccess: (_data, { type }) => {
      if (type === "agent") queryClient.invalidateQueries({ queryKey: ["/api/agent-accounts"] });
      else if (type === "freight") queryClient.invalidateQueries({ queryKey: ["/api/freight-accounts"] });
      else queryClient.invalidateQueries({ queryKey: [`/api/snapshot-pinned-accounts/${type}`] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isLoading = loadingSnapshot || loadingNP || loadingAgents || loadingFreight || loadingCashbank || loadingAdvancePinned;

  const handleRefresh = () => {
    refetchSnapshot();
    refetchNP();
    refetchAgents();
  };

  const lastUpdated = snapUpdated ? new Date(snapUpdated).toLocaleTimeString() : null;

  const computed = useMemo(() => {
    if (!netPosition || !agentAccounts) return null;

    const allAccounts = [
      ...((netPosition.forUs?.accounts || []).map(a => ({ ...a, side: "forUs" as const }))),
      ...((netPosition.onUs?.accounts || []).map(a => ({ ...a, side: "onUs" as const }))),
    ];

    const signedValue = (a: { value: number; side: "forUs" | "onUs" }) =>
      a.side === "forUs" ? a.value : -a.value;

    // ── Mix Batches on Tables (Balance on Table from net position) ──
    const balanceOnTable = netPosition.forUs?.accounts?.find(a => a.code === "BALANCE_ON_TABLE");
    const mixBatchValue = balanceOnTable?.value ?? 0;

    // ── Raw Material Value from net position ──
    const rawMaterialValue = netPosition.rawMaterialValue ?? 0;

    // ── Supplier Balances (auto: all suppliers from net position) ──
    const supplierAccounts = (netPosition.onUs?.accounts || []).filter(a => a.category === "Supplier");
    const supplierNet = netPosition.supplierLiabilities ?? 0;
    const supplierList = supplierAccounts
      .map(a => ({ name: a.name, value: a.value, breakdown: a.breakdown }))
      .sort((x, y) => y.value - x.value);

    // ── Customer Credit (auto: all Dr customers from net position) ──
    const customerAccounts = (netPosition.forUs?.accounts || []).filter(a => a.category === "Customer");
    const customerNet = customerAccounts.reduce((sum, a) => sum + a.value, 0);
    const customerList = customerAccounts
      .map(a => ({ name: a.name, value: a.value }))
      .sort((x, y) => y.value - x.value);

    // ── Agent Accounts ──
    const agentNames = new Set(agentAccounts.map(a => a.accountName.toLowerCase().trim()));
    const agentIds = new Set(
      agentAccounts.map(a => {
        const parts = a.accountId.split("-");
        return parseInt(parts[parts.length - 1] || "0");
      }).filter(Boolean)
    );
    const agentAccountItems = allAccounts.filter(a =>
      agentNames.has(a.name.toLowerCase().trim()) || agentIds.has(Number((a as any).id))
    );
    const agentNet = agentAccountItems.reduce((sum, a) => sum + signedValue(a), 0);
    const agentList = agentAccountItems
      .map(a => ({
        id: (a as any).id as number,
        compositeId: `ledger-${(a as any).id}`,
        name: a.name,
        code: a.code,
        signedBalance: signedValue(a),
      }))
      .sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));

    // ── Freight Accounts ──
    const freightIds = new Set(
      (freightAccountRows || []).map(a => {
        const parts = a.accountId.split("-");
        return parseInt(parts[parts.length - 1] || "0");
      }).filter(Boolean)
    );
    const freightNames = new Set((freightAccountRows || []).map(a => a.accountName.toLowerCase().trim()));
    const freightAccountItems = (freightAccountRows && freightAccountRows.length > 0)
      ? allAccounts.filter(a =>
          freightNames.has(a.name.toLowerCase().trim()) || freightIds.has(Number((a as any).id))
        )
      : [];
    const freightNet = freightAccountItems.reduce((sum, a) => sum + signedValue(a), 0);
    const freightList = freightAccountItems
      .map(a => ({
        id: (a as any).id as number,
        compositeId: `ledger-${(a as any).id}`,
        name: a.name,
        code: a.code,
        signedBalance: signedValue(a),
      }))
      .sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));

    // ── Cash & Bank (manual pinned) ──
    const cashbankIds = new Set(
      (cashbankPinned || []).map(a => {
        const parts = a.accountId.split("-");
        return parseInt(parts[parts.length - 1] || "0");
      }).filter(Boolean)
    );
    const cashbankNames = new Set((cashbankPinned || []).map(a => a.accountName.toLowerCase().trim()));
    const cashBankItems = (cashbankPinned && cashbankPinned.length > 0)
      ? allAccounts.filter(a =>
          cashbankNames.has(a.name.toLowerCase().trim()) || cashbankIds.has(Number((a as any).id))
        )
      : [];
    const cashBankTotal = cashBankItems.reduce((sum, a) => sum + signedValue(a), 0);
    const cashBankList = cashBankItems
      .map(a => ({
        id: (a as any).id as number,
        compositeId: `ledger-${(a as any).id}`,
        name: a.name,
        code: a.code,
        signedBalance: signedValue(a),
      }))
      .sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));

    // ── Worker Advances (pinned) ──
    const buildPinnedList = (pinned: PinnedRow[] | undefined) => {
      if (!pinned || pinned.length === 0) return { items: [], net: 0, list: [] };
      const pinnedIds = new Set(pinned.map(p => {
        const parts = p.accountId.split("-");
        return parseInt(parts[parts.length - 1] || "0");
      }).filter(Boolean));
      const pinnedNames = new Set(pinned.map(p => p.accountName.toLowerCase().trim()));
      const items = allAccounts.filter(a =>
        pinnedNames.has(a.name.toLowerCase().trim()) || pinnedIds.has(Number((a as any).id))
      );
      const net = items.reduce((sum, a) => sum + signedValue(a), 0);
      const list = items.map(a => ({
        id: (a as any).id as number,
        compositeId: `ledger-${(a as any).id}`,
        name: a.name,
        code: a.code,
        signedBalance: signedValue(a),
      })).sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));
      return { items, net, list };
    };
    const advanceData = buildPinnedList(advancePinned);

    return {
      rawMaterialValue,
      mixBatchValue,
      supplierNet,
      supplierCount: supplierList.length,
      supplierList,
      customerNet,
      customerCount: customerList.length,
      customerList,
      cashBankTotal,
      cashBankCount: cashBankItems.length,
      cashBankList,
      freightNet,
      freightCount: freightAccountItems.length,
      freightList,
      agentNet,
      agentCount: agentAccountItems.length,
      agentList,
      advanceNet: advanceData.net,
      advanceCount: advanceData.items.length,
      advanceList: advanceData.list,
      allAccounts,
    };
  }, [netPosition, agentAccounts, freightAccountRows, cashbankPinned, advancePinned]);

  const allLoading = isLoading || !computed;

  // ── Account picker helpers ──
  const pinnedRowsForCard: PinnedRow[] =
    pickerFor === "agent" ? (agentAccounts || []) :
    pickerFor === "freight" ? (freightAccountRows || []) :
    pickerFor === "cashbank" ? (cashbankPinned || []) :
    pickerFor === "advance" ? (advancePinned || []) : [];

  const pickerSelectedIds = new Set(pinnedRowsForCard.map(a => a.accountId));
  const pickerAccounts = (computed?.allAccounts || [])
    .filter(a => {
      const compositeId = `ledger-${(a as any).id}`;
      if (pickerSelectedIds.has(compositeId)) return false;
      if (!pickerSearch.trim()) return true;
      return a.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
             (a.code || "").toLowerCase().includes(pickerSearch.toLowerCase());
    })
    .slice(0, 80);

  const cardLabel =
    pickerFor === "agent" ? "Agent" :
    pickerFor === "freight" ? "Freight / Embassy" :
    pickerFor === "cashbank" ? "Cash & Bank" :
    pickerFor === "advance" ? "Advance" : "";

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-50 bg-background border-b">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Financial Snapshot</h1>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Updated {lastUpdated}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isLoading}
              data-testid="button-refresh-snapshot"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* ── Section 1: Factory Floor ─────────────────────────────────── */}
        <div>
          <SectionHeader title="Factory Floor" color="#10b981" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard
              icon={Package}
              title="Raw Material Value"
              value={computed ? usd(computed.rawMaterialValue) : "—"}
              sub="Remaining stock"
              color="green"
              loading={allLoading}
            />
            <KpiCard
              icon={Layers}
              title="Mix Batches on Tables"
              value={computed ? usd(computed.mixBatchValue) : "—"}
              sub="Active & open batches"
              color="blue"
              loading={allLoading}
            />
            <KpiCard
              icon={Scale}
              title="Bale Stock Weight"
              value={snapshot ? kg(snapshot.baleWeightTotal) : "—"}
              sub={snapshot ? `${snapshot.baleCount.toLocaleString()} bales (all-time)` : undefined}
              color="purple"
              loading={loadingSnapshot}
            />
          </div>
        </div>

        <Separator />

        {/* ── Section 2: Balances & Credit ─────────────────────────────── */}
        <div>
          <SectionHeader title="Balances & Credit" color="#f59e0b" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

            {/* ── Supplier Balances (auto: all suppliers) ── */}
            {allLoading ? (
              <KpiCard icon={TrendingDown} title="Supplier Balances" value="—" color="red" loading />
            ) : (
              <Card data-testid="kpi-card-supplier">
                <CardContent className="p-4">
                  <button
                    className="w-full text-left"
                    onClick={() => setSupplierExpanded(v => !v)}
                    data-testid="button-expand-supplier"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 p-2 rounded-md bg-muted shrink-0 text-red-500">
                        <TrendingDown className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Supplier Balances</p>
                        <p className="text-lg font-semibold font-mono mt-0.5 text-red-600 dark:text-red-400" data-testid="value-supplier">
                          {usd(computed.supplierNet)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {computed.supplierCount} supplier{computed.supplierCount !== 1 ? "s" : ""} · Total owed to suppliers
                        </p>
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {supplierExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </button>
                  {supplierExpanded && computed.supplierList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.supplierList.map((s, i) => (
                        <div key={i} className="py-1.5 px-2 rounded-md">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-foreground truncate">{s.name}</span>
                            <span className="text-sm font-mono font-medium text-red-600 dark:text-red-400 shrink-0">{usd(s.value)}</span>
                          </div>
                          {s.breakdown && s.breakdown.length > 0 && (
                            <div className="mt-1 pl-2 space-y-0.5">
                              {s.breakdown.map((b, bi) => (
                                <div key={bi} className="flex items-center justify-between gap-2">
                                  <span className="text-xs text-muted-foreground truncate">{b.label}</span>
                                  <span className="text-xs text-muted-foreground shrink-0">{b.native} ≈ {usd(b.usd)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {supplierExpanded && computed.supplierList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">No supplier balances found</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Customer Credit (auto: all Dr customers) ── */}
            {allLoading ? (
              <KpiCard icon={TrendingUp} title="Customer Credit" value="—" color="green" loading />
            ) : (
              <Card data-testid="kpi-card-customer">
                <CardContent className="p-4">
                  <button
                    className="w-full text-left"
                    onClick={() => setCustomerExpanded(v => !v)}
                    data-testid="button-expand-customer"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 p-2 rounded-md bg-muted shrink-0 text-emerald-500">
                        <TrendingUp className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Customer Credit</p>
                        <p className="text-lg font-semibold font-mono mt-0.5 text-emerald-600 dark:text-emerald-400" data-testid="value-customer">
                          {usd(computed.customerNet)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {computed.customerCount} customer{computed.customerCount !== 1 ? "s" : ""} · Total owed by customers
                        </p>
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {customerExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </button>
                  {customerExpanded && computed.customerList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.customerList.map((c, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md">
                          <span className="text-sm text-foreground truncate">{c.name}</span>
                          <span className="text-sm font-mono font-medium text-emerald-600 dark:text-emerald-400 shrink-0">{usd(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {customerExpanded && computed.customerList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">No customer balances found</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Worker Advances Outstanding (pinned) ── */}
            {allLoading ? (
              <KpiCard icon={HardHat} title="Worker Advances Outstanding" value="—" color="amber" loading />
            ) : (
              <Card data-testid="kpi-card-advance">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button className="flex-1 flex items-start gap-3 text-left min-w-0" onClick={() => setAdvanceExpanded(v => !v)} data-testid="button-expand-advance">
                      <div className="mt-0.5 p-2 rounded-md bg-muted shrink-0 text-amber-500"><HardHat className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Worker Advances Outstanding</p>
                        <p className="text-lg font-semibold font-mono mt-0.5 text-amber-600 dark:text-amber-400" data-testid="value-advance">
                          {computed.advanceCount === 0
                            ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span>
                            : usd(Math.abs(computed.advanceNet))}
                        </p>
                        {computed.advanceCount > 0 && <p className="text-xs text-muted-foreground mt-0.5">{computed.advanceCount} account{computed.advanceCount !== 1 ? "s" : ""} · Outstanding advances</p>}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">{advanceExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("advance"); setPickerSearch(""); }} data-testid="button-add-advance-account"><Plus className="h-4 w-4" /></Button>
                  </div>
                  {advanceExpanded && computed.advanceList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.advanceList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1" onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)} data-testid={`button-advance-account-${acct.id}`}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-sm font-mono font-medium text-amber-600 dark:text-amber-400">{usd(acct.signedBalance)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAccountMutation.mutate({ type: "advance", accountId: acct.compositeId })} data-testid={`button-remove-advance-${acct.id}`}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {advanceExpanded && computed.advanceList.length === 0 && <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add advance accounts</p>}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <Separator />

        {/* ── Section 3: Accounts & Finance ────────────────────────────── */}
        <div>
          <SectionHeader title="Accounts & Finance" color="#6366f1" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

            {/* ── Cash & Bank (manual pinned) ── */}
            {allLoading ? (
              <KpiCard icon={Wallet} title="Cash & Bank" value="—" color="green" loading />
            ) : (
              <Card data-testid="kpi-card-cash-bank">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button className="flex-1 flex items-start gap-3 text-left min-w-0" onClick={() => setCashBankExpanded(v => !v)} data-testid="button-expand-cash-bank">
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${computed.cashBankTotal >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        <Wallet className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Cash & Bank</p>
                        <p className={`text-lg font-semibold font-mono mt-0.5 ${computed.cashBankTotal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} data-testid="value-cash-bank">
                          {computed.cashBankCount === 0
                            ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span>
                            : usd(computed.cashBankTotal)}
                        </p>
                        {computed.cashBankCount > 0 && <p className="text-xs text-muted-foreground mt-0.5">{computed.cashBankCount} account{computed.cashBankCount !== 1 ? "s" : ""}</p>}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {cashBankExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("cashbank"); setPickerSearch(""); }} data-testid="button-add-cashbank-account">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {cashBankExpanded && computed.cashBankList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.cashBankList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1" onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)} data-testid={`button-cashbank-account-${acct.id}`}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-sm font-mono font-medium ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{usd(acct.signedBalance)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAccountMutation.mutate({ type: "cashbank", accountId: acct.compositeId })} data-testid={`button-remove-cashbank-${acct.id}`}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {cashBankExpanded && computed.cashBankList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add cash & bank accounts</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Agent Accounts (manual) ── */}
            {allLoading ? (
              <KpiCard icon={UserRound} title="Agent Accounts" value="—" color="amber" loading />
            ) : (
              <Card data-testid="kpi-card-agents">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button className="flex-1 flex items-start gap-3 text-left min-w-0" onClick={() => setAgentExpanded(v => !v)} data-testid="button-expand-agents">
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${computed.agentNet >= 0 ? "text-emerald-500" : "text-amber-500"}`}>
                        <UserRound className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Agent Accounts</p>
                        <p className={`text-lg font-semibold font-mono mt-0.5 ${computed.agentNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {computed.agentCount === 0
                            ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span>
                            : usd(Math.abs(computed.agentNet))}
                        </p>
                        {computed.agentCount > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{computed.agentCount} account{computed.agentCount !== 1 ? "s" : ""} · {computed.agentNet >= 0 ? "Net receivable" : "Net payable"}</p>
                        )}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {agentExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("agent"); setPickerSearch(""); }} data-testid="button-add-agent-account">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {agentExpanded && computed.agentList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.agentList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1" onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)} data-testid={`button-agent-account-${acct.id}`}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-sm font-mono font-medium ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{usd(acct.signedBalance)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAccountMutation.mutate({ type: "agent", accountId: acct.compositeId })} data-testid={`button-remove-agent-${acct.id}`}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {agentExpanded && computed.agentList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add agent accounts</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Freight / Embassy / Shipping (manual) ── */}
            {allLoading ? (
              <KpiCard icon={Truck} title="Freight / Embassy / Shipping" value="—" color="amber" loading />
            ) : (
              <Card data-testid="kpi-card-freight">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button className="flex-1 flex items-start gap-3 text-left min-w-0" onClick={() => setFreightExpanded(v => !v)} data-testid="button-expand-freight">
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${computed.freightNet >= 0 ? "text-emerald-500" : "text-amber-500"}`}>
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Freight / Embassy / Shipping</p>
                        <p className={`text-lg font-semibold font-mono mt-0.5 ${computed.freightNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {computed.freightCount === 0
                            ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span>
                            : usd(Math.abs(computed.freightNet))}
                        </p>
                        {computed.freightCount > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{computed.freightCount} account{computed.freightCount !== 1 ? "s" : ""} · {computed.freightNet >= 0 ? "Net asset" : "Net payable"}</p>
                        )}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {freightExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("freight"); setPickerSearch(""); }} data-testid="button-add-freight-account">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {freightExpanded && computed.freightList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.freightList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1" onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)} data-testid={`button-freight-account-${acct.id}`}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-sm font-mono font-medium ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{usd(acct.signedBalance)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAccountMutation.mutate({ type: "freight", accountId: acct.compositeId })} data-testid={`button-remove-freight-${acct.id}`}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {freightExpanded && computed.freightList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add freight/embassy accounts</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* ── Disclaimer ───────────────────────────────────────────────── */}
        <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Values are sourced from the Net Position. Raw material and mix batch values use USD cost per kg. Supplier and customer totals include all accounts. Cash &amp; Bank, Agent, and Freight accounts are manually configured using the + button.
          </span>
        </div>

      </div>
    </div>

    {/* ── Account Picker Dialog ─────────────────────────────────────── */}
    <Dialog open={pickerFor !== null} onOpenChange={(open) => { if (!open) setPickerFor(null); }}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-4 pb-3 border-b shrink-0">
          <DialogTitle>Add {cardLabel} Account</DialogTitle>
        </DialogHeader>
        <div className="p-3 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-sm"
              placeholder="Search accounts..."
              value={pickerSearch}
              onChange={e => setPickerSearch(e.target.value)}
              autoFocus
              data-testid="input-picker-search"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {pickerAccounts.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              {pickerSearch ? "No accounts match your search" : "All accounts already selected"}
            </p>
          )}
          {pickerAccounts.map((acct, i) => {
            const acctId = (acct as any).id as number;
            const compositeId = `ledger-${acctId}`;
            const side = (acct as any).side as "forUs" | "onUs";
            const signedBal = side === "forUs" ? acct.value : -acct.value;
            return (
              <button
                key={acctId ?? i}
                className="w-full flex items-center justify-between gap-3 py-2 px-3 rounded-md hover-elevate text-left"
                onClick={() => {
                  if (!pickerFor) return;
                  addAccountMutation.mutate({
                    type: pickerFor,
                    body: { accountId: compositeId, accountType: "ledger", accountName: acct.name },
                  });
                  setPickerFor(null);
                }}
                data-testid={`button-picker-account-${acctId}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{acct.name}</p>
                  {acct.code && <p className="text-xs text-muted-foreground">{acct.code} · {acct.category}</p>}
                </div>
                <span className={`text-sm font-mono shrink-0 ${signedBal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {usd(signedBal)}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
