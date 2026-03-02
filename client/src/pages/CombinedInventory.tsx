import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, Search } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";

interface Container {
  id: number;
  status: string;
}

interface ContainerDetail {
  id: number;
  containerNumber: string;
  lineItems?: {
    stockItemName: string;
    stockItemId: number;
    quantity: string;
    totalCost: string;
  }[];
}

interface InventoryRow {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  quantity: string;
  averageRate: string;
  totalValue: string;
}

interface CombinedRow {
  stockItemId: number;
  stockItemName: string;
  otwQty: number;
  inHandQty: number;
  totalQty: number;
  inHandValue: number;
}

export default function CombinedInventory() {
  const [search, setSearch] = useState("");
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);

  const { data: containers = [], isLoading: loadingContainers } = useQuery<Container[]>({
    queryKey: ["/api/containers"],
  });

  const otwContainers = useMemo(
    () => containers.filter((c) => c.status === "OTW"),
    [containers]
  );

  const containerDetailsQueries = useQueries({
    queries: otwContainers.map((container) => ({
      queryKey: [`/api/containers/${container.id}`],
      enabled: !!container.id,
    })),
  });

  const { data: inventoryRows = [], isLoading: loadingInventory } = useQuery<InventoryRow[]>({
    queryKey: ["/api/inventory"],
  });

  const isLoading = loadingContainers || loadingInventory || containerDetailsQueries.some((q) => q.isLoading);

  const combinedData = useMemo((): CombinedRow[] => {
    const map = new Map<number, CombinedRow>();

    containerDetailsQueries.forEach((q) => {
      if (!q.data) return;
      const detail = q.data as ContainerDetail;
      (detail.lineItems || []).forEach((li) => {
        const qty = parseFloat(li.quantity || "0");
        const existing = map.get(li.stockItemId);
        if (existing) {
          existing.otwQty += qty;
          existing.totalQty += qty;
        } else {
          map.set(li.stockItemId, {
            stockItemId: li.stockItemId,
            stockItemName: li.stockItemName,
            otwQty: qty,
            inHandQty: 0,
            totalQty: qty,
            inHandValue: 0,
          });
        }
      });
    });

    inventoryRows.forEach((inv) => {
      const qty = parseFloat(inv.quantity || "0");
      const value = parseFloat(inv.totalValue || "0");
      const existing = map.get(inv.stockItemId);
      if (existing) {
        existing.inHandQty += qty;
        existing.totalQty += qty;
        existing.inHandValue += value;
      } else {
        map.set(inv.stockItemId, {
          stockItemId: inv.stockItemId,
          stockItemName: inv.stockItemName,
          otwQty: 0,
          inHandQty: qty,
          totalQty: qty,
          inHandValue: value,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.stockItemName.localeCompare(b.stockItemName)
    );
  }, [containerDetailsQueries, inventoryRows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return combinedData;
    const s = search.toLowerCase();
    return combinedData.filter((r) => r.stockItemName.toLowerCase().includes(s));
  }, [combinedData, search]);

  const totals = useMemo(() => ({
    otwQty: filtered.reduce((s, r) => s + r.otwQty, 0),
    inHandQty: filtered.reduce((s, r) => s + r.inHandQty, 0),
    totalQty: filtered.reduce((s, r) => s + r.totalQty, 0),
    inHandValue: filtered.reduce((s, r) => s + r.inHandValue, 0),
  }), [filtered]);

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 w-full min-w-0">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Layers className="h-5 w-5 sm:h-6 sm:w-6" />
            Combined Inventory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            In-transit (OTW) + in-hand stock combined per item
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Items</CardTitle>
            <p className="text-2xl font-bold">{filtered.length}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">OTW Qty</CardTitle>
            <p className="text-2xl font-bold font-mono">{formatNumber(totals.otwQty, 0)}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">In-Hand Qty</CardTitle>
            <p className="text-2xl font-bold font-mono">{formatNumber(totals.inHandQty, 0)}</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Qty</CardTitle>
            <p className="text-2xl font-bold font-mono">{formatNumber(totals.totalQty, 0)}</p>
          </CardHeader>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search stock items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
          data-testid="input-search-combined"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No stock items found</p>
            <p className="text-sm mt-1">Try adjusting your search.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto rounded-md">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right">OTW Qty</TableHead>
                    <TableHead className="text-right">In-Hand Qty</TableHead>
                    <TableHead className="text-right">Total Qty</TableHead>
                    <TableHead className="text-right">In-Hand Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.stockItemId} data-testid={`row-combined-${row.stockItemId}`}>
                      <TableCell className="font-medium">{row.stockItemName}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.otwQty > 0 ? (
                          <span className="text-blue-600 dark:text-blue-400">{formatNumber(row.otwQty, 0)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.inHandQty > 0 ? (
                          <span>{formatNumber(row.inHandQty, 0)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatNumber(row.totalQty, 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.inHandValue > 0 ? formatAmount(row.inHandValue) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter className="sticky bottom-0 z-10 bg-background border-t">
                  <TableRow className="font-semibold">
                    <TableCell>Total ({filtered.length} items)</TableCell>
                    <TableCell className="text-right font-mono" data-testid="total-otw-qty">{formatNumber(totals.otwQty, 0)}</TableCell>
                    <TableCell className="text-right font-mono" data-testid="total-inhand-qty">{formatNumber(totals.inHandQty, 0)}</TableCell>
                    <TableCell className="text-right font-mono" data-testid="total-combined-qty">{formatNumber(totals.totalQty, 0)}</TableCell>
                    <TableCell className="text-right font-mono" data-testid="total-inhand-value">{formatAmount(totals.inHandValue)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
