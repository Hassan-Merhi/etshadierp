import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Users,
  Wallet,
  DollarSign,
  Truck,
  UserRound,
  RefreshCw,
  Building2,
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
  rawMaterialValue: number;
  mixBatchValue: number;
  baleWeightTotal: number;
  baleCount: number;
  baleValueTotal: number;
  outstandingAdvances: number;
  advanceCount: number;
  activeWorkerCount: number;
  capitalTotal: number;
  equityAccounts: { id: number; name: string; code: string; accountType: string }[];
}

interface NetPositionData {
  forUsTotal: number;
  onUsTotal: number;
  netPosition: number;
  supplierLiabilities: number;
  inventoryValue: number;
  forUs: { total: number; breakdown: { name: string; value: number }[]; accounts: { name: string; code: string; value: number; category: string }[] };
  onUs: { total: number; breakdown: { name: string; value: number }[]; accounts: { name: string; code: string; value: number; category: string }[] };
}

interface Customer {
  id: number;
  legalName: string;
  balance: number;
  balanceSide: string;
}

interface AgentAccount {
  id: number;
  accountId: string;
  accountType: string;
  accountName: string;
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

function SectionHeader({ title, count, color }: { title: string; count?: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="h-3.5 w-1 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {count !== undefined && (
        <Badge variant="outline" className="text-xs h-5">
          {count} items
        </Badge>
      )}
    </div>
  );
}

export default function FactoryFinancialSnapshot() {
  useEscapeBack();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [cashBankExpanded, setCashBankExpanded] = useState(false);
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [freightExpanded, setFreightExpanded] = useState(false);

  // picker state: which card is open, and the search term
  type CardKey = "agent" | "freight" | "supplier" | "customer" | "advance";
  const [pickerFor, setPickerFor] = useState<CardKey | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const [supplierExpanded, setSupplierExpanded] = useState(false);
  const [customerExpanded, setCustomerExpanded] = useState(false);
  const [advanceExpanded, setAdvanceExpanded] = useState(false);

  const { data: snapshot, isLoading: loadingSnapshot, refetch: refetchSnapshot, dataUpdatedAt: snapUpdated } =
    useQuery<SnapshotData>({ queryKey: ["/api/factory/financial-snapshot"] });

  const { data: netPosition, isLoading: loadingNP, refetch: refetchNP } =
    useQuery<NetPositionData>({ queryKey: ["/api/factory/net-position"] });

  const { data: customers, isLoading: loadingCustomers, refetch: refetchCustomers } =
    useQuery<Customer[]>({ queryKey: ["/api/factory/customers"] });

  const { data: agentAccounts, isLoading: loadingAgents, refetch: refetchAgents } =
    useQuery<AgentAccount[]>({ queryKey: ["/api/agent-accounts"] });

  type PinnedRow = { id: number; accountId: string; accountType: string; accountName: string };

  const { data: freightAccountRows, isLoading: loadingFreight } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/freight-accounts"] });

  const { data: supplierPinned, isLoading: loadingSupplierPinned } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/snapshot-pinned-accounts/supplier"] });

  const { data: customerPinned, isLoading: loadingCustomerPinned } =
    useQuery<PinnedRow[]>({ queryKey: ["/api/snapshot-pinned-accounts/customer"] });

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

  const isLoading = loadingSnapshot || loadingNP || loadingCustomers || loadingAgents || loadingFreight
    || loadingSupplierPinned || loadingCustomerPinned || loadingAdvancePinned;

  const handleRefresh = () => {
    refetchSnapshot();
    refetchNP();
    refetchCustomers();
    refetchAgents();
  };

  const lastUpdated = snapUpdated ? new Date(snapUpdated).toLocaleTimeString() : null;

  const computed = useMemo(() => {
    if (!netPosition || !customers || !agentAccounts) return null;

    const allAccounts = [
      ...((netPosition.forUs?.accounts || []).map(a => ({ ...a, side: "forUs" as const }))),
      ...((netPosition.onUs?.accounts || []).map(a => ({ ...a, side: "onUs" as const }))),
    ];

    const signedValue = (a: { value: number; side: "forUs" | "onUs" }) =>
      a.side === "forUs" ? a.value : -a.value;

    const nameMatch = (name: string, ...keywords: string[]) =>
      keywords.some(k => name.toLowerCase().includes(k.toLowerCase()));

    // ── Agent accounts (ID-based from DB) ──
    const agentNames = new Set(agentAccounts.map(a => a.accountName.toLowerCase().trim()));
    const agentIds = new Set(
      agentAccounts.map(a => {
        const parts = a.accountId.split("-");
        return parseInt(parts[parts.length - 1] || "0");
      }).filter(Boolean)
    );

    // ── Freight accounts (ID-based from DB) ──
    const freightIds = new Set(
      (freightAccountRows || []).map(a => {
        const parts = a.accountId.split("-");
        return parseInt(parts[parts.length - 1] || "0");
      }).filter(Boolean)
    );
    const freightNames = new Set((freightAccountRows || []).map(a => a.accountName.toLowerCase().trim()));

    const cashBankAccounts = allAccounts.filter(a =>
      a.category === "Cash" || a.category === "Bank"
    );
    // Use signed total: forUs = positive (asset), onUs = negative (overdraft)
    const cashBankTotal = cashBankAccounts.reduce(
      (sum, a) => sum + (a.side === "forUs" ? a.value : -a.value), 0
    );

    const freightAccountItems = freightAccountRows && freightAccountRows.length > 0
      ? allAccounts.filter(a =>
          freightNames.has(a.name.toLowerCase().trim()) || freightIds.has(Number((a as any).id))
        )
      : [];
    const freightNet = freightAccountItems.reduce((sum, a) => sum + signedValue(a), 0);

    const agentAccountItems = allAccounts.filter(a =>
      agentNames.has(a.name.toLowerCase().trim()) || agentIds.has(Number((a as any).id))
    );
    const agentNet = agentAccountItems.reduce((sum, a) => sum + signedValue(a), 0);

    const rentalAccounts = allAccounts.filter(a =>
      nameMatch(a.name, "rent", "rental", "إيجار")
    );
    const rentalNet = rentalAccounts.reduce((sum, a) => sum + signedValue(a), 0);

    const customerCredit = (customers as any[]).reduce((sum: number, c: any) => {
      const bal = parseFloat(c.balance || "0");
      if (c.balanceSide === "Dr" && bal > 0) return sum + bal;
      return sum;
    }, 0);

    // Build sorted account list for expandable view with signed balances
    const cashBankList = cashBankAccounts
      .map(a => ({
        id: (a as any).id as number,
        name: a.name,
        code: a.code,
        signedBalance: a.side === "forUs" ? a.value : -a.value,
      }))
      .sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));

    const agentList = agentAccountItems
      .map(a => ({
        id: (a as any).id as number,
        compositeId: `ledger-${(a as any).id}`,
        name: a.name,
        code: a.code,
        signedBalance: signedValue(a),
      }))
      .sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));

    const freightList = freightAccountItems
      .map(a => ({
        id: (a as any).id as number,
        compositeId: `ledger-${(a as any).id}`,
        name: a.name,
        code: a.code,
        signedBalance: signedValue(a),
      }))
      .sort((x, y) => Math.abs(y.signedBalance) - Math.abs(x.signedBalance));

    // ── Helper: build a pinned list from a pinned rows array ──
    const buildPinnedList = (pinned: PinnedRow[] | undefined) => {
      if (!pinned || pinned.length === 0) return { items: [], net: 0 };
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

    const supplierData = buildPinnedList(supplierPinned);
    const customerData = buildPinnedList(customerPinned);
    const advanceData = buildPinnedList(advancePinned);

    return {
      cashBankTotal,
      cashBankCount: cashBankAccounts.length,
      cashBankList,
      freightNet,
      freightCount: freightAccountItems.length,
      freightList,
      agentNet,
      agentCount: agentAccountItems.length,
      agentList,
      supplierNet: supplierData.net,
      supplierCount: supplierData.items.length,
      supplierList: supplierData.list ?? [],
      customerNet: customerData.net,
      customerCount: customerData.items.length,
      customerList: customerData.list ?? [],
      advanceNet: advanceData.net,
      advanceCount: advanceData.items.length,
      advanceList: advanceData.list ?? [],
      rentalNet,
      rentalCount: rentalAccounts.length,
      customerCredit,
      allAccounts,
    };
  }, [netPosition, customers, agentAccounts, freightAccountRows, supplierPinned, customerPinned, advancePinned]);

  const allLoading = isLoading || !computed;

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

        {/* ── Section 1: Factory Floor ───────────────────────────────────── */}
        <div>
          <SectionHeader title="Factory Floor" color="#10b981" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiCard
              icon={Package}
              title="Raw Material Value"
              value={snapshot ? usd(snapshot.rawMaterialValue) : "—"}
              sub={snapshot ? `${snapshot.rawMaterialValue > 0 ? "Remaining stock" : "No stock in hand"}` : undefined}
              color="green"
              loading={loadingSnapshot}
            />
            <KpiCard
              icon={Layers}
              title="Mix Batches on Tables"
              value={snapshot ? usd(snapshot.mixBatchValue) : "—"}
              sub="Active & open batches"
              color="blue"
              loading={loadingSnapshot}
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

        {/* ── Section 2: Positions ──────────────────────────────────────── */}
        <div>
          <SectionHeader title="Balances & Credit" color="#f59e0b" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

            {/* ── Supplier Balances ── */}
            {allLoading ? (
              <KpiCard icon={TrendingDown} title="Supplier Balances" value="—" color="red" loading />
            ) : (
              <Card data-testid="kpi-card-supplier">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button className="flex-1 flex items-start gap-3 text-left min-w-0" onClick={() => setSupplierExpanded(v => !v)} data-testid="button-expand-supplier">
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 text-red-500`}><TrendingDown className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Supplier Balances</p>
                        <p className="text-lg font-semibold font-mono mt-0.5 text-red-600 dark:text-red-400" data-testid="value-supplier">
                          {computed && computed.supplierCount === 0 ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span> : usd(Math.abs(computed?.supplierNet ?? 0))}
                        </p>
                        {computed && computed.supplierCount > 0 && <p className="text-xs text-muted-foreground mt-0.5">{computed.supplierCount} account{computed.supplierCount !== 1 ? "s" : ""} · Total owed to suppliers</p>}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">{supplierExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("supplier"); setPickerSearch(""); }} data-testid="button-add-supplier-account"><Plus className="h-4 w-4" /></Button>
                  </div>
                  {supplierExpanded && computed && computed.supplierList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.supplierList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1" onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)} data-testid={`button-supplier-account-${acct.id}`}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-sm font-mono font-medium text-red-600 dark:text-red-400">{usd(acct.signedBalance)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAccountMutation.mutate({ type: "supplier", accountId: acct.compositeId })} data-testid={`button-remove-supplier-${acct.id}`}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {supplierExpanded && computed && computed.supplierList.length === 0 && <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add supplier accounts</p>}
                </CardContent>
              </Card>
            )}

            {/* ── Customer Credit ── */}
            {allLoading ? (
              <KpiCard icon={TrendingUp} title="Customer Credit" value="—" color="green" loading />
            ) : (
              <Card data-testid="kpi-card-customer">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button className="flex-1 flex items-start gap-3 text-left min-w-0" onClick={() => setCustomerExpanded(v => !v)} data-testid="button-expand-customer">
                      <div className="mt-0.5 p-2 rounded-md bg-muted shrink-0 text-emerald-500"><TrendingUp className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Customer Credit</p>
                        <p className="text-lg font-semibold font-mono mt-0.5 text-emerald-600 dark:text-emerald-400" data-testid="value-customer">
                          {computed && computed.customerCount === 0 ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span> : usd(Math.abs(computed?.customerNet ?? 0))}
                        </p>
                        {computed && computed.customerCount > 0 && <p className="text-xs text-muted-foreground mt-0.5">{computed.customerCount} account{computed.customerCount !== 1 ? "s" : ""} · Net customer receivable</p>}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">{customerExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("customer"); setPickerSearch(""); }} data-testid="button-add-customer-account"><Plus className="h-4 w-4" /></Button>
                  </div>
                  {customerExpanded && computed && computed.customerList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.customerList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1" onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)} data-testid={`button-customer-account-${acct.id}`}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-sm font-mono font-medium ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{usd(acct.signedBalance)}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeAccountMutation.mutate({ type: "customer", accountId: acct.compositeId })} data-testid={`button-remove-customer-${acct.id}`}><X className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {customerExpanded && computed && computed.customerList.length === 0 && <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add customer accounts</p>}
                </CardContent>
              </Card>
            )}

            {/* ── Worker Advances Outstanding ── */}
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
                          {computed && computed.advanceCount === 0 ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span> : usd(Math.abs(computed?.advanceNet ?? 0))}
                        </p>
                        {computed && computed.advanceCount > 0 && <p className="text-xs text-muted-foreground mt-0.5">{computed.advanceCount} account{computed.advanceCount !== 1 ? "s" : ""} · Outstanding advances</p>}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">{advanceExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
                    </button>
                    <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={() => { setPickerFor("advance"); setPickerSearch(""); }} data-testid="button-add-advance-account"><Plus className="h-4 w-4" /></Button>
                  </div>
                  {advanceExpanded && computed && computed.advanceList.length > 0 && (
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
                  {advanceExpanded && computed && computed.advanceList.length === 0 && <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add advance accounts</p>}
                </CardContent>
              </Card>
            )}

          </div>
        </div>

        <Separator />

        {/* ── Section 3: Accounts ───────────────────────────────────────── */}
        <div>
          <SectionHeader title="Accounts & Finance" color="#6366f1" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* ── Expandable Cash & Bank card ── */}
            {allLoading ? (
              <KpiCard icon={Wallet} title="Cash & Bank" value="—" color="green" loading />
            ) : (
              <Card data-testid="kpi-card-cash-bank">
                <CardContent className="p-4">
                  <button
                    className="w-full text-left"
                    onClick={() => setCashBankExpanded(v => !v)}
                    data-testid="button-expand-cash-bank"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${computed && computed.cashBankTotal >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                        <Wallet className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Cash & Bank</p>
                        <p className={`text-lg font-semibold font-mono mt-0.5 ${computed && computed.cashBankTotal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          data-testid="value-cash-bank">
                          {computed ? usd(computed.cashBankTotal) : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {computed ? `${computed.cashBankCount} account${computed.cashBankCount !== 1 ? "s" : ""}` : ""}
                        </p>
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {cashBankExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </button>

                  {cashBankExpanded && computed && computed.cashBankList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.cashBankList.map((acct, i) => (
                        <button
                          key={acct.id ?? i}
                          className="w-full flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover-elevate text-left group"
                          onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)}
                          data-testid={`button-cash-account-${acct.id}`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </div>
                          <span className={`text-sm font-mono font-medium shrink-0 ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {usd(acct.signedBalance)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {cashBankExpanded && computed && computed.cashBankList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">No cash or bank accounts found</p>
                  )}
                </CardContent>
              </Card>
            )}
            {/* ── Expandable Agent Accounts card ── */}
            {allLoading ? (
              <KpiCard icon={UserRound} title="Agent Accounts" value="—" color="amber" loading />
            ) : (
              <Card data-testid="kpi-card-agents">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button
                      className="flex-1 flex items-start gap-3 text-left min-w-0"
                      onClick={() => setAgentExpanded(v => !v)}
                      data-testid="button-expand-agents"
                    >
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${computed && computed.agentNet >= 0 ? "text-emerald-500" : "text-amber-500"}`}>
                        <UserRound className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Agent Accounts</p>
                        <p className={`text-lg font-semibold font-mono mt-0.5 ${computed && computed.agentNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {computed && computed.agentCount === 0 ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span> : usd(Math.abs(computed?.agentNet ?? 0))}
                        </p>
                        {computed && computed.agentCount > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{computed.agentCount} account{computed.agentCount !== 1 ? "s" : ""} · {computed.agentNet >= 0 ? "Net receivable" : "Net payable"}</p>
                        )}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {agentExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 mt-0.5"
                      onClick={() => { setPickerFor("agent"); setPickerSearch(""); }}
                      data-testid="button-add-agent-account"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {agentExpanded && computed && computed.agentList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.agentList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button
                            className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1"
                            onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)}
                            data-testid={`button-agent-account-${acct.id}`}
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-sm font-mono font-medium ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                              {usd(acct.signedBalance)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => removeAccountMutation.mutate({ type: "agent", accountId: acct.compositeId })}
                              data-testid={`button-remove-agent-${acct.id}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {agentExpanded && computed && computed.agentList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add agent accounts</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── Expandable Freight card ── */}
            {allLoading ? (
              <KpiCard icon={Truck} title="Freight / Embassy / Shipping" value="—" color="amber" loading />
            ) : (
              <Card data-testid="kpi-card-freight">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <button
                      className="flex-1 flex items-start gap-3 text-left min-w-0"
                      onClick={() => setFreightExpanded(v => !v)}
                      data-testid="button-expand-freight"
                    >
                      <div className={`mt-0.5 p-2 rounded-md bg-muted shrink-0 ${computed && computed.freightNet >= 0 ? "text-emerald-500" : "text-amber-500"}`}>
                        <Truck className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">Freight / Embassy / Shipping</p>
                        <p className={`text-lg font-semibold font-mono mt-0.5 ${computed && computed.freightNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {computed && computed.freightCount === 0 ? <span className="text-sm font-normal text-muted-foreground">No accounts selected</span> : usd(Math.abs(computed?.freightNet ?? 0))}
                        </p>
                        {computed && computed.freightCount > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{computed.freightCount} account{computed.freightCount !== 1 ? "s" : ""} · {computed.freightNet >= 0 ? "Net asset" : "Net payable"}</p>
                        )}
                      </div>
                      <div className="mt-1 text-muted-foreground shrink-0">
                        {freightExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 mt-0.5"
                      onClick={() => { setPickerFor("freight"); setPickerSearch(""); }}
                      data-testid="button-add-freight-account"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {freightExpanded && computed && computed.freightList.length > 0 && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {computed.freightList.map((acct, i) => (
                        <div key={acct.id ?? i} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md group">
                          <button
                            className="flex items-center gap-1.5 min-w-0 text-left hover-elevate rounded flex-1 py-0.5 px-1"
                            onClick={() => navigate(`/accounts?accountId=${acct.id}&accountType=ledger`)}
                            data-testid={`button-freight-account-${acct.id}`}
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-foreground truncate">{acct.name}</span>
                            {acct.code && <span className="text-xs text-muted-foreground shrink-0">{acct.code}</span>}
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`text-sm font-mono font-medium ${acct.signedBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                              {usd(acct.signedBalance)}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => removeAccountMutation.mutate({ type: "freight", accountId: acct.compositeId })}
                              data-testid={`button-remove-freight-${acct.id}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {freightExpanded && computed && computed.freightList.length === 0 && (
                    <p className="mt-3 pt-3 border-t text-xs text-muted-foreground text-center">Click + to add freight/embassy accounts</p>
                  )}
                </CardContent>
              </Card>
            )}
            {(!computed || computed.rentalNet < 0) && (
              <KpiCard
                icon={Building2}
                title="Rentals"
                value={computed ? usd(Math.abs(computed.rentalNet)) : "—"}
                sub={computed && computed.rentalCount > 0 ? `${computed.rentalCount} account${computed.rentalCount !== 1 ? "s" : ""} · Outstanding rental payable` : "Accounts matching rent/rental"}
                color="red"
                loading={allLoading}
              />
            )}
          </div>
          {computed && computed.rentalNet >= 0 && computed.rentalCount > 0 && (
            <p className="text-xs text-muted-foreground mt-2 pl-1">
              Rentals: {usd(computed.rentalNet)} — shown only when negative (payable)
            </p>
          )}
          {computed && computed.rentalCount === 0 && (
            <p className="text-xs text-muted-foreground mt-2 pl-1">
              No rental accounts found (accounts named "rent" or "rental")
            </p>
          )}
        </div>

        {/* ── Disclaimer ────────────────────────────────────────────────── */}
        <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Values are computed from live data. Raw material value uses USD cost per kg where available.
            Bale weight shows all-time production. Agent and Freight accounts are manually configured using the + button.
          </span>
        </div>

      </div>
    </div>

    {/* ── Account Picker Dialog ─────────────────────────────────────── */}
    {(() => {
      const pinnedRowsForCard =
        pickerFor === "agent" ? (agentAccounts || []) :
        pickerFor === "freight" ? (freightAccountRows || []) :
        pickerFor === "supplier" ? (supplierPinned || []) :
        pickerFor === "customer" ? (customerPinned || []) :
        pickerFor === "advance" ? (advancePinned || []) : [];
      const selectedIds = new Set(pinnedRowsForCard.map(a => a.accountId));
      const pickerAccounts = (computed?.allAccounts || [])
        .filter(a => {
          const compositeId = `ledger-${(a as any).id}`;
          if (selectedIds.has(compositeId)) return false;
          if (!pickerSearch.trim()) return true;
          return a.name.toLowerCase().includes(pickerSearch.toLowerCase()) ||
                 (a.code || "").toLowerCase().includes(pickerSearch.toLowerCase());
        })
        .slice(0, 80);
      const cardLabel =
        pickerFor === "agent" ? "Agent" :
        pickerFor === "freight" ? "Freight / Embassy" :
        pickerFor === "supplier" ? "Supplier" :
        pickerFor === "customer" ? "Customer" :
        pickerFor === "advance" ? "Advance" : "";
      return (
        <Dialog open={pickerFor !== null} onOpenChange={(open) => { if (!open) setPickerFor(null); }}>
          <DialogContent className="max-w-md max-h-[80vh] flex flex-col gap-0 p-0">
            <DialogHeader className="p-4 pb-3 border-b shrink-0">
              <DialogTitle>
                Add {cardLabel} Account
              </DialogTitle>
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
                    data-testid={`button-pick-account-${acctId}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{acct.name}</p>
                      {acct.code && <p className="text-xs text-muted-foreground">{acct.code}</p>}
                    </div>
                    <span className={`text-sm font-mono shrink-0 ${acct.side === "forUs" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {usd(acct.value)}
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      );
    })()}
    </>
  );
}
