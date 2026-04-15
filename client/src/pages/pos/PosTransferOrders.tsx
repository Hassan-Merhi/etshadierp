import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ChevronRight, RotateCcw, Plus, Minus, Loader2, Save, CheckCircle2, AlertCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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

interface TransferItem {
  id: number;
  transferId: number;
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number;
  sourceLocationName?: string;
  quantity: string;
  rate: string;
}

interface RevisionItem {
  stockItemId: number;
  stockItemName: string;
  sourceLocationId?: number;
  sourceLocationName?: string;
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
  items: TransferItem[];
  revisions: Revision[];
}

interface InventoryItem {
  stockItemId: number;
  name: string;
  locationId: number;
  quantity?: string;
}

function formatDate(dateStr: string) {
  try { return format(parseISO(dateStr), "MMM dd, yyyy"); } catch { return dateStr; }
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function TransferOrderDetail({ voucherId, posUser, onBack }: { voucherId: number; posUser: PosUser; onBack: () => void }) {
  const { toast } = useToast();
  const [deltas, setDeltas] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [extraItems, setExtraItems] = useState<Array<{ stockItemId: number; stockItemName: string; delta: string }>>([]);

  const { data: detail, isLoading, error } = useQuery<TransferDetail>({
    queryKey: ["/api/pos-transfer-detail", voucherId],
    queryFn: async () => {
      const res = await fetch(`/api/pos-transfer-detail?voucherId=${voucherId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: inventory = [] } = useQuery<InventoryItem[]>({
    queryKey: ["/api/inventory", posUser.assignedLocationId],
    queryFn: async () => {
      if (!posUser.assignedLocationId) return [];
      const res = await fetch(`/api/inventory?locationId=${posUser.assignedLocationId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: !!posUser.assignedLocationId,
  });

  const revisionMutation = useMutation({
    mutationFn: async (payload: { transferId: number; note: string; items: any[]; optional: boolean }) => {
      const res = await apiRequest("POST", `/api/stock-transfers/${payload.transferId}/revisions`, {
        note: payload.note,
        items: payload.items,
        optional: payload.optional,
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Revision saved", description: "Your adjustments have been submitted for review." });
      queryClient.invalidateQueries({ queryKey: ["/api/pos-transfer-detail", voucherId] });
      setDeltas({});
      setExtraItems([]);
      setNote("");
    },
    onError: (err: any) => {
      toast({ title: "Error saving revision", description: err.message, variant: "destructive" });
    },
  });

  const getDelta = (itemId: number) => parseFloat(deltas[itemId] ?? "0") || 0;
  const setDelta = (itemId: number, val: string) => setDeltas(prev => ({ ...prev, [itemId]: val }));
  const adjustDelta = (itemId: number, by: number) => {
    const cur = getDelta(itemId);
    setDelta(itemId, String(cur + by));
  };

  const adjustExtraDelta = (idx: number, by: number) => {
    setExtraItems(prev => prev.map((it, i) => i === idx ? { ...it, delta: String((parseFloat(it.delta) || 0) + by) } : it));
  };

  const existingStockIds = new Set(detail?.items.map(i => i.stockItemId) ?? []);
  const filteredInventory = inventory.filter(inv =>
    !existingStockIds.has(inv.stockItemId) &&
    inv.name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const addExtraItem = (inv: InventoryItem) => {
    if (extraItems.some(e => e.stockItemId === inv.stockItemId)) return;
    setExtraItems(prev => [...prev, { stockItemId: inv.stockItemId, stockItemName: inv.name, delta: "0" }]);
    setShowItemPicker(false);
    setItemSearch("");
  };

  const removeExtraItem = (idx: number) => {
    setExtraItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveRevision = () => {
    if (!detail) return;

    const changedBaseItems = (detail.items || [])
      .map(item => {
        const delta = getDelta(item.id);
        const original = parseFloat(item.quantity);
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
      .filter(e => (parseFloat(e.delta) || 0) !== 0)
      .map(e => ({
        stockItemId: e.stockItemId,
        stockItemName: e.stockItemName,
        sourceLocationId: posUser.assignedLocationId,
        sourceLocationName: detail.sourceLocationName,
        originalQuantity: "0",
        delta: e.delta,
        newQuantity: e.delta,
      }));

    const allItems = [...changedBaseItems, ...newItems];

    if (allItems.length === 0) {
      toast({ title: "No changes", description: "Please adjust at least one item quantity.", variant: "destructive" });
      return;
    }

    revisionMutation.mutate({ transferId: detail.transferId, note, items: allItems, optional: true });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>Failed to load transfer order.</span>
        </div>
      </div>
    );
  }

  const hasAnyChange = detail.items.some(i => getDelta(i.id) !== 0) || extraItems.some(e => (parseFloat(e.delta) || 0) !== 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-to-list">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-base">{detail.voucherNumber}</div>
          <div className="text-xs text-muted-foreground">{formatDate(detail.voucherDate)} &middot; {detail.sourceLocationName} &rarr; {detail.destinationLocationName}</div>
        </div>
        {detail.inventoryApplied && (
          <Badge variant="secondary" data-testid="badge-inventory-applied">Applied</Badge>
        )}
        {detail.optional && (
          <Badge variant="outline" data-testid="badge-optional">Draft</Badge>
        )}
      </div>

      {/* Items table */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Items</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowItemPicker(prev => !prev)}
            data-testid="button-add-item"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Item
          </Button>
        </CardHeader>

        {showItemPicker && (
          <div className="px-4 pb-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-item-search"
                autoFocus
              />
            </div>
            <div className="border rounded-md max-h-40 overflow-y-auto">
              {filteredInventory.length === 0 ? (
                <div className="text-xs text-muted-foreground p-3">No items found</div>
              ) : filteredInventory.slice(0, 20).map(inv => (
                <button
                  key={inv.stockItemId}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover-elevate"
                  onClick={() => addExtraItem(inv)}
                  data-testid={`button-pick-item-${inv.stockItemId}`}
                >
                  {inv.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <CardContent className="pt-0">
          <div className="space-y-0 divide-y">
            {detail.items.map((item) => {
              const delta = getDelta(item.id);
              const original = parseFloat(item.quantity);
              const newQty = original + delta;
              return (
                <div key={item.id} className="py-2.5 space-y-1.5" data-testid={`row-item-${item.id}`}>
                  <div className="font-medium text-sm">{item.stockItemName}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">
                      Original: <strong>{original}</strong>
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => adjustDelta(item.id, -1)}
                        data-testid={`button-minus-${item.id}`}
                        className="h-7 w-7"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        value={deltas[item.id] ?? "0"}
                        onChange={e => setDelta(item.id, e.target.value)}
                        className="h-7 w-16 text-center text-sm"
                        data-testid={`input-delta-${item.id}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => adjustDelta(item.id, 1)}
                        data-testid={`button-plus-${item.id}`}
                        className="h-7 w-7"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className={cn("text-xs font-medium", delta !== 0 ? (delta > 0 ? "text-green-600 dark:text-green-400" : "text-destructive") : "text-muted-foreground")}>
                      New: <strong>{newQty}</strong>
                    </span>
                  </div>
                </div>
              );
            })}

            {extraItems.map((item, idx) => {
              const delta = parseFloat(item.delta) || 0;
              return (
                <div key={`extra-${item.stockItemId}`} className="py-2.5 space-y-1.5" data-testid={`row-extra-item-${item.stockItemId}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm flex-1">{item.stockItemName}</span>
                    <Badge variant="outline" className="text-xs">New</Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeExtraItem(idx)}
                      data-testid={`button-remove-extra-${item.stockItemId}`}
                      className="h-6 w-6"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => adjustExtraDelta(idx, -1)}
                      data-testid={`button-extra-minus-${item.stockItemId}`}
                      className="h-7 w-7"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <Input
                      type="number"
                      value={item.delta}
                      onChange={e => setExtraItems(prev => prev.map((it, i) => i === idx ? { ...it, delta: e.target.value } : it))}
                      className="h-7 w-16 text-center text-sm"
                      data-testid={`input-extra-delta-${item.stockItemId}`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => adjustExtraDelta(idx, 1)}
                      data-testid={`button-extra-plus-${item.stockItemId}`}
                      className="h-7 w-7"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground ml-1">qty: <strong>{delta}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Note + Save */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Textarea
            placeholder="Optional note for this revision..."
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            className="resize-none text-sm"
            data-testid="textarea-revision-note"
          />
          <Button
            type="button"
            onClick={handleSaveRevision}
            disabled={!hasAnyChange || revisionMutation.isPending}
            className="w-full"
            data-testid="button-save-revision"
          >
            {revisionMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-1.5" /> Save Revision</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Revisions history */}
      {detail.revisions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Revision History</h3>
          {detail.revisions.map(rev => (
            <Card key={rev.id} data-testid={`card-revision-${rev.id}`}>
              <CardContent className="pt-3 pb-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Revision #{rev.revisionNumber}</span>
                  <div className="flex items-center gap-1.5">
                    {rev.optional ? (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-rev-optional-${rev.id}`}>Pending Review</Badge>
                    ) : (
                      <Badge variant="default" className="text-xs" data-testid={`badge-rev-approved-${rev.id}`}>
                        <CheckCircle2 className="h-3 w-3 mr-1" />Approved
                      </Badge>
                    )}
                  </div>
                </div>
                {rev.note && <p className="text-xs text-muted-foreground">{rev.note}</p>}
                <div className="space-y-1 pt-1">
                  {rev.items.map((ri, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-muted-foreground gap-2" data-testid={`text-rev-item-${rev.id}-${i}`}>
                      <span className="font-medium text-foreground truncate">{ri.stockItemName}</span>
                      <span className="shrink-0">
                        {ri.originalQuantity} &rarr; <strong>{ri.newQuantity}</strong>
                        <span className={cn("ml-1", parseFloat(ri.delta) > 0 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                          ({parseFloat(ri.delta) > 0 ? "+" : ""}{ri.delta})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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

  const filteredTransfers = useMemo(() => {
    return allTransfers.filter(t => {
      const destLower = t.destinationLocationName?.toLowerCase() ?? "";
      const isKolwezi = destLower.includes("kolwezi");
      if (!isKolwezi) return false;

      const searchLower = search.toLowerCase().trim();
      if (searchLower) {
        return (
          t.voucherNumber?.toLowerCase().includes(searchLower) ||
          t.stockItemNames?.some(n => n.toLowerCase().includes(searchLower))
        );
      }
      return true;
    });
  }, [allTransfers, search]);

  if (selectedVoucherId !== null) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <TransferOrderDetail
          voucherId={selectedVoucherId}
          posUser={posUser}
          onBack={() => setSelectedVoucherId(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold" data-testid="text-page-title">Kolwezi Transfer Orders</h1>
        <p className="text-sm text-muted-foreground">Review and adjust incoming transfer orders</p>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by voucher or item..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-list-search"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredTransfers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-empty-state">
          <RotateCcw className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No Kolwezi transfer orders found
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTransfers.map(t => (
            <Card
              key={t.voucherId}
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedVoucherId(t.voucherId)}
              data-testid={`card-transfer-${t.voucherId}`}
            >
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" data-testid={`text-voucher-number-${t.voucherId}`}>{t.voucherNumber}</span>
                      {t.inventoryApplied && (
                        <Badge variant="secondary" className="text-xs" data-testid={`badge-applied-${t.voucherId}`}>Applied</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(t.voucherDate)} &middot; {t.destinationLocationName}
                    </div>
                    {t.stockItemNames?.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {t.stockItemNames.slice(0, 3).join(", ")}{t.stockItemNames.length > 3 ? ` +${t.stockItemNames.length - 3} more` : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{t.itemCount} item{t.itemCount !== 1 ? "s" : ""}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
