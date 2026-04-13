import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface AllocationData {
  proformas: Proforma[];
  inStockCounts: InStockCount[];
  reservations: any[];
  activeOrders: any[];
}

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

  const { articleRows, allProformas, visibleProformas, productNameByCode } = useMemo(() => {
    if (!data) return {
      articleRows: [],
      allProformas: [],
      visibleProformas: [],
      productNameByCode: new Map<string, string>(),
    };

    const allProformas = data.proformas;
    const visibleProformas = allProformas.filter(p => visibleProformaIds.has(p.id));

    const inStockMap = new Map(data.inStockCounts.map(s => [s.articleCode, s.count]));

    // Product name lookup from all proforma lines
    const productNameByCode = new Map<string, string>();
    allProformas.forEach(p => p.lines.forEach(l => {
      if (l.productName) productNameByCode.set(l.articleCode, l.productName);
    }));

    // All article codes from any proforma + in-stock bales
    const articleCodeSet = new Set<string>();
    allProformas.forEach(p => p.lines.forEach(l => articleCodeSet.add(l.articleCode)));
    data.inStockCounts.forEach(s => articleCodeSet.add(s.articleCode));

    const articleRows = Array.from(articleCodeSet).sort().map(articleCode => {
      const inStock = inStockMap.get(articleCode) || 0;

      // Sum of quantities from visible proformas for this article
      let proformaTotal = 0;
      visibleProformas.forEach(p => {
        const line = p.lines.find(l => l.articleCode === articleCode);
        if (line) proformaTotal += line.quantity;
      });

      const available = inStock - proformaTotal;
      return { articleCode, inStock, available };
    });

    return { articleRows, allProformas, visibleProformas, productNameByCode };
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
                <th className="text-left px-3 py-2.5 font-medium border-b border-r whitespace-nowrap sticky left-0 bg-muted/80 backdrop-blur-sm z-20 min-w-[200px]">
                  Product
                </th>
                <th className="text-right px-3 py-2.5 font-medium border-b border-r whitespace-nowrap min-w-[90px]">
                  In Stock
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
                      <div className="font-medium truncate max-w-[220px]" title={displayName}>{displayName}</div>
                    </td>

                    {/* In Stock */}
                    <td className="px-3 py-2 text-right border-r font-mono tabular-nums">
                      {row.inStock}
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

                    {/* Per-proforma quantity cells */}
                    {visibleProformas.map(p => {
                      const line = p.lines.find(l => l.articleCode === row.articleCode);

                      if (!line) {
                        return (
                          <td key={p.id} className="px-2 py-2 text-center border-r bg-muted/30">
                            <span className="text-muted-foreground/40 text-xs">—</span>
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
