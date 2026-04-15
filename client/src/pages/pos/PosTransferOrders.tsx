import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft, ChevronRight, Loader2, Save,
  CheckCircle2, Search, X, ArrowRight, Clock, Package2, Lock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface PosUser {
  id: number;
  username: string;
  assignedLocationId?: number;
  posStation?: string;
}

interface PosTransferOrdersProps {
  posUser: PosUser;
}

interface TransferSummary {
  transferId: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  sourceLocationName: string;
  destinationLocationName: string;
  itemCount: number;
  totalAmount: number;
  stockItemNames: string[];
  inventoryApplied: boolean;
}

interface TransferDetailItem {
  id: number;
  transferId: number;
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number;
  sourceLocationName?: string;
  quantity: string;
}

interface RevisionItem {
  stockItemId: number;
  stockItemName: string;
  originalQuantity: string;
  delta: string;
  newQuantity: string;
}

interface Revision {
  id: number;
  revisionNumber: number;
  note?: string;
  optional: boolean;
  createdAt: string;
  items: RevisionItem[];
}

interface TransferDetail {
  transferId: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  optional: boolean;
  inventoryApplied: boolean;
  sourceLocationId?: number;
  sourceLocationName: string;
  destinationLocationId: number;
  destinationLocationName: string;
  notes?: string;
  items: TransferDetailItem[];
  revisions: Revision[];
}

interface InventoryItem {
  stockItemId: number;
  name: string;
  stockItemName?: string;
  locationId: number;
  quantity?: string;
}

function formatDate(dateStr: string) {
  try { return format(parseISO(dateStr), "MMM dd, yyyy"); } catch { return dateStr; }
}

function formatDateTime(dateStr: string) {
  try { return format(parseISO(dateStr), "MMM dd, yyyy HH:mm"); } catch { return dateStr; }
}

/** Format a quantity string/number removing trailing .000-style zeros */
function fmtQty(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  // Show up to 3 decimal places but strip trailing zeros
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

interface ExtraItem {
  stockItemId: number;
  stockItemName: string;
  qtyDraft: string;
}

function AddItemCombobox({
  inventory,
  alreadyAdded,
  existingIds,
  onAdd,
}: {
  inventory: { stockItemId: number; name: string; quantity: string }[];
  alreadyAdded: number[];
  existingIds: number[];
  onAdd: (inv: { stockItemId: number; name: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const alreadySet = new Set([...alreadyAdded, ...existingIds]);

  const matches = useMemo(() =>
    inventory
      .filter(i => !alreadySet.has(i.stockItemId) && i.name.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 30),
    [inventory, search, alreadyAdded, existingIds]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pick = (inv: { stockItemId: number; name: string }) => {
    onAdd(inv);
    setSearch("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const showDropdown = open && search.length > 0;

  return (
    <div ref={containerRef} className="border-t relative">
      <div className="relative px-3 py-2">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search items to add..."
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === "Escape") { setOpen(false); setSearch(""); }
            if (e.key === "Enter" && matches.length === 1) pick(matches[0]);
          }}
          className="w-full pl-7 pr-7 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-ring"
          data-testid="input-add-item-search"
          autoComplete="off"
        />
        {search && (
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setSearch(""); setOpen(false); inputRef.current?.focus(); }}
            className="absolute right-5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center text-muted-foreground hover-elevate"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {showDropdown && (
        <div className="absolute left-0 right-0 z-50 bg-popover border-x border-b rounded-b-md shadow-md max-h-52 overflow-y-auto">
          {matches.length === 0 ? (
            <div className="text-xs text-muted-foreground px-4 py-3 text-center">No items found</div>
          ) : matches.map(inv => {
            const qty = parseFloat(inv.quantity);
            return (
              <button
                key={inv.stockItemId}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(inv); }}
                className="w-full text-left px-4 py-2.5 text-sm hover-elevate border-b last:border-b-0 flex items-center justify-between gap-4"
                data-testid={`button-pick-${inv.stockItemId}`}
              >
                <span className="truncate">{inv.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                  {qty > 0 ? `${qty} in stock` : "0 in stock"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Read-only locked detail view (applied transfers) ─────────────────────────
function LockedTransferDetail({
  detail,
}: {
  detail: TransferDetail;
}) {
  return (
    <div className="space-y-4">
      {/* Locked notice */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-md text-sm text-muted-foreground border">
        <Lock className="h-4 w-4 shrink-0" />
        <span>This transfer has been applied to inventory and is locked for editing.</span>
      </div>

      {/* Items table — read-only */}
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-2.5 bg-muted/30">
          <h3 className="text-sm font-semibold">Items</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 text-xs">#</TableHead>
              <TableHead className="text-xs">Item</TableHead>
              <TableHead className="text-right text-xs">Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.items.map((item, idx) => (
              <TableRow key={item.id}>
                <TableCell className="text-xs text-muted-foreground py-2">{idx + 1}</TableCell>
                <TableCell className="text-sm font-medium py-2">{item.stockItemName}</TableCell>
                <TableCell className="text-right font-mono text-sm py-2">{parseFloat(item.quantity)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/20">
              <TableCell />
              <TableCell className="text-xs font-semibold py-2">Total items</TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold py-2">
                {detail.items.reduce((s, i) => s + parseFloat(i.quantity), 0)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Revision history */}
      {(detail.revisions?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revision History</span>
          </div>
          {detail.revisions.map(rev => (
            <Card key={rev.id} data-testid={`card-revision-${rev.id}`}>
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Revision #{rev.revisionNumber}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                  </div>
                  {rev.optional ? (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-pending-${rev.id}`}>Pending Admin Review</Badge>
                  ) : (
                    <Badge variant="default" className="text-xs" data-testid={`badge-approved-${rev.id}`}>
                      <CheckCircle2 className="h-3 w-3 mr-1" />Approved
                    </Badge>
                  )}
                </div>
                {rev.note && <p className="text-xs text-muted-foreground">{rev.note}</p>}
                <div className="divide-y rounded-md border overflow-hidden">
                  {rev.items.map((ri, i) => {
                    const delta = parseFloat(ri.delta);
                    return (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs gap-4 bg-card"
                        data-testid={`text-rev-item-${rev.id}-${i}`}>
                        <span className="font-medium truncate">{ri.stockItemName}</span>
                        <div className="flex items-center gap-2 shrink-0 font-mono">
                          <span className="text-muted-foreground">{ri.originalQuantity}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-semibold">{ri.newQuantity}</span>
                          <span className={cn(
                            "font-medium",
                            delta > 0 ? "text-green-600 dark:text-green-400" : "text-destructive"
                          )}>
                            ({delta > 0 ? "+" : ""}{ri.delta})
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Editable detail view ─────────────────────────────────────────────────────
function EditableTransferDetail({
  detail,
  posUser,
  voucherId,
}: {
  detail: TransferDetail;
  posUser: PosUser;
  voucherId: number;
}) {
  const { toast } = useToast();
  const [deltas, setDeltas] = useState<Record<number, string>>({});
  const [extraItems, setExtraItems] = useState<ExtraItem[]>([]);
  const [note, setNote] = useState("");

  const { data: rawInventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory", posUser.assignedLocationId],
    queryFn: async () => {
      if (!posUser.assignedLocationId) return [];
      const res = await fetch(`/api/locations/${posUser.assignedLocationId}/inventory`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!posUser.assignedLocationId,
  });

  const revisionMutation = useMutation({
    mutationFn: async (payload: { transferId: number; note: string; items: any[] }) => {
      return apiRequest("POST", `/api/stock-transfers/${payload.transferId}/revisions`, {
        note: payload.note,
        items: payload.items,
        optional: true,
      });
    },
    onSuccess: () => {
      toast({ title: "Revision saved", description: "Your adjustments have been submitted for the admin to review." });
      queryClient.invalidateQueries({ queryKey: ["/api/pos-transfer-detail", voucherId] });
      setDeltas({});
      setExtraItems([]);
      setNote("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getDeltaNum = (itemId: number): number => {
    const val = (deltas[itemId] ?? "").trim();
    if (!val || val === "-" || val === "+") return 0;
    return parseFloat(val) || 0;
  };

  const setDeltaVal = (itemId: number, val: string) => {
    setDeltas(prev => ({ ...prev, [itemId]: val }));
  };

  const normalizeDelta = (itemId: number) => {
    const val = (deltas[itemId] ?? "").trim();
    if (!val || val === "-" || val === "+") { setDeltaVal(itemId, ""); return; }
    const num = parseFloat(val) || 0;
    setDeltaVal(itemId, num === 0 ? "" : String(num));
  };

  const myItems = detail.items;

  const locationInventory = (rawInventory as any[]).map(i => ({
    stockItemId: i.stockItemId ?? i.id,
    name: i.stockItemName ?? i.name ?? "",
    quantity: i.quantity ?? "0",
  }));

  const addExtraItem = (inv: { stockItemId: number; name: string }) => {
    setExtraItems(prev => [...prev, { stockItemId: inv.stockItemId, stockItemName: inv.name, qtyDraft: "" }]);
  };

  const updateExtraQty = (idx: number, val: string) => {
    setExtraItems(prev => prev.map((it, i) => i === idx ? { ...it, qtyDraft: val } : it));
  };

  const removeExtra = (idx: number) => {
    setExtraItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    const baseItems = myItems.map(item => {
      const delta = getDeltaNum(item.id);
      const original = parseFloat(item.quantity) || 0;
      return {
        stockItemId: item.stockItemId,
        stockItemName: item.stockItemName,
        sourceLocationId: item.sourceLocationId ?? detail.sourceLocationId,
        sourceLocationName: item.sourceLocationName ?? detail.sourceLocationName,
        originalQuantity: item.quantity,
        delta: String(delta),
        newQuantity: String(original + delta),
      };
    });

    const newItems = extraItems
      .map(e => ({ ...e, qty: parseFloat(e.qtyDraft) || 0 }))
      .filter(e => e.qty !== 0)
      .map(e => ({
        stockItemId: e.stockItemId,
        stockItemName: e.stockItemName,
        sourceLocationId: posUser.assignedLocationId,
        sourceLocationName: detail.sourceLocationName,
        originalQuantity: "0",
        delta: String(e.qty),
        newQuantity: String(e.qty),
      }));

    const allItems = [...baseItems, ...newItems];
    if (allItems.length === 0) {
      toast({ title: "No changes", description: "Adjust at least one item quantity.", variant: "destructive" });
      return;
    }

    revisionMutation.mutate({ transferId: detail.transferId, note, items: allItems });
  };

  const hasChanges =
    myItems.some(i => getDeltaNum(i.id) !== 0) ||
    extraItems.some(e => (parseFloat(e.qtyDraft) || 0) !== 0);

  return (
    <div className="space-y-4">
      {/* Main table card */}
      <Card className="overflow-hidden">
        <div className="hidden sm:grid grid-cols-[2rem_1fr_6rem_7rem_6rem_2.5rem] bg-muted/30 border-b px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <span>#</span>
          <span>Item</span>
          <span className="text-right">Original</span>
          <span className="text-center">Adjustment</span>
          <span className="text-right">New Qty</span>
          <span />
        </div>

        <div>
          {myItems.map((item, idx) => {
            const deltaNum = getDeltaNum(item.id);
            const original = parseFloat(item.quantity) || 0;
            const newQty = original + deltaNum;
            const changed = deltaNum !== 0;
            return (
              <div
                key={item.id}
                data-testid={`row-item-${item.id}`}
                className={cn("border-b last:border-b-0", changed && "bg-primary/5")}
              >
                <div className="hidden sm:grid grid-cols-[2rem_1fr_6rem_7rem_6rem_2.5rem] items-center px-3 py-1.5 gap-2">
                  <span className="text-xs text-muted-foreground">{idx + 1}</span>
                  <span className="text-sm font-medium truncate">{item.stockItemName}</span>
                  <span className="text-sm font-mono text-right">{original}</span>
                  <div className="flex items-center justify-center">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={deltas[item.id] ?? ""}
                      onChange={e => setDeltaVal(item.id, e.target.value)}
                      onBlur={() => normalizeDelta(item.id)}
                      className="w-16 text-center text-sm border rounded bg-background px-1 py-0.5 font-mono outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-delta-${item.id}`}
                    />
                  </div>
                  <span className={cn(
                    "text-sm font-mono font-semibold text-right",
                    changed && (deltaNum > 0 ? "text-green-600 dark:text-green-400" : "text-destructive")
                  )}>
                    {newQty}
                  </span>
                  <div />
                </div>

                <div className="sm:hidden p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{item.stockItemName}</span>
                    <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-muted-foreground">Original: <strong className="text-foreground">{original}</strong></span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={deltas[item.id] ?? ""}
                      onChange={e => setDeltaVal(item.id, e.target.value)}
                      onBlur={() => normalizeDelta(item.id)}
                      className="w-16 text-center text-sm border rounded bg-background px-2 py-1 font-mono outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-delta-mobile-${item.id}`}
                    />
                    {changed && (
                      <span className={cn("text-xs font-semibold", deltaNum > 0 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                        New: {newQty}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {extraItems.map((item, idx) => {
            const qty = parseFloat(item.qtyDraft) || 0;
            return (
              <div
                key={`extra-${item.stockItemId}`}
                className="border-b last:border-b-0 bg-primary/5"
                data-testid={`row-extra-${item.stockItemId}`}
              >
                <div className="hidden sm:grid grid-cols-[2rem_1fr_6rem_7rem_6rem_2.5rem] items-center px-3 py-1.5 gap-2">
                  <span className="text-xs text-muted-foreground">{myItems.length + idx + 1}</span>
                  <span className="text-sm font-medium truncate">{item.stockItemName}</span>
                  <span className="text-sm font-mono text-right text-muted-foreground">0</span>
                  <div className="flex items-center justify-center">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={item.qtyDraft}
                      onChange={e => updateExtraQty(idx, e.target.value)}
                      className="w-16 text-center text-sm border rounded bg-background px-1 py-0.5 font-mono outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-extra-qty-${item.stockItemId}`}
                    />
                  </div>
                  <span className={cn(
                    "text-sm font-mono font-semibold text-right",
                    qty > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                  )}>
                    {qty > 0 ? qty : "—"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeExtra(idx)}
                    className="h-6 w-6 flex items-center justify-center rounded hover-elevate text-muted-foreground"
                    data-testid={`button-remove-extra-${item.stockItemId}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <div className="sm:hidden p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{item.stockItemName}</span>
                    <button type="button" onClick={() => removeExtra(idx)}
                      className="h-6 w-6 flex items-center justify-center rounded hover-elevate text-muted-foreground"
                      data-testid={`button-remove-extra-mobile-${item.stockItemId}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-muted-foreground">Original: <strong className="text-foreground">0</strong></span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={item.qtyDraft}
                      onChange={e => updateExtraQty(idx, e.target.value)}
                      className="w-16 text-center text-sm border rounded bg-background px-2 py-1 font-mono outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-extra-qty-mobile-${item.stockItemId}`}
                    />
                    {qty > 0 && (
                      <span className="text-xs font-semibold text-green-600 dark:text-green-400">New: {qty}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <AddItemCombobox
          inventory={locationInventory}
          alreadyAdded={extraItems.map(e => e.stockItemId)}
          existingIds={myItems.map(i => i.stockItemId)}
          onAdd={addExtraItem}
        />

        <div className="border-t px-3 py-2 bg-muted/30 flex items-center justify-end gap-4 text-xs text-muted-foreground">
          <span>Total Items: <strong className="text-foreground">{myItems.length + extraItems.length}</strong></span>
        </div>
      </Card>

      {/* Notes + Save */}
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        <Textarea
          placeholder="Notes (optional)..."
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          className="resize-none text-sm flex-1"
          data-testid="textarea-revision-note"
        />
        <Button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges || revisionMutation.isPending}
          className="w-full sm:w-auto shrink-0"
          data-testid="button-save-revision"
        >
          {revisionMutation.isPending ? (
            <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Saving...</>
          ) : (
            <><Save className="h-4 w-4 mr-1.5" />Save Revision</>
          )}
        </Button>
      </div>

      {/* Revision history */}
      {(detail.revisions?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revision History</span>
          </div>
          {detail.revisions.map(rev => (
            <Card key={rev.id} data-testid={`card-revision-${rev.id}`}>
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Revision #{rev.revisionNumber}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                  </div>
                  {rev.optional ? (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-pending-${rev.id}`}>Pending Admin Review</Badge>
                  ) : (
                    <Badge variant="default" className="text-xs" data-testid={`badge-approved-${rev.id}`}>
                      <CheckCircle2 className="h-3 w-3 mr-1" />Approved
                    </Badge>
                  )}
                </div>
                {rev.note && <p className="text-xs text-muted-foreground">{rev.note}</p>}
                <div className="divide-y rounded-md border overflow-hidden">
                  {rev.items.map((ri, i) => {
                    const delta = parseFloat(ri.delta);
                    return (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs gap-4 bg-card"
                        data-testid={`text-rev-item-${rev.id}-${i}`}>
                        <span className="font-medium truncate">{ri.stockItemName}</span>
                        <div className="flex items-center gap-2 shrink-0 font-mono">
                          <span className="text-muted-foreground">{fmtQty(ri.originalQuantity)}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="font-semibold">{fmtQty(ri.newQuantity)}</span>
                          <span className={cn("font-medium", delta > 0 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                            ({delta > 0 ? "+" : ""}{fmtQty(ri.delta)})
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Detail shell (loads data, decides locked vs editable) ────────────────────
function TransferOrderDetail({
  voucherId,
  posUser,
  onBack,
}: {
  voucherId: number;
  posUser: PosUser;
  onBack: () => void;
}) {
  const { data: detail, isLoading } = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-3 p-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1.5" />Back</Button>
        <p className="text-sm text-destructive">Failed to load order.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1.5 text-sm flex-1 min-w-0 flex-wrap">
          <span className="font-semibold" data-testid="text-voucher-number">{detail.voucherNumber}</span>
          <span className="text-muted-foreground hidden sm:inline">&middot;</span>
          <span className="text-muted-foreground hidden sm:inline">{formatDate(detail.voucherDate)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{detail.sourceLocationName}</span>
          <ArrowRight className="h-3 w-3" />
          <span className="font-medium text-foreground">{detail.destinationLocationName}</span>
        </div>
        {detail.inventoryApplied && (
          <Badge variant="secondary" className="gap-1">
            <Lock className="h-3 w-3" />Applied
          </Badge>
        )}
        {detail.optional && !detail.inventoryApplied && <Badge variant="outline">Draft</Badge>}
      </div>

      {detail.inventoryApplied ? (
        <LockedTransferDetail detail={detail} />
      ) : (
        <EditableTransferDetail detail={detail} posUser={posUser} voucherId={voucherId} />
      )}
    </div>
  );
}

// ─── List view ────────────────────────────────────────────────────────────────
export default function PosTransferOrders({ posUser }: PosTransferOrdersProps) {
  const [selectedVoucherId, setSelectedVoucherId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const { data: allTransfers = [], isLoading } = useQuery<TransferSummary[]>({
    queryKey: ["/api/stock-transfers/list"],
    queryFn: async () => {
      const res = await fetch("/api/stock-transfers/list", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const transfers = useMemo(() => {
    return allTransfers.filter(t => {
      if (!t.destinationLocationName?.toLowerCase().includes("kolwezi")) return false;
      const s = search.toLowerCase().trim();
      if (!s) return true;
      return t.voucherNumber?.toLowerCase().includes(s) ||
        t.stockItemNames?.some(n => n.toLowerCase().includes(s));
    });
  }, [allTransfers, search]);

  if (selectedVoucherId !== null) {
    return (
      <div className="p-4">
        <TransferOrderDetail
          voucherId={selectedVoucherId}
          posUser={posUser}
          onBack={() => setSelectedVoucherId(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Page header */}
      <div>
        <h1 className="text-base font-semibold" data-testid="text-page-title">Kolwezi Transfer Orders</h1>
        <p className="text-xs text-muted-foreground">Review and adjust quantities for your location</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search voucher or item..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
          data-testid="input-list-search"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="border rounded-md divide-y overflow-hidden">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-4 py-3 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-64" />
            </div>
          ))}
        </div>
      ) : transfers.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-empty">
          <Package2 className="h-10 w-10 mx-auto mb-2 opacity-25" />
          <p className="text-sm">No Kolwezi transfer orders found</p>
        </div>
      ) : (
        <div className="border rounded-md divide-y overflow-hidden">
          {transfers.map(t => (
            <button
              key={t.voucherId}
              type="button"
              onClick={() => setSelectedVoucherId(t.voucherId)}
              className="w-full text-left px-4 py-3 hover-elevate flex items-center gap-3 bg-card"
              data-testid={`row-transfer-${t.voucherId}`}
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                {/* Row 1: voucher number + badges + date */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold font-mono" data-testid={`text-voucher-${t.voucherId}`}>
                    {t.voucherNumber}
                  </span>
                  {t.inventoryApplied ? (
                    <Badge variant="secondary" className="text-xs gap-1" data-testid={`badge-applied-${t.voucherId}`}>
                      <Lock className="h-2.5 w-2.5" />Applied
                    </Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{t.destinationLocationName}</span>
                </div>
                {/* Row 2: date */}
                <div className="text-xs text-muted-foreground">
                  {formatDate(t.voucherDate)}
                </div>
                {/* Row 3: item names preview */}
                {(t.stockItemNames?.length ?? 0) > 0 && (
                  <div className="text-xs text-muted-foreground truncate">
                    {t.stockItemNames.slice(0, 3).join(", ")}
                    {t.stockItemNames.length > 3 ? ` +${t.stockItemNames.length - 3} more` : ""}
                  </div>
                )}
              </div>
              {/* Right side: item count + chevron */}
              <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                <span className="text-xs">{t.itemCount} items</span>
                <ChevronRight className="h-4 w-4" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
