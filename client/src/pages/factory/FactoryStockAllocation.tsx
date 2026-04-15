import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* ─── Proforma Mode types ─────────────────────────────────────── */
interface ProformaLine {
  id: number;
  proformaId: number;
  articleCode: string;
  productName: string;
  quantity: number;
}
interface Proforma {
  id: number;
  customerId: number;
  customerName: string;
  name: string;
  isActive: boolean;
  lines: ProformaLine[];
}
interface AllocationData {
  proformas: Proforma[];
  inStockCounts: { articleCode: string; count: number }[];
  reservations: any[];
  activeOrders: any[];
}

/* ─── Loading Mode types ──────────────────────────────────────── */
interface LoadingEntry {
  id: number;
  customerId: number;
  customerName: string;
  containerNumber: string | null;
  status: string;
  balesByArticle: { articleCode: string; count: number }[];
}
interface LoadingModeData {
  inStockCounts: { articleCode: string; count: number }[];
  loadings: LoadingEntry[];
  productNames: Record<string, string>;
}

/* ═══════════════════════════════════════════════════════════════ */
export default function FactoryStockAllocation() {
  const [activeTab, setActiveTab] = useState<"proforma" | "loading">("proforma");
  const [visibleProformaIds, setVisibleProformaIds] = useState<Set<number>>(new Set());

  /* ── Proforma Mode query ─────────────────────────────────────── */
  const proformaQuery = useQuery<AllocationData>({
    queryKey: ["/api/factory/stock-allocation"],
    queryFn: async () => {
      const res = await fetch("/api/factory/stock-allocation", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
    enabled: activeTab === "proforma",
  });

  /* ── Loading Mode query — auto-refreshes every 20 s ─────────── */
  const loadingQuery = useQuery<LoadingModeData>({
    queryKey: ["/api/factory/stock-allocation/loading-mode"],
    queryFn: async () => {
      const res = await fetch("/api/factory/stock-allocation/loading-mode", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
    enabled: activeTab === "loading",
    refetchInterval: 20_000,
  });

  const toggleProformaVisible = (id: number) => {
    setVisibleProformaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* ── Proforma mode computed rows ────────────────────────────── */
  const proformaComputed = useMemo(() => {
    const data = proformaQuery.data;
    if (!data) return { articleRows: [], allProformas: [], visibleProformas: [], productNameByCode: new Map<string, string>() };

    const allProformas = data.proformas;
    const visibleProformas = allProformas.filter(p => visibleProformaIds.has(p.id));
    const inStockMap = new Map(data.inStockCounts.map(s => [s.articleCode, s.count]));

    const productNameByCode = new Map<string, string>();
    allProformas.forEach(p => p.lines.forEach(l => { if (l.productName) productNameByCode.set(l.articleCode, l.productName); }));

    const articleCodeSet = new Set<string>();
    allProformas.forEach(p => p.lines.forEach(l => articleCodeSet.add(l.articleCode)));
    data.inStockCounts.forEach(s => articleCodeSet.add(s.articleCode));

    const articleRows = Array.from(articleCodeSet).sort().map(articleCode => {
      const inStock = inStockMap.get(articleCode) || 0;
      let proformaTotal = 0;
      visibleProformas.forEach(p => { const line = p.lines.find(l => l.articleCode === articleCode); if (line) proformaTotal += line.quantity; });
      return { articleCode, inStock, available: inStock - proformaTotal };
    });

    return { articleRows, allProformas, visibleProformas, productNameByCode };
  }, [proformaQuery.data, visibleProformaIds]);

  /* ── Loading mode computed rows ─────────────────────────────── */
  const loadingComputed = useMemo(() => {
    const data = loadingQuery.data;
    if (!data) return { articleRows: [], loadings: [] };

    const inStockMap = new Map(data.inStockCounts.map(s => [s.articleCode, s.count]));

    // All article codes across in-stock + all loadings
    const articleCodeSet = new Set<string>();
    data.inStockCounts.forEach(s => articleCodeSet.add(s.articleCode));
    data.loadings.forEach(l => l.balesByArticle.forEach(b => articleCodeSet.add(b.articleCode)));

    const articleRows = Array.from(articleCodeSet).sort().map(articleCode => {
      const inStock = inStockMap.get(articleCode) || 0;
      const totalLoaded = data.loadings.reduce((sum, l) => {
        const b = l.balesByArticle.find(b => b.articleCode === articleCode);
        return sum + (b ? b.count : 0);
      }, 0);
      const remaining = inStock - totalLoaded;
      const displayName = data.productNames[articleCode] || articleCode;
      return { articleCode, displayName, inStock, totalLoaded, remaining };
    });

    // Only show rows where there's something to display
    const nonEmptyRows = articleRows.filter(r => r.inStock > 0 || r.totalLoaded > 0);

    return { articleRows: nonEmptyRows, loadings: data.loadings };
  }, [loadingQuery.data]);

  /* ── Shared header ───────────────────────────────────────────── */
  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Stock Allocation</h1>
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

        {/* ── PROFORMA TAB ──────────────────────────────────────── */}
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

              {proformaComputed.allProformas.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground">No proformas found. Create a proforma first to use stock allocation.</CardContent></Card>
              ) : proformaComputed.articleRows.length === 0 ? (
                <Card><CardContent className="p-8 text-center text-muted-foreground">No article codes found. Add lines to your proformas or enter bales into stock.</CardContent></Card>
              ) : (
                <div className="overflow-auto rounded-md border flex-1">
                  <table className="w-full text-sm border-collapse min-w-max">
                    <thead>
                      <tr className="bg-muted/50 sticky top-0 z-10">
                        <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted/80 backdrop-blur-sm z-20 min-w-[200px]">Product</th>
                        <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">In Stock</th>
                        <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px] text-green-700 dark:text-green-400">Available</th>
                        {proformaComputed.visibleProformas.map(p => (
                          <th key={p.id} className="px-2 py-1.5 font-medium border-b border-r text-center min-w-[130px]">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-xs font-semibold truncate max-w-[120px]" title={p.customerName}>{p.customerName}</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[120px]" title={p.name}>{p.name}</span>
                              {!p.isActive && <Badge variant="outline" className="text-[10px] px-1">Inactive</Badge>}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {proformaComputed.articleRows.map((row, idx) => {
                        const displayName = proformaComputed.productNameByCode.get(row.articleCode) || row.articleCode;
                        return (
                          <tr key={row.articleCode} className={cn("border-b transition-colors", idx % 2 === 0 ? "bg-background" : "bg-muted/20")} data-testid={`row-article-${row.articleCode}`}>
                            <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                              <div className="font-medium truncate max-w-[220px]" title={displayName}>{displayName}</div>
                            </td>
                            <td className="px-3 py-2 text-right border-r font-mono tabular-nums">{row.inStock}</td>
                            <td className={cn("px-3 py-2 text-right border-r font-mono tabular-nums font-semibold",
                              row.available > 0 ? "text-green-700 dark:text-green-400" : row.available === 0 ? "text-muted-foreground" : "text-destructive",
                            )}>{row.available}</td>
                            {proformaComputed.visibleProformas.map(p => {
                              const line = p.lines.find(l => l.articleCode === row.articleCode);
                              if (!line) return (
                                <td key={p.id} className="px-2 py-2 text-center border-r bg-muted/30">
                                  <span className="text-muted-foreground/40 text-xs">—</span>
                                </td>
                              );
                              return (
                                <td key={p.id} className="px-2 py-2 text-center border-r">
                                  <span className="font-semibold font-mono tabular-nums text-foreground">{line.quantity}</span>
                                  <div className="text-[10px] text-muted-foreground/60">bales</div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── LOADING TAB ───────────────────────────────────────── */}
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
              {/* Auto-refresh badge */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  Live — updates every 20 seconds
                </div>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{loadingComputed.loadings.length} active loading{loadingComputed.loadings.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="overflow-auto rounded-md border flex-1">
                <table className="w-full text-sm border-collapse min-w-max">
                  <thead>
                    <tr className="bg-muted/50 sticky top-0 z-10">
                      <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted/80 backdrop-blur-sm z-20 min-w-[200px]">
                        Product
                      </th>
                      <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">
                        In Stock
                      </th>
                      <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[100px] text-amber-600 dark:text-amber-400">
                        Remaining
                      </th>
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
                        {/* Product name */}
                        <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                          <div className="font-medium truncate max-w-[220px]" title={row.displayName}>{row.displayName}</div>
                        </td>

                        {/* In Stock */}
                        <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                          {row.inStock}
                        </td>

                        {/* Remaining */}
                        <td className={cn(
                          "px-3 py-2 text-right border-r font-mono tabular-nums font-semibold",
                          row.remaining > 0 ? "text-green-700 dark:text-green-400"
                            : row.remaining === 0 ? "text-muted-foreground"
                            : "text-destructive",
                        )}>
                          {row.remaining}
                        </td>

                        {/* Per-loading bale count cells */}
                        {loadingComputed.loadings.map(l => {
                          const b = l.balesByArticle.find(b => b.articleCode === row.articleCode);
                          if (!b) return (
                            <td key={l.id} className="px-2 py-2 text-center border-r bg-muted/30">
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            </td>
                          );
                          return (
                            <td key={l.id} className="px-2 py-2 text-center border-r">
                              <span className="font-semibold font-mono tabular-nums text-foreground">{b.count}</span>
                              <div className="text-[10px] text-muted-foreground/60">bales</div>
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
