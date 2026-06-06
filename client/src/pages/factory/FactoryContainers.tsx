import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { useQuery, useMutation, useQueryClient as useTQClient } from "@tanstack/react-query";
import { useAdminOverride } from "@/hooks/use-admin-override";
import FactoryOtwTrackingTab from "./FactoryOtwTrackingTab";
import { Plus, Pencil, Container, Trash2, Upload, FileSpreadsheet, Download, AlertCircle, CheckCircle2, Search, ArrowDown, AlertTriangle, RotateCcw, CheckSquare, ChevronDown, ChevronRight, Ship, Building2, StickyNote, Boxes, Package, LayoutList, GripHorizontal, Minus, PlusCircle, X, Info, Radio, RefreshCw, Loader2, Clock, CheckCircle, XCircle, Settings2, MapPin, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { factoryApiRequest } from "@/lib/factoryApi";
import { enqueueRequest } from "@/lib/offlineQueue";
import { formatNumber } from "@/lib/formatNumber";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FactoryContainer, FactorySupplier } from "@shared/schema";

interface ContainerWithSupplier extends FactoryContainer {
  supplierName?: string | null;
}

// ── OTW Summary helpers ──────────────────────────────────────────────────────

const OTW_NOTES_KEY = "factory-otw-notes";
const STATUS_ACTIVE = new Set(["PENDING", "IN_TRANSIT", "ARRIVED", "PARTIALLY_RECEIVED"]);

const CCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", AUD: "A$", CAD: "C$",
  CHF: "CHF", JPY: "¥", CNY: "¥", AED: "AED", SAR: "SAR", LBP: "LL",
};

function otwNum(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function otwCcySymbol(code: string | null | undefined): string {
  if (!code) return "$";
  return CCY_SYMBOLS[code] || code;
}

function otwFmtCcy(symbol: string, amount: number): string {
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function otwAddToCurrency(map: Record<string, number>, ccy: string, amount: number) {
  if (amount > 0 && ccy) map[ccy] = (map[ccy] || 0) + amount;
}

function otwContainerByCurrency(c: ContainerWithSupplier): Record<string, number> {
  const amounts: Record<string, number> = {};
  const containerCcy = (c as any).currencyCode || "USD";
  const goodsValue = otwNum((c as any).finalPayableAmount) > 0
    ? otwNum((c as any).finalPayableAmount)
    : otwNum(c.ratePerKg) * otwNum(c.totalKg);
  otwAddToCurrency(amounts, containerCcy, goodsValue);
  otwAddToCurrency(amounts, (c as any).freightCurrencyCode || containerCcy, otwNum((c as any).freight));
  otwAddToCurrency(amounts, (c as any).commissionCurrencyCode || "USD", otwNum((c as any).commissionAmount));
  otwAddToCurrency(amounts, containerCcy, otwNum((c as any).otherCharges));
  otwAddToCurrency(amounts, containerCcy, otwNum((c as any).additionalChargesSum));
  otwAddToCurrency(amounts, containerCcy, otwNum((c as any).preRegisteredChargesSum));
  return amounts;
}

function otwMergeCurrencyMaps(target: Record<string, number>, source: Record<string, number>) {
  for (const [ccy, amt] of Object.entries(source)) {
    target[ccy] = (target[ccy] || 0) + amt;
  }
}

function OtwCurrencyInline({ amounts }: { amounts: Record<string, number> }) {
  const entries = Object.entries(amounts).filter(([, v]) => v > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {entries.map(([ccy, amt]) => (
        <span key={ccy} className="font-mono text-base font-semibold whitespace-nowrap">
          {otwFmtCcy(otwCcySymbol(ccy), amt)}
        </span>
      ))}
    </div>
  );
}

function OtwNotes() {
  const [value, setValue] = useState(() => localStorage.getItem(OTW_NOTES_KEY) ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(OTW_NOTES_KEY, e.target.value);
    }, 600);
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2 mb-2">
          <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Notes</span>
        </div>
        <Textarea
          value={value}
          onChange={handleChange}
          placeholder="Write anything here…"
          className="min-h-[80px] resize-y text-sm border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          data-testid="textarea-otw-notes"
        />
      </CardContent>
    </Card>
  );
}

const OTW_STATUS_LABEL: Record<string, string> = {
  PENDING:    "Pending",
  IN_TRANSIT: "In Transit",
  ARRIVED:    "Arrived",
};

const CONTAINER_STATUS_LABELS: Record<string, string> = {
  PENDING:            "Pending",
  IN_TRANSIT:         "In Transit",
  ARRIVED:            "Arrived",
  OFFLOADED:          "Offloaded",
  PARTIALLY_RECEIVED: "Partially Offloaded",
  RECEIVED:           "Received",
  AVAILABLE:          "Available",
  CLOSED:             "Closed",
  COMPLETED:          "Completed",
};

function getContainerStatusLabel(status: string): string {
  return CONTAINER_STATUS_LABELS[status] ?? status;
}

function ContainerStatusBadge({ status }: { status: string }) {
  const label = getContainerStatusLabel(status);
  if (status === "OFFLOADED") {
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{label}</Badge>;
  }
  if (status === "PARTIALLY_RECEIVED") {
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{label}</Badge>;
  }
  if (status === "IN_TRANSIT") {
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{label}</Badge>;
  }
  if (status === "ARRIVED") {
    return <Badge className="text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20">{label}</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">{label}</Badge>;
}

// ── OTW Tracking Panel ────────────────────────────────────────────────────────

function trackingStatusBadge(status: string | null | undefined) {
  if (!status) return <Badge variant="secondary" className="text-xs">No data</Badge>;
  const s = status.toLowerCase();
  if (s.includes("transit") || s.includes("depart") || s.includes("vessel") || s.includes("at sea")) {
    return <Badge className="text-xs bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20">{status}</Badge>;
  }
  if (s.includes("discharg") || s.includes("arrival") || s.includes("arrived") || s.includes("port")) {
    return <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20">{status}</Badge>;
  }
  if (s.includes("deliver") || s.includes("final") || s.includes("complete")) {
    return <Badge className="text-xs bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20">{status}</Badge>;
  }
  return <Badge variant="outline" className="text-xs">{status}</Badge>;
}

// ── Tracking progress step ────────────────────────────────────────────────────
interface ProgressStep {
  provider: string;
  status: "running" | "success" | "fail" | "skip" | "blocked";
  detail?: string;
  ts: number;
}

function ProgressStepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  if (status === "success") return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skip") return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ── Event timeline sheet ──────────────────────────────────────────────────────
interface TrackingEvent {
  id: number;
  eventTime: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  provider: string | null;
}

function EventTimelineSheet({
  containerId,
  containerNumber,
  open,
  onClose,
}: {
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
      return res as TrackingEvent[];
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
                <p className="text-xs">Click "Track Now" to fetch live data from the carrier.</p>
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
                            <MapPin className="h-3 w-3 shrink-0" />
                            {ev.location}
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

// ── Settings sheet ────────────────────────────────────────────────────────────
function TrackingSettingsSheet({
  container,
  open,
  onClose,
}: {
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
            {container && (
              <span className="font-mono text-muted-foreground font-normal text-sm">{container.containerNumber}</span>
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 px-6 py-5 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Enable Tracking</p>
              <p className="text-xs text-muted-foreground mt-0.5">Allow this container to be tracked via carrier APIs</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-tracking-enabled"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto Update</p>
              <p className="text-xs text-muted-foreground mt-0.5">Let the scheduler check this container automatically</p>
            </div>
            <Switch
              checked={autoUpdate}
              onCheckedChange={setAutoUpdate}
              disabled={!enabled}
              data-testid="switch-auto-update"
            />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="carrier-hint" className="text-sm font-medium">Carrier Hint</Label>
            <p className="text-xs text-muted-foreground">Optional — helps the system find the right carrier faster (e.g. MAERSK, CMA)</p>
            <Input
              id="carrier-hint"
              value={carrierHint}
              onChange={(e) => setCarrierHint(e.target.value.toUpperCase())}
              placeholder="e.g. MAERSK"
              disabled={!enabled}
              data-testid="input-carrier-hint"
            />
          </div>
        </div>
        <div className="px-6 pb-6 shrink-0">
          <Button
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-tracking-settings"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Progress log panel ────────────────────────────────────────────────────────
function TrackNowProgressLog({ containerId }: { containerId: number }) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await factoryApiRequest("GET", `/api/factory/container-tracking/${containerId}/progress`);
          const data = res as ProgressStep[];
          if (!cancelled) setSteps(data ?? []);
        } catch {
          // ignore polling errors
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [containerId]);

  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Starting…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 max-w-xs">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <ProgressStepIcon status={s.status} />
          <span className="text-muted-foreground">{s.provider}</span>
          {s.detail && <span className="text-muted-foreground/60 truncate max-w-[120px]">{s.detail}</span>}
        </div>
      ))}
    </div>
  );
}

interface OtwTrackingPanelProps {
  containers: ContainerWithSupplier[];
  suppliers?: FactorySupplier[];
  isLoading: boolean;
  trackingNowId: number | null;
  setTrackingNowId: (id: number | null) => void;
}

const OTW_FILTER_LABELS: Record<string, string> = {
  all:               "All",
  PENDING:           "Pending",
  IN_TRANSIT:        "In Transit",
  ARRIVED:           "Arrived",
  PARTIALLY_RECEIVED:"Partially Offloaded",
};

function OtwTrackingPanel({ containers, isLoading, trackingNowId, setTrackingNowId }: OtwTrackingPanelProps) {
  const { toast } = useToast();
  const tqClient = useTQClient();
  const [timelineId, setTimelineId] = useState<number | null>(null);
  const [settingsContainer, setSettingsContainer] = useState<ContainerWithSupplier | null>(null);
  const [otwStatusFilter, setOtwStatusFilter] = useState<string>("PENDING");

  const filteredPanelContainers = otwStatusFilter === "all"
    ? containers
    : containers.filter((c) => c.status === otwStatusFilter);

  const today = new Date().toDateString();
  const checkedToday = containers.filter((c) => {
    const fc = c as any;
    return fc.trackingLastCheckedAt && new Date(fc.trackingLastCheckedAt).toDateString() === today;
  }).length;
  const withErrors = containers.filter((c) => !!(c as any).trackingError).length;
  const timelineContainer = containers.find((c) => c.id === timelineId) ?? null;

  const trackNowMutation = useMutation({
    mutationFn: async (containerId: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/container-tracking/${containerId}/track-now`, {});
      return res as any;
    },
    onMutate: (id) => { setTrackingNowId(id); },
    onSuccess: (data, _containerId) => {
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
      toast({
        title: "Tracking failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

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

  if (containers.length === 0) {
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
    <div className="space-y-4">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">OTW Containers</p>
            <p className="text-2xl font-bold tabular-nums">{containers.length}</p>
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

      {/* ── Main table ── */}
      <Card>
        <CardHeader className="flex flex-col gap-2 pb-3">
          <div className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">OTW Container Tracking</CardTitle>
            <span className="text-sm text-muted-foreground">
              {filteredPanelContainers.length} of {containers.length} container{containers.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {Object.entries(OTW_FILTER_LABELS).map(([key, label]) => {
              const count = key === "all" ? containers.length : containers.filter(c => c.status === key).length;
              if (count === 0 && key !== "all") return null;
              return (
                <Button
                  key={key}
                  variant={otwStatusFilter === key ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOtwStatusFilter(key)}
                  data-testid={`button-otw-filter-${key}`}
                >
                  {label} {count > 0 && <span className="ml-1 text-xs opacity-70">({count})</span>}
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Container</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tracking Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>ETA</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPanelContainers.map((c) => {
                  const fc = c as any;
                  const lastChecked: Date | null = fc.trackingLastCheckedAt ? new Date(fc.trackingLastCheckedAt) : null;
                  const isTracking = trackingNowId === c.id;
                  const hasError = !!fc.trackingError;
                  const isEnabled = fc.trackingEnabled !== false;
                  const isValidNum = /^[A-Z]{4}\d{7}$/.test((c.containerNumber || "").trim().toUpperCase());

                  return (
                    <TableRow
                      key={c.id}
                      data-testid={`row-tracking-container-${c.id}`}
                      className="cursor-pointer"
                      onClick={() => setTimelineId(c.id)}
                    >
                      <TableCell className="pl-4 font-mono text-sm font-medium">
                        <div className="flex flex-col gap-0.5">
                          <span>{c.containerNumber}</span>
                          {!isValidNum && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Invalid format
                            </span>
                          )}
                          {fc.trackingDetectedCarrier && (
                            <span className="text-xs text-muted-foreground">{fc.trackingDetectedCarrier}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(c as any).supplierName ?? <span className="text-muted-foreground/50">—</span>}
                      </TableCell>
                      <TableCell>
                        <ContainerStatusBadge status={c.status ?? "PENDING"} />
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {isTracking ? (
                          <TrackNowProgressLog containerId={c.id} />
                        ) : hasError ? (
                          <div className="flex flex-col gap-0.5">
                            {trackingStatusBadge(fc.trackingLastStatus)}
                            <span className="text-xs text-destructive flex items-center gap-1">
                              <XCircle className="h-3 w-3" />
                              {fc.trackingError?.slice(0, 60)}{fc.trackingError?.length > 60 ? "…" : ""}
                            </span>
                          </div>
                        ) : (
                          trackingStatusBadge(fc.trackingLastStatus)
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                        {fc.trackingLastLocation ?? <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.arrivalDate ? (
                          <span className={`font-mono ${new Date(c.arrivalDate) < new Date() ? "text-amber-600 dark:text-amber-400" : ""}`}>
                            {c.arrivalDate}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {lastChecked ? (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {lastChecked.toLocaleDateString()} {lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setSettingsContainer(c)}
                                data-testid={`button-tracking-settings-${c.id}`}
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
                                data-testid={`button-track-now-${c.id}`}
                              >
                                {isTracking ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {!isEnabled ? "Tracking disabled" : !isValidNum ? "Invalid container number format" : "Track Now"}
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
        </CardContent>
      </Card>

      {/* ── Event timeline sheet ── */}
      <EventTimelineSheet
        containerId={timelineId}
        containerNumber={timelineContainer?.containerNumber ?? ""}
        open={!!timelineId}
        onClose={() => setTimelineId(null)}
      />

      {/* ── Settings sheet ── */}
      <TrackingSettingsSheet
        container={settingsContainer}
        open={!!settingsContainer}
        onClose={() => setSettingsContainer(null)}
      />
    </div>
  );
}

export default function FactoryContainers() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const [viewMode, setViewMode] = useState<"list" | "summary" | "tracking">("tracking");
  const [trackingNowId, setTrackingNowId] = useState<number | null>(null);
  const [openOtwGroups, setOpenOtwGroups] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editingContainer, setEditingContainer] = useState<ContainerWithSupplier | null>(null);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set(["__all__"]));
  const [viewContainer, setViewContainer] = useState<ContainerWithSupplier | null>(null);
  const [formData, setFormData] = useState({
    containerNumber: "",
    supplierId: "",
    origin: "",
    totalKg: "",
    ratePerKg: "",
    arrivalDate: "",
    notes: "",
    status: "PENDING",
    commissionAmount: "",
    commissionCurrencyCode: "USD",
    commissionAccountId: "",
    commissionSupplierId: "",
    commissionNotes: "",
    freight: "",
    freightCurrencyCode: "USD",
    freightAccountId: "",
    freightPaidBy: "supplier" as "supplier" | "own",
    freightOwnAccountId: "",
    otherCharges: "",
    otherChargesAccountId: "",
  });
  const [currency, setCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("1");
  const [fxRateSource, setFxRateSource] = useState<"auto" | "manual">("auto");
  const [fxEffectiveDate, setFxEffectiveDate] = useState("");

  type OtherChargeLine = { amount: string; currencyCode: string; ledgerAccountId: string };
  const [otherChargeLines, setOtherChargeLines] = useState<OtherChargeLine[]>([]);

  const updateOtherChargeLine = (idx: number, field: keyof OtherChargeLine, value: string) => {
    setOtherChargeLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };
  const removeOtherChargeLine = (idx: number) => {
    setOtherChargeLines(prev => prev.filter((_, i) => i !== idx));
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    if (currency === "USD") {
      setFxRate("1");
      setFxEffectiveDate("");
      return;
    }
    fetch(`/api/factory/fx-rates/latest/${currency}`)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("No rate found");
      })
      .then((data) => {
        if (data?.rate) {
          setFxRate(String(data.rate));
          setFxEffectiveDate(data.effectiveDate || "");
        }
      })
      .catch(() => {});
  }, [currency]);

  // Sync commission currency with container currency in create mode
  useEffect(() => {
    if (!editingContainer) {
      setFormData(f => ({ ...f, commissionCurrencyCode: currency }));
    }
  }, [currency, editingContainer]);

  const { data: containers, isLoading } = useQuery<ContainerWithSupplier[]>({
    queryKey: ["/api/factory/containers"],
  });

  const { data: suppliers } = useQuery<FactorySupplier[]>({
    queryKey: ["/api/factory/suppliers"],
  });

  // ── OTW Summary computed values ──────────────────────────────────────────
  const otwContainers = useMemo(
    () => (containers || []).filter((c) => STATUS_ACTIVE.has(c.status)),
    [containers],
  );

  const otwSupplierGroups = useMemo(() => {
    const map = new Map<string, { supplierId: number | null; supplierName: string; containers: ContainerWithSupplier[]; totalKg: number; totalsByCurrency: Record<string, number> }>();
    for (const c of otwContainers) {
      const key = String((c as any).supplierId ?? "none");
      if (!map.has(key)) {
        map.set(key, {
          supplierId: (c as any).supplierId ?? null,
          supplierName: c.supplierName || "No Supplier",
          containers: [],
          totalKg: 0,
          totalsByCurrency: {},
        });
      }
      const group = map.get(key)!;
      group.containers.push(c);
      group.totalKg += otwNum(c.totalKg);
      otwMergeCurrencyMaps(group.totalsByCurrency, otwContainerByCurrency(c));
    }
    return Array.from(map.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [otwContainers]);

  const otwGrandTotals = useMemo(() => {
    const totalsByCurrency: Record<string, number> = {};
    let count = 0;
    let kg = 0;
    for (const g of otwSupplierGroups) {
      count += g.containers.length;
      kg += g.totalKg;
      otwMergeCurrencyMaps(totalsByCurrency, g.totalsByCurrency);
    }
    return { containers: count, kg, totalsByCurrency };
  }, [otwSupplierGroups]);

  const fmtOtwKg = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  function toggleOtwGroup(key: string) {
    setOpenOtwGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Auto-fill broker (commissionSupplierId) when supplier changes
  useEffect(() => {
    if (!formData.supplierId) {
      setFormData(f => ({ ...f, commissionSupplierId: "" }));
      return;
    }
    const sup = suppliers?.find(s => s.id === parseInt(formData.supplierId));
    if (sup?.parentId) {
      setFormData(f => ({ ...f, commissionSupplierId: String(sup.parentId) }));
    } else if (!formData.commissionSupplierId) {
      setFormData(f => ({ ...f, commissionSupplierId: "" }));
    }
  }, [formData.supplierId, suppliers]);

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
  });

  const { data: viewContainerCharges = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/containers", viewContainer?.id, "other-charges"],
    queryFn: async () => {
      if (!viewContainer) return [];
      const res = await factoryApiRequest("GET", `/api/factory/containers/${viewContainer.id}/other-charges`);
      return res.ok ? res.json() : [];
    },
    enabled: !!viewContainer,
  });

  useEffect(() => {
    if (!editingContainer) {
      setOtherChargeLines([]);
      return;
    }
    const containerCcy = (editingContainer as any).currencyCode || "USD";
    factoryApiRequest("GET", `/api/factory/containers/${editingContainer.id}/other-charges`)
      .then(res => res.ok ? res.json() : [])
      .then((charges: any[]) => {
        setOtherChargeLines(charges.map((c: any) => ({
          amount: c.amount || "",
          currencyCode: c.currencyCode || containerCcy,
          ledgerAccountId: c.ledgerAccountId ? String(c.ledgerAccountId) : "",
        })));
      })
      .catch(() => setOtherChargeLines([]));
  }, [editingContainer?.id]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        ...data,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
        currencyCode: currency,
        fxRateToUsd: fxRateSource === "manual" ? fxRate : undefined,
        fxRateSource,
        commissionAmount: data.commissionAmount || "0",
        commissionCurrencyCode: data.commissionCurrencyCode || currency,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : null,
        commissionSupplierId: data.commissionSupplierId ? parseInt(data.commissionSupplierId) : null,
        commissionNotes: data.commissionNotes || null,
        freight: data.freight || "0",
        freightCurrencyCode: data.freightCurrencyCode || "USD",
        freightAccountId: data.freightAccountId ? parseInt(data.freightAccountId) : null,
        otherCharges: "0",
        otherChargesAccountId: null,
      };
      const res = await factoryApiRequest("POST", "/api/factory/containers", payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create container");
      }
      const container = await res.json();
      await factoryApiRequest("POST", `/api/factory/containers/${container.id}/other-charges/sync`, {
        charges: otherChargeLines
          .filter(l => parseFloat(l.amount || "0") > 0)
          .map(l => ({
            description: "Other Charge",
            amount: l.amount,
            currencyCode: l.currencyCode || currency,
            ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
          })),
      });
      return container;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      const hasCommission = parseFloat(vars.commissionAmount || "0") > 0;
      toast({
        title: "Container saved",
        description: hasCommission ? "Broker commission added." : "Container created successfully.",
      });
      resetForm();
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const payload = {
        ...data,
        supplierId: data.supplierId ? parseInt(data.supplierId) : null,
        currencyCode: currency,
        fxRateToUsd: fxRateSource === "manual" ? fxRate : undefined,
        fxRateSource,
        commissionAmount: data.commissionAmount || "0",
        commissionCurrencyCode: data.commissionCurrencyCode || currency,
        commissionAccountId: data.commissionAccountId ? parseInt(data.commissionAccountId) : null,
        commissionSupplierId: data.commissionSupplierId ? parseInt(data.commissionSupplierId) : null,
        commissionNotes: data.commissionNotes || null,
        freight: data.freight || "0",
        freightCurrencyCode: data.freightCurrencyCode || "USD",
        freightAccountId: data.freightAccountId ? parseInt(data.freightAccountId) : null,
        // Preserve offload-set values — do NOT hardcode 0/null here
        otherCharges: data.otherCharges || "0",
        otherChargesAccountId: data.otherChargesAccountId ? parseInt(data.otherChargesAccountId) : null,
      };
      const validCharges = otherChargeLines
        .filter(l => parseFloat(l.amount || "0") > 0)
        .map(l => ({
          description: "Other Charge",
          amount: l.amount,
          currencyCode: l.currencyCode || currency,
          ledgerAccountId: l.ledgerAccountId ? parseInt(l.ledgerAccountId) : null,
        }));
      let container: any;
      try {
        const res = await factoryApiRequest("PATCH", `/api/factory/containers/${id}`, payload);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message || "Failed to update container");
        }
        container = await res.json();
      } catch (err: any) {
        if (err?.name === "OfflineQueued" && validCharges.length > 0) {
          enqueueRequest(
            `/api/factory/containers/${id}/other-charges/sync`,
            "POST",
            JSON.stringify({ charges: validCharges }),
            "Container Charges"
          );
        }
        throw err;
      }
      await factoryApiRequest("POST", `/api/factory/containers/${id}/other-charges/sync`, {
        charges: validCharges,
      });
      return container;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers/with-balances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      const hasCommission = parseFloat(vars.data.commissionAmount || "0") > 0;
      toast({
        title: "Container saved",
        description: hasCommission ? "Commission linked." : "Container updated.",
      });
      resetForm();
      setEditingContainer(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/containers/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete container");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({ title: "Deleted", description: "Container removed" });
      setPendingDeleteId(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reverseOffloadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/containers/${id}/reverse-offload`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to reverse offload");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setReversingContainer(null);
      toast({ title: "Offload Reversed", description: "Container is back to its previous status. Raw stock, accounting vouchers, and daybook entries have all been removed." });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", `/api/factory/containers/backfill-import-credits`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Backfill failed");
      }
      return res.json() as Promise<{ created: number; skipped: number; total: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      toast({
        title: "Backfill complete",
        description: `${data.created} supplier credit entries created, ${data.skipped} already had entries.`,
      });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Backfill failed", description: err.message, variant: "destructive" });
    },
  });

  const postOffloadMutation = useMutation({
    mutationFn: async ({ containerId, charges, txDate }: { containerId: number; charges: any[]; txDate: string }) => {
      const res = await factoryApiRequest("POST", `/api/factory/containers/${containerId}/post-offload-charges`, { charges, txDate });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to save charges");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock/by-container"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/mix-batches"] });
      setPostOffloadResult(data);
      setPostOffloadCharges([]);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<{ imported: number; errors: string[]; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reversingContainer, setReversingContainer] = useState<ContainerWithSupplier | null>(null);
  const [postOffloadContainer, setPostOffloadContainer] = useState<ContainerWithSupplier | null>(null);
  const [postOffloadCharges, setPostOffloadCharges] = useState<{ id: string; description: string; amount: string; currencyCode: string; ledgerAccountId: string; supplierId: string }[]>([]);
  const [postOffloadDate, setPostOffloadDate] = useState<string>("");
  const [postOffloadResult, setPostOffloadResult] = useState<{ affectedBatches: { batchId: number; batchCode: string; oldCostPerKg: number; newCostPerKg: number; weightKg: number }[] } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const importMutation = useMutation({
    mutationFn: async (rows: any[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/containers/import-excel", { rows });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      setImportResult(data);
      toast({
        title: "Import Complete",
        description: `${data.imported} of ${data.total} containers imported${data.errors.length > 0 ? ` (${data.errors.length} errors)` : ""}`,
      });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const XLSX = await import("@/lib/excelHelper");
    const data = await file.arrayBuffer();
    const wb = await XLSX.read(data, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonRows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const mapped = jsonRows.map((row: any) => {
      const get = (keys: string[]) => {
        for (const k of keys) {
          const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
          if (val !== undefined && val !== "") return String(val).trim();
        }
        return "";
      };
      return {
        containerNumber: get(["Container Number", "Container #", "ContainerNumber", "container_number", "Container"]),
        supplierName: get(["Supplier", "Supplier Name", "SupplierName", "supplier_name"]),
        origin: get(["Origin", "Country", "origin"]),
        totalKg: get(["Total Kg", "TotalKg", "Weight", "total_kg", "KG", "Kg"]),
        ratePerKg: get(["Rate/Kg", "Rate Per Kg", "RatePerKg", "rate_per_kg", "Rate", "Price"]),
        currencyCode: get(["Currency", "CurrencyCode", "currency_code"]) || "USD",
        fxRateToUsd: get(["FX Rate", "FxRate", "fx_rate_to_usd", "Exchange Rate"]) || "",
        fxSource: get(["FX Source", "FxSource", "fx_source"]) || "",
        arrivalDate: get(["Arrival Date", "ArrivalDate", "arrival_date", "Date"]),
        notes: get(["Notes", "notes", "Remarks"]),
        status: get(["Status", "status"]) || "PENDING",
        commissionAmount: get(["Commission Amount", "CommissionAmount", "commission_amount", "Commission"]) || "",
        commissionCurrencyCode: get(["Commission Currency", "CommissionCurrency", "commission_currency_code", "Comm Currency"]) || "USD",
      };
    }).filter((r: any) => r.containerNumber);

    setImportPreview(mapped);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await factoryApiRequest("POST", "/api/factory/containers/bulk-delete", { ids });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Bulk delete failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/containers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/raw-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast({ title: "Deleted", description: `${data.deleted} container${data.deleted !== 1 ? "s" : ""} and all linked data removed successfully.` });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    },
  });

  const exportContainers = async (rows: ContainerWithSupplier[]) => {
    const XLSX = await import("@/lib/excelHelper");
    const headers = [
      "Container Number", "Supplier", "Broker / Commission To", "Origin",
      "Total Kg", "Rate/Kg", "Currency", "FX Rate", "FX Source", "Arrival Date", "Status", "Notes",
      "Commission Amount", "Commission Currency", "Commission Notes",
      "Freight Amount", "Freight Currency",
      "Other Charges (legacy)",
    ];
    const dataRows = rows.map((c: any) => {
      const brokerSupId = c.commissionSupplierId;
      const brokerName = brokerSupId ? (suppliers?.find((s: any) => s.id === brokerSupId)?.name ?? "") : "";
      return [
        c.containerNumber,
        c.supplierName || "",
        brokerName,
        c.origin || "",
        c.totalKg || "",
        c.ratePerKg || "",
        c.currencyCode || "USD",
        c.fxRateToUsd || "1",
        c.fxRateSource || "auto",
        c.arrivalDate || "",
        c.status,
        c.notes || "",
        c.commissionAmount || "",
        c.commissionCurrencyCode || "USD",
        c.commissionNotes || "",
        c.freight || "",
        c.freightCurrencyCode || "USD",
        c.otherCharges || "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    // Column widths
    ws["!cols"] = [20,20,20,12,10,10,8,8,8,12,12,30,12,10,30,12,10,12].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Containers");
    await XLSX.writeFile(wb, `factory_containers_export_${new Date().toLocaleDateString('en-CA')}.xlsx`);
  };

  const downloadTemplate = async () => {
    const XLSX = await import("@/lib/excelHelper");

    // Sheet 1: Template with sample data
    const headers = [
      "Container Number", "Supplier", "Origin", "Total Kg", "Rate/Kg",
      "Currency", "FX Rate", "FX Source", "Arrival Date", "Status", "Notes",
      "Commission Amount", "Commission Currency",
    ];
    const sample1 = ["CNTR-2024-001", "ABC Trading Co", "Australia", 20000, 0.50, "AUD", "", "AUTO", "2024-06-01", "PENDING", "First container", 1000, "USD"];
    const sample2 = ["CNTR-2024-002", "XYZ Suppliers", "China", 15000, 1.20, "USD", "1", "MANUAL", "2024-06-15", "IN_TRANSIT", "Second container - manual FX", "", "USD"];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample1, sample2]);
    ws["!cols"] = [18,18,12,10,10,8,8,8,12,12,25,14,14].map(w => ({ wch: w }));

    // Sheet 2: Instructions
    const instructions = [
      ["FACTORY CONTAINERS IMPORT — INSTRUCTIONS"],
      [""],
      ["HOW TO USE THIS TEMPLATE"],
      ["1. Fill in the 'Containers' sheet with your data. Do NOT change column headers."],
      ["2. Each row = one container. Container Number is required; all other fields are optional."],
      ["3. Save as .xlsx and upload via the Import Excel button in Factory Containers."],
      ["4. When re-importing, status is forced to PENDING regardless of what you enter."],
      [""],
      ["COLUMN GUIDE"],
      ["Column", "Required", "Example", "Notes"],
      ["Container Number", "YES", "CNTR-2024-001", "Must be unique"],
      ["Supplier", "No", "ABC Trading Co", "Exact name match or new supplier created automatically"],
      ["Origin", "No", "Australia", "Country or city of origin"],
      ["Total Kg", "No", "20000", "Total weight in kg"],
      ["Rate/Kg", "No", "0.50", "Price per kg in the chosen currency"],
      ["Currency", "No", "AUD", "USD / EUR / AUD / LBP / GBP (default: USD)"],
      ["FX Rate", "No", "1.55", "Leave blank for auto (fetched from FX API)"],
      ["FX Source", "No", "AUTO", "AUTO or MANUAL (default: AUTO)"],
      ["Arrival Date", "No", "2024-06-01", "YYYY-MM-DD format"],
      ["Status", "No", "PENDING", "PENDING / IN_TRANSIT / AVAILABLE / OFFLOADED"],
      ["Notes", "No", "Any text", "Free-form notes"],
      ["Commission Amount", "No", "1000", "Commission charged to broker, in commission currency"],
      ["Commission Currency", "No", "USD", "Currency of the commission amount (default: USD)"],
      [""],
      ["TIPS FOR RE-IMPORTING AFTER BULK DELETE"],
      ["• Export your containers first using the 'Export All' button — this gives you the exact data."],
      ["• Delete the containers using 'Select All → Delete Selected' — this removes ALL linked data."],
      ["• Then import the exported file. Containers come back as PENDING with all financial details intact."],
      ["• After importing, re-do offloads manually for containers that had been processed."],
      [""],
      ["VALID CURRENCIES: USD, EUR, AUD, LBP, GBP, XOF, XAF, CFA"],
      ["VALID STATUSES: PENDING, IN_TRANSIT, AVAILABLE, OFFLOADED"],
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instructions);
    wsInstr["!cols"] = [40, 12, 20, 50].map(w => ({ wch: w }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Containers");
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");
    await XLSX.writeFile(wb, "factory_containers_template.xlsx");
  };

  const resetForm = () => {
    setFormData({
      containerNumber: "",
      supplierId: "",
      origin: "",
      totalKg: "",
      ratePerKg: "",
      arrivalDate: "",
      notes: "",
      status: "PENDING",
      commissionAmount: "",
      commissionCurrencyCode: "USD",
      commissionAccountId: "",
      commissionSupplierId: "",
      commissionNotes: "",
      freight: "",
      freightCurrencyCode: "USD",
      freightAccountId: "",
      freightPaidBy: "supplier" as "supplier" | "own",
      freightOwnAccountId: "",
      otherCharges: "",
      otherChargesAccountId: "",
    });
    setOtherChargeLines([]);
    setCurrency("USD");
    setFxRate("1");
    setFxRateSource("auto");
    setFxEffectiveDate("");
  };

  const openEdit = (c: ContainerWithSupplier) => {
    setEditingContainer(c);
    setFormData({
      containerNumber: c.containerNumber,
      supplierId: c.supplierId?.toString() || "",
      origin: c.origin || "",
      totalKg: c.totalKg || "",
      ratePerKg: c.ratePerKg || "",
      arrivalDate: c.arrivalDate || "",
      notes: c.notes || "",
      status: c.status,
      commissionAmount: (c as any).commissionAmount || "",
      commissionCurrencyCode: (c as any).commissionCurrencyCode || "USD",
      commissionAccountId: (c as any).commissionAccountId ? String((c as any).commissionAccountId) : "",
      commissionSupplierId: (c as any).commissionSupplierId ? String((c as any).commissionSupplierId) : "",
      commissionNotes: (c as any).commissionNotes || "",
      freight: (c as any).freight || "",
      freightCurrencyCode: (c as any).freightCurrencyCode || "USD",
      freightAccountId: (c as any).freightAccountId ? String((c as any).freightAccountId) : "",
      freightPaidBy: ((c as any).freightPaidBy as "supplier" | "own") || "supplier",
      freightOwnAccountId: (c as any).freightOwnAccountId ? String((c as any).freightOwnAccountId) : "",
      otherCharges: (c as any).otherCharges || "",
      otherChargesAccountId: (c as any).otherChargesAccountId ? String((c as any).otherChargesAccountId) : "",
    });
    setCurrency((c as any).currencyCode || "USD");
    setFxRate((c as any).fxRateToUsd || "1");
    setFxRateSource((c as any).fxRateSource || "auto");
    setFxEffectiveDate((c as any).fxRateDateImport || "");
  };

  const handleSubmit = () => {
    if (editingContainer) {
      wrapAdminAction(
        () => updateMutation.mutate({ id: editingContainer.id, data: formData }),
        "Update Container",
      );
    } else {
      createMutation.mutate(formData);
    }
  };

  const activeSuppliers = suppliers?.filter((s) => s.isActive) ?? [];

  // Suppliers filtered by selected broker
  const brokerIdNum = formData.commissionSupplierId ? parseInt(formData.commissionSupplierId) : null;
  const filteredSupplierList = brokerIdNum
    ? activeSuppliers.filter(s => s.parentId === brokerIdNum || !s.parentId)
    : activeSuppliers;

  // Selected supplier for mismatch detection
  const selectedSupplier = formData.supplierId
    ? activeSuppliers.find(s => s.id === parseInt(formData.supplierId)) ?? null
    : null;

  const brokerMismatch =
    selectedSupplier?.parentId &&
    formData.commissionSupplierId &&
    selectedSupplier.parentId !== parseInt(formData.commissionSupplierId);

  const filteredContainers = containers?.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchesNumber = c.containerNumber?.toLowerCase().includes(q);
      const matchesSupplier = c.supplierName?.toLowerCase().includes(q);
      const matchesOrigin = c.origin?.toLowerCase().includes(q);
      if (!matchesNumber && !matchesSupplier && !matchesOrigin) return false;
    }
    return true;
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader title="Factory Containers" subtitle="Track incoming containers (separate from ERP containers)" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
              data-testid="button-delete-selected"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected ({selectedIds.size})
            </Button>
          )}
          {currentUser?.role === "Developer" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" data-testid="button-import-export-menu">
                  <ArrowDown className="h-4 w-4 mr-2" />
                  Import / Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportContainers(containers || [])} data-testid="button-export-containers">
                  <Download className="h-4 w-4 mr-2" />
                  Export All
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => { setImportOpen(true); setImportPreview([]); setImportResult(null); }}
                  data-testid="button-import-containers"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="flex rounded-md border overflow-hidden">
            <Button
              variant={viewMode === "summary" ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => setViewMode("summary")}
              data-testid="button-view-summary"
            >
              <Ship className="h-4 w-4 mr-2" />
              OTW Summary
            </Button>
            <Button
              variant={viewMode === "tracking" ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => setViewMode("tracking")}
              data-testid="button-view-tracking"
            >
              <Radio className="h-4 w-4 mr-2" />
              OTW Tracking
            </Button>
          </div>
          <Button
            onClick={() => navigate("/factory/containers/new")}
            data-testid="button-add-factory-container"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Container
          </Button>
        </div>
      </div>

      {viewMode === "summary" ? (
        <div className="space-y-4">
          <OtwNotes />

          {otwContainers.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Ship className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-muted-foreground">No containers currently on the way.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                {otwSupplierGroups.map((group, idx) => {
                  const key = String(group.supplierId ?? "none");
                  const isOpen = openOtwGroups.has(key);
                  const isLast = idx === otwSupplierGroups.length - 1;
                  return (
                    <Collapsible key={key} open={isOpen} onOpenChange={() => toggleOtwGroup(key)}>
                      <CollapsibleTrigger asChild>
                        <div
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate transition-colors
                            ${!isLast ? "border-b" : ""}
                            ${isOpen ? "bg-muted/30" : ""}`}
                          data-testid={`row-otw-supplier-${key}`}
                        >
                          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-base flex-1 min-w-0 truncate">
                            {group.supplierName}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            {group.containers.length} ctr{group.containers.length !== 1 ? "s" : ""}
                          </Badge>
                          <span className="font-mono text-sm text-muted-foreground shrink-0 hidden sm:block w-32 text-right">
                            {fmtOtwKg(group.totalKg)} kg
                          </span>
                          <div className="shrink-0 min-w-[100px] text-right">
                            <OtwCurrencyInline amounts={group.totalsByCurrency} />
                          </div>
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                          />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className={`border-t bg-muted/10 ${!isLast ? "border-b" : ""}`}>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Container</TableHead>
                                <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Origin</TableHead>
                                <TableHead className="text-right text-xs uppercase tracking-wide font-medium text-muted-foreground">KG</TableHead>
                                <TableHead className="text-right text-xs uppercase tracking-wide font-medium text-muted-foreground">Value</TableHead>
                                <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {group.containers.map((c) => {
                                const byCurrency = otwContainerByCurrency(c);
                                return (
                                  <TableRow
                                    key={c.id}
                                    className="cursor-pointer hover-elevate"
                                    onClick={() => setViewContainer(c)}
                                    data-testid={`row-otw-container-${c.id}`}
                                  >
                                    <TableCell className="font-mono font-semibold">
                                      {c.containerNumber}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {c.origin || "—"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                      {fmtOtwKg(otwNum(c.totalKg))}
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <OtwCurrencyInline amounts={byCurrency} />
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline">
                                        {OTW_STATUS_LABEL[c.status] || c.status}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                            <tfoot>
                              <TableRow className="bg-muted/30 font-medium">
                                <TableCell colSpan={2} className="text-muted-foreground">
                                  Supplier total
                                </TableCell>
                                <TableCell className="text-right font-mono font-semibold">
                                  {fmtOtwKg(group.totalKg)} kg
                                </TableCell>
                                <TableCell className="text-right">
                                  <OtwCurrencyInline amounts={group.totalsByCurrency} />
                                </TableCell>
                                <TableCell />
                              </TableRow>
                            </tfoot>
                          </Table>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </Card>

              <div
                className="sticky bottom-0 z-50 rounded-md border bg-background shadow-md"
                data-testid="div-otw-grand-total"
              >
                <div className="flex flex-wrap items-center gap-6 p-4">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Containers</p>
                      <p className="text-lg font-bold font-mono" data-testid="text-otw-grand-containers">
                        {otwGrandTotals.containers}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Total KG</p>
                      <p className="text-lg font-bold font-mono" data-testid="text-otw-grand-kg">
                        {fmtOtwKg(otwGrandTotals.kg)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 flex-1">
                    <div className="w-full">
                      <p className="text-xs text-muted-foreground mb-1">Total Value by Currency</p>
                      <div className="flex flex-wrap gap-x-6 gap-y-1" data-testid="text-otw-grand-totals">
                        {Object.entries(otwGrandTotals.totalsByCurrency)
                          .filter(([, v]) => v > 0)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([ccy, amt]) => (
                            <div key={ccy} className="flex flex-col">
                              <span className="text-xs text-muted-foreground">{ccy}</span>
                              <span className="text-lg font-bold font-mono whitespace-nowrap">
                                {otwFmtCcy(otwCcySymbol(ccy), amt)}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Container className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-lg">
                Containers ({filteredContainers?.length || 0}{filteredContainers?.length !== containers?.length ? ` of ${containers?.length}` : ""})
              </CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative w-56">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search containers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-containers"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-filter-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                  <SelectItem value="AVAILABLE">Available</SelectItem>
                  <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredContainers && filteredContainers.length > 0 ? (() => {
            // Group containers by supplier name
            const groups: { supplierKey: string; supplierName: string; containers: typeof filteredContainers }[] = [];
            const seenKeys = new Map<string, number>();
            for (const c of filteredContainers) {
              const key = c.supplierName || "__none__";
              if (!seenKeys.has(key)) {
                seenKeys.set(key, groups.length);
                groups.push({ supplierKey: key, supplierName: c.supplierName || "No Supplier", containers: [] });
              }
              groups[seenKeys.get(key)!].containers.push(c);
            }
            const toggleSupplier = (key: string) => {
              setExpandedSuppliers(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            };
            // Helper: render charge breakdown for a container using actual currencies
            const renderCharges = (c: any) => {
              const ccy = c.currencyCode || "USD";
              const freightAmt = parseFloat(c.freight || "0");
              const freightCcy = c.freightCurrencyCode || ccy;
              const freightSameCcy = freightCcy === ccy;
              const legacyOtherAmt = parseFloat(c.otherCharges || "0");
              const additionalAmt = parseFloat(c.additionalChargesSum || "0");
              // Parse per-currency other charges (actual currencies, not converted)
              let chargesByCcy: { currencyCode: string; amount: number }[] = [];
              try {
                const raw = typeof c.preRegisteredChargesByCurrency === "string"
                  ? JSON.parse(c.preRegisteredChargesByCurrency)
                  : (c.preRegisteredChargesByCurrency || []);
                chargesByCcy = Array.isArray(raw)
                  ? raw.map((x: any) => ({ currencyCode: x.currencyCode || "USD", amount: parseFloat(x.amount || "0") }))
                  : [];
              } catch {}
              const hasCharges = freightAmt > 0 || legacyOtherAmt > 0 || chargesByCcy.some(x => x.amount > 0) || additionalAmt > 0;
              if (!hasCharges) return <span className="text-muted-foreground">—</span>;
              // Build display lines grouped by currency
              const ccyTotals = new Map<string, number>();
              if (freightSameCcy && freightAmt > 0) ccyTotals.set(freightCcy, (ccyTotals.get(freightCcy) || 0) + freightAmt);
              if (legacyOtherAmt > 0) ccyTotals.set(ccy, (ccyTotals.get(ccy) || 0) + legacyOtherAmt);
              for (const ch of chargesByCcy) {
                if (ch.amount > 0) ccyTotals.set(ch.currencyCode, (ccyTotals.get(ch.currencyCode) || 0) + ch.amount);
              }
              if (additionalAmt > 0) ccyTotals.set(ccy, (ccyTotals.get(ccy) || 0) + additionalAmt);
              return (
                <div className="space-y-0.5">
                  <div className="font-mono text-sm">
                    {Array.from(ccyTotals.entries()).map(([cc, amt]) => (
                      <div key={cc}>{cc} {formatNumber(amt)}</div>
                    ))}
                    {!freightSameCcy && freightAmt > 0 && (
                      <div>{freightCcy} {formatNumber(freightAmt)}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0">
                    {freightAmt > 0 && <div>Freight: {freightCcy} {formatNumber(freightAmt)}</div>}
                    {(legacyOtherAmt > 0 || chargesByCcy.some(x => x.amount > 0)) && (
                      <div>
                        Other:{" "}
                        {(() => {
                          const parts: string[] = [];
                          if (legacyOtherAmt > 0) parts.push(`${ccy} ${formatNumber(legacyOtherAmt)}`);
                          for (const ch of chargesByCcy) {
                            if (ch.amount > 0) parts.push(`${ch.currencyCode} ${formatNumber(ch.amount)}`);
                          }
                          return parts.join(" + ");
                        })()}
                      </div>
                    )}
                    {additionalAmt > 0 && <div>Additional: {ccy} {formatNumber(additionalAmt)}</div>}
                  </div>
                </div>
              );
            };
            return (
              <Table wrapperClassName="overflow-visible">
                <TableHeader className="sticky top-0 z-30 bg-background">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filteredContainers.length > 0 && filteredContainers.every(c => selectedIds.has(c.id))}
                        onCheckedChange={(checked) => {
                          if (checked) setSelectedIds(new Set(filteredContainers.map(c => c.id)));
                          else setSelectedIds(new Set());
                        }}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Container #</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Commission</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Total Value</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide font-medium text-muted-foreground">Status</TableHead>
                    <TableHead className="w-24 text-xs uppercase tracking-wide font-medium text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map(({ supplierKey, supplierName, containers: groupContainers }) => {
                    const isExpanded = expandedSuppliers.has(supplierKey);
                    // Compute aggregate count and container count
                    const count = groupContainers.length;
                    // Aggregate total values by currency
                    const groupTotals = new Map<string, number>();
                    for (const c of groupContainers) {
                      const ccy = (c as any).currencyCode || "USD";
                      const baseValue = parseFloat(c.totalKg || "0") * parseFloat(c.ratePerKg || "0");
                      const freightAmt = parseFloat((c as any).freight || "0");
                      const freightCcy = (c as any).freightCurrencyCode || ccy;
                      const freightSameCcy = freightCcy === ccy;
                      const legacyOtherAmt = parseFloat((c as any).otherCharges || "0");
                      const preRegisteredAmt = parseFloat((c as any).preRegisteredChargesSum || "0");
                      const additionalAmt = parseFloat((c as any).additionalChargesSum || "0");
                      const totalInCcy = baseValue + (freightSameCcy ? freightAmt : 0) + legacyOtherAmt + preRegisteredAmt + additionalAmt;
                      groupTotals.set(ccy, (groupTotals.get(ccy) || 0) + totalInCcy);
                    }
                    return [
                      // Supplier header row
                      <TableRow
                        key={`supplier-${supplierKey}`}
                        className="bg-muted/30 hover-elevate cursor-pointer"
                        onClick={() => toggleSupplier(supplierKey)}
                        data-testid={`row-supplier-group-${supplierKey}`}
                      >
                        <TableCell className="w-10">
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell colSpan={2}>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold">{supplierName}</span>
                            <Badge variant="outline">{count} container{count !== 1 ? "s" : ""}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {Array.from(groupTotals.entries()).map(([cc, amt]) => (
                            <div key={cc}>{cc} {formatNumber(amt)}</div>
                          ))}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>,
                      // Container rows (only when expanded)
                      ...(isExpanded ? groupContainers.map((c) => {
                        const commAmt = parseFloat((c as any).commissionAmount || "0");
                        const commCcy = (c as any).commissionCurrencyCode || "USD";
                        const brokerSupId = (c as any).commissionSupplierId;
                        const brokerName = brokerSupId
                          ? suppliers?.find(s => s.id === brokerSupId)?.name ?? null
                          : null;
                        const ccy = (c as any).currencyCode || "USD";
                        const baseValue = parseFloat(c.totalKg || "0") * parseFloat(c.ratePerKg || "0");
                        const freightAmt = parseFloat((c as any).freight || "0");
                        const freightCcy = (c as any).freightCurrencyCode || ccy;
                        const freightSameCcy = freightCcy === ccy;
                        const legacyOtherAmt = parseFloat((c as any).otherCharges || "0");
                        const preRegisteredAmt = parseFloat((c as any).preRegisteredChargesSum || "0");
                        const additionalAmt = parseFloat((c as any).additionalChargesSum || "0");
                        const totalValue = baseValue + (freightSameCcy ? freightAmt : 0) + legacyOtherAmt + preRegisteredAmt + additionalAmt;
                        return (
                          <TableRow key={c.id} data-testid={`row-factory-container-${c.id}`} className={selectedIds.has(c.id) ? "bg-muted/50" : ""}>
                            <TableCell className="w-10 pl-6">
                              <Checkbox
                                checked={selectedIds.has(c.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedIds(prev => {
                                    const next = new Set(prev);
                                    if (checked) next.add(c.id);
                                    else next.delete(c.id);
                                    return next;
                                  });
                                }}
                                data-testid={`checkbox-container-${c.id}`}
                              />
                            </TableCell>
                            <TableCell className="font-semibold font-mono">
                              <button
                                className="hover:underline text-left cursor-pointer text-foreground"
                                onClick={() => setViewContainer(c)}
                                data-testid={`button-view-container-${c.id}`}
                              >
                                {c.containerNumber}
                              </button>
                            </TableCell>
                            <TableCell className="font-mono">
                              {commAmt > 0 ? `${commCcy} ${formatNumber(commAmt)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="font-mono font-semibold">
                              {totalValue > 0 ? `${ccy} ${formatNumber(totalValue)}` : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <ContainerStatusBadge status={c.status} />
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {c.status !== "OFFLOADED" && c.status !== "PARTIALLY_RECEIVED" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={() => navigate("/factory/raw-stock")} data-testid={`button-offload-container-${c.id}`}>
                                        <ArrowDown className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Offload to Production</TooltipContent>
                                  </Tooltip>
                                )}
                                {(c.status === "OFFLOADED" || c.status === "PARTIALLY_RECEIVED") && (
                                  <>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" onClick={() => { setPostOffloadContainer(c); setPostOffloadCharges([]); setPostOffloadDate(new Date().toLocaleDateString("en-CA")); setPostOffloadResult(null); }} data-testid={`button-post-offload-charges-${c.id}`}>
                                          <PlusCircle className="h-4 w-4 text-blue-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Add Post-Offload Charges</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" onClick={() => setReversingContainer(c)} data-testid={`button-reverse-offload-${c.id}`}>
                                          <RotateCcw className="h-4 w-4 text-amber-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Reverse Offload</TooltipContent>
                                    </Tooltip>
                                  </>
                                )}
                                <Button variant="ghost" size="icon" onClick={() => openEdit(c)} data-testid={`button-edit-container-${c.id}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setPendingDeleteId(c.id)} data-testid={`button-delete-container-${c.id}`}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }) : []),
                    ];
                  })}
                </TableBody>
              </Table>
            );
          })() : (
            <div className="text-center py-8 text-muted-foreground">
              <Container className="h-12 w-12 mx-auto mb-3 opacity-50" />
              {containers && containers.length > 0 ? (
                <>
                  <p className="text-lg font-medium">No matching containers</p>
                  <p className="text-sm mt-1">Try adjusting your search or filter</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">No factory containers yet</p>
                  <p className="text-sm mt-1">Add your first container to start tracking arrivals</p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      )}

      {viewMode === "tracking" && (
        <FactoryOtwTrackingTab onEdit={openEdit} />
      )}

      <Dialog open={createOpen || !!editingContainer} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingContainer(null); resetForm(); }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingContainer ? "Edit Container" : "Add Factory Container"}</DialogTitle>
            <DialogDescription>
              {editingContainer ? "Update container details" : "Track a new incoming factory container"}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] overflow-y-auto space-y-6 pr-1">
            {/* ── Section 1: Basic ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Basic</p>
                <Separator className="flex-1" />
              </div>
              <div>
                <Label>Container Number *</Label>
                <Input
                  value={formData.containerNumber}
                  onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value })}
                  placeholder="e.g., CNTR-2024-001"
                  data-testid="input-container-number"
                />
              </div>
              <div>
                <Label>Origin</Label>
                <Input
                  value={formData.origin}
                  onChange={(e) => setFormData({ ...formData, origin: e.target.value })}
                  placeholder="Country/city of origin"
                  data-testid="input-container-origin"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Arrival Date</Label>
                  <Input
                    type="date"
                    value={formData.arrivalDate}
                    onChange={(e) => setFormData({ ...formData, arrivalDate: e.target.value })}
                    data-testid="input-container-arrival"
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
                    <SelectTrigger data-testid="select-container-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="IN_TRANSIT">In Transit</SelectItem>
                      <SelectItem value="AVAILABLE">Available</SelectItem>
                      <SelectItem value="OFFLOADED">Offloaded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Input
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Additional notes"
                  data-testid="input-container-notes"
                />
              </div>
            </div>

            {/* ── Section 2: Supplier & Broker ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Supplier &amp; Broker</p>
                <Separator className="flex-1" />
              </div>

              {/* Broker first so supplier list can filter */}
              <div>
                <Label>Broker / Commission To <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                <Select
                  value={formData.commissionSupplierId || "__none__"}
                  onValueChange={(val) => {
                    const newBroker = val === "__none__" ? "" : val;
                    setFormData(f => ({
                      ...f,
                      commissionSupplierId: newBroker,
                      // If current supplier doesn't belong to new broker, clear it
                      supplierId: (() => {
                        if (!newBroker || !f.supplierId) return f.supplierId;
                        const sup = activeSuppliers.find(s => s.id === parseInt(f.supplierId));
                        if (sup?.parentId && sup.parentId !== parseInt(newBroker)) return "";
                        return f.supplierId;
                      })(),
                    }));
                  }}
                >
                  <SelectTrigger data-testid="select-container-broker">
                    <SelectValue placeholder="Select broker..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {activeSuppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Purchase Supplier</Label>
                <Select
                  value={formData.supplierId || "__none__"}
                  onValueChange={(val) => setFormData({ ...formData, supplierId: val === "__none__" ? "" : val })}
                >
                  <SelectTrigger data-testid="select-container-supplier">
                    <SelectValue placeholder="Select supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {filteredSupplierList.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                        {s.parentId ? " (linked)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.commissionSupplierId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Showing suppliers linked to broker + standalone suppliers
                  </p>
                )}
              </div>

              {/* Auto-linked helper */}
              {selectedSupplier?.parentId && !brokerMismatch && formData.commissionSupplierId && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Linked to Broker:{" "}
                  <span className="font-medium text-foreground">
                    {activeSuppliers.find(s => s.id === selectedSupplier.parentId)?.name ?? `#${selectedSupplier.parentId}`}
                  </span>
                </div>
              )}

              {/* Mismatch warning */}
              {brokerMismatch && (
                <div className="rounded-md border border-yellow-400/60 bg-yellow-50 dark:bg-yellow-950/30 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    This supplier belongs to <strong>{activeSuppliers.find(s => s.id === selectedSupplier?.parentId)?.name ?? `Broker #${selectedSupplier?.parentId}`}</strong>, not the selected broker. Please fix the mismatch before saving.
                  </span>
                </div>
              )}
            </div>

            {/* ── Section 3: Money & Commission ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Money &amp; Commission</p>
                <Separator className="flex-1" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Total Kg</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.totalKg}
                    onChange={(e) => setFormData({ ...formData, totalKg: e.target.value })}
                    placeholder="0.000"
                    data-testid="input-container-total-kg"
                  />
                </div>
                <div>
                  <Label>Rate per Kg</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={formData.ratePerKg}
                    onChange={(e) => setFormData({ ...formData, ratePerKg: e.target.value })}
                    placeholder="0.0000000"
                    data-testid="input-container-rate"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={(val) => setCurrency(val)}>
                    <SelectTrigger data-testid="select-container-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>FX Rate {currency !== "USD" ? (fxRateSource === "auto" ? `(Auto${fxEffectiveDate ? ` — ${fxEffectiveDate}` : ""})` : "(Manual)") : ""}</Label>
                    {currency !== "USD" && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline"
                        onClick={() => setFxRateSource(fxRateSource === "auto" ? "manual" : "auto")}
                        data-testid="button-toggle-fx-source"
                      >
                        {fxRateSource === "auto" ? "Switch to Manual" : "Switch to Auto"}
                      </button>
                    )}
                  </div>
                  <Input
                    type="number"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    disabled={currency === "USD" || fxRateSource === "auto"}
                    readOnly={currency !== "USD" && fxRateSource === "auto"}
                    placeholder="1"
                    data-testid="input-container-fx-rate"
                  />
                </div>
              </div>

              {currency !== "USD" && fxRate && parseFloat(fxRate) > 0 && (
                <div className="text-sm text-muted-foreground">
                  1 {currency} = {formatNumber(parseFloat(fxRate))} USD
                  &nbsp;&nbsp;·&nbsp;&nbsp;
                  1 USD = {formatNumber(1 / parseFloat(fxRate))} {currency}
                  {formData.ratePerKg && (
                    <span> &nbsp;&nbsp;·&nbsp;&nbsp; Rate/Kg ≈ {formatNumber(parseFloat(formData.ratePerKg) * parseFloat(fxRate))} USD</span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Commission Amount</Label>
                  <Input
                    type="number"
                    value={formData.commissionAmount}
                    onChange={(e) => setFormData({ ...formData, commissionAmount: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-container-commission"
                  />
                </div>
                <div>
                  <Label>Commission Currency</Label>
                  <Select
                    value={formData.commissionCurrencyCode}
                    onValueChange={(val) => setFormData({ ...formData, commissionCurrencyCode: val })}
                  >
                    <SelectTrigger data-testid="select-commission-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>Commission Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                <Input
                  value={formData.commissionNotes}
                  onChange={(e) => setFormData({ ...formData, commissionNotes: e.target.value })}
                  placeholder="e.g. Commission for container facilitation"
                  data-testid="input-commission-notes"
                />
              </div>

              <div>
                <Label>ERP Commission Account <span className="text-muted-foreground text-xs font-normal">(optional — for ERP bookkeeping only)</span></Label>
                <Select
                  value={formData.commissionAccountId || "__none__"}
                  onValueChange={(val) => setFormData({ ...formData, commissionAccountId: val === "__none__" ? "" : val })}
                >
                  <SelectTrigger data-testid="select-commission-account">
                    <SelectValue placeholder="None (leave empty)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {ledgerAccounts.map((acc: any) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.name}{acc.code ? ` (${acc.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Commission flows into the broker's balance automatically via the "Broker / Commission To" field above.
                </p>
              </div>
            </div>

            {/* ── Section 4: Freight & Other Charges ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Freight &amp; Other Charges</p>
                <Separator className="flex-1" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Freight Amount <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                  <Input
                    type="number"
                    value={formData.freight}
                    onChange={(e) => setFormData({ ...formData, freight: e.target.value })}
                    placeholder="0.00"
                    data-testid="input-container-freight"
                  />
                </div>
                <div>
                  <Label>Freight Currency</Label>
                  <Select
                    value={formData.freightCurrencyCode}
                    onValueChange={(val) => setFormData({ ...formData, freightCurrencyCode: val })}
                  >
                    <SelectTrigger data-testid="select-freight-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="LBP">LBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Freight Expense Account <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                  <Select
                    value={formData.freightAccountId || "__none__"}
                    onValueChange={(val) => setFormData({ ...formData, freightAccountId: val === "__none__" ? "" : val })}
                  >
                    <SelectTrigger data-testid="select-freight-account">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {ledgerAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {acc.name}{acc.code ? ` (${acc.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Freight paid-by toggle — only shown when freight amount > 0 */}
              {parseFloat(formData.freight || "0") > 0 && (
                <div className="space-y-2">
                  <Label>Freight Paid By</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={formData.freightPaidBy === "supplier" ? "default" : "outline"}
                      onClick={() => setFormData({ ...formData, freightPaidBy: "supplier", freightOwnAccountId: "" })}
                      data-testid="button-freight-by-supplier"
                      className="flex-1"
                    >
                      By Supplier
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={formData.freightPaidBy === "own" ? "default" : "outline"}
                      onClick={() => setFormData({ ...formData, freightPaidBy: "own" })}
                      data-testid="button-freight-by-own"
                      className="flex-1"
                    >
                      Own Account
                    </Button>
                  </div>
                  {formData.freightPaidBy === "own" && (
                    <div>
                      <Label>Credit Account <span className="text-xs text-muted-foreground font-normal">(account that paid the freight)</span></Label>
                      <Select
                        value={formData.freightOwnAccountId || "__none__"}
                        onValueChange={(val) => setFormData({ ...formData, freightOwnAccountId: val === "__none__" ? "" : val })}
                      >
                        <SelectTrigger data-testid="select-freight-own-account">
                          <SelectValue placeholder="Select account..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select account...</SelectItem>
                          {ledgerAccounts.map((acc: any) => (
                            <SelectItem key={acc.id} value={String(acc.id)}>
                              {acc.name}{acc.code ? ` (${acc.code})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {formData.freightPaidBy === "supplier" && (
                    <p className="text-xs text-muted-foreground">Freight will be added to the supplier's payable balance.</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Other Charges <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => setOtherChargeLines(prev => [...prev, { amount: "", currencyCode: currency, ledgerAccountId: "" }])}
                    data-testid="button-add-other-charge"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Line
                  </Button>
                </div>
                {otherChargeLines.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">No other charges. Click "Add Line" to add one.</p>
                )}
                {otherChargeLines.length > 0 && (
                  <div className="grid grid-cols-[1fr_auto_2fr_auto] gap-x-2 gap-y-1 items-center">
                    <div className="text-xs text-muted-foreground font-medium">Amount</div>
                    <div className="text-xs text-muted-foreground font-medium">CCY</div>
                    <div className="text-xs text-muted-foreground font-medium">Account</div>
                    <div />
                    {otherChargeLines.map((line, idx) => (
                      <>
                        <Input
                          key={`amt-${idx}`}
                          type="number"
                          value={line.amount}
                          onChange={(e) => updateOtherChargeLine(idx, "amount", e.target.value)}
                          placeholder="0.00"
                          data-testid={`input-other-charge-amount-${idx}`}
                        />
                        <Select
                          key={`ccy-${idx}`}
                          value={line.currencyCode || currency}
                          onValueChange={(val) => updateOtherChargeLine(idx, "currencyCode", val)}
                        >
                          <SelectTrigger className="w-20" data-testid={`select-other-charge-currency-${idx}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="AUD">AUD</SelectItem>
                            <SelectItem value="LBP">LBP</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          key={`acc-${idx}`}
                          value={line.ledgerAccountId || "__none__"}
                          onValueChange={(val) => updateOtherChargeLine(idx, "ledgerAccountId", val === "__none__" ? "" : val)}
                        >
                          <SelectTrigger data-testid={`select-other-charge-account-${idx}`}>
                            <SelectValue placeholder="No account" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">No account</SelectItem>
                            {ledgerAccounts.map((acc: any) => (
                              <SelectItem key={acc.id} value={String(acc.id)}>
                                {acc.name}{acc.code ? ` (${acc.code})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          key={`del-${idx}`}
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeOtherChargeLine(idx)}
                          data-testid={`button-remove-other-charge-${idx}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    ))}
                  </div>
                )}
                {otherChargeLines.length > 0 && (
                  <div className="text-xs text-muted-foreground text-right pt-1 space-y-0.5">
                    {(() => {
                      const totals: Record<string, number> = {};
                      for (const l of otherChargeLines) {
                        const cc = l.currencyCode || currency;
                        const v = parseFloat(l.amount || "0");
                        if (v > 0) totals[cc] = (totals[cc] || 0) + v;
                      }
                      return Object.entries(totals).map(([cc, amt]) => (
                        <div key={cc}>Additional {cc} {formatNumber(amt)}</div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingContainer(null); resetForm(); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !formData.containerNumber ||
                !!brokerMismatch ||
                createMutation.isPending ||
                updateMutation.isPending
              }
              data-testid="button-save-container"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingContainer ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) { setImportOpen(false); setImportPreview([]); setImportResult(null); } }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import Containers from Excel
            </DialogTitle>
            <DialogDescription>
              Upload an Excel file (.xlsx) to bulk-import containers. New suppliers will be created automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-download-template">
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </Button>
              <div className="text-sm text-muted-foreground">
                Expected columns: Container Number, Supplier, Origin, Total Kg, Rate/Kg, Currency, FX Rate (optional), FX Source (AUTO/MANUAL), Arrival Date, Status, Notes
              </div>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground cursor-pointer"
                data-testid="input-import-file"
              />
            </div>

            {importPreview.length > 0 && !importResult && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-sm font-medium">{importPreview.length} rows ready to import</p>
                  <Button
                    onClick={() => importMutation.mutate(importPreview)}
                    disabled={importMutation.isPending}
                    data-testid="button-confirm-import"
                  >
                    {importMutation.isPending ? "Importing..." : `Import ${importPreview.length} Containers`}
                  </Button>
                </div>
                <div className="border rounded-md overflow-auto max-h-64">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Container #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Origin</TableHead>
                        <TableHead className="text-right">Kg</TableHead>
                        <TableHead className="text-right">Rate/Kg</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.map((row, i) => (
                        <TableRow key={i} data-testid={`row-import-preview-${i}`}>
                          <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-mono font-medium">{row.containerNumber}</TableCell>
                          <TableCell>{row.supplierName || "-"}</TableCell>
                          <TableCell>{row.origin || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{row.totalKg || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{row.ratePerKg || "-"}</TableCell>
                          <TableCell>{row.currencyCode}</TableCell>
                          <TableCell><ContainerStatusBadge status={row.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {importResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="font-medium">
                    {importResult.imported} of {importResult.total} containers imported successfully
                  </p>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="border border-destructive/30 rounded-md p-3 space-y-1">
                    <p className="text-sm font-medium flex items-center gap-1">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      {importResult.errors.length} error(s):
                    </p>
                    {importResult.errors.map((err, i) => (
                      <p key={i} className="text-sm text-muted-foreground">{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setImportOpen(false); setImportPreview([]); setImportResult(null); }}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!open) setBulkDeleteOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete {selectedIds.size} Container{selectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This action is <strong>permanent and cannot be undone</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 text-sm text-muted-foreground">
            <p>For each selected container, all of the following will be permanently removed:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Daybook / journal entries</li>
              <li>Vouchers and accounting entries</li>
              <li>FX allocation records</li>
              <li>Mix batch source links</li>
              <li>Offload charges (additional and pre-registered)</li>
              <li>Commission records</li>
              <li>Raw stock entries</li>
            </ul>
            <p className="text-destructive font-medium pt-1">Tip: Export All first if you need a backup.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => wrapAdminAction(() => bulkDeleteMutation.mutate(Array.from(selectedIds)), "Bulk Delete Containers")}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${selectedIds.size} Container${selectedIds.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Container Delete Confirmation */}
      <Dialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Container?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the container and all its linked records — accounting entries, vouchers, FX allocations, mix batch links, offload charges, and raw stock. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDeleteId(null)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => wrapAdminAction(() => { if (pendingDeleteId !== null) deleteMutation.mutate(pendingDeleteId); }, "Delete Container")}
              data-testid="button-confirm-delete-container"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Container"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Container Detail Dialog */}
      <Dialog open={!!viewContainer} onOpenChange={(open) => { if (!open) setViewContainer(null); }}>
        <DialogContent className="max-w-lg">
          {viewContainer && (() => {
            const vc = viewContainer as any;
            const ccy = vc.currencyCode || "USD";
            const totalKg = parseFloat(vc.totalKg || "0");
            const ratePerKg = parseFloat(vc.ratePerKg || "0");
            const baseValue = totalKg * ratePerKg;
            const freightAmt = parseFloat(vc.freight || "0");
            const freightCcy = vc.freightCurrencyCode || ccy;
            const commAmt = parseFloat(vc.commissionAmount || "0");
            const commCcy = vc.commissionCurrencyCode || "USD";
            const brokerSupId = vc.commissionSupplierId;
            const brokerName = brokerSupId ? suppliers?.find(s => s.id === brokerSupId)?.name ?? null : null;
            const freightAccName = vc.freightAccountId
              ? ledgerAccounts.find((a: any) => a.id === vc.freightAccountId)?.name ?? `Account #${vc.freightAccountId}`
              : null;
            const commAccName = vc.commissionAccountId
              ? ledgerAccounts.find((a: any) => a.id === vc.commissionAccountId)?.name ?? `Account #${vc.commissionAccountId}`
              : null;
            const legacyOtherAmt = parseFloat(vc.otherCharges || "0");
            const legacyOtherAccName = vc.otherChargesAccountId
              ? ledgerAccounts.find((a: any) => a.id === vc.otherChargesAccountId)?.name ?? `Account #${vc.otherChargesAccountId}`
              : null;
            const fxRate = parseFloat(vc.fxRateToUsd || "1");
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 font-mono">
                    <Container className="h-5 w-5" />
                    {viewContainer.containerNumber}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-2 pt-1">
                    <Badge variant={viewContainer.status === "OFFLOADED" ? "default" : "secondary"}>{getContainerStatusLabel(viewContainer.status)}</Badge>
                    {viewContainer.supplierName && <span className="text-muted-foreground">{viewContainer.supplierName}</span>}
                    {viewContainer.arrivalDate && <span className="text-muted-foreground">· Arrived {viewContainer.arrivalDate}</span>}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  {/* Base Value */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goods</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Weight</span>
                      <span className="font-mono text-right">{formatNumber(totalKg)} kg</span>
                      <span className="text-muted-foreground">Rate</span>
                      <span className="font-mono text-right">{ccy} {formatNumber(ratePerKg)} / kg</span>
                      {ccy !== "USD" && fxRate !== 1 && (
                        <>
                          <span className="text-muted-foreground">FX Rate</span>
                          <span className="font-mono text-right">1 {ccy} = {fxRate} USD</span>
                        </>
                      )}
                      <span className="text-muted-foreground font-medium">Base Value</span>
                      <span className="font-mono font-semibold text-right">{ccy} {formatNumber(baseValue)}</span>
                    </div>
                  </div>
                  <Separator />
                  {/* Freight */}
                  {freightAmt > 0 && (
                    <>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Freight</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                          <span className="text-muted-foreground">Amount</span>
                          <span className="font-mono text-right">{freightCcy} {formatNumber(freightAmt)}</span>
                          {freightAccName && (
                            <>
                              <span className="text-muted-foreground">Account</span>
                              <span className="text-right truncate">{freightAccName}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}
                  {/* Other Charges */}
                  {(legacyOtherAmt > 0 || viewContainerCharges.length > 0) && (
                    <>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Other Charges</p>
                        <div className="space-y-2">
                          {legacyOtherAmt > 0 && (
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                              <span className="text-muted-foreground">Other Charges (legacy)</span>
                              <span className="font-mono text-right">{ccy} {formatNumber(legacyOtherAmt)}</span>
                              {legacyOtherAccName && (
                                <>
                                  <span className="text-muted-foreground">Account</span>
                                  <span className="text-right truncate">{legacyOtherAccName}</span>
                                </>
                              )}
                            </div>
                          )}
                          {viewContainerCharges.map((ch: any) => {
                            const accName = ch.ledgerAccountId
                              ? ledgerAccounts.find((a: any) => a.id === ch.ledgerAccountId)?.name ?? `Account #${ch.ledgerAccountId}`
                              : null;
                            return (
                              <div key={ch.id} className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                <span className="text-muted-foreground">{ch.description || "Charge"}</span>
                                <span className="font-mono text-right">{ch.currencyCode || ccy} {formatNumber(parseFloat(ch.amount || "0"))}</span>
                                {accName && (
                                  <>
                                    <span className="text-muted-foreground pl-3">↳ Account</span>
                                    <span className="text-right truncate text-xs text-muted-foreground">{accName}</span>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}
                  {/* Commission */}
                  {commAmt > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commission</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="font-mono text-right">{commCcy} {formatNumber(commAmt)}</span>
                        {brokerName && (
                          <>
                            <span className="text-muted-foreground">Broker</span>
                            <span className="text-right">{brokerName}</span>
                          </>
                        )}
                        {commAccName && (
                          <>
                            <span className="text-muted-foreground">Account</span>
                            <span className="text-right truncate">{commAccName}</span>
                          </>
                        )}
                        {vc.commissionNotes && (
                          <>
                            <span className="text-muted-foreground">Notes</span>
                            <span className="text-right">{vc.commissionNotes}</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setViewContainer(null)}>Close</Button>
                  <Button variant="ghost" onClick={() => { setViewContainer(null); openEdit(viewContainer); }}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Post-Offload Charges Dialog */}
      <Dialog open={!!postOffloadContainer} onOpenChange={(open) => { if (!open) { setPostOffloadContainer(null); setPostOffloadResult(null); setPostOffloadCharges([]); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5 text-blue-500" />
              Add Post-Offload Charges
            </DialogTitle>
            <DialogDescription>
              Container <strong>{postOffloadContainer?.containerNumber}</strong> — charges added here will update the cost per kg and retroactively adjust all mix batches made from this container.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-5 py-2">
            {postOffloadResult ? (
              /* ── Results view ── */
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-3 rounded-md bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300 text-sm">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Charges saved successfully</p>
                    <p className="text-xs mt-0.5 opacity-80">The container cost per kg and all related mix batch costs have been updated.</p>
                  </div>
                </div>
                {postOffloadResult.affectedBatches.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">Affected Mix Batches</p>
                    <div className="border rounded-md divide-y text-sm">
                      <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-xs text-muted-foreground font-medium">
                        <span>Batch</span>
                        <span className="text-right">Old Cost/kg</span>
                        <span className="text-right">New Cost/kg</span>
                        <span className="text-right">Weight from this container</span>
                      </div>
                      {postOffloadResult.affectedBatches.map((b) => (
                        <div key={b.batchId} className="grid grid-cols-4 gap-2 px-3 py-2 items-center">
                          <span className="font-mono font-medium">{b.batchCode}</span>
                          <span className="text-right font-mono text-muted-foreground">${b.oldCostPerKg.toFixed(4)}</span>
                          <span className="text-right font-mono font-semibold">${b.newCostPerKg.toFixed(4)}</span>
                          <span className="text-right font-mono text-muted-foreground">{formatNumber(b.weightKg)} kg</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/40 rounded-md">
                    <Info className="h-4 w-4 shrink-0" />
                    No mix batches were linked to this container — only the container and raw stock costs were updated.
                  </div>
                )}
              </div>
            ) : (
              /* ── Entry form ── */
              <div className="space-y-5">
                <div className="flex items-start gap-3 p-3 rounded-md bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300 text-sm">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>Enter any charges that arrived after the original offload — port fees, duties, handling, etc. Each charge will be added to the container's cost and will cascade into any mix batches already made from it.</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Date</label>
                  <Input
                    type="date"
                    value={postOffloadDate}
                    onChange={(e) => setPostOffloadDate(e.target.value)}
                    className="w-48"
                    data-testid="input-post-offload-date"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <label className="text-sm font-medium">Charges</label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPostOffloadCharges(prev => [...prev, { id: Date.now().toString(), description: "", amount: "", currencyCode: (postOffloadContainer as any)?.currencyCode || "USD", ledgerAccountId: "", supplierId: "" }])}
                      data-testid="button-add-post-offload-charge-row"
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Row
                    </Button>
                  </div>

                  {postOffloadCharges.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-md">No charges added yet — click "Add Row" to begin.</p>
                  ) : (
                    <div className="space-y-1">
                      <div className="grid grid-cols-[2fr_1fr_auto_2fr_auto] gap-x-2 gap-y-1 items-center">
                        <div className="text-xs text-muted-foreground font-medium">Description</div>
                        <div className="text-xs text-muted-foreground font-medium">Amount</div>
                        <div className="text-xs text-muted-foreground font-medium">CCY</div>
                        <div className="text-xs text-muted-foreground font-medium">Account / Broker</div>
                        <div />
                        {postOffloadCharges.map((charge, idx) => (
                          <Fragment key={charge.id}>
                            <Input
                              value={charge.description}
                              onChange={(e) => setPostOffloadCharges(prev => prev.map(c => c.id === charge.id ? { ...c, description: e.target.value } : c))}
                              placeholder="e.g. Port duty"
                              data-testid={`input-poc-description-${idx}`}
                            />
                            <Input
                              type="number"
                              value={charge.amount}
                              onChange={(e) => setPostOffloadCharges(prev => prev.map(c => c.id === charge.id ? { ...c, amount: e.target.value } : c))}
                              placeholder="0.00"
                              step="0.01"
                              data-testid={`input-poc-amount-${idx}`}
                            />
                            <Select
                              value={charge.currencyCode || "USD"}
                              onValueChange={(v) => setPostOffloadCharges(prev => prev.map(c => c.id === charge.id ? { ...c, currencyCode: v } : c))}
                            >
                              <SelectTrigger className="w-20" data-testid={`select-poc-currency-${idx}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["USD","EUR","GBP","AUD","LBP"].map(ccy => <SelectItem key={ccy} value={ccy}>{ccy}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select
                              value={charge.ledgerAccountId || ""}
                              onValueChange={(v) => setPostOffloadCharges(prev => prev.map(c => c.id === charge.id ? { ...c, ledgerAccountId: v, supplierId: "" } : c))}
                            >
                              <SelectTrigger data-testid={`select-poc-account-${idx}`}>
                                <SelectValue placeholder="Select account (optional)" />
                              </SelectTrigger>
                              <SelectContent>
                                {ledgerAccounts.map((a: any) => (
                                  <SelectItem key={a.id} value={String(a.id)}>{a.code ? `${a.code} - ${a.name}` : a.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPostOffloadCharges(prev => prev.filter(c => c.id !== charge.id))}
                              data-testid={`button-remove-poc-${idx}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => { setPostOffloadContainer(null); setPostOffloadResult(null); setPostOffloadCharges([]); }}>
              {postOffloadResult ? "Close" : "Cancel"}
            </Button>
            {!postOffloadResult && (
              <Button
                onClick={() => {
                  if (!postOffloadContainer) return;
                  const valid = postOffloadCharges.filter(c => parseFloat(c.amount || "0") > 0);
                  if (valid.length === 0) {
                    toast({ title: "No charges", description: "Add at least one charge with an amount.", variant: "destructive" });
                    return;
                  }
                  wrapAdminAction(() => postOffloadMutation.mutate({
                    containerId: postOffloadContainer.id,
                    txDate: postOffloadDate || new Date().toLocaleDateString("en-CA"),
                    charges: valid.map(c => ({
                      description: c.description || "Post-offload charge",
                      amount: c.amount,
                      currencyCode: c.currencyCode || "USD",
                      ledgerAccountId: c.ledgerAccountId ? parseInt(c.ledgerAccountId) : null,
                      supplierId: c.supplierId ? parseInt(c.supplierId) : null,
                    })),
                  }), "Add Post-Offload Charges");
                }}
                disabled={postOffloadMutation.isPending || postOffloadCharges.every(c => parseFloat(c.amount || "0") <= 0)}
                data-testid="button-confirm-post-offload-charges"
              >
                {postOffloadMutation.isPending ? "Saving..." : "Save Charges"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse Offload Confirmation */}
      <Dialog open={!!reversingContainer} onOpenChange={(open) => { if (!open) setReversingContainer(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse Offload</DialogTitle>
            <DialogDescription>
              This will permanently undo the offload for container <strong>{reversingContainer?.containerNumber}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2 text-sm text-muted-foreground">
            <p>The following offload data will be permanently removed:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Raw stock entry from Raw Production</li>
              <li>Commission record and daybook entry</li>
              <li>Freight, other charges, and additional charge entries (fields cleared to zero)</li>
              <li>Duty amount and status (reset to NONE)</li>
              <li>Mix-batch source allocations linked to this container</li>
              <li>All accounting journal vouchers (freight, other charges, commission)</li>
              <li>All related daybook entries (OFFLOAD_RAW_STOCK, FREIGHT, OTHER_CHARGE, DUTY, COMMISSION)</li>
            </ul>
            <p className="text-foreground font-medium pt-1">
              The container returns to its previous status. Commission, supplier import voucher, and any payments made are <em>not</em> removed.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReversingContainer(null)} data-testid="button-cancel-reverse-offload">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => wrapAdminAction(() => reversingContainer && reverseOffloadMutation.mutate(reversingContainer.id), "Reverse Offload")}
              disabled={reverseOffloadMutation.isPending}
              data-testid="button-confirm-reverse-offload"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {reverseOffloadMutation.isPending ? "Reversing..." : "Reverse Offload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {AdminDialog}
    </div>
  );
}
