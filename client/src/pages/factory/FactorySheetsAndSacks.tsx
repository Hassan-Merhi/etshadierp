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
import {
  Layers, Plus, Pencil, Trash2, Search, Loader2, Package, ShoppingBag, Check,
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
  // Use local calendar date, not UTC, so presets match the user's clock
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function localDayOf(iso: string) {
  // Group log entries by local calendar day
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

// ─── Color Picker ─────────────────────────────────────────────────────────────
function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c.value} type="button" title={c.label}
            onClick={() => onChange(c.value)}
            className="relative rounded-full border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              width: 28, height: 28,
              backgroundColor: c.value || "transparent",
              borderColor: value === c.value ? "#000" : c.value ? c.value : "#cbd5e1",
              boxShadow: value === c.value ? "0 0 0 2px rgba(0,0,0,0.25)" : undefined,
            }}
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
        <div className="relative flex items-center" title="Custom color">
          <input
            type="color"
            value={value && !COLOR_PRESETS.some((c) => c.value === value) ? value : "#888888"}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-full border-2 border-border cursor-pointer"
            style={{ width: 28, height: 28, padding: 2 }}
          />
        </div>
      </div>
      {value && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block rounded-full border border-border" style={{ width: 12, height: 12, backgroundColor: value }} />
          {COLOR_PRESETS.find((c) => c.value === value)?.label ?? value}
        </div>
      )}
    </div>
  );
}

// ─── Item Form Dialog ─────────────────────────────────────────────────────────
function ItemFormDialog({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: SheetsAndSacksItem | null }) {
  const { toast } = useToast();
  const [type, setType] = useState<string>(existing?.type ?? "Sheet");
  const [name, setName] = useState(existing?.name ?? "");
  const [size, setSize] = useState(existing?.size ?? "");
  const [packQty, setPackQty] = useState(existing?.packQty != null ? String(existing.packQty) : "");
  const [pcsPerPack, setPcsPerPack] = useState(existing?.pcsPerPack != null ? String(existing.pcsPerPack) : "");
  const [unitPrice, setUnitPrice] = useState(existing?.unitPrice ?? "");
  const [rowColor, setRowColor] = useState(existing?.rowColor ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const totalPcs = useMemo(() => (parseInt(packQty) || 0) * (parseInt(pcsPerPack) || 0), [packQty, pcsPerPack]);
  const totalValue = useMemo(() => totalPcs * (parseFloat(unitPrice) || 0), [totalPcs, unitPrice]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (existing) return apiRequest("PATCH", `/api/factory/sheets-sacks/${existing.id}`, data);
      return apiRequest("POST", "/api/factory/sheets-sacks", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/sheets-sacks"] });
      toast({ title: existing ? "Item updated" : "Item added" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    saveMutation.mutate({
      type, name: name.trim(),
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
        <DialogHeader><DialogTitle>{existing ? "Edit Item" : "Add Item"}</DialogTitle></DialogHeader>
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {existing ? "Update" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Deduct Dialog ────────────────────────────────────────────────────────────
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
      onClose();
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

// ─── Restock Dialog ───────────────────────────────────────────────────────────
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
      onClose();
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
            <span className="font-mono font-semibold text-green-700 dark:text-green-400">
              {newTotal.toLocaleString("en-US")} pcs
            </span>
          </div>
          <div className="space-y-1.5">
            <Label>Reason / Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. New delivery from supplier" className="resize-none" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white"
            onClick={() => restockMutation.mutate()}
            disabled={pcsToAdd <= 0 || restockMutation.isPending}
          >
            {restockMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Add {pcsToAdd > 0 ? `${pcsToAdd.toLocaleString()} pcs` : "Stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Movement Log ─────────────────────────────────────────────────────────────
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

  // Group by local calendar day
  const byDay = useMemo(() => {
    const groups: Record<string, LogEntry[]> = {};
    for (const e of logEntries) {
      const day = localDayOf(e.createdAt);
      if (!groups[day]) groups[day] = [];
      groups[day].push(e);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [logEntries]);

  // Period totals — only count IN and OUT; ADJUST is shown but excluded from IN/OUT sums
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

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Date presets */}
        <div className="flex items-center gap-1 flex-wrap">
          {DATE_PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              className="text-xs h-7 px-2.5"
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={preset === "custom" ? "default" : "outline"}
            className="text-xs h-7 px-2.5"
            onClick={() => setPreset("custom")}
          >
            <Calendar className="h-3 w-3 mr-1" />
            Custom
          </Button>
        </div>

        {/* Custom date range */}
        {preset === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 text-xs w-36" />
            <span className="text-muted-foreground text-xs">→</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 text-xs w-36" />
          </div>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          {/* Direction filter */}
          <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
            <SelectTrigger className="h-7 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Moves</SelectItem>
              <SelectItem value="IN">Stock In ↑</SelectItem>
              <SelectItem value="OUT">Stock Out ↓</SelectItem>
            </SelectContent>
          </Select>

          {/* Item filter */}
          <Select value={filterItemId} onValueChange={setFilterItemId}>
            <SelectTrigger className="h-7 text-xs w-40">
              <SelectValue placeholder="All Items" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              {items.map((i) => (
                <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Period summary cards */}
      {logEntries.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 mb-1">
              <ArrowUpCircle className="h-3.5 w-3.5" />
              <span className="font-medium">Total In</span>
            </div>
            <p className="font-mono font-bold text-sm text-green-700 dark:text-green-300">{totals.inPcs.toLocaleString()} pcs</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">${fmt(totals.inVal)}</p>
          </div>
          <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400 mb-1">
              <ArrowDownCircle className="h-3.5 w-3.5" />
              <span className="font-medium">Total Out</span>
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
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="font-medium">Transactions</span>
            </div>
            <p className="font-bold text-sm">{logEntries.length}</p>
          </div>
        </div>
      )}

      {/* Day-by-day log */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
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
                {/* Day header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                  <span className="text-sm font-semibold">{fmtDate(day + "T12:00:00")}</span>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    {dt.inPcs > 0 && (
                      <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                        <ArrowUpCircle className="h-3 w-3" />
                        +{dt.inPcs.toLocaleString()}
                      </span>
                    )}
                    {dt.outPcs > 0 && (
                      <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                        <ArrowDownCircle className="h-3 w-3" />
                        -{dt.outPcs.toLocaleString()}
                      </span>
                    )}
                    <span className={`font-semibold ${dt.net >= 0 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}`}>
                      Net: {dt.net >= 0 ? "+" : ""}{dt.net.toLocaleString()} pcs
                    </span>
                  </div>
                </div>
                {/* Entries table */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/20">
                        <TableHead className="w-36 text-xs">Time</TableHead>
                        <TableHead className="text-xs">Item</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs w-20">Action</TableHead>
                        <TableHead className="text-right text-xs">Packs</TableHead>
                        <TableHead className="text-right text-xs">Pcs</TableHead>
                        <TableHead className="text-right text-xs">Unit $</TableHead>
                        <TableHead className="text-right text-xs">Value</TableHead>
                        <TableHead className="text-xs">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((e) => (
                        <TableRow key={e.id} className={
                            e.action === "IN" ? "bg-green-50/40 dark:bg-green-950/10"
                            : e.action === "OUT" ? "bg-red-50/40 dark:bg-red-950/10"
                            : "bg-blue-50/30 dark:bg-blue-950/10"
                          }>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {fmtDateTime(e.createdAt).split(",")[1]?.trim() ?? ""}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{e.itemName}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={`text-[10px] ${
                              e.itemType === "Sheet" ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : e.itemType === "Sack" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-muted text-muted-foreground"
                            }`}>{e.itemType}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-[10px] font-bold ${
                              e.action === "IN"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-green-200"
                                : e.action === "OUT"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-red-200"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200"
                            }`} variant="outline">
                              {e.action === "IN" ? "↑ IN" : e.action === "OUT" ? "↓ OUT" : "⟳ ADJ"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{e.packs != null ? e.packs.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">{e.pieces.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">${fmt(e.unitPrice)}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium">${fmt(e.totalValue)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{e.notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    {/* Day totals footer */}
                    <tfoot>
                      {(() => {
                        const dt = dayTotal(entries);
                        return (
                          <tr className="border-t bg-muted/20 text-xs font-semibold">
                            <td colSpan={5} className="px-4 py-1.5 text-muted-foreground">Day total</td>
                            <td colSpan={4} className="px-4 py-1.5 text-right font-mono">
                              {dt.inPcs > 0 && <span className="text-green-600 dark:text-green-400 mr-3">+{dt.inPcs.toLocaleString()}</span>}
                              {dt.outPcs > 0 && <span className="text-red-600 dark:text-red-400 mr-3">−{dt.outPcs.toLocaleString()}</span>}
                              <span className={dt.net >= 0 ? "text-blue-600 dark:text-blue-400" : "text-amber-600 dark:text-amber-400"}>
                                Net {dt.net >= 0 ? "+" : ""}{dt.net.toLocaleString()} pcs
                              </span>
                            </td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </Table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FactorySheetsAndSacks() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"stock" | "movements">("stock");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editItem, setEditItem] = useState<SheetsAndSacksItem | null>(null);
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

  const canEdit =
    !myAccess || myAccess.fullAccess || myAccess.pageKeys.includes("factory/sheets-sacks");

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
    const sacks = items.filter((i) => i.type === "Sack");
    const totalValue = items.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0);
    const sheetValue = sheets.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0);
    const sackValue = sacks.reduce((s, i) => s + parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0"), 0);
    return { sheets: sheets.length, sacks: sacks.length, totalValue, sheetValue, sackValue };
  }, [items]);

  // Column totals for the filtered view
  const colTotals = useMemo(() => {
    let packQty = 0, pcs = 0, value = 0;
    for (const i of filtered) {
      if (i.packQty != null) packQty += i.packQty;
      pcs += parseFloat(i.quantity || "0");
      value += parseFloat(i.quantity || "0") * parseFloat(i.unitPrice || "0");
    }
    return { packQty, pcs, value };
  }, [filtered]);

  const typeBadge = (type: string) => (
    <Badge variant="secondary" className={
      type === "Sheet" ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
      : type === "Sack" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-muted text-muted-foreground"
    }>{type}</Badge>
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <PageHeader title="Sheets & Sacks" subtitle="Track packaging materials inventory" />
        {canEdit && (
          <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-item">
            <Plus className="h-4 w-4 mr-1" />
            Add Item
          </Button>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2"><Layers className="h-4 w-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Total Sheets</span></div>
          <div className="text-2xl font-bold mt-1">{stats.sheets}</div>
          <div className="text-xs text-muted-foreground mt-0.5">${fmt(stats.sheetValue)} value</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">Total Sacks</span></div>
          <div className="text-2xl font-bold mt-1">{stats.sacks}</div>
          <div className="text-xs text-muted-foreground mt-0.5">${fmt(stats.sackValue)} value</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2"><Package className="h-4 w-4 text-muted-foreground" /><span className="text-sm text-muted-foreground">All Items</span></div>
          <div className="text-2xl font-bold mt-1">{items.length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2"><span className="text-sm font-medium text-muted-foreground">$</span><span className="text-sm text-muted-foreground">Total Value</span></div>
          <div className="text-2xl font-bold mt-1">${fmt(stats.totalValue)}</div>
        </CardContent></Card>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b">
        <button
          onClick={() => setActiveTab("stock")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "stock" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Layers className="h-4 w-4" />
          Current Stock
        </button>
        <button
          onClick={() => setActiveTab("movements")}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "movements" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          Movement Log
        </button>
      </div>

      {/* ─── CURRENT STOCK TAB ───────────────────────────────────────────── */}
      {activeTab === "stock" && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, size..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-64"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            {(search || typeFilter !== "all") && (
              <span className="text-xs text-muted-foreground">
                Showing {filtered.length} of {items.length} items
              </span>
            )}
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
                      <Plus className="h-4 w-4 mr-1" />Add Item
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
                          <TableRow key={item.id} style={bg ? { backgroundColor: bg } : undefined}>
                            <TableCell className="px-2">
                              {item.rowColor ? (
                                <span className="inline-block rounded-full border border-border/50" style={{ width: 14, height: 14, backgroundColor: item.rowColor }} />
                              ) : (
                                <span className="inline-block rounded-full border border-border/30 bg-transparent" style={{ width: 14, height: 14 }} />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>{typeBadge(item.type)}</TableCell>
                            <TableCell className="text-muted-foreground">{item.size || "—"}</TableCell>
                            <TableCell className="text-right font-mono">{fmtInt(item.packQty)}</TableCell>
                            <TableCell className="text-right font-mono">{fmtInt(item.pcsPerPack)}</TableCell>
                            <TableCell className="text-right font-mono">{totalPcs > 0 ? totalPcs.toLocaleString("en-US") : "0"}</TableCell>
                            <TableCell className="text-right font-mono">${fmt(item.unitPrice)}</TableCell>
                            <TableCell className="text-right font-mono font-medium">${fmt(totalVal)}</TableCell>
                            <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{item.notes || "—"}</TableCell>
                            {canEdit && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="icon" variant="ghost" onClick={() => setRestockItem(item)} title="Add Stock">
                                    <PlusCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => setDeductItem(item)} title="Deduct">
                                    <MinusCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => setEditItem(item)} title="Edit">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => setDeleteItem(item)} title="Delete">
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    <tfoot className="border-t-2 bg-muted/40 font-semibold">
                      <tr>
                        <td className="w-6 px-2 py-3" />
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          Totals <span className="font-normal">({filtered.length} items)</span>
                        </td>
                        <td className="py-3 px-4" />{/* Type */}
                        <td className="py-3 px-4" />{/* Size */}
                        <td className="py-3 px-4 text-right font-mono text-sm">
                          {colTotals.packQty > 0 ? colTotals.packQty.toLocaleString("en-US") : "—"}
                        </td>
                        <td className="py-3 px-4" />{/* # / Pack */}
                        <td className="py-3 px-4 text-right font-mono text-sm">
                          {colTotals.pcs.toLocaleString("en-US")}
                        </td>
                        <td className="py-3 px-4" />{/* Price / Pc */}
                        <td className="py-3 px-4 text-right font-mono text-sm font-bold">
                          ${fmt(colTotals.value)}
                        </td>
                        <td className="py-3 px-4" />{/* Notes */}
                        {canEdit && <td className="py-3 px-4" />}
                      </tr>
                    </tfoot>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ─── MOVEMENT LOG TAB ─────────────────────────────────────────────── */}
      {activeTab === "movements" && <MovementLog items={items} />}

      {/* Dialogs */}
      {(showAddDialog || editItem) && (
        <ItemFormDialog
          open={showAddDialog || !!editItem}
          onClose={() => { setShowAddDialog(false); setEditItem(null); }}
          existing={editItem}
        />
      )}
      {deductItem && (
        <DeductDialog open={!!deductItem} onClose={() => setDeductItem(null)} item={deductItem} />
      )}
      {restockItem && (
        <RestockDialog open={!!restockItem} onClose={() => setRestockItem(null)} item={restockItem} />
      )}

      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteItem?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
              disabled={deleteMutation.isPending}
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
