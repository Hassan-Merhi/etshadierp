import {useMemo, useState, type ReactNode} from "react";
import {useQuery} from "@tanstack/react-query";
import {format} from "date-fns";
import {
  ArrowRight,
  CalendarIcon,
  CheckCircle2,
  Clock3,
  Eye,
  FileClock,
  Package2,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import {PageHeader} from "@/components/PageHeader";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Skeleton} from "@/components/ui/skeleton";
import type {PosTransferOrdersProps, TransferSummary} from "./postransferorders/types";
import {formatDate, formatDateTime} from "./postransferorders/utils";
import {CreateTransferDialog} from "./postransferorders/components/CreateTransferDialog";
import {TransferOrderDetail} from "./postransferorders/components/TransferOrderDetail";
import {ViewTransferDialog} from "./postransferorders/components/ViewTransferDialog";

type RevisionMeta = {
  revisionCount: number;
  pendingRevisionCount: number;
  latestRevisionNumber: number | null;
  latestRevisionDate: string | null;
};

type RevisionMetaMap = Record<number, RevisionMeta>;

export default function PosTransferOrders({posUser}: PosTransferOrdersProps) {
  const [editVoucherId, setEditVoucherId] = useState<number | null>(null);
  const [viewVoucherId, setViewVoucherId] = useState<number | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "applied" | "pending">("all");
  const [dateFilter, setDateFilter] = useState(format(new Date(), "yyyy-MM-dd"));

  const {data: myLocations = []} = useQuery<{id: number; name: string}[]>({queryKey: ["/api/my-locations"]});
  const myLocationIds = useMemo(() => new Set(myLocations.map((location) => location.id)), [myLocations]);

  const {data: allTransfers = [], isLoading} = useQuery<TransferSummary[]>({
    queryKey: ["/api/stock-transfers/list", dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFilter) {
        params.set("startDate", dateFilter);
        params.set("endDate", dateFilter);
      }
      const response = await fetch(`/api/stock-transfers/list?${params}`, {credentials: "include"});
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
  });

  const transferIds = useMemo(() => allTransfers.map((transfer) => transfer.transferId), [allTransfers]);
  const {data: revisionMeta = {}} = useQuery<RevisionMetaMap>({
    queryKey: ["/api/stock-transfers/revision-meta", transferIds.join(",")],
    queryFn: async () => {
      if (transferIds.length === 0) return {};
      const response = await fetch(`/api/stock-transfers/revision-meta?transferIds=${transferIds.join(",")}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    enabled: transferIds.length > 0,
  });

  const transfers = useMemo(
    () =>
      allTransfers.filter((transfer) => {
        if (statusFilter === "applied" && !transfer.inventoryApplied) return false;
        if (statusFilter === "pending" && transfer.inventoryApplied) return false;
        if (dateFilter && String(transfer.voucherDate ?? "").slice(0, 10) !== dateFilter) return false;
        if (myLocationIds.size > 0) {
          const sourceMatches = transfer.sourceLocationId != null && myLocationIds.has(transfer.sourceLocationId);
          const destinationMatches = myLocationIds.has(transfer.destinationLocationId);
          if (!sourceMatches && !destinationMatches) return false;
        }
        const term = search.toLowerCase().trim();
        if (!term) return true;
        return (
          transfer.voucherNumber?.toLowerCase().includes(term) ||
          transfer.stockItemNames?.some((name) => name.toLowerCase().includes(term))
        );
      }),
    [allTransfers, dateFilter, myLocationIds, search, statusFilter]
  );

  const today = format(new Date(), "yyyy-MM-dd");
  const hasFilters = Boolean(search) || statusFilter !== "all" || dateFilter !== today;
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFilter(today);
  };
  const openView = (voucherId: number) => {
    setViewVoucherId(voucherId);
    setViewDialogOpen(true);
  };

  if (editVoucherId !== null) {
    return (
      <div className="flex min-h-0 flex-col">
        <TransferOrderDetail voucherId={editVoucherId} posUser={posUser} onBack={() => setEditVoucherId(null)} />
      </div>
    );
  }

  return (
    <section className="min-w-0 max-w-full space-y-4" data-pos-transfer-orders="true">
      <PageHeader
        title="Orders"
        subtitle="Review transfers, inspect item changes, and submit revisions"
        showBackButton={false}
      >
        {myLocations.length > 1 && (
          <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)} data-testid="button-new-transfer">
            <Plus className="mr-1.5 h-4 w-4" />
            New Transfer
          </Button>
        )}
      </PageHeader>

      <div
        role="search"
        aria-label="Transfer order filters"
        className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-[10rem_9rem_minmax(12rem,1fr)_auto] lg:items-end"
      >
        <FilterField label="Date" htmlFor="pos-transfer-date-filter">
          <div className="relative min-w-0">
            <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="pos-transfer-date-filter"
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              className="min-h-11 w-full min-w-0 rounded-lg border bg-background pl-10 pr-2 text-base outline-none focus:ring-2 focus:ring-ring lg:min-h-9 lg:text-sm"
              data-testid="input-date-filter"
            />
          </div>
        </FilterField>
        <FilterField label="Status">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="min-h-11 w-full lg:min-h-9" data-testid="select-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All orders</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Search" htmlFor="pos-transfer-list-search" className="sm:col-span-2 lg:col-span-1">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pos-transfer-list-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Voucher number or item name"
              className="min-h-11 pl-10 text-base lg:min-h-9 lg:text-sm"
              data-testid="input-list-search"
            />
          </div>
        </FilterField>
        {hasFilters ? (
          <Button
            variant="outline"
            onClick={clearFilters}
            className="min-h-11 w-full gap-1.5 sm:col-span-2 lg:col-span-1 lg:min-h-9 lg:w-auto"
            data-testid="button-clear-filters"
          >
            <X className="h-4 w-4" />
            Clear
          </Button>
        ) : (
          <div className="hidden lg:block" aria-hidden="true" />
        )}
      </div>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {isLoading ? "Loading orders" : `${transfers.length} ${transfers.length === 1 ? "order" : "orders"}`}
        </span>
      </div>

      {isLoading ? (
        <LoadingCards />
      ) : transfers.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card py-14 text-center text-muted-foreground" data-testid="text-empty">
          <Package2 className="mx-auto mb-3 h-10 w-10 opacity-20" />
          <p className="text-sm font-medium">No transfer orders found</p>
          {hasFilters && <p className="mt-1 text-xs opacity-70">Clear the filters to see more orders.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {transfers.map((transfer) => {
            const meta = revisionMeta[transfer.transferId] ?? {
              revisionCount: 0,
              pendingRevisionCount: 0,
              latestRevisionNumber: null,
              latestRevisionDate: null,
            };
            return (
              <article
                key={transfer.voucherId}
                className="min-w-0 rounded-xl border bg-card p-3 shadow-sm transition-shadow hover:shadow-md sm:p-4"
                data-testid={`row-transfer-${transfer.voucherId}`}
              >
                <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="min-w-0 space-y-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatDate(transfer.voucherDate)}</span>
                      {transfer.inventoryApplied ? (
                        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />Applied
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-amber-700 dark:text-amber-300">
                          <Clock3 className="h-3 w-3" />Pending
                        </Badge>
                      )}
                      {meta.revisionCount > 0 && (
                        <Badge variant="outline" className="gap-1">
                          <FileClock className="h-3 w-3" />
                          {meta.revisionCount} {meta.revisionCount === 1 ? "revision" : "revisions"}
                        </Badge>
                      )}
                      {meta.pendingRevisionCount > 0 && (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-300">
                          {meta.pendingRevisionCount} awaiting review
                        </Badge>
                      )}
                    </div>
                    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
                      <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">From</div>
                        <div className="break-words font-semibold">{transfer.sourceLocationName}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 rounded-lg bg-muted/50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">To</div>
                        <div className="break-words font-semibold">{transfer.destinationLocationName}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span><strong className="text-foreground">{transfer.itemCount}</strong> {transfer.itemCount === 1 ? "item" : "items"}</span>
                      {meta.latestRevisionNumber && <span>Latest: Revision #{meta.latestRevisionNumber}</span>}
                      {meta.latestRevisionDate && <span>{formatDateTime(meta.latestRevisionDate)}</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t pt-3 lg:flex lg:border-t-0 lg:pt-0">
                    <Button
                      variant="outline"
                      onClick={() => openView(transfer.voucherId)}
                      className="min-h-11 w-full gap-2 lg:w-auto"
                      data-testid={`button-view-${transfer.voucherId}`}
                    >
                      <Eye className="h-4 w-4" />View details
                    </Button>
                    {!transfer.inventoryApplied && (
                      <Button
                        onClick={() => setEditVoucherId(transfer.voucherId)}
                        className="min-h-11 w-full gap-2 lg:w-auto"
                        data-testid={`button-edit-${transfer.voucherId}`}
                      >
                        <Pencil className="h-4 w-4" />Create revision
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
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
    </section>
  );
}

function FilterField({
  label,
  children,
  htmlFor,
  className = "",
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((value) => (
        <div key={value} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-36 max-w-full" />
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
          <Skeleton className="h-11 w-full sm:w-24" />
        </div>
      ))}
    </div>
  );
}
