/**
 * GIT — Goods In Transit Workbook
 * Spreadsheet-style replacement for the daily GIT Excel sheet.
 *
 * Tabs:
 *   1. GIT Summary  — real data: status/cost/delay stat cards + company/transporter/agent breakdowns
 *   2. GIT Detail   — real data: Workbook View (grouped by company) + Flat Table toggle
 *   3. At Port / Sea — real data: grouped by status: OTW/Sea | At Port | Left Dar | At Border/In Transit | Arrived
 *   4. Truck / Location — real data: grouped by transporter (with truck) + no-truck section
 *   5. Agent / Duty  — real data: FIFO duty allocation per agent
 *   6. WhatsApp Preview — sample data: formatted text message
 */

import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Ship, Truck, Package, AlertTriangle, FileX, Clock, DollarSign,
  Search, ExternalLink, CheckCircle2, XCircle, MessageSquare,
  FileSpreadsheet, LayoutGrid, List, Info, AlertCircle, ChevronDown, ChevronUp,
  Building2, Layers, Loader2, MessageCircle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status =
  | "OTW" | "Sea" | "At Port" | "Left Dar"
  | "At Border" | "In Transit" | "Arrived" | "Offloaded";


// ─── Helpers ──────────────────────────────────────────────────────────────────


function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtD(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}


const STATUS_BADGE: Record<Status, string> = {
  OTW:         "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  Sea:         "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  "At Port":   "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Left Dar":  "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  "At Border": "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  "In Transit":"bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  Arrived:     "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Offloaded:   "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// ─── Legend strip ─────────────────────────────────────────────────────────────

function WorkbookLegend() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground px-1">
      <span className="font-medium">Row colour:</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400" /> Upcoming ETA, docs pending</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-rose-200 border border-rose-400" /> At port, docs missing</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" /> Docs ready, not sent to truck</span>
      <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-400" /> Offload overdue</span>
    </div>
  );
}

// ─── Real API types (Summary + Detail tabs) ──────────────────────────────────

type CompanyViewMode = "session" | "all";

interface EnrichedContainerApi {
  id: number;
  companyId: number;
  companyName: string;
  containerNumber: string;
  supplierId: number;
  supplierName: string | null;
  status: string;
  importDate: string;
  grandTotal: string | null;
  itemName: string | null;
  shopName: string | null;
  eta: string | null;
  etaSource: string | null;
  transporter: string | null;
  transportFee: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  borderDate: string | null;
  offloadDate: string | null;
  agent: string | null;
  dutyFee: string | null;
  docReceived: boolean | null;
  trackingDescription: string | null;
  docsSentDate: string | null;
  freightStatus: string | null;
  trackingLink: string | null;
  maxOffloadDate: string | null;
  daysDelayed: number | null;
  docsReadyNotSent: boolean;
  isOverdue: boolean;
}

interface GitContainersSingle {
  asOf: string;
  mode: "single";
  companyId: number;
  companyName: string;
  total: number;
  containers: EnrichedContainerApi[];
}

interface GitContainersAll {
  asOf: string;
  mode: "all";
  total: number;
  containers: EnrichedContainerApi[];
}

type GitContainersResponse = GitContainersSingle | GitContainersAll;

// ─── Shared helpers for real data tabs ───────────────────────────────────────

const parseNum = (v: string | null | undefined): number =>
  parseFloat(v ?? "0") || 0;

const COMPANY_COLORS: { bg: string; text: string }[] = [
  { bg: "bg-yellow-400",  text: "text-yellow-950" },
  { bg: "bg-orange-400",  text: "text-orange-950" },
  { bg: "bg-teal-600",    text: "text-white" },
  { bg: "bg-green-600",   text: "text-white" },
  { bg: "bg-purple-600",  text: "text-white" },
  { bg: "bg-cyan-600",    text: "text-white" },
  { bg: "bg-red-600",     text: "text-white" },
  { bg: "bg-blue-600",    text: "text-white" },
  { bg: "bg-indigo-600",  text: "text-white" },
];

function getRealRowBg(r: EnrichedContainerApi): string {
  if (r.isOverdue)                                      return "bg-red-50 dark:bg-red-950/20";
  if (r.daysDelayed !== null && r.daysDelayed > 0)      return "bg-orange-50 dark:bg-orange-950/20";
  if (r.docsReadyNotSent)                               return "bg-amber-50 dark:bg-amber-950/20";
  return "";
}

function WorkbookDataRow({ r }: { r: EnrichedContainerApi }) {
  const docsSent = !!r.docsSentDate;
  return (
    <tr className={cn("border-b last:border-b-0", getRealRowBg(r))}>
      <td className="py-0.5 px-2 font-mono font-bold">{r.containerNumber}</td>
      <td className="py-0.5 px-2">{r.supplierName ?? "—"}</td>
      <td className="py-0.5 px-2 text-right font-semibold">${fmt(parseNum(r.grandTotal), 2)}</td>
      <td className="py-0.5 px-2">{fmtD(r.eta)}</td>
      <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? "—"}</td>
      <td className="py-0.5 px-2">{r.trackingLocation ?? "—"}</td>
      <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
      <td className={cn("py-0.5 px-2", r.isOverdue ? "text-red-600 font-bold" : "")}>
        {fmtD(r.maxOffloadDate)}
        {r.daysDelayed ? <span className="ml-1 text-[10px]">+{r.daysDelayed}d</span> : null}
      </td>
      <td className="py-0.5 px-2 text-center">
        {r.docReceived ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
      </td>
      <td className="py-0.5 px-2 text-center">
        {docsSent
          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
          : r.docsReadyNotSent
            ? <span className="text-amber-700 text-[10px] font-medium">READY</span>
            : "—"}
      </td>
      <td className="py-0.5 px-2">{r.freightStatus ?? "—"}</td>
      <td className="py-0.5 px-2">{r.transporter ?? "—"}</td>
      <td className="py-0.5 px-2 text-right">{parseNum(r.transportFee) > 0 ? `$${fmt(parseNum(r.transportFee), 0)}` : "—"}</td>
      <td className="py-0.5 px-2">{r.agent ?? "—"}</td>
      <td className="py-0.5 px-2 text-right">{parseNum(r.dutyFee) > 0 ? `$${fmt(parseNum(r.dutyFee), 0)}` : "—"}</td>
      <td className="py-0.5 px-2">
        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", (STATUS_BADGE as Record<string, string>)[r.status] ?? "bg-muted text-foreground")}>{r.status}</span>
      </td>
      <td className="py-0.5 px-2 text-center">
        {r.trackingLink ? <a href={r.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="h-3.5 w-3.5 mx-auto" /></a> : "—"}
      </td>
      <td className="py-0.5 px-2 max-w-40 truncate text-muted-foreground italic">{r.trackingDescription ?? "—"}</td>
    </tr>
  );
}

const WORKBOOK_COLS = 18;

function groupBySupplier(rows: EnrichedContainerApi[]) {
  const groups: Array<{ name: string; rows: EnrichedContainerApi[] }> = [];
  for (const r of rows) {
    const key = r.supplierName ?? "Unknown";
    const existing = groups.find(g => g.name === key);
    if (existing) existing.rows.push(r);
    else groups.push({ name: key, rows: [r] });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return groups;
}

function SupplierGroupedRows({ rows }: { rows: EnrichedContainerApi[] }) {
  const groups = groupBySupplier(rows);
  if (groups.length <= 1) return <>{rows.map(r => <WorkbookDataRow key={r.id} r={r} />)}</>;
  return (
    <>
      {groups.map(({ name, rows: sRows }) => (
        <>
          <tr key={`sup-${name}`} className="bg-muted/40 border-t border-border">
            <td colSpan={WORKBOOK_COLS} className="py-0.5 px-2 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {name} — {sRows.length}
            </td>
          </tr>
          {sRows.map(r => <WorkbookDataRow key={r.id} r={r} />)}
        </>
      ))}
    </>
  );
}

function RealWorkbookBlock({
  companyName, rows, headerBg, headerText,
}: {
  companyName: string;
  rows: EnrichedContainerApi[];
  headerBg: string;
  headerText: string;
}) {
  const total = {
    amount: rows.reduce((s, r) => s + parseNum(r.grandTotal), 0),
    fee:    rows.reduce((s, r) => s + parseNum(r.transportFee), 0),
    duty:   rows.reduce((s, r) => s + parseNum(r.dutyFee), 0),
  };

  // Group by shopName; fall back to companyName when shopName is null
  const shopGroups: Array<{ name: string; rows: EnrichedContainerApi[] }> = [];
  for (const r of rows) {
    const key = r.shopName ?? companyName;
    const existing = shopGroups.find(g => g.name === key);
    if (existing) existing.rows.push(r);
    else shopGroups.push({ name: key, rows: [r] });
  }
  shopGroups.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );
  const hasShops = shopGroups.length > 1;

  const columnHeaders = (
    <tr className="bg-muted/60 border-b text-muted-foreground">
      <th className="py-1 px-2 font-semibold text-center">CTR #</th>
      <th className="py-1 px-2 font-semibold text-center">SUPPLIER</th>
      <th className="py-1 px-2 font-semibold text-center">AMOUNT</th>
      <th className="py-1 px-2 font-semibold text-center">ETA</th>
      <th className="py-1 px-2 font-semibold text-center">TRUCK #</th>
      <th className="py-1 px-2 font-semibold text-center">LOCATION</th>
      <th className="py-1 px-2 font-semibold text-center">BORDER DT.</th>
      <th className="py-1 px-2 font-semibold text-center">MAX OFFLOAD</th>
      <th className="py-1 px-2 font-semibold text-center">DOCS RCVD</th>
      <th className="py-1 px-2 font-semibold text-center">DOCS→TRUCK</th>
      <th className="py-1 px-2 font-semibold text-center">FREIGHT</th>
      <th className="py-1 px-2 font-semibold text-center">TRANSPORTER</th>
      <th className="py-1 px-2 font-semibold text-center">FEE</th>
      <th className="py-1 px-2 font-semibold text-center">AGENT</th>
      <th className="py-1 px-2 font-semibold text-center">DUTY</th>
      <th className="py-1 px-2 font-semibold text-center">STATUS</th>
      <th className="py-1 px-2 font-semibold text-center">LINK</th>
      <th className="py-1 px-2 font-semibold text-center">NOTES</th>
    </tr>
  );

  return (
    <div className="rounded-md border overflow-hidden">
      {/* Company-level header */}
      <div className={cn("flex items-center justify-center gap-3 px-3 py-1.5", headerBg, headerText)}>
        <span className="text-sm font-bold tracking-wide">{companyName}</span>
        <span className="text-xs font-semibold opacity-90">{rows.length} containers — ${fmt(total.amount, 2)}</span>
      </div>

      {hasShops ? (
        /* Multiple shops — one mini-table per shop */
        <div className="divide-y">
          {shopGroups.map(({ name, rows: shopRows }) => {
            const st = {
              amount: shopRows.reduce((s, r) => s + parseNum(r.grandTotal), 0),
              fee:    shopRows.reduce((s, r) => s + parseNum(r.transportFee), 0),
              duty:   shopRows.reduce((s, r) => s + parseNum(r.dutyFee), 0),
            };
            return (
              <div key={name}>
                {/* Shop sub-header */}
                <div className="flex items-center justify-center gap-3 px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-300 dark:border-yellow-700">
                  <span className="text-xs font-bold uppercase tracking-wide text-yellow-900 dark:text-yellow-300">{name}</span>
                  <span className="text-xs text-yellow-800 dark:text-yellow-400">{shopRows.length} container{shopRows.length !== 1 ? "s" : ""} — ${fmt(st.amount, 2)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs whitespace-nowrap border-collapse">
                    <thead>{columnHeaders}</thead>
                    <tbody>
                      <SupplierGroupedRows rows={shopRows} />
                      <tr className="bg-yellow-50 dark:bg-yellow-900/10 border-t border-yellow-200 dark:border-yellow-800 text-xs font-semibold text-yellow-900 dark:text-yellow-300">
                        <td className="py-1 px-2">SUB-TOTAL — {shopRows.length} CTR</td>
                        <td />
                        <td className="py-1 px-2 text-right">${fmt(st.amount, 2)}</td>
                        <td colSpan={9} />
                        <td className="py-1 px-2 text-right">{st.fee > 0 ? `$${fmt(st.fee, 0)}` : "—"}</td>
                        <td />
                        <td className="py-1 px-2 text-right">{st.duty > 0 ? `$${fmt(st.duty, 0)}` : "—"}</td>
                        <td colSpan={3} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {/* Company grand total */}
          <div className={cn("px-3 py-1.5 flex items-center justify-between text-xs font-bold", headerBg, headerText)}>
            <span>TOTAL — {rows.length} CTR</span>
            <div className="flex gap-4">
              <span>${fmt(total.amount, 2)}</span>
              {total.fee > 0 && <span>TRANSPORT: ${fmt(total.fee, 0)}</span>}
              {total.duty > 0 && <span>DUTY: ${fmt(total.duty, 0)}</span>}
            </div>
          </div>
        </div>
      ) : (
        /* Single shop (or no shopName set) — original flat table */
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap border-collapse">
            <thead>{columnHeaders}</thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={WORKBOOK_COLS} className="py-3 text-center text-muted-foreground italic text-xs">No containers</td></tr>
              ) : (
                <SupplierGroupedRows rows={rows} />
              )}
              {rows.length > 0 && (
                <tr className={cn("border-t-2 text-xs font-bold", headerBg, headerText)}>
                  <td className="py-1 px-2">TOTAL — {rows.length} CTR</td>
                  <td />
                  <td className="py-1 px-2 text-right">${fmt(total.amount, 2)}</td>
                  <td colSpan={9} />
                  <td className="py-1 px-2 text-right">{total.fee > 0 ? `$${fmt(total.fee, 0)}` : "—"}</td>
                  <td />
                  <td className="py-1 px-2 text-right">{total.duty > 0 ? `$${fmt(total.duty, 0)}` : "—"}</td>
                  <td colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: GIT Detail (real data) ───────────────────────────────────────────

function TabDetail() {
  const [companyMode, setCompanyMode] = useState<CompanyViewMode>("session");
  const [view, setView] = useState<"workbook" | "flat">("workbook");
  const [search, setSearch] = useState("");

  const queryUrl = companyMode === "all"
    ? "/api/git/containers?allCompanies=true"
    : "/api/git/containers";

  const { data, isLoading, isError, error } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    retry: 1,
  });

  const allContainers: EnrichedContainerApi[] = data?.containers ?? [];

  const filtered = useMemo(() => {
    if (!search) return allContainers;
    const q = search.toLowerCase();
    return allContainers.filter((r) =>
      r.containerNumber.toLowerCase().includes(q) ||
      r.companyName.toLowerCase().includes(q) ||
      (r.transporter ?? "").toLowerCase().includes(q) ||
      (r.agent ?? "").toLowerCase().includes(q) ||
      (r.numberPlate ?? "").toLowerCase().includes(q) ||
      (r.trackingLocation ?? "").toLowerCase().includes(q)
    );
  }, [allContainers, search]);

  const totals = useMemo(() => ({
    amount: filtered.reduce((s, r) => s + parseNum(r.grandTotal), 0),
    fee:    filtered.reduce((s, r) => s + parseNum(r.transportFee), 0),
    duty:   filtered.reduce((s, r) => s + parseNum(r.dutyFee), 0),
  }), [filtered]);

  const companies = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; rows: EnrichedContainerApi[] }>();
    for (const r of filtered) {
      if (!seen.has(r.companyId)) seen.set(r.companyId, { id: r.companyId, name: r.companyName, rows: [] });
      seen.get(r.companyId)!.rows.push(r);
    }
    return [...seen.values()];
  }, [filtered]);

  const modeSelector = (
    <div className="flex items-center gap-2 flex-wrap" data-testid="detail-mode-selector">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground">View:</span>
      <Button size="sm" variant={companyMode === "session" ? "default" : "outline"} className="text-xs gap-1.5" onClick={() => setCompanyMode("session")} data-testid="button-detail-my-company">My Company</Button>
      <Button size="sm" variant={companyMode === "all" ? "default" : "outline"} className="text-xs gap-1.5" onClick={() => setCompanyMode("all")} data-testid="button-detail-all-companies">All Accessible Companies</Button>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-3">
      {modeSelector}
      {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-md" />)}
    </div>
  );

  if (isError) return (
    <div className="space-y-3">
      {modeSelector}
      <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 flex gap-3 items-start text-sm text-red-800 dark:text-red-300">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Failed to load container data</div>
          <div className="text-xs mt-0.5">{(error as Error)?.message ?? "Network or server error."}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {modeSelector}

      {allContainers.length === 0 ? (
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
          <FileX className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <div className="font-medium">No active containers found</div>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search container, company, truck, agent…"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-git-detail-search"
              />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} rows</span>
            <div className="flex items-center gap-1 ml-auto">
              <Button size="sm" variant={view === "workbook" ? "default" : "outline"} className="gap-1.5" onClick={() => setView("workbook")} data-testid="button-view-workbook">
                <LayoutGrid className="h-3.5 w-3.5" />Workbook
              </Button>
              <Button size="sm" variant={view === "flat" ? "default" : "outline"} className="gap-1.5" onClick={() => setView("flat")} data-testid="button-view-flat">
                <List className="h-3.5 w-3.5" />Flat Table
              </Button>
            </div>
          </div>

          {view === "workbook" ? (
            <div className="space-y-4">
              <WorkbookLegend />
              {companies.map((company, idx) => {
                const color = COMPANY_COLORS[idx % COMPANY_COLORS.length];
                return (
                  <RealWorkbookBlock
                    key={company.id}
                    companyName={company.name}
                    rows={company.rows}
                    headerBg={color.bg}
                    headerText={color.text}
                  />
                );
              })}
              {filtered.length > 0 && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-zinc-800 dark:bg-zinc-700 text-white text-xs font-bold">
                  <span>TOTAL — ALL COMPANIES ({filtered.length} containers)</span>
                  <div className="flex gap-4">
                    <span>CTR COST: ${fmt(totals.amount, 2)}</span>
                    <span>TRANSPORT: ${fmt(totals.fee, 0)}</span>
                    <span>DUTY: ${fmt(totals.duty, 0)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table className="text-xs whitespace-nowrap">
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Container #</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Truck #</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Border Date</TableHead>
                    <TableHead>Max Offload</TableHead>
                    <TableHead className="text-center">Docs Rcvd</TableHead>
                    <TableHead className="text-center">Docs→Truck</TableHead>
                    <TableHead>Transporter</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Duty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Link</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const docsSent = !!r.docsSentDate;
                    return (
                      <TableRow key={r.id} className={getRealRowBg(r)} data-testid={`row-git-${r.containerNumber}`}>
                        <TableCell className="font-mono font-semibold">{r.containerNumber}</TableCell>
                        <TableCell className="text-right font-medium">${fmt(parseNum(r.grandTotal), 2)}</TableCell>
                        <TableCell>{r.companyName}</TableCell>
                        <TableCell>{fmtD(r.eta)}</TableCell>
                        <TableCell className="font-mono">{r.numberPlate ?? "—"}</TableCell>
                        <TableCell>{r.trackingLocation ?? "—"}</TableCell>
                        <TableCell>{fmtD(r.borderDate)}</TableCell>
                        <TableCell className={cn(r.isOverdue ? "text-red-600 font-bold" : "")}>
                          {fmtD(r.maxOffloadDate)}
                          {r.daysDelayed ? <span className="ml-1 text-red-600 text-[10px]">+{r.daysDelayed}d</span> : null}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.docReceived ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                        </TableCell>
                        <TableCell className="text-center">
                          {docsSent
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                            : r.docsReadyNotSent
                              ? <span className="text-amber-700 text-[10px] font-medium">READY</span>
                              : "—"}
                        </TableCell>
                        <TableCell>{r.transporter ?? "—"}</TableCell>
                        <TableCell className="text-right">{parseNum(r.transportFee) > 0 ? `$${fmt(parseNum(r.transportFee), 0)}` : "—"}</TableCell>
                        <TableCell>{r.agent ?? "—"}</TableCell>
                        <TableCell className="text-right">{parseNum(r.dutyFee) > 0 ? `$${fmt(parseNum(r.dutyFee), 0)}` : "—"}</TableCell>
                        <TableCell>
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", (STATUS_BADGE as Record<string, string>)[r.status] ?? "bg-muted text-foreground")}>{r.status}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {r.trackingLink ? <a href={r.trackingLink} target="_blank" rel="noopener noreferrer" className="text-primary"><ExternalLink className="h-3.5 w-3.5 mx-auto" /></a> : "—"}
                        </TableCell>
                        <TableCell className="max-w-32 truncate text-muted-foreground">{r.trackingDescription ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2 font-semibold bg-muted/40">
                    <TableCell className="text-center">Totals ({filtered.length})</TableCell>
                    <TableCell className="text-right">${fmt(totals.amount, 2)}</TableCell>
                    <TableCell colSpan={9} />
                    <TableCell className="text-right">${fmt(totals.fee, 0)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">${fmt(totals.duty, 0)}</TableCell>
                    <TableCell colSpan={3} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 1: GIT Summary ───────────────────────────────────────────────────────

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

function SummaryGroupTable({ title, rows }: {
  title: string;
  rows: { label: string; count: number; cost: number; fee: number; duty: number }[];
}) {
  const total = {
    count: rows.reduce((s, r) => s + r.count, 0),
    cost: rows.reduce((s, r) => s + r.cost, 0),
    fee: rows.reduce((s, r) => s + r.fee, 0),
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
              <TableHead className="text-right">CTR</TableHead>
              <TableHead className="text-right">CTR Cost</TableHead>
              <TableHead className="text-right">Transport</TableHead>
              <TableHead className="text-right">Duty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="font-medium">{r.label || "—"}</TableCell>
                <TableCell className="text-right">{r.count}</TableCell>
                <TableCell className="text-right">${fmt(r.cost, 0)}</TableCell>
                <TableCell className="text-right">{r.fee > 0 ? `$${fmt(r.fee, 0)}` : "—"}</TableCell>
                <TableCell className="text-right">{r.duty > 0 ? `$${fmt(r.duty, 0)}` : "—"}</TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-semibold bg-muted/30">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{total.count}</TableCell>
              <TableCell className="text-right">${fmt(total.cost, 0)}</TableCell>
              <TableCell className="text-right">{total.fee > 0 ? `$${fmt(total.fee, 0)}` : "—"}</TableCell>
              <TableCell className="text-right">{total.duty > 0 ? `$${fmt(total.duty, 0)}` : "—"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TabSummary() {
  const [companyMode, setCompanyMode] = useState<CompanyViewMode>("session");

  const queryUrl = companyMode === "all"
    ? "/api/git/containers?allCompanies=true"
    : "/api/git/containers";

  const { data, isLoading, isError, error } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    retry: 1,
  });

  const allContainers: EnrichedContainerApi[] = data?.containers ?? [];

  const stats = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const r of allContainers) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
      total:             allContainers.length,
      atSea:             (byStatus["OTW"] ?? 0) + (byStatus["Sea"] ?? 0),
      atPort:            byStatus["At Port"] ?? 0,
      leftDar:           byStatus["Left Dar"] ?? 0,
      inTransit:         (byStatus["At Border"] ?? 0) + (byStatus["In Transit"] ?? 0),
      arrived:           byStatus["Arrived"] ?? 0,
      delayed:           allContainers.filter(r => r.daysDelayed !== null && r.daysDelayed > 0).length,
      overdue:           allContainers.filter(r => r.isOverdue).length,
      docsReadyNotSent:  allContainers.filter(r => r.docsReadyNotSent).length,
      totalCost:         allContainers.reduce((s, r) => s + parseNum(r.grandTotal), 0),
      totalFee:          allContainers.reduce((s, r) => s + parseNum(r.transportFee), 0),
      totalDuty:         allContainers.reduce((s, r) => s + parseNum(r.dutyFee), 0),
    };
  }, [allContainers]);

  const makeBreakdown = (keyFn: (r: EnrichedContainerApi) => string) => {
    const map = new Map<string, { label: string; count: number; cost: number; fee: number; duty: number }>();
    for (const r of allContainers) {
      const k = keyFn(r);
      if (!map.has(k)) map.set(k, { label: k, count: 0, cost: 0, fee: 0, duty: 0 });
      const e = map.get(k)!;
      e.count++;
      e.cost  += parseNum(r.grandTotal);
      e.fee   += parseNum(r.transportFee);
      e.duty  += parseNum(r.dutyFee);
    }
    return [...map.values()];
  };

  const byCompany   = useMemo(() => makeBreakdown(r => r.companyName), [allContainers]);
  const byTransport = useMemo(() => makeBreakdown(r => r.transporter ?? "—"), [allContainers]);
  const byAgent     = useMemo(() => makeBreakdown(r => r.agent ?? "—"), [allContainers]);

  const attentionRows = useMemo(() =>
    allContainers.filter(r => r.docsReadyNotSent),
  [allContainers]);

  const modeSelector = (
    <div className="flex items-center gap-2 flex-wrap" data-testid="summary-mode-selector">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground">View:</span>
      <Button size="sm" variant={companyMode === "session" ? "default" : "outline"} className="text-xs gap-1.5" onClick={() => setCompanyMode("session")} data-testid="button-summary-my-company">My Company</Button>
      <Button size="sm" variant={companyMode === "all" ? "default" : "outline"} className="text-xs gap-1.5" onClick={() => setCompanyMode("all")} data-testid="button-summary-all-companies">All Accessible Companies</Button>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-4">
      {modeSelector}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-11 gap-2">
        {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
      </div>
      <Skeleton className="h-40 w-full rounded-md" />
    </div>
  );

  if (isError) return (
    <div className="space-y-4">
      {modeSelector}
      <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 flex gap-3 items-start text-sm text-red-800 dark:text-red-300">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Failed to load container data</div>
          <div className="text-xs mt-0.5">{(error as Error)?.message ?? "Network or server error."}</div>
        </div>
      </div>
    </div>
  );

  if (stats.total === 0) return (
    <div className="space-y-4">
      {modeSelector}
      <div className="rounded-md border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
        <FileX className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <div className="font-medium">No active containers found</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {modeSelector}

      {/* Compact stats strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-4 py-2.5 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Active</span>
          <span className="font-bold">{stats.total}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">At Sea</span>
          <span className="font-semibold">{stats.atSea}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">At Port</span>
          <span className="font-semibold">{stats.atPort}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Left Dar</span>
          <span className="font-semibold">{stats.leftDar}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">In Transit</span>
          <span className="font-semibold">{stats.inTransit}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Arrived</span>
          <span className="font-semibold">{stats.arrived}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Delayed</span>
          <span className={cn("font-bold", stats.delayed > 0 ? "text-red-600" : "")}>{stats.delayed}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Docs Pending</span>
          <span className={cn("font-bold", stats.docsReadyNotSent > 0 ? "text-amber-600" : "")}>{stats.docsReadyNotSent}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Overdue</span>
          <span className={cn("font-bold", stats.overdue > 0 ? "text-orange-600" : "")}>{stats.overdue}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Cost</span>
          <span className="font-bold text-green-700 dark:text-green-400">${fmt(stats.totalCost, 0)}</span>
        </div>
      </div>

      {/* Active container summary bar — by company */}
      <div className="rounded-md border overflow-hidden">
        <div className="bg-zinc-800 dark:bg-zinc-700 text-white px-3 py-1.5 text-xs font-bold tracking-wide">
          ACTIVE CONTAINER SUMMARY — BY COMPANY
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {byCompany.map((c, idx) => {
                const color = COMPANY_COLORS[idx % COMPANY_COLORS.length];
                return (
                  <tr key={c.label} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className={cn("py-1 px-1 font-bold w-2", color.bg, color.text)} />
                    <td className="py-1 px-3 font-semibold">{c.label}</td>
                    <td className="py-1 px-3 text-right font-bold text-base">{c.count}</td>
                    <td className="py-1 px-3 text-right font-semibold">${fmt(c.cost, 2)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 bg-muted/40 font-bold">
                <td />
                <td className="py-1 px-3">TOTAL ACTIVE</td>
                <td className="py-1 px-3 text-right text-base">{stats.total}</td>
                <td className="py-1 px-3 text-right">${fmt(stats.totalCost, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Attention section */}
      {attentionRows.length > 0 && (() => {
        const shopMap = new Map<string, EnrichedContainerApi[]>();
        for (const r of attentionRows) {
          const key = r.shopName ?? r.companyName ?? "Other";
          if (!shopMap.has(key)) shopMap.set(key, []);
          shopMap.get(key)!.push(r);
        }
        const shopEntries = [...shopMap.entries()].sort(([a], [b]) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );
        return (
          <div className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Docs ready — not sent to transporter yet
              </span>
              <span className="ml-auto text-xs text-amber-600 dark:text-amber-400 font-medium">{attentionRows.length} container{attentionRows.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-amber-100 dark:divide-amber-900">
              {shopEntries.map(([shop, ctrs]) => (
                <div key={shop} className="px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400 mb-1.5">{shop} — {ctrs.length}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ctrs.map(r => (
                      <span key={r.id} className="font-mono text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded px-2 py-0.5 text-foreground">
                        {r.containerNumber}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SummaryGroupTable title="Totals by Company"           rows={byCompany} />
        <SummaryGroupTable title="Totals by Transporter"       rows={byTransport} />
        <SummaryGroupTable title="Totals by Agent / Declarant" rows={byAgent} />
      </div>
    </div>
  );
}

// ─── Tab 3: At Port / Sea / Left Dar / In Transit ────────────────────────────
//
// Self-contained: fetches /api/git/containers and groups client-side by status
// bucket. My Company / All Accessible Companies selector.
// Read-only — no mutations.

type PortBucket = {
  key: string;
  label: string;
  statuses: string[];
  headerBg: string;
  headerText: string;
};

const PORT_BUCKETS: PortBucket[] = [
  { key: "otw-sea",    label: "OTW / AT SEA",          statuses: ["OTW", "Sea"],              headerBg: "bg-blue-600",    headerText: "text-white" },
  { key: "at-port",    label: "AT PORT",                statuses: ["At Port"],                 headerBg: "bg-amber-500",   headerText: "text-white" },
  { key: "left-dar",   label: "LEFT DAR",               statuses: ["Left Dar"],                headerBg: "bg-violet-600",  headerText: "text-white" },
  { key: "in-transit", label: "AT BORDER / IN TRANSIT", statuses: ["At Border", "In Transit"], headerBg: "bg-emerald-600", headerText: "text-white" },
  { key: "arrived",    label: "ARRIVED",                statuses: ["Arrived"],                 headerBg: "bg-slate-500",   headerText: "text-white" },
];

function TabPortReport() {
  const [companyMode, setCompanyMode] = useState<CompanyViewMode>("session");

  const queryUrl = companyMode === "all"
    ? "/api/git/containers?allCompanies=true"
    : "/api/git/containers";

  const { data, isLoading, isError, error } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    retry: 1,
  });

  const allContainers: EnrichedContainerApi[] = data?.containers ?? [];

  const modeSelector = (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs text-muted-foreground">Viewing:</span>
      <Button
        size="sm"
        variant={companyMode === "session" ? "default" : "outline"}
        onClick={() => setCompanyMode("session")}
        data-testid="btn-port-mode-session"
      >My Company</Button>
      <Button
        size="sm"
        variant={companyMode === "all" ? "default" : "outline"}
        onClick={() => setCompanyMode("all")}
        data-testid="btn-port-mode-all"
      >All Accessible Companies</Button>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-3">
      {modeSelector}
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-md" />
      ))}
    </div>
  );

  if (isError) return (
    <div className="space-y-3">
      {modeSelector}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">Failed to load container data</div>
          <div className="text-xs mt-0.5">{(error as Error)?.message ?? "Network or server error."}</div>
        </div>
      </div>
    </div>
  );

  const bucketed = PORT_BUCKETS.map(b => ({
    ...b,
    rows: allContainers.filter(r => b.statuses.includes(r.status)),
  }));

  const totalCount = allContainers.length;
  const totalCost  = allContainers.reduce((s, r) => s + parseNum(r.grandTotal), 0);

  return (
    <div className="space-y-4">
      {modeSelector}

      {/* Summary strip */}
      <div className="flex gap-4 flex-wrap p-3 rounded-md border bg-muted/30 text-sm">
        {bucketed.map(b => (
          <div key={b.key} className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">{b.label}:</span>
            <span className="text-sm font-bold">{b.rows.length}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Total:</span>
          <span className="text-sm font-bold">{totalCount}</span>
        </div>
        {totalCost > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">Total Cost:</span>
            <span className="text-sm font-bold text-green-600">${fmt(totalCost, 0)}</span>
          </div>
        )}
      </div>

      {totalCount === 0 && (
        <div className="py-10 text-center text-muted-foreground text-sm">
          No active containers found.
        </div>
      )}

      {bucketed.map(b => {
        const bucketTotal = b.rows.reduce((s, r) => s + parseNum(r.grandTotal), 0);
        const companies   = [...new Set(b.rows.map(r => r.companyName))];

        return (
          <div key={b.key} className="rounded-md border overflow-hidden">
            <div className={cn("flex items-center justify-between px-3 py-1.5", b.headerBg, b.headerText)}>
              <span className="text-sm font-bold">{b.label}</span>
              <span className="text-xs font-semibold opacity-90">
                {b.rows.length} container{b.rows.length !== 1 ? "s" : ""}
                {bucketTotal > 0 ? ` — $${fmt(bucketTotal, 0)}` : ""}
              </span>
            </div>

            {b.rows.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground italic bg-muted/10">
                No containers
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap border-collapse">
                  <thead>
                    <tr className="bg-muted/60 border-b text-muted-foreground">
                      <th className="py-1 px-2 font-semibold text-center">CONTAINER #</th>
                      <th className="py-1 px-2 font-semibold text-center">CO.</th>
                      <th className="py-1 px-2 font-semibold text-center">AMOUNT</th>
                      <th className="py-1 px-2 font-semibold text-center">ETA</th>
                      <th className="py-1 px-2 font-semibold text-center">TRANSPORTER</th>
                      <th className="py-1 px-2 font-semibold text-center">TRUCK #</th>
                      <th className="py-1 px-2 font-semibold text-center">LOCATION</th>
                      <th className="py-1 px-2 font-semibold text-center">BORDER DT.</th>
                      <th className="py-1 px-2 font-semibold text-center">MAX OFFLOAD</th>
                      <th className="py-1 px-2 font-semibold text-center">DOCS RCVD</th>
                      <th className="py-1 px-2 font-semibold text-center">DOCS→TRUCK</th>
                      <th className="py-1 px-2 font-semibold text-center">AGENT</th>
                      <th className="py-1 px-2 font-semibold text-center">NOTES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map(company => {
                      const compRows = b.rows.filter(r => r.companyName === company);
                      return compRows.map((r, idx) => {
                        const rowBg = getRealRowBg(r);
                        return (
                          <tr
                            key={r.id}
                            className={cn(
                              "border-b last:border-b-0 hover:brightness-95",
                              rowBg,
                              idx === 0 ? "border-t border-muted/60" : ""
                            )}
                          >
                            <td className="py-0.5 px-2 font-mono font-bold">{r.containerNumber}</td>
                            <td className="py-0.5 px-2 font-medium">{r.companyName}</td>
                            <td className="py-0.5 px-2 text-right font-semibold">
                              {parseNum(r.grandTotal) > 0 ? `$${fmt(parseNum(r.grandTotal), 0)}` : "—"}
                            </td>
                            <td className="py-0.5 px-2">{fmtD(r.eta)}</td>
                            <td className="py-0.5 px-2">{r.transporter ?? "—"}</td>
                            <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? "—"}</td>
                            <td className="py-0.5 px-2">{r.trackingLocation ?? "—"}</td>
                            <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
                            <td className={cn("py-0.5 px-2", r.daysDelayed ? "text-red-600 font-bold" : "")}>
                              {fmtD(r.maxOffloadDate)}
                              {r.daysDelayed ? <span className="ml-1 text-[10px]">+{r.daysDelayed}d</span> : null}
                            </td>
                            <td className="py-0.5 px-2 text-center">
                              {r.docReceived
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                                : <XCircle className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                            </td>
                            <td className="py-0.5 px-2 text-center">
                              {r.docsSentDate
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mx-auto" />
                                : r.docReceived
                                  ? <span className="text-amber-700 text-[10px] font-medium">READY</span>
                                  : "—"}
                            </td>
                            <td className="py-0.5 px-2">{r.agent ?? "—"}</td>
                            <td className="py-0.5 px-2 max-w-40 truncate text-muted-foreground italic">
                              {r.trackingDescription ?? "—"}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 4: Truck / Location Overview ────────────────────────────────────────
//
// Self-contained: fetches /api/git/containers and groups by transporter (where
// numberPlate is set) + a "No Truck Assigned" section.
// Read-only — no mutations.

function TabTruckLocation() {
  const [companyMode, setCompanyMode] = useState<CompanyViewMode>("session");

  const queryUrl = companyMode === "all"
    ? "/api/git/containers?allCompanies=true&includeOffloaded=true"
    : "/api/git/containers?includeOffloaded=true";

  const { data, isLoading, isError, error } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    retry: 1,
  });

  const allContainers: EnrichedContainerApi[] = data?.containers ?? [];
  const withTruck = allContainers.filter(r => !!(r.numberPlate ?? "").trim());
  const noTruck   = allContainers.filter(r => !(r.numberPlate ?? "").trim());
  const shops = [...new Set(withTruck.map(r => r.shopName ?? r.companyName ?? "Unknown"))].sort();

  // Group by company for multi-company view
  const companyGroups: { id: number; name: string; rows: EnrichedContainerApi[] }[] = [];
  for (const r of withTruck) {
    const existing = companyGroups.find(g => g.id === r.companyId);
    if (existing) existing.rows.push(r);
    else companyGroups.push({ id: r.companyId, name: r.companyName, rows: [r] });
  }
  companyGroups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const modeSelector = (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs text-muted-foreground">Viewing:</span>
      <Button
        size="sm"
        variant={companyMode === "session" ? "default" : "outline"}
        onClick={() => setCompanyMode("session")}
        data-testid="btn-truck-mode-session"
      >My Company</Button>
      <Button
        size="sm"
        variant={companyMode === "all" ? "default" : "outline"}
        onClick={() => setCompanyMode("all")}
        data-testid="btn-truck-mode-all"
      >All Accessible Companies</Button>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-3">
      {modeSelector}
      <Skeleton className="h-48 w-full rounded-md" />
    </div>
  );

  if (isError) return (
    <div className="space-y-3">
      {modeSelector}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <div className="font-semibold">Failed to load container data</div>
          <div className="text-xs mt-0.5">{(error as Error)?.message ?? "Network or server error."}</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {modeSelector}

      {/* Summary strip */}
      <div className="flex gap-4 flex-wrap p-3 rounded-md border bg-muted/30 text-sm">
        <div className="flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">With Truck:</span>
          <span className="font-bold">{withTruck.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">No Truck:</span>
          <span className="font-bold">{noTruck.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Shops:</span>
          <span className="font-bold">{shops.length}</span>
        </div>
      </div>

      {allContainers.length === 0 && (
        <div className="py-10 text-center text-muted-foreground text-sm">
          No active containers found.
        </div>
      )}

      {(companyMode === "all" ? companyGroups : [{ id: 0, name: "", rows: withTruck }]).map(cg => {
        const cgShops = [...new Set(cg.rows.map(r => r.shopName ?? r.companyName ?? "Unknown"))].sort(
          (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
        );
        return (
          <div key={cg.id} className="space-y-1">
            {companyMode === "all" && (
              <div className="px-3 py-1.5 rounded-t-md bg-muted/60 border border-b-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {cg.name} — {cg.rows.length} on the road
              </div>
            )}
            <div className={cn("rounded-md border overflow-hidden", companyMode === "all" && "rounded-t-none")}>
              <table className="w-full text-xs whitespace-nowrap border-collapse">
                <thead>
                  <tr className="bg-yellow-400 text-yellow-950 font-bold border-b-2 border-yellow-600">
                    <th className="py-1.5 px-3 text-center">CONTAINER #</th>
                    <th className="py-1.5 px-3 text-center">SUPPLIER</th>
                    <th className="py-1.5 px-3 text-center">NUMBER PLATE</th>
                    <th className="py-1.5 px-3 text-center">LOCATION</th>
                    <th className="py-1.5 px-3 text-center">AGENT</th>
                    <th className="py-1.5 px-3 text-center">TRANSPORTER</th>
                    <th className="py-1.5 px-3 text-center">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {cgShops.flatMap(shop => {
                    const shopRows = cg.rows.filter(r => (r.shopName ?? r.companyName ?? "Unknown") === shop);
                    const hdrRow = (
                      <tr key={`hdr-${cg.id}-${shop}`} className="bg-yellow-300 border-t border-yellow-500">
                        <td colSpan={7} className="py-1 px-3 font-bold text-yellow-900 text-center tracking-wide uppercase">
                          {shop} — {shopRows.length} container{shopRows.length !== 1 ? "s" : ""} on the road
                        </td>
                      </tr>
                    );
                    const supplierGroups = groupBySupplier(shopRows);
                    const hasMultiSupplier = supplierGroups.length > 1;
                    const dataRows = supplierGroups.flatMap(({ name: supName, rows: supRows }) => {
                      const supHdr = hasMultiSupplier ? (
                        <tr key={`sup-${cg.id}-${shop}-${supName}`} className="bg-muted/40 border-t border-border">
                          <td colSpan={7} className="py-0.5 px-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {supName} — {supRows.length}
                          </td>
                        </tr>
                      ) : null;
                      const rows = supRows.map(r => (
                        <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/40">
                          <td className="py-0.5 px-3 text-center font-mono font-semibold tracking-tight">{r.containerNumber}</td>
                          <td className="py-0.5 px-3 text-center">{r.supplierName ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-0.5 px-3 text-center font-mono">{r.numberPlate ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-0.5 px-3 text-center">{r.trackingLocation ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-0.5 px-3 text-center">{r.agent ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-0.5 px-3 text-center">{r.transporter ?? <span className="text-muted-foreground">—</span>}</td>
                          <td className="py-0.5 px-3 text-center">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", (STATUS_BADGE as Record<string, string>)[r.status] ?? "bg-muted text-foreground")}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ));
                      return supHdr ? [supHdr, ...rows] : rows;
                    });
                    return [hdrRow, ...dataRows];
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab 5: Agent / Duty Overview ────────────────────────────────────────────
//
// Reads from GET /api/git/agent-duty-summary (Phase 2: real backend).
// FIFO allocation is performed server-side. Frontend renders results only.
// Payments remain manual in Accounts / Vouchers. No write mutations here.

// ─── API response types ───────────────────────────────────────────────────────

type WarningCode =
  | "no_open_balance"
  | "ledger_exceeds_containers"
  | "allocation_gap"
  | "fuzzy_match"
  | "no_account_linked";

type ApiAllocStatus = "Cleared" | "Partially Cleared" | "Open";

interface ApiAllocatedRow {
  id: number;
  containerNumber: string;
  companyId: number;
  numberPlate: string | null;
  offloadDate: string | null;
  borderDate: string | null;
  transporter: string | null;
  location: string | null;
  dutyFee: number;
  status: string;
  clearedAmount: number;
  remainingAmount: number;
  allocationStatus: ApiAllocStatus;
  supplierName: string | null;
}

interface ApiPreviewRow {
  id: number;
  containerNumber: string;
  companyId: number;
  numberPlate: string | null;
  borderDate: string | null;
  transporter: string | null;
  location: string | null;
  dutyFee: number;
  status: string;
  supplierName: string | null;
}

interface AgentDutySummary {
  agentName: string;
  ledgerAccountId: number | null;
  ledgerAccountName: string | null;
  matchConfidence: "exact" | "fuzzy" | "unmapped";
  ledgerBalance: number | null;
  containerDutyTotal: number;
  offloadedDutyTotal: number;
  clearedByPayments: number;
  openBalance: number | null;
  warnings: WarningCode[];
  clearedRows: ApiAllocatedRow[];
  partialRows: ApiAllocatedRow[];
  openRows: ApiAllocatedRow[];
  activePreviewRows: ApiPreviewRow[];
}

interface AgentDutyCompanySection {
  companyId: number;
  companyName: string;
  agents: AgentDutySummary[];
}

interface AgentDutyResponseSingle {
  asOf: string;
  mode: "single";
  companyId: number;
  companyName: string;
  agents: AgentDutySummary[];
}

interface AgentDutyResponseAll {
  asOf: string;
  mode: "all";
  companies: AgentDutyCompanySection[];
}

type AgentDutyResponse = AgentDutyResponseSingle | AgentDutyResponseAll;

// ─── Warning banner config ────────────────────────────────────────────────────

const WARNING_META: Record<WarningCode, {
  icon: typeof AlertTriangle;
  className: string;
  message: string;
}> = {
  fuzzy_match: {
    icon: AlertTriangle,
    className: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
    message: "Account linked by fuzzy name match — verify the ledger account is correct. Add an exact mapping in Agent Mappings to suppress this warning.",
  },
  no_account_linked: {
    icon: AlertCircle,
    className: "bg-muted/50 border-border text-muted-foreground",
    message: "No ledger account linked to this agent. Balance shown as unavailable. Add a mapping in Agent Mappings to enable balance tracking.",
  },
  ledger_exceeds_containers: {
    icon: AlertTriangle,
    className: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300",
    message: "Ledger balance exceeds total offloaded duty — there may be payments not matched to any container in this list.",
  },
  allocation_gap: {
    icon: AlertTriangle,
    className: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300",
    message: "Allocation gap detected — the sum of open remaining amounts does not match the account balance. Check for missing or duplicate container rows.",
  },
  no_open_balance: {
    icon: CheckCircle2,
    className: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300",
    message: "Account balance is zero — all offloaded containers are fully cleared by payments.",
  },
};

// ─── Agent card sub-component ─────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AgentDutySummary }) {
  const [showCleared, setShowCleared] = useState(false);
  const [showActive, setShowActive]   = useState(false);

  const {
    agentName, matchConfidence, ledgerAccountName,
    ledgerBalance, containerDutyTotal, offloadedDutyTotal,
    clearedByPayments, openBalance,
    warnings, clearedRows, partialRows, openRows,
  } = agent;

  // Only show containers that have a truck number assigned
  const activePreviewRows = agent.activePreviewRows.filter(r => !!(r.numberPlate ?? "").trim());

  const openAndPartial = [...partialRows, ...openRows];
  const openSum = openAndPartial.reduce((s, r) => s + r.remainingAmount, 0);
  const hasBalance = ledgerBalance !== null;

  const confidenceBadge = {
    exact:    { label: "Exact match",  cls: "bg-green-700 text-white" },
    fuzzy:    { label: "Fuzzy match",  cls: "bg-amber-600 text-white" },
    unmapped: { label: "No mapping",   cls: "bg-muted text-muted-foreground border" },
  }[matchConfidence];

  return (
    <div className="rounded-md border overflow-hidden" data-testid={`agent-card-${agentName}`}>

      {/* ── Agent header ── */}
      <div className="bg-yellow-400 text-yellow-950 px-3 py-2 font-bold text-sm relative flex items-center justify-center gap-2 flex-wrap min-h-[2.5rem]">
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span className="tracking-wide">{agentName}</span>
          <Badge className={cn("text-[10px] font-semibold no-default-active-elevate", confidenceBadge.cls)}>
            {confidenceBadge.label}
          </Badge>
          {ledgerAccountName && (
            <span className="text-[11px] font-normal opacity-80">{ledgerAccountName}</span>
          )}
        </div>
        {hasBalance && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {warnings.includes("no_open_balance")
              ? <Badge className="text-xs bg-green-700 text-white no-default-active-elevate">Fully Cleared</Badge>
              : warnings.includes("allocation_gap")
                ? <Badge className="text-xs bg-red-600 text-white no-default-active-elevate">Allocation Gap</Badge>
                : openBalance !== null && openBalance > 0
                  ? <Badge className="text-xs bg-amber-700 text-white no-default-active-elevate">Open: ${fmt(openBalance, 0)}</Badge>
                  : <Badge className="text-xs bg-green-600 text-white no-default-active-elevate">Balance Allocated</Badge>
            }
          </div>
        )}
      </div>

      {/* ── Warning banners ── */}
      {warnings.map(code => {
        const meta = WARNING_META[code];
        const Icon = meta.icon;
        return (
          <div key={code} className={cn(
            "px-3 py-1.5 border-b text-xs flex gap-2 items-start",
            meta.className
          )}>
            <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{meta.message}</span>
          </div>
        );
      })}


      {/* ── Cleared rows (collapsed) ── */}
      {clearedRows.length > 0 && (
        <>
          <button
            onClick={() => setShowCleared(v => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/40 text-xs hover-elevate"
            data-testid={`button-toggle-cleared-${agentName}`}
          >
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">
              {showCleared ? "Hide" : "Show"} Cleared — {clearedRows.length} containers, ${fmt(clearedByPayments, 0)} cleared
            </span>
            {showCleared ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>

          {showCleared && (
            <div className="overflow-x-auto border-b">
              <table className="w-full text-xs whitespace-nowrap border-collapse">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    {["CONTAINER #","SUPPLIER","PLATE","OFFLOAD DATE","BORDER DATE","TRANSPORTER","LOCATION","DUTY","CLEARED","STATUS"].map(h => (
                      <th key={h} className="py-1 px-2 font-bold text-muted-foreground text-center">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clearedRows.map((r) => (
                    <tr key={r.id} className="border-b bg-muted/15 text-muted-foreground">
                      <td className="py-0.5 px-2 font-mono">{r.containerNumber}</td>
                      <td className="py-0.5 px-2">{r.supplierName ?? "—"}</td>
                      <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? "—"}</td>
                      <td className="py-0.5 px-2">{fmtD(r.offloadDate ?? null)}</td>
                      <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
                      <td className="py-0.5 px-2">{r.transporter ?? "—"}</td>
                      <td className="py-0.5 px-2">{r.location ?? "—"}</td>
                      <td className="py-0.5 px-2 text-right">${fmt(r.dutyFee, 0)}</td>
                      <td className="py-0.5 px-2 text-right text-green-600 dark:text-green-500 font-semibold">${fmt(r.clearedAmount, 0)}</td>
                      <td className="py-0.5 px-2 text-center">
                        <Badge variant="outline" className="text-[10px] text-green-700 border-green-400 no-default-active-elevate">Cleared</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Open / Partial rows (always visible) ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap border-collapse">
          <thead>
            <tr className="bg-yellow-200 text-yellow-900 border-b border-yellow-400">
              {["CONTAINER #","SUPPLIER","PLATE","OFFLOAD DATE","BORDER DATE","TRANSPORTER","LOCATION","DUTY","CLEARED","REMAINING","STATUS"].map(h => (
                <th key={h} className="py-1 px-2 font-bold text-center">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {openAndPartial.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-3 px-3 text-center text-muted-foreground italic text-xs">
                  No open containers — account balance is fully cleared.
                </td>
              </tr>
            ) : (
              openAndPartial.map((r) => (
                <tr key={r.id} className={cn(
                  "border-b",
                  r.allocationStatus === "Partially Cleared" && "bg-amber-50/80 dark:bg-amber-950/20"
                )}>
                  <td className="py-0.5 px-2 font-mono font-semibold">{r.containerNumber}</td>
                  <td className="py-0.5 px-2">{r.supplierName ?? "—"}</td>
                  <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? "—"}</td>
                  <td className="py-0.5 px-2">{fmtD(r.offloadDate ?? null)}</td>
                  <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
                  <td className="py-0.5 px-2">{r.transporter ?? "—"}</td>
                  <td className="py-0.5 px-2">{r.location ?? "—"}</td>
                  <td className="py-0.5 px-2 text-right">${fmt(r.dutyFee, 0)}</td>
                  <td className="py-0.5 px-2 text-right text-green-600 dark:text-green-500">
                    {r.clearedAmount > 0 ? `$${fmt(r.clearedAmount, 0)}` : "—"}
                  </td>
                  <td className="py-0.5 px-2 text-right font-semibold">${fmt(r.remainingAmount, 0)}</td>
                  <td className="py-0.5 px-2 text-center">
                    {r.allocationStatus === "Partially Cleared"
                      ? <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400 no-default-active-elevate">Partial</Badge>
                      : <Badge variant="outline" className="text-[10px] no-default-active-elevate">Open</Badge>
                    }
                  </td>
                </tr>
              ))
            )}

            {/* Open balance footer row */}
            {hasBalance && (
              <tr className="bg-yellow-400 text-yellow-950 font-bold">
                <td colSpan={9} className="py-1.5 px-2 text-xs uppercase tracking-wide">
                  Open Balance (= Account Balance)
                </td>
                <td className="py-1.5 px-2 text-right text-sm">${fmt(openBalance ?? openSum, 0)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Active / Preview rows (collapsed) ── */}
      {activePreviewRows.length > 0 && (
        <>
          <button
            onClick={() => setShowActive(v => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-sky-50 dark:bg-sky-950/20 border-t border-sky-200 dark:border-sky-800 text-xs hover-elevate"
            data-testid={`button-toggle-active-${agentName}`}
          >
            <span className="font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
              {showActive ? "Hide" : "Show"} Active / In Transit — {activePreviewRows.length} containers,{" "}
              ${fmt(activePreviewRows.reduce((s, r) => s + r.dutyFee, 0), 0)} upcoming duty
            </span>
            {showActive ? <ChevronUp className="h-3.5 w-3.5 text-sky-600" /> : <ChevronDown className="h-3.5 w-3.5 text-sky-600" />}
          </button>

          {showActive && (
            <div className="overflow-x-auto border-t border-sky-200 dark:border-sky-800">
              <table className="w-full text-xs whitespace-nowrap border-collapse">
                <thead>
                  <tr className="bg-sky-100 dark:bg-sky-950/30 border-b text-sky-800 dark:text-sky-300">
                    {["CONTAINER #","SUPPLIER","PLATE","BORDER DATE","TRANSPORTER","LOCATION","STATUS","DUTY"].map(h => (
                      <th key={h} className="py-1 px-2 font-bold text-center">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePreviewRows.map((r) => (
                    <tr key={r.id} className="border-b bg-sky-50/30 dark:bg-sky-950/10 text-muted-foreground">
                      <td className="py-0.5 px-2 font-mono">{r.containerNumber}</td>
                      <td className="py-0.5 px-2">{r.supplierName ?? "—"}</td>
                      <td className="py-0.5 px-2 font-mono">{r.numberPlate ?? "—"}</td>
                      <td className="py-0.5 px-2">{fmtD(r.borderDate)}</td>
                      <td className="py-0.5 px-2">{r.transporter ?? "—"}</td>
                      <td className="py-0.5 px-2">{r.location ?? "—"}</td>
                      <td className="py-0.5 px-2 text-center">
                        <Badge variant="outline" className="text-[10px] no-default-active-elevate">{r.status}</Badge>
                      </td>
                      <td className="py-0.5 px-2 text-right">${fmt(r.dutyFee, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tab 5 wrapper with data fetching ────────────────────────────────────────

function TabAgentDuty() {
  const [companyMode, setCompanyMode] = useState<CompanyViewMode>("session");
  const [mergeAgents, setMergeAgents] = useState(true);

  const queryUrl =
    companyMode === "all"
      ? "/api/git/agent-duty-summary?allCompanies=true"
      : "/api/git/agent-duty-summary";

  const { data, isLoading, isError, error } = useQuery<AgentDutyResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    retry: 1,
  });

  // Normalise to an array of company sections for uniform rendering.
  // Computed before any early return so it is always available in all render paths.
  const sections: AgentDutyCompanySection[] = !data
    ? []
    : data.mode === "all"
    ? data.companies
    : [{ companyId: data.companyId, companyName: data.companyName, agents: data.agents }];

  // When viewing all companies with merge on, collapse same-named agents into one card.
  const CONF_RANK: Record<AgentDutySummary["matchConfidence"], number> = { exact: 0, fuzzy: 1, unmapped: 2 };
  const displaySections: AgentDutyCompanySection[] = useMemo(() => {
    if (!mergeAgents || companyMode !== "all" || sections.length <= 1) return sections;
    const agentMap = new Map<string, AgentDutySummary[]>();
    for (const section of sections) {
      for (const agent of section.agents) {
        const key = agent.agentName.trim().toLowerCase();
        if (!agentMap.has(key)) agentMap.set(key, []);
        agentMap.get(key)!.push(agent);
      }
    }
    const merged: AgentDutySummary[] = [];
    for (const [, group] of agentMap) {
      if (group.length === 1) { merged.push(group[0]); continue; }
      const hasNullBalance = group.some(a => a.ledgerBalance === null);
      const hasNullOpen    = group.some(a => a.openBalance === null);
      const accountNames   = [...new Set(group.map(a => a.ledgerAccountName).filter(Boolean))];
      const worstConf      = group.reduce<AgentDutySummary["matchConfidence"]>(
        (best, a) => CONF_RANK[a.matchConfidence] > CONF_RANK[best] ? a.matchConfidence : best,
        "exact"
      );
      merged.push({
        agentName:          group[0].agentName,
        ledgerAccountId:    null,
        ledgerAccountName:  accountNames.length > 0 ? accountNames.join(" / ") : null,
        matchConfidence:    worstConf,
        ledgerBalance:      hasNullBalance ? null : group.reduce((s, a) => s + a.ledgerBalance!, 0),
        containerDutyTotal: group.reduce((s, a) => s + a.containerDutyTotal, 0),
        offloadedDutyTotal: group.reduce((s, a) => s + a.offloadedDutyTotal, 0),
        clearedByPayments:  group.reduce((s, a) => s + a.clearedByPayments, 0),
        openBalance:        hasNullOpen ? null : group.reduce((s, a) => s + a.openBalance!, 0),
        warnings:           [...new Set(group.flatMap(a => a.warnings))],
        clearedRows:        group.flatMap(a => a.clearedRows),
        partialRows:        group.flatMap(a => a.partialRows),
        openRows:           group.flatMap(a => a.openRows),
        activePreviewRows:  group.flatMap(a => a.activePreviewRows),
      });
    }
    merged.sort((a, b) => a.agentName.localeCompare(b.agentName));
    return [{ companyId: 0, companyName: "All Companies", agents: merged }];
  }, [sections, mergeAgents, companyMode]);

  const totalAgents = displaySections.reduce((s, c) => s + c.agents.length, 0);
  const asOf = data?.asOf;

  // ── Company selector (rendered in every path so the user can switch while loading/errored) ──
  const modeSelector = (
    <div className="flex items-center gap-2 flex-wrap" data-testid="agent-duty-mode-selector">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground">View:</span>
      <Button
        size="sm"
        variant={companyMode === "session" ? "default" : "outline"}
        className="text-xs gap-1.5"
        onClick={() => setCompanyMode("session")}
        data-testid="button-agent-duty-my-company"
      >
        My Company
      </Button>
      <Button
        size="sm"
        variant={companyMode === "all" ? "default" : "outline"}
        className="text-xs gap-1.5"
        onClick={() => setCompanyMode("all")}
        data-testid="button-agent-duty-all-companies"
      >
        All Accessible Companies
      </Button>
      {companyMode === "all" && (
        <Button
          size="sm"
          variant="outline"
          className={cn("text-xs gap-1.5 toggle-elevate", mergeAgents && "toggle-elevated")}
          onClick={() => setMergeAgents(v => !v)}
          data-testid="button-agent-duty-merge"
        >
          <Layers className="h-3 w-3" />
          Merge same agents
        </Button>
      )}
    </div>
  );

  // ── Info banner (rendered in main path and loading path) ──
  const infoBanner = (
    <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2 text-xs text-blue-800 dark:text-blue-300 flex gap-2 items-start">
      <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="flex-1">
        <strong>Balance Allocation — reporting view only.</strong>{" "}
        Payments are posted manually in Accounts / Vouchers. This tab allocates the current
        ledger balance to containers <em>oldest-offloaded-first</em>. No records are created or
        edited by this view.
      </div>
      {asOf && (
        <span className="shrink-0 text-[10px] text-blue-600 dark:text-blue-400 whitespace-nowrap">
          As of {new Date(asOf).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-4">
        {infoBanner}
        {modeSelector}
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-md border overflow-hidden">
            <Skeleton className="h-9 w-full rounded-none" />
            <div className="grid grid-cols-4 divide-x border-b">
              {[1,2,3,4].map(j => (
                <div key={j} className="px-2 py-3 space-y-1.5">
                  <Skeleton className="h-2.5 w-20 mx-auto" />
                  <Skeleton className="h-4 w-16 mx-auto" />
                  <Skeleton className="h-2 w-12 mx-auto" />
                </div>
              ))}
            </div>
            <div className="p-3 space-y-1.5">
              {[1,2,3].map(j => <Skeleton key={j} className="h-5 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (isError) {
    return (
      <div className="space-y-4">
        {infoBanner}
        {modeSelector}
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/20 px-4 py-3 flex gap-3 items-start text-sm text-red-800 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Failed to load Agent / Duty data</div>
            <div className="text-xs mt-0.5 text-red-700 dark:text-red-400">
              {(error as Error)?.message ?? "Network or server error. Try refreshing the page."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (totalAgents === 0) {
    return (
      <div className="space-y-4">
        {infoBanner}
        {modeSelector}
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-muted-foreground text-sm">
          <FileX className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <div className="font-medium">No agent / duty data found</div>
          <div className="text-xs mt-1">
            {companyMode === "all"
              ? "No containers with a non-zero duty fee and agent name exist across accessible companies."
              : "No containers with a non-zero duty fee and agent name exist for this company."}
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ──
  return (
    <div className="space-y-4">
      {infoBanner}
      {modeSelector}

      {displaySections.map(section => (
        <div key={section.companyId} className="space-y-4" data-testid={`company-section-${section.companyId}`}>

          {/* Company heading — shown only in all-companies mode without merge */}
          {companyMode === "all" && !(mergeAgents && displaySections.length === 1) && (
            <div className="flex items-center gap-2 pt-1">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold tracking-wide">{section.companyName}</span>
              <Badge variant="outline" className="text-xs no-default-active-elevate">
                {section.agents.length} {section.agents.length === 1 ? "agent" : "agents"}
              </Badge>
              <div className="flex-1 border-t" />
            </div>
          )}

          {/* Empty section (possible when a company has no agent data) */}
          {section.agents.filter(a => a.activePreviewRows.length > 0 && (a.openBalance === null || a.openBalance !== 0)).length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
              <FileX className="h-6 w-6 mx-auto mb-1.5 opacity-40" />
              <div className="text-xs">No agent / duty data for {section.companyName}</div>
            </div>
          ) : (
            section.agents
              .filter(agent => agent.activePreviewRows.length > 0 && (agent.openBalance === null || agent.openBalance !== 0))
              .map(agent => (
                <AgentCard
                  key={`${section.companyId}-${agent.agentName}`}
                  agent={agent}
                />
              ))
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tab 6: WhatsApp Preview ──────────────────────────────────────────────────
//
// Self-contained — fetches /api/git/containers and builds a WhatsApp-style
// plain-text daily report from real container data.
// My Company / All Accessible Companies selector.
// Read-only — no mutations, no WhatsApp send API calls.

function TabWhatsApp() {
  const [companyMode, setCompanyMode] = useState<CompanyViewMode>("session");
  const [inclTrucks,  setInclTrucks]  = useState(false);
  const [inclAgents,  setInclAgents]  = useState(false);
  const [copied,      setCopied]      = useState(false);

  const queryUrl = companyMode === "all"
    ? "/api/git/containers?allCompanies=true"
    : "/api/git/containers";

  const { data, isLoading, isError, error } = useQuery<GitContainersResponse>({
    queryKey: [queryUrl],
    staleTime: 60_000,
    retry: 1,
  });

  const containers: EnrichedContainerApi[] = data?.containers ?? [];

  // ── Status counts ────────────────────────────────────────────────────────────
  const seaOtw    = containers.filter(r => r.status === "OTW" || r.status === "Sea").length;
  const atPort    = containers.filter(r => r.status === "At Port").length;
  const leftDar   = containers.filter(r => r.status === "Left Dar").length;
  const inTransit = containers.filter(r => ["At Border", "In Transit"].includes(r.status)).length;
  const arrived   = containers.filter(r => r.status === "Arrived").length;

  // ── Attention lists ──────────────────────────────────────────────────────────
  const delayed   = containers.filter(r => r.daysDelayed !== null && r.daysDelayed > 0);
  const docsReady = containers.filter(r => r.docsReadyNotSent);
  const docsMiss  = containers.filter(r => !r.docReceived);
  const overdue   = containers.filter(r => r.isOverdue);

  // ── Financial totals ─────────────────────────────────────────────────────────
  const totalCost = containers.reduce((s, r) => s + parseNum(r.grandTotal), 0);
  const totalFee  = containers.reduce((s, r) => s + parseNum(r.transportFee), 0);
  const totalDuty = containers.reduce((s, r) => s + parseNum(r.dutyFee), 0);

  // ── By company ───────────────────────────────────────────────────────────────
  const companies    = [...new Set(containers.map(r => r.companyName))].sort();
  const companyLines = companies.map(c => {
    const sub  = containers.filter(r => r.companyName === c);
    const cost = sub.reduce((s, r) => s + parseNum(r.grandTotal), 0);
    return `• ${c}: ${sub.length} ctr${cost > 0 ? ` — $${fmt(cost, 0)}` : ""}`;
  });

  // ── By transporter ───────────────────────────────────────────────────────────
  const tpNames   = [...new Set(containers.filter(r => r.transporter).map(r => r.transporter!))].sort();
  const noTpCount = containers.filter(r => !r.transporter).length;
  const tpLines   = [
    ...tpNames.map(tp => {
      const sub = containers.filter(r => r.transporter === tp);
      const fee = sub.reduce((s, r) => s + parseNum(r.transportFee), 0);
      return `• ${tp}: ${sub.length} ctr${fee > 0 ? ` — $${fmt(fee, 0)}` : ""}`;
    }),
    ...(noTpCount > 0 ? [`• Unassigned: ${noTpCount} ctr`] : []),
  ];

  // ── By agent / declarant ─────────────────────────────────────────────────────
  const agentNames = [...new Set(containers.filter(r => r.agent).map(r => r.agent!))].sort();
  const agentLines = agentNames.map(ag => {
    const sub  = containers.filter(r => r.agent === ag);
    const duty = sub.reduce((s, r) => s + parseNum(r.dutyFee), 0);
    return `• ${ag}: ${sub.length} ctr${duty > 0 ? ` — $${fmt(duty, 0)} duty` : ""}`;
  });

  const today = new Date()
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toUpperCase();

  // ── Optional: Truck / Location section ───────────────────────────────────────
  const truckLines: string[] = inclTrucks ? (() => {
    const withTruck = containers.filter(r => !!(r.numberPlate ?? "").trim());
    if (withTruck.length === 0) return [``, `*TRUCK / LOCATION STATUS*`, `• No containers on the road`];
    const tps = [...new Set(withTruck.map(r => r.transporter ?? "Unknown"))].sort();
    return [
      ``,
      `*TRUCK / LOCATION STATUS (${withTruck.length} on the road)*`,
      ...tps.flatMap(tp => {
        const rows = withTruck.filter(r => (r.transporter ?? "Unknown") === tp);
        return [
          `${tp} (${rows.length}):`,
          ...rows.map(r =>
            `  ${r.containerNumber} | ${r.companyName} | ${r.numberPlate ?? "—"} | ${r.trackingLocation ?? "—"} | ${r.agent ?? "—"}`
          ),
        ];
      }),
    ];
  })() : [];

  // ── Optional: Agent / Duty section ───────────────────────────────────────────
  const dutyLines: string[] = inclAgents ? [
    ``,
    `*AGENT / DUTY SUMMARY*`,
    ...(agentLines.length > 0 ? agentLines : [`• No agent data`]),
    `• Active Duty Total: $${fmt(totalDuty, 0)}`,
  ] : [];

  // ── Full message ─────────────────────────────────────────────────────────────
  const lines = [
    `*GIT DAILY REPORT — ${today}*`,
    ``,
    `*ACTIVE CONTAINERS: ${containers.length}*`,
    `• OTW / At Sea:      ${seaOtw}`,
    `• At Port (Dar):     ${atPort}`,
    `• Left Dar:          ${leftDar}`,
    `• In Transit:        ${inTransit}`,
    `• Arrived:           ${arrived}`,
    ``,
    `*FINANCIALS*`,
    `• Container Cost:    $${fmt(totalCost, 0)}`,
    `• Transport Fees:    $${fmt(totalFee, 0)}`,
    `• Duty Fees:         $${fmt(totalDuty, 0)}`,
    `• Total Fees:        $${fmt(totalFee + totalDuty, 0)}`,
    ``,
    `*BY COMPANY*`,
    ...(companyLines.length > 0 ? companyLines : [`• No data`]),
    ``,
    `*BY TRANSPORTER*`,
    ...(tpLines.length > 0 ? tpLines : [`• No data`]),
    ``,
    `*BY AGENT / DECLARANT*`,
    ...(agentLines.length > 0 ? agentLines : [`• No data`]),
    ...(delayed.length > 0 ? [
      ``,
      `⚠ *DELAYED — ${delayed.length}*`,
      ...delayed.map(r => `• ${r.containerNumber} +${r.daysDelayed}d [${r.companyName}] ${r.transporter ?? "no transporter"}`),
    ] : []),
    ...(overdue.length > 0 ? [
      ``,
      `! *OFFLOAD OVERDUE — ${overdue.length}*`,
      ...overdue.map(r => `• ${r.containerNumber} [${r.companyName}]`),
    ] : []),
    ...(docsReady.length > 0 ? [
      ``,
      `*DOCS READY — NOT SENT TO TRUCK (${docsReady.length})*`,
      ...docsReady.map(r => `• ${r.containerNumber} → ${r.transporter ?? "no transporter"}`),
    ] : []),
    ...(docsMiss.length > 0 ? [
      ``,
      `*DOCS MISSING — ${docsMiss.length}*`,
      ...docsMiss.map(r => `• ${r.containerNumber} [${r.companyName}] ETA ${fmtD(r.eta)}`),
    ] : []),
    ...(containers.filter(r => r.trackingLink).length > 0 ? [
      ``,
      `*TRACKING LINKS*`,
      ...containers.filter(r => r.trackingLink).map(r => `${r.containerNumber}: ${r.trackingLink}`),
    ] : []),
    ...truckLines,
    ...dutyLines,
  ];

  const text = lines.join("\n");

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const modeSelector = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Viewing:</span>
      <Button
        size="sm"
        variant={companyMode === "session" ? "default" : "outline"}
        onClick={() => setCompanyMode("session")}
        data-testid="btn-wa-mode-session"
      >
        My Company
      </Button>
      <Button
        size="sm"
        variant={companyMode === "all" ? "default" : "outline"}
        onClick={() => setCompanyMode("all")}
        data-testid="btn-wa-mode-all"
      >
        All Accessible Companies
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-3 max-w-2xl">
        {modeSelector}
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-3 max-w-2xl">
        {modeSelector}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Failed to load container data</div>
            <div className="text-xs mt-0.5">{(error as Error)?.message ?? "Network or server error."}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center gap-2 flex-wrap">
        <MessageSquare className="h-4 w-4 text-green-600" />
        <p className="text-sm font-medium">Daily WhatsApp GIT Report</p>
        <Badge variant="outline" className="text-xs">Text preview — no PDF / image</Badge>
      </div>

      {modeSelector}

      {/* Optional toggles + copy */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Include optional sections:</span>
        <Button
          size="sm"
          variant={inclTrucks ? "default" : "outline"}
          className="gap-1.5 text-xs"
          onClick={() => setInclTrucks(v => !v)}
          data-testid="button-wa-trucks"
        >
          <Truck className="h-3 w-3" />
          Truck / Location
        </Button>
        <Button
          size="sm"
          variant={inclAgents ? "default" : "outline"}
          className="gap-1.5 text-xs"
          onClick={() => setInclAgents(v => !v)}
          data-testid="button-wa-duty"
        >
          <DollarSign className="h-3 w-3" />
          Agent / Duty
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs ml-auto"
          onClick={handleCopy}
          data-testid="button-wa-copy"
        >
          {copied
            ? <CheckCircle2 className="h-3 w-3 text-green-600" />
            : <MessageSquare className="h-3 w-3" />}
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>

      {containers.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm border rounded-lg border-dashed">
          <FileX className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <div className="font-medium">No active containers found</div>
          <div className="text-xs mt-1">
            {companyMode === "all"
              ? "No containers exist across accessible companies."
              : "No containers exist for this company."}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-[#e5ddd5] dark:bg-zinc-800 p-3">
          <div className="bg-white dark:bg-zinc-700 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-[600px] overflow-y-auto">
            {text}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Text preview only. Copy and send manually to the WhatsApp group — no automated sending.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GITMockup({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!embedded && (
        <PageHeader
          title="GIT"
          subtitle="Daily goods-in-transit workbook — spreadsheet replacement"
        />
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Status banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 text-sm text-blue-800 dark:text-blue-300">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            <strong>All tabs</strong> use real database data.{" "}
            <span className="text-blue-600 dark:text-blue-400">WhatsApp preview is read-only — no automated sending.</span>
          </span>
          <Badge variant="outline" className="ml-auto text-xs shrink-0 border-blue-400 text-blue-700 dark:text-blue-400">
            <FileSpreadsheet className="h-3 w-3 mr-1" />
            GIT Workbook
          </Badge>
        </div>

        <Tabs defaultValue="detail">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="summary"  data-testid="tab-git-summary">Summary</TabsTrigger>
            <TabsTrigger value="detail"   data-testid="tab-git-detail">Detail</TabsTrigger>
            <TabsTrigger value="trucks"   data-testid="tab-git-trucks">Truck / Location</TabsTrigger>
            <TabsTrigger value="agents"   data-testid="tab-git-agents">Agent / Duty</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            <TabSummary />
          </TabsContent>

          <TabsContent value="detail" className="mt-4">
            <TabDetail />
          </TabsContent>

          <TabsContent value="trucks" className="mt-4">
            <TabTruckLocation />
          </TabsContent>

          <TabsContent value="agents" className="mt-4">
            <TabAgentDuty />
          </TabsContent>

        </Tabs>

      </div>
    </div>
  );
}
