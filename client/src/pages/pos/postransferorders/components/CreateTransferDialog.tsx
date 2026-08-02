/**
 * CreateTransferDialog — extracted sub-component.
 *
 * Extracted from PosTransferOrders.tsx during the Phase 4 god-file split.
 */
import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Save, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { InventoryItem, NewTransferItem } from "../types";
import { fmtQty } from "../utils";
import { usePosText } from "@/i18n/modules/pos";

export function CreateTransferDialog({
  open,
  onClose,
  myLocations,
}: {
  open: boolean;
  onClose: () => void;
  myLocations: { id: number; name: string }[];
}) {
  const tUi = usePosText();
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

  const addedIds = new Set(items.map((i) => i.stockItemId));

  const searchMatches = useMemo(() => {
    const s = itemSearch.toLowerCase().trim();
    return (sourceInventory as any[])
      .filter(
        (i) => !addedIds.has(i.stockItemId ?? i.id) && (i.stockItemName ?? i.name ?? "").toLowerCase().includes(s)
      )
      .slice(0, 40);
  }, [sourceInventory, itemSearch, items]);

  const addItem = (inv: any) => {
    const id = inv.stockItemId ?? inv.id;
    const name = inv.stockItemName ?? inv.name ?? "";
    setItems((p) => [...p, { stockItemId: id, stockItemName: name, quantity: "" }]);
    setItemSearch("");
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  const updateQty = (idx: number, val: string) =>
    setItems((p) => p.map((it, i) => (i === idx ? { ...it, quantity: val } : it)));

  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));

  const reset = () => {
    setSourceId("");
    setDestId("");
    setItems([]);
    setNotes("");
    setItemSearch("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        sourceLocationId: parseInt(sourceId),
        destinationLocationId: parseInt(destId),
        notes: notes.trim() || undefined,
        items: items.map((i) => ({
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
    !!sourceId && !!destId && sourceId !== destId && items.length > 0 && items.every((i) => parseFloat(i.quantity) > 0);

  const destOptions = allLocations.filter((l) => String(l.id) !== sourceId);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tUi("new.transfer")}</DialogTitle>
          <DialogDescription>{tUi("create.a.stock.transfer.between.your.locations")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Source & Destination */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{tUi("from.source")}</label>
              <Select
                value={sourceId}
                onValueChange={(v) => {
                  setSourceId(v);
                  setItems([]);
                  setItemSearch("");
                }}
              >
                <SelectTrigger data-testid="select-source-location">
                  <SelectValue placeholder={tUi("select.location.2")} />
                </SelectTrigger>
                <SelectContent>
                  {myLocations.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{tUi("to.destination")}</label>
              <Select value={destId} onValueChange={setDestId} disabled={!sourceId}>
                <SelectTrigger data-testid="select-dest-location">
                  <SelectValue placeholder={tUi("select.location.2")} />
                </SelectTrigger>
                <SelectContent>
                  {destOptions.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Item search */}
          {sourceId && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">{tUi("add.items")}</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  ref={searchRef}
                  placeholder={tUi("search.items.to.add")}
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
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
                        <span className="text-xs text-muted-foreground shrink-0 font-mono">
                          {qty > 0 ? fmtQty(qty) : "0"} in stock
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {itemSearch && searchMatches.length === 0 && (
                <p className="text-xs text-muted-foreground px-1">{tUi("no.matching.items.found")}</p>
              )}
            </div>
          )}

          {/* Items table */}
          {items.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <div className="grid grid-cols-[1fr_120px_36px] bg-muted/30 border-b px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide gap-2">
                <span>{tUi("item")}</span>
                <span>{tUi("quantity")}</span>
                <span />
              </div>
              {items.map((item, idx) => (
                <div
                  key={item.stockItemId}
                  className="grid grid-cols-[1fr_120px_36px] items-center px-3 py-2 gap-2 border-b last:border-b-0"
                >
                  <span className="text-sm font-medium truncate">{item.stockItemName}</span>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateQty(idx, e.target.value)}
                    className="h-8 text-sm text-right font-mono"
                    placeholder="0"
                    data-testid={`input-qty-${item.stockItemId}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeItem(idx)}
                    data-testid={`button-remove-item-${idx}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{tUi("notes.optional")}</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tUi("add.a.note")}
              className="text-sm resize-none"
              rows={2}
              data-testid="textarea-notes"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSubmit || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              Submit for Review
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── View-only dialog ─────────────────────────────────────────────────────────
