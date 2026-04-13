import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  reservations: any[];
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
  const [visibleProformaIds, setVisibleProformaIds] = useState<Set<number>>(new Set());

  const { data, isLoading, isError, error, refetch } = useQuery<AllocationData>({
    queryKey: ["/api/factory/stock-allocation"],
    queryFn: async () => {
      const res = await fetch("/api/factory/stock-allocation", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    retry: 1,
  });

  const toggleProformaVisible = (id: number) => {
    setVisibleProformaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { articleRows, allProformas, visibleProformas, pendingByProformaArticle, productNameByCode } = useMemo(() => {
    if (!data) return {
      articleRows: [],
      allProformas: [],
      visibleProformas: [],
      pendingByProformaArticle: new Map<string, number>(),
      productNameByCode: new Map<string, string>(),
    };

    const allProformas = data.proformas;
    const visibleProformas = allProformas.filter(p => visibleProformaIds.has(p.id));

    const inStockMap = new Map(data.inStockCounts.map(s => [s.articleCode, s.count]));

    // Build product name lookup from all proforma lines
    const productNameByCode = new Map<string, string>();
    allProformas.forEach(p => p.lines.forEach(l => {
      if (l.productName) productNameByCode.set(l.articleCode, l.productName);
    }));

    // Pending map: "proformaId:articleCode" → bale count
    const pendingByProformaArticle = new Map<string, number>();
    data.activeOrders.forEach(order => {
      if (!order.proformaIdUsed) return;
      order.balesByArticle.forEach(b => {
        const key = `${order.proformaIdUsed}:${b.articleCode}`;
        pendingByProformaArticle.set(key, (pendingByProformaArticle.get(key) || 0) + b.count);
      });
    });

    // All article codes from any proforma + in-stock bales
    const articleCodeSet = new Set<string>();
    allProformas.forEach(p => p.lines.forEach(l => articleCodeSet.add(l.articleCode)));
    data.inStockCounts.forEach(s => articleCodeSet.add(s.articleCode));

    const articleRows = Array.from(articleCodeSet).sort().map(articleCode => {
      const inStock = inStockMap.get(articleCode) || 0;

      // Pending across ALL proformas for this article
      let pendingLoading = 0;
      allProformas.forEach(p => {
        pendingLoading += pendingByProformaArticle.get(`${p.id}:${articleCode}`) || 0;
      });

      const available = inStock - pendingLoading;
      return { articleCode, inStock, pendingLoading, available };
    });

    return { articleRows, allProformas, visibleProformas, pendingByProformaArticle, productNameByCode };
  }, [data, visibleProformaIds]);

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

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">Stock Allocation</h1>
        <Button variant="outline" size="default" onClick={() => refetch()} data-testid="button-refresh-allocation">
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Proforma selector */}
      {allProformas.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground font-medium">Show proforma columns:</p>
          <div className="flex flex-wrap gap-2">
            {allProformas.map(p => {
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

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-800/60 border border-amber-400/60" />
          <span>Pending / Loading</span>
        </div>
      </div>

      {allProformas.length === 0 ? (
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
                <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted/80 backdrop-blur-sm z-20 min-w-[180px]">
                  Product
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">
                  In Stock
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[110px]">
                  <div className="flex items-center justify-end gap-1">
                    Pending
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Bales currently in active loadings (Loading / Verified)</TooltipContent>
                    </Tooltip>
                  </div>
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px] text-green-700 dark:text-green-400">
                  Available
                </th>
                {visibleProformas.map(p => (
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
              {articleRows.map((row, idx) => {
                const displayName = productNameByCode.get(row.articleCode) || row.articleCode;
                return (
                  <tr
                    key={row.articleCode}
                    className={cn("border-b transition-colors", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}
                    data-testid={`row-article-${row.articleCode}`}
                  >
                    {/* Product name */}
                    <td className="px-3 py-2 border-r sticky left-0 bg-inherit z-10">
                      <div className="font-medium truncate max-w-[200px]" title={displayName}>{displayName}</div>
                    </td>

                    {/* In Stock */}
                    <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                      {row.inStock}
                    </td>

                    {/* Pending */}
                    <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                      {row.pendingLoading > 0
                        ? <span className="text-amber-700 dark:text-amber-400 font-medium">{row.pendingLoading}</span>
                        : <span className="text-muted-foreground/50">—</span>}
                    </td>

                    {/* Available */}
                    <td className={cn(
                      "px-3 py-2 text-right border-r font-mono tabular-nums font-semibold",
                      row.available > 0 ? "text-green-700 dark:text-green-400"
                        : row.available === 0 ? "text-muted-foreground"
                        : "text-destructive",
                    )}>
                      {row.available}
                    </td>

                    {/* Per-proforma quantity cells (read-only) */}
                    {visibleProformas.map(p => {
                      const line = p.lines.find(l => l.articleCode === row.articleCode);
                      const pendingKey = `${p.id}:${row.articleCode}`;
                      const pendingQty = pendingByProformaArticle.get(pendingKey) || 0;
                      const isPending = pendingQty > 0;

                      if (!line) {
                        return (
                          <td key={p.id} className="px-2 py-2 text-center border-r bg-muted/30">
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          </td>
                        );
                      }

                      if (isPending) {
                        const orderStatus = data.activeOrders.find(o => o.proformaIdUsed === p.id)?.status || "LOADING";
                        return (
                          <td key={p.id} className="px-2 py-2 text-center border-r bg-amber-50 dark:bg-amber-900/20">
                            <div className="flex flex-col items-center gap-0.5">
                              <Badge className={cn("text-xs font-semibold", STATUS_COLOR[orderStatus])}>
                                {pendingQty} bales
                              </Badge>
                              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                                {STATUS_LABEL[orderStatus] || "Loading"}
                              </span>
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td key={p.id} className="px-2 py-2 text-center border-r">
                          <span className="font-semibold font-mono tabular-nums text-foreground">
                            {line.quantity}
                          </span>
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

    </div>
  );
}
