import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, AlertTriangle, Plus, ChevronDown, ChevronRight, Container } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import CreateProformaV5Drawer from "./CreateProformaV5Drawer";

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface ContainerDetail {
  orderId: number;
  containerName: string;
  status: string;
  expectedQty: number;
  loadedQty: number;
}
interface ProformaDetail {
  proformaId: number;
  proformaName: string;
  customerId: number;
  customerName: string;
  lineQty: number;
  containerCount: number;
  totalExpected: number;
  containers: ContainerDetail[];
}
interface V5Row {
  articleCode: string;
  productName: string;
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  proformaDetails: ProformaDetail[];
}
interface V5Totals {
  stockAvailable: number;
  totalLoaded: number;
  expectedToLoad: number;
  freeToPromise: number;
  shortageCount: number;
}
interface V5Data {
  rows: V5Row[];
  totals: V5Totals;
  productNames: Record<string, string>;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft", LOADING: "Loading", PENDING_VERIFICATION: "Pending", VERIFIED: "Verified", SHIPPED: "Shipped",
};

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function FactoryStockAllocationV5() {
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [expandedRows, setExpandedRows]         = useState<Set<string>>(new Set());
  const [hideZero, setHideZero]                 = useState(true);
  const [filters, setFilters]                   = useState({
    product: "", customer: "", proforma: "", container: "", status: "",
  });

  /* ── Query ─────────────────────────────────────────────────────────────── */
  const params = new URLSearchParams();
  if (filters.product)   params.set("productFilter",   filters.product);
  if (filters.customer)  params.set("customerFilter",  filters.customer);
  if (filters.proforma)  params.set("proformaFilter",  filters.proforma);
  if (filters.container) params.set("containerFilter", filters.container);
  if (filters.status)    params.set("statusFilter",    filters.status);
  if (hideZero)          params.set("hideZero",        "true");

  const query = useQuery<V5Data>({
    queryKey: ["/api/factory/v5/stock-allocation", filters, hideZero],
    queryFn: async () => {
      const res = await fetch(`/api/factory/v5/stock-allocation?${params}`, { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
  });

  const rows   = query.data?.rows ?? [];
  const totals = query.data?.totals;

  function toggleRow(code: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  /* ── Article rows for the drawer ──────────────────────────────────────── */
  const drawerRows = useMemo(() => rows.map(r => ({
    articleCode:   r.articleCode,
    productName:   r.productName,
    stockAvailable: r.stockAvailable,
    totalLoaded:   r.totalLoaded,
    expectedToLoad: r.expectedToLoad,
    freeToPromise: r.freeToPromise,
  })), [rows]);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">Stock Allocation</h1>
          <Badge variant="secondary" className="text-[11px] font-semibold tracking-wide">v5</Badge>
          {totals && totals.shortageCount > 0 && (
            <Badge variant="destructive" className="text-[11px] gap-1">
              <AlertTriangle className="h-3 w-3" />
              {totals.shortageCount} shortage{totals.shortageCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant={hideZero ? "default" : "outline"}
            size="default"
            onClick={() => setHideZero(v => !v)}
            data-testid="button-v5-toggle-zero"
          >
            {hideZero ? "Show Zero Rows" : "Hide Zero Rows"}
          </Button>
          <Button size="default" onClick={() => setCreateDrawerOpen(true)} data-testid="button-v5-open-create-proforma">
            <Plus className="h-4 w-4 mr-2" />Create Proforma
          </Button>
          <Button variant="outline" size="default" onClick={() => query.refetch()} data-testid="button-v5-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search product…"
          value={filters.product}
          onChange={e => setFilters(f => ({ ...f, product: e.target.value }))}
          className="h-8 text-xs w-40"
          data-testid="input-v5-filter-product"
        />
        <Input
          placeholder="Customer…"
          value={filters.customer}
          onChange={e => setFilters(f => ({ ...f, customer: e.target.value }))}
          className="h-8 text-xs w-36"
          data-testid="input-v5-filter-customer"
        />
        <Input
          placeholder="Proforma…"
          value={filters.proforma}
          onChange={e => setFilters(f => ({ ...f, proforma: e.target.value }))}
          className="h-8 text-xs w-36"
          data-testid="input-v5-filter-proforma"
        />
        <Input
          placeholder="Container…"
          value={filters.container}
          onChange={e => setFilters(f => ({ ...f, container: e.target.value }))}
          className="h-8 text-xs w-36"
          data-testid="input-v5-filter-container"
        />
        {(filters.product || filters.customer || filters.proforma || filters.container || filters.status) && (
          <Button size="sm" variant="ghost" onClick={() => setFilters({ product: "", customer: "", proforma: "", container: "", status: "" })}>
            Clear
          </Button>
        )}
      </div>

      {/* Content */}
      {query.isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError ? (
        <div className="p-6 flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">{(query.error as Error)?.message || "Failed to load."}</p>
          <Button variant="outline" onClick={() => query.refetch()}><RefreshCw className="h-4 w-4 mr-2" />Try Again</Button>
        </div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No data found. Create a proforma with containers to use V5 stock allocation.</CardContent></Card>
      ) : (
        <div className="overflow-auto rounded-md border max-h-[calc(100vh-280px)]">
          <table className="w-full text-sm border-collapse min-w-max">
            <thead>
              <tr className="bg-muted sticky top-0 z-10">
                <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[200px]">Product</th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[120px]">
                  Stock Available
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[130px] text-amber-600 dark:text-amber-400">
                  Expected to Load
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[110px] text-blue-600 dark:text-blue-400">
                  In Loading
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[130px]">
                  <span className="flex items-center justify-end gap-1">
                    Free to Promise
                    <span className="text-[10px] font-normal text-muted-foreground">(+shortage)</span>
                  </span>
                </th>
                <th className="text-center px-3 py-2.5 font-medium border-b whitespace-nowrap min-w-[80px]">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isExpanded = expandedRows.has(row.articleCode);
                const isShortage = row.freeToPromise > 0;
                const hasContainers = row.proformaDetails.some(d => d.containers.length > 0);

                return (
                  <>
                    {/* Main product row */}
                    <tr
                      key={row.articleCode}
                      className={cn(
                        "border-b transition-colors",
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                        isShortage && "bg-destructive/5",
                      )}
                      data-testid={`row-v5-${row.articleCode}`}
                    >
                      <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                        <div className="flex items-center gap-1.5">
                          {isShortage && <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          <div>
                            <div className="font-medium text-xs leading-tight truncate max-w-[200px]" title={row.productName}>{row.productName}</div>
                            {row.productName !== row.articleCode && (
                              <div className="text-[10px] text-muted-foreground font-mono">{row.articleCode}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-xs">
                        {row.stockAvailable > 0
                          ? <span className="text-green-700 dark:text-green-400 font-medium">{row.stockAvailable}</span>
                          : <span className="text-muted-foreground/40">0</span>}
                      </td>

                      <td className={cn("px-3 py-2 border-r text-right font-mono tabular-nums text-xs", row.expectedToLoad > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/40")}>
                        {row.expectedToLoad > 0 ? row.expectedToLoad : "0"}
                      </td>

                      <td className={cn("px-3 py-2 border-r text-right font-mono tabular-nums text-xs", row.totalLoaded > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground/40")}>
                        {row.totalLoaded > 0 ? row.totalLoaded : <span className="text-muted-foreground/40">—</span>}
                      </td>

                      <td className={cn(
                        "px-3 py-2 border-r text-right font-mono tabular-nums text-xs font-semibold",
                        row.freeToPromise > 0
                          ? "text-destructive"
                          : row.freeToPromise === 0
                          ? "text-muted-foreground"
                          : "text-green-700 dark:text-green-400",
                      )}>
                        <span className="flex items-center justify-end gap-1">
                          {isShortage && <AlertTriangle className="h-3 w-3" />}
                          {row.freeToPromise}
                        </span>
                        {isShortage && (
                          <div className="text-[10px] text-destructive/80 font-normal text-right">
                            short by {row.freeToPromise}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 text-center">
                        {(row.proformaDetails.length > 0) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleRow(row.articleCode)}
                            data-testid={`button-v5-expand-${row.articleCode}`}
                            className="h-6 w-6 p-0"
                          >
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground/30 text-xs">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable detail rows */}
                    {isExpanded && row.proformaDetails.map(proforma => (
                      <tr key={`${row.articleCode}-p${proforma.proformaId}`} className="border-b bg-muted/30">
                        <td colSpan={6} className="px-0 py-0">
                          <div className="px-6 py-2">
                            {/* Proforma header */}
                            <div className="flex items-center gap-2 mb-1.5 text-xs">
                              <span className="font-semibold text-foreground">{proforma.proformaName}</span>
                              <span className="text-muted-foreground">—</span>
                              <span className="text-muted-foreground">{proforma.customerName}</span>
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                {proforma.containerCount} container{proforma.containerCount !== 1 ? "s" : ""}
                              </Badge>
                              <span className="text-muted-foreground">
                                {proforma.lineQty} × {proforma.containerCount} =
                                <span className="font-semibold text-amber-600 dark:text-amber-400 ml-1">{proforma.totalExpected} expected</span>
                              </span>
                            </div>

                            {/* Container list */}
                            {proforma.containers.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {proforma.containers.map(c => (
                                  <div
                                    key={c.orderId}
                                    className="flex items-center gap-1.5 bg-background border rounded-md px-2 py-1 text-xs"
                                    data-testid={`detail-v5-container-${c.orderId}`}
                                  >
                                    <Container className="h-3 w-3 text-muted-foreground" />
                                    <span className="font-medium">{c.containerName}</span>
                                    <Badge variant="outline" className="text-[9px] h-4 px-1">
                                      {STATUS_LABELS[c.status] ?? c.status}
                                    </Badge>
                                    <span className="text-muted-foreground">
                                      {c.loadedQty}/{c.expectedQty}
                                      {c.loadedQty < c.expectedQty && (
                                        <span className="text-amber-500 ml-1">-{c.expectedQty - c.loadedQty}</span>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted-foreground italic">No containers linked yet</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}

              {/* Totals row */}
              {totals && (
                <tr className="bg-muted font-semibold text-xs border-t-2 sticky bottom-0 z-10">
                  <td className="px-3 py-2 border-r sticky left-0 bg-muted z-20">Totals</td>
                  <td className="px-3 py-2 border-r text-right font-mono tabular-nums">
                    <span className="text-green-700 dark:text-green-400">{totals.stockAvailable}</span>
                  </td>
                  <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    {totals.expectedToLoad}
                  </td>
                  <td className="px-3 py-2 border-r text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">
                    {totals.totalLoaded > 0 ? totals.totalLoaded : "—"}
                  </td>
                  <td className={cn(
                    "px-3 py-2 border-r text-right font-mono tabular-nums",
                    totals.freeToPromise > 0 ? "text-destructive" : "text-green-700 dark:text-green-400",
                  )}>
                    {totals.freeToPromise}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Formula legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pt-1">
        <span className="font-mono bg-muted px-2 py-0.5 rounded">Free to Promise = Expected to Load − (Stock Available + In Loading)</span>
        <span className="text-destructive">Positive = shortage</span>
        <span className="text-green-700 dark:text-green-400">Negative = enough stock</span>
      </div>

      {/* Create drawer */}
      <CreateProformaV5Drawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        articleRows={drawerRows}
        onSuccess={() => query.refetch()}
      />
    </div>
  );
}
