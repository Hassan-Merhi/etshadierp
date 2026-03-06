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
import { Layers, Search, ChevronRight, ArrowLeft, List, FolderOpen } from "lucide-react";
import { formatNumber } from "@/lib/formatNumber";

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

interface CombinedRow {
  stockItemId: number;
  stockItemName: string;
  stockGroupId: number | null;
  stockGroupName: string;
  otwQty: number;
  inHandQty: number;
  totalQty: number;
  inHandValue: number;
}

interface StockGroupSummary {
  stockGroupId: number | null;
  stockGroupName: string;
  itemCount: number;
  otwQty: number;
  inHandQty: number;
  totalQty: number;
  inHandValue: number;
}

type ViewMode = "groups" | "all";

export default function CombinedInventory() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null | undefined>(undefined);
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
      const containerData = q.data as any;
      containerData?.pos?.forEach((po: any) => {
        po.items?.forEach((item: any) => {
          const qty = parseFloat(item.quantity || "0");
          const existing = map.get(item.stockItemId);
          if (existing) {
            existing.otwQty += qty;
            existing.totalQty += qty;
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
        });
      }
    });

    return Array.from(map.values()).sort((a, b) =>
      a.stockItemName.localeCompare(b.stockItemName)
    );
  }, [containerDetailsQueries, inventoryRows]);

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
      } else {
        groupMap.set(k, {
          stockGroupId: row.stockGroupId,
          stockGroupName: row.stockGroupName || "Uncategorized",
          itemCount: 1,
          otwQty: row.otwQty,
          inHandQty: row.inHandQty,
          totalQty: row.totalQty,
          inHandValue: row.inHandValue,
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
  }), [filteredAll]);

  const drillGroup = selectedGroupId !== undefined
    ? stockGroups.find((g) => g.stockGroupId === selectedGroupId)
    : null;

  const isDrillMode = viewMode === "groups" && selectedGroupId !== undefined;

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
                <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                  <Layers className="h-5 w-5 sm:h-6 sm:w-6" />
                  Combined Inventory
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  In-transit (OTW) + in-hand stock combined per item
                </p>
              </>
            )}
          </div>
        </div>

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
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>Stock Group</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Items</TableHead>
                <TableHead className="text-right">OTW Qty</TableHead>
                <TableHead className="text-right">In-Hand Qty</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right hidden md:table-cell">In-Hand Value</TableHead>
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
                    {g.inHandValue > 0 ? formatAmount(g.inHandValue) : "—"}
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
                <TableCell className="text-right font-mono hidden md:table-cell" data-testid="total-inhand-value">
                  {formatAmount(groups.reduce((s, g) => s + g.inHandValue, 0))}
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
                  <TableCell className="text-right font-mono">
                    {row.inHandValue > 0 ? formatAmount(row.inHandValue) : <span className="text-muted-foreground">—</span>}
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
                <TableCell className="text-right font-mono">{formatAmount(totals.inHandValue)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
