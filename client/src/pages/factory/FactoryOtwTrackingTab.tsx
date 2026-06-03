import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient as useTQClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Pencil, ArrowUp, ArrowDown, ChevronsUpDown, Ship, Truck, CheckCircle2,
  DollarSign, Clock, Filter, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
function calcDelayDays(c: ContainerWithSupplier): number {
  if (!c.arrivalDate) return 0;
  const eta = new Date(c.arrivalDate); eta.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - eta.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}
function isOverdue(c: ContainerWithSupplier): boolean {
  return calcDelayDays(c) > 0;
}

// ── Summary Card (mirrors ERP SummaryCard) ───────────────────────────────────
function SummaryCard({ label, value, icon, accent }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 min-w-0">
      <div className={cn("flex items-center justify-center h-9 w-9 rounded-md shrink-0", accent ?? "bg-muted")}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground font-medium leading-none mb-1 whitespace-nowrap">{label}</p>
        <p className="text-xl font-bold leading-none tracking-tight whitespace-nowrap">{value}</p>
      </div>
    </div>
  );
}

// ── Status badge ─────────────────────────────────────────────────────────────
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
  if (status === "IN_TRANSIT")
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{label}</Badge>;
  if (status === "ARRIVED")
    return <Badge className="text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{label}</Badge>;
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
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
      className={`text-xs cursor-pointer rounded px-1 py-0.5 hover-elevate max-w-[140px] truncate block ${current ? "text-foreground" : "text-muted-foreground italic"}`}
      onClick={startEdit}
      data-testid={`text-notes-${containerId}`}
      title={current || "Click to add note"}
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

// ── Track-now progress log ────────────────────────────────────────────────────
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

// ── Main component ───────────────────────────────────────────────────────────
export default function FactoryOtwTrackingTab({ onEdit }: OtwTrackingTabProps = {}) {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [trackingNowId, setTrackingNowId]         = useState<number | null>(null);
  const [timelineId, setTimelineId]               = useState<number | null>(null);
  const [settingsContainer, setSettingsContainer] = useState<ContainerWithSupplier | null>(null);
  const [supplierFilter, setSupplierFilter]       = useState<string>("all");
  const [freightFilter, setFreightFilter]         = useState<string>("all");
  const [docsFilter, setDocsFilter]               = useState<string>("all");
  const [delayedFilter, setDelayedFilter]         = useState<string>("all");
  const [sortOrder, setSortOrder]                 = useState<string>("DEFAULT");
  const [search, setSearch]                       = useState("");
  const [showFilters, setShowFilters]             = useState(false);

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

  // Apply filters + sort
  let filtered = otwContainers.filter((c) => {
    if (supplierFilter !== "all" && String(c.supplierId ?? "none") !== supplierFilter) return false;
    if (freightFilter === "has_freight" && !(num(c.freight) > 0)) return false;
    if (freightFilter === "no_freight"  && num(c.freight) > 0)    return false;
    if (docsFilter === "received"     && !docs[String(c.id)])  return false;
    if (docsFilter === "not_received" && !!docs[String(c.id)]) return false;
    if (delayedFilter === "delayed"  && calcDelayDays(c) === 0) return false;
    if (delayedFilter === "overdue"  && !isOverdue(c))          return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !c.containerNumber?.toLowerCase().includes(q) &&
        !(c as any).supplierName?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (sortOrder === "ETA_ASC" || sortOrder === "ETA_DESC") {
      const da = a.arrivalDate ? new Date(a.arrivalDate).getTime() : (sortOrder === "ETA_ASC" ? Infinity : -Infinity);
      const db = b.arrivalDate ? new Date(b.arrivalDate).getTime() : (sortOrder === "ETA_ASC" ? Infinity : -Infinity);
      if (da !== db) return sortOrder === "ETA_ASC" ? da - db : db - da;
    }
    const sa = ((a as any).supplierName || "").toLowerCase();
    const sb = ((b as any).supplierName || "").toLowerCase();
    return sa.localeCompare(sb);
  });

  // Summary stats
  const pending   = otwContainers.filter((c) => c.status === "PENDING").length;
  const inTransit = otwContainers.filter((c) => c.status === "IN_TRANSIT").length;
  const arrived   = otwContainers.filter((c) => c.status === "ARRIVED").length;
  const delayed   = otwContainers.filter((c) => calcDelayDays(c) > 0).length;
  const withErrors = otwContainers.filter((c) => !!(c as any).trackingError).length;
  const today = new Date().toDateString();
  const checkedToday = otwContainers.filter((c) => {
    const fc = c as any;
    return fc.trackingLastCheckedAt && new Date(fc.trackingLastCheckedAt).toDateString() === today;
  }).length;

  // Cost totals grouped by currency
  const costByCurrency = filtered.reduce<Record<string, { symbol: string; amount: number }>>((acc, c) => {
    const { symbol, amount } = containerCost(c);
    const ccy = c.currencyCode || "USD";
    if (amount > 0) {
      if (!acc[ccy]) acc[ccy] = { symbol, amount: 0 };
      acc[ccy].amount += amount;
    }
    return acc;
  }, {});

  const docsReceived = filtered.filter((c) => docs[String(c.id)]).length;
  const timelineContainer = otwContainers.find((c) => c.id === timelineId) ?? null;
  const trackingEnabledCount = otwContainers.filter((c) => (c as any).trackingEnabled !== false).length;

  const hasActiveFilters = search || supplierFilter !== "all" || freightFilter !== "all" || docsFilter !== "all" || delayedFilter !== "all" || sortOrder !== "DEFAULT";

  function saveNote(id: number, val: string) {
    setNotes((prev) => { const next = { ...prev, [String(id)]: val }; saveMap(NOTES_KEY, next); return next; });
  }
  function toggleDoc(id: number, checked: boolean) {
    setDocs((prev) => { const next = { ...prev, [String(id)]: checked }; saveMap(DOCS_KEY, next); return next; });
  }
  function clearFilters() {
    setSearch(""); setSupplierFilter("all"); setFreightFilter("all"); setDocsFilter("all"); setDelayedFilter("all"); setSortOrder("DEFAULT");
  }

  const trackNowMutation = useMutation({
    mutationFn: async (containerId: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/container-tracking/${containerId}/track-now`, {});
      if (!res.ok) throw new Error("Failed to dispatch tracking");
      return containerId;
    },
    onMutate: (id) => setTrackingNowId(id),
    onSuccess: (_containerId) => {
      toast({ title: "Tracking started", description: "Fetching live data in the background…" });
      // Poll for updated container data while tracking runs in background
      let elapsed = 0;
      const POLL_MS = 4000;
      const MAX_MS = 28000;
      const interval = setInterval(() => {
        elapsed += POLL_MS;
        tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
        if (elapsed >= MAX_MS) {
          clearInterval(interval);
          setTrackingNowId(null);
        }
      }, POLL_MS);
    },
    onError: (err: any) => {
      setTrackingNowId(null);
      toast({ title: "Tracking failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const [bulkTracking, setBulkTracking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  async function trackAll() {
    const eligible = otwContainers.filter((c) => {
      const fc = c as any;
      return fc.trackingEnabled !== false && /^[A-Z]{4}\d{7}$/.test((c.containerNumber || "").trim().toUpperCase());
    });
    if (eligible.length === 0) {
      toast({ title: "No eligible containers", description: "All containers have tracking disabled or invalid numbers." });
      return;
    }
    setBulkTracking(true);
    setBulkProgress({ done: 0, total: eligible.length });
    // Dispatch all tracking requests — each responds immediately (fire-and-forget on server)
    for (let i = 0; i < eligible.length; i++) {
      const c = eligible[i];
      try {
        await factoryApiRequest("POST", `/api/factory/container-tracking/${c.id}/track-now`, {});
      } catch { /* ignore dispatch errors */ }
      setBulkProgress({ done: i + 1, total: eligible.length });
    }
    setBulkTracking(false);
    setBulkProgress(null);
    toast({
      title: `Tracking ${eligible.length} containers…`,
      description: "Results will appear automatically over the next minute.",
    });
    // Poll for results as background tracking completes
    let elapsed = 0;
    const POLL_MS = 5000;
    const MAX_MS = 60000;
    const interval = setInterval(() => {
      elapsed += POLL_MS;
      tqClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      if (elapsed >= MAX_MS) clearInterval(interval);
    }, POLL_MS);
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 w-36 rounded-lg border bg-muted animate-pulse" />)}
        </div>
        <div className="h-48 rounded-lg border bg-muted animate-pulse" />
      </div>
    );
  }

  if (otwContainers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <Radio className="h-12 w-12 opacity-20" />
        <p className="text-sm">No containers currently on the way.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* ── Summary Cards (ERP-style) ── */}
      <div className="flex flex-wrap gap-2">
        <SummaryCard label="Active" value={otwContainers.length} icon={<Package className="h-4 w-4 text-primary" />} accent="bg-primary/10" />
        {pending > 0 && <SummaryCard label="Pending" value={pending} icon={<Ship className="h-4 w-4 text-blue-600" />} accent="bg-blue-100 dark:bg-blue-900/30" />}
        {inTransit > 0 && <SummaryCard label="In Transit" value={inTransit} icon={<Truck className="h-4 w-4 text-indigo-600" />} accent="bg-indigo-100 dark:bg-indigo-900/30" />}
        {arrived > 0 && <SummaryCard label="Arrived" value={arrived} icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />}
        {delayed > 0 && <SummaryCard label="Delayed" value={delayed} icon={<Clock className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />}
        {withErrors > 0 && <SummaryCard label="With Errors" value={withErrors} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />}
        <SummaryCard
          label="Checked Today"
          value={checkedToday}
          icon={<CheckCircle className="h-4 w-4 text-green-600" />}
          accent="bg-green-100 dark:bg-green-900/30"
        />
        {Object.entries(costByCurrency).map(([ccy, { symbol, amount }]) => (
          <SummaryCard
            key={ccy}
            label={`Total (${ccy})`}
            value={`${symbol} ${Math.round(amount).toLocaleString()}`}
            icon={<DollarSign className="h-4 w-4 text-emerald-600" />}
            accent="bg-emerald-100 dark:bg-emerald-900/30"
          />
        ))}
      </div>

      {/* ── Search + Filters Toggle + Track All ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search container #, supplier…"
            className="pl-8"
            data-testid="input-otw-search"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowFilters((v) => !v)}
          data-testid="button-otw-filters"
        >
          <Filter className="h-4 w-4 mr-1" />
          Filters
          <ChevronDown className={cn("h-3.5 w-3.5 ml-1 transition-transform", showFilters && "rotate-180")} />
        </Button>
        <Button
          variant="outline"
          onClick={trackAll}
          disabled={bulkTracking || otwContainers.length === 0}
          data-testid="button-track-all-now"
        >
          {bulkTracking
            ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            : <RefreshCw className="h-4 w-4 mr-1.5" />}
          {bulkTracking
            ? bulkProgress ? `Tracking… ${bulkProgress.done}/${bulkProgress.total}` : "Tracking…"
            : `Track All${trackingEnabledCount > 0 ? ` (${trackingEnabledCount})` : ""}`}
        </Button>
      </div>

      {/* ── Expandable Filters Panel ── */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-md border bg-muted/30 p-3">
          <div className="flex flex-col gap-1 min-w-[160px] flex-1">
            <p className="text-xs text-muted-foreground">Supplier</p>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-supplier-filter">
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers</SelectItem>
                {suppliers.map(([key, name]) => (
                  <SelectItem key={key} value={key}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <p className="text-xs text-muted-foreground">Freight</p>
            <Select value={freightFilter} onValueChange={setFreightFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-freight-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All freight</SelectItem>
                <SelectItem value="has_freight">Has freight</SelectItem>
                <SelectItem value="no_freight">No freight</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <p className="text-xs text-muted-foreground">Docs</p>
            <Select value={docsFilter} onValueChange={setDocsFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-docs-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All docs</SelectItem>
                <SelectItem value="received">Docs received</SelectItem>
                <SelectItem value="not_received">Docs pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[130px] flex-1">
            <p className="text-xs text-muted-foreground">Delay / Overdue</p>
            <Select value={delayedFilter} onValueChange={setDelayedFilter}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-delayed-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="delayed">Delayed only</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[120px] flex-1">
            <p className="text-xs text-muted-foreground">Sort by ETA</p>
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-sort-order">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">Default</SelectItem>
                <SelectItem value="ETA_ASC">Oldest first</SelectItem>
                <SelectItem value="ETA_DESC">Newest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters} data-testid="button-clear-filters">
              Clear All
            </Button>
          </div>
        </div>
      )}

      {/* ── Results count + Legend ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {otwContainers.length} active containers — click a row to edit
        </p>
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-200 dark:bg-red-900/40" />
            Overdue
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-900/40" />
            Tracking Error
          </span>
          <span className="text-muted-foreground">{docsReceived} docs received</span>
        </div>
      </div>

      {/* ── Main Table ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <Radio className="h-10 w-10 opacity-30" />
          <p className="text-sm">No containers match your filters.</p>
        </div>
      ) : (
        <Table className="text-xs whitespace-nowrap" wrapperClassName="max-h-[calc(100vh-340px)] overflow-x-auto">
          <TableHeader className="sticky top-0 z-10">
            <TableRow className="!bg-amber-100 dark:!bg-amber-900/40">
              <TableHead className="w-8">#</TableHead>
              <TableHead>Container #</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Freight</TableHead>
              <TableHead className="text-right">Commission</TableHead>
              <TableHead className="text-right">Duty</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Weight (kg)</TableHead>
              <TableHead>Delayed</TableHead>
              <TableHead>Docs</TableHead>
              <TableHead className="min-w-[140px]">Notes</TableHead>
              <TableHead className="w-24 text-right pr-3">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c, idx) => {
              const fc         = c as any;
              const cost       = containerCost(c);
              const frSym      = ccySym(c.freightCurrencyCode || c.currencyCode);
              const commSym    = ccySym(c.commissionCurrencyCode || "USD");
              const dutySym    = ccySym(c.currencyCode);
              const docDone    = !!docs[String(c.id)];
              const isTracking = trackingNowId === c.id;
              const hasError   = !!fc.trackingError;
              const isEnabled  = fc.trackingEnabled !== false;
              const isValidNum = /^[A-Z]{4}\d{7}$/.test((c.containerNumber || "").trim().toUpperCase());
              const delayDays  = calcDelayDays(c);
              const overdue    = isOverdue(c);
              const location   = fc.trackingLastLocation || c.destination || null;

              const rowBg = overdue
                ? "bg-red-50/50 dark:bg-red-950/20"
                : hasError
                ? "bg-amber-50/50 dark:bg-amber-950/20"
                : "";

              return (
                <TableRow
                  key={c.id}
                  className={cn("cursor-pointer", rowBg)}
                  onClick={() => setTimelineId(c.id)}
                  data-testid={`row-otw-container-${c.id}`}
                >
                  {/* # */}
                  <TableCell className="text-muted-foreground">{idx + 1}</TableCell>

                  {/* Container # */}
                  <TableCell className="font-mono font-medium">
                    <div className="flex flex-col gap-0.5">
                      <span>{c.containerNumber || "—"}</span>
                      {isTracking && <TrackNowProgressLog containerId={c.id} />}
                      {!isTracking && hasError && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <XCircle className="h-3 w-3 shrink-0" />
                          {(() => {
                            const err: string = fc.trackingError ?? "";
                            const low = err.toLowerCase();
                            return (low.includes("timeout") || low.includes("timed out")) ? "Carrier timeout" : err.slice(0, 35);
                          })()}
                        </span>
                      )}
                      {!isValidNum && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />Invalid format
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Supplier */}
                  <TableCell>
                    {fc.supplierName ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* ETA */}
                  <TableCell className={cn("font-medium", overdue && "text-red-600 dark:text-red-400")}>
                    {fmtDate(c.arrivalDate)}
                  </TableCell>

                  {/* Cost */}
                  <TableCell className="text-right font-medium">
                    {cost.amount > 0 ? fmtAmt(cost.symbol, cost.amount) : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Freight */}
                  <TableCell className="text-right text-muted-foreground">
                    {num(c.freight) > 0 ? fmtAmt(frSym, num(c.freight)) : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Commission */}
                  <TableCell className="text-right text-muted-foreground">
                    {num(c.commissionAmount) > 0 ? fmtAmt(commSym, num(c.commissionAmount)) : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Duty */}
                  <TableCell className="text-right text-muted-foreground">
                    {num(c.dutyAmount) > 0 ? fmtAmt(dutySym, num(c.dutyAmount)) : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Location */}
                  <TableCell>
                    {location ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Weight */}
                  <TableCell className="text-muted-foreground">
                    {c.totalKg
                      ? Number(c.totalKg).toLocaleString(undefined, { maximumFractionDigits: 0 })
                      : <span>—</span>}
                  </TableCell>

                  {/* Delayed */}
                  <TableCell>
                    {delayDays > 0
                      ? <span className="text-red-600 dark:text-red-400 font-medium">-{delayDays}d</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>

                  {/* Docs */}
                  <TableCell onClick={(e) => e.stopPropagation()}>
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
                  <TableCell className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5">
                      {onEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => onEdit(c)} data-testid={`button-otw-edit-${c.id}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit Container</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setSettingsContainer(c)} data-testid={`button-otw-settings-${c.id}`}>
                            <Settings2 className="h-3.5 w-3.5" />
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
                            {isTracking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
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
