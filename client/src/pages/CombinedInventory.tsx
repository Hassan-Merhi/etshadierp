import { useState, useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Layers, Search, ChevronRight, ArrowLeft, List, FolderOpen, Download } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";
import { PageHeader } from "@/components/PageHeader";

interface Container {
  id: number;
  status: string;
}

interface InventoryRow {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  quantity: string;
  averageRate: string;
  totalValue: string;
  stockGroupId: number | null;
  stockGroupName: string;
}

interface StockItem {
  id: number;
  name: string;
  code?: string;
  stockGroupId?: number | null;
  stockGroupName?: string;
}

interface CombinedRow {
  stockItemId: number;
  stockItemName: string;
  stockGroupId: number | null;
  stockGroupName: string;
  otwQty: number;
  inHandQty: number;
  totalQty: number;
  inHandValue: number;
  otwWeightedCostSum: number; // sum(qty * rate) for OTW items
  avgRate: number;
  combinedValue: number;
}

interface StockGroupSummary {
  stockGroupId: number | null;
  stockGroupName: string;
  itemCount: number;
  otwQty: number;
  inHandQty: number;
  totalQty: number;
  inHandValue: number;
  combinedValue: number;
}

type ViewMode = "groups" | "all";

export default function CombinedInventory() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined);
  const [includeZero, setIncludeZero] = useState(false);
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

  const { data: allStockItems = [], isLoading: loadingStockItems } = useQuery<StockItem[]>({
    queryKey: ["/api/stock-items"],
    enabled: includeZero,
  });

  const isLoading = loadingContainers || loadingInventory || containerDetailsQueries.some((q) => q.isLoading) || (includeZero && loadingStockItems);

  const combinedData = useMemo((): CombinedRow[] => {
    const map = new Map<number, CombinedRow>();

    containerDetailsQueries.forEach((q) => {
      if (!q.data) return;
      const containerData = q.data as any;
      containerData?.pos?.forEach((po: any) => {
        po.items?.forEach((item: any) => {
          const qty = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const existing = map.get(item.stockItemId);
          if (existing) {
            existing.otwQty += qty;
            existing.totalQty += qty;
            existing.otwWeightedCostSum += qty * rate;
          } else {
            map.set(item.stockItemId, {
              stockItemId: item.stockItemId,
              stockItemName: item.stockItemName || item.itemName || "",
              stockGroupId: item.stockGroupId ?? null,
              stockGroupName: item.stockGroupName || "",
              otwQty: qty,
              inHandQty: 0,
              totalQty: qty,
              inHandValue: 0,
              otwWeightedCostSum: qty * rate,
              avgRate: 0,
              combinedValue: 0,
            });
          }
        });
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
        if (!existing.stockGroupId && inv.stockGroupId) {
          existing.stockGroupId = inv.stockGroupId;
          existing.stockGroupName = inv.stockGroupName;
        }
      } else {
        map.set(inv.stockItemId, {
          stockItemId: inv.stockItemId,
          stockItemName: inv.stockItemName,
          stockGroupId: inv.stockGroupId ?? null,
          stockGroupName: inv.stockGroupName || "",
          otwQty: 0,
          inHandQty: qty,
          totalQty: qty,
          inHandValue: value,
          otwWeightedCostSum: 0,
          avgRate: 0,
          combinedValue: 0,
        });
      }
    });

    if (includeZero) {
      allStockItems.forEach((item) => {
        if (!map.has(item.id)) {
          map.set(item.id, {
            stockItemId: item.id,
            stockItemName: item.name,
            stockGroupId: item.stockGroupId ?? null,
            stockGroupName: (item as any).stockGroupName || "",
            otwQty: 0,
            inHandQty: 0,
            totalQty: 0,
            inHandValue: 0,
            otwWeightedCostSum: 0,
            avgRate: 0,
            combinedValue: 0,
          });
        }
      });
    }

    // Compute avgRate and combinedValue:
    // - Prefer in-hand avg rate (most accurate, reflects actual received cost)
    // - Fall back to OTW purchase rate when there's no in-hand stock yet
    map.forEach((row) => {
      if (row.inHandQty > 0) {
        row.avgRate = row.inHandValue / row.inHandQty;
      } else if (row.otwQty > 0 && row.otwWeightedCostSum > 0) {
        row.avgRate = row.otwWeightedCostSum / row.otwQty;
      } else {
        row.avgRate = 0;
      }
      row.combinedValue = row.avgRate * row.totalQty;
    });

    return Array.from(map.values()).sort((a, b) =>
      a.stockItemName.localeCompare(b.stockItemName)
    );
  }, [containerDetailsQueries, inventoryRows, allStockItems, includeZero]);

  const searchLower = search.trim().toLowerCase();

  const filteredAll = useMemo(() => {
    if (!searchLower) return combinedData;
    return combinedData.filter((r) => r.stockItemName.toLowerCase().includes(searchLower));
  }, [combinedData, searchLower]);

  const stockGroups = useMemo((): StockGroupSummary[] => {
    const groupMap = new Map<string, StockGroupSummary>();
    const key = (id: number | null) => id === null ? "__null__" : String(id);

    filteredAll.forEach((row) => {
      const k = key(row.stockGroupId);
      const existing = groupMap.get(k);
      if (existing) {
        existing.itemCount += 1;
        existing.otwQty += row.otwQty;
        existing.inHandQty += row.inHandQty;
        existing.totalQty += row.totalQty;
        existing.inHandValue += row.inHandValue;
        existing.combinedValue += row.combinedValue;
      } else {
        groupMap.set(k, {
          stockGroupId: row.stockGroupId,
          stockGroupName: row.stockGroupName || "Uncategorized",
          itemCount: 1,
          otwQty: row.otwQty,
          inHandQty: row.inHandQty,
          totalQty: row.totalQty,
          inHandValue: row.inHandValue,
          combinedValue: row.combinedValue,
        });
      }
    });

    return Array.from(groupMap.values()).sort((a, b) =>
      a.stockGroupName.localeCompare(b.stockGroupName)
    );
  }, [filteredAll]);

  const groupItems = useMemo(() => {
    if (selectedGroupId === undefined) return [];
    return filteredAll.filter((r) => r.stockGroupId === selectedGroupId);
  }, [filteredAll, selectedGroupId]);

  const totals = useMemo(() => ({
    items: filteredAll.length,
    otwQty: filteredAll.reduce((s, r) => s + r.otwQty, 0),
    inHandQty: filteredAll.reduce((s, r) => s + r.inHandQty, 0),
    totalQty: filteredAll.reduce((s, r) => s + r.totalQty, 0),
    inHandValue: filteredAll.reduce((s, r) => s + r.inHandValue, 0),
    combinedValue: filteredAll.reduce((s, r) => s + r.combinedValue, 0),
  }), [filteredAll]);

  const drillGroup = selectedGroupId !== undefined
    ? stockGroups.find((g) => g.stockGroupId === selectedGroupId)
    : null;

  const isDrillMode = viewMode === "groups" && selectedGroupId !== undefined;

  const handleExport = async () => {
    const XLSX = await import("@/lib/excelHelper");
    const exportRows = isDrillMode ? groupItems : filteredAll;
    const wsData = [
      ["Item Name", "Stock Group", "OTW Qty", "In-Hand Qty", "Total Qty", "Avg Rate", "Total Value"],
      ...exportRows.map((r) => [
        r.stockItemName,
        r.stockGroupName || "Uncategorized",
        r.otwQty,
        r.inHandQty,
        r.totalQty,
        parseFloat(r.avgRate.toFixed(2)),
        parseFloat(r.combinedValue.toFixed(2)),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 35 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Combined Inventory");
    const filename = isDrillMode
      ? `combined_inventory_${(drillGroup?.stockGroupName || "group").replace(/\s+/g, "_")}.xlsx`
      : "combined_inventory.xlsx";
    await XLSX.writeFile(wb, filename);
  };

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 w-full min-w-0">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {isDrillMode && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSelectedGroupId(undefined)}
              data-testid="button-back-to-groups"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div>
            {isDrillMode ? (
              <>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-0.5">
                  <button
                    className="hover:text-foreground transition-colors"
                    onClick={() => setSelectedGroupId(undefined)}
                  >
                    Combined Inventory
                  </button>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-foreground font-medium">{drillGroup?.stockGroupName}</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 sm:h-6 sm:w-6" />
                  {drillGroup?.stockGroupName}
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {drillGroup?.itemCount} item{drillGroup?.itemCount !== 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <>
                <PageHeader title="Combined Inventory" icon={<Layers className="h-5 w-5" />} />
                <p className="text-sm text-muted-foreground mt-1">
                  In-transit (OTW) + in-hand stock combined per item
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {!isDrillMode && (
            <div className="flex items-center gap-1 rounded-md border p-1">
              <Button
                size="sm"
                variant={viewMode === "groups" ? "secondary" : "ghost"}
                onClick={() => { setViewMode("groups"); setSelectedGroupId(undefined); }}
                data-testid="button-view-groups"
              >
                <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                By Group
              </Button>
              <Button
                size="sm"
                variant={viewMode === "all" ? "secondary" : "ghost"}
                onClick={() => setViewMode("all")}
                data-testid="button-view-all"
              >
                <List className="h-3.5 w-3.5 mr-1.5" />
                View All
              </Button>
            </div>
          )}

          <button
            onClick={() => setIncludeZero((v) => !v)}
            data-testid="toggle-include-zero"
            className={`flex items-center gap-2 rounded-md border px-3 h-9 text-sm font-medium transition-colors ${
              includeZero
                ? "bg-secondary text-secondary-foreground border-border"
                : "bg-background text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded border flex-shrink-0 ${
                includeZero ? "bg-primary border-primary" : "border-muted-foreground"
              }`}
            >
              {includeZero && (
                <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1,4 4,7 9,1" />
                </svg>
              )}
            </span>
            Include zero stock
          </button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isLoading}
            data-testid="button-export-excel"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Items", value: totals.items.toLocaleString(), testId: "stat-items" },
          { label: "OTW Qty", value: formatNumber(totals.otwQty, 0), testId: "stat-otw" },
          { label: "In-Hand Qty", value: formatNumber(totals.inHandQty, 0), testId: "stat-inhand" },
          { label: "Total Qty", value: formatNumber(totals.totalQty, 0), testId: "stat-total" },
        ].map(({ label, value, testId }) => (
          <div key={label} className="rounded-md border bg-card p-4" data-testid={testId}>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl font-bold font-mono">{value}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={isDrillMode ? "Search items in this group..." : "Search stock items..."}
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
      ) : viewMode === "groups" && !isDrillMode ? (
        <GroupsView
          groups={stockGroups}
          onSelectGroup={setSelectedGroupId}
          formatAmount={formatAmount}
        />
      ) : isDrillMode ? (
        <ItemsTable
          rows={groupItems}
          formatAmount={formatAmount}
          emptyMessage="No items match your search in this group."
        />
      ) : (
        <ItemsTable
          rows={filteredAll}
          formatAmount={formatAmount}
          emptyMessage="No stock items found. Try adjusting your search."
        />
      )}
    </div>
  );
}

function GroupsView({
  groups,
  onSelectGroup,
  formatAmount,
}: {
  groups: StockGroupSummary[];
  onSelectGroup: (id: number | null) => void;
  formatAmount: (v: number) => string;
}) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No stock groups found</p>
          <p className="text-sm mt-1">Try adjusting your search.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto rounded-md">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Stock Group</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Items</TableHead>
                <TableHead className="text-right">OTW Qty</TableHead>
                <TableHead className="text-right">In-Hand Qty</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right hidden md:table-cell">Total Value</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow
                  key={g.stockGroupId ?? "__null__"}
                  className="cursor-pointer hover-elevate"
                  onClick={() => onSelectGroup(g.stockGroupId)}
                  data-testid={`row-group-${g.stockGroupId ?? "null"}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">{g.stockGroupName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell">
                    <Badge variant="secondary">{g.itemCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {g.otwQty > 0 ? (
                      <span className="text-blue-500 dark:text-blue-400">{formatNumber(g.otwQty, 0)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(g.inHandQty, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatNumber(g.totalQty, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono hidden md:table-cell text-muted-foreground">
                    {g.combinedValue > 0 ? formatAmount(g.combinedValue) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="sticky bottom-0 z-10 bg-background border-t">
              <TableRow className="font-semibold">
                <TableCell>Total ({groups.length} group{groups.length !== 1 ? "s" : ""})</TableCell>
                <TableCell className="hidden sm:table-cell"></TableCell>
                <TableCell className="text-right font-mono" data-testid="total-otw-qty">
                  {formatNumber(groups.reduce((s, g) => s + g.otwQty, 0), 0)}
                </TableCell>
                <TableCell className="text-right font-mono" data-testid="total-inhand-qty">
                  {formatNumber(groups.reduce((s, g) => s + g.inHandQty, 0), 0)}
                </TableCell>
                <TableCell className="text-right font-mono" data-testid="total-combined-qty">
                  {formatNumber(groups.reduce((s, g) => s + g.totalQty, 0), 0)}
                </TableCell>
                <TableCell className="text-right font-mono hidden md:table-cell" data-testid="total-combined-value">
                  {formatAmount(groups.reduce((s, g) => s + g.combinedValue, 0))}
                </TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ItemsTable({
  rows,
  formatAmount,
  emptyMessage,
}: {
  rows: CombinedRow[];
  formatAmount: (v: number) => string;
  emptyMessage: string;
}) {
  const totals = useMemo(() => ({
    otwQty: rows.reduce((s, r) => s + r.otwQty, 0),
    inHandQty: rows.reduce((s, r) => s + r.inHandQty, 0),
    totalQty: rows.reduce((s, r) => s + r.totalQty, 0),
    inHandValue: rows.reduce((s, r) => s + r.inHandValue, 0),
    combinedValue: rows.reduce((s, r) => s + r.combinedValue, 0),
  }), [rows]);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No stock items found</p>
          <p className="text-sm mt-1">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto rounded-md">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead className="text-right">OTW Qty</TableHead>
                <TableHead className="text-right">In-Hand Qty</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right hidden md:table-cell">Avg Rate</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.stockItemId} data-testid={`row-combined-${row.stockItemId}`}>
                  <TableCell className="font-medium">{row.stockItemName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {row.otwQty > 0 ? (
                      <span className="text-blue-500 dark:text-blue-400">{formatNumber(row.otwQty, 0)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.inHandQty > 0 ? formatNumber(row.inHandQty, 0) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatNumber(row.totalQty, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono hidden md:table-cell text-muted-foreground">
                    {row.avgRate > 0 ? formatAmount(row.avgRate) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.combinedValue > 0 ? formatAmount(row.combinedValue) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="sticky bottom-0 z-10 bg-background border-t">
              <TableRow className="font-semibold">
                <TableCell>Total ({rows.length} item{rows.length !== 1 ? "s" : ""})</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(totals.otwQty, 0)}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(totals.inHandQty, 0)}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(totals.totalQty, 0)}</TableCell>
                <TableCell className="text-right font-mono hidden md:table-cell"></TableCell>
                <TableCell className="text-right font-mono">{formatAmount(totals.combinedValue)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
