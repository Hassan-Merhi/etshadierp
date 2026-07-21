import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import {
  Layers, Plus, Trash2, Search, Loader2, Package, ShoppingBag, Check,
  MinusCircle, PlusCircle, History, ArrowDownCircle, ArrowUpCircle,
  TrendingDown, TrendingUp, BarChart3, Calendar,
} from "lucide-react";

const TYPES = ["Sheet", "Sack", "Other"] as const;

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

interface LogEntry {
  id: number;
  itemId: number;
  itemName: string;
  itemType: string;
  action: "IN" | "OUT" | "ADJUST";
  pieces: number;
  packs: number | null;
  unitPrice: string;
  totalValue: string;
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
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function localDayOf(iso: string) {
  return isoDate(new Date(iso));
}

function getPresetDates(preset: string): { from: string; to: string } {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  switch (preset) {
    case "today":     return { from: isoDate(today),      to: isoDate(today) };
    case "yesterday": return { from: isoDate(yesterday),  to: isoDate(yesterday) };
    case "week":      return { from: isoDate(weekStart),  to: isoDate(today) };
    case "month":     return { from: isoDate(monthStart), to: isoDate(today) };
    default:          return { from: "",                  to: "" };
  }
}

function isLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

// ─── Compact Color Picker ──────────────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {COLOR_PRESETS.map((c) => (
          <button key={c.value} type="button" title={c.label} onClick={() => onChange(c.value)}
            className="relative rounded-full border-2 transition-all focus:outline-none"
            style={{ width: 24, height: 24, backgroundColor: c.value || "transparent",
              borderColor: value === c.value ? "#000" : c.value ? c.value : "#cbd5e1",
              boxShadow: value === c.value ? "0 0 0 2px rgba(0,0,0,0.25)" : undefined }}>
            {!c.value && <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">✕</span>}
            {value === c.value && c.value && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Check className="h-2.5 w-2.5" style={{ color: isLight(c.value) ? "#000" : "#fff" }} />
              </span>
            )}
          </button>
        ))}
        <input type="color" value={value && !COLOR_PRESETS.some((c) => c.value === value) ? value : "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-full border-2 border-border cursor-pointer"
          style={{ width: 24, height: 24, padding: 2 }} title="Custom color" />
      </div>
    </div>
  );
}

// ─── Item Form Dialog (Add only) ───────────────────────────────────────────────
function ItemFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [type, setType] = useState<string>("Sheet");
  const [name, setName] = useState("");
  const [size, setSize] = useState("");
  const [packQty, setPackQty] = useState("");
  const [pcsPerPack, setPcsPerPack] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [rowColor, setRowColor] = useState("");
  const [notes, setNotes] = useState("");

  const totalPcs = useMemo(() => (parseInt(packQty) || 0) * (parseInt(pcsPerPack) || 0), [packQty, pcsPerPack]);
  const totalValue = useMemo(() => totalPcs * (parseFloat(unitPrice) || 0), [totalPcs, unitPrice]);

  function reset() {
    setType("Sheet"); setName(""); setSize(""); setPackQty(""); setPcsPerPack("");
    setUnitPrice(""); setRowColor(""); setNotes("");
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/factory/sheets-sacks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      toast({ title: "Item added" });
      reset();
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    saveMutation.mutate({
      type, name: name.trim(), size: size.trim() || null,
      quantity: totalPcs,
      packQty: packQty !== "" ? parseInt(packQty) : null,
      pcsPerPack: pcsPerPack !== "" ? parseInt(pcsPerPack) : null,
      unitPrice: parseFloat(unitPrice) || 0,
      rowColor: rowColor || null, notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Purple Sheet 50kg" />
          </div>
          <div className="space-y-1.5">
            <Label>Size / Weight</Label>
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 50kg, 100×80cm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Qty (packs)</Label>
              <Input type="number" min="0" value={packQty} onChange={(e) => setPackQty(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label># / Pack (pcs)</Label>
              <Input type="number" min="0" value={pcsPerPack} onChange={(e) => setPcsPerPack(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total pcs</span>
            <span className="font-mono font-semibold">{totalPcs.toLocaleString("en-US")}</span>
          </div>
          <div className="space-y-1.5">
            <Label>Price per piece ($)</Label>
            <Input type="number" min="0" step="0.001" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.000" />
          </div>
          <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total value</span>
            <span className="font-mono font-semibold">${fmt(totalValue)}</span>
          </div>
          <div className="space-y-1.5">
            <Label>Row Color</Label>
            <ColorPicker value={rowColor} onChange={setRowColor} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." className="resize-none" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Add Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deduct Dialog ─────────────────────────────────────────────────────────────
function DeductDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: SheetsAndSacksItem }) {
  const { toast } = useToast();
  const hasPacks = item.pcsPerPack != null && item.pcsPerPack > 0;
  const [packsStr, setPacksStr] = useState("");
  const [pcsStr, setPcsStr] = useState("");
  const [notes, setNotes] = useState("");

  const pcsToDeduct = useMemo(() => {
    if (hasPacks && packsStr !== "") return (parseInt(packsStr) || 0) * (item.pcsPerPack as number);
    return parseInt(pcsStr) || 0;
  }, [hasPacks, packsStr, pcsStr, item.pcsPerPack]);

  const currentQty = parseFloat(item.quantity || "0");
  const remaining = Math.max(0, currentQty - pcsToDeduct);

  const deductMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/factory/sheets-sacks/${item.id}/deduct`, {
        pieces: pcsToDeduct,
        packs: hasPacks && packsStr !== "" ? parseInt(packsStr) || 0 : null,
        notes: notes.trim() || null,
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Deduction failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks/log"] });
      toast({ title: "Deduction recorded", description: `${pcsToDeduct.toLocaleString()} pcs removed from ${item.name}` });
      setPacksStr(""); setPcsStr(""); setNotes(""); onClose();
    },
    onError: (e: Error) => toast({ title: "Deduction failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Deduct from {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current stock</span>
            <span className="font-mono font-semibold">{currentQty.toLocaleString("en-US")} pcs</span>
          </div>
          {hasPacks && (
            <div className="space-y-1.5">
              <Label>Packs to deduct <span className="text-muted-foreground text-xs">(× {item.pcsPerPack} pcs/pack)</span></Label>
              <Input type="number" min="0" value={packsStr}
                onChange={(e) => { setPacksStr(e.target.value); setPcsStr(""); }} placeholder="0" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{hasPacks ? "Or pieces to deduct" : "Pieces to deduct"}</Label>
            <Input type="number" min="0"
              value={hasPacks ? (packsStr !== "" ? String(pcsToDeduct) : pcsStr) : pcsStr}
              onChange={(e) => { setPcsStr(e.target.value); if (hasPacks) setPacksStr(""); }}
              readOnly={hasPacks && packsStr !== ""} placeholder="0" />
          </div>
          <div className={`rounded-md px-3 py-2 flex items-center justify-between text-sm ${remaining === 0 && pcsToDeduct > 0 ? "bg-destructive/10" : "bg-muted/50"}`}>
            <span className="text-muted-foreground">Remaining after deduction</span>
            <span className={`font-mono font-semibold ${remaining === 0 && pcsToDeduct > 0 ? "text-destructive" : ""}`}>
              {remaining.toLocaleString("en-US")} pcs
            </span>
          </div>
          <div className="space-y-1.5">
            <Label>Reason / Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Used in production batch #42" className="resize-none" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={() => deductMutation.mutate()} disabled={pcsToDeduct <= 0 || deductMutation.isPending}>
            {deductMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Deduct {pcsToDeduct > 0 ? `${pcsToDeduct.toLocaleString()} pcs` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Restock Dialog ────────────────────────────────────────────────────────────
function RestockDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: SheetsAndSacksItem }) {
  const { toast } = useToast();
  const hasPacks = item.pcsPerPack != null && item.pcsPerPack > 0;
  const [packsStr, setPacksStr] = useState("");
  const [pcsStr, setPcsStr] = useState("");
  const [notes, setNotes] = useState("");

  const pcsToAdd = useMemo(() => {
    if (hasPacks && packsStr !== "") return (parseInt(packsStr) || 0) * (item.pcsPerPack as number);
    return parseInt(pcsStr) || 0;
  }, [hasPacks, packsStr, pcsStr, item.pcsPerPack]);

  const currentQty = parseFloat(item.quantity || "0");
  const newTotal = currentQty + pcsToAdd;

  const restockMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/factory/sheets-sacks/${item.id}/restock`, {
        pieces: pcsToAdd,
        packs: hasPacks && packsStr !== "" ? parseInt(packsStr) || 0 : null,
        notes: notes.trim() || null,
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Restock failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks/log"] });
      toast({ title: "Stock added", description: `${pcsToAdd.toLocaleString()} pcs added to ${item.name}` });
      setPacksStr(""); setPcsStr(""); setNotes(""); onClose();
    },
    onError: (e: Error) => toast({ title: "Restock failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Stock — {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Current stock</span>
            <span className="font-mono font-semibold">{currentQty.toLocaleString("en-US")} pcs</span>
          </div>
          {hasPacks && (
            <div className="space-y-1.5">
              <Label>Packs to add <span className="text-muted-foreground text-xs">(× {item.pcsPerPack} pcs/pack)</span></Label>
              <Input type="number" min="0" value={packsStr}
                onChange={(e) => { setPacksStr(e.target.value); setPcsStr(""); }} placeholder="0" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{hasPacks ? "Or pieces to add" : "Pieces to add"}</Label>
            <Input type="number" min="0"
              value={hasPacks ? (packsStr !== "" ? String(pcsToAdd) : pcsStr) : pcsStr}
              onChange={(e) => { setPcsStr(e.target.value); if (hasPacks) setPacksStr(""); }}
              readOnly={hasPacks && packsStr !== ""} placeholder="0" />
          </div>
          <div className="rounded-md bg-green-50 dark:bg-green-950/30 px-3 py-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">New total after add</span>
            <span className="font-mono font-semibold text-green-700 dark:text-green-400">{newTotal.toLocaleString("en-US")} pcs</span>
          </div>
          <div className="space-y-1.5">
            <Label>Reason / Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. New delivery from supplier" className="resize-none" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white"
            onClick={() => restockMutation.mutate()} disabled={pcsToAdd <= 0 || restockMutation.isPending}>
            {restockMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Add {pcsToAdd > 0 ? `${pcsToAdd.toLocaleString()} pcs` : "Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inline Spreadsheet Row ────────────────────────────────────────────────────
interface InlineRowProps {
  item: SheetsAndSacksItem;
  canEdit: boolean;
  rowIndex: number;
  onDeduct: () => void;
  onRestock: () => void;
  onDelete: () => void;
}

function InlineRow({ item, canEdit, rowIndex, onDeduct, onRestock, onDelete }: InlineRowProps) {
  const { toast } = useToast();
  const [draft, setDraft] = useState({
    type: item.type,
    name: item.name,
    size: item.size ?? "",
    packQty: item.packQty != null ? String(item.packQty) : "",
    pcsPerPack: item.pcsPerPack != null ? String(item.pcsPerPack) : "",
    unitPrice: item.unitPrice,
    rowColor: item.rowColor ?? "",
    notes: item.notes ?? "",
  });
  const [showColorPicker, setShowColorPicker] = useState(false);
  const savedRef = useRef({ ...draft });

  const patchMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/factory/sheets-sacks/${item.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
    },
    onError: (e: any) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
      // revert draft to last saved on error
      setDraft({ ...savedRef.current });
    },
  });

  const saveIfChanged = useCallback((current: typeof draft) => {
    const prev = savedRef.current;
    if (JSON.stringify(current) === JSON.stringify(prev)) return;
    savedRef.current = { ...current };
    const packs = current.packQty !== "" ? parseInt(current.packQty) : null;
    const pcspp = current.pcsPerPack !== "" ? parseInt(current.pcsPerPack) : null;
    const totalPcs = (packs ?? 0) * (pcspp ?? 0);
    patchMutation.mutate({
      type: current.type,
      name: current.name.trim() || item.name,
      size: current.size.trim() || null,
      quantity: totalPcs,
      packQty: packs,
      pcsPerPack: pcspp,
      unitPrice: parseFloat(current.unitPrice) || 0,
      rowColor: current.rowColor || null,
      notes: current.notes.trim() || null,
    });
  }, [item.id, item.name]);

  function update<K extends keyof typeof draft>(key: K, val: (typeof draft)[K]) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  function handleBlur(current?: typeof draft) {
    saveIfChanged(current ?? draft);
  }

  const totalPcs = (parseInt(draft.packQty) || 0) * (parseInt(draft.pcsPerPack) || 0);
  const totalVal = totalPcs * (parseFloat(draft.unitPrice) || 0);

  const rowBg = draft.rowColor ? `${draft.rowColor}22` : rowIndex % 2 === 1 ? "rgba(0,0,0,0.018)" : undefined;

  // Shared spreadsheet cell / input styles
  const cellCls = "border-r border-border/60 h-full";
  const inputCls = "w-full h-7 border-none shadow-none bg-transparent text-xs font-mono focus:bg-primary/8 focus:ring-0 focus:outline-none px-1.5 rounded-none disabled:opacity-50";

  return (
    <tr style={{ backgroundColor: rowBg }} className="group hover:bg-primary/5 transition-colors">
      {/* Color swatch — click to toggle picker */}
      <td className={`${cellCls} w-6 px-1 relative`}>
        <button
          type="button"
          title="Row color"
          onClick={() => canEdit && setShowColorPicker((v) => !v)}
          className="mx-auto block rounded-sm border border-border/50 transition-transform hover:scale-110"
          style={{ width: 14, height: 14, backgroundColor: draft.rowColor || "transparent" }}
        />
        {showColorPicker && canEdit && (
          <div className="absolute z-50 left-6 top-0 bg-popover border border-border rounded-lg shadow-xl p-3 w-52"
            onMouseLeave={() => { setShowColorPicker(false); saveIfChanged(draft); }}>
            <ColorPicker value={draft.rowColor}
              onChange={(v) => {
                const next = { ...draft, rowColor: v };
                setDraft(next);
              }} />
          </div>
        )}
      </td>

      {/* Type */}
      <td className={`${cellCls} w-24`}>
        {canEdit ? (
          <select
            value={draft.type}
            onChange={(e) => {
              const next = { ...draft, type: e.target.value };
              setDraft(next);
              saveIfChanged(next);
            }}
            className="w-full h-7 text-xs border-none bg-transparent focus:outline-none px-1 cursor-pointer"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <span className="px-1.5 text-xs">{item.type}</span>
        )}
      </td>

      {/* Name */}
      <td className={`${cellCls} min-w-[160px]`}>
        <input className={inputCls} disabled={!canEdit}
          value={draft.name}
          onChange={(e) => update("name", e.target.value)}
          onBlur={() => handleBlur()} />
      </td>

      {/* Size */}
      <td className={`${cellCls} w-28`}>
        <input className={inputCls} disabled={!canEdit}
          value={draft.size}
          onChange={(e) => update("size", e.target.value)}
          onBlur={() => handleBlur()}
          placeholder="—" />
      </td>

      {/* Pack Qty */}
      <td className={`${cellCls} w-24 text-right`}>
        <input className={`${inputCls} text-right`} disabled={!canEdit}
          type="number" min="0"
          value={draft.packQty}
          onChange={(e) => update("packQty", e.target.value)}
          onBlur={() => handleBlur()}
          placeholder="—" />
      </td>

      {/* Pcs / Pack */}
      <td className={`${cellCls} w-24 text-right`}>
        <input className={`${inputCls} text-right`} disabled={!canEdit}
          type="number" min="0"
          value={draft.pcsPerPack}
          onChange={(e) => update("pcsPerPack", e.target.value)}
          onBlur={() => handleBlur()}
          placeholder="—" />
      </td>

      {/* Total Pcs — computed, read-only */}
      <td className={`${cellCls} w-28 text-right`}>
        <span className="px-1.5 text-xs font-mono font-semibold text-foreground">
          {totalPcs > 0 ? totalPcs.toLocaleString("en-US") : "0"}
        </span>
      </td>

      {/* Unit Price */}
      <td className={`${cellCls} w-28 text-right`}>
        <input className={`${inputCls} text-right`} disabled={!canEdit}
          type="number" min="0" step="0.001"
          value={draft.unitPrice}
          onChange={(e) => update("unitPrice", e.target.value)}
          onBlur={() => handleBlur()}
          placeholder="0.000" />
      </td>

      {/* Total Value — computed, read-only */}
      <td className={`${cellCls} w-32 text-right`}>
        <span className="px-1.5 text-xs font-mono font-semibold text-foreground">
          ${fmt(totalVal)}
        </span>
      </td>

      {/* Notes */}
      <td className={`${cellCls} min-w-[120px]`}>
        <input className={inputCls} disabled={!canEdit}
          value={draft.notes}
          onChange={(e) => update("notes", e.target.value)}
          onBlur={() => handleBlur()}
          placeholder="—" />
      </td>

      {/* Actions */}
      {canEdit && (
        <td className="px-1 w-28">
          <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
            <button type="button" title="Add Stock" onClick={onRestock}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600">
              <PlusCircle className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Deduct" onClick={onDeduct}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600">
              <MinusCircle className="h-3.5 w-3.5" />
            </button>
            <button type="button" title="Delete row" onClick={onDelete}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

// ─── Movement Log ──────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { key: "today",     label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week",      label: "Last 7 Days" },
  { key: "month",     label: "This Month" },
  { key: "all",       label: "All Time" },
];

function MovementLog({ items }: { items: SheetsAndSacksItem[] }) {
  const [preset, setPreset] = useState("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [direction, setDirection] = useState<"all" | "IN" | "OUT">("all");
  const [filterItemId, setFilterItemId] = useState<string>("all");

  const { from, to } = useMemo(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    return getPresetDates(preset);
  }, [preset, customFrom, customTo]);

  const { data: logEntries = [], isLoading } = useQuery<LogEntry[]>({
    queryKey: ["/api/factory/sheets-sacks/log", from, to, direction, filterItemId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (direction !== "all") params.set("action", direction);
      if (filterItemId !== "all") params.set("itemId", filterItemId);
      const res = await apiRequest("GET", `/api/factory/sheets-sacks/log?${params}`);
      return res.json();
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const byDay = useMemo(() => {
    const groups: Record<string, LogEntry[]> = {};
    for (const e of logEntries) {
      const day = localDayOf(e.createdAt);
      if (!groups[day]) groups[day] = [];
      groups[day].push(e);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [logEntries]);

  const totals = useMemo(() => {
    let inPcs = 0, outPcs = 0, inVal = 0, outVal = 0;
    for (const e of logEntries) {
      const pieces = Number(e.pieces) || 0;
      if (e.action === "IN")  { inPcs  += pieces; inVal  += parseFloat(e.totalValue || "0"); }
      if (e.action === "OUT") { outPcs += pieces; outVal += parseFloat(e.totalValue || "0"); }
    }
    return { inPcs, outPcs, inVal, outVal, net: inPcs - outPcs };
  }, [logEntries]);

  const dayTotal = (entries: LogEntry[]) => {
    let inPcs = 0, outPcs = 0;
    for (const e of entries) {
      const pieces = Number(e.pieces) || 0;
      if (e.action === "IN")  inPcs  += pieces;
      if (e.action === "OUT") outPcs += pieces;
    }
    return { inPcs, outPcs, net: inPcs - outPcs };
  };

  const thCls = "py-1.5 px-3 text-left text-xs font-semibold text-muted-foreground border-b border-border/60 whitespace-nowrap";
  const tdCls = "py-1 px-3 text-xs border-b border-border/30";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1 flex-wrap">
          {DATE_PRESETS.map((p) => (
            <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"}
              className="text-xs h-7 px-2.5" onClick={() => setPreset(p.key)}>{p.label}</Button>
          ))}
          <Button size="sm" variant={preset === "custom" ? "default" : "outline"}
            className="text-xs h-7 px-2.5" onClick={() => setPreset("custom")}>
            <Calendar className="h-3 w-3 mr-1" />Custom
          </Button>
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 text-xs w-36" />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 text-xs w-36" />
          </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Moves</SelectItem>
              <SelectItem value="IN">Stock In ↑</SelectItem>
              <SelectItem value="OUT">Stock Out ↓</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterItemId} onValueChange={setFilterItemId}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="All Items" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              {items.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Period summary */}
      {logEntries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mb-1">
              <ArrowUpCircle className="h-3.5 w-3.5" /><span className="font-medium">Total In</span>
            </div>
            <p className="font-mono font-bold text-sm text-green-700 dark:text-green-300">{totals.inPcs.toLocaleString()} pcs</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">${fmt(totals.inVal)}</p>
          </div>
          <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400 mb-1">
              <ArrowDownCircle className="h-3.5 w-3.5" /><span className="font-medium">Total Out</span>
            </div>
            <p className="font-mono font-bold text-sm text-red-700 dark:text-red-300">{totals.outPcs.toLocaleString()} pcs</p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">${fmt(totals.outVal)}</p>
          </div>
          <div className={`rounded-lg border px-3 py-2.5 ${totals.net >= 0 ? "bg-blue-50 dark:bg-blue-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
            <div className={`flex items-center gap-1.5 text-xs mb-1 ${totals.net >= 0 ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
              {totals.net >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              <span className="font-medium">Net Change</span>
            </div>
            <p className={`font-mono font-bold text-sm ${totals.net >= 0 ? "text-blue-700 dark:text-blue-300" : "text-amber-700 dark:text-amber-300"}`}>
              {totals.net >= 0 ? "+" : ""}{totals.net.toLocaleString()} pcs
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <BarChart3 className="h-3.5 w-3.5" /><span className="font-medium">Transactions</span>
            </div>
            <p className="font-bold text-sm">{logEntries.length}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : logEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <History className="h-10 w-10 mb-3 opacity-25" />
          <p className="text-sm font-medium">No movement records for this period.</p>
          <p className="text-xs mt-1 opacity-70">Use "Add Stock" (↑) or "Deduct" (↓) buttons to log movements.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map(([day, entries]) => {
            const dt = dayTotal(entries);
            return (
              <div key={day} className="rounded-xl border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                  <span className="text-sm font-semibold">{fmtDate(day + "T12:00:00")}</span>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    {dt.inPcs > 0 && <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><ArrowUpCircle className="h-3 w-3" />+{dt.inPcs.toLocaleString()}</span>}
                    {dt.outPcs > 0 && <span className="text-red-600 dark:text-red-400 flex items-center gap-1"><ArrowDownCircle className="h-3 w-3" />-{dt.outPcs.toLocaleString()}</span>}
                    <span className={`font-semibold ${dt.net >= 0 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
                      Net: {dt.net >= 0 ? "+" : ""}{dt.net.toLocaleString()} pcs
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted/20">
                        <th className={thCls}>Time</th>
                        <th className={thCls}>Item</th>
                        <th className={thCls}>Type</th>
                        <th className={thCls}>Action</th>
                        <th className={`${thCls} text-right`}>Packs</th>
                        <th className={`${thCls} text-right`}>Pcs</th>
                        <th className={`${thCls} text-right`}>Unit $</th>
                        <th className={`${thCls} text-right`}>Value</th>
                        <th className={thCls}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id} className={
                          e.action === "IN" ? "bg-green-50/40 dark:bg-green-950/10"
                          : e.action === "OUT" ? "bg-red-50/40 dark:bg-red-950/10"
                          : "bg-blue-50/30 dark:bg-blue-950/10"}>
                          <td className={`${tdCls} text-muted-foreground font-mono`}>{fmtDateTime(e.createdAt).split(",")[1]?.trim() ?? ""}</td>
                          <td className={`${tdCls} font-medium`}>{e.itemName}</td>
                          <td className={tdCls}>
                            <Badge variant="secondary" className={`text-[10px] ${
                              e.itemType === "Sheet" ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : e.itemType === "Sack" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-muted text-muted-foreground"}`}>{e.itemType}</Badge>
                          </td>
                          <td className={tdCls}>
                            <Badge className={`text-[10px] font-bold ${
                              e.action === "IN" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-green-200"
                              : e.action === "OUT" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-red-200"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200"
                            }`} variant="outline">
                              {e.action === "IN" ? "↑ IN" : e.action === "OUT" ? "↓ OUT" : "⟳ ADJ"}
                            </Badge>
                          </td>
                          <td className={`${tdCls} text-right font-mono`}>{e.packs != null ? e.packs.toLocaleString() : "—"}</td>
                          <td className={`${tdCls} text-right font-mono font-semibold`}>{e.pieces.toLocaleString()}</td>
                          <td className={`${tdCls} text-right font-mono text-muted-foreground`}>${fmt(e.unitPrice)}</td>
                          <td className={`${tdCls} text-right font-mono font-medium`}>${fmt(e.totalValue)}</td>
                          <td className={`${tdCls} text-muted-foreground max-w-[160px] truncate`}>{e.notes || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/20 text-xs font-semibold">
                        <td colSpan={5} className="px-3 py-1.5 text-muted-foreground">Day total</td>
                        <td colSpan={4} className="px-3 py-1.5 text-right font-mono">
                          {dt.inPcs > 0 && <span className="text-green-600 dark:text-green-400 mr-3">+{dt.inPcs.toLocaleString()}</span>}
                          {dt.outPcs > 0 && <span className="text-red-600 dark:text-red-400 mr-3">−{dt.outPcs.toLocaleString()}</span>}
                          <span className={dt.net >= 0 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}>
                            Net {dt.net >= 0 ? "+" : ""}{dt.net.toLocaleString()} pcs
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function FactorySheetsAndSacks() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"stock" | "movements">("stock");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteItem, setDeleteItem] = useState<SheetsAndSacksItem | null>(null);
  const [deductItem, setDeductItem] = useState<SheetsAndSacksItem | null>(null);
  const [restockItem, setRestockItem] = useState<SheetsAndSacksItem | null>(null);

  const { data: items = [], isLoading } = useQuery<SheetsAndSacksItem[]>({
    queryKey: ["/api/factory/sheets-sacks"],
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: myAccess } = useQuery<{ fullAccess: boolean; pageKeys: string[] }>({
    queryKey: ["/api/factory/my-access"],
    staleTime: 30000,
  });

  const canEdit = !myAccess || myAccess.fullAccess || myAccess.pageKeys.includes("factory/sheets-sacks");

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/factory/sheets-sacks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      toast({ title: "Item deleted" });
      setDeleteItem(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    let result = items;
    if (typeFilter !== "all") result = result.filter((i) => i.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) => i.name.toLowerCase().includes(q) || (i.size || "").toLowerCase().includes(q) || (i.notes || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, typeFilter, search]);

  const stats = useMemo(() => {
    const sheets = items.filter((i) => i.type === "Sheet");
    const sacks  = items.filter((i) => i.type === "Sack");
    const totalValue = items.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0);
    const sheetValue = sheets.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0);
    const sackValue  = sacks.reduce((s, i)  => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0);
    return { sheets: sheets.length, sacks: sacks.length, totalValue, sheetValue, sackValue };
  }, [items]);

  const colTotals = useMemo(() => {
    let packQty = 0, pcs = 0, value = 0;
    for (const i of filtered) {
      if (i.packQty != null) packQty += i.packQty;
      pcs   += parseFloat(i.quantity || "0");
      value += parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0");
    }
    return { packQty, pcs, value };
  }, [filtered]);

  // Spreadsheet column header style
  const thCls = "py-1.5 px-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white select-none whitespace-nowrap border-r border-blue-800/40";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <PageHeader title="Sheets & Sacks" subtitle="Packaging materials inventory" />
        {canEdit && (
          <Button size="sm" onClick={() => setShowAddDialog(true)} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-1" />Add Row
          </Button>
        )}
      </div>

      {/* ── Summary strip ───────────────────────────────────────────────────── */}
      <div className="px-4 pb-2 shrink-0">
        <div className="flex gap-4 flex-wrap text-xs border rounded-md px-3 py-2 bg-muted/30">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            <strong className="text-foreground">{stats.sheets}</strong> Sheets
            <span className="text-muted-foreground/60">(${fmt(stats.sheetValue)})</span>
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <ShoppingBag className="h-3.5 w-3.5" />
            <strong className="text-foreground">{stats.sacks}</strong> Sacks
            <span className="text-muted-foreground/60">(${fmt(stats.sackValue)})</span>
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            <strong className="text-foreground">{items.length}</strong> Items
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground ml-auto font-semibold">
            Total <strong className="text-foreground">${fmt(stats.totalValue)}</strong>
          </span>
        </div>
      </div>

      {/* ── Tab switcher ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 border-b px-4 shrink-0">
        <button onClick={() => setActiveTab("stock")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "stock" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}>
          <Layers className="h-3.5 w-3.5" />Current Stock
        </button>
        <button onClick={() => setActiveTab("movements")}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "movements" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}>
          <History className="h-3.5 w-3.5" />Movement Log
        </button>
      </div>

      {/* ── CURRENT STOCK TAB ────────────────────────────────────────────────── */}
      {activeTab === "stock" && (
        <div className="flex flex-col flex-1 overflow-hidden px-4 pb-4 pt-2">
          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search…" value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-7 text-xs w-52" />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="h-7 text-xs border border-border rounded-md px-2 bg-background">
              <option value="all">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {(search || typeFilter !== "all") && (
              <span className="text-xs text-muted-foreground">{filtered.length} / {items.length}</span>
            )}
          </div>

          {/* Spreadsheet table */}
          <div className="flex-1 overflow-auto rounded-md border border-border/70 shadow-sm">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <table className="w-full border-collapse text-xs" style={{ tableLayout: "fixed", minWidth: 900 }}>
                <colgroup>
                  <col style={{ width: 24 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 100 }} />
                  <col />
                  {canEdit && <col style={{ width: 110 }} />}
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr style={{ backgroundColor: "#1e3a5f" }}>
                    <th className={thCls} title="Row color" />
                    <th className={thCls}>Type</th>
                    <th className={thCls} style={{ textAlign: "left", paddingLeft: 6 }}>Name</th>
                    <th className={thCls} style={{ textAlign: "left", paddingLeft: 6 }}>Size</th>
                    <th className={thCls}>Packs</th>
                    <th className={thCls}>Pcs/Pack</th>
                    <th className={thCls}>Total Pcs</th>
                    <th className={thCls}>Price/Pc</th>
                    <th className={thCls}>Total Value</th>
                    <th className={thCls} style={{ textAlign: "left", paddingLeft: 6 }}>Notes</th>
                    {canEdit && <th className={thCls + " border-r-0"}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={canEdit ? 11 : 10} className="py-12 text-center text-muted-foreground text-sm">
                        {items.length === 0 ? (
                          <div className="flex flex-col items-center gap-2">
                            <Layers className="h-8 w-8 opacity-25" />
                            <span>No items yet.</span>
                            {canEdit && (
                              <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}>
                                <Plus className="h-4 w-4 mr-1" />Add First Row
                              </Button>
                            )}
                          </div>
                        ) : "No items match your search."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item, idx) => (
                      <InlineRow key={item.id} item={item} canEdit={canEdit} rowIndex={idx}
                        onDeduct={() => setDeductItem(item)}
                        onRestock={() => setRestockItem(item)}
                        onDelete={() => setDeleteItem(item)} />
                    ))
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="sticky bottom-0">
                    <tr style={{ backgroundColor: "#1e3a5f" }}>
                      <td colSpan={4} className="py-1.5 px-2 text-xs font-semibold text-blue-200">
                        Totals ({filtered.length} row{filtered.length !== 1 ? "s" : ""})
                      </td>
                      <td className="py-1.5 px-1.5 text-right font-mono text-xs font-bold text-white">
                        {colTotals.packQty > 0 ? colTotals.packQty.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="py-1.5 px-1.5 text-white" />
                      <td className="py-1.5 px-1.5 text-right font-mono text-xs font-bold text-white">
                        {colTotals.pcs.toLocaleString("en-US")}
                      </td>
                      <td className="py-1.5 px-1.5 text-white" />
                      <td className="py-1.5 px-1.5 text-right font-mono text-xs font-bold text-white">
                        ${fmt(colTotals.value)}
                      </td>
                      <td colSpan={canEdit ? 2 : 1} className="text-white" />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── MOVEMENT LOG TAB ─────────────────────────────────────────────────── */}
      {activeTab === "movements" && (
        <div className="flex-1 overflow-auto px-4 pb-4 pt-2">
          <MovementLog items={items} />
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}
      {showAddDialog && <ItemFormDialog open onClose={() => setShowAddDialog(false)} />}

      {deductItem && <DeductDialog open onClose={() => setDeductItem(null)} item={deductItem} />}
      {restockItem && <RestockDialog open onClose={() => setRestockItem(null)} item={restockItem} />}

      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Row</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteItem?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}>
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
