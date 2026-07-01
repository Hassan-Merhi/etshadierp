import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { Layers, Plus, Pencil, Trash2, Search, Loader2, Package, ShoppingBag, Check } from "lucide-react";

const TYPES = ["Sheet", "Sack", "Other"] as const;

// Preset color palette matching typical packaging material colors
const COLOR_PRESETS = [
  { label: "None", value: "" },
  { label: "Purple", value: "#9b59b6" },
  { label: "Green", value: "#27ae60" },
  { label: "Yellow", value: "#f1c40f" },
  { label: "Orange", value: "#e67e22" },
  { label: "Red", value: "#e74c3c" },
  { label: "Blue", value: "#2980b9" },
  { label: "White", value: "#dde3ea" },
  { label: "Black", value: "#2c3e50" },
  { label: "Olive", value: "#6d7d3b" },
  { label: "Teal", value: "#16a085" },
] as const;

interface SheetsAndSacksItem {
  id: number;
  companyId: number;
  type: string;
  name: string;
  size: string | null;
  quantity: string;
  unitPrice: string;
  packQty: number | null;
  pcsPerPack: number | null;
  rowColor: string | null;
  notes: string | null;
  createdAt: string;
}

function fmt(n: string | number) {
  return parseFloat(String(n) || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: string | number | null | undefined) {
  if (n == null || n === "") return "—";
  const v = parseInt(String(n));
  return isNaN(v) ? "—" : v.toLocaleString("en-US");
}

// ─── Color Picker ──────────────────────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.label}
            onClick={() => onChange(c.value)}
            className="relative rounded-full border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              width: 28,
              height: 28,
              backgroundColor: c.value || "transparent",
              borderColor: value === c.value ? "#000" : c.value ? c.value : "#cbd5e1",
              boxShadow: value === c.value ? "0 0 0 2px rgba(0,0,0,0.25)" : undefined,
            }}
            data-testid={`color-preset-${c.label.toLowerCase()}`}
          >
            {!c.value && (
              <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs font-medium">✕</span>
            )}
            {value === c.value && c.value && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Check className="h-3 w-3" style={{ color: isLight(c.value) ? "#000" : "#fff" }} />
              </span>
            )}
          </button>
        ))}
        {/* Custom color input */}
        <div className="relative flex items-center" title="Custom color">
          <input
            type="color"
            value={value && !COLOR_PRESETS.some((c) => c.value === value) ? value : "#888888"}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-full border-2 border-border cursor-pointer"
            style={{ width: 28, height: 28, padding: 2 }}
            data-testid="color-custom"
          />
        </div>
      </div>
      {value && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="inline-block rounded-full border border-border"
            style={{ width: 12, height: 12, backgroundColor: value }}
          />
          {COLOR_PRESETS.find((c) => c.value === value)?.label ?? value}
        </div>
      )}
    </div>
  );
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

// ─── Item Form Dialog ──────────────────────────────────────────────────────────
function ItemFormDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: SheetsAndSacksItem | null;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<string>(existing?.type ?? "Sheet");
  const [name, setName] = useState(existing?.name ?? "");
  const [size, setSize] = useState(existing?.size ?? "");
  const [packQty, setPackQty] = useState(existing?.packQty != null ? String(existing.packQty) : "");
  const [pcsPerPack, setPcsPerPack] = useState(existing?.pcsPerPack != null ? String(existing.pcsPerPack) : "");
  const [unitPrice, setUnitPrice] = useState(existing?.unitPrice ?? "");
  const [rowColor, setRowColor] = useState(existing?.rowColor ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const totalPcs = useMemo(() => {
    const q = parseInt(packQty) || 0;
    const p = parseInt(pcsPerPack) || 0;
    return q * p;
  }, [packQty, pcsPerPack]);

  const totalValue = useMemo(() => {
    return totalPcs * (parseFloat(unitPrice) || 0);
  }, [totalPcs, unitPrice]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (existing) {
        return apiRequest("PATCH", `/api/factory/sheets-sacks/${existing.id}`, data);
      }
      return apiRequest("POST", "/api/factory/sheets-sacks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      toast({ title: existing ? "Item updated" : "Item added" });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      type,
      name: name.trim(),
      size: size.trim() || null,
      quantity: totalPcs,
      packQty: packQty !== "" ? parseInt(packQty) : null,
      pcsPerPack: pcsPerPack !== "" ? parseInt(pcsPerPack) : null,
      unitPrice: parseFloat(unitPrice) || 0,
      rowColor: rowColor || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Item" : "Add Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Type */}
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Purple Sheet 50kg"
              data-testid="input-name"
            />
          </div>

          {/* Size */}
          <div className="space-y-1.5">
            <Label>Size / Weight</Label>
            <Input
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 50kg, 100×80cm"
              data-testid="input-size"
            />
          </div>

          {/* Pack qty + pcs per pack + auto total */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Qty (packs)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={packQty}
                onChange={(e) => setPackQty(e.target.value)}
                placeholder="0"
                data-testid="input-pack-qty"
              />
            </div>
            <div className="space-y-1.5">
              <Label># / Pack (pcs)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={pcsPerPack}
                onChange={(e) => setPcsPerPack(e.target.value)}
                placeholder="0"
                data-testid="input-pcs-per-pack"
              />
            </div>
          </div>

          {/* Total pcs (read-only) */}
          <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total pcs</span>
            <span className="font-mono font-semibold">{totalPcs.toLocaleString("en-US")}</span>
          </div>

          {/* Unit price */}
          <div className="space-y-1.5">
            <Label>Price per piece ($)</Label>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.000"
              data-testid="input-unit-price"
            />
          </div>

          {/* Total value (read-only) */}
          <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total value</span>
            <span className="font-mono font-semibold">${fmt(totalValue)}</span>
          </div>

          {/* Row color */}
          <div className="space-y-1.5">
            <Label>Row Color</Label>
            <ColorPicker value={rowColor} onChange={setRowColor} />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="resize-none"
              rows={2}
              data-testid="input-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">Cancel</Button>
          <Button onClick={handleSubmit} disabled={saveMutation.isPending} data-testid="button-save">
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {existing ? "Update" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function FactorySheetsAndSacks() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editItem, setEditItem] = useState<SheetsAndSacksItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<SheetsAndSacksItem | null>(null);

  const { data: items = [], isLoading } = useQuery<SheetsAndSacksItem[]>({
    queryKey: ["/api/factory/sheets-sacks"],
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[] }>({
    queryKey: ["/api/factory/my-access"],
    staleTime: 30000,
  });

  const canEdit =
    !myAccess ||
    myAccess.fullAccess ||
    myAccess.pageKeys.includes("factory/sheets-sacks");

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/factory/sheets-sacks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      toast({ title: "Item deleted" });
      setDeleteItem(null);
    },
    onError: (e: any) => {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    let result = items;
    if (typeFilter !== "all") result = result.filter((i) => i.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.size || "").toLowerCase().includes(q) ||
          (i.notes || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, typeFilter, search]);

  const stats = useMemo(() => {
    const sheets = items.filter((i) => i.type === "Sheet");
    const sacks = items.filter((i) => i.type === "Sack");
    const totalValue = items.reduce(
      (s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"),
      0
    );
    const sheetValue = sheets.reduce(
      (s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"),
      0
    );
    const sackValue = sacks.reduce(
      (s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"),
      0
    );
    return { sheets: sheets.length, sacks: sacks.length, totalValue, sheetValue, sackValue };
  }, [items]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <PageHeader
          title="Sheets & Sacks"
          subtitle="Track packaging materials inventory"
        />
        {canEdit && (
          <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Sheets</span>
            </div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-sheets">{stats.sheets}</div>
            <div className="text-xs text-muted-foreground mt-0.5">${fmt(stats.sheetValue)} value</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Sacks</span>
            </div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-sacks">{stats.sacks}</div>
            <div className="text-xs text-muted-foreground mt-0.5">${fmt(stats.sackValue)} value</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">All Items</span>
            </div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-total">{items.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">$</span>
              <span className="text-sm text-muted-foreground">Total Value</span>
            </div>
            <div className="text-2xl font-bold mt-1" data-testid="stat-value">${fmt(stats.totalValue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, size..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 w-64"
            data-testid="input-search"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36" data-testid="select-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Layers className="h-10 w-10 mb-3 opacity-25" />
              <p className="text-sm font-medium">
                {items.length === 0 ? "No items yet. Add your first sheet or sack." : "No items match your search."}
              </p>
              {items.length === 0 && canEdit && (
                <Button variant="outline" className="mt-4" onClick={() => setShowAddDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size / Weight</TableHead>
                    <TableHead className="text-right">Qty (packs)</TableHead>
                    <TableHead className="text-right"># / Pack</TableHead>
                    <TableHead className="text-right">Total Pcs</TableHead>
                    <TableHead className="text-right">Price / Pc</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                    <TableHead>Notes</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => {
                    const totalPcs = parseFloat(item.quantity || "0");
                    const totalVal = totalPcs * parseFloat(item.unitPrice || "0");
                    const bg = item.rowColor ? `${item.rowColor}18` : undefined;
                    return (
                      <TableRow
                        key={item.id}
                        data-testid={`row-item-${item.id}`}
                        style={bg ? { backgroundColor: bg } : undefined}
                      >
                        {/* Color swatch */}
                        <TableCell className="px-2">
                          {item.rowColor ? (
                            <span
                              className="inline-block rounded-full border border-border/50"
                              style={{ width: 14, height: 14, backgroundColor: item.rowColor }}
                              title={COLOR_PRESETS.find((c) => c.value === item.rowColor)?.label ?? item.rowColor}
                            />
                          ) : (
                            <span className="inline-block rounded-full border border-border/30 bg-transparent" style={{ width: 14, height: 14 }} />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              item.type === "Sheet"
                                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                : item.type === "Sack"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                            }
                            data-testid={`badge-type-${item.id}`}
                          >
                            {item.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{item.size || "—"}</TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtInt(item.packQty)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtInt(item.pcsPerPack)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {totalPcs > 0 ? totalPcs.toLocaleString("en-US") : "0"}
                        </TableCell>
                        <TableCell className="text-right font-mono">${fmt(item.unitPrice)}</TableCell>
                        <TableCell className="text-right font-mono font-medium">${fmt(totalVal)}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                          {item.notes || "—"}
                        </TableCell>
                        {canEdit && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setEditItem(item)}
                                title="Edit"
                                data-testid={`button-edit-${item.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setDeleteItem(item)}
                                title="Delete"
                                data-testid={`button-delete-${item.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      {(showAddDialog || editItem) && (
        <ItemFormDialog
          open={showAddDialog || !!editItem}
          onClose={() => {
            setShowAddDialog(false);
            setEditItem(null);
          }}
          existing={editItem}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteItem?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
