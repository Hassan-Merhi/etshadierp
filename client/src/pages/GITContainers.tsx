/**
 * GIT / Containers on the Way — MOCKUP PAGE (planning phase only)
 * All data is hard-coded. No DB reads or writes.
 * Purpose: visual review before implementation.
 */

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ContainerStatus =
  | "Sea"
  | "At Port"
  | "Left Dar"
  | "At Border"
  | "In Transit"
  | "Arrived"
  | "Offloaded"
  | "Closed";

interface MockContainer {
  id: number;
  containerNumber: string;
  amount: number;        // grandTotal / container cost
  company: string;
  etaDas: string | null; // ETA Dar es Salaam (port)
  etaDar: string | null; // ETA final destination
  numberPlate: string | null;
  location: string | null;
  borderDate: string | null;
  maxOffloadDate: string | null; // calculated
  daysDelayed: number | null;    // calculated; null = not delayed
  docsReceived: boolean;
  transporter: string | null;
  transportFee: number | null;
  declarant: string | null;
  dutyFee: number | null;
  docsSentDate: string | null;
  freight: string | null;        // "Yes" | "No" | "Pending"
  status: ContainerStatus;
  trackingLink: string | null;
  notes: string | null;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK: MockContainer[] = [
  {
    id: 1,
    containerNumber: "MSCU1234567",
    amount: 48500,
    company: "HADI L'SHI",
    etaDas: "2026-05-10",
    etaDar: "2026-05-14",
    numberPlate: "T123ABC",
    location: "Dar",
    borderDate: "2026-05-13",
    maxOffloadDate: "2026-05-24",
    daysDelayed: null,
    docsReceived: true,
    transporter: "FARHAT",
    transportFee: 3200,
    declarant: "ATLAS",
    dutyFee: 5100,
    docsSentDate: "2026-05-12",
    freight: "Yes",
    status: "In Transit",
    trackingLink: "https://track.example.com/MSCU1234567",
    notes: null,
  },
  {
    id: 2,
    containerNumber: "TCKU8876543",
    amount: 62000,
    company: "HADI KOLWEZI",
    etaDas: "2026-05-08",
    etaDar: "2026-05-12",
    numberPlate: null,
    location: "Dar Port",
    borderDate: null,
    maxOffloadDate: null,
    daysDelayed: 3,
    docsReceived: false,
    transporter: "CONTINENTAL",
    transportFee: 4100,
    declarant: "BELTRANS",
    dutyFee: 7200,
    docsSentDate: null,
    freight: "Pending",
    status: "At Port",
    trackingLink: null,
    notes: "Awaiting customs release",
  },
  {
    id: 3,
    containerNumber: "OOLU5541230",
    amount: 35000,
    company: "HADI L'SHI",
    etaDas: "2026-05-20",
    etaDar: null,
    numberPlate: null,
    location: null,
    borderDate: null,
    maxOffloadDate: null,
    daysDelayed: null,
    docsReceived: false,
    transporter: "TRH",
    transportFee: 2800,
    declarant: "ATLAS",
    dutyFee: null,
    docsSentDate: null,
    freight: "No",
    status: "Sea",
    trackingLink: "https://track.example.com/OOLU5541230",
    notes: null,
  },
  {
    id: 4,
    containerNumber: "HLCU3312984",
    amount: 55000,
    company: "HADI KOLWEZI",
    etaDas: "2026-05-06",
    etaDar: "2026-05-10",
    numberPlate: "T456DEF",
    location: "Kasumbalesa",
    borderDate: "2026-05-11",
    maxOffloadDate: "2026-05-25",
    daysDelayed: null,
    docsReceived: true,
    transporter: "TRH",
    transportFee: 3500,
    declarant: "BELTRANS",
    dutyFee: 6300,
    docsSentDate: "2026-05-09",
    freight: "Yes",
    status: "At Border",
    trackingLink: null,
    notes: null,
  },
  {
    id: 5,
    containerNumber: "CMAU7765431",
    amount: 41200,
    company: "HADI L'SHI",
    etaDas: "2026-04-28",
    etaDar: "2026-05-02",
    numberPlate: null,
    location: "Dar Port",
    borderDate: null,
    maxOffloadDate: null,
    daysDelayed: 10,
    docsReceived: true,
    transporter: "FARHAT",
    transportFee: 3000,
    declarant: "ATLAS",
    dutyFee: 4900,
    docsSentDate: "2026-05-01",
    freight: "Yes",
    status: "At Port",
    trackingLink: null,
    notes: "Delayed — truck not assigned",
  },
  {
    id: 6,
    containerNumber: "EITU1198823",
    amount: 29800,
    company: "HADI L'SHI",
    etaDas: "2026-05-15",
    etaDar: null,
    numberPlate: null,
    location: null,
    borderDate: null,
    maxOffloadDate: null,
    daysDelayed: null,
    docsReceived: false,
    transporter: null,
    transportFee: null,
    declarant: null,
    dutyFee: null,
    docsSentDate: null,
    freight: "Pending",
    status: "Sea",
    trackingLink: null,
    notes: "New shipment",
  },
  {
    id: 7,
    containerNumber: "MSCU9988001",
    amount: 71500,
    company: "HADI KOLWEZI",
    etaDas: "2026-05-04",
    etaDar: "2026-05-08",
    numberPlate: "T789GHI",
    location: "Lubumbashi",
    borderDate: "2026-05-09",
    maxOffloadDate: "2026-05-20",
    daysDelayed: null,
    docsReceived: true,
    transporter: "FARHAT",
    transportFee: 4500,
    declarant: "ATLAS",
    dutyFee: 8100,
    docsSentDate: "2026-05-07",
    freight: "Yes",
    status: "Arrived",
    trackingLink: "https://track.example.com/MSCU9988001",
    notes: null,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<ContainerStatus, { color: string; icon: React.ReactNode }> = {
  Sea:        { color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",        icon: <Ship className="h-3 w-3" /> },
  "At Port":  { color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",    icon: <Package className="h-3 w-3" /> },
  "Left Dar": { color: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",icon: <Truck className="h-3 w-3" /> },
  "At Border":{ color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",icon: <Truck className="h-3 w-3" /> },
  "In Transit":{ color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",icon: <Truck className="h-3 w-3" /> },
  Arrived:    { color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",    icon: <CheckCircle2 className="h-3 w-3" /> },
  Offloaded:  { color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",           icon: <Package className="h-3 w-3" /> },
  Closed:     { color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",           icon: <XCircle className="h-3 w-3" /> },
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
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="p-3 flex items-start gap-2.5">
        <div className={cn("p-1.5 rounded-md shrink-0", accent ?? "bg-muted")}>
          {icon}
        </div>
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

function StatusChip({ status, active, onClick }: {
  status: ContainerStatus | "All";
  active: boolean;
  onClick: () => void;
}) {
  const meta = status !== "All" ? STATUS_META[status] : null;
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
      {meta?.icon}
      {status}
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GITContainers() {
  const [statusChip, setStatusChip] = useState<ContainerStatus | "All">("All");
  const [companyFilter, setCompanyFilter] = useState("ALL");
  const [transporterFilter, setTransporterFilter] = useState("ALL");
  const [declarantFilter, setDeclarantFilter] = useState("ALL");
  const [docsFilter, setDocsFilter] = useState("ALL");
  const [delayedFilter, setDelayedFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Derive active containers (not Offloaded, not Closed) for GIT view
  const active = MOCK.filter((c) => c.status !== "Offloaded" && c.status !== "Closed");

  const filtered = useMemo(() => {
    return active.filter((c) => {
      if (statusChip !== "All" && c.status !== statusChip) return false;
      if (companyFilter !== "ALL" && c.company !== companyFilter) return false;
      if (transporterFilter !== "ALL" && c.transporter !== transporterFilter) return false;
      if (declarantFilter !== "ALL" && c.declarant !== declarantFilter) return false;
      if (docsFilter === "MISSING" && c.docsReceived) return false;
      if (docsFilter === "RECEIVED" && !c.docsReceived) return false;
      if (delayedFilter === "YES" && !c.daysDelayed) return false;
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
  }, [active, statusChip, companyFilter, transporterFilter, declarantFilter, docsFilter, delayedFilter, search]);

  // Summary stats
  const totalActive = active.length;
  const atSea = active.filter((c) => c.status === "Sea").length;
  const atPort = active.filter((c) => c.status === "At Port").length;
  const leftDar = active.filter((c) => c.status === "Left Dar").length;
  const inTransit = active.filter((c) => ["At Border", "In Transit", "Arrived"].includes(c.status)).length;
  const delayed = active.filter((c) => c.daysDelayed && c.daysDelayed > 0).length;
  const docsMissing = active.filter((c) => !c.docsReceived).length;
  const offloadOverdue = active.filter((c) => c.maxOffloadDate && new Date(c.maxOffloadDate) < new Date()).length;
  const totalCost = active.reduce((s, c) => s + c.amount, 0);
  const totalTransport = active.reduce((s, c) => s + (c.transportFee ?? 0), 0);
  const totalDuty = active.reduce((s, c) => s + (c.dutyFee ?? 0), 0);

  const companies = [...new Set(MOCK.map((c) => c.company))];
  const transporters = [...new Set(MOCK.map((c) => c.transporter).filter(Boolean))] as string[];
  const declarants = [...new Set(MOCK.map((c) => c.declarant).filter(Boolean))] as string[];
  const statusChips: (ContainerStatus | "All")[] = ["All", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived"];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="GIT / Containers on the Way"
        subtitle="Active container logistics — at sea and in transit"
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* ── Mock Data Banner ── */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span><strong>Mockup mode</strong> — all data below is fake and for visual review only. No database reads or writes.</span>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-11 gap-2">
          <SummaryCard label="Active" value={totalActive} icon={<Package className="h-4 w-4 text-primary" />} accent="bg-primary/10" />
          <SummaryCard label="At Sea" value={atSea} icon={<Ship className="h-4 w-4 text-blue-600" />} accent="bg-blue-100 dark:bg-blue-900/30" />
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

        {/* ── Status Chips ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {statusChips.map((s) => (
            <StatusChip
              key={s}
              status={s}
              active={statusChip === s}
              onClick={() => setStatusChip(s)}
            />
          ))}
        </div>

        {/* ── Search + Filters ── */}
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
          <Button variant="outline" size="default" data-testid="button-git-export">
            Export Excel
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 rounded-md border bg-muted/30">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Company</p>
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Companies</SelectItem>
                  {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Transporter</p>
              <Select value={transporterFilter} onValueChange={setTransporterFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Transporters</SelectItem>
                  {transporters.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Declarant</p>
              <Select value={declarantFilter} onValueChange={setDeclarantFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Declarants</SelectItem>
                  {declarants.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Docs</p>
              <Select value={docsFilter} onValueChange={setDocsFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="YES">Delayed only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setCompanyFilter("ALL");
                  setTransporterFilter("ALL");
                  setDeclarantFilter("ALL");
                  setDocsFilter("ALL");
                  setDelayedFilter("ALL");
                  setSearch("");
                  setStatusChip("All");
                }}
              >
                Clear All
              </Button>
            </div>
          </div>
        )}

        {/* ── Results count ── */}
        <div className="text-xs text-muted-foreground">
          Showing {filtered.length} of {active.length} active containers
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
                <TableHead>ETA DAS</TableHead>
                <TableHead>Truck #</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Border Date</TableHead>
                <TableHead>Max Offload</TableHead>
                <TableHead>Docs</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead className="text-right">Transport Fee</TableHead>
                <TableHead>Declarant</TableHead>
                <TableHead className="text-right">Duty Fee</TableHead>
                <TableHead>Docs Sent</TableHead>
                <TableHead>Freight</TableHead>
                <TableHead>Days Delayed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                    No containers match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c, i) => {
                  const statusMeta = STATUS_META[c.status];
                  const isDelayed = c.daysDelayed && c.daysDelayed > 0;
                  return (
                    <TableRow key={c.id} className={isDelayed ? "bg-red-50/40 dark:bg-red-950/20" : ""}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{c.containerNumber}</TableCell>
                      <TableCell className="text-right font-medium">${fmt(c.amount)}</TableCell>
                      <TableCell>{c.company}</TableCell>
                      <TableCell>{fmtDate(c.etaDas)}</TableCell>
                      <TableCell>
                        {c.numberPlate
                          ? <span className="font-mono">{c.numberPlate}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>{c.location ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{fmtDate(c.borderDate)}</TableCell>
                      <TableCell className={c.maxOffloadDate && new Date(c.maxOffloadDate) < new Date() ? "text-red-600 font-medium" : ""}>
                        {fmtDate(c.maxOffloadDate)}
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
                        {c.freight
                          ? <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", FREIGHT_META[c.freight]?.color)}>{c.freight}</span>
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {c.daysDelayed
                          ? <span className="text-red-600 font-medium">+{c.daysDelayed}d</span>
                          : c.numberPlate
                            ? <span className="text-muted-foreground">—</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium", statusMeta.color)}>
                          {statusMeta.icon}
                          {c.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {c.trackingLink
                          ? <a href={c.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="max-w-32 truncate text-muted-foreground">{c.notes ?? "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* ── Containers at Port sub-report ── */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Containers at Port — Report View</h2>
          <div className="flex gap-3 flex-wrap mb-2">
            {[
              { label: "At Port", value: atPort, color: "text-amber-600" },
              { label: "At Sea", value: atSea, color: "text-blue-600" },
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
                {active.filter((c) => ["Sea", "At Port", "Left Dar"].includes(c.status)).map((c, i) => {
                  const statusMeta = STATUS_META[c.status];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono font-medium">{c.containerNumber}</TableCell>
                      <TableCell>{c.company}</TableCell>
                      <TableCell>{fmtDate(c.etaDas)}</TableCell>
                      <TableCell>{c.transporter ?? "—"}</TableCell>
                      <TableCell>
                        {c.daysDelayed
                          ? <span className="text-red-600 font-medium">+{c.daysDelayed}d</span>
                          : "—"}
                      </TableCell>
                      <TableCell className="font-mono">{c.numberPlate ?? "—"}</TableCell>
                      <TableCell>
                        <span className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium w-fit", statusMeta.color)}>
                          {statusMeta.icon}
                          {c.status}
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
    </div>
  );
}
