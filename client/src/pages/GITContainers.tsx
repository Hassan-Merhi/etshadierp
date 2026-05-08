/**
 * Containers OTW — MOCKUP PAGE (planning phase only)
 * All data is hard-coded. No DB reads or writes.
 * Purpose: visual review before implementation.
 *
 * PLANNING DECISIONS (confirmed):
 * 1. DB field stays `eta`. UI label = "ETA DAS". `eta_dar` is optional future field.
 * 2. OTW tab kept as legacy. Active statuses: OTW, Sea, At Port, Left Dar, At Border, In Transit, Arrived.
 * 3. Max offload = borderDate + days based on transporter (FARHAT/CONTINENTAL=+11, TRH/default=+14).
 * 4. Editing via side drawer (Container Logistics Drawer). Table is view/filter only.
 * 5. Multi-company by default for Admin/Developer/Owner. Company filter included.
 * 6. WhatsApp format = text summary (not PDF/image).
 * 7. "Freight Status" everywhere (not "Freight").
 * 8. "All Active" is the default quick chip.
 * 9. Container Logistics Drawer: editable fields + calculated read-only preview.
 * 10. Access: Admin, Developer, Owner only. Manager/POS/Normal User blocked.
 */

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  MessageSquare,
  Building2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ContainerStatus =
  | "OTW"
  | "Sea"
  | "At Port"
  | "Left Dar"
  | "At Border"
  | "In Transit"
  | "Arrived"
  | "Offloaded"
  | "Closed";

type ActiveStatus = Exclude<ContainerStatus, "Offloaded" | "Closed">;

const ACTIVE_STATUSES: ActiveStatus[] = ["OTW", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived"];

interface MockContainer {
  id: number;
  containerNumber: string;
  amount: number;
  company: string;
  eta: string | null;         // DB field stays "eta". UI label = "ETA DAS"
  etaDar: string | null;      // Optional future field
  numberPlate: string | null;
  location: string | null;
  borderDate: string | null;
  docsReceived: boolean;
  transporter: string | null;
  transportFee: number | null;
  declarant: string | null;
  dutyFee: number | null;
  docsSentDate: string | null;
  freightStatus: string | null; // "Yes" | "No" | "Pending" — label = "Freight Status"
  status: ContainerStatus;
  trackingLink: string | null;
  notes: string | null;
}

// ─── Max Offload Calculation ─────────────────────────────────────────────────
// FARHAT = borderDate + 11, CONTINENTAL = borderDate + 11, TRH = borderDate + 14, default = +14

function calcMaxOffloadDate(borderDate: string | null, transporter: string | null): string | null {
  if (!borderDate) return null;
  const t = (transporter ?? "").toUpperCase();
  const days = t.includes("FARHAT") ? 11
    : t.includes("CONTINENTAL") ? 11
    : t.includes("TRH") ? 14
    : 14;
  const d = new Date(borderDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function calcDaysDelayed(maxOffloadDate: string | null): number | null {
  if (!maxOffloadDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(maxOffloadDate);
  const diff = Math.floor((today.getTime() - max.getTime()) / 86400000);
  return diff > 0 ? diff : null;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK: MockContainer[] = [
  {
    id: 1, containerNumber: "MSCU1234567", amount: 48500, company: "HADI L'SHI",
    eta: "2026-05-10", etaDar: "2026-05-14",
    numberPlate: "T123ABC", location: "Dar",
    borderDate: "2026-05-13",
    docsReceived: true, transporter: "FARHAT", transportFee: 3200,
    declarant: "ATLAS", dutyFee: 5100, docsSentDate: "2026-05-12",
    freightStatus: "Yes", status: "In Transit",
    trackingLink: "https://track.example.com/MSCU1234567", notes: null,
  },
  {
    id: 2, containerNumber: "TCKU8876543", amount: 62000, company: "HADI KOLWEZI",
    eta: "2026-05-08", etaDar: "2026-05-12",
    numberPlate: null, location: "Dar Port",
    borderDate: null,
    docsReceived: false, transporter: "CONTINENTAL", transportFee: 4100,
    declarant: "BELTRANS", dutyFee: 7200, docsSentDate: null,
    freightStatus: "Pending", status: "At Port",
    trackingLink: null, notes: "Awaiting customs release",
  },
  {
    id: 3, containerNumber: "OOLU5541230", amount: 35000, company: "HADI L'SHI",
    eta: "2026-05-20", etaDar: null,
    numberPlate: null, location: null,
    borderDate: null,
    docsReceived: false, transporter: "TRH", transportFee: 2800,
    declarant: "ATLAS", dutyFee: null, docsSentDate: null,
    freightStatus: "No", status: "Sea",
    trackingLink: "https://track.example.com/OOLU5541230", notes: null,
  },
  {
    id: 4, containerNumber: "HLCU3312984", amount: 55000, company: "HADI KOLWEZI",
    eta: "2026-05-06", etaDar: "2026-05-10",
    numberPlate: "T456DEF", location: "Kasumbalesa",
    borderDate: "2026-05-11",
    docsReceived: true, transporter: "TRH", transportFee: 3500,
    declarant: "BELTRANS", dutyFee: 6300, docsSentDate: "2026-05-09",
    freightStatus: "Yes", status: "At Border",
    trackingLink: null, notes: null,
  },
  {
    id: 5, containerNumber: "CMAU7765431", amount: 41200, company: "HADI L'SHI",
    eta: "2026-04-28", etaDar: "2026-05-02",
    numberPlate: null, location: "Dar Port",
    borderDate: null,
    docsReceived: true, transporter: "FARHAT", transportFee: 3000,
    declarant: "ATLAS", dutyFee: 4900, docsSentDate: "2026-05-01",
    freightStatus: "Yes", status: "At Port",
    trackingLink: null, notes: "Delayed — truck not assigned",
  },
  {
    id: 6, containerNumber: "EITU1198823", amount: 29800, company: "HADI L'SHI",
    eta: "2026-05-15", etaDar: null,
    numberPlate: null, location: null,
    borderDate: null,
    docsReceived: false, transporter: null, transportFee: null,
    declarant: null, dutyFee: null, docsSentDate: null,
    freightStatus: "Pending", status: "Sea",
    trackingLink: null, notes: "New shipment",
  },
  {
    id: 7, containerNumber: "MSCU9988001", amount: 71500, company: "HADI KOLWEZI",
    eta: "2026-05-04", etaDar: "2026-05-08",
    numberPlate: "T789GHI", location: "Lubumbashi",
    borderDate: "2026-05-09",
    docsReceived: true, transporter: "FARHAT", transportFee: 4500,
    declarant: "ATLAS", dutyFee: 8100, docsSentDate: "2026-05-07",
    freightStatus: "Yes", status: "Arrived",
    trackingLink: "https://track.example.com/MSCU9988001", notes: null,
  },
  {
    id: 8, containerNumber: "GESU4421098", amount: 38700, company: "HADI KOLWEZI",
    eta: "2026-05-22", etaDar: null,
    numberPlate: null, location: null,
    borderDate: null,
    docsReceived: false, transporter: "TRH", transportFee: 2600,
    declarant: null, dutyFee: null, docsSentDate: null,
    freightStatus: "No", status: "OTW",
    trackingLink: "https://track.example.com/GESU4421098", notes: "ETA to DAS confirmed",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<ContainerStatus, { color: string; icon: React.ReactNode }> = {
  OTW:        { color: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",          icon: <Ship className="h-3 w-3" /> },
  Sea:        { color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",       icon: <Ship className="h-3 w-3" /> },
  "At Port":  { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",   icon: <Package className="h-3 w-3" /> },
  "Left Dar": { color: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300", icon: <Truck className="h-3 w-3" /> },
  "At Border":{ color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300", icon: <Truck className="h-3 w-3" /> },
  "In Transit":{ color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300", icon: <Truck className="h-3 w-3" /> },
  Arrived:    { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",   icon: <CheckCircle2 className="h-3 w-3" /> },
  Offloaded:  { color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",          icon: <Package className="h-3 w-3" /> },
  Closed:     { color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",          icon: <XCircle className="h-3 w-3" /> },
};

const FREIGHT_META: Record<string, { color: string }> = {
  Yes:     { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  No:      { color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  Pending: { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-3 flex items-start gap-2.5">
        <div className={cn("p-1.5 rounded-md shrink-0", accent ?? "bg-muted")}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
          <p className="text-lg font-bold leading-tight">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status Chip ──────────────────────────────────────────────────────────────

function StatusChip({ label, active, onClick, icon }: {
  label: string; active: boolean; onClick: () => void; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border text-muted-foreground hover-elevate",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Container Logistics Drawer ───────────────────────────────────────────────

interface DrawerState {
  eta: string;
  etaDar: string;
  transporter: string;
  transportFee: string;
  numberPlate: string;
  location: string;
  borderDate: string;
  declarant: string;
  dutyFee: string;
  docsReceived: boolean;
  docsSentDate: string;
  freightStatus: string;
  status: ContainerStatus;
  trackingLink: string;
  notes: string;
}

function ContainerDrawer({ container, open, onClose }: {
  container: MockContainer | null;
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DrawerState>({
    eta: "", etaDar: "", transporter: "", transportFee: "",
    numberPlate: "", location: "", borderDate: "", declarant: "",
    dutyFee: "", docsReceived: false, docsSentDate: "",
    freightStatus: "Pending", status: "Sea",
    trackingLink: "", notes: "",
  });

  // Reset form when container changes
  const prevId = container?.id;
  if (container && container.id !== prevId) {
    setForm({
      eta: container.eta ?? "",
      etaDar: container.etaDar ?? "",
      transporter: container.transporter ?? "",
      transportFee: container.transportFee?.toString() ?? "",
      numberPlate: container.numberPlate ?? "",
      location: container.location ?? "",
      borderDate: container.borderDate ?? "",
      declarant: container.declarant ?? "",
      dutyFee: container.dutyFee?.toString() ?? "",
      docsReceived: container.docsReceived,
      docsSentDate: container.docsSentDate ?? "",
      freightStatus: container.freightStatus ?? "Pending",
      status: container.status,
      trackingLink: container.trackingLink ?? "",
      notes: container.notes ?? "",
    });
  }

  // Seed form on open
  const [lastOpened, setLastOpened] = useState<number | null>(null);
  if (open && container && container.id !== lastOpened) {
    setLastOpened(container.id);
    setForm({
      eta: container.eta ?? "",
      etaDar: container.etaDar ?? "",
      transporter: container.transporter ?? "",
      transportFee: container.transportFee?.toString() ?? "",
      numberPlate: container.numberPlate ?? "",
      location: container.location ?? "",
      borderDate: container.borderDate ?? "",
      declarant: container.declarant ?? "",
      dutyFee: container.dutyFee?.toString() ?? "",
      docsReceived: container.docsReceived,
      docsSentDate: container.docsSentDate ?? "",
      freightStatus: container.freightStatus ?? "Pending",
      status: container.status,
      trackingLink: container.trackingLink ?? "",
      notes: container.notes ?? "",
    });
  }

  const set = (field: keyof DrawerState, val: any) =>
    setForm((prev) => ({ ...prev, [field]: val }));

  const maxOffload = calcMaxOffloadDate(form.borderDate || null, form.transporter || null);
  const daysDelayed = calcDaysDelayed(maxOffload);

  if (!container) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base font-mono">{container.containerNumber}</SheetTitle>
          <SheetDescription className="text-xs">
            {container.company} — Container Logistics Drawer
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pt-2">

          {/* ── Calculated Read-only Preview ── */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculated (read-only)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Max Offload Date</p>
                <p className={cn("text-sm font-medium",
                  maxOffload && new Date(maxOffload) < new Date() ? "text-red-600" : ""
                )}>
                  {maxOffload ? fmtDate(maxOffload) : "—"}
                  {form.transporter && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({(form.transporter.toUpperCase().includes("FARHAT") || form.transporter.toUpperCase().includes("CONTINENTAL")) ? "+11d" : "+14d"})
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Days Delayed</p>
                <p className={cn("text-sm font-medium", daysDelayed ? "text-red-600" : "text-muted-foreground")}>
                  {daysDelayed ? `+${daysDelayed} days` : "—"}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          {/* ── Status & Freight Status ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger data-testid="select-drawer-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  <SelectItem value="Offloaded">Offloaded</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Freight Status</Label>
              <Select value={form.freightStatus} onValueChange={(v) => set("freightStatus", v)}>
                <SelectTrigger data-testid="select-drawer-freight"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Yes">Yes</SelectItem>
                  <SelectItem value="No">No</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── ETA Fields ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">ETA DAS <span className="text-muted-foreground">(DB: eta)</span></Label>
              <Input type="date" value={form.eta} onChange={(e) => set("eta", e.target.value)} data-testid="input-drawer-eta" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">ETA Dar <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="date" value={form.etaDar} onChange={(e) => set("etaDar", e.target.value)} data-testid="input-drawer-eta-dar" />
            </div>
          </div>

          {/* ── Transporter + Transport Fee ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Transporter</Label>
              <Select value={form.transporter || "__none"} onValueChange={(v) => set("transporter", v === "__none" ? "" : v)}>
                <SelectTrigger data-testid="select-drawer-transporter"><SelectValue placeholder="—" /></SelectTrigger>
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
              <Input type="number" placeholder="0" value={form.transportFee} onChange={(e) => set("transportFee", e.target.value)} data-testid="input-drawer-transport-fee" />
            </div>
          </div>

          {/* ── Truck + Location ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Truck / Number Plate</Label>
              <Input placeholder="T123ABC" value={form.numberPlate} onChange={(e) => set("numberPlate", e.target.value)} data-testid="input-drawer-plate" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Input placeholder="e.g. Kasumbalesa" value={form.location} onChange={(e) => set("location", e.target.value)} data-testid="input-drawer-location" />
            </div>
          </div>

          {/* ── Border Date ── */}
          <div className="space-y-1">
            <Label className="text-xs">Border Date</Label>
            <Input type="date" value={form.borderDate} onChange={(e) => set("borderDate", e.target.value)} data-testid="input-drawer-border-date" />
            <p className="text-xs text-muted-foreground">Used to calculate Max Offload Date based on transporter</p>
          </div>

          {/* ── Declarant + Duty Fee ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Declarant / Agent</Label>
              <Input placeholder="e.g. ATLAS" value={form.declarant} onChange={(e) => set("declarant", e.target.value)} data-testid="input-drawer-declarant" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duty Fee ($)</Label>
              <Input type="number" placeholder="0" value={form.dutyFee} onChange={(e) => set("dutyFee", e.target.value)} data-testid="input-drawer-duty-fee" />
            </div>
          </div>

          {/* ── Docs ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Docs Received</Label>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.docsReceived} onCheckedChange={(v) => set("docsReceived", v)} data-testid="switch-drawer-docs-received" />
                <span className="text-sm">{form.docsReceived ? "Yes" : "No"}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Docs Sent to Transporter</Label>
              <Input type="date" value={form.docsSentDate} onChange={(e) => set("docsSentDate", e.target.value)} data-testid="input-drawer-docs-sent" />
            </div>
          </div>

          {/* ── Tracking Link ── */}
          <div className="space-y-1">
            <Label className="text-xs">Tracking Link</Label>
            <Input placeholder="https://…" value={form.trackingLink} onChange={(e) => set("trackingLink", e.target.value)} data-testid="input-drawer-tracking" />
          </div>

          {/* ── Notes ── */}
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={3} placeholder="Any additional notes…" value={form.notes} onChange={(e) => set("notes", e.target.value)} data-testid="input-drawer-notes" />
          </div>

          {/* ── Save (mockup only) ── */}
          <div className="flex gap-2 pt-1 pb-4">
            <Button className="flex-1" data-testid="button-drawer-save">
              Save Changes <span className="ml-1 text-xs opacity-70">(mockup)</span>
            </Button>
            <Button variant="outline" onClick={onClose} data-testid="button-drawer-cancel">
              Cancel
            </Button>
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── WhatsApp Text Preview ─────────────────────────────────────────────────────

function WhatsAppPreview({ containers }: { containers: MockContainer[] }) {
  const active = containers.filter((c) => ACTIVE_STATUSES.includes(c.status as ActiveStatus));
  const atSea = active.filter((c) => c.status === "OTW" || c.status === "Sea").length;
  const atPort = active.filter((c) => c.status === "At Port").length;
  const leftDar = active.filter((c) => c.status === "Left Dar").length;
  const inTransit = active.filter((c) => ["At Border", "In Transit"].includes(c.status)).length;
  const arrived = active.filter((c) => c.status === "Arrived").length;
  const delayed = active.filter((c) => {
    const m = calcMaxOffloadDate(c.borderDate, c.transporter);
    return calcDaysDelayed(m) !== null;
  }).length;
  const docsMissing = active.filter((c) => !c.docsReceived).length;
  const offloadOverdue = active.filter((c) => {
    const m = calcMaxOffloadDate(c.borderDate, c.transporter);
    return m ? new Date(m) < new Date() : false;
  }).length;
  const totalCost = active.reduce((s, c) => s + c.amount, 0);
  const totalTransport = active.reduce((s, c) => s + (c.transportFee ?? 0), 0);
  const totalDuty = active.reduce((s, c) => s + (c.dutyFee ?? 0), 0);

  const topDelayed = active
    .map((c) => ({ c, delay: calcDaysDelayed(calcMaxOffloadDate(c.borderDate, c.transporter)) }))
    .filter((x) => x.delay)
    .sort((a, b) => (b.delay ?? 0) - (a.delay ?? 0))
    .slice(0, 3);

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const lines = [
    `📦 *GIT CONTAINER REPORT — ${today}*`,
    ``,
    `Active: ${active.length}`,
    `At Sea / OTW: ${atSea}`,
    `At Port: ${atPort}`,
    `Left Dar: ${leftDar}`,
    `In Transit: ${inTransit}`,
    `Arrived: ${arrived}`,
    ``,
    `⚠️ Delayed: ${delayed}`,
    `📄 Docs Missing: ${docsMissing}`,
    `🔴 Offload Overdue: ${offloadOverdue}`,
    ``,
    `💵 Total Container Cost: $${fmt(totalCost)}`,
    `🚚 Total Transport Fees: $${fmt(totalTransport)}`,
    `📋 Total Duty Fees: $${fmt(totalDuty)}`,
    ...(topDelayed.length > 0 ? [
      ``,
      `*Top Delayed Containers:*`,
      ...topDelayed.map((x) => `  • ${x.c.containerNumber} — +${x.delay}d (${x.c.status})`),
    ] : []),
    ...(active.filter((c) => c.trackingLink).length > 0 ? [
      ``,
      `*Tracking Links:*`,
      ...active.filter((c) => c.trackingLink).map((c) => `  ${c.containerNumber}: ${c.trackingLink}`),
    ] : []),
  ];

  return (
    <div className="rounded-md border bg-[#e5ddd5] dark:bg-zinc-800 p-3 space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-4 w-4 text-green-600" />
        <p className="text-xs font-semibold">WhatsApp Text Preview <span className="text-muted-foreground font-normal">(planned format)</span></p>
      </div>
      <div className="bg-white dark:bg-zinc-700 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
        {lines.join("\n")}
      </div>
      <p className="text-xs text-muted-foreground">This text will be sent to the WhatsApp group. No PDF or image attachment.</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type QuickChip = "All Active" | ActiveStatus;

export default function GITContainers() {
  const [chipFilter, setChipFilter] = useState<QuickChip>("All Active");
  const [companyFilter, setCompanyFilter] = useState("ALL");
  const [transporterFilter, setTransporterFilter] = useState("ALL");
  const [declarantFilter, setDeclarantFilter] = useState("ALL");
  const [docsFilter, setDocsFilter] = useState("ALL");
  const [delayedFilter, setDelayedFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showWaPreview, setShowWaPreview] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContainer, setDrawerContainer] = useState<MockContainer | null>(null);

  const active = MOCK.filter((c) => ACTIVE_STATUSES.includes(c.status as ActiveStatus));

  const filtered = useMemo(() => {
    return active.filter((c) => {
      if (chipFilter !== "All Active" && c.status !== chipFilter) return false;
      if (companyFilter !== "ALL" && c.company !== companyFilter) return false;
      if (transporterFilter !== "ALL" && c.transporter !== transporterFilter) return false;
      if (declarantFilter !== "ALL" && c.declarant !== declarantFilter) return false;
      if (docsFilter === "MISSING" && c.docsReceived) return false;
      if (docsFilter === "RECEIVED" && !c.docsReceived) return false;
      if (delayedFilter === "YES") {
        const m = calcMaxOffloadDate(c.borderDate, c.transporter);
        if (!calcDaysDelayed(m)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (
          !c.containerNumber.toLowerCase().includes(q) &&
          !c.company.toLowerCase().includes(q) &&
          !(c.numberPlate ?? "").toLowerCase().includes(q) &&
          !(c.transporter ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [active, chipFilter, companyFilter, transporterFilter, declarantFilter, docsFilter, delayedFilter, search]);

  // Summary stats (always over all active)
  const totalActive = active.length;
  const atSea = active.filter((c) => c.status === "OTW" || c.status === "Sea").length;
  const atPort = active.filter((c) => c.status === "At Port").length;
  const leftDar = active.filter((c) => c.status === "Left Dar").length;
  const inTransit = active.filter((c) => ["At Border", "In Transit", "Arrived"].includes(c.status)).length;
  const delayed = active.filter((c) => calcDaysDelayed(calcMaxOffloadDate(c.borderDate, c.transporter)) !== null).length;
  const docsMissing = active.filter((c) => !c.docsReceived).length;
  const offloadOverdue = active.filter((c) => {
    const m = calcMaxOffloadDate(c.borderDate, c.transporter);
    return m ? new Date(m) < new Date() : false;
  }).length;
  const totalCost = active.reduce((s, c) => s + c.amount, 0);
  const totalTransport = active.reduce((s, c) => s + (c.transportFee ?? 0), 0);
  const totalDuty = active.reduce((s, c) => s + (c.dutyFee ?? 0), 0);

  const companies = [...new Set(MOCK.map((c) => c.company))];
  const transporters = [...new Set(MOCK.map((c) => c.transporter).filter(Boolean))] as string[];
  const declarants = [...new Set(MOCK.map((c) => c.declarant).filter(Boolean))] as string[];

  const chips: QuickChip[] = ["All Active", ...ACTIVE_STATUSES];

  function openDrawer(c: MockContainer) {
    setDrawerContainer(c);
    setDrawerOpen(true);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Containers OTW"
        subtitle="Active container logistics and tracking"
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Mockup Banner ── */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><strong>Mockup mode</strong> — all data is fake. No DB reads or writes. Access restricted to Admin / Developer / Owner.</span>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-11 gap-2">
          <SummaryCard label="Active" value={totalActive} icon={<Package className="h-4 w-4 text-primary" />} accent="bg-primary/10" />
          <SummaryCard label="At Sea / OTW" value={atSea} icon={<Ship className="h-4 w-4 text-blue-600" />} accent="bg-blue-100 dark:bg-blue-900/30" />
          <SummaryCard label="At Port" value={atPort} icon={<Package className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />
          <SummaryCard label="Left Dar" value={leftDar} icon={<Truck className="h-4 w-4 text-violet-600" />} accent="bg-violet-100 dark:bg-violet-900/30" />
          <SummaryCard label="In Transit" value={inTransit} icon={<Truck className="h-4 w-4 text-indigo-600" />} accent="bg-indigo-100 dark:bg-indigo-900/30" />
          <SummaryCard label="Delayed" value={delayed} icon={<Clock className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />
          <SummaryCard label="Docs Missing" value={docsMissing} icon={<FileX className="h-4 w-4 text-orange-600" />} accent="bg-orange-100 dark:bg-orange-900/30" />
          <SummaryCard label="Offload Overdue" value={offloadOverdue} icon={<AlertTriangle className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />
          <SummaryCard label="Container Cost" value={`$${fmt(totalCost)}`} icon={<DollarSign className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />
          <SummaryCard label="Transport Fees" value={`$${fmt(totalTransport)}`} icon={<Truck className="h-4 w-4 text-muted-foreground" />} />
          <SummaryCard label="Duty Fees" value={`$${fmt(totalDuty)}`} icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} />
        </div>

        {/* ── Status Quick Chips — "All Active" is default ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {chips.map((s) => (
            <StatusChip
              key={s}
              label={s}
              active={chipFilter === s}
              onClick={() => setChipFilter(s)}
              icon={s !== "All Active" ? STATUS_META[s as ContainerStatus]?.icon : <Package className="h-3 w-3" />}
            />
          ))}
        </div>

        {/* ── Search + Toolbar ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search container #, company, truck, transporter…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-git-search"
            />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={() => setShowFilters((v) => !v)}
            data-testid="button-git-filters"
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
            <ChevronDown className={cn("h-3.5 w-3.5 ml-1 transition-transform", showFilters && "rotate-180")} />
          </Button>
          <Button
            variant="outline"
            size="default"
            onClick={() => setShowWaPreview((v) => !v)}
            data-testid="button-git-wa-preview"
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            WA Preview
          </Button>
          <Button variant="outline" size="default" data-testid="button-git-export">
            Export Excel
          </Button>
        </div>

        {/* ── Expandable Filters ── */}
        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 rounded-md border bg-muted/30">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> Company</p>
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-git-company"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Companies</SelectItem>
                  {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Transporter</p>
              <Select value={transporterFilter} onValueChange={setTransporterFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-git-transporter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Transporters</SelectItem>
                  {transporters.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Declarant</p>
              <Select value={declarantFilter} onValueChange={setDeclarantFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-git-declarant"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Declarants</SelectItem>
                  {declarants.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Docs</p>
              <Select value={docsFilter} onValueChange={setDocsFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-git-docs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="MISSING">Missing</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Delayed</p>
              <Select value={delayedFilter} onValueChange={setDelayedFilter}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-git-delayed"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="YES">Delayed only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => {
                  setCompanyFilter("ALL"); setTransporterFilter("ALL"); setDeclarantFilter("ALL");
                  setDocsFilter("ALL"); setDelayedFilter("ALL"); setSearch(""); setChipFilter("All Active");
                }}
              >
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* ── WhatsApp Text Preview ── */}
        {showWaPreview && <WhatsAppPreview containers={MOCK} />}

        {/* ── Results count ── */}
        <div className="text-xs text-muted-foreground">
          Showing {filtered.length} of {active.length} active containers — click a row or Edit to open the drawer
        </div>

        {/* ── Main Table ── */}
        <div className="rounded-md border overflow-x-auto">
          <Table className="text-xs whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Container #</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA DAS</TableHead>
                <TableHead>Truck #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Border Date</TableHead>
                <TableHead>Max Offload</TableHead>
                <TableHead>Days Delayed</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead className="text-right">Transport Fee</TableHead>
                <TableHead>Declarant</TableHead>
                <TableHead className="text-right">Duty Fee</TableHead>
                <TableHead>Docs Sent</TableHead>
                <TableHead>Freight Status</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={21} className="text-center py-8 text-muted-foreground">
                    No containers match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c, i) => {
                  const statusMeta = STATUS_META[c.status];
                  const maxOffload = calcMaxOffloadDate(c.borderDate, c.transporter);
                  const daysDelayed = calcDaysDelayed(maxOffload);
                  const isOverdue = maxOffload ? new Date(maxOffload) < new Date() : false;
                  return (
                    <TableRow
                      key={c.id}
                      className={cn(
                        "cursor-pointer",
                        daysDelayed ? "bg-red-50/40 dark:bg-red-950/20" : ""
                      )}
                      onClick={() => openDrawer(c)}
                      data-testid={`row-container-${c.id}`}
                    >
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{c.containerNumber}</TableCell>
                      <TableCell className="text-right font-medium">${fmt(c.amount)}</TableCell>
                      <TableCell>{c.company}</TableCell>
                      <TableCell>
                        <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium w-fit", statusMeta.color)}>
                          {statusMeta.icon}{c.status}
                        </span>
                      </TableCell>
                      <TableCell>{fmtDate(c.eta)}</TableCell>
                      <TableCell>
                        {c.numberPlate
                          ? <span className="font-mono">{c.numberPlate}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{c.location ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{fmtDate(c.borderDate)}</TableCell>
                      <TableCell className={isOverdue ? "text-red-600 font-medium" : ""}>
                        {fmtDate(maxOffload)}
                        {c.transporter && maxOffload && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({(c.transporter.toUpperCase().includes("FARHAT") || c.transporter.toUpperCase().includes("CONTINENTAL")) ? "+11d" : "+14d"})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {daysDelayed
                          ? <span className="text-red-600 font-medium">+{daysDelayed}d</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.docsReceived
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          : <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      </TableCell>
                      <TableCell>{c.transporter ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{c.transportFee ? `$${fmt(c.transportFee)}` : "—"}</TableCell>
                      <TableCell>{c.declarant ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{c.dutyFee ? `$${fmt(c.dutyFee)}` : "—"}</TableCell>
                      <TableCell>{fmtDate(c.docsSentDate)}</TableCell>
                      <TableCell>
                        {c.freightStatus
                          ? <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", FREIGHT_META[c.freightStatus]?.color)}>{c.freightStatus}</span>
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {c.trackingLink
                          ? <a href={c.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary" onClick={(e) => e.stopPropagation()}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="max-w-28 truncate text-muted-foreground">{c.notes ?? "—"}</TableCell>
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

        {/* ── OTW Sub-report (legacy tab equivalent) ── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Sea / OTW Overview</h2>
            <Badge variant="outline" className="text-xs">Legacy OTW tab kept for reference</Badge>
          </div>
          <div className="flex gap-3 flex-wrap mb-2">
            {[
              { label: "OTW", value: active.filter((c) => c.status === "OTW").length, color: "text-sky-600" },
              { label: "At Sea", value: active.filter((c) => c.status === "Sea").length, color: "text-blue-600" },
              { label: "At Port", value: atPort, color: "text-amber-600" },
              { label: "Left Dar", value: leftDar, color: "text-violet-600" },
              { label: "Total Active", value: totalActive, color: "text-foreground" },
              { label: "Delayed", value: delayed, color: "text-red-600" },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">{s.label}:</span>
                <span className={cn("font-semibold", s.color)}>{s.value}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table className="text-xs whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Container #</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>ETA DAS</TableHead>
                  <TableHead>Transporter</TableHead>
                  <TableHead>Days Delayed</TableHead>
                  <TableHead>Truck #</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.filter((c) => ["OTW", "Sea", "At Port", "Left Dar"].includes(c.status)).map((c, i) => {
                  const statusMeta = STATUS_META[c.status];
                  const maxOff = calcMaxOffloadDate(c.borderDate, c.transporter);
                  const delayed = calcDaysDelayed(maxOff);
                  return (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => openDrawer(c)}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{c.containerNumber}</TableCell>
                      <TableCell>{c.company}</TableCell>
                      <TableCell>{fmtDate(c.eta)}</TableCell>
                      <TableCell>{c.transporter ?? "—"}</TableCell>
                      <TableCell>
                        {delayed
                          ? <span className="text-red-600 font-medium">+{delayed}d</span>
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono">{c.numberPlate ?? "—"}</TableCell>
                      <TableCell>
                        <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium w-fit", statusMeta.color)}>
                          {statusMeta.icon}{c.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

      </div>

      {/* ── Container Logistics Drawer ── */}
      <ContainerDrawer
        container={drawerContainer}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
