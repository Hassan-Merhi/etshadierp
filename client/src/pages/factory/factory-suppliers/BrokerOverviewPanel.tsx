import {
  Badge,
} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Switch,
} from "@/components/ui/switch";
import {
  ArrowLeft,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  GitBranch,
  Link2,
  Package,
  Users,
} from "lucide-react";
import { CurrencyBalance, SupplierWithBalance } from "./factorySupplierTypes";

interface BrokerOverviewPanelProps {
  parentViewSupplierId: number;
  allSuppliers: SupplierWithBalance[];
  subAccountsByParent: Record<number, SupplierWithBalance[]>;
  brokerOverviewStatement: any;
  brokerOverviewLoading: boolean;
  brokerIncludeOtw: boolean;
  setBrokerIncludeOtw: (val: boolean) => void;
  setParentViewSupplierId: (id: number | null) => void;
  openChildStatement: (id: number) => void;
  openPaymentDialog: (sup: SupplierWithBalance) => void;
  formatNum: (val: string) => string;
  formatDate: (val: string) => string;
}

export function BrokerOverviewPanel({
  parentViewSupplierId,
  allSuppliers,
  subAccountsByParent,
  brokerOverviewStatement,
  brokerOverviewLoading,
  brokerIncludeOtw,
  setBrokerIncludeOtw,
  setParentViewSupplierId,
  openChildStatement,
  openPaymentDialog,
  formatNum,
  formatDate,
}: BrokerOverviewPanelProps) {
  const parentSup = allSuppliers.find(s => s.id === parentViewSupplierId);
  const children = subAccountsByParent[parentViewSupplierId] || [];

  // Pool balances from broker activity ledger (all currencies, net balance per currency section)
  const brokerOwnBalances: { currencyCode: string; balance: number; isBrokerPool: boolean }[] =
    (brokerOverviewStatement?.currencyLedgers || [])
      .map((section: any) => ({
        currencyCode: section.currencyCode,
        balance: parseFloat(section.netBalance || "0"),
        isBrokerPool: !!section.isBrokerPool
      }))
      .filter((b: any) => Math.abs(b.balance) > 0.001);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setParentViewSupplierId(null)}
          data-testid="button-back-from-parent-view"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-parent-supplier-name">
              {parentSup?.name || "Loading..."}
            </h1>
            <Badge variant="secondary" className="text-xs">
              <Building2 className="h-3 w-3 mr-1" />
              Broker
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {children.length} linked supplier{children.length !== 1 ? "s" : ""}
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="label-broker-overview-include-otw">
          <Switch
            checked={brokerIncludeOtw}
            onCheckedChange={setBrokerIncludeOtw}
            data-testid="switch-broker-overview-include-otw"
          />
          <span className="text-xs font-normal text-muted-foreground">Include OTW containers</span>
        </label>
        {parentSup && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => openChildStatement(parentSup.id)}
            data-testid="button-parent-own-statement"
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Broker Statement
          </Button>
        )}
      </div>

      {/* ── Broker KPIs ───────────────────────────────────────────── */}
      {parentSup && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <div className="rounded-xl border p-4">
              <div className="text-xs text-muted-foreground">Total Containers</div>
              <div className="text-2xl font-bold mt-1" data-testid="text-parent-total-containers">
                {parentSup.totalContainers}
              </div>
          </div>
          <div className="rounded-xl border p-4">
              <div className="text-xs text-muted-foreground">Linked Suppliers</div>
              <div className="text-2xl font-bold mt-1">
                {children.length}
              </div>
          </div>
          {/* OTW card — only shown when there are pending containers */}
          {parentSup.pendingContainers > 0 && (() => {
            const byCC = parentSup.otwByCurrency || {};
            const eurCount = byCC["EUR"] || 0;
            const usdCount = byCC["USD"] || 0;
            const otherCount = Object.entries(byCC)
              .filter(([cc]) => cc !== "EUR" && cc !== "USD")
              .reduce((s, [, n]) => s + n, 0);
            const pills = [
              { label: "EUR", count: eurCount },
              { label: "USD", count: usdCount },
              { label: "Other", count: otherCount },
            ].filter(p => p.count > 0);
            return (
              <div key="otw" className="rounded-xl border p-4" data-testid="card-otw-containers">
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    OTW Containers
                  </div>
                  <div className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400 tabular-nums" data-testid="text-otw-total">
                    {parentSup.pendingContainers}
                  </div>
                  {pills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {pills.map(p => (
                        <span
                          key={p.label}
                          className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          data-testid={`text-otw-${p.label.toLowerCase()}`}
                        >
                          {p.label} {p.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
            );
          })()}
          {brokerOverviewLoading ? (
            <div className="rounded-xl border p-4">
                <div className="text-xs text-muted-foreground">Pool Balance</div>
                <div className="text-2xl font-bold mt-1 text-muted-foreground animate-pulse">—</div>
            </div>
          ) : brokerOwnBalances.map((b) => (
            <div key={b.currencyCode} className="rounded-xl border p-4">
                <div className="text-xs text-muted-foreground">
                  {b.isBrokerPool ? "Pool Balance" : "Net Balance"} ({b.currencyCode})
                </div>
                <div
                  className={`text-2xl font-bold mt-1 tabular-nums ${b.balance > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                  data-testid={`text-pool-balance-${b.currencyCode}`}
                >
                  {b.currencyCode === "USD" ? "$" : `${b.currencyCode} `}{formatNum(Math.abs(b.balance).toFixed(2))}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {b.isBrokerPool
                    ? (b.balance > 0 ? "Received" : b.balance < 0 ? "Owed" : "Settled")
                    : (b.balance > 0 ? "Payable to suppliers" : b.balance < 0 ? "Overpaid" : "Settled")}
                </div>
            </div>
          ))}
        </div>
      )}

      {/* Linked Suppliers list */}
      <div className="rounded-xl border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Linked Suppliers</span>
        </div>
        <div>
          {children.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>No linked suppliers yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {children.map(child => (
                <div
                  key={child.id}
                  className="flex items-center justify-between gap-3 p-4"
                  data-testid={`row-child-supplier-${child.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <GitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <button
                        onClick={() => openChildStatement(child.id)}
                        className="font-semibold hover:underline text-left"
                        data-testid={`link-child-statement-${child.id}`}
                      >
                        {child.name}
                      </button>
                      {!child.isActive && (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        {child.totalContainers} container{child.totalContainers !== 1 ? "s" : ""}
                      </span>
                      {child.pendingContainers > 0 && (
                        <span className="flex items-center gap-1 text-amber-500">
                          <Clock className="h-3.5 w-3.5" />
                          {child.pendingContainers} OTW
                        </span>
                      )}
                      {child.lastContainerDate && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          Last: {formatDate(child.lastContainerDate)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {child.isActive && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openPaymentDialog(child)}
                        title="Record Payment"
                        data-testid={`button-pay-child-${child.id}`}
                      >
                        <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openChildStatement(child.id)}
                      data-testid={`button-view-child-statement-${child.id}`}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
