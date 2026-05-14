/**
 * Containers OTW — Operational active-container tracking page.
 * Real data from GET /api/git/containers.
 * Edit via PATCH /api/containers/:id/tracking.
 * Access: Admin, Developer, Owner only.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Ship,
  Truck,
  Package,
  AlertTriangle,
  FileX,
  Clock,
  DollarSign,
  Search,
  Filter,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Pencil,
  Building2,
  Globe,
  Satellite,
  RefreshCw,
  History,
  Loader2,
  Download,
  Upload,
  FileSpreadsheet,
  X,
  MessageCircle,
  Send,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichedContainerRow {
  id: number;
  containerNumber: string;
  companyId: number;
  companyName: string;
  shopName: string | null;
  supplierName: string | null;
  status: string;
  eta: string | null;
  grandTotal: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  borderDate: string | null;
  transporter: string | null;
  transportFee: string | null;
  agent: string | null;
  dutyFee: string | null;
  docReceived: boolean | null;
  trackingDescription: string | null;
  docsSentDate: string | null;
  freightStatus: string | null;
  trackingLink: string | null;
  // ParcelsApp auto-tracking
  trackingProvider: string | null;
  trackingEnabled: boolean;
  trackingAutoUpdate: boolean;
  trackingCarrierHint: string | null;
  trackingLastCheckedAt: string | null;
  trackingLastStatus: string | null;
  trackingLastLocation: string | null;
  trackingLastEventDate: string | null;
  trackingLastDescription: string | null;
  trackingError: string | null;
  trackingChangedAt: string | null;
  trackingDetectedCarrier: string | null;
  trackingFallbackUsed: boolean | null;
  trackingFallbackReason: string | null;
  trackingNextCheckAt: string | null;
  trackingLastSkipReason: string | null;
  maxOffloadDate: string | null;
  daysDelayed: number | null;
  docsReadyNotSent: boolean;
  isOverdue: boolean;
}

interface GitContainersResponse {
  containers: EnrichedContainerRow[];
  mode: "single" | "all";
  companyId?: number;
  companyName?: string;
  total: number;
}

interface AuthUser {
  id: number;
  role: string;
  username: string;
  companyId?: number;
}

// ─── Inline ETA cell ──────────────────────────────────────────────────────────

function EtaCell({ container, fmtDate }: { container: Container; fmtDate: (d: string | null | undefined) => string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(container.eta ?? "");

  const mutation = useMutation({
    mutationFn: (eta: string | null) =>
      apiRequest("PATCH", `/api/containers/${container.id}/tracking`, { eta, etaSource: eta ? "manual" : undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/git/containers"] });
      setEditing(false);
    },
  });

  function save() {
    mutation.mutate(value || null);
  }

  if (editing) {
    return (
      <input
        type="date"
        value={value}
        autoFocus
        data-testid={`input-eta-inline-${container.id}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { setValue(container.eta ?? ""); setEditing(false); }
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-[128px] h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setValue(container.eta ?? ""); setEditing(true); }}
      title="Click to set or edit ETA"
      data-testid={`text-eta-${container.id}`}
      className="cursor-text underline decoration-dashed underline-offset-2 decoration-muted-foreground/40"
    >
      {container.eta ? fmtDate(container.eta) : <span className="text-muted-foreground/50 text-xs no-underline">set ETA</span>}
    </span>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = [
  "OTW", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived",
] as const;

type ActiveStatus = typeof ACTIVE_STATUSES[number];

const ALL_STATUSES = [
  ...ACTIVE_STATUSES, "Offloaded", "Closed", "Completed",
] as const;

const STATUS_META: Record<string, { color: string; icon: React.ReactNode }> = {
  OTW:          { color: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",             icon: <Ship className="h-3 w-3" /> },
  Sea:          { color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",          icon: <Ship className="h-3 w-3" /> },
  "At Port":    { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",      icon: <Package className="h-3 w-3" /> },
  "Left Dar":   { color: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",  icon: <Truck className="h-3 w-3" /> },
  "At Border":  { color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",  icon: <Truck className="h-3 w-3" /> },
  "In Transit": { color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",  icon: <Truck className="h-3 w-3" /> },
  Arrived:      { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",      icon: <CheckCircle2 className="h-3 w-3" /> },
  Offloaded:    { color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",             icon: <Package className="h-3 w-3" /> },
  Closed:       { color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",             icon: <XCircle className="h-3 w-3" /> },
  Completed:    { color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",             icon: <XCircle className="h-3 w-3" /> },
};

const FREIGHT_META: Record<string, { color: string }> = {
  Yes:     { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  No:      { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  Pending: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNum(v: string | null | undefined): number {
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const [y, m, day] = parts;
  return `${day}/${m}/${y.slice(2)}`;
}

// ─── Client-side priority helper (mirrors server trackingPriority.ts) ─────────

type PriorityTier = "high" | "medium" | "low";

interface UIPriority {
  tier: PriorityTier;
  label: string;
  reason: string;
  intervalHours: number;
}

function getContainerPriority(c: EnrichedContainerRow): UIPriority {
  const statusLower = c.status.toLowerCase();
  const now = new Date();
  const etaDate = c.eta ? new Date(c.eta) : null;
  const daysUntilEta =
    etaDate !== null
      ? Math.ceil((etaDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;
  const etaPassed = daysUntilEta !== null && daysUntilEta < 0;
  const hasTruck = !!(c.numberPlate && c.numberPlate.trim());

  if (etaPassed && !hasTruck)
    return { tier: "high", label: "High", reason: "ETA passed — no truck assigned", intervalHours: 24 };
  if (c.isOverdue)
    return { tier: "high", label: "High", reason: "Container is overdue", intervalHours: 24 };
  if (c.docsReadyNotSent)
    return { tier: "high", label: "High", reason: "Docs ready — not yet sent", intervalHours: 24 };
  if (statusLower === "at port")
    return { tier: "high", label: "High", reason: "At Port — arrival imminent", intervalHours: 24 };
  if (statusLower === "left dar")
    return { tier: "high", label: "High", reason: "Left Dar — final delivery leg", intervalHours: 24 };
  if (statusLower === "at border")
    return { tier: "high", label: "High", reason: "At Border — clearing customs", intervalHours: 24 };
  if (statusLower === "in transit")
    return { tier: "high", label: "High", reason: "In Transit — active movement", intervalHours: 24 };
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 3)
    return { tier: "high", label: "High", reason: `ETA in ${daysUntilEta} day${daysUntilEta !== 1 ? "s" : ""}`, intervalHours: 24 };
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 7)
    return { tier: "medium", label: "Medium", reason: `ETA in ${daysUntilEta} days`, intervalHours: 48 };
  if (statusLower === "arrived")
    return { tier: "medium", label: "Medium", reason: "Arrived — awaiting offload", intervalHours: 48 };
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 14)
    return { tier: "medium", label: "Medium", reason: `ETA in ${daysUntilEta} days`, intervalHours: 48 };
  if (daysUntilEta !== null && daysUntilEta > 14) {
    const intervalHours = daysUntilEta > 21 ? 120 : 96;
    return { tier: "low", label: "Low", reason: `ETA in ${daysUntilEta} days`, intervalHours };
  }
  return { tier: "low", label: "Low", reason: "No ETA set", intervalHours: 120 };
}

function fmtSkipReason(raw: string | null): string | null {
  if (!raw) return null;
  if (raw === "skipped_recent") return "Checked recently — waiting for next interval";
  if (raw === "skipped_priority_budget") return "Lower priority — skipped this run to save quota";
  if (raw === "skipped_disabled") return "Auto-update is turned off";
  if (raw === "skipped_quota") return "All quota exhausted — scraper, 17track, and ParcelsApp API all unavailable";
  if (raw === "invalid_container_number") return "Container number is not a valid format";
  if (raw === "scraper_blocked") return "Web scraper blocked by reCaptcha — fell back to 17track or ParcelsApp API";
  return raw;
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, accent }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-3 flex items-start gap-2.5">
        <div className={cn("p-1.5 rounded-md shrink-0", accent ?? "bg-muted")}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
          <p className="text-lg font-bold leading-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status Chip ──────────────────────────────────────────────────────────────


// ─── Drawer form type & seed ──────────────────────────────────────────────────

interface DrawerForm {
  eta: string;
  status: string;
  transporter: string;
  transportFee: string;
  numberPlate: string;
  trackingLocation: string;
  borderDate: string;
  agent: string;
  dutyFee: string;
  docReceived: boolean;
  docsSentDate: string;
  trackingLink: string;
  trackingDescription: string;
  shopName: string;
}

function seedForm(c: EnrichedContainerRow): DrawerForm {
  return {
    eta: c.eta ?? "",
    status: c.status,
    transporter: c.transporter ?? "",
    transportFee: c.transportFee ?? "",
    numberPlate: c.numberPlate ?? "",
    trackingLocation: c.trackingLocation ?? "",
    borderDate: c.borderDate ?? "",
    agent: c.agent ?? "",
    dutyFee: c.dutyFee ?? "",
    docReceived: c.docReceived === true,
    docsSentDate: c.docsSentDate ?? "",
    trackingLink: c.trackingLink ?? "",
    trackingDescription: c.trackingDescription ?? "",
    shopName: c.shopName ?? "",
  };
}

// ─── Container Logistics Drawer ───────────────────────────────────────────────

function ContainerDrawer({
  container,
  open,
  onClose,
  queryKey,
  sessionCompanyId,
}: {
  container: EnrichedContainerRow | null;
  open: boolean;
  onClose: () => void;
  queryKey: string;
  sessionCompanyId: number | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DrawerForm | null>(null);
  const [lastId, setLastId] = useState<number | null>(null);
  const [trackEnabled, setTrackEnabled] = useState(false);
  const [trackAutoUpdate, setTrackAutoUpdate] = useState(true);
  const [trackCarrierHint, setTrackCarrierHint] = useState("");
  const [showEvents, setShowEvents] = useState(false);

  useEffect(() => {
    if (open && container && container.id !== lastId) {
      setForm(seedForm(container));
      setTrackEnabled(container.trackingEnabled ?? false);
      setTrackAutoUpdate(container.trackingAutoUpdate ?? true);
      setTrackCarrierHint(container.trackingCarrierHint ?? "");
      setLastId(container.id);
    }
  }, [open, container?.id]);

  const set = (field: keyof DrawerForm, val: any) =>
    setForm((prev) => prev ? { ...prev, [field]: val } : prev);

  const canEdit =
    sessionCompanyId === null ||
    !container ||
    container.companyId === sessionCompanyId;

  const maxOffload = (() => {
    if (!form?.borderDate) return null;
    const d = new Date(form.borderDate);
    if (isNaN(d.getTime())) return null;
    const t = (form.transporter ?? "").toUpperCase();
    const days = t.includes("FARHAT") || t.includes("CONTINENTAL") ? 11 : 14;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  })();

  const daysDelayed = (() => {
    if ((form?.numberPlate ?? "").trim()) return null;
    if (!form?.eta) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const arrival = new Date(form.eta);
    if (isNaN(arrival.getTime())) return null;
    const diff = Math.floor((today.getTime() - arrival.getTime()) / 86400000);
    return diff > 0 ? diff : null;
  })();

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/containers/${container!.id}/tracking`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: "Saved", description: `${container?.containerNumber} updated.` });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const trackingSettingsMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/container-tracking/${container!.id}/settings`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({ title: "Tracking settings saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  type TrackNowResult = {
    success: boolean;
    containerNumber: string;
    provider: string | null;
    lastStatus: string | null;
    oldEta: string | null;
    newEta: string | null;
    etaChanged: boolean;
    attempts: Array<{ provider: string; status: string; error: string | null }>;
    error: string | null;
    quotaWarning?: string;
  };

  const trackNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/container-tracking/${container!.id}/track-now`, {}, false, 15000);
      return res.json() as Promise<{ started: true; containerNumber: string } | TrackNowResult>;
    },
    onSuccess: (data) => {
      const ALL_KEYS = ["/api/git/containers", "/api/containers", "/api/containers/active"];

      // 202 fire-and-forget: tracking is running in the background
      if ("started" in data && data.started) {
        toast({
          title: "Tracking started",
          description: "Results will refresh shortly.",
        });
        // Poll every 8 s for up to 80 s so the UI refreshes once tracking finishes
        let polls = 0;
        const interval = setInterval(() => {
          polls++;
          ALL_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
          if (polls >= 10) clearInterval(interval);
        }, 8000);
        return;
      }

      // Legacy synchronous result (kept for safety)
      ALL_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      const result = data as TrackNowResult;
      if (result.success) {
        const etaLine = result.etaChanged
          ? `ETA: ${result.newEta ?? "—"} (was ${result.oldEta ?? "none"})`
          : result.newEta
            ? `ETA unchanged: ${result.newEta}`
            : "No ETA returned — previous ETA kept";
        toast({
          title: `Tracked: ${result.containerNumber}`,
          description: `${result.provider ?? "unknown"} — ${etaLine}`,
        });
      } else {
        const tried = result.attempts?.length > 0
          ? result.attempts.map((a) => `${a.provider}: ${a.status}`).join(" → ")
          : "No providers available";
        toast({
          title: "All providers failed",
          description: tried,
          variant: "destructive",
        });
      }
      if (result.quotaWarning) {
        setTimeout(() => toast({ title: "Quota low", description: result.quotaWarning, variant: "destructive" }), 400);
      }
    },
    onError: (err: any) => {
      toast({ title: "Track Now failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  // ── Live tracking progress polling ─────────────────────────────────────────
  type TrackProgressStep = { label: string; status: string; detail: string | null; ts: number };
  const [trackProgress, setTrackProgress] = useState<TrackProgressStep[]>([]);
  const trackProgressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (trackNowMutation.isPending && container?.id) {
      setTrackProgress([]);
      trackProgressIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/container-tracking/${container.id}/progress`, { credentials: "include" });
          if (res.ok) setTrackProgress(await res.json());
        } catch { /* ignore */ }
      }, 600);
    } else {
      if (trackProgressIntervalRef.current) {
        clearInterval(trackProgressIntervalRef.current);
        trackProgressIntervalRef.current = null;
        setTimeout(() => setTrackProgress([]), 20_000);
      }
    }
    return () => {
      if (trackProgressIntervalRef.current) clearInterval(trackProgressIntervalRef.current);
    };
  }, [trackNowMutation.isPending, container?.id]);

  const eventsQueryKey = container?.id ? `/api/container-tracking/${container.id}/events` : null;
  const { data: events, isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: [eventsQueryKey],
    enabled: showEvents && !!eventsQueryKey,
    staleTime: 30_000,
  });

  const { data: trackingStatus } = useQuery<{
    configured: boolean;
    parcelsAppConfigured: boolean;
    parcelsAppUsageThisMonth: number;
    parcelsAppMonthlyLimit: number;
    parcelsAppRemaining: number;
    parcelsAppQuotaExhausted: boolean;
    parcelsAppNextResetDate: string;
    maerskConfigured: boolean;
    maerskPublicEnabled: boolean;
    cmaPublicEnabled: boolean;
    schedulerRemainingDays: number;
    schedulerDailyBudget: number;
    schedulerPerRunBudget: number;
    // Puppeteer stealth scraper
    httpScraperAvailable: boolean;
    scraperAvailable: boolean;
    scraperStatus: string;
    // 17track
    seventeenTrackConfigured: boolean;
    seventeenTrackUsageThisMonth: number;
    seventeenTrackMonthlyLimit: number;
    seventeenTrackRemaining: number;
    seventeenTrackQuotaExhausted: boolean;
  }>({
    queryKey: ["/api/container-tracking/status"],
    staleTime: 5 * 60_000,
  });

  const isContainerInactive = container
    ? ["offloaded", "closed", "completed"].includes(container.status.toLowerCase())
    : false;

  function handleSaveTrackingSettings() {
    if (!container) return;
    trackingSettingsMutation.mutate({
      trackingEnabled: trackEnabled,
      trackingAutoUpdate: trackAutoUpdate,
      trackingCarrierHint: trackCarrierHint || null,
    });
  }

  function handleSave() {
    if (!container || !form) return;
    mutation.mutate({
      eta: form.eta || null,
      status: form.status,
      transporter: form.transporter || null,
      transportFee: form.transportFee || null,
      numberPlate: form.numberPlate || null,
      trackingLocation: form.trackingLocation || null,
      borderDate: form.borderDate || null,
      agent: form.agent || null,
      dutyFee: form.dutyFee || null,
      docReceived: form.docReceived,
      docsSentDate: form.docsSentDate || null,
      trackingLink: form.trackingLink || null,
      trackingDescription: form.trackingDescription || null,
      shopName: form.shopName || null,
    });
  }

  if (!container || !form) return null;

  const transUpper = form.transporter.toUpperCase();
  const transLabel = transUpper.includes("FARHAT") || transUpper.includes("CONTINENTAL")
    ? "(+11d)"
    : transUpper.includes("KDOUH")
    ? "(+12d)"
    : form.transporter ? "(+14d)" : "";

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base font-mono">{container.containerNumber}</SheetTitle>
          <SheetDescription className="text-xs">
            {container.companyName} — Container Logistics
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pt-2">

          {!canEdit && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                This container belongs to <strong>{container.companyName}</strong>.
                Switch to that company to edit it.
              </span>
            </div>
          )}

          {/* ── Calculated read-only preview ── */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Calculated (read-only)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Max Offload Date</p>
                <p className={cn("text-sm font-medium",
                  maxOffload && new Date(maxOffload) < new Date() ? "text-red-600" : ""
                )}>
                  {fmtDate(maxOffload)}
                  {maxOffload && form.transporter && (
                    <span className="text-xs text-muted-foreground ml-1">{transLabel}</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Days Delayed</p>
                <p className={cn("text-sm font-medium", daysDelayed ? "text-red-600" : "text-muted-foreground")}>
                  {daysDelayed ? `+${daysDelayed}d` : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Offload Overdue</p>
                <p className="text-sm font-medium">
                  {container.isOverdue
                    ? <span className="text-red-600">Yes</span>
                    : <span className="text-muted-foreground">—</span>}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Shop Name ── */}
          <div className="space-y-1">
            <Label className="text-xs">Shop Name</Label>
            <Input
              placeholder="e.g. ABC SHOP"
              value={form.shopName}
              onChange={(e) => set("shopName", e.target.value)}
              disabled={!canEdit}
              data-testid="input-drawer-shop-name"
            />
          </div>

          {/* ── ETA DAS ── */}
          <div className="space-y-1">
            <Label className="text-xs">ETA DAS</Label>
            <Input
              type="date"
              value={form.eta}
              onChange={(e) => set("eta", e.target.value)}
              disabled={!canEdit}
              data-testid="input-drawer-eta"
            />
          </div>

          {/* ── Transporter + Transport Fee ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Transporter</Label>
              <Select
                value={form.transporter || "__none"}
                onValueChange={(v) => set("transporter", v === "__none" ? "" : v)}
                disabled={!canEdit}
              >
                <SelectTrigger data-testid="select-drawer-transporter">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  <SelectItem value="FARHAT">FARHAT (+11d)</SelectItem>
                  <SelectItem value="CONTINENTAL">CONTINENTAL (+11d)</SelectItem>
                  <SelectItem value="KDOUH">KDOUH (+12d)</SelectItem>
                  <SelectItem value="TRH">TRH (+14d)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transport Fee ($)</Label>
              <Input
                type="number"
                placeholder="0"
                value={form.transportFee}
                onChange={(e) => set("transportFee", e.target.value)}
                disabled={!canEdit}
                data-testid="input-drawer-transport-fee"
              />
            </div>
          </div>

          {/* ── Truck + Location ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Truck / Number Plate</Label>
              <Input
                placeholder="T123ABC"
                value={form.numberPlate}
                onChange={(e) => set("numberPlate", e.target.value)}
                disabled={!canEdit}
                data-testid="input-drawer-plate"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Input
                placeholder="e.g. Kasumbalesa"
                value={form.trackingLocation}
                onChange={(e) => set("trackingLocation", e.target.value)}
                disabled={!canEdit}
                data-testid="input-drawer-location"
              />
            </div>
          </div>

          {/* ── Border Date ── */}
          <div className="space-y-1">
            <Label className="text-xs">Border Date</Label>
            <Input
              type="date"
              value={form.borderDate}
              onChange={(e) => set("borderDate", e.target.value)}
              disabled={!canEdit}
              data-testid="input-drawer-border-date"
            />
            <p className="text-xs text-muted-foreground">
              Used to calculate Max Offload Date based on transporter
            </p>
          </div>

          {/* ── Declarant + Duty Fee ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Declarant / Agent</Label>
              <Input
                placeholder="e.g. ATLAS"
                value={form.agent}
                onChange={(e) => set("agent", e.target.value)}
                disabled={!canEdit}
                data-testid="input-drawer-agent"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duty Fee ($)</Label>
              <Input
                type="number"
                placeholder="0"
                value={form.dutyFee}
                onChange={(e) => set("dutyFee", e.target.value)}
                disabled={!canEdit}
                data-testid="input-drawer-duty-fee"
              />
            </div>
          </div>

          {/* ── Docs ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Docs Received</Label>
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={form.docReceived}
                  onCheckedChange={(v) => set("docReceived", v)}
                  disabled={!canEdit}
                  data-testid="switch-drawer-docs-received"
                />
                <span className="text-sm">{form.docReceived ? "Yes" : "No"}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Docs Sent to Transporter</Label>
              <Input
                type="date"
                value={form.docsSentDate}
                onChange={(e) => set("docsSentDate", e.target.value)}
                disabled={!canEdit}
                data-testid="input-drawer-docs-sent"
              />
            </div>
          </div>

          {/* ── Tracking Link ── */}
          <div className="space-y-1">
            <Label className="text-xs">Tracking Link</Label>
            <Input
              placeholder="https://…"
              value={form.trackingLink}
              onChange={(e) => set("trackingLink", e.target.value)}
              disabled={!canEdit}
              data-testid="input-drawer-tracking"
            />
          </div>

          {/* ── Notes ── */}
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              rows={3}
              placeholder="Additional notes…"
              value={form.trackingDescription}
              onChange={(e) => set("trackingDescription", e.target.value)}
              disabled={!canEdit}
              data-testid="input-drawer-notes"
            />
          </div>

          <Separator />

          {/* ── Auto Tracking ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Satellite className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Auto Tracking
              </p>
            </div>

            {/* Inactive container warning */}
            {isContainerInactive && (
              <div className="flex items-start gap-1.5 rounded-md bg-muted/50 border px-2 py-1.5" data-testid="banner-tracking-inactive">
                <AlertTriangle className="h-3 w-3 text-muted-foreground shrink-0 mt-px" />
                <p className="text-xs text-muted-foreground">
                  Tracking is disabled — container is {container?.status?.toLowerCase()}.
                </p>
              </div>
            )}

            {/* Tracking provider chain */}
            {trackingStatus && (
              <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-2.5" data-testid="panel-provider-chain">
                <p className="text-xs font-medium text-muted-foreground">Tracking providers (tried in order)</p>

                {/* Row helper */}
                {(() => {
                  const Row = ({
                    label, badge, badgeColor, detail, detailNode, testId,
                  }: {
                    label: string;
                    badge: string;
                    badgeColor: string;
                    detail?: string;
                    detailNode?: React.ReactNode;
                    testId?: string;
                  }) => (
                    <div className="space-y-0.5" data-testid={testId}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${badgeColor}`}>{badge}</span>
                      </div>
                      {(detail || detailNode) && (
                        <p className="text-[11px] text-muted-foreground/70 text-right leading-snug">
                          {detailNode ?? detail}
                        </p>
                      )}
                    </div>
                  );

                  const httpOk    = trackingStatus.httpScraperAvailable;
                  const scraperOk = trackingStatus.scraperAvailable;
                  const stOk      = trackingStatus.seventeenTrackConfigured && !trackingStatus.seventeenTrackQuotaExhausted;
                  const paOk      = trackingStatus.parcelsAppConfigured && !trackingStatus.parcelsAppQuotaExhausted;

                  const maerskPublicOk = trackingStatus.maerskPublicEnabled;

                  return (
                    <div className="space-y-1.5">
                      {/* 1. HTTP scraper (no browser) */}
                      <Row
                        testId="row-http-scraper"
                        label="1. HTTP scraper (no browser)"
                        badge="Ready"
                        badgeColor="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        detail="Direct carrier APIs — fastest, no quota. Fast-fails for Maersk/CMA."
                      />

                      {/* 2. Maersk public HTTP */}
                      <Row
                        testId="row-maersk-public"
                        label="2. Maersk public HTTP (no browser)"
                        badge={maerskPublicOk ? "Ready" : "Ready"}
                        badgeColor="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        detail="Maersk containers only — free, no API key, no quota"
                      />

                      {/* 3. Puppeteer web scraper */}
                      <Row
                        testId="row-scraper"
                        label="3. Puppeteer web scraper (no quota)"
                        badge={scraperOk ? "Ready" : "Unavailable"}
                        badgeColor={scraperOk
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground"}
                        detail={scraperOk
                          ? "Stealth Chrome — handles Maersk & CMA anti-bot protection"
                          : "Chrome not available in this environment"}
                      />

                      {/* 4. 17track */}
                      <Row
                        testId="row-17track"
                        label="4. 17track API"
                        badge={
                          !trackingStatus.seventeenTrackConfigured
                            ? "Not configured"
                            : trackingStatus.seventeenTrackQuotaExhausted
                              ? "Quota exhausted"
                              : "Ready"
                        }
                        badgeColor={
                          !trackingStatus.seventeenTrackConfigured
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                            : trackingStatus.seventeenTrackQuotaExhausted
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }
                        detailNode={
                          !trackingStatus.seventeenTrackConfigured ? (
                            <>
                              Free — 100 tracks/month.{" "}
                              <a
                                href="https://17track.net/en/api"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline text-primary"
                              >
                                Get API key
                              </a>
                              {" → add as "}
                              <span className="font-mono">SEVENTEENTRACK_API_KEY</span>
                            </>
                          ) : trackingStatus.seventeenTrackConfigured ? (
                            <>{trackingStatus.seventeenTrackUsageThisMonth} / {trackingStatus.seventeenTrackMonthlyLimit} used this month</>
                          ) : undefined
                        }
                      />

                      {/* 5. ParcelsApp API */}
                      <Row
                        testId="row-parcelsapp-api"
                        label="5. ParcelsApp API (fallback)"
                        badge={
                          !trackingStatus.parcelsAppConfigured
                            ? "Not configured"
                            : trackingStatus.parcelsAppQuotaExhausted
                              ? "Paused"
                              : "Ready"
                        }
                        badgeColor={
                          !trackingStatus.parcelsAppConfigured
                            ? "bg-muted text-muted-foreground"
                            : trackingStatus.parcelsAppQuotaExhausted
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }
                        detail={
                          trackingStatus.parcelsAppConfigured
                            ? trackingStatus.parcelsAppQuotaExhausted
                              ? `${trackingStatus.parcelsAppUsageThisMonth} / ${trackingStatus.parcelsAppMonthlyLimit} — resets ${trackingStatus.parcelsAppNextResetDate}`
                              : `${trackingStatus.parcelsAppRemaining} of ${trackingStatus.parcelsAppMonthlyLimit} remaining`
                            : undefined
                        }
                      />

                      {/* Alert if no useful provider is active */}
                      {!httpOk && !scraperOk && !stOk && !paOk && (
                        <div className="flex items-start gap-1.5 pt-1">
                          <span className="text-xs text-red-600 dark:text-red-400">
                            No active tracking provider — containers will not update automatically.
                            {" "}Quickest fix: get a free 17track API key above.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Scraper blocked warning — surface when last check used scraper but was blocked */}
                {trackingStatus.scraperAvailable && container?.trackingProvider === "parcelsapp_scraper" &&
                  container?.trackingError?.toLowerCase().includes("recaptcha") && (
                  <div className="flex items-start gap-1.5 pt-0.5" data-testid="banner-scraper-blocked">
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      reCaptcha detected automation on last scrape — 17track or ParcelsApp API used as fallback.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Smart priority panel — only shown for non-inactive containers */}
            {container && !isContainerInactive && (
              <div className="rounded-md border bg-muted/20 px-3 py-2.5 space-y-2" data-testid="panel-priority">
                {(() => {
                  const p = getContainerPriority(container);
                  const tierColor =
                    p.tier === "high"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : p.tier === "medium"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-muted text-muted-foreground";
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs font-medium text-muted-foreground">Scheduler priority</p>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${tierColor}`}
                          data-testid="badge-priority-tier"
                        >
                          {p.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid="text-priority-reason">
                        {p.reason}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid="text-priority-interval">
                        Minimum check interval: every {p.intervalHours}h
                      </p>
                      {container.trackingNextCheckAt && (
                        <p className="text-xs text-muted-foreground" data-testid="text-next-check">
                          Next scheduled check:{" "}
                          <span className="font-medium">
                            {new Date(container.trackingNextCheckAt).toLocaleString()}
                          </span>
                        </p>
                      )}
                      {container.trackingLastSkipReason && (
                        <p className="text-xs text-muted-foreground" data-testid="text-last-skip-reason">
                          Last skip reason:{" "}
                          <span className="font-medium">
                            {fmtSkipReason(container.trackingLastSkipReason)}
                          </span>
                        </p>
                      )}
                      {trackingStatus?.schedulerPerRunBudget !== undefined && (
                        <p className="text-xs text-muted-foreground" data-testid="text-scheduler-budget">
                          Budget this run: up to {trackingStatus.schedulerPerRunBudget} container
                          {trackingStatus.schedulerPerRunBudget !== 1 ? "s" : ""} per 6h cycle
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/70 italic" data-testid="text-scheduler-note">
                        The scheduler runs every Tuesday at 8:00 AM EST, but only runs live
                        tracking when it is due or high-priority to save ParcelsApp credits.
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Enabled</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={trackEnabled}
                    onCheckedChange={setTrackEnabled}
                    data-testid="switch-tracking-enabled"
                  />
                  <span className="text-sm">{trackEnabled ? "Yes" : "No"}</span>
                </div>
              </div>
              {trackEnabled && (
                <div className="space-y-1">
                  <Label className="text-xs">Auto Update</Label>
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      checked={trackAutoUpdate}
                      onCheckedChange={setTrackAutoUpdate}
                      data-testid="switch-tracking-auto-update"
                    />
                    <span className="text-sm">{trackAutoUpdate ? "Every 6h" : "Manual"}</span>
                  </div>
                </div>
              )}
            </div>

            {trackEnabled && (
              <div className="space-y-1">
                <Label className="text-xs">Destination country hint</Label>
                <Input
                  placeholder="e.g. Democratic Republic of the Congo"
                  value={trackCarrierHint}
                  onChange={(e) => setTrackCarrierHint(e.target.value)}
                  data-testid="input-tracking-carrier-hint"
                />
                <p className="text-xs text-muted-foreground">
                  Used when direct carrier tracking is unavailable. Leave blank to use default.
                </p>
              </div>
            )}

            {/* Last tracking result */}
            {container && (container.trackingLastStatus || container.trackingError) && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last Result</p>
                  {/* Provider badge */}
                  {container.trackingProvider && (
                    <span
                      data-testid="badge-tracking-provider"
                      className={
                        container.trackingProvider === "maersk"
                          ? "text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                          : container.trackingProvider === "maersk_public"
                            ? "text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                            : container.trackingProvider === "cma_public"
                              ? "text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                              : "text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      }
                    >
                      {container.trackingProvider === "maersk"
                        ? "Maersk official"
                        : container.trackingProvider === "maersk_public"
                          ? "Maersk public"
                          : container.trackingProvider === "cma_public"
                            ? "CMA public"
                            : "ParcelsApp"}
                    </span>
                  )}
                </div>

                {/* Detected carrier */}
                {container.trackingDetectedCarrier && (
                  <p className="text-xs text-muted-foreground" data-testid="text-detected-carrier">
                    Carrier detected: <span className="font-medium">{container.trackingDetectedCarrier}</span>
                  </p>
                )}

                {/* Fallback note — only show when a fallback was actually used and it wasn't maersk_direct (which is the primary method now) */}
                {container.trackingFallbackUsed && container.trackingProvider !== "maersk_direct" && (
                  <div
                    className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1.5"
                    data-testid="banner-tracking-fallback"
                  >
                    <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0 mt-px" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {(() => {
                        const r = container.trackingFallbackReason;
                        if (!r) return "Fallback provider used";
                        if (r.startsWith("maersk_")) return "Maersk direct tracking failed — used ParcelsApp fallback";
                        if (r.startsWith("cma_")) return "CMA tracking failed — used ParcelsApp fallback";
                        if (r === "parcelsapp_quota_exhausted")
                          return "ParcelsApp monthly quota exhausted — web scraper or 17track used";
                        if (r === "scraper_blocked")
                          return "Web scraper blocked — fell back to 17track or ParcelsApp API";
                        if (r === "17track_quota_exhausted")
                          return "17track monthly quota exhausted — fell back to ParcelsApp API";
                        if (r === "17track_error")
                          return "17track failed — fell back to ParcelsApp API";
                        return `Fallback used: ${r}`;
                      })()}
                    </p>
                  </div>
                )}

                {container.trackingLastCheckedAt && (
                  <p className="text-xs text-muted-foreground">
                    Checked: {new Date(container.trackingLastCheckedAt).toLocaleString()}
                  </p>
                )}
                {container.trackingLastStatus && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Status: </span>
                    <span className="font-medium">{container.trackingLastStatus}</span>
                  </p>
                )}
                {container.trackingLastDescription && (
                  <p className="text-xs text-muted-foreground">{container.trackingLastDescription}</p>
                )}
                {container.trackingError && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    Error: {container.trackingError}
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveTrackingSettings}
                disabled={trackingSettingsMutation.isPending}
                data-testid="button-save-tracking-settings"
              >
                {trackingSettingsMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save Settings
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => trackNowMutation.mutate()}
                disabled={trackNowMutation.isPending || isContainerInactive}
                title={isContainerInactive ? "Tracking is disabled for offloaded/closed/completed containers" : undefined}
                data-testid="button-track-now"
              >
                {trackNowMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                Track Now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowEvents((v) => !v)}
                data-testid="button-view-events"
              >
                <History className="h-3.5 w-3.5 mr-1" />
                {showEvents ? "Hide Events" : "View Events"}
              </Button>
            </div>

            {/* Live tracking progress feed */}
            {(trackNowMutation.isPending || trackProgress.length > 0) && (
              <div className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {trackNowMutation.isPending ? "Tracking in progress\u2026" : "Tracking complete"}
                  </p>
                  {!trackNowMutation.isPending && (
                    <button
                      onClick={() => setTrackProgress([])}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Dismiss"
                      data-testid="button-dismiss-progress"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {trackProgress.length === 0 && trackNowMutation.isPending && (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                    <span className="text-xs text-muted-foreground">Starting up\u2026</span>
                  </div>
                )}
                {trackProgress.map((step, i) => (
                  <div key={i} className="flex items-start gap-2" data-testid={`progress-step-${i}`}>
                    {step.status === "running" ? (
                      <Loader2 className="h-3 w-3 animate-spin text-blue-500 mt-0.5 shrink-0" />
                    ) : step.status === "success" ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                    ) : step.status === "blocked" ? (
                      <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                    ) : step.status === "skip" ? (
                      <Clock className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className={`text-xs${step.status === "success" ? " font-medium" : ""}`}>
                        {step.label}
                      </span>
                      {step.detail && (
                        <p className="text-[11px] text-muted-foreground leading-snug">{step.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Inline events list */}
            {showEvents && (
              <div className="rounded-md border overflow-hidden">
                <div className="px-3 py-2 bg-muted/40 border-b">
                  <p className="text-xs font-semibold">Tracking History</p>
                </div>
                {eventsLoading ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                    Loading events…
                  </div>
                ) : !events || events.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">
                    No tracking events recorded yet.
                  </div>
                ) : (
                  <div className="divide-y max-h-64 overflow-y-auto">
                    {events.map((ev: any) => (
                      <div key={ev.id} className="px-3 py-2 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">{ev.eventStatus ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">
                            {ev.eventTime ? new Date(ev.eventTime).toLocaleDateString() : "—"}
                          </span>
                        </div>
                        {ev.eventLocation && (
                          <p className="text-xs text-muted-foreground">{ev.eventLocation}</p>
                        )}
                        {ev.eventDescription && (
                          <p className="text-xs text-muted-foreground truncate">{ev.eventDescription}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Save / Cancel ── */}
          <div className="flex gap-2 pt-1 pb-4">
            {canEdit ? (
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={mutation.isPending}
                data-testid="button-drawer-save"
              >
                {mutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            ) : (
              <Button
                className="flex-1"
                disabled
                data-testid="button-drawer-save-disabled"
              >
                Switch Company to Edit
              </Button>
            )}
            <Button
              variant="outline"
              onClick={onClose}
              data-testid="button-drawer-cancel"
            >
              Cancel
            </Button>
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Multi-select filter dropdown ─────────────────────────────────────────────
interface MultiOption { value: string; label: string; dividerBefore?: boolean }

function MultiFilterSelect({
  allLabel,
  options,
  selected,
  onChange,
  testId,
}: {
  allLabel: string;
  options: MultiOption[];
  selected: string[];
  onChange: (vals: string[]) => void;
  testId?: string;
}) {
  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]);
  };

  const triggerLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs w-full justify-between font-normal px-2"
          data-testid={testId}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 ml-1 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        <div className="max-h-56 overflow-y-auto">
          {options.map((opt) => (
            <div key={opt.value}>
              {opt.dividerBefore && <div className="border-t my-1" />}
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover-elevate text-xs"
                onClick={() => toggle(opt.value)}
              >
                <Checkbox
                  checked={selected.includes(opt.value)}
                  onCheckedChange={() => toggle(opt.value)}
                  className="h-3 w-3 shrink-0"
                />
                <span>{opt.label}</span>
              </div>
            </div>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="border-t mt-1 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-full text-xs text-muted-foreground"
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function GITContainers({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });

  const [allCompanies, setAllCompanies] = useState(false);
  const [companyFilter, setCompanyFilter] = useState("ALL");
  const [transporterFilters, setTransporterFilters] = useState<string[]>([]);
  const [agentFilters, setAgentFilters] = useState<string[]>([]);
  const [truckFilters, setTruckFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [docsFilter, setDocsFilter] = useState("ALL");
  const [delayedFilter, setDelayedFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState("DEFAULT");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContainer, setDrawerContainer] = useState<EnrichedContainerRow | null>(null);
  const [importResult, setImportResult] = useState<{ updated: number; skipped: number; notFound: number; errors: string[] } | null>(null);
  const [waSending, setWaSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printRef     = useRef<HTMLDivElement>(null);
  const queryClient  = useQueryClient();

  const role = user?.role;
  const isAllowed = !!role && ["Admin", "Developer", "Owner"].includes(role);
  const isDevMode = import.meta.env.DEV;

  const queryUrl = allCompanies
    ? "/api/git/containers?allCompanies=true"
    : "/api/git/containers";

  const { data, isLoading, isError, error, refetch } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    enabled: !!isAllowed,
  });

  const allContainers = data?.containers ?? [];

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/git/containers/import-excel", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Import failed" }));
        throw new Error(err.message || "Import failed");
      }
      return res.json() as Promise<{ updated: number; skipped: number; notFound: number; errors: string[] }>;
    },
    onSuccess: (result) => {
      setImportResult(result);
      refetch();
      toast({
        title: `Import complete — ${result.updated} container${result.updated !== 1 ? "s" : ""} updated`,
        description: result.errors.length > 0 ? `${result.errors.length} row(s) had issues — see details.` : undefined,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    importMutation.mutate(file);
    e.target.value = "";
  }

  const bulkEnableMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest("POST", "/api/container-tracking/bulk-settings", { trackingEnabled: enabled });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed");
      }
      return res.json() as Promise<{ updated: number; trackingEnabled: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [queryUrl] });
      toast({
        title: data.trackingEnabled
          ? `Auto-tracking enabled for ${data.updated} containers`
          : `Auto-tracking disabled for ${data.updated} containers`,
      });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const bulkTrackMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/container-tracking/bulk-track-now", {}, false, 120000);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message || "Failed");
      }
      return res.json() as Promise<{ queued: number; message: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: data.queued === 0 ? "No containers to track" : `Tracking started`,
        description: data.message,
      });
      if (data.queued > 0) {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: [queryUrl] }), 20_000);
      }
    },
    onError: (err: any) => toast({ title: "Track All failed", description: err.message, variant: "destructive" }),
  });

  const trackingEnabledCount = allContainers.filter((c) => c.trackingEnabled).length;

  const filtered = useMemo(() => {
    return allContainers.filter((c) => {
      if (companyFilter !== "ALL" && c.companyName !== companyFilter) return false;
      if (transporterFilters.length > 0 && !transporterFilters.includes(c.transporter ?? "")) return false;
      if (agentFilters.length > 0 && !agentFilters.includes(c.agent ?? "")) return false;
      if (truckFilters.length > 0) {
        const plate = (c.numberPlate ?? "").trim();
        const match = truckFilters.some((f) => {
          if (f === "HAS_TRUCK") return !!plate;
          if (f === "NO_TRUCK") return !plate;
          return plate === f;
        });
        if (!match) return false;
      }
      if (locationFilters.length > 0) {
        const loc = (c.trackingLocation ?? "").trim();
        const match = locationFilters.some((f) => {
          if (f === "HAS_LOCATION") return !!loc;
          if (f === "NO_LOCATION") return !loc;
          return loc === f;
        });
        if (!match) return false;
      }
      if (docsFilter === "MISSING" && c.docReceived) return false;
      if (docsFilter === "RECEIVED" && !c.docReceived) return false;
      if (delayedFilter === "YES" && !(c.daysDelayed && c.daysDelayed > 0)) return false;
      if (delayedFilter === "OVERDUE" && !c.isOverdue) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.containerNumber.toLowerCase().includes(q) &&
          !(c.companyName ?? "").toLowerCase().includes(q) &&
          !(c.numberPlate ?? "").toLowerCase().includes(q) &&
          !(c.transporter ?? "").toLowerCase().includes(q) &&
          !(c.agent ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortOrder === "ETA_ASC" || sortOrder === "ETA_DESC") {
        const aMs = a.eta ? new Date(a.eta).getTime() : (sortOrder === "ETA_ASC" ? Infinity : -Infinity);
        const bMs = b.eta ? new Date(b.eta).getTime() : (sortOrder === "ETA_ASC" ? Infinity : -Infinity);
        if (aMs !== bMs) return sortOrder === "ETA_ASC" ? aMs - bMs : bMs - aMs;
      }
      const co = a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" });
      if (co !== 0) return co;
      const sh = (a.shopName ?? "").localeCompare(b.shopName ?? "", undefined, { numeric: true, sensitivity: "base" });
      if (sh !== 0) return sh;
      return a.containerNumber.localeCompare(b.containerNumber);
    });
  }, [allContainers, companyFilter, transporterFilters, agentFilters, truckFilters, locationFilters, docsFilter, delayedFilter, sortOrder, search]);

  // Summary stats — follow the active filters so they match what's visible in the table
  const atSea          = filteredContainers.filter((c) => c.status === "OTW" || c.status === "Sea").length;
  const atPort         = filteredContainers.filter((c) => c.status === "At Port").length;
  const leftDar        = filteredContainers.filter((c) => c.status === "Left Dar").length;
  const inTransit      = filteredContainers.filter((c) => ["At Border", "In Transit"].includes(c.status)).length;
  const arrived        = filteredContainers.filter((c) => c.status === "Arrived").length;
  const delayed        = filteredContainers.filter((c) => c.daysDelayed !== null && c.daysDelayed > 0).length;
  const offloadOverdue = filteredContainers.filter((c) => c.isOverdue).length;
  const totalCost      = filteredContainers.reduce((s, c) => s + parseNum(c.grandTotal), 0);
  const totalTransport = filteredContainers.reduce((s, c) => s + parseNum(c.transportFee), 0);
  const totalDuty      = filteredContainers.reduce((s, c) => s + parseNum(c.dutyFee), 0);

  const companies   = [...new Set(allContainers.map((c) => c.companyName))].sort();
  const transporters = [...new Set(allContainers.map((c) => c.transporter).filter(Boolean))].sort() as string[];
  const agents      = [...new Set(allContainers.map((c) => c.agent).filter(Boolean))].sort() as string[];
  const trucks      = [...new Set(allContainers.map((c) => c.numberPlate).filter(Boolean))].sort() as string[];
  const locations   = [...new Set(allContainers.map((c) => c.trackingLocation).filter(Boolean))].sort() as string[];

  function openDrawer(c: EnrichedContainerRow) {
    setDrawerContainer(c);
    setDrawerOpen(true);
  }

  function clearFilters() {
    setCompanyFilter("ALL");
    setTransporterFilters([]);
    setAgentFilters([]);
    setTruckFilters([]);
    setLocationFilters([]);
    setDocsFilter("ALL");
    setDelayedFilter("ALL");
    setSortOrder("DEFAULT");
    setSearch("");
  }

  async function sendToWhatsApp() {
    if (!printRef.current) return;
    setWaSending(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const el = printRef.current;
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#0f172a",
        logging: false,
        width: el.scrollWidth,
        height: el.scrollHeight,
        windowWidth: el.scrollWidth,
        windowHeight: el.scrollHeight,
      });
      const imageBase64 = canvas.toDataURL("image/png");
      const today = new Date().toISOString().substring(0, 10);
      await apiRequest("POST", "/api/git/send-containers-whatsapp", {
        imageBase64,
        fileName: `ContainersOTW_${today}.png`,
      });
      toast({ title: "Sent", description: "Container report sent to WhatsApp group." });
    } catch (err: any) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  }

  // ── Access denied ──
  if (user && !isAllowed) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {!embedded && <PageHeader title="Containers OTW" subtitle="Active container logistics and tracking" />}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm font-medium">Access Restricted</p>
            <p className="text-xs text-muted-foreground">
              This page is available to Admin, Developer, and Owner roles only.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (!user || isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {!embedded && <PageHeader title="Containers OTW" subtitle="Active container logistics and tracking" />}
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading containers…</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (isError) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {!embedded && <PageHeader title="Containers OTW" subtitle="Active container logistics and tracking" />}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="text-sm font-medium">Failed to load containers</p>
            <p className="text-xs text-muted-foreground">
              {(error as any)?.message ?? "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Session company ID — for multi-company drawer edit gating
  const sessionCompanyId = (data?.mode === "single" && data.companyId) ? data.companyId : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!embedded && (
        <PageHeader
          title="Containers OTW"
          subtitle="Active container logistics and tracking"
        />
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Company Mode ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setAllCompanies(false); setCompanyFilter("ALL"); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              !allCompanies
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover-elevate",
            )}
            data-testid="button-my-company"
          >
            <Building2 className="h-3.5 w-3.5" />
            My Company
          </button>
          <button
            onClick={() => { setAllCompanies(true); setCompanyFilter("ALL"); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
              allCompanies
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border text-muted-foreground hover-elevate",
            )}
            data-testid="button-all-companies"
          >
            <Globe className="h-3.5 w-3.5" />
            All Accessible Companies
          </button>
          {data && (
            <span className="text-xs text-muted-foreground ml-1">
              {data.total} active container{data.total !== 1 ? "s" : ""}
              {data.mode === "single" && data.companyName ? ` — ${data.companyName}` : ""}
            </span>
          )}
        </div>

        {/* ── Summary Cards ── */}
        <div className="flex flex-wrap gap-2">
          <SummaryCard label="Active" value={filteredContainers.length} icon={<Package className="h-4 w-4 text-primary" />} accent="bg-primary/10" />
          {atSea > 0 && <SummaryCard label="At Sea / OTW" value={atSea} icon={<Ship className="h-4 w-4 text-blue-600" />} accent="bg-blue-100 dark:bg-blue-900/30" />}
          {atPort > 0 && <SummaryCard label="At Port" value={atPort} icon={<Package className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />}
          {leftDar > 0 && <SummaryCard label="Left Dar" value={leftDar} icon={<Truck className="h-4 w-4 text-violet-600" />} accent="bg-violet-100 dark:bg-violet-900/30" />}
          {inTransit > 0 && <SummaryCard label="In Transit" value={inTransit} icon={<Truck className="h-4 w-4 text-indigo-600" />} accent="bg-indigo-100 dark:bg-indigo-900/30" />}
          {arrived > 0 && <SummaryCard label="Arrived" value={arrived} icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />}
          {delayed > 0 && <SummaryCard label="Delayed" value={delayed} icon={<Clock className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />}
          {offloadOverdue > 0 && <SummaryCard label="Offload Overdue" value={offloadOverdue} icon={<AlertTriangle className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />}
          <SummaryCard label="Container Cost" value={`$${fmt(totalCost)}`} icon={<DollarSign className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />
          <SummaryCard label="Transport + Duty" value={`$${fmt(totalTransport + totalDuty)}`} icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} />
        </div>


        {/* ── Search + Filters Toggle ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search container #, company, truck, transporter, agent…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-otw-search"
            />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={() => setShowFilters((v) => !v)}
            data-testid="button-otw-filters"
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
            <ChevronDown className={cn("h-3.5 w-3.5 ml-1 transition-transform", showFilters && "rotate-180")} />
          </Button>

          {/* ── Send to WhatsApp ── */}
          {isAllowed && (
            <Button
              variant="outline"
              size="default"
              onClick={sendToWhatsApp}
              disabled={waSending || filtered.length === 0}
              data-testid="button-send-wa-containers"
            >
              {waSending
                ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                : <MessageCircle className="h-4 w-4 mr-1.5" />}
              {waSending ? "Sending…" : "Send to WhatsApp"}
            </Button>
          )}

          {/* ── Track All Now — visible standalone button ── */}
          {isAllowed && (
            <Button
              variant="outline"
              size="default"
              onClick={() => bulkTrackMutation.mutate()}
              disabled={bulkTrackMutation.isPending || allContainers.length === 0}
              data-testid="button-track-all-now"
            >
              {bulkTrackMutation.isPending
                ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                : <RefreshCw className="h-4 w-4 mr-1.5" />}
              {bulkTrackMutation.isPending ? "Tracking…" : `Track All${trackingEnabledCount > 0 ? ` (${trackingEnabledCount})` : ""}`}
            </Button>
          )}

          {/* Hidden file input for Excel import — always present so the ref works */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-import-excel"
          />

          {/* ── Actions dropdown — dev mode only ── */}
          {isDevMode && isAllowed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="default" data-testid="button-actions-menu">
                  Actions
                  <ChevronDown className="h-3.5 w-3.5 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <a
                    href="/api/git/containers/import-template.xlsx"
                    download
                    className="flex items-center gap-2 cursor-pointer"
                    data-testid="link-download-template"
                  >
                    <Download className="h-4 w-4" />
                    Template
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importMutation.isPending}
                  data-testid="button-import-excel"
                  className="gap-2"
                >
                  {importMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Upload className="h-4 w-4" />}
                  Import Excel
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => bulkEnableMutation.mutate(trackingEnabledCount < allContainers.length)}
                  disabled={bulkEnableMutation.isPending || allContainers.length === 0}
                  data-testid="button-bulk-enable-tracking"
                  className="gap-2"
                >
                  {bulkEnableMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Satellite className="h-4 w-4" />}
                  {trackingEnabledCount === allContainers.length && allContainers.length > 0
                    ? `Disable All Tracking (${trackingEnabledCount}/${allContainers.length})`
                    : `Enable All Tracking (${trackingEnabledCount}/${allContainers.length})`}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => bulkTrackMutation.mutate()}
                  disabled={bulkTrackMutation.isPending || allContainers.length === 0}
                  data-testid="button-bulk-track-now"
                  className="gap-2"
                >
                  {bulkTrackMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                  Track All Now
                  {trackingEnabledCount > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto">({trackingEnabledCount})</span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* ── Import result banner (inline, dismissible) ── */}
        {importResult && (
          <div className={cn(
            "rounded-md border p-3 space-y-2",
            importResult.updated > 0
              ? "border-green-300 bg-green-50 dark:bg-green-950/20 dark:border-green-800"
              : "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800",
          )}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {importResult.updated > 0
                  ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  : <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                }
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={cn(
                    "text-sm font-semibold",
                    importResult.updated > 0 ? "text-green-800 dark:text-green-300" : "text-amber-800 dark:text-amber-300",
                  )}>
                    {importResult.updated > 0 ? "Import complete" : "Import finished — no rows updated"}
                  </span>
                  <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                    {importResult.updated} updated
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {importResult.skipped} skipped
                  </span>
                  {importResult.notFound > 0 && (
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                      {importResult.notFound} not found
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => setImportResult(null)}
                data-testid="button-dismiss-import-result"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            {importResult.updated === 0 && importResult.notFound > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300 pl-6">
                Container numbers in your file did not match any containers in the system. Check that the <strong>Container #</strong> column matches exactly (including spacing and capitalisation).
              </p>
            )}

            {importResult.updated === 0 && importResult.skipped > 0 && importResult.notFound === 0 && importResult.errors.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300 pl-6">
                All rows were skipped. Make sure your file uses the correct column headers — download the <strong>Template</strong> as a reference.
              </p>
            )}

            {importResult.errors.length > 0 && (
              <div className="pl-6 space-y-0.5 max-h-40 overflow-y-auto">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-1">
                  Row details ({importResult.errors.length})
                </p>
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300 font-mono">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Expandable Filters ── */}
        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-2 p-3 rounded-md border bg-muted/30">
            {allCompanies && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Company
                </p>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-otw-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Companies</SelectItem>
                    {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Transporter</p>
              <MultiFilterSelect
                allLabel="All Transporters"
                options={transporters.map((t) => ({ value: t, label: t }))}
                selected={transporterFilters}
                onChange={setTransporterFilters}
                testId="select-otw-transporter"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Agent / Declarant</p>
              <MultiFilterSelect
                allLabel="All Agents"
                options={agents.map((a) => ({ value: a, label: a }))}
                selected={agentFilters}
                onChange={setAgentFilters}
                testId="select-otw-agent"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Truck #</p>
              <MultiFilterSelect
                allLabel="All Trucks"
                options={[
                  { value: "HAS_TRUCK", label: "Has Truck #" },
                  { value: "NO_TRUCK", label: "No Truck #" },
                  ...trucks.map((t, i) => ({ value: t, label: t, dividerBefore: i === 0 })),
                ]}
                selected={truckFilters}
                onChange={setTruckFilters}
                testId="select-otw-truck"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Location</p>
              <MultiFilterSelect
                allLabel="All Locations"
                options={[
                  { value: "HAS_LOCATION", label: "Has Location" },
                  { value: "NO_LOCATION", label: "No Location" },
                  ...locations.map((l, i) => ({ value: l, label: l, dividerBefore: i === 0 })),
                ]}
                selected={locationFilters}
                onChange={setLocationFilters}
                testId="select-otw-location"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Docs</p>
              <Select value={docsFilter} onValueChange={setDocsFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-otw-docs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="MISSING">Docs Missing</SelectItem>
                  <SelectItem value="RECEIVED">Docs Received</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Delay / Overdue</p>
              <Select value={delayedFilter} onValueChange={setDelayedFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-otw-delayed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="YES">Delayed only</SelectItem>
                  <SelectItem value="OVERDUE">Offload Overdue</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sort by ETA</p>
              <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-otw-sort">
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
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={clearFilters}
                data-testid="button-otw-clear"
              >
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* ── Results count + Legend ── */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {allContainers.length} active containers — click a row to edit
          </p>
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-red-200 dark:bg-red-900/40" />
              Offload Overdue
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-sm bg-rose-200 dark:bg-rose-900/40" />
              Docs Missing — At Port
            </span>
          </div>
        </div>

        {/* ── Main Table ── */}
        <div className="rounded-md border overflow-x-auto">
          <Table className="text-xs whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Container #</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Shop Name</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Truck #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Border Date</TableHead>
                <TableHead>Max Offload</TableHead>
                <TableHead>Delayed</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Docs Sent</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead className="text-right">Transport Fee</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Duty Fee</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                    {allContainers.length === 0
                      ? "No active containers found."
                      : "No containers match the current filters."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c, i) => {
                  const statusMeta = STATUS_META[c.status] ?? STATUS_META["Closed"];
                  const rowBg = c.isOverdue
                    ? "bg-red-50/50 dark:bg-red-950/20"
                    : !c.docReceived && c.status === "At Port"
                    ? "bg-rose-50/50 dark:bg-rose-950/20"
                    : "";

                  return (
                    <TableRow
                      key={c.id}
                      className={cn("cursor-pointer", rowBg)}
                      onClick={() => openDrawer(c)}
                      data-testid={`row-container-${c.id}`}
                    >
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{c.containerNumber}</TableCell>
                      <TableCell>{c.supplierName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{c.companyName}</TableCell>
                      <TableCell>{c.shopName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell><EtaCell container={c} fmtDate={fmtDate} /></TableCell>
                      <TableCell className="text-right font-medium">
                        {c.grandTotal ? `$${fmt(parseNum(c.grandTotal))}` : "—"}
                      </TableCell>
                      <TableCell>
                        {c.numberPlate
                          ? <span className="font-mono">{c.numberPlate}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.trackingLocation ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{fmtDate(c.borderDate)}</TableCell>
                      <TableCell className={c.isOverdue ? "text-red-600 font-medium" : ""}>
                        {fmtDate(c.maxOffloadDate)}
                      </TableCell>
                      <TableCell>
                        {c.daysDelayed && c.daysDelayed > 0
                          ? <span className="text-red-600 font-medium">+{c.daysDelayed}d</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.docReceived
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      </TableCell>
                      <TableCell>{fmtDate(c.docsSentDate)}</TableCell>
                      <TableCell>
                        {c.transporter ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.transportFee ? `$${fmt(parseNum(c.transportFee))}` : "—"}
                      </TableCell>
                      <TableCell>
                        {c.agent ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.dutyFee ? `$${fmt(parseNum(c.dutyFee))}` : "—"}
                      </TableCell>
                      <TableCell className="max-w-28 truncate text-muted-foreground">
                        {c.trackingDescription ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => { e.stopPropagation(); openDrawer(c); }}
                          data-testid={`button-edit-container-${c.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

      </div>

      <ContainerDrawer
        container={drawerContainer}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        queryKey={queryUrl}
        sessionCompanyId={sessionCompanyId}
      />

      {/* ── Hidden Full-HD print template for WhatsApp image capture ── */}
      <div
        ref={printRef}
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          backgroundColor: "#0d1117",
          color: "#e6edf3",
          fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
          fontSize: "14px",
          width: "1920px",
          padding: "32px 36px 28px",
          boxSizing: "border-box",
        }}
        aria-hidden="true"
      >
        {/* ── Header bar ── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "2px solid #21262d",
        }}>
          <div>
            <div style={{ fontSize: "26px", fontWeight: 800, color: "#e6edf3", letterSpacing: "-0.5px" }}>
              HMD International Group
            </div>
            <div style={{ fontSize: "15px", fontWeight: 500, color: "#3b82f6", marginTop: "3px", letterSpacing: "0.3px" }}>
              CONTAINERS ON THE WAY — LIVE TRACKING REPORT
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9" }}>
              {filtered.length} Container{filtered.length !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: "13px", color: "#8b949e", marginTop: "2px" }}>
              {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              {" · "}
              {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "40px" }} />
            <col style={{ width: "160px" }} />
            <col style={{ width: "160px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "180px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "160px" }} />
            <col style={{ width: "120px" }} />
            <col />
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: "#161b22" }}>
              {[
                { label: "#",            align: "center" as const },
                { label: "Container #",  align: "left"   as const },
                { label: "Supplier",     align: "left"   as const },
                { label: "Shop",         align: "left"   as const },
                { label: "Truck #",      align: "left"   as const },
                { label: "Location",     align: "left"   as const },
                { label: "ETA",          align: "left"   as const },
                { label: "Delay",        align: "center" as const },
                { label: "Status",       align: "left"   as const },
                { label: "Transporter",  align: "left"   as const },
                { label: "Agent",        align: "left"   as const },
                { label: "Notes",        align: "left"   as const },
              ].map((h) => (
                <th key={h.label} style={{
                  padding: "10px 8px",
                  textAlign: h.align,
                  color: "#58a6ff",
                  fontWeight: 700,
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                  borderBottom: "2px solid #30363d",
                }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const groups: { company: string; rows: EnrichedContainerRow[] }[] = [];
              for (const c of filtered) {
                const last = groups[groups.length - 1];
                if (last && last.company === c.companyName) last.rows.push(c);
                else groups.push({ company: c.companyName, rows: [c] });
              }
              let idx = 0;
              return groups.map((g) => [
                /* Company group header */
                <tr key={`grp-${g.company}`}>
                  <td colSpan={12} style={{
                    padding: "8px 10px",
                    backgroundColor: "#1f2937",
                    fontWeight: 700,
                    color: "#fbbf24",
                    fontSize: "13px",
                    letterSpacing: "0.3px",
                    borderTop: "1px solid #374151",
                    borderBottom: "1px solid #374151",
                  }}>
                    {g.company}
                    <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: "8px", fontSize: "12px" }}>
                      ({g.rows.length} container{g.rows.length !== 1 ? "s" : ""})
                    </span>
                  </td>
                </tr>,
                /* Data rows */
                ...g.rows.map((c, i) => {
                  idx++;
                  const rowBg = i % 2 === 0 ? "#0d1117" : "#161b22";
                  const etaDate = c.eta ? new Date(c.eta) : null;
                  let delayDays = 0;
                  if (etaDate && !isNaN(etaDate.getTime()) && !c.numberPlate) {
                    const t = new Date(); t.setHours(0, 0, 0, 0);
                    delayDays = Math.floor((t.getTime() - etaDate.getTime()) / 86400000);
                  }
                  const delayed = delayDays > 0 ? `+${delayDays}d` : "";

                  const cell: React.CSSProperties = {
                    padding: "9px 8px",
                    fontSize: "13px",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    borderBottom: "1px solid #21262d",
                    color: "#e6edf3",
                  };

                  return (
                    <tr key={c.id} style={{ backgroundColor: rowBg }}>
                      <td style={{ ...cell, textAlign: "center", color: "#6e7681", fontSize: "12px" }}>{idx}</td>
                      <td style={{ ...cell, fontFamily: "monospace", fontWeight: 700, color: "#79c0ff", fontSize: "13px" }}>{c.containerNumber}</td>
                      <td style={{ ...cell }}>{c.supplierName ?? "—"}</td>
                      <td style={{ ...cell }}>{c.shopName ?? "—"}</td>
                      <td style={{ ...cell, fontFamily: "monospace", color: "#d2a8ff" }}>{c.numberPlate ?? "—"}</td>
                      <td style={{ ...cell, color: "#7ee787" }}>{c.trackingLocation ?? "—"}</td>
                      <td style={{ ...cell, color: "#8b949e" }}>{c.eta ? c.eta.substring(0, 10) : "—"}</td>
                      <td style={{ ...cell, textAlign: "center", color: delayed ? "#f85149" : "#6e7681", fontWeight: delayed ? 700 : 400, fontSize: "13px" }}>{delayed || "—"}</td>
                      <td style={{ ...cell }}>{c.status}</td>
                      <td style={{ ...cell, color: "#ffa657" }}>{c.transporter ?? "—"}</td>
                      <td style={{ ...cell }}>{c.agent ?? "—"}</td>
                      <td style={{ ...cell, color: "#8b949e" }}>{c.trackingDescription ?? "—"}</td>
                    </tr>
                  );
                }),
              ]);
            })()}
          </tbody>
        </table>

        {/* ── Footer ── */}
        <div style={{
          marginTop: "20px",
          paddingTop: "12px",
          borderTop: "1px solid #21262d",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <div style={{ fontSize: "11px", color: "#6e7681" }}>
            HMD International Group — ERP System — Auto-generated report
          </div>
          <div style={{ fontSize: "11px", color: "#6e7681" }}>
            {new Date().toISOString().replace("T", " ").substring(0, 16)} UTC
          </div>
        </div>
      </div>

    </div>
  );
}
