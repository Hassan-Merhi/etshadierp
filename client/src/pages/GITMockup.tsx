/**
 * GIT — MOCKUP PAGE (planning phase only)
 * Spreadsheet/workbook-style replacement for the daily GIT Excel sheet.
 * All data is hard-coded. No DB reads or writes.
 *
 * Tabs:
 *   1. GIT Summary  — high-level daily overview, grouped totals
 *   2. GIT Detail   — full spreadsheet-style table (all columns)
 *   3. At Port / Sea / Left Dar — CNTRS AT PORT style report
 *   4. WhatsApp Preview — exact text message before sending
 *
 * Access plan: Admin / Developer / Owner only.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Ship, Truck, Package, AlertTriangle, FileX, Clock,
  DollarSign, Search, ExternalLink, CheckCircle2, XCircle,
  MessageSquare, FileSpreadsheet,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status =
  | "OTW" | "Sea" | "At Port" | "Left Dar"
  | "At Border" | "In Transit" | "Arrived"
  | "Offloaded" | "Closed";

const ACTIVE: Status[] = ["OTW", "Sea", "At Port", "Left Dar", "At Border", "In Transit", "Arrived"];

interface GITRow {
  sr: number;
  containerNumber: string;
  amount: number;
  company: string;
  eta: string | null;           // ETA DAS (DB field: eta)
  numberPlate: string | null;
  location: string | null;
  borderDate: string | null;
  docsReceived: boolean;
  docsReadyNotSent: boolean;    // docs received but not yet sent to transporter
  transporter: string | null;
  transportFee: number | null;
  declarant: string | null;
  dutyFee: number | null;
  docsSentDate: string | null;
  freightStatus: string | null; // Yes / No / Pending
  status: Status;
  trackingLink: string | null;
  notes: string | null;
}

// ─── Max offload helpers ──────────────────────────────────────────────────────

function maxOffload(borderDate: string | null, transporter: string | null): string | null {
  if (!borderDate) return null;
  const t = (transporter ?? "").toUpperCase();
  const days = t.includes("FARHAT") || t.includes("CONTINENTAL") ? 11 : 14;
  const d = new Date(borderDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function daysDelayed(border: string | null, transporter: string | null): number | null {
  const mo = maxOffload(border, transporter);
  if (!mo) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(mo).getTime()) / 86400000);
  return diff > 0 ? diff : null;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const ROWS: GITRow[] = [
  {
    sr: 1, containerNumber: "MSCU1234567", amount: 48500, company: "HADI L'SHI",
    eta: "2026-05-10", numberPlate: "T123ABC", location: "Dar",
    borderDate: "2026-05-13", docsReceived: true, docsReadyNotSent: false,
    transporter: "FARHAT", transportFee: 3200, declarant: "ATLAS", dutyFee: 5100,
    docsSentDate: "2026-05-12", freightStatus: "Yes", status: "In Transit",
    trackingLink: "https://track.example.com/MSCU1234567", notes: null,
  },
  {
    sr: 2, containerNumber: "TCKU8876543", amount: 62000, company: "HADI KOLWEZI",
    eta: "2026-05-08", numberPlate: null, location: "Dar Port",
    borderDate: null, docsReceived: false, docsReadyNotSent: false,
    transporter: "CONTINENTAL", transportFee: 4100, declarant: "BELTRANS", dutyFee: 7200,
    docsSentDate: null, freightStatus: "Pending", status: "At Port",
    trackingLink: null, notes: "Awaiting customs release",
  },
  {
    sr: 3, containerNumber: "OOLU5541230", amount: 35000, company: "HADI L'SHI",
    eta: "2026-05-20", numberPlate: null, location: null,
    borderDate: null, docsReceived: false, docsReadyNotSent: false,
    transporter: "TRH", transportFee: 2800, declarant: "ATLAS", dutyFee: null,
    docsSentDate: null, freightStatus: "No", status: "Sea",
    trackingLink: "https://track.example.com/OOLU5541230", notes: null,
  },
  {
    sr: 4, containerNumber: "HLCU3312984", amount: 55000, company: "HADI KOLWEZI",
    eta: "2026-05-06", numberPlate: "T456DEF", location: "Kasumbalesa",
    borderDate: "2026-05-11", docsReceived: true, docsReadyNotSent: false,
    transporter: "TRH", transportFee: 3500, declarant: "BELTRANS", dutyFee: 6300,
    docsSentDate: "2026-05-09", freightStatus: "Yes", status: "At Border",
    trackingLink: null, notes: null,
  },
  {
    sr: 5, containerNumber: "CMAU7765431", amount: 41200, company: "HADI L'SHI",
    eta: "2026-04-28", numberPlate: null, location: "Dar Port",
    borderDate: null, docsReceived: true, docsReadyNotSent: true,
    transporter: "FARHAT", transportFee: 3000, declarant: "ATLAS", dutyFee: 4900,
    docsSentDate: null, freightStatus: "Yes", status: "At Port",
    trackingLink: null, notes: "Delayed — truck not assigned",
  },
  {
    sr: 6, containerNumber: "EITU1198823", amount: 29800, company: "HADI L'SHI",
    eta: "2026-05-15", numberPlate: null, location: null,
    borderDate: null, docsReceived: false, docsReadyNotSent: false,
    transporter: null, transportFee: null, declarant: null, dutyFee: null,
    docsSentDate: null, freightStatus: "Pending", status: "Sea",
    trackingLink: null, notes: "New shipment",
  },
  {
    sr: 7, containerNumber: "MSCU9988001", amount: 71500, company: "HADI KOLWEZI",
    eta: "2026-05-04", numberPlate: "T789GHI", location: "Lubumbashi",
    borderDate: "2026-05-09", docsReceived: true, docsReadyNotSent: false,
    transporter: "FARHAT", transportFee: 4500, declarant: "ATLAS", dutyFee: 8100,
    docsSentDate: "2026-05-07", freightStatus: "Yes", status: "Arrived",
    trackingLink: "https://track.example.com/MSCU9988001", notes: null,
  },
  {
    sr: 8, containerNumber: "GESU4421098", amount: 38700, company: "HADI KOLWEZI",
    eta: "2026-05-22", numberPlate: null, location: null,
    borderDate: null, docsReceived: false, docsReadyNotSent: false,
    transporter: "TRH", transportFee: 2600, declarant: null, dutyFee: null,
    docsSentDate: null, freightStatus: "No", status: "OTW",
    trackingLink: "https://track.example.com/GESU4421098", notes: "ETA to DAS confirmed",
  },
  {
    sr: 9, containerNumber: "CAIU6678432", amount: 53200, company: "HADI L'SHI",
    eta: "2026-05-03", numberPlate: "T321XYZ", location: "Dar Port",
    borderDate: null, docsReceived: true, docsReadyNotSent: true,
    transporter: "CONTINENTAL", transportFee: 3800, declarant: "BELTRANS", dutyFee: 6100,
    docsSentDate: null, freightStatus: "Pending", status: "At Port",
    trackingLink: null, notes: "Docs ready, waiting truck allocation",
  },
  {
    sr: 10, containerNumber: "TRHU9182736", amount: 44600, company: "HADI KOLWEZI",
    eta: "2026-04-25", numberPlate: "T654MNO", location: "Lubumbashi",
    borderDate: "2026-04-30", docsReceived: true, docsReadyNotSent: false,
    transporter: "TRH", transportFee: 3100, declarant: "ATLAS", dutyFee: 5500,
    docsSentDate: "2026-04-28", freightStatus: "Yes", status: "Arrived",
    trackingLink: null, notes: null,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<Status, string> = {
  OTW:         "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  Sea:         "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "At Port":   "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Left Dar":  "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  "At Border": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "In Transit":"bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  Arrived:     "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Offloaded:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  Closed:      "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const FREIGHT_COLOR: Record<string, string> = {
  Yes:     "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  No:      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  Pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtD(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accent, alert }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; accent?: string; alert?: boolean;
}) {
  return (
    <Card className={cn("min-w-0", alert && "border-red-300 dark:border-red-800")}>
      <CardContent className="p-3 flex items-start gap-2.5">
        <div className={cn("p-1.5 rounded-md shrink-0", accent ?? "bg-muted")}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground leading-tight truncate">{label}</p>
          <p className={cn("text-lg font-bold leading-tight", alert && "text-red-600")}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Grouped summary table ────────────────────────────────────────────────────

function GroupTable({ title, rows }: {
  title: string;
  rows: { label: string; count: number; cost: number; transport: number; duty: number }[];
}) {
  const total = {
    count: rows.reduce((s, r) => s + r.count, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    transport: rows.reduce((s, r) => s + r.transport, 0),
    duty: rows.reduce((s, r) => s + r.duty, 0),
  };
  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>{title.split(" by ")[1] ?? "Group"}</TableHead>
              <TableHead className="text-right">Containers</TableHead>
              <TableHead className="text-right">Container Cost</TableHead>
              <TableHead className="text-right">Transport Fees</TableHead>
              <TableHead className="text-right">Duty Fees</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{r.label || "—"}</TableCell>
                <TableCell className="text-right">{r.count}</TableCell>
                <TableCell className="text-right">${fmt(r.cost)}</TableCell>
                <TableCell className="text-right">${fmt(r.transport)}</TableCell>
                <TableCell className="text-right">${fmt(r.duty)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-semibold bg-muted/30">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{total.count}</TableCell>
              <TableCell className="text-right">${fmt(total.cost)}</TableCell>
              <TableCell className="text-right">${fmt(total.transport)}</TableCell>
              <TableCell className="text-right">${fmt(total.duty)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Tab 1: GIT Summary ───────────────────────────────────────────────────────

function TabSummary({ active }: { active: GITRow[] }) {
  const totalActive    = active.length;
  const atSea          = active.filter((r) => r.status === "OTW" || r.status === "Sea").length;
  const atPort         = active.filter((r) => r.status === "At Port").length;
  const leftDar        = active.filter((r) => r.status === "Left Dar").length;
  const inTransit      = active.filter((r) => ["At Border", "In Transit", "Arrived"].includes(r.status)).length;
  const delayed        = active.filter((r) => daysDelayed(r.borderDate, r.transporter) !== null).length;
  const docsMissing    = active.filter((r) => !r.docsReceived).length;
  const docsReadyNS    = active.filter((r) => r.docsReadyNotSent).length;
  const offloadOverdue = active.filter((r) => {
    const mo = maxOffload(r.borderDate, r.transporter);
    return mo ? new Date(mo) < new Date() : false;
  }).length;
  const totalCost      = active.reduce((s, r) => s + r.amount, 0);
  const totalTransport = active.reduce((s, r) => s + (r.transportFee ?? 0), 0);
  const totalDuty      = active.reduce((s, r) => s + (r.dutyFee ?? 0), 0);
  const totalFees      = totalTransport + totalDuty;

  // Group by company
  const companies = [...new Set(active.map((r) => r.company))];
  const byCompany = companies.map((c) => {
    const rows = active.filter((r) => r.company === c);
    return {
      label: c,
      count: rows.length,
      cost: rows.reduce((s, r) => s + r.amount, 0),
      transport: rows.reduce((s, r) => s + (r.transportFee ?? 0), 0),
      duty: rows.reduce((s, r) => s + (r.dutyFee ?? 0), 0),
    };
  });

  // Group by transporter
  const transporters = [...new Set(active.map((r) => r.transporter ?? ""))];
  const byTransporter = transporters.map((t) => {
    const rows = active.filter((r) => (r.transporter ?? "") === t);
    return {
      label: t || "Unassigned",
      count: rows.length,
      cost: rows.reduce((s, r) => s + r.amount, 0),
      transport: rows.reduce((s, r) => s + (r.transportFee ?? 0), 0),
      duty: rows.reduce((s, r) => s + (r.dutyFee ?? 0), 0),
    };
  });

  // Group by declarant
  const declarants = [...new Set(active.map((r) => r.declarant ?? ""))];
  const byDeclarant = declarants.map((d) => {
    const rows = active.filter((r) => (r.declarant ?? "") === d);
    return {
      label: d || "Unassigned",
      count: rows.length,
      cost: rows.reduce((s, r) => s + r.amount, 0),
      transport: rows.reduce((s, r) => s + (r.transportFee ?? 0), 0),
      duty: rows.reduce((s, r) => s + (r.dutyFee ?? 0), 0),
    };
  });

  return (
    <div className="space-y-4">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-11 gap-2">
        <StatCard label="Active GIT" value={totalActive} icon={<Package className="h-4 w-4 text-primary" />} accent="bg-primary/10" />
        <StatCard label="At Sea / OTW" value={atSea} icon={<Ship className="h-4 w-4 text-blue-600" />} accent="bg-blue-100 dark:bg-blue-900/30" />
        <StatCard label="At Port" value={atPort} icon={<Package className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />
        <StatCard label="Left Dar" value={leftDar} icon={<Truck className="h-4 w-4 text-violet-600" />} accent="bg-violet-100 dark:bg-violet-900/30" />
        <StatCard label="In Transit" value={inTransit} icon={<Truck className="h-4 w-4 text-indigo-600" />} accent="bg-indigo-100 dark:bg-indigo-900/30" />
        <StatCard label="Delayed" value={delayed} alert={delayed > 0} icon={<Clock className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />
        <StatCard label="Docs Missing" value={docsMissing} alert={docsMissing > 0} icon={<FileX className="h-4 w-4 text-orange-600" />} accent="bg-orange-100 dark:bg-orange-900/30" />
        <StatCard label="Docs Ready, Not Sent" value={docsReadyNS} alert={docsReadyNS > 0} icon={<FileX className="h-4 w-4 text-amber-600" />} accent="bg-amber-100 dark:bg-amber-900/30" />
        <StatCard label="Offload Overdue" value={offloadOverdue} alert={offloadOverdue > 0} icon={<AlertTriangle className="h-4 w-4 text-red-600" />} accent="bg-red-100 dark:bg-red-900/30" />
        <StatCard label="Container Cost" value={`$${fmt(totalCost)}`} icon={<DollarSign className="h-4 w-4 text-green-600" />} accent="bg-green-100 dark:bg-green-900/30" />
        <StatCard label="Total Fees" value={`$${fmt(totalFees)}`} sub={`T:$${fmt(totalTransport)} D:$${fmt(totalDuty)}`} icon={<DollarSign className="h-4 w-4 text-muted-foreground" />} />
      </div>

      {/* Attention needed */}
      {(delayed > 0 || docsMissing > 0 || docsReadyNS > 0 || offloadOverdue > 0) && (
        <Card className="border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Needs Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {delayed > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">Delayed containers</p>
                  {active.filter((r) => daysDelayed(r.borderDate, r.transporter) !== null).map((r) => (
                    <div key={r.sr} className="flex justify-between gap-2">
                      <span className="font-mono">{r.containerNumber}</span>
                      <span className="text-red-600 font-medium">+{daysDelayed(r.borderDate, r.transporter)}d</span>
                    </div>
                  ))}
                </div>
              )}
              {docsMissing > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">Docs missing</p>
                  {active.filter((r) => !r.docsReceived).map((r) => (
                    <div key={r.sr} className="font-mono">{r.containerNumber}</div>
                  ))}
                </div>
              )}
              {docsReadyNS > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">Docs ready, not sent</p>
                  {active.filter((r) => r.docsReadyNotSent).map((r) => (
                    <div key={r.sr} className="font-mono">{r.containerNumber}</div>
                  ))}
                </div>
              )}
              {offloadOverdue > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1 font-medium">Offload overdue</p>
                  {active.filter((r) => {
                    const mo = maxOffload(r.borderDate, r.transporter);
                    return mo ? new Date(mo) < new Date() : false;
                  }).map((r) => (
                    <div key={r.sr} className="font-mono">{r.containerNumber}</div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grouped tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GroupTable title="Totals by Company" rows={byCompany} />
        <GroupTable title="Totals by Transporter" rows={byTransporter} />
        <GroupTable title="Totals by Declarant" rows={byDeclarant} />
      </div>
    </div>
  );
}

// ─── Tab 2: GIT Detail ────────────────────────────────────────────────────────

function TabDetail({ rows }: { rows: GITRow[] }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      r.containerNumber.toLowerCase().includes(q) ||
      r.company.toLowerCase().includes(q) ||
      (r.transporter ?? "").toLowerCase().includes(q) ||
      (r.declarant ?? "").toLowerCase().includes(q) ||
      (r.numberPlate ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totals = {
    amount: filtered.reduce((s, r) => s + r.amount, 0),
    transport: filtered.reduce((s, r) => s + (r.transportFee ?? 0), 0),
    duty: filtered.reduce((s, r) => s + (r.dutyFee ?? 0), 0),
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search container, company, truck…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-git-detail-search"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table className="text-xs whitespace-nowrap">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-8 text-center">SR</TableHead>
              <TableHead>Container #</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>ETA DAS</TableHead>
              <TableHead>Truck #</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Border Date</TableHead>
              <TableHead>Max Offload</TableHead>
              <TableHead>Days Del.</TableHead>
              <TableHead className="text-center">Docs Recv</TableHead>
              <TableHead className="text-center">Docs→Truck</TableHead>
              <TableHead>Transporter</TableHead>
              <TableHead className="text-right">Transport</TableHead>
              <TableHead>Declarant</TableHead>
              <TableHead className="text-right">Duty</TableHead>
              <TableHead>Docs Sent</TableHead>
              <TableHead>Freight Status</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Link</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const mo = maxOffload(r.borderDate, r.transporter);
              const del = daysDelayed(r.borderDate, r.transporter);
              const overdue = mo ? new Date(mo) < new Date() : false;
              return (
                <TableRow
                  key={r.sr}
                  className={del ? "bg-red-50/40 dark:bg-red-950/20" : ""}
                  data-testid={`row-git-${r.sr}`}
                >
                  <TableCell className="text-center text-muted-foreground font-medium">{r.sr}</TableCell>
                  <TableCell className="font-mono font-semibold">{r.containerNumber}</TableCell>
                  <TableCell className="text-right font-medium">${fmt(r.amount)}</TableCell>
                  <TableCell>{r.company}</TableCell>
                  <TableCell>{fmtD(r.eta)}</TableCell>
                  <TableCell className="font-mono">{r.numberPlate ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{r.location ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{fmtD(r.borderDate)}</TableCell>
                  <TableCell className={cn(overdue ? "text-red-600 font-semibold" : "")}>
                    {fmtD(mo)}
                    {r.transporter && mo && (
                      <span className="text-muted-foreground ml-1">
                        ({(r.transporter.toUpperCase().includes("FARHAT") || r.transporter.toUpperCase().includes("CONTINENTAL")) ? "+11d" : "+14d"})
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {del
                      ? <span className="text-red-600 font-semibold">+{del}d</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.docsReceived
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                      : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                  </TableCell>
                  <TableCell className="text-center">
                    {r.docsReadyNotSent
                      ? <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Ready</span>
                      : r.docsSentDate
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                        : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{r.transporter ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">{r.transportFee ? `$${fmt(r.transportFee)}` : "—"}</TableCell>
                  <TableCell>{r.declarant ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">{r.dutyFee ? `$${fmt(r.dutyFee)}` : "—"}</TableCell>
                  <TableCell>{fmtD(r.docsSentDate)}</TableCell>
                  <TableCell>
                    {r.freightStatus
                      ? <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", FREIGHT_COLOR[r.freightStatus])}>{r.freightStatus}</span>
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", STATUS_COLOR[r.status])}>
                      {r.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    {r.trackingLink
                      ? <a href={r.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary">
                          <ExternalLink className="h-3.5 w-3.5 mx-auto" />
                        </a>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="max-w-32 truncate text-muted-foreground">{r.notes ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            {/* Totals row */}
            <TableRow className="border-t-2 font-semibold bg-muted/40">
              <TableCell className="text-center" colSpan={2}>Totals ({filtered.length})</TableCell>
              <TableCell className="text-right">${fmt(totals.amount)}</TableCell>
              <TableCell colSpan={10} />
              <TableCell className="text-right">${fmt(totals.transport)}</TableCell>
              <TableCell />
              <TableCell className="text-right">${fmt(totals.duty)}</TableCell>
              <TableCell colSpan={5} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Tab 3: At Port / Sea / Left Dar ─────────────────────────────────────────

function TabPortReport({ active }: { active: GITRow[] }) {
  const seaOtw  = active.filter((r) => r.status === "OTW" || r.status === "Sea");
  const atPort  = active.filter((r) => r.status === "At Port");
  const leftDar = active.filter((r) => r.status === "Left Dar");
  const subset  = [...seaOtw, ...atPort, ...leftDar];
  const delayed = subset.filter((r) => daysDelayed(r.borderDate, r.transporter) !== null).length;

  function MiniTable({ title, rows, accent }: { title: string; rows: GITRow[]; accent: string }) {
    if (rows.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <h3 className={cn("text-xs font-semibold uppercase tracking-wide px-1", accent)}>{title} — {rows.length}</h3>
        <div className="rounded-md border overflow-x-auto">
          <Table className="text-xs whitespace-nowrap">
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-7">#</TableHead>
                <TableHead>Container #</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>ETA DAS</TableHead>
                <TableHead>Transporter</TableHead>
                <TableHead>Max Offload</TableHead>
                <TableHead>Days Delayed</TableHead>
                <TableHead>Truck #</TableHead>
                <TableHead className="text-center">Docs</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const mo = maxOffload(r.borderDate, r.transporter);
                const del = daysDelayed(r.borderDate, r.transporter);
                return (
                  <TableRow key={r.sr} className={del ? "bg-red-50/40 dark:bg-red-950/20" : ""}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-mono font-semibold">{r.containerNumber}</TableCell>
                    <TableCell>{r.company}</TableCell>
                    <TableCell>{fmtD(r.eta)}</TableCell>
                    <TableCell>{r.transporter ?? "—"}</TableCell>
                    <TableCell className={mo && new Date(mo) < new Date() ? "text-red-600 font-semibold" : ""}>{fmtD(mo)}</TableCell>
                    <TableCell>
                      {del ? <span className="text-red-600 font-semibold">+{del}d</span> : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{r.numberPlate ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      {r.docsReceived
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                        : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                    </TableCell>
                    <TableCell>
                      <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", STATUS_COLOR[r.status])}>
                        {r.status}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex gap-4 flex-wrap p-3 rounded-md border bg-muted/30 text-sm">
        {[
          { label: "OTW / At Sea", value: seaOtw.length, color: "text-blue-600" },
          { label: "At Port",      value: atPort.length,  color: "text-amber-600" },
          { label: "Left Dar",     value: leftDar.length, color: "text-violet-600" },
          { label: "Total",        value: subset.length,  color: "text-foreground font-semibold" },
          { label: "Delayed",      value: delayed,        color: delayed > 0 ? "text-red-600 font-semibold" : "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{s.label}:</span>
            <span className={s.color}>{s.value}</span>
          </div>
        ))}
      </div>

      <MiniTable title="OTW / At Sea" rows={seaOtw} accent="text-blue-700 dark:text-blue-400" />
      <MiniTable title="At Port" rows={atPort} accent="text-amber-700 dark:text-amber-400" />
      <MiniTable title="Left Dar" rows={leftDar} accent="text-violet-700 dark:text-violet-400" />

      {subset.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No containers currently at Sea, OTW, At Port, or Left Dar.</p>
      )}
    </div>
  );
}

// ─── Tab 4: WhatsApp Preview ──────────────────────────────────────────────────

function TabWhatsApp({ active }: { active: GITRow[] }) {
  const seaOtw     = active.filter((r) => r.status === "OTW" || r.status === "Sea").length;
  const atPort     = active.filter((r) => r.status === "At Port").length;
  const leftDar    = active.filter((r) => r.status === "Left Dar").length;
  const inTransit  = active.filter((r) => ["At Border", "In Transit"].includes(r.status)).length;
  const arrived    = active.filter((r) => r.status === "Arrived").length;
  const delayed    = active.filter((r) => daysDelayed(r.borderDate, r.transporter) !== null);
  const docsMiss   = active.filter((r) => !r.docsReceived);
  const docsReady  = active.filter((r) => r.docsReadyNotSent);
  const overdue    = active.filter((r) => {
    const mo = maxOffload(r.borderDate, r.transporter);
    return mo ? new Date(mo) < new Date() : false;
  });
  const totalCost  = active.reduce((s, r) => s + r.amount, 0);
  const totalTrans = active.reduce((s, r) => s + (r.transportFee ?? 0), 0);
  const totalDuty  = active.reduce((s, r) => s + (r.dutyFee ?? 0), 0);

  const companies = [...new Set(active.map((r) => r.company))];
  const transporters = [...new Set(active.map((r) => r.transporter ?? "Unassigned"))];
  const declarants = [...new Set(active.map((r) => r.declarant ?? "Unassigned"))];

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const lines = [
    `📦 *GIT DAILY REPORT — ${today}*`,
    ``,
    `*ACTIVE CONTAINERS: ${active.length}*`,
    `• OTW / At Sea:   ${seaOtw}`,
    `• At Port:        ${atPort}`,
    `• Left Dar:       ${leftDar}`,
    `• In Transit:     ${inTransit}`,
    `• Arrived:        ${arrived}`,
    ``,
    `*FINANCIALS*`,
    `• Container Cost:  $${fmt(totalCost)}`,
    `• Transport Fees:  $${fmt(totalTrans)}`,
    `• Duty Fees:       $${fmt(totalDuty)}`,
    `• Total Fees:      $${fmt(totalTrans + totalDuty)}`,
    ``,
    `*BY COMPANY*`,
    ...companies.map((c) => {
      const n = active.filter((r) => r.company === c).length;
      const cost = active.filter((r) => r.company === c).reduce((s, r) => s + r.amount, 0);
      return `• ${c}: ${n} containers — $${fmt(cost)}`;
    }),
    ``,
    `*BY TRANSPORTER*`,
    ...transporters.map((t) => {
      const n = active.filter((r) => (r.transporter ?? "Unassigned") === t).length;
      return `• ${t}: ${n} containers`;
    }),
    ``,
    `*BY DECLARANT*`,
    ...declarants.map((d) => {
      const n = active.filter((r) => (r.declarant ?? "Unassigned") === d).length;
      return `• ${d}: ${n} containers`;
    }),
    ...(delayed.length > 0 ? [
      ``,
      `⚠️ *DELAYED (${delayed.length})*`,
      ...delayed.map((r) => `• ${r.containerNumber} — +${daysDelayed(r.borderDate, r.transporter)}d (${r.status}) [${r.company}]`),
    ] : []),
    ...(overdue.length > 0 ? [
      ``,
      `🔴 *OFFLOAD OVERDUE (${overdue.length})*`,
      ...overdue.map((r) => `• ${r.containerNumber} — ${r.transporter ?? "no truck"}`),
    ] : []),
    ...(docsMiss.length > 0 ? [
      ``,
      `📄 *DOCS MISSING (${docsMiss.length})*`,
      ...docsMiss.map((r) => `• ${r.containerNumber} [${r.company}]`),
    ] : []),
    ...(docsReady.length > 0 ? [
      ``,
      `📋 *DOCS READY — NOT SENT TO TRANSPORTER (${docsReady.length})*`,
      ...docsReady.map((r) => `• ${r.containerNumber} → ${r.transporter ?? "no transporter"}`),
    ] : []),
    ...(active.filter((r) => r.trackingLink).length > 0 ? [
      ``,
      `*TRACKING LINKS*`,
      ...active.filter((r) => r.trackingLink).map((r) => `${r.containerNumber}: ${r.trackingLink}`),
    ] : []),
  ];

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-green-600" />
        <p className="text-sm font-medium">Daily WhatsApp GIT Report</p>
        <Badge variant="outline" className="text-xs">Text only — no PDF/image</Badge>
      </div>
      <div className="rounded-lg border bg-[#e5ddd5] dark:bg-zinc-800 p-3">
        <div className="bg-white dark:bg-zinc-700 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-[600px] overflow-y-auto">
          {lines.join("\n")}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        This text will be sent to the configured WhatsApp group. No attachment. Sent manually or via scheduled auto-send.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GITMockup() {
  const active = ROWS.filter((r) => ACTIVE.includes(r.status));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="GIT"
        subtitle="Daily goods-in-transit report — spreadsheet replacement"
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Mockup banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Mockup mode</strong> — fake data only. No DB reads or writes.{" "}
            <span className="font-medium">Access: Admin / Developer / Owner only.</span>
          </span>
          <Badge variant="outline" className="ml-auto text-xs shrink-0 border-amber-400 text-amber-700 dark:text-amber-400">
            <FileSpreadsheet className="h-3 w-3 mr-1" />
            GIT Workbook
          </Badge>
        </div>

        {/* Tab navigation */}
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="summary" data-testid="tab-git-summary">GIT Summary</TabsTrigger>
            <TabsTrigger value="detail" data-testid="tab-git-detail">GIT Detail</TabsTrigger>
            <TabsTrigger value="port" data-testid="tab-git-port">At Port / Sea</TabsTrigger>
            <TabsTrigger value="whatsapp" data-testid="tab-git-wa">WhatsApp</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            <TabSummary active={active} />
          </TabsContent>

          <TabsContent value="detail" className="mt-4">
            <TabDetail rows={active} />
          </TabsContent>

          <TabsContent value="port" className="mt-4">
            <TabPortReport active={active} />
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-4">
            <TabWhatsApp active={active} />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
