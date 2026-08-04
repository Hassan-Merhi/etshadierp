import {useMemo} from "react";
import {useQuery} from "@tanstack/react-query";
import {ArrowRight, CheckCircle2, Clock3, FileClock, Lock, MapPin, Package2, UserRound} from "lucide-react";
import {Badge} from "@/components/ui/badge";
import {Skeleton} from "@/components/ui/skeleton";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {cn} from "@/lib/utils";
import type {TransferDetail} from "../types";
import {fmtQty, formatDate, formatDateTime} from "../utils";

export function ViewTransferDialog({voucherId, open, onClose}: {voucherId: number | null; open: boolean; onClose: () => void}) {
  const {data: detail, isLoading} = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, {credentials: "include"});
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!voucherId && open,
  });

  const rows = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, {id: number; name: string; original: number; current: number; source?: string | null}>();
    for (const item of detail.items) {
      const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
      const qty = Number(item.quantity) || 0;
      map.set(key, {id: item.stockItemId, name: item.stockItemName, original: qty, current: qty, source: item.sourceLocationName});
    }
    for (const revision of [...(detail.revisions ?? [])].sort((a, b) => a.revisionNumber - b.revisionNumber)) {
      for (const item of revision.items) {
        const key = `${item.stockItemId}:${item.sourceLocationId ?? ""}`;
        const existing = map.get(key);
        map.set(key, {id: item.stockItemId, name: item.stockItemName, original: existing?.original ?? (Number(item.originalQuantity) || 0), current: Number(item.newQuantity) || 0, source: item.sourceLocationName ?? existing?.source});
      }
    }
    return Array.from(map.values());
  }, [detail]);

  const originalTotal = rows.reduce((sum, row) => sum + row.original, 0);
  const currentTotal = rows.reduce((sum, row) => sum + row.current, 0);
  const changedCount = rows.filter((row) => Math.abs(row.current - row.original) > 0.000001).length;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="border-b bg-muted/20 px-5 py-4">
          <div className="flex items-start justify-between gap-4 pr-7">
            <div><div className="flex items-center gap-2 flex-wrap"><DialogTitle className="font-mono text-lg">{detail?.voucherNumber ?? "Transfer Order"}</DialogTitle>{detail?.inventoryApplied ? <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><Lock className="h-3 w-3" />Applied</Badge> : <Badge variant="secondary" className="gap-1 text-amber-700 dark:text-amber-300"><Clock3 className="h-3 w-3" />Pending</Badge>}</div><DialogDescription className="mt-1">{detail ? formatDate(detail.voucherDate) : "Loading transfer details…"}</DialogDescription></div>
            {detail && <Badge variant="outline" className="gap-1"><FileClock className="h-3 w-3" />{detail.revisions?.length ?? 0} revisions</Badge>}
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-5 space-y-5">
          {isLoading ? <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-52 w-full" /></div> : detail ? <>
            <section className="grid gap-3 md:grid-cols-[1fr_auto_1fr] items-stretch"><LocationCard label="From location" name={detail.sourceLocationName || "Unknown source"} /><div className="hidden md:flex items-center"><div className="rounded-full border p-2"><ArrowRight className="h-4 w-4 text-muted-foreground" /></div></div><LocationCard label="To location" name={detail.destinationLocationName || "Unknown destination"} /></section>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Metric label="Items" value={String(rows.length)} /><Metric label="Original quantity" value={fmtQty(originalTotal)} mono /><Metric label="Current effective" value={fmtQty(currentTotal)} mono /><Metric label="Changed items" value={String(changedCount)} /></section>
            <section className="rounded-xl border overflow-hidden"><div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-3"><Package2 className="h-4 w-4" /><h3 className="text-sm font-semibold">Transferred items</h3></div><div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-[2rem_1fr_7rem_8rem_8rem_8rem] gap-3 border-b bg-muted/20 px-4 py-2 text-xs uppercase text-muted-foreground"><span>#</span><span>Item</span><span>Status</span><span className="text-right">Original</span><span className="text-right">Current</span><span className="text-right">Difference</span></div>{rows.length === 0 ? <div className="px-4 py-10 text-center text-sm text-muted-foreground">No item lines were returned for this transfer.</div> : rows.map((row, index) => {const difference = row.current - row.original; return <div key={`${row.id}-${index}`} className="grid grid-cols-[2rem_1fr_7rem_8rem_8rem_8rem] gap-3 items-center border-b last:border-b-0 px-4 py-3 text-sm"><span className="text-xs text-muted-foreground">{index + 1}</span><div className="min-w-0"><div className="font-medium truncate">{row.name}</div>{row.source && <div className="text-xs text-muted-foreground">From {row.source}</div>}</div><ChangeLabel original={row.original} current={row.current} /><Qty value={row.original} muted /><Qty value={row.current} bold /><Change value={difference} /></div>;})}</div></div></section>
            <section className="space-y-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><FileClock className="h-4 w-4" /><h3 className="text-sm font-semibold">Revision history</h3></div><span className="text-xs text-muted-foreground">Oldest to newest</span></div>{(detail.revisions?.length ?? 0) === 0 ? <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No revisions have been submitted.</div> : detail.revisions.slice().sort((a, b) => a.revisionNumber - b.revisionNumber).map((revision) => <article key={revision.id} className="rounded-xl border overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3"><div><div className="flex items-center gap-2"><span className="font-semibold">Revision #{revision.revisionNumber}</span>{revision.optional ? <Badge variant="outline" className="text-amber-700">Pending review</Badge> : <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3" />Approved</Badge>}</div><div className="mt-1 flex gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDateTime(revision.revisionDate ?? revision.createdAt ?? detail.voucherDate)}</span>{revision.createdBy && <span className="flex items-center gap-1"><UserRound className="h-3 w-3" />{revision.createdBy}</span>}</div></div><span className="text-xs text-muted-foreground">{revision.items.length} changed items</span></div>{revision.note && <div className="border-b px-4 py-3 text-sm text-muted-foreground">{revision.note}</div>}<div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-[1fr_7rem_7rem_7rem_7rem] gap-3 border-b bg-muted/10 px-4 py-2 text-xs uppercase text-muted-foreground"><span>Item</span><span>Status</span><span className="text-right">Previous</span><span className="text-right">Revised</span><span className="text-right">Change</span></div>{revision.items.map((item, index) => <div key={`${item.stockItemId}-${index}`} className="grid grid-cols-[1fr_7rem_7rem_7rem_7rem] gap-3 items-center border-b last:border-b-0 px-4 py-3 text-sm"><div className="min-w-0"><div className="font-medium truncate">{item.stockItemName}</div>{item.sourceLocationName && <div className="text-xs text-muted-foreground">From {item.sourceLocationName}</div>}</div><ChangeLabel original={Number(item.originalQuantity)} current={Number(item.newQuantity)} /><Qty value={Number(item.originalQuantity)} muted /><Qty value={Number(item.newQuantity)} bold /><Change value={Number(item.delta)} /></div>)}</div></div></article>)}</section>
          </> : <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">Failed to load this transfer order.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function changeKind(original: number, current: number) {if (original === 0 && current > 0) return "Added"; if (original > 0 && current === 0) return "Removed"; if (current > original) return "Increased"; if (current < original) return "Reduced"; return "Unchanged";}
function ChangeLabel({original, current}: {original: number; current: number}) {const label = changeKind(original, current); return <Badge variant="outline" className={cn("w-fit", label === "Added" || label === "Increased" ? "border-emerald-300 text-emerald-700" : label === "Removed" || label === "Reduced" ? "border-red-300 text-red-700" : "text-muted-foreground")}>{label}</Badge>;}
function LocationCard({label, name}: {label: string; name: string}) {return <div className="rounded-xl border p-4"><div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{label}</div><div className="mt-2 font-semibold">{name}</div></div>;}
function Metric({label, value, mono = false}: {label: string; value: string; mono?: boolean}) {return <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">{label}</div><div className={cn("mt-1 text-2xl font-semibold tabular-nums", mono && "font-mono")}>{value}</div></div>;}
function Qty({value, muted = false, bold = false}: {value: number; muted?: boolean; bold?: boolean}) {return <span className={cn("text-right font-mono tabular-nums", muted && "text-muted-foreground", bold && "font-semibold")}>{fmtQty(value)}</span>;}
function Change({value}: {value: number}) {return <span className={cn("text-right font-mono font-semibold tabular-nums", value > 0 ? "text-emerald-600" : value < 0 ? "text-destructive" : "text-muted-foreground")}>{value > 0 ? "+" : ""}{fmtQty(value)}</span>;}
