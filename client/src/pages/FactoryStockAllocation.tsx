import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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

interface InStockCount {
  articleCode: string;
  count: number;
}

interface Reservation {
  id: number;
  proformaId: number;
  articleCode: string;
}

interface ActiveOrderBale {
  articleCode: string;
  count: number;
}

interface ActiveOrder {
  id: number;
  proformaIdUsed: number | null;
  status: string;
  balesByArticle: ActiveOrderBale[];
}

interface AllocationData {
  proformas: Proforma[];
  inStockCounts: InStockCount[];
  reservations: Reservation[];
  activeOrders: ActiveOrder[];
}

const STATUS_LABEL: Record<string, string> = {
  LOADING: "Loading",
  PENDING_VERIFICATION: "Pending Verify",
  VERIFIED: "Verified",
};

const STATUS_COLOR: Record<string, string> = {
  LOADING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  PENDING_VERIFICATION: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  VERIFIED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
};

export default function FactoryStockAllocation() {
  const { toast } = useToast();
  const [toggling, setToggling] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<AllocationData>({
    queryKey: ["/api/factory/stock-allocation"],
    queryFn: async () => {
      const res = await fetch("/api/factory/stock-allocation", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ proformaId, articleCode }: { proformaId: number; articleCode: string }) => {
      const res = await apiRequest("POST", "/api/factory/stock-allocation/reservations/toggle", { proformaId, articleCode });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/stock-allocation"] });
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
    onSettled: () => setToggling(null),
  });

  const handleToggle = (proformaId: number, articleCode: string) => {
    const key = `${proformaId}:${articleCode}`;
    if (toggling) return;
    setToggling(key);
    toggleMutation.mutate({ proformaId, articleCode });
  };

  // Derive the matrix data
  const { articleRows, proformas, reservationSet, pendingByProformaArticle } = useMemo(() => {
    if (!data) return { articleRows: [], proformas: [], reservationSet: new Set<string>(), pendingByProformaArticle: new Map<string, number>() };

    const proformas = data.proformas;

    // All article codes that appear in any proforma line OR have IN_STOCK bales
    const articleCodeSet = new Set<string>();
    proformas.forEach(p => p.lines.forEach(l => articleCodeSet.add(l.articleCode)));
    data.inStockCounts.forEach(s => articleCodeSet.add(s.articleCode));

    const inStockMap = new Map(data.inStockCounts.map(s => [s.articleCode, s.count]));

    // Build reservation set: "proformaId:articleCode"
    const reservationSet = new Set(data.reservations.map(r => `${r.proformaId}:${r.articleCode}`));

    // Build pending loading map: "proformaId:articleCode" → count
    // pending = any LOADING/PENDING_VERIFICATION/VERIFIED order linked to a proforma
    const pendingByProformaArticle = new Map<string, number>();
    data.activeOrders.forEach(order => {
      if (!order.proformaIdUsed) return;
      order.balesByArticle.forEach(b => {
        const key = `${order.proformaIdUsed}:${b.articleCode}`;
        pendingByProformaArticle.set(key, (pendingByProformaArticle.get(key) || 0) + b.count);
      });
    });

    // Build article rows sorted alphabetically
    const articleRows = Array.from(articleCodeSet).sort().map(articleCode => {
      const inStock = inStockMap.get(articleCode) || 0;

      // Reserved: sum of proforma line quantities where reservation is ON (and not already pending)
      let reserved = 0;
      let pendingLoading = 0;

      proformas.forEach(p => {
        const line = p.lines.find(l => l.articleCode === articleCode);
        if (!line) return;
        const isReserved = reservationSet.has(`${p.id}:${articleCode}`);
        const pendingQty = pendingByProformaArticle.get(`${p.id}:${articleCode}`) || 0;
        pendingLoading += pendingQty;
        if (isReserved) {
          // If pending, deduct pending from reserved count (pending takes priority)
          reserved += Math.max(0, line.quantity - pendingQty);
        }
      });

      const available = Math.max(0, inStock - reserved - pendingLoading);

      return { articleCode, inStock, reserved, pendingLoading, available };
    });

    return { articleRows, proformas, reservationSet, pendingByProformaArticle };
  }, [data]);

  // Find the product name for an article code
  const getProductName = (articleCode: string) => {
    if (!data) return articleCode;
    for (const p of data.proformas) {
      const line = p.lines.find(l => l.articleCode === articleCode);
      if (line) return line.productName;
    }
    return articleCode;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground text-sm">
          {(error as Error)?.message || "Failed to load stock allocation data."}
        </p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Stock Allocation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Toggle proforma columns to reserve stock. Pending loadings are automatically highlighted.
          </p>
        </div>
        <Button variant="outline" size="default" onClick={() => refetch()} data-testid="button-refresh-allocation">
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-primary/20 border border-primary/40" />
          <span>Reserved (toggled ON)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-800/60 border border-amber-400/60" />
          <span>Pending / Loading</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-muted border border-border" />
          <span>Not in proforma</span>
        </div>
      </div>

      {proformas.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No proformas found. Create a proforma first to use stock allocation.
          </CardContent>
        </Card>
      ) : articleRows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No article codes found. Add lines to your proformas or enter bales into stock.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border flex-1">
          <table className="w-full text-sm border-collapse min-w-max">
            <thead>
              <tr className="bg-muted/50 sticky top-0 z-10">
                <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted/80 backdrop-blur-sm z-20 min-w-[160px]">
                  Article Code
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">
                  In Stock
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">
                  Reserved
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[110px]">
                  <div className="flex items-center justify-end gap-1">
                    Pending
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Bales currently in active loadings (LOADING / VERIFIED)</TooltipContent>
                    </Tooltip>
                  </div>
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px] text-green-700 dark:text-green-400">
                  Available
                </th>
                {/* Proforma columns */}
                {proformas.map(p => (
                  <th key={p.id} className="px-2 py-1.5 font-medium border-b border-r text-center min-w-[130px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xs font-semibold truncate max-w-[120px]" title={p.customerName}>{p.customerName}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[120px]" title={p.name}>{p.name}</span>
                      {!p.isActive && (
                        <Badge variant="outline" className="text-[10px] px-1">Inactive</Badge>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {articleRows.map((row, idx) => (
                <tr
                  key={row.articleCode}
                  className={cn(
                    "border-b transition-colors",
                    idx % 2 === 0 ? "bg-background" : "bg-muted/20",
                  )}
                  data-testid={`row-article-${row.articleCode}`}
                >
                  {/* Article code */}
                  <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                    <div className="font-medium">{row.articleCode}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[140px]">{getProductName(row.articleCode)}</div>
                  </td>
                  {/* In Stock */}
                  <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                    {row.inStock}
                  </td>
                  {/* Reserved */}
                  <td className="px-3 py-2 text-right border-r font-mono tabular-nums text-muted-foreground">
                    {row.reserved > 0 ? (
                      <span className="text-foreground font-medium">{row.reserved}</span>
                    ) : "—"}
                  </td>
                  {/* Pending */}
                  <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                    {row.pendingLoading > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400 font-medium">{row.pendingLoading}</span>
                    ) : "—"}
                  </td>
                  {/* Available */}
                  <td className={cn(
                    "px-3 py-2 text-right border-r font-mono tabular-nums font-semibold",
                    row.available > 0 ? "text-green-700 dark:text-green-400" : "text-destructive",
                  )}>
                    {row.available}
                  </td>

                  {/* Per-proforma cells */}
                  {proformas.map(p => {
                    const line = p.lines.find(l => l.articleCode === row.articleCode);
                    const reservationKey = `${p.id}:${row.articleCode}`;
                    const isReserved = reservationSet.has(reservationKey);
                    const isPending = (pendingByProformaArticle.get(reservationKey) || 0) > 0;
                    const pendingQty = pendingByProformaArticle.get(reservationKey) || 0;
                    const isTogglingThis = toggling === reservationKey;

                    if (!line) {
                      // Article not in this proforma
                      return (
                        <td key={p.id} className="px-2 py-2 text-center border-r bg-muted/30">
                          <span className="text-muted-foreground/40 text-xs">—</span>
                        </td>
                      );
                    }

                    if (isPending) {
                      // Pending/loading — auto-highlight, no toggle
                      return (
                        <td key={p.id} className="px-2 py-2 text-center border-r bg-amber-50 dark:bg-amber-900/20">
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge className={cn("text-xs font-semibold", STATUS_COLOR[data.activeOrders.find(o => o.proformaIdUsed === p.id)?.status || "LOADING"] || STATUS_COLOR.LOADING)}>
                              {pendingQty} bales
                            </Badge>
                            <span className="text-[10px] text-amber-700 dark:text-amber-400">
                              {STATUS_LABEL[data.activeOrders.find(o => o.proformaIdUsed === p.id)?.status || "LOADING"] || "Loading"}
                            </span>
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td
                        key={p.id}
                        className={cn(
                          "px-2 py-2 text-center border-r cursor-pointer transition-colors select-none",
                          isReserved
                            ? "bg-primary/10 hover-elevate"
                            : "hover-elevate",
                          isTogglingThis && "opacity-50 pointer-events-none",
                        )}
                        onClick={() => handleToggle(p.id, row.articleCode)}
                        data-testid={`cell-reserve-${p.id}-${row.articleCode}`}
                        title={isReserved ? `Click to un-reserve ${line.quantity} bales` : `Click to reserve ${line.quantity} bales`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          {isTogglingThis ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : (
                            <>
                              <span className={cn(
                                "font-semibold font-mono tabular-nums",
                                isReserved ? "text-primary" : "text-muted-foreground",
                              )}>
                                {line.quantity}
                              </span>
                              <span className={cn(
                                "text-[10px]",
                                isReserved ? "text-primary/70" : "text-muted-foreground/60",
                              )}>
                                {isReserved ? "reserved" : "not reserved"}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary cards */}
      {articleRows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total In Stock</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold tabular-nums">
                {articleRows.reduce((s, r) => s + r.inStock, 0)}
              </p>
              <p className="text-xs text-muted-foreground">bales across {articleRows.filter(r => r.inStock > 0).length} articles</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Reserved</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold tabular-nums">
                {articleRows.reduce((s, r) => s + r.reserved, 0)}
              </p>
              <p className="text-xs text-muted-foreground">allocated to proformas</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-amber-700 dark:text-amber-400">Pending Loading</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
                {articleRows.reduce((s, r) => s + r.pendingLoading, 0)}
              </p>
              <p className="text-xs text-muted-foreground">in active loadings</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-green-700 dark:text-green-400">Available</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <p className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-400">
                {articleRows.reduce((s, r) => s + r.available, 0)}
              </p>
              <p className="text-xs text-muted-foreground">free to allocate</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
