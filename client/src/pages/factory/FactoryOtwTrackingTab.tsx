import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient as useTQClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Radio, RefreshCw, Loader2, CheckCircle, XCircle, AlertTriangle,
  Minus, AlertCircle, Settings2, MapPin, Activity, Search, X, Package,
  Pencil, ArrowUp, ArrowDown, ChevronsUpDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { FactoryContainer } from "@shared/schema";

// ── localStorage helpers ────────────────────────────────────────────────────
const NOTES_KEY = "factory-otw-row-notes";
const DOCS_KEY  = "factory-otw-row-docs";
function loadMap<T>(key: string): Record<string, T> {
  try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
}
function saveMap(key: string, map: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(map));
}

// ── Types ───────────────────────────────────────────────────────────────────
interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

export interface OtwTrackingTabProps {
  onEdit?: (container: ContainerWithSupplier) => void;
}

const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED"]);

// ── Currency helpers ────────────────────────────────────────────────────────
const CCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", AUD: "A$", CAD: "C$",
  CHF: "CHF", JPY: "¥", CNY: "¥", AED: "AED", SAR: "SAR", LBP: "LL",
};
function ccySym(code: string | null | undefined): string {
  if (!code) return "$";
  return CCY_SYMBOLS[code] || code;
}
function num(v: string | null | undefined): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? 0 : n;
}
function fmtAmt(symbol: string, amount: number): string {
  if (amount === 0) return "—";
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const plain = d.slice(0, 10);
  const [y, m, day] = plain.split("-");
  if (!y || !m || !day) return "—";
  return `${day}/${m}/${y.slice(2)}`;
}
function containerCost(c: ContainerWithSupplier): { symbol: string; amount: number } {
  const ccy = c.currencyCode || "USD";
  const symbol = ccySym(ccy);
  const amount = num(c.finalPayableAmount) > 0
    ? num(c.finalPayableAmount)
    : num(c.ratePerKg) * num(c.totalKg);
  return { symbol, amount };
}

// ── Colored status badges ────────────────────────────────────────────────────
const CONTAINER_STATUS_LABELS: Record<string, string> = {
  PENDING:            "Pending",
  IN_TRANSIT:         "In Transit",
  ARRIVED:            "Arrived",
  OFFLOADED:          "Offloaded",
  PARTIALLY_RECEIVED: "Partial",
  RECEIVED:           "Received",
};

function ContainerStatusBadge({ status }: { status: string }) {
  const label = CONTAINER_STATUS_LABELS[status] ?? status;
  if (status === "OFFLOADED")
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{label}</Badge>;
  if (status === "PARTIALLY_RECEIVED")
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{label}</Badge>;
  if (status === "IN_TRANSIT")
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{label}</Badge>;
  if (status === "ARRIVED")
    return <Badge className="text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{label}</Badge>;
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
}

function TrackingStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="secondary" className="text-xs">No data</Badge>;
  const s = status.toLowerCase();
  if (s.includes("transit") || s.includes("depart") || s.includes("vessel") || s.includes("at sea"))
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{status}</Badge>;
  if (s.includes("discharg") || s.includes("arrival") || s.includes("arrived") || s.includes("port"))
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{status}</Badge>;
  if (s.includes("deliver") || s.includes("final") || s.includes("complete"))
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{status}</Badge>;
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

// ── Inline notes cell ────────────────────────────────────────────────────────
function NotesCell({ containerId, notes, onSave }: {
  containerId: number;
  notes: Record<string, string>;
  onSave: (id: number, val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const current = notes[String(containerId)] ?? "";

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(current);
    setEditing(true);
  }
  function commit() {
    onSave(containerId, draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 text-xs min-w-[140px]"
        data-testid={`input-notes-${containerId}`}
      />
    );
  }
  return (
    <span
      className={`text-xs cursor-pointer rounded px-1 py-0.5 hover-elevate ${current ? "text-foreground" : "text-muted-foreground italic"}`}
      onClick={startEdit}
      data-testid={`text-notes-${containerId}`}
      title="Click to edit"
    >
      {current || "Add note…"}
    </span>
  );
}

// ── Event Timeline Sheet ─────────────────────────────────────────────────────
interface TrackingEvent {
  id: number;
  eventTime: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  provider: string | null;
}

function EventTimelineSheet({ containerId, containerNumber, open, onClose }: {
  containerId: number | null;
  containerNumber: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: events = [], isLoading } = useQuery<TrackingEvent[]>({
    queryKey: ["/api/factory/container-tracking", containerId, "events"],
    queryFn: async () => {
      if (!containerId) return [];
      const res = await factoryApiRequest("GET", `/api/factory/container-tracking/${containerId}/events`);
      return res.ok ? (res.json() as Promise<TrackingEvent[]>) : [];
    },
    enabled: open && !!containerId,
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Event History
            <span className="font-mono text-muted-foreground font-normal text-sm">{containerNumber}</span>
          </SheetTitle>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="px-6 py-4">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="h-4 w-4 rounded-full bg-muted animate-pulse shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
                      <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Activity className="h-10 w-10 opacity-20" />
                <p className="text-sm">No tracking events yet.</p>
                <p className="text-xs">Click the refresh icon on the row to fetch live data.</p>
              </div>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-0">
                {events.map((ev, idx) => {
                  const dt = ev.eventTime ? new Date(ev.eventTime) : null;
                  return (
                    <li key={ev.id} className="ml-4 pb-6 last:pb-0">
                      <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full border bg-background ring-2 ring-background">
                        <span className={`h-1.5 w-1.5 rounded-full ${idx === 0 ? "bg-blue-500" : "bg-muted-foreground/40"}`} />
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium leading-snug">{ev.description ?? ev.status ?? "—"}</p>
                        {ev.location && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0" />{ev.location}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {dt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "—"}
                          {ev.provider && <span className="ml-2 opacity-60">via {ev.provider}</span>}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Tracking Settings Sheet ──────────────────────────────────────────────────
function TrackingSettingsSheet({ container, open, onClose }: {
  container: ContainerWithSupplier | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [enabled, setEnabled] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [carrierHint, setCarrierHint] = useState("");

  useEffect(() => {
    if (container) {
      const fc = container as any;
      setEnabled(fc.trackingEnabled !== false);
      setAutoUpdate(fc.trackingAutoUpdate !== false);
      setCarrierHint(fc.trackingCarrierHint ?? "");
    }
  }, [container]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!container) return;
      await factoryApiRequest("PATCH", `/api/factory/container-tracking/${container.id}/settings`, {
        trackingEnabled: enabled,
        trackingAutoUpdate: autoUpdate,
        trackingCarrierHint: carrierHint.trim() || null,
      });
    },
    onSuccess: () => {
      tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Tracking settings saved" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save settings", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-sm flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Tracking Settings
            {container && <span className="font-mono text-muted-foreground font-normal text-sm">{container.containerNumber}</span>}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 px-6 py-5 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable Tracking</p>
              <p className="text-xs text-muted-foreground mt-0.5">Allow this container to be tracked via carrier APIs</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-tracking-enabled" />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto Update</p>
              <p className="text-xs text-muted-foreground mt-0.5">Let the scheduler check this container automatically</p>
            </div>
            <Switch checked={autoUpdate} onCheckedChange={setAutoUpdate} disabled={!enabled} data-testid="switch-auto-update" />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="carrier-hint-tab" className="text-sm font-medium">Carrier Hint</Label>
            <p className="text-xs text-muted-foreground">Optional — helps the system find the right carrier faster (e.g. MAERSK, CMA)</p>
            <Input
              id="carrier-hint-tab"
              value={carrierHint}
              onChange={(e) => setCarrierHint(e.target.value.toUpperCase())}
              placeholder="e.g. MAERSK"
              disabled={!enabled}
              data-testid="input-carrier-hint-tab"
            />
          </div>
        </div>
        <div className="px-6 pb-6 shrink-0">
          <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-tracking-settings-tab">
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Track-now progress steps ─────────────────────────────────────────────────
interface ProgressStep {
  provider: string;
  status: "running" | "success" | "fail" | "skip" | "blocked";
  detail?: string;
  ts: number;
}
function ProgressStepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  if (status === "success") return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (status === "fail")    return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skip")    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}
function TrackNowProgressLog({ containerId }: { containerId: number }) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await factoryApiRequest("GET", `/api/factory/container-tracking/${containerId}/progress`);
          const data: ProgressStep[] = res.ok ? await res.json() : [];
          if (!cancelled) setSteps(data ?? []);
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [containerId]);

  if (steps.length === 0) {
    return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Starting…</div>;
  }
  return (
    <div className="flex flex-col gap-0.5 max-w-[140px]">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <ProgressStepIcon status={s.status} />
          <span className="text-muted-foreground truncate">{s.provider}</span>
        </div>
      ))}
    </div>
  );
}

// ── Sortable ETA header ──────────────────────────────────────────────────────
type EtaSort = "none" | "asc" | "desc";
function EtaSortIcon({ sort }: { sort: EtaSort }) {
  if (sort === "asc")  return <ArrowUp className="h-3.5 w-3.5 ml-1 shrink-0" />;
  if (sort === "desc") return <ArrowDown className="h-3.5 w-3.5 ml-1 shrink-0" />;
  return <ChevronsUpDown className="h-3.5 w-3.5 ml-1 shrink-0 opacity-40" />;
}

// ── Main component ───────────────────────────────────────────────────────────
export default function FactoryOtwTrackingTab({ onEdit }: OtwTrackingTabProps = {}) {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [trackingNowId, setTrackingNowId]         = useState<number | null>(null);
  const [timelineId, setTimelineId]               = useState<number | null>(null);
  const [settingsContainer, setSettingsContainer] = useState<ContainerWithSupplier | null>(null);
  const [statusFilter, setStatusFilter]           = useState<string>("all");
  const [supplierFilter, setSupplierFilter]       = useState<string>("all");
  const [freightFilter, setFreightFilter]         = useState<string>("all");
  const [docsFilter, setDocsFilter]               = useState<string>("all");
  const [search, setSearch]                       = useState("");
  const [etaSort, setEtaSort]                     = useState<EtaSort>("asc");

  const [notes, setNotes] = useState<Record<string, string>>(() => loadMap<string>(NOTES_KEY));
  const [docs,  setDocs]  = useState<Record<string, boolean>>(() => loadMap<boolean>(DOCS_KEY));

  const { data: containers, isLoading } = useQuery<ContainerWithSupplier[]>({
    queryKey: ["/api/factory/containers"],
  });

  const otwContainers = (containers || []).filter((c) => STATUS_ACTIVE.has(c.status));

  // Supplier list for filter
  const suppliers = Array.from(
    new Map(otwContainers.map((c) => [String(c.supplierId ?? "none"), (c as any).supplierName || "No Supplier"])).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Status tab counts
  const statusCounts: Record<string, number> = { all: otwContainers.length };
  for (const c of otwContainers) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  }

  // Apply filters + sort
  let filtered = otwContainers.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (supplierFilter !== "all" && String(c.supplierId ?? "none") !== supplierFilter) return false;
    if (freightFilter === "has_freight" && !(num(c.freight) > 0)) return false;
    if (freightFilter === "no_freight"  && num(c.freight) > 0)    return false;
    if (docsFilter === "received"     && !docs[String(c.id)])  return false;
    if (docsFilter === "not_received" && !!docs[String(c.id)]) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !c.containerNumber?.toLowerCase().includes(q) &&
        !(c as any).supplierName?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // ETA sort
  filtered = [...filtered].sort((a, b) => {
    if (etaSort === "none") return 0;
    const da = a.arrivalDate ? new Date(a.arrivalDate).getTime() : (etaSort === "asc" ? Infinity : -Infinity);
    const db = b.arrivalDate ? new Date(b.arrivalDate).getTime() : (etaSort === "asc" ? Infinity : -Infinity);
    return etaSort === "asc" ? da - db : db - da;
  });

  // Totals
  const totals = filtered.reduce(
    (acc, c) => {
      const cost = containerCost(c);
      acc.cost[cost.symbol] = (acc.cost[cost.symbol] || 0) + cost.amount;
      const frSym = ccySym(c.freightCurrencyCode || c.currencyCode);
      const fr = num(c.freight);
      if (fr) acc.freight[frSym] = (acc.freight[frSym] || 0) + fr;
      const commSym = ccySym(c.commissionCurrencyCode || "USD");
      const comm = num(c.commissionAmount);
      if (comm) acc.comm[commSym] = (acc.comm[commSym] || 0) + comm;
      return acc;
    },
    { cost: {} as Record<string, number>, freight: {} as Record<string, number>, comm: {} as Record<string, number> }
  );

  function fmtTotals(map: Record<string, number>): string {
    const entries = Object.entries(map).filter(([, v]) => v > 0);
    if (!entries.length) return "—";
    return entries.map(([sym, amt]) =>
      `${sym} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ).join(" · ");
  }

  function saveNote(id: number, val: string) {
    setNotes((prev) => { const next = { ...prev, [String(id)]: val }; saveMap(NOTES_KEY, next); return next; });
  }
  function toggleDoc(id: number, checked: boolean) {
    setDocs((prev) => { const next = { ...prev, [String(id)]: checked }; saveMap(DOCS_KEY, next); return next; });
  }

  const trackNowMutation = useMutation({
    mutationFn: async (containerId: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/container-tracking/${containerId}/track-now`, {});
      return res as any;
    },
    onMutate: (id) => setTrackingNowId(id),
    onSuccess: (data) => {
      setTrackingNowId(null);
      tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({
        title: data.success ? "Tracking updated" : "Tracking failed",
        description: data.success
          ? `${data.containerNumber}: ${data.lastStatus ?? "Status fetched"}`
          : `${data.containerNumber}: ${data.error ?? "Unknown error"}`,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (err: any) => {
      setTrackingNowId(null);
      toast({ title: "Tracking failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const today = new Date().toDateString();
  const checkedToday = otwContainers.filter((c) => {
    const fc = c as any;
    return fc.trackingLastCheckedAt && new Date(fc.trackingLastCheckedAt).toDateString() === today;
  }).length;
  const withErrors = otwContainers.filter((c) => !!(c as any).trackingError).length;
  const docsReceived = filtered.filter((c) => docs[String(c.id)]).length;
  const timelineContainer = otwContainers.find((c) => c.id === timelineId) ?? null;

  const STATUS_TABS = [
    { key: "all",        label: "All" },
    { key: "PENDING",    label: "Pending" },
    { key: "IN_TRANSIT", label: "In Transit" },
    { key: "ARRIVED",    label: "Arrived" },
  ];

  const hasActiveFilters = search || supplierFilter !== "all" || freightFilter !== "all" || docsFilter !== "all";

  function cycleEtaSort() {
    setEtaSort((s) => s === "none" ? "asc" : s === "asc" ? "desc" : "none");
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  if (otwContainers.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Radio className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground">No containers currently on the way.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">OTW Containers</p>
            <p className="text-2xl font-bold tabular-nums">{otwContainers.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Checked Today</p>
            <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">{checkedToday}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">With Errors</p>
            <p className={`text-2xl font-bold tabular-nums ${withErrors > 0 ? "text-destructive" : "text-muted-foreground"}`}>
              {withErrors}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Status filter tabs ── */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_TABS.filter((t) => t.key === "all" || (statusCounts[t.key] ?? 0) > 0).map(({ key, label }) => (
          <Button
            key={key}
            variant={statusFilter === key ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(key)}
            data-testid={`button-otw-filter-${key}`}
          >
            {label}
            {(statusCounts[key] ?? 0) > 0 && (
              <span className="ml-1 text-xs opacity-70">({statusCounts[key]})</span>
            )}
          </Button>
        ))}
      </div>

      {/* ── Search + dropdown filters ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search container #, supplier…"
            className="pl-8"
            data-testid="input-otw-search"
          />
        </div>

        {/* Supplier */}
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-[170px]" data-testid="select-supplier-filter">
            <SelectValue placeholder="All suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All suppliers</SelectItem>
            {suppliers.map(([key, name]) => (
              <SelectItem key={key} value={key}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Freight */}
        <Select value={freightFilter} onValueChange={setFreightFilter}>
          <SelectTrigger className="w-[150px]" data-testid="select-freight-filter">
            <SelectValue placeholder="Freight" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All freight</SelectItem>
            <SelectItem value="has_freight">Has freight</SelectItem>
            <SelectItem value="no_freight">No freight</SelectItem>
          </SelectContent>
        </Select>

        {/* Docs */}
        <Select value={docsFilter} onValueChange={setDocsFilter}>
          <SelectTrigger className="w-[150px]" data-testid="select-docs-filter">
            <SelectValue placeholder="Docs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All docs</SelectItem>
            <SelectItem value="received">Docs received</SelectItem>
            <SelectItem value="not_received">Docs pending</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setSearch(""); setSupplierFilter("all"); setFreightFilter("all"); setDocsFilter("all"); }}
            data-testid="button-clear-filters"
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length !== otwContainers.length ? `${filtered.length} of ${otwContainers.length}` : `${filtered.length}`} shown
          {" · "}{docsReceived} docs received
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Radio className="h-10 w-10 opacity-30" />
          <p className="text-sm">No containers match your filters.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead className="whitespace-nowrap">Container #</TableHead>
                <TableHead className="whitespace-nowrap">Supplier</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Tracking</TableHead>
                <TableHead
                  className="whitespace-nowrap cursor-pointer select-none"
                  onClick={cycleEtaSort}
                  data-testid="th-eta-sort"
                >
                  <span className="flex items-center">
                    ETA <EtaSortIcon sort={etaSort} />
                  </span>
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">Cost</TableHead>
                <TableHead className="whitespace-nowrap text-right">Freight</TableHead>
                <TableHead className="whitespace-nowrap text-right">Commission</TableHead>
                <TableHead className="whitespace-nowrap text-center">Docs</TableHead>
                <TableHead className="whitespace-nowrap min-w-[150px]">Notes</TableHead>
                <TableHead className="whitespace-nowrap text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c, idx) => {
                const fc         = c as any;
                const cost       = containerCost(c);
                const frSym      = ccySym(c.freightCurrencyCode || c.currencyCode);
                const commSym    = ccySym(c.commissionCurrencyCode || "USD");
                const docDone    = !!docs[String(c.id)];
                const isTracking = trackingNowId === c.id;
                const hasError   = !!fc.trackingError;
                const isEnabled  = fc.trackingEnabled !== false;
                const isValidNum = /^[A-Z]{4}\d{7}$/.test((c.containerNumber || "").trim().toUpperCase());
                const isOverdue  = c.arrivalDate && new Date(c.arrivalDate) < new Date();

                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setTimelineId(c.id)}
                    data-testid={`row-otw-container-${c.id}`}
                  >
                    {/* # */}
                    <TableCell className="text-center text-muted-foreground text-sm">{idx + 1}</TableCell>

                    {/* Container # */}
                    <TableCell className="font-mono font-semibold text-sm whitespace-nowrap">
                      <div className="flex flex-col gap-0.5">
                        <span>{c.containerNumber || "—"}</span>
                        {!isValidNum && (
                          <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />Invalid format
                          </span>
                        )}
                        {isTracking && <TrackNowProgressLog containerId={c.id} />}
                        {!isTracking && hasError && (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <XCircle className="h-3 w-3 shrink-0" />
                            {(() => {
                              const err: string = fc.trackingError ?? "";
                              return err.toLowerCase().includes("timeout") ? "Carrier timeout" : err.slice(0, 40);
                            })()}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Supplier */}
                    <TableCell className="text-sm whitespace-nowrap">
                      {fc.supplierName ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <ContainerStatusBadge status={c.status ?? "PENDING"} />
                    </TableCell>

                    {/* Tracking status */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {isTracking ? (
                        <Badge variant="secondary" className="text-xs"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Tracking…</Badge>
                      ) : (
                        <TrackingStatusBadge status={fc.trackingLastStatus} />
                      )}
                    </TableCell>

                    {/* ETA */}
                    <TableCell className="text-sm whitespace-nowrap font-medium">
                      {c.arrivalDate ? (
                        <span className={isOverdue ? "text-amber-600 dark:text-amber-400" : ""}>
                          {fmtDate(c.arrivalDate)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    {/* Cost */}
                    <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                      {cost.amount > 0
                        ? <span className="font-medium">{fmtAmt(cost.symbol, cost.amount)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Freight */}
                    <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                      {num(c.freight) > 0
                        ? fmtAmt(frSym, num(c.freight))
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Commission */}
                    <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                      {num(c.commissionAmount) > 0
                        ? fmtAmt(commSym, num(c.commissionAmount))
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>

                    {/* Docs */}
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={docDone}
                        onCheckedChange={(v) => toggleDoc(c.id, !!v)}
                        data-testid={`checkbox-docs-${c.id}`}
                        aria-label="Docs received"
                      />
                    </TableCell>

                    {/* Notes */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <NotesCell containerId={c.id} notes={notes} onSave={saveNote} />
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit(c)}
                                data-testid={`button-otw-edit-${c.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit Container</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSettingsContainer(c)}
                              data-testid={`button-otw-settings-${c.id}`}
                            >
                              <Settings2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Tracking Settings</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isTracking || !isEnabled || !isValidNum}
                              onClick={() => trackNowMutation.mutate(c.id)}
                              data-testid={`button-otw-track-now-${c.id}`}
                            >
                              {isTracking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {!isEnabled ? "Tracking disabled" : !isValidNum ? "Invalid container # format" : "Track Now"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Sticky totals bar ── */}
      {filtered.length > 0 && (
        <div className="sticky bottom-0 z-50 rounded-md border bg-background shadow-md" data-testid="div-totals-bar">
          <div className="flex flex-wrap items-center gap-6 px-4 py-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Containers</p>
                <p className="text-base font-bold tabular-nums">{filtered.length}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="text-base font-bold tabular-nums whitespace-nowrap">{fmtTotals(totals.cost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Freight</p>
              <p className="text-base font-bold tabular-nums whitespace-nowrap">{fmtTotals(totals.freight)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Commission</p>
              <p className="text-base font-bold tabular-nums whitespace-nowrap">{fmtTotals(totals.comm)}</p>
            </div>
            <div className="ml-auto">
              <p className="text-xs text-muted-foreground">Docs Received</p>
              <p className="text-base font-bold tabular-nums">{docsReceived} / {filtered.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Sheets ── */}
      <EventTimelineSheet
        containerId={timelineId}
        containerNumber={timelineContainer?.containerNumber ?? ""}
        open={!!timelineId}
        onClose={() => setTimelineId(null)}
      />
      <TrackingSettingsSheet
        container={settingsContainer}
        open={!!settingsContainer}
        onClose={() => setSettingsContainer(null)}
      />
    </div>
  );
}
