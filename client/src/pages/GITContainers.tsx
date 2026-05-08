/**
 * Containers OTW — Operational active-container tracking page.
 * Real data from GET /api/git/containers.
 * Edit via PATCH /api/containers/:id/tracking.
 * Access: Admin, Developer, Owner only.
 */

import { useState, useMemo, useEffect } from "react";
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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRef } from "react";
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
  freightStatus: string;
  trackingLink: string;
  trackingDescription: string;
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
    freightStatus: c.freightStatus ?? "Pending",
    trackingLink: c.trackingLink ?? "",
    trackingDescription: c.trackingDescription ?? "",
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

  const trackNowMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/container-tracking/${container!.id}/track-now`, {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast({
        title: "Tracking refreshed",
        description: data?.lastStatus
          ? `Status: ${data.lastStatus}${data.lastLocation ? ` — ${data.lastLocation}` : ""}`
          : "Tracking data updated.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Track Now failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const eventsQueryKey = container?.id ? `/api/container-tracking/${container.id}/events` : null;
  const { data: events, isLoading: eventsLoading } = useQuery<any[]>({
    queryKey: [eventsQueryKey],
    enabled: showEvents && !!eventsQueryKey,
    staleTime: 30_000,
  });

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
      freightStatus: form.freightStatus || null,
      trackingLink: form.trackingLink || null,
      trackingDescription: form.trackingDescription || null,
    });
  }

  if (!container || !form) return null;

  const transUpper = form.transporter.toUpperCase();
  const transLabel = transUpper.includes("FARHAT") || transUpper.includes("CONTINENTAL")
    ? "(+11d)" : form.transporter ? "(+14d)" : "";

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
                <p className="text-xs text-muted-foreground">Docs Ready / Not Sent</p>
                <p className="text-sm font-medium">
                  {container.docsReadyNotSent
                    ? <span className="text-amber-600">Yes</span>
                    : <span className="text-muted-foreground">—</span>}
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

          {/* ── Status + Freight Status ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v)}
                disabled={!canEdit}
              >
                <SelectTrigger data-testid="select-drawer-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Freight Status</Label>
              <Select
                value={form.freightStatus}
                onValueChange={(v) => set("freightStatus", v)}
                disabled={!canEdit}
              >
                <SelectTrigger data-testid="select-drawer-freight">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

          {/* ── Auto Tracking (ParcelsApp) ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Satellite className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Auto Tracking
              </p>
            </div>

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
                <Label className="text-xs">Destination Country (hint)</Label>
                <Input
                  placeholder="e.g. Democratic Republic of the Congo"
                  value={trackCarrierHint}
                  onChange={(e) => setTrackCarrierHint(e.target.value)}
                  data-testid="input-tracking-carrier-hint"
                />
                <p className="text-xs text-muted-foreground">
                  Helps ParcelsApp resolve the correct carrier. Leave blank to use default.
                </p>
              </div>
            )}

            {/* Last tracking result */}
            {container && (container.trackingLastStatus || container.trackingLastLocation || container.trackingError) && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last Result</p>
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
                {container.trackingLastLocation && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Location: </span>
                    <span className="font-medium">{container.trackingLastLocation}</span>
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
                disabled={trackNowMutation.isPending}
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

export default function GITContainers() {
  const { data: user } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });

  const [allCompanies, setAllCompanies] = useState(false);
  const [companyFilter, setCompanyFilter] = useState("ALL");
  const [transporterFilter, setTransporterFilter] = useState("ALL");
  const [agentFilter, setAgentFilter] = useState("ALL");
  const [docsFilter, setDocsFilter] = useState("ALL");
  const [delayedFilter, setDelayedFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContainer, setDrawerContainer] = useState<EnrichedContainerRow | null>(null);
  const [importResult, setImportResult] = useState<{ updated: number; skipped: number; notFound: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const role = user?.role;
  const isAllowed = !!role && ["Admin", "Developer", "Owner"].includes(role);

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

  const filtered = useMemo(() => {
    return allContainers.filter((c) => {
      if (companyFilter !== "ALL" && c.companyName !== companyFilter) return false;
      if (transporterFilter !== "ALL" && c.transporter !== transporterFilter) return false;
      if (agentFilter !== "ALL" && c.agent !== agentFilter) return false;
      if (docsFilter === "MISSING" && c.docReceived) return false;
      if (docsFilter === "RECEIVED" && !c.docReceived) return false;
      if (docsFilter === "READY_NOT_SENT" && !c.docsReadyNotSent) return false;
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
      const co = a.companyName.localeCompare(b.companyName, undefined, { sensitivity: "base" });
      if (co !== 0) return co;
      const sh = (a.shopName ?? "").localeCompare(b.shopName ?? "", undefined, { numeric: true, sensitivity: "base" });
      if (sh !== 0) return sh;
      return a.containerNumber.localeCompare(b.containerNumber);
    });
  }, [allContainers, chipFilter, companyFilter, transporterFilter, agentFilter, docsFilter, delayedFilter, search]);

  // Summary stats (always over all loaded active containers)
  const atSea          = allContainers.filter((c) => c.status === "OTW" || c.status === "Sea").length;
  const atPort         = allContainers.filter((c) => c.status === "At Port").length;
  const leftDar        = allContainers.filter((c) => c.status === "Left Dar").length;
  const inTransit      = allContainers.filter((c) => ["At Border", "In Transit"].includes(c.status)).length;
  const arrived        = allContainers.filter((c) => c.status === "Arrived").length;
  const delayed        = allContainers.filter((c) => c.daysDelayed !== null && c.daysDelayed > 0).length;
  const docsReadyNS    = allContainers.filter((c) => c.docsReadyNotSent).length;
  const offloadOverdue = allContainers.filter((c) => c.isOverdue).length;
  const totalCost      = allContainers.reduce((s, c) => s + parseNum(c.grandTotal), 0);
  const totalTransport = allContainers.reduce((s, c) => s + parseNum(c.transportFee), 0);
  const totalDuty      = allContainers.reduce((s, c) => s + parseNum(c.dutyFee), 0);

  const companies   = [...new Set(allContainers.map((c) => c.companyName))].sort();
  const transporters = [...new Set(allContainers.map((c) => c.transporter).filter(Boolean))].sort() as string[];
  const agents      = [...new Set(allContainers.map((c) => c.agent).filter(Boolean))].sort() as string[];

  function openDrawer(c: EnrichedContainerRow) {
    setDrawerContainer(c);
    setDrawerOpen(true);
  }

  function clearFilters() {
    setCompanyFilter("ALL");
    setTransporterFilter("ALL");
    setAgentFilter("ALL");
    setDocsFilter("ALL");
    setDelayedFilter("ALL");
    setSearch("");
  }

  // ── Access denied ──
  if (user && !isAllowed) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Containers OTW" subtitle="Active container logistics and tracking" />
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
        <PageHeader title="Containers OTW" subtitle="Active container logistics and tracking" />
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
        <PageHeader title="Containers OTW" subtitle="Active container logistics and tracking" />
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
      <PageHeader
        title="Containers OTW"
        subtitle="Active container logistics and tracking"
      />

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
          <SummaryCard label="Active" value={allContainers.length} icon={<Package className="h-4 w-4 text-primary" />} accent="bg-primary/10" />
          {atSea > 0 && <SummaryCard label="At Sea / OTW" value={atSea} icon={<Ship className="h-4 w-4 text-blue-600" />} accent="bg-blue-100 dark:bg-blue-900/30" />}
          {atPort > 0 && <SummaryCard label="At Port" value={atPort} icon={<Package className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />}
          {leftDar > 0 && <SummaryCard label="Left Dar" value={leftDar} icon={<Truck className="h-4 w-4 text-violet-600" />} accent="bg-violet-100 dark:bg-violet-900/30" />}
          {inTransit > 0 && <SummaryCard label="In Transit" value={inTransit} icon={<Truck className="h-4 w-4 text-indigo-600" />} accent="bg-indigo-100 dark:bg-indigo-900/30" />}
          {arrived > 0 && <SummaryCard label="Arrived" value={arrived} icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />}
          {delayed > 0 && <SummaryCard label="Delayed" value={delayed} icon={<Clock className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />}
          {docsReadyNS > 0 && <SummaryCard label="Docs Ready / Unsent" value={docsReadyNS} icon={<FileX className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />}
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

          {/* Excel import controls */}
          <a
            href="/api/git/containers/import-template.xlsx"
            download
            data-testid="link-download-template"
          >
            <Button variant="outline" size="default" type="button">
              <Download className="h-4 w-4 mr-1" />
              Template
            </Button>
          </a>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-import-excel"
          />
          <Button
            variant="outline"
            size="default"
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            data-testid="button-import-excel"
          >
            {importMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Import Excel
          </Button>
        </div>

        {/* ── Expandable Filters ── */}
        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 rounded-md border bg-muted/30">
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
              <Select value={transporterFilter} onValueChange={setTransporterFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-otw-transporter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Transporters</SelectItem>
                  {transporters.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Agent / Declarant</p>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-otw-agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Agents</SelectItem>
                  {agents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
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
                  <SelectItem value="READY_NOT_SENT">Ready / Not Sent</SelectItem>
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
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-900/40" />
              Docs Ready / Not Sent
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
                <TableHead>Ready/Unsent</TableHead>
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
                  <TableCell colSpan={21} className="text-center py-8 text-muted-foreground">
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
                    : c.docsReadyNotSent
                    ? "bg-amber-50/50 dark:bg-amber-950/20"
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
                      <TableCell>{fmtDate(c.eta)}</TableCell>
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
                        {c.docsReadyNotSent
                          ? <span className="text-amber-600 font-medium">Yes</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
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

      {/* ── Import result dialog ── */}
      <Dialog open={!!importResult} onOpenChange={(o) => { if (!o) setImportResult(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-green-600" />
              Import Complete
            </DialogTitle>
          </DialogHeader>
          {importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{importResult.updated}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Updated</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{importResult.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Skipped</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{importResult.notFound}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Not Found</p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-1 max-h-48 overflow-y-auto">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-1">Issues</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-amber-700 dark:text-amber-300">{e}</p>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                The page has been refreshed with the latest data.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
