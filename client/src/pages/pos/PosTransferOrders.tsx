import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import { CheckCircle2, Search, X, ArrowRight, Clock, Package2, Eye, Pencil, CalendarIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { PosTransferOrdersProps, TransferSummary } from "./postransferorders/types";
import { formatDate } from "./postransferorders/utils";
import { TransferOrderDetail } from "./postransferorders/components/TransferOrderDetail";
import { CreateTransferDialog } from "./postransferorders/components/CreateTransferDialog";
import { ViewTransferDialog } from "./postransferorders/components/ViewTransferDialog";

export default function PosTransferOrders({ posUser }: PosTransferOrdersProps) {
  const [editVoucherId, setEditVoucherId] = useState<number | null>(null);
  const [viewVoucherId, setViewVoucherId] = useState<number | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "applied" | "pending">("all");
  const [dateFilter, setDateFilter] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: myLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/my-locations"],
  });
  const myLocationIds = useMemo(() => new Set(myLocations.map((location) => location.id)), [myLocations]);

  const { data: allTransfers = [], isLoading } = useQuery<TransferSummary[]>({
    queryKey: ["/api/stock-transfers/list", dateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFilter) {
        params.set("startDate", dateFilter);
        params.set("endDate", dateFilter);
      }
      const response = await fetch(`/api/stock-transfers/list?${params}`, { credentials: "include" });
      return response.ok ? response.json() : [];
    },
  });

  const transfers = useMemo(() => {
    return allTransfers.filter((transfer) => {
      if (statusFilter === "applied" && !transfer.inventoryApplied) return false;
      if (statusFilter === "pending" && transfer.inventoryApplied) return false;
      if (dateFilter) {
        const transferDate = String(transfer.voucherDate ?? "").slice(0, 10);
        if (transferDate !== dateFilter) return false;
      }
      if (myLocationIds.size > 0) {
        const sourceMatch = transfer.sourceLocationId != null && myLocationIds.has(transfer.sourceLocationId);
        const destinationMatch = myLocationIds.has(transfer.destinationLocationId);
        if (!sourceMatch && !destinationMatch) return false;
      }
      const term = search.toLowerCase().trim();
      if (!term) return true;
      return (
        transfer.voucherNumber?.toLowerCase().includes(term) ||
        transfer.stockItemNames?.some((name) => name.toLowerCase().includes(term))
      );
    });
  }, [allTransfers, search, statusFilter, dateFilter, myLocationIds]);

  const openView = (voucherId: number) => {
    setViewVoucherId(voucherId);
    setViewDialogOpen(true);
  };

  const today = format(new Date(), "yyyy-MM-dd");
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setDateFilter(today);
  };
  const hasFilters = Boolean(search) || statusFilter !== "all" || dateFilter !== today;

  if (editVoucherId !== null) {
    return (
      <div className="flex min-h-0 flex-col">
        <TransferOrderDetail voucherId={editVoucherId} posUser={posUser} onBack={() => setEditVoucherId(null)} />
      </div>
    );
  }

  return (
    <section className="min-w-0 max-w-full space-y-4" data-pos-transfer-orders="true">
      <PageHeader title="Transfer Orders" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transfers..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | "applied" | "pending")}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="applied">Applied</SelectItem><SelectItem value="pending">Pending</SelectItem></SelectContent>
        </Select>
        <div className="relative">
          <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="w-[170px] pl-9" />
        </div>
        {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}><X className="mr-1 h-4 w-4" />Clear</Button>}
        <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" />New Transfer</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : transfers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No transfer orders found.</div>
      ) : (
        <div className="space-y-2">
          {transfers.map((transfer) => (
            <div key={transfer.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border p-3", transfer.inventoryApplied && "bg-muted/20")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="font-medium">{transfer.voucherNumber}</span>{transfer.inventoryApplied ? <Badge variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" />Applied</Badge> : <Badge variant="outline"><Clock className="mr-1 h-3 w-3" />Pending</Badge>}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span>{formatDate(transfer.voucherDate)}</span><ArrowRight className="h-3 w-3" /><span>{transfer.destinationLocationName ?? `Location ${transfer.destinationLocationId}`}</span><span>•</span><span className="inline-flex items-center"><Package2 className="mr-1 h-3 w-3" />{transfer.stockItemNames?.join(", ") || "No items"}</span></div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => openView(transfer.id)} aria-label="View transfer"><Eye className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => setEditVoucherId(transfer.id)} aria-label="Edit transfer"><Pencil className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}

      <CreateTransferDialog open={createOpen} onClose={() => setCreateOpen(false)} myLocations={myLocations} />
      <ViewTransferDialog voucherId={viewVoucherId} open={viewDialogOpen} onClose={() => setViewDialogOpen(false)} />
    </section>
  );
}
