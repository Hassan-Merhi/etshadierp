import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Package, Truck, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* ─── V2 Proforma Mode types ──────────────────────────────────────────────── */
interface StockTruthEntry {
  articleCode: string;
  onHand: number;
  inStock: number;
  inLoading: number;
  proformaReserved: number;
  reservedNotYetLoaded: number;
  freeToPromise: number;
}
interface ProformaLineV2 {
  id: number;
  articleCode: string;
  productName: string;
  quantity: number;
  alreadyLoaded: number;
  remainingToLoad: number;
}
interface ProformaV2 {
  id: number;
  customerId: number;
  customerName: string;
  name: string;
  isActive: boolean;
  lines: ProformaLineV2[];
}
interface AllocationDataV2 {
  stockTruth: StockTruthEntry[];
  proformas: ProformaV2[];
  productNames: Record<string, string>;
}

/* ─── Loading Mode types (same structure as V1) ───────────────────────────── */
interface LoadingEntry {
  id: number;
  customerId: number;
  customerName: string;
  containerNumber: string | null;
  status: string;
  balesByArticle: { articleCode: string; count: number }[];
  proformaTargets: { articleCode: string; quantity: number }[];
}
interface LoadingModeData {
  inStockCounts: { articleCode: string; count: number }[];
  freeStockCounts: { articleCode: string; count: number }[];
  loadings: LoadingEntry[];
  productNames: Record<string, string>;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export default function FactoryStockAllocationV2() {
  const [activeTab, setActiveTab] = useState<"proforma" | "loading">("proforma");
  const [visibleProformaIds, setVisibleProformaIds] = useState<Set<number>>(new Set());

  const proformaQuery = useQuery<AllocationDataV2>({
    queryKey: ["/api/factory/v2/stock-allocation"],
    queryFn: async () => {
      const res = await fetch("/api/factory/v2/stock-allocation", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
    enabled: activeTab === "proforma",
  });

  const loadingQuery = useQuery<LoadingModeData>({
    queryKey: ["/api/factory/v2/stock-allocation/loading-mode"],
    queryFn: async () => {
      const res = await fetch("/api/factory/v2/stock-allocation/loading-mode", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
    enabled: activeTab === "loading",
    refetchInterval: 10_000,
  });

  const toggleProformaVisible = (id: number) => {
    setVisibleProformaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* ── Proforma mode: backend truth drives everything ──────────────────────── */
  const proformaComputed = useMemo(() => {
    const data = proformaQuery.data;
    if (!data) return {
      articleRows: [] as (StockTruthEntry & { displayName: string })[],
      allProformas: [] as ProformaV2[],
      visibleProformas: [] as ProformaV2[],
    };

    const allProformas = data.proformas.filter(p => p.isActive);
    const visibleProformas = allProformas.filter(p => visibleProformaIds.has(p.id));

    // Build a merged set of all article codes from stock truth + all proforma lines
    const allCodes = new Set<string>([
      ...data.stockTruth.map(t => t.articleCode),
      ...allProformas.flatMap(p => p.lines.map(l => l.articleCode)),
    ]);

    // Map stock truth by article code
    const truthMap = new Map(data.stockTruth.map(t => [t.articleCode, t]));

    const articleRows = Array.from(allCodes).sort().map(code => {
      const truth = truthMap.get(code) || {
        articleCode: code, onHand: 0, inStock: 0, inLoading: 0,
        proformaReserved: 0, reservedNotYetLoaded: 0, freeToPromise: 0,
      };
      // Product name: check proforma lines first, then productNames map
      let displayName = data.productNames[code] || code;
      for (const p of allProformas) {
        const line = p.lines.find(l => l.articleCode === code);
        if (line?.productName) { displayName = line.productName; break; }
      }
      return { ...truth, displayName };
    });

    // Only show rows where there's something meaningful
    const nonEmptyRows = articleRows.filter(r =>
      r.onHand > 0 || r.proformaReserved > 0 ||
      allProformas.some(p => p.lines.some(l => l.articleCode === r.articleCode))
    );

    return { articleRows: nonEmptyRows, allProformas, visibleProformas };
  }, [proformaQuery.data, visibleProformaIds]);

  /* ── Loading mode computed ───────────────────────────────────────────────── */
  const loadingComputed = useMemo(() => {
    const data = loadingQuery.data;
    if (!data) return { articleRows: [], loadings: [] as LoadingEntry[] };

    const totalStockMap = new Map(data.inStockCounts.map(s => [s.articleCode, s.count]));
    const freeStockMap = new Map((data.freeStockCounts || []).map(s => [s.articleCode, s.count]));

    const articleCodeSet = new Set<string>();
    data.inStockCounts.forEach(s => articleCodeSet.add(s.articleCode));
    data.loadings.forEach(l => {
      l.balesByArticle.forEach(b => articleCodeSet.add(b.articleCode));
      l.proformaTargets.forEach(t => articleCodeSet.add(t.articleCode));
    });

    const articleRows = Array.from(articleCodeSet).sort().map(articleCode => {
      const inStock = totalStockMap.get(articleCode) || 0;
      const remaining = freeStockMap.get(articleCode) || 0;
      const displayName = data.productNames[articleCode] || articleCode;
      return { articleCode, displayName, inStock, remaining };
    });

    const nonEmptyRows = articleRows.filter(r =>
      r.inStock > 0 ||
      data.loadings.some(l =>
        l.balesByArticle.some(b => b.articleCode === r.articleCode) ||
        l.proformaTargets.some(t => t.articleCode === r.articleCode)
      )
    );

    return { articleRows: nonEmptyRows, loadings: data.loadings };
  }, [loadingQuery.data]);

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">Stock Allocation</h1>
          <Badge variant="secondary" className="text-[11px] font-semibold tracking-wide">v2</Badge>
        </div>
        <Button
          variant="outline"
          size="default"
          onClick={() => activeTab === "proforma" ? proformaQuery.refetch() : loadingQuery.refetch()}
          data-testid="button-refresh-allocation"
        >
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "proforma" | "loading")} className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="proforma" className="gap-2" data-testid="tab-proforma-mode">
            <Package className="h-4 w-4" />
            Proforma Mode
          </TabsTrigger>
          <TabsTrigger value="loading" className="gap-2" data-testid="tab-loading-mode">
            <Truck className="h-4 w-4" />
            Loading Mode
          </TabsTrigger>
        </TabsList>

        {/* ── PROFORMA TAB ─────────────────────────────────────────────────── */}
        <TabsContent value="proforma" className="flex flex-col flex-1 min-h-0 gap-4 mt-4">
          {proformaQuery.isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : proformaQuery.isError ? (
            <div className="p-6 flex flex-col items-center justify-center h-48 gap-4">
              <p className="text-muted-foreground text-sm">{(proformaQuery.error as Error)?.message || "Failed to load."}</p>
              <Button variant="outline" onClick={() => proformaQuery.refetch()}><RefreshCw className="h-4 w-4 mr-2" />Try Again</Button>
            </div>
          ) : (
            <>
              {/* Proforma column toggles */}
              {proformaComputed.allProformas.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground font-medium">Show proforma columns:</p>
                  <div className="flex flex-wrap gap-2">
                    {proformaComputed.allProformas.map(p => {
                      const isOn = visibleProformaIds.has(p.id);
                      return (
                        <Button
                          key={p.id}
                          variant={isOn ? "default" : "outline"}
                          size="sm"
                          onClick={() => toggleProformaVisible(p.id)}
                          data-testid={`button-proforma-toggle-${p.id}`}
                          className="flex flex-col h-auto py-1.5 px-3 items-start gap-0"
                        >
                          <span className="text-xs font-semibold leading-tight">{p.customerName}</span>
                          <span className={cn("text-[10px] leading-tight", isOn ? "text-primary-foreground/70" : "text-muted-foreground")}>
                            {p.name}
                          </span>
                          {!p.isActive && (
                            <span className={cn("text-[10px] leading-tight", isOn ? "text-primary-foreground/60" : "text-muted-foreground/60")}>
                              inactive
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {proformaComputed.allProformas.length === 0 && proformaComputed.articleRows.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground">No proformas found. Create a proforma first to use stock allocation.</CardContent></Card>
              ) : proformaComputed.articleRows.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground">No article codes found in stock or proformas.</CardContent></Card>
              ) : (
                <div className="overflow-auto rounded-md border max-h-[calc(100vh-320px)]">
                  <table className="w-full text-sm border-collapse min-w-max">
                    <thead>
                      <tr className="bg-muted sticky top-0 z-10">
                        <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[200px]">Product</th>

                        {/* On Hand = IN_STOCK + In Loading (full physical pool) */}
                        <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">
                          <span className="flex items-center justify-end gap-1">
                            On Hand
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                                Total physical bales still in the warehouse pool — includes both free stock and bales already assigned to active loading orders.<br />
                                <span className="font-mono mt-1 block">= Free stock + In Loading</span>
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </th>

                        {/* Reserved = proforma qty not yet loaded */}
                        <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[95px] text-amber-600 dark:text-amber-400">
                          <span className="flex items-center justify-end gap-1">
                            Reserved
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-amber-400 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                                Total quantity committed to active proformas but not yet physically loaded. Decreases as bales are scanned into loading orders.<br />
                                <span className="font-mono mt-1 block">= Proforma qty − Already loaded</span>
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </th>

                        {/* In Loading = bales physically in active loading orders */}
                        <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[95px] text-blue-600 dark:text-blue-400">
                          <span className="flex items-center justify-end gap-1">
                            In Loading
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-blue-400 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                                Bales already scanned into active loading orders (status: Loading or Pending Verification). Still counted in On Hand until the shipment is finalised.
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </th>

                        {/* Free to Promise = On Hand − Reserved − In Loading */}
                        <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[115px] text-green-700 dark:text-green-400">
                          <span className="flex items-center justify-end gap-1">
                            Free to Promise
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Info className="h-3 w-3 text-green-500 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                                Stock available to commit to new proformas. Proforma column toggles never affect this value — it is computed entirely on the server.<br />
                                <span className="font-mono mt-1 block">= On Hand − Reserved − In Loading</span>
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        </th>
                        {/* Proforma columns — show per-proforma line qty + progress */}
                        {proformaComputed.visibleProformas.map(p => (
                          <th key={p.id} className="px-2 py-1.5 font-medium border-b border-r text-center min-w-[140px]">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-xs font-semibold truncate max-w-[130px]" title={p.customerName}>{p.customerName}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[130px]" title={p.name}>{p.name}</span>
                              {!p.isActive && <Badge variant="outline" className="text-[10px] px-1">Inactive</Badge>}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {proformaComputed.articleRows.map((row, idx) => (
                        <tr
                          key={row.articleCode}
                          className={cn("border-b transition-colors", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}
                          data-testid={`row-article-${row.articleCode}`}
                        >
                          <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                            <div className="font-medium truncate max-w-[220px]" title={row.displayName}>{row.displayName}</div>
                            {row.displayName !== row.articleCode && (
                              <div className="text-xs text-muted-foreground font-mono">{row.articleCode}</div>
                            )}
                          </td>

                          {/* On Hand = free stock + in loading */}
                          <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                            {row.onHand}
                          </td>

                          {/* Reserved = proforma qty not yet loaded */}
                          <td className={cn(
                            "px-3 py-2 text-right border-r font-mono tabular-nums",
                            row.reservedNotYetLoaded > 0 ? "text-amber-600 dark:text-amber-400" : "",
                          )}>
                            {row.reservedNotYetLoaded > 0 ? row.reservedNotYetLoaded : <span className="text-muted-foreground/40 text-xs">—</span>}
                          </td>

                          {/* In Loading = bales in active loading orders */}
                          <td className={cn(
                            "px-3 py-2 text-right border-r font-mono tabular-nums",
                            row.inLoading > 0 ? "text-blue-600 dark:text-blue-400" : "",
                          )}>
                            {row.inLoading > 0 ? row.inLoading : <span className="text-muted-foreground/40 text-xs">—</span>}
                          </td>

                          {/* Free to Promise = On Hand − Reserved − In Loading (server-computed) */}
                          <td className={cn(
                            "px-3 py-2 text-right border-r font-mono tabular-nums font-semibold",
                            row.freeToPromise > 0 ? "text-green-700 dark:text-green-400"
                              : row.freeToPromise === 0 ? "text-muted-foreground"
                              : "text-destructive",
                          )}>
                            {row.freeToPromise}
                          </td>

                          {/* Per-proforma detail: target / loaded / remaining */}
                          {proformaComputed.visibleProformas.map(p => {
                            const line = p.lines.find(l => l.articleCode === row.articleCode);
                            if (!line) return (
                              <td key={p.id} className="px-2 py-2 text-center border-r bg-muted/30">
                                <span className="text-muted-foreground/40 text-xs">—</span>
                              </td>
                            );
                            const done = line.remainingToLoad <= 0;
                            return (
                              <td key={p.id} className="px-2 py-2 text-center border-r">
                                <span className={cn(
                                  "font-semibold font-mono tabular-nums",
                                  done ? "text-green-700 dark:text-green-400" : "text-foreground",
                                )}>
                                  {line.quantity}
                                </span>
                                {line.alreadyLoaded > 0 && (
                                  <div className="text-[10px] text-muted-foreground/60">
                                    {line.alreadyLoaded} loaded · {line.remainingToLoad} left
                                  </div>
                                )}
                                {line.alreadyLoaded === 0 && (
                                  <div className="text-[10px] text-muted-foreground/60">bales</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── LOADING TAB ──────────────────────────────────────────────────── */}
        <TabsContent value="loading" className="flex flex-col flex-1 min-h-0 gap-4 mt-4">
          {loadingQuery.isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : loadingQuery.isError ? (
            <div className="p-6 flex flex-col items-center justify-center h-48 gap-4">
              <p className="text-muted-foreground text-sm">{(loadingQuery.error as Error)?.message || "Failed to load."}</p>
              <Button variant="outline" onClick={() => loadingQuery.refetch()}><RefreshCw className="h-4 w-4 mr-2" />Try Again</Button>
            </div>
          ) : loadingComputed.loadings.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No active loadings. Containers currently in <strong>Loading</strong> or <strong>Pending Verification</strong> status will appear here automatically.
              </CardContent>
            </Card>
          ) : loadingComputed.articleRows.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Active loadings found but no bales have been scanned yet.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  Live — updates every 10 seconds
                </div>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{loadingComputed.loadings.length} active loading{loadingComputed.loadings.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="overflow-auto rounded-md border max-h-[calc(100vh-260px)]">
                <table className="w-full text-sm border-collapse min-w-max">
                  <thead>
                    <tr className="bg-muted sticky top-0 z-10">
                      <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted z-20 min-w-[200px]">Product</th>
                      <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">In Stock</th>
                      <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[100px] text-amber-600 dark:text-amber-400">Remaining</th>
                      {loadingComputed.loadings.map(l => (
                        <th key={l.id} className="px-2 py-1.5 font-medium border-b border-r text-center min-w-[140px]">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-xs font-semibold truncate max-w-[130px]" title={l.customerName}>{l.customerName}</span>
                            {l.containerNumber ? (
                              <span className="text-xs text-muted-foreground font-mono truncate max-w-[130px]">{l.containerNumber}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Order #{l.id}</span>
                            )}
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 mt-0.5",
                              l.status === "LOADING" ? "border-blue-400 text-blue-600 dark:text-blue-400"
                                : "border-amber-400 text-amber-600 dark:text-amber-400"
                            )}>
                              {l.status === "LOADING" ? "Loading" : "Pending Verify"}
                            </Badge>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loadingComputed.articleRows.map((row, idx) => (
                      <tr
                        key={row.articleCode}
                        className={cn("border-b transition-colors", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}
                        data-testid={`row-loading-${row.articleCode}`}
                      >
                        <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                          <div className="font-medium truncate max-w-[220px]" title={row.displayName}>{row.displayName}</div>
                          {row.displayName !== row.articleCode && (
                            <div className="text-xs text-muted-foreground font-mono">{row.articleCode}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right border-r font-mono tabular-nums">{row.inStock}</td>
                        <td className={cn(
                          "px-3 py-2 text-right border-r font-mono tabular-nums font-semibold",
                          row.remaining > 0 ? "text-green-700 dark:text-green-400"
                            : row.remaining === 0 ? "text-muted-foreground"
                            : "text-destructive",
                        )}>
                          {row.remaining}
                        </td>
                        {loadingComputed.loadings.map(l => {
                          const target  = l.proformaTargets.find(t => t.articleCode === row.articleCode);
                          const scanned = l.balesByArticle.find(b => b.articleCode === row.articleCode);

                          if (!target && !scanned) return (
                            <td key={l.id} className="px-2 py-2 text-center border-r bg-muted/30">
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            </td>
                          );

                          const targetQty  = target?.quantity ?? 0;
                          const scannedQty = scanned?.count ?? 0;
                          const stillNeeded = targetQty - scannedQty;

                          if (stillNeeded < 0) return (
                            <td key={l.id} className="px-2 py-2 text-center border-r">
                              <span className="font-semibold font-mono tabular-nums text-destructive">{stillNeeded}</span>
                              <div className="text-[10px] text-destructive/70">overloaded</div>
                            </td>
                          );
                          if (stillNeeded === 0) return (
                            <td key={l.id} className="px-2 py-2 text-center border-r">
                              <span className="font-semibold font-mono tabular-nums text-green-700 dark:text-green-400">0</span>
                              <div className="text-[10px] text-green-700/70 dark:text-green-400/70">done</div>
                            </td>
                          );
                          return (
                            <td key={l.id} className="px-2 py-2 text-center border-r">
                              <span className="font-semibold font-mono tabular-nums text-amber-600 dark:text-amber-400">{stillNeeded}</span>
                              <div className="text-[10px] text-muted-foreground/60">needed</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
