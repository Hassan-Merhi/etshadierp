import {useState, useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {format} from "date-fns";
import {PageHeader} from "@/components/PageHeader";
import {CheckCircle2, Search, X, ArrowRight, Clock, Package2, Eye, Pencil, CalendarIcon, Plus} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Input} from "@/components/ui/input";
import {Skeleton} from "@/components/ui/skeleton";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {cn} from "@/lib/utils";

import type {PosTransferOrdersProps, TransferSummary} from "./postransferorders/types";
import {formatDate} from "./postransferorders/utils";
import {TransferOrderDetail} from "./postransferorders/components/TransferOrderDetail";
import {CreateTransferDialog} from "./postransferorders/components/CreateTransferDialog";
import {ViewTransferDialog} from "./postransferorders/components/ViewTransferDialog";
export default function PosTransferOrders({ posUser }: PosTransferOrdersProps) {
  const [editVoucherId, setEditVoucherId] = useState<number | null>(null);
  const [viewVoucherId, setViewVoucherId] = useState<number | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "applied" | "pending">("all");
  const [dateFilter, setDateFilter] = useState(format(new Date(), "yyyy-MM-dd"));

  // Fetch all locations accessible to this POS user so multi-location users
  // see orders involving any of their locations (as source or destination).
  const { data: myLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/my-locations"],
  });
  const myLocationIds = new Set(myLocations.map((l) => l.id));

  const { data: allTransfers = [], isLoading } = useQuery<TransferSummary[]>({
    queryKey: ["/api/stock-transfers/list", dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFilter) {
        params.set("startDate", dateFilter);
        params.set("endDate", dateFilter);
      }
      const res = await fetch(`/api/stock-transfers/list?${params}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const transfers = useMemo(() => {
    return allTransfers.filter((t) => {
      if (statusFilter === "applied" && !t.inventoryApplied) return false;
      if (statusFilter === "pending" && t.inventoryApplied) return false;
      if (dateFilter) {
        const tDate = String(t.voucherDate ?? "").slice(0, 10);
        if (tDate !== dateFilter) return false;
      }
      // Only show transfers involving at least one of the user's locations
      if (myLocationIds.size > 0) {
        const srcMatch = t.sourceLocationId != null && myLocationIds.has(t.sourceLocationId);
        const dstMatch = myLocationIds.has(t.destinationLocationId);
        if (!srcMatch && !dstMatch) return false;
      }
      const s = search.toLowerCase().trim();
      if (!s) return true;
      return t.voucherNumber?.toLowerCase().includes(s) || t.stockItemNames?.some((n) => n.toLowerCase().includes(s));
    });
  }, [allTransfers, search, statusFilter, dateFilter, myLocationIds]);

  const openView = (voucherId: number) => {
    setViewVoucherId(voucherId);
    setViewDialogOpen(true);
  };

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFilter(todayStr);
  };
  const hasFilters = !!search || statusFilter !== "all" || dateFilter !== todayStr;

  // Edit view — full page, no extra padding (the component handles its own layout)
  if (editVoucherId !== null) {
    return (
      <div className="flex flex-col h-full">
        <TransferOrderDetail voucherId={editVoucherId} posUser={posUser} onBack={() => setEditVoucherId(null)} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Page header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <PageHeader title="Orders" subtitle="Review and adjust quantities for your location" />
        {myLocations.length > 1 && (
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-transfer">
            <Plus className="h-4 w-4 mr-1.5" />
            New Transfer
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-md bg-muted/30 px-4 py-3">
        <div className="space-y-1 min-w-[140px]">
          <label className="text-xs font-medium text-muted-foreground">Date</label>
          <div className="relative">
            <CalendarIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 pl-8 pr-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring w-full"
              data-testid="input-date-filter"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="h-8 text-sm w-[120px]" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Item name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-list-search"
            />
          </div>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="gap-1.5"
            data-testid="button-clear-filters"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Order count label */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {isLoading ? "Loading…" : `${transfers.length} ${transfers.length === 1 ? "order" : "orders"}`}
        </span>
      </div>

      {/* Transfer order cards */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-md border bg-card p-4 flex items-center gap-4">
              <Skeleton className="h-2.5 w-2.5 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-52" />
              </div>
              <div className="space-y-1 text-right shrink-0">
                <Skeleton className="h-5 w-8 ml-auto" />
                <Skeleton className="h-3 w-8 ml-auto" />
              </div>
              <Skeleton className="h-8 w-16 shrink-0" />
            </div>
          ))}
        </div>
      ) : transfers.length === 0 ? (
        <div className="rounded-md border bg-card text-center py-16 text-muted-foreground" data-testid="text-empty">
          <Package2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No transfer orders found</p>
          {hasFilters && <p className="text-xs mt-1 opacity-70">Try clearing your filters</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {transfers.map((t) => (
            <div
              key={t.voucherId}
              className="rounded-md border bg-card px-4 py-3.5 flex items-center gap-4 hover-elevate"
              data-testid={`row-transfer-${t.voucherId}`}
            >
              {/* Status dot */}
              <div
                className={cn(
                  "h-2.5 w-2.5 rounded-full shrink-0",
                  t.inventoryApplied ? "bg-green-500 dark:bg-green-400" : "bg-amber-400 dark:bg-amber-400"
                )}
              />

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">{formatDate(t.voucherDate)}</span>
                  {t.inventoryApplied ? (
                    <Badge
                      variant="secondary"
                      className="gap-1 text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30"
                      data-testid={`badge-applied-${t.voucherId}`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Applied
                    </Badge>
                  ) : (
                    <Badge
                      variant="secondary"
                      className="gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30"
                      data-testid={`badge-pending-${t.voucherId}`}
                    >
                      <Clock className="h-3 w-3" />
                      Pending
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
                  <span className="truncate">{t.sourceLocationName}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  <span className="truncate font-medium text-foreground">{t.destinationLocationName}</span>
                </div>
              </div>

              {/* Item count */}
              <div className="shrink-0 text-right">
                <div className="text-xl font-bold font-mono tabular-nums leading-none">{t.itemCount}</div>
                <div className="text-xs text-muted-foreground mt-0.5">items</div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openView(t.voucherId)}
                  data-testid={`button-view-${t.voucherId}`}
                  title="View"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                {!t.inventoryApplied && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditVoucherId(t.voucherId)}
                    data-testid={`button-edit-${t.voucherId}`}
                    title="Adjust"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ViewTransferDialog
        voucherId={viewVoucherId}
        open={viewDialogOpen}
        onClose={() => {
          setViewDialogOpen(false);
          setViewVoucherId(null);
        }}
      />

      <CreateTransferDialog open={createOpen} onClose={() => setCreateOpen(false)} myLocations={myLocations} />
    </div>
  );
}
