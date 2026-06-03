import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { PageHeader } from "@/components/PageHeader";
import {
  ArrowLeft, Loader2, Save, CheckCircle2, Search, X, ArrowRight,
  Clock, Package2, Lock, Eye, Pencil, Filter, CalendarIcon, Plus, Trash2,
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  sourceLocationId?: number;
  sourceLocationName: string;
  destinationLocationId: number;
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
  sourceLocationName?: string | null;
  originalQuantity: string;
  delta: string;
  newQuantity: string;
}

interface Revision {
  id: number;
  revisionNumber: number;
  note?: string;
  optional: boolean;
  createdBy?: number | null;
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

interface ExtraItem {
  stockItemId: number;
  stockItemName: string;
  qtyDraft: string;
}

function formatDate(dateStr: string) {
  try { return format(parseISO(dateStr), "MM/dd/yyyy"); } catch { return dateStr; }
}

function formatDateTime(dateStr: string) {
  try { return format(parseISO(dateStr), "MM/dd/yyyy HH:mm"); } catch { return dateStr; }
}

function fmtQty(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

// ─── Right-side item search panel (results only — input lives in the bar) ──────
function ItemSearchPanel({
  matches,
  activeIdx,
  locationName,
  onActiveChange,
  onPick,
  onClose,
}: {
  matches: { stockItemId: number; name: string; quantity: string }[];
  activeIdx: number;
  locationName: string;
  onActiveChange: (i: number) => void;
  onPick: (item: { stockItemId: number; name: string }) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const active = listRef.current.querySelector("[data-active=true]") as HTMLElement | null;
      active?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-start justify-between gap-2 px-3 py-3 border-b">
        <div>
          <div className="font-semibold text-sm">Search Items</div>
          <div className="text-xs text-muted-foreground">{locationName}</div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} className="shrink-0 -mr-1 -mt-0.5" data-testid="button-close-search-panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Items list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {matches.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">No items found</div>
        ) : (
          matches.map((item, i) => {
            const qty = parseFloat(item.quantity) || 0;
            const inStock = qty > 0;
            return (
              <button
                key={item.stockItemId}
                type="button"
                data-active={i === activeIdx}
                onClick={() => onPick(item)}
                onMouseEnter={() => onActiveChange(i)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm border-b last:border-b-0 flex items-center justify-between gap-2 transition-none",
                  i === activeIdx ? "bg-accent text-accent-foreground" : "hover-elevate"
                )}
                data-testid={`button-panel-item-${item.stockItemId}`}
              >
                <span className="truncate font-medium">{item.name}</span>
                {inStock ? (
                  <span className="text-xs font-mono shrink-0 tabular-nums font-semibold">
                    {fmtQty(qty)}
                  </span>
                ) : (
                  <span className="text-xs shrink-0 px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    Out
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Editable detail view ─────────────────────────────────────────────────────
function EditableTransferDetail({
  detail, posUser, voucherId, onBack,
}: {
  detail: TransferDetail;
  posUser: PosUser;
  voucherId: number;
  onBack: () => void;
}) {
  const { toast } = useToast();

  // Pre-populate from any existing pending revision (so user sees their prior adjustments)
  const [deltas, setDeltas] = useState<Record<number, string>>(() => {
    const pending = detail.revisions.find(r => r.optional);
    if (!pending) return {};
    const stockItemToId = new Map(detail.items.map(i => [i.stockItemId, i.id]));
    const init: Record<number, string> = {};
    for (const ri of pending.items) {
      const transferItemId = stockItemToId.get(ri.stockItemId);
      if (transferItemId !== undefined && parseFloat(ri.originalQuantity) > 0) {
        const d = parseFloat(ri.delta);
        if (d !== 0) init[transferItemId] = String(d);
      }
    }
    return init;
  });

  const [extraItems, setExtraItems] = useState<ExtraItem[]>(() => {
    const pending = detail.revisions.find(r => r.optional);
    if (!pending) return [];
    const baseIds = new Set(detail.items.map(i => i.stockItemId));
    return pending.items
      .filter(ri => !baseIds.has(ri.stockItemId) || parseFloat(ri.originalQuantity) === 0)
      .filter(ri => parseFloat(ri.newQuantity) > 0)
      .map(ri => ({
        stockItemId: ri.stockItemId,
        stockItemName: ri.stockItemName,
        qtyDraft: fmtQty(ri.newQuantity),
      }));
  });

  const [note, setNote] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelSearch, setPanelSearch] = useState("");
  const [panelActiveIdx, setPanelActiveIdx] = useState(0);
  const searchBarRef = useRef<HTMLInputElement>(null);
  const deltaRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Use the transfer's source location for inventory lookup so multi-location users
  // only see items from the location this transfer is sending FROM.
  const inventoryLocationId = detail.sourceLocationId ?? posUser.assignedLocationId;
  const { data: rawInventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory", inventoryLocationId],
    queryFn: async () => {
      if (!inventoryLocationId) return [];
      const res = await fetch(`/api/locations/${inventoryLocationId}/inventory`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!inventoryLocationId,
  });

  const revisionMutation = useMutation({
    mutationFn: async (payload: { transferId: number; note: string; items: any[] }) => {
      return apiRequest("POST", `/api/stock-transfers/${payload.transferId}/revisions`, {
        note: payload.note, items: payload.items, optional: true,
      });
    },
    onSuccess: () => {
      toast({ title: "Revision saved", description: "Adjustments submitted for admin review." });
      queryClient.invalidateQueries({ queryKey: ["/api/pos-transfer-detail", voucherId] });
      setNote("");
    },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const getDeltaNum = (id: number) => {
    const v = (deltas[id] ?? "").trim();
    if (!v || v === "-" || v === "+") return 0;
    return parseFloat(v) || 0;
  };
  const setDeltaVal = (id: number, v: string) => setDeltas(p => ({ ...p, [id]: v }));
  const normalizeDelta = (id: number) => {
    const v = (deltas[id] ?? "").trim();
    if (!v || v === "-" || v === "+") { setDeltaVal(id, ""); return; }
    const n = parseFloat(v) || 0;
    setDeltaVal(id, n === 0 ? "" : String(n));
  };

  const myItems = detail.items;
  const locationInventory = (rawInventory as any[]).map(i => ({
    stockItemId: i.stockItemId ?? i.id,
    name: i.stockItemName ?? i.name ?? "",
    quantity: i.quantity ?? "0",
  }));

  const alreadyAddedIds = new Set([
    ...extraItems.map(e => e.stockItemId),
    ...myItems.map(i => i.stockItemId),
  ]);

  const panelMatches = useMemo(() =>
    locationInventory.filter(i =>
      !alreadyAddedIds.has(i.stockItemId) &&
      i.name.toLowerCase().includes(panelSearch.toLowerCase())
    ),
    [locationInventory, panelSearch, extraItems, myItems]
  );

  useEffect(() => { setPanelActiveIdx(0); }, [panelSearch]);

  const addExtraItem = (inv: { stockItemId: number; name: string }) => {
    setExtraItems(p => [...p, { stockItemId: inv.stockItemId, stockItemName: inv.name, qtyDraft: "" }]);
    setPanelSearch("");
    // focus the new extra item's adjustment input after render
    setTimeout(() => {
      deltaRefs.current[`extra-${inv.stockItemId}`]?.focus();
    }, 50);
  };

  const openPanel = () => {
    setPanelOpen(true);
    setTimeout(() => searchBarRef.current?.focus(), 30);
  };

  const updateExtraQty = (idx: number, val: string) =>
    setExtraItems(p => p.map((it, i) => i === idx ? { ...it, qtyDraft: val } : it));
  const removeExtra = (idx: number) => setExtraItems(p => p.filter((_, i) => i !== idx));

  // Ordered list of all delta input keys for keyboard navigation
  const getAllInputKeys = useCallback(() => [
    ...myItems.map(i => `base-${i.id}`),
    ...extraItems.map(e => `extra-${e.stockItemId}`),
  ], [myItems, extraItems]);

  const focusRelative = useCallback((currentKey: string, direction: 1 | -1) => {
    const keys = getAllInputKeys();
    const idx = keys.indexOf(currentKey);
    if (idx === -1) return;
    const next = idx + direction;
    if (next >= 0 && next < keys.length) {
      const el = deltaRefs.current[keys[next]];
      el?.focus();
      el?.select();
    } else if (direction === 1) {
      searchBarRef.current?.focus();
    }
  }, [getAllInputKeys]);

  const handleSave = () => {
    // Only send items whose delta is non-zero (supports both + and - adjustments)
    const changedBaseItems = myItems
      .map(item => {
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
      })
      .filter(item => parseFloat(item.delta) !== 0);

    const myLocationName = myItems[0]?.sourceLocationName ?? detail.sourceLocationName;
    const newItems = extraItems
      .map(e => ({ ...e, qty: parseFloat(e.qtyDraft) || 0 }))
      .filter(e => e.qty !== 0)
      .map(e => ({
        stockItemId: e.stockItemId,
        stockItemName: e.stockItemName,
        sourceLocationId: posUser.assignedLocationId,
        sourceLocationName: myLocationName,
        originalQuantity: "0",
        delta: String(e.qty),
        newQuantity: String(e.qty),
      }));

    const allItems = [...changedBaseItems, ...newItems];
    if (allItems.length === 0) {
      toast({ title: "No changes", description: "Adjust at least one item quantity.", variant: "destructive" });
      return;
    }
    revisionMutation.mutate({ transferId: detail.transferId, note, items: allItems });
  };

  const hasChanges =
    myItems.some(i => getDeltaNum(i.id) !== 0) ||
    extraItems.some(e => (parseFloat(e.qtyDraft) || 0) !== 0);

  const totalItems = myItems.length + extraItems.length;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
          <span className="font-semibold font-mono" data-testid="text-voucher-number">{detail.voucherNumber}</span>
          <span className="text-muted-foreground">&middot;</span>
          <span className="text-muted-foreground">{formatDate(detail.voucherDate)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">{detail.sourceLocationName}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold">{detail.destinationLocationName}</span>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Table */}
          <div className="border rounded-md overflow-hidden">
            {/* Column header */}
            <div className="grid grid-cols-[1.5rem_1fr_5rem_5rem] sm:grid-cols-[2rem_1fr_5.5rem_6.5rem_5.5rem_2rem] bg-muted/40 border-b px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-2">
              <span>#</span>
              <span>Item</span>
              <span className="hidden sm:block text-right">Original</span>
              <span className="text-center">Adj</span>
              <span className="text-right">New Qty</span>
              <span className="hidden sm:block" />
            </div>

            {/* Existing items */}
            {myItems.map((item, idx) => {
              const deltaNum = getDeltaNum(item.id);
              const original = parseFloat(item.quantity) || 0;
              const newQty = original + deltaNum;
              const changed = deltaNum !== 0;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "grid grid-cols-[1.5rem_1fr_5rem_5rem] sm:grid-cols-[2rem_1fr_5.5rem_6.5rem_5.5rem_2rem] items-center px-3 py-1.5 gap-2 border-b last:border-b-0 group",
                    changed && "bg-primary/5"
                  )}
                  data-testid={`row-item-${item.id}`}
                >
                  <span className="text-xs text-muted-foreground tabular-nums">{idx + 1}</span>

                  {/* Item name — click to open search panel */}
                  <button
                    type="button"
                    onClick={() => openPanel()}
                    className="text-sm font-medium text-left truncate hover:text-primary transition-colors cursor-pointer"
                    title={item.stockItemName}
                    data-testid={`button-item-name-${item.id}`}
                  >
                    {item.stockItemName}
                  </button>

                  <span className="hidden sm:block text-sm font-mono text-right tabular-nums">{fmtQty(original)}</span>

                  <div className="flex justify-center">
                    <input
                      ref={el => { deltaRefs.current[`base-${item.id}`] = el; }}
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={deltas[item.id] ?? ""}
                      onChange={e => setDeltaVal(item.id, e.target.value)}
                      onBlur={() => normalizeDelta(item.id)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                          e.preventDefault();
                          normalizeDelta(item.id);
                          focusRelative(`base-${item.id}`, 1);
                        } else if (e.key === "Tab" && e.shiftKey) {
                          e.preventDefault();
                          normalizeDelta(item.id);
                          focusRelative(`base-${item.id}`, -1);
                        }
                      }}
                      className="w-full text-center text-sm border rounded-md bg-background px-1 py-1 font-mono outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-delta-${item.id}`}
                    />
                  </div>

                  <span className={cn(
                    "text-sm font-mono font-semibold text-right tabular-nums",
                    changed
                      ? deltaNum > 0 ? "text-green-600 dark:text-green-400" : "text-destructive"
                      : ""
                  )}>
                    {fmtQty(newQty)}
                  </span>

                  <div className="hidden sm:block" />
                </div>
              );
            })}

            {/* Extra (newly added) items */}
            {extraItems.map((item, idx) => {
              const qty = parseFloat(item.qtyDraft) || 0;
              return (
                <div
                  key={`extra-${item.stockItemId}`}
                  className="grid grid-cols-[1.5rem_1fr_5rem_5rem] sm:grid-cols-[2rem_1fr_5.5rem_6.5rem_5.5rem_2rem] items-center px-3 py-1.5 gap-2 border-b last:border-b-0 bg-primary/5"
                  data-testid={`row-extra-${item.stockItemId}`}
                >
                  <span className="text-xs text-muted-foreground tabular-nums">{myItems.length + idx + 1}</span>

                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-sm font-medium truncate flex-1" title={item.stockItemName}>{item.stockItemName}</span>
                    {/* Delete button: visible inline on mobile, hidden on sm+ (uses its own grid cell there) */}
                    <button
                      type="button"
                      onClick={() => removeExtra(idx)}
                      className="sm:hidden shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                      data-testid={`button-remove-extra-mobile-${item.stockItemId}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>

                  <span className="hidden sm:block text-sm font-mono text-right text-muted-foreground">0</span>

                  <div className="flex justify-center">
                    <input
                      ref={el => { deltaRefs.current[`extra-${item.stockItemId}`] = el; }}
                      type="text"
                      inputMode="decimal"
                      placeholder="0"
                      value={item.qtyDraft}
                      onChange={e => updateExtraQty(idx, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                          e.preventDefault();
                          focusRelative(`extra-${item.stockItemId}`, 1);
                        } else if (e.key === "Tab" && e.shiftKey) {
                          e.preventDefault();
                          focusRelative(`extra-${item.stockItemId}`, -1);
                        }
                      }}
                      className="w-full text-center text-sm border rounded-md bg-background px-1 py-1 font-mono outline-none focus:ring-1 focus:ring-ring"
                      data-testid={`input-extra-qty-${item.stockItemId}`}
                    />
                  </div>

                  <span className={cn(
                    "text-sm font-mono font-semibold text-right tabular-nums",
                    qty > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                  )}>
                    {qty > 0 ? fmtQty(qty) : "—"}
                  </span>

                  {/* Delete button: only in its own grid cell on sm+ */}
                  <button
                    type="button"
                    onClick={() => removeExtra(idx)}
                    className="hidden sm:flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                    data-testid={`button-remove-extra-${item.stockItemId}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}

            {/* Search-to-add bar — a real typeable input */}
            <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/10">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={searchBarRef}
                type="text"
                placeholder="Search items to add..."
                value={panelSearch}
                onChange={e => {
                  setPanelSearch(e.target.value);
                  if (!panelOpen) setPanelOpen(true);
                }}
                onFocus={() => { if (!panelOpen) setPanelOpen(true); }}
                onKeyDown={e => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setPanelActiveIdx(i => Math.min(i + 1, panelMatches.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setPanelActiveIdx(i => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (panelMatches[panelActiveIdx]) addExtraItem(panelMatches[panelActiveIdx]);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setPanelOpen(false);
                    setPanelSearch("");
                  } else if (e.key === "Tab") {
                    setPanelOpen(false);
                    setPanelSearch("");
                  }
                }}
                className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                data-testid="input-search-bar"
                autoComplete="off"
              />
              {panelSearch && (
                <button
                  type="button"
                  onClick={() => { setPanelSearch(""); searchBarRef.current?.focus(); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-3 py-1.5 bg-muted/20 flex justify-end text-xs text-muted-foreground">
              Total Items: <strong className="text-foreground ml-1">{totalItems}</strong>
            </div>
          </div>

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
              {revisionMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Saving...</>
                : <><Save className="h-4 w-4 mr-1.5" />Save Revision</>}
            </Button>
          </div>

          {/* Revision history */}
          {(detail.revisions?.length ?? 0) > 0 && (
            <div className="space-y-2 pb-4">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revision History</span>
              </div>
              {detail.revisions.map(rev => {
                const revLocName = rev.items[0]?.sourceLocationName ?? null;
                return (
                <Card key={rev.id} data-testid={`card-revision-${rev.id}`}>
                  <CardContent className="pt-3 pb-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">Revision #{rev.revisionNumber}</span>
                        {revLocName && (
                          <span className="text-xs text-muted-foreground">· From: <span className="font-medium text-foreground">{revLocName}</span></span>
                        )}
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
                    {rev.note && <p className="text-xs text-muted-foreground italic">{rev.note}</p>}
                    <div className="rounded-md border overflow-hidden">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] bg-muted/30 border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-x-4">
                        <span>Item</span>
                        <span className="text-right">Was</span>
                        <span className="text-right">Now</span>
                        <span className="text-right">Change</span>
                      </div>
                      {rev.items.filter((ri) => parseFloat(ri.delta) !== 0).map((ri, i) => {
                        const delta = parseFloat(ri.delta);
                        return (
                          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center px-3 py-2 text-xs gap-x-4 bg-card border-b last:border-b-0" data-testid={`text-rev-item-${rev.id}-${i}`}>
                            <span className="font-medium">{ri.stockItemName}</span>
                            <span className="font-mono text-right text-muted-foreground">{fmtQty(ri.originalQuantity)}</span>
                            <span className="font-mono font-semibold text-right">{fmtQty(ri.newQuantity)}</span>
                            <span className={cn("font-mono font-semibold text-right", delta > 0 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                              {delta > 0 ? "+" : ""}{fmtQty(ri.delta)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Spacer: reserves room for the fixed panel so content doesn't slide under it */}
        {panelOpen && <div className="w-64 shrink-0" />}
      </div>

      {/* Fixed right panel — positioned relative to the viewport, not the flex chain */}
      {panelOpen && (
        <div className="fixed right-0 top-12 bottom-0 w-64 z-30 bg-card border-l flex flex-col shadow-md overflow-hidden">
          <ItemSearchPanel
            matches={panelMatches}
            activeIdx={panelActiveIdx}
            locationName={detail.sourceLocationName}
            onActiveChange={setPanelActiveIdx}
            onPick={addExtraItem}
            onClose={() => { setPanelOpen(false); setPanelSearch(""); }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Detail shell ─────────────────────────────────────────────────────────────
function TransferOrderDetail({ voucherId, posUser, onBack }: { voucherId: number; posUser: PosUser; onBack: () => void }) {
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
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-4 space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1.5" />Back</Button>
        <p className="text-sm text-destructive">Failed to load order.</p>
      </div>
    );
  }

  return <EditableTransferDetail detail={detail} posUser={posUser} voucherId={voucherId} onBack={onBack} />;
}

// ─── Create Transfer Dialog (multi-location POS users) ───────────────────────
interface NewTransferItem {
  stockItemId: number;
  stockItemName: string;
  quantity: string;
}

function CreateTransferDialog({
  open,
  onClose,
  myLocations,
}: {
  open: boolean;
  onClose: () => void;
  myLocations: { id: number; name: string }[];
}) {
  const { toast } = useToast();
  const [sourceId, setSourceId] = useState<string>("");
  const [destId, setDestId] = useState<string>("");
  const [items, setItems] = useState<NewTransferItem[]>([]);
  const [notes, setNotes] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // All company locations for destination
  const { data: allLocations = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/locations"],
    enabled: open,
  });

  // Inventory of the selected source location
  const { data: sourceInventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory", sourceId],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${sourceId}/inventory`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!sourceId && open,
  });

  const addedIds = new Set(items.map(i => i.stockItemId));

  const searchMatches = useMemo(() => {
    const s = itemSearch.toLowerCase().trim();
    return (sourceInventory as any[])
      .filter(i => !addedIds.has(i.stockItemId ?? i.id) && (i.stockItemName ?? i.name ?? "").toLowerCase().includes(s))
      .slice(0, 40);
  }, [sourceInventory, itemSearch, items]);

  const addItem = (inv: any) => {
    const id = inv.stockItemId ?? inv.id;
    const name = inv.stockItemName ?? inv.name ?? "";
    setItems(p => [...p, { stockItemId: id, stockItemName: name, quantity: "" }]);
    setItemSearch("");
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  const updateQty = (idx: number, val: string) =>
    setItems(p => p.map((it, i) => i === idx ? { ...it, quantity: val } : it));

  const removeItem = (idx: number) => setItems(p => p.filter((_, i) => i !== idx));

  const reset = () => {
    setSourceId(""); setDestId(""); setItems([]); setNotes(""); setItemSearch("");
  };

  const handleClose = () => { reset(); onClose(); };

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        sourceLocationId: parseInt(sourceId),
        destinationLocationId: parseInt(destId),
        notes: notes.trim() || undefined,
        items: items.map(i => ({
          stockItemId: i.stockItemId,
          stockItemName: i.stockItemName,
          sourceLocationId: parseInt(sourceId),
          quantity: i.quantity,
        })),
        optional: true, // POS-created transfers go for admin review
      };
      const res = await fetch("/api/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(err.message || "Failed to create transfer");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Transfer created", description: "Submitted for admin review." });
      queryClient.invalidateQueries({ queryKey: ["/api/stock-transfers/list"] });
      handleClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit =
    !!sourceId &&
    !!destId &&
    sourceId !== destId &&
    items.length > 0 &&
    items.every(i => parseFloat(i.quantity) > 0);

  const destOptions = allLocations.filter(l => String(l.id) !== sourceId);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Transfer</DialogTitle>
          <DialogDescription>Create a stock transfer between your locations.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Source & Destination */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From (Source)</label>
              <Select value={sourceId} onValueChange={v => { setSourceId(v); setItems([]); setItemSearch(""); }}>
                <SelectTrigger data-testid="select-source-location">
                  <SelectValue placeholder="Select location…" />
                </SelectTrigger>
                <SelectContent>
                  {myLocations.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To (Destination)</label>
              <Select value={destId} onValueChange={setDestId} disabled={!sourceId}>
                <SelectTrigger data-testid="select-dest-location">
                  <SelectValue placeholder="Select location…" />
                </SelectTrigger>
                <SelectContent>
                  {destOptions.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Item search */}
          {sourceId && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Add Items</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchRef}
                  placeholder="Search items to add…"
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  className="pl-8 text-sm"
                  data-testid="input-item-search"
                />
              </div>
              {itemSearch && searchMatches.length > 0 && (
                <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto">
                  {searchMatches.map((inv: any) => {
                    const qty = parseFloat(inv.quantity ?? "0") || 0;
                    return (
                      <button
                        key={inv.stockItemId ?? inv.id}
                        type="button"
                        onClick={() => addItem(inv)}
                        className="w-full text-left px-3 py-2 text-sm border-b last:border-b-0 flex items-center justify-between gap-2 hover-elevate"
                        data-testid={`button-add-item-${inv.stockItemId ?? inv.id}`}
                      >
                        <span className="font-medium truncate">{inv.stockItemName ?? inv.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0 font-mono">{qty > 0 ? fmtQty(qty) : "0"} in stock</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {itemSearch && searchMatches.length === 0 && (
                <p className="text-xs text-muted-foreground px-1">No matching items found.</p>
              )}
            </div>
          )}

          {/* Items table */}
          {items.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <div className="grid grid-cols-[1fr_120px_36px] bg-muted/30 border-b px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-2">
                <span>Item</span>
                <span>Quantity</span>
                <span />
              </div>
              {items.map((item, idx) => (
                <div key={item.stockItemId} className="grid grid-cols-[1fr_120px_36px] items-center px-3 py-2 gap-2 border-b last:border-b-0">
                  <span className="text-sm font-medium truncate">{item.stockItemName}</span>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={e => updateQty(idx, e.target.value)}
                    className="h-8 text-sm text-right font-mono"
                    placeholder="0"
                    data-testid={`input-qty-${item.stockItemId}`}
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeItem(idx)} data-testid={`button-remove-item-${idx}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add a note…"
              className="text-sm resize-none"
              rows={2}
              data-testid="textarea-notes"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-create">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSubmit || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Submit for Review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── View-only dialog ─────────────────────────────────────────────────────────
function ViewTransferDialog({
  voucherId, open, onClose,
}: { voucherId: number | null; open: boolean; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!voucherId && open,
  });

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail?.voucherNumber ?? "Transfer Order"}
            {detail?.inventoryApplied && (
              <Badge variant="secondary" className="gap-1 text-xs font-normal">
                <Lock className="h-3 w-3" />Applied
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${formatDate(detail.voucherDate)} · ${detail.sourceLocationName} → ${detail.destinationLocationName}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-48 w-full" />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-xs py-2">#</TableHead>
                    <TableHead className="text-xs py-2">Item</TableHead>
                    <TableHead className="text-right text-xs py-2">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items.map((item, idx) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-muted-foreground py-2">{idx + 1}</TableCell>
                      <TableCell className="text-sm font-medium py-2">{item.stockItemName}</TableCell>
                      <TableCell className="text-right font-mono text-sm py-2">{fmtQty(item.quantity)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/20 font-semibold">
                    <TableCell />
                    <TableCell className="text-xs py-2">Total</TableCell>
                    <TableCell className="text-right font-mono text-sm py-2">
                      {fmtQty(detail.items.reduce((s, i) => s + parseFloat(i.quantity), 0))}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            {(detail.revisions?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revision History</span>
                </div>
                {detail.revisions.map(rev => {
                  const revLocName = rev.items[0]?.sourceLocationName ?? null;
                  return (
                  <Card key={rev.id}>
                    <CardContent className="pt-3 pb-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold">Revision #{rev.revisionNumber}</span>
                          {revLocName && (
                            <span className="text-xs text-muted-foreground">· From: <span className="font-medium text-foreground">{revLocName}</span></span>
                          )}
                          <span className="text-xs text-muted-foreground">{formatDateTime(rev.createdAt)}</span>
                        </div>
                        {rev.optional
                          ? <Badge variant="outline" className="text-xs">Pending Admin Review</Badge>
                          : <Badge variant="default" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>}
                      </div>
                      {rev.note && <p className="text-xs text-muted-foreground italic">{rev.note}</p>}
                      <div className="rounded-md border overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto_auto] bg-muted/30 border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-x-4">
                          <span>Item</span>
                          <span className="text-right">Was</span><span className="text-right">Now</span><span className="text-right">Change</span>
                        </div>
                        {rev.items.filter((ri) => parseFloat(ri.delta) !== 0).map((ri, i) => {
                          const delta = parseFloat(ri.delta);
                          return (
                            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center px-3 py-2 text-xs gap-x-4 bg-card border-b last:border-b-0">
                              <span className="font-medium">{ri.stockItemName}</span>
                              <span className="font-mono text-right text-muted-foreground">{fmtQty(ri.originalQuantity)}</span>
                              <span className="font-mono font-semibold text-right">{fmtQty(ri.newQuantity)}</span>
                              <span className={cn("font-mono font-semibold text-right", delta > 0 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                                {delta > 0 ? "+" : ""}{fmtQty(ri.delta)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-destructive py-4">Failed to load order.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main list view ───────────────────────────────────────────────────────────
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
      if (dateFilter) { params.set("startDate", dateFilter); params.set("endDate", dateFilter); }
      const res = await fetch(`/api/stock-transfers/list?${params}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  const transfers = useMemo(() => {
    return allTransfers.filter(t => {
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
      return t.voucherNumber?.toLowerCase().includes(s) ||
        t.stockItemNames?.some(n => n.toLowerCase().includes(s));
    });
  }, [allTransfers, search, statusFilter, dateFilter, myLocationIds]);

  const openView = (voucherId: number) => {
    setViewVoucherId(voucherId);
    setViewDialogOpen(true);
  };

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const clearFilters = () => { setSearch(""); setStatusFilter("all"); setDateFilter(todayStr); };
  const hasFilters = !!search || statusFilter !== "all" || dateFilter !== todayStr;

  // Edit view — full page, no extra padding (the component handles its own layout)
  if (editVoucherId !== null) {
    return (
      <div className="flex flex-col h-full">
        <TransferOrderDetail
          voucherId={editVoucherId}
          posUser={posUser}
          onBack={() => setEditVoucherId(null)}
        />
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
            <Plus className="h-4 w-4 mr-1.5" />New Transfer
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="border rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="h-4 w-4" />Filters
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-7 gap-1">
              <X className="h-3 w-3" />Clear Filters
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1 min-w-[140px]">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <div className="relative">
              <CalendarIcon className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                className="h-8 pl-8 pr-2 text-sm border rounded-md bg-background outline-none focus:ring-1 focus:ring-ring w-full"
                data-testid="input-date-filter" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as any)}>
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
              <Input placeholder="Voucher # or item..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm" data-testid="input-list-search" />
            </div>
          </div>
        </div>
      </div>

      {/* Transactions table */}
      <div className="border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 flex items-center gap-2">
          <span className="font-semibold text-sm">Transactions</span>
          <span className="text-xs text-muted-foreground">({transfers.length} entries)</span>
        </div>

        {isLoading ? (
          <div className="divide-y">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex gap-4 px-4 py-3 items-center">
                <Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-48 flex-1" /><Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : transfers.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground" data-testid="text-empty">
            <Package2 className="h-10 w-10 mx-auto mb-2 opacity-25" />
            <p className="text-sm">No transfer orders found</p>
            {hasFilters && <p className="text-xs mt-1">Try clearing your filters</p>}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs w-[110px]">Date</TableHead>
                <TableHead className="text-xs w-[90px]">Status</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-right text-xs w-[80px]">Items</TableHead>
                <TableHead className="text-right text-xs w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map(t => (
                <TableRow key={t.voucherId} data-testid={`row-transfer-${t.voucherId}`}>
                  <TableCell className="text-xs text-muted-foreground py-3 align-top">
                    {formatDate(t.voucherDate)}
                  </TableCell>
                  <TableCell className="py-3 align-top">
                    {t.inventoryApplied ? (
                      <Badge variant="secondary" className="gap-1 text-xs" data-testid={`badge-applied-${t.voucherId}`}>
                        <Lock className="h-2.5 w-2.5" />Applied
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-pending-${t.voucherId}`}>Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-3 align-top">
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <span>{t.sourceLocationName}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span>{t.destinationLocationName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono py-3 align-top">{t.itemCount}</TableCell>
                  <TableCell className="text-right py-3 align-top">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openView(t.voucherId)}
                        data-testid={`button-view-${t.voucherId}`} title="View">
                        <Eye className="h-4 w-4" />
                      </Button>
                      {!t.inventoryApplied && (
                        <Button size="icon" variant="ghost" onClick={() => setEditVoucherId(t.voucherId)}
                          data-testid={`button-edit-${t.voucherId}`} title="Adjust">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ViewTransferDialog
        voucherId={viewVoucherId}
        open={viewDialogOpen}
        onClose={() => { setViewDialogOpen(false); setViewVoucherId(null); }}
      />

      <CreateTransferDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        myLocations={myLocations}
      />
    </div>
  );
}
