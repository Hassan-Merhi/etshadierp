  import { useState, useEffect, useRef } from "react";
  import { useConnectivity } from "@/contexts/ConnectivityContext";
  import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
  import { OfflinePrepPanel } from "@/components/OfflinePrepPanel";
  import { useForm } from "react-hook-form";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { z } from "zod";
  import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "@/components/ui/dialog";
  import { Alert, AlertDescription } from "@/components/ui/alert";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
  } from "@/components/ui/alert-dialog";
  import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
  } from "@/components/ui/form";
  import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  } from "@/components/ui/select";
  import { Checkbox } from "@/components/ui/checkbox";
  import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  } from "@/components/ui/table";
  import { Badge } from "@/components/ui/badge";
  import { Skeleton } from "@/components/ui/skeleton";
  import { Switch } from "@/components/ui/switch";
  
  import { useToast } from "@/hooks/use-toast";
  import { useMutation, useQuery } from "@tanstack/react-query";
  import { queryClient, apiRequest } from "@/lib/queryClient";
  import { useAppMode } from "@/contexts/AppModeContext";
  import { getApiRequest, factoryApiRequest } from "@/lib/factoryApi";
  import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import { Plus, Edit, Building2, Users, ChevronDown, ChevronUp, Trash2, CalendarRange, Settings2, Wrench, MapPin, ChevronRight, Bot, MessageCircle, RefreshCw, Calculator, Loader2, Shield, AlertTriangle, PieChart, Key, Lock, Package, Eye, History, Clock, Upload, Download, Database, TrendingUp, ShoppingCart, Check, X, Copy, ExternalLink, ArrowLeftRight, WifiOff, Wifi, CheckCircle2, Printer, Layers } from "lucide-react";
import { utils, writeFile, readFile, read, ExcelJS } from "@/lib/excelHelper";
  import { Link } from "wouter";
  import { useDateFormat } from "@/contexts/DateFormatContext";
  import { insertUserSchema, insertCompanySchema, insertUserCompanyRoleSchema, FEATURE_KEYS, FEATURE_PAGE_INFO, type FeatureKey } from "@shared/schema";
  import { FACTORY_NAV_PAGES } from "@/components/FactorySidebar";
  import { FiscalPeriodTab } from "@/components/FiscalPeriodTab";
  import { useCompany } from "@/contexts/CompanyContext";
  import { ExchangeRateSettings } from "@/components/ExchangeRateSettings";
  import { formatNumber } from "@/lib/formatNumber";
  
  const userFormSchema = insertUserSchema;
  const companyFormSchema = insertCompanySchema;
  const roleAssignmentSchema = insertUserCompanyRoleSchema.refine(
    (data) => {
      // If role is POS, assignedLocationId must be present
      if (data.role.startsWith("POS") && !data.assignedLocationId) {
        return false;
      }
      return true;
    },
    {
      message: "POS roles require an assigned location",
      path: ["assignedLocationId"],
    }
  );
  
  type UserFormData = z.infer<typeof userFormSchema>;
  type CompanyFormData = z.infer<typeof companyFormSchema>;
  type RoleAssignmentData = z.infer<typeof roleAssignmentSchema>;


export function fmtDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    + " " + dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function fieldLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
}

export function fmtValue(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  // try to detect ISO date strings
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }
  return s;
}

export function getRecordLabel(log: any): string {
  if (log.recordIdentifier) {
    const id = log.recordIdentifier as string;
    // already short (e.g. PAYMENT-123, INV-456) — return as-is unless very long
    if (id.length <= 40) return id;
    return id.slice(0, 38) + "…";
  }
  if (log.recordId) return `${log.tableName} #${log.recordId}`;
  return log.tableName;
}

export function getChangesSummary(log: any): string {
  const c = log.changes;
  if (!c) return "—";

  if (log.action === "create") {
    const type = c.voucherType?.new ?? c.type?.new ?? "";
    const amount = c.amount?.new ? ` ${parseFloat(c.amount.new).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "";
    const date = c.date?.new ? ` — ${c.date.new}` : "";
    if (type) return `Created ${type}${amount}${date}`;
    const n = Object.keys(c).filter(k => k !== "entries").length;
    return `Created (${n} field${n !== 1 ? "s" : ""})`;
  }

  if (log.action === "delete") {
    const type = c.voucherType?.old ?? c.type?.old ?? "";
    const amount = c.amount?.old ? ` ${parseFloat(c.amount.old).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "";
    const date = c.date?.old ? ` — ${c.date.old}` : "";
    if (type) return `Deleted ${type}${amount}${date}`;
    return "Deleted";
  }

  // update — show first 2 changed scalar fields
  const SKIP = new Set(["entries"]);
  const parts: string[] = [];
  for (const [key, vals] of Object.entries(c)) {
    if (SKIP.has(key)) continue;
    const v = vals as any;
    const label = key === "date" ? "Date"
      : key === "amount" ? "Amount"
      : key === "description" ? "Description"
      : key === "location" ? "Location"
      : key === "optional" ? "Status"
      : fieldLabel(key);
    const oldVal = fmtValue(v?.old);
    const newVal = fmtValue(v?.new);
    parts.push(`${label}: ${oldVal} → ${newVal}`);
    if (parts.length >= 2) break;
  }
  if (c.entries && !parts.length) parts.push("Entries changed");
  if (!parts.length) {
    const n = Object.keys(c).length;
    return `${n} field${n !== 1 ? "s" : ""} changed`;
  }
  return parts.join(", ");
}

export function tableShortName(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Entries mini-table (for voucher entry snapshots) ──────────────────────────
function EntriesTable({ entries }: { entries: any[] }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="text-xs w-full">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Account</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Debit</th>
            <th className="text-right px-2 py-1.5 text-muted-foreground font-medium">Credit</th>
            <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e: any, i: number) => (
            <tr key={i} className="border-b last:border-0">
              <td className="px-2 py-1">{e.account ?? "—"}</td>
              <td className={`text-right px-2 py-1 ${parseFloat(e.debit) > 0 ? "font-medium" : "text-muted-foreground"}`}>
                {parseFloat(e.debit) > 0 ? e.debit : "—"}
              </td>
              <td className={`text-right px-2 py-1 ${parseFloat(e.credit) > 0 ? "font-medium" : "text-muted-foreground"}`}>
                {parseFloat(e.credit) > 0 ? e.credit : "—"}
              </td>
              <td className="px-2 py-1 text-muted-foreground">{e.narration ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Detail Dialog ─────────────────────────────────────────────────────────────

export function AuditLogDialog({ log, onClose }: { log: any; onClose: () => void }) {
  const { toast } = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const changes: Record<string, { old?: any; new?: any }> = log.changes || {};
  const changedFields = Object.entries(changes);
  const isDelete = log.action === "delete";
  const isCreate = log.action === "create";
  const isUpdate = log.action === "update";

  const copyJson = async (obj: any) => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2)).then(() => {
      toast({ title: "Copied", description: "JSON copied to clipboard." });
    });
  };

  const renderFieldValue = (field: string, vals: any, side: "old" | "new") => {
    const raw = vals?.[side];
    if (field === "entries" && Array.isArray(raw)) {
      return <EntriesTable entries={raw} />;
    }
    const color = side === "old"
      ? "text-destructive"
      : "text-green-600 dark:text-green-400";
    return <span className={color}>{fmtValue(raw)}</span>;
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            Audit Detail
          </DialogTitle>
        </DialogHeader>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm border rounded-md p-3 bg-muted/30">
          <div className="text-muted-foreground">User</div>
          <div className="font-medium">{log.username || "Unknown"}</div>
          <div className="text-muted-foreground">Date</div>
          <div>{fmtDate(log.createdAt)}</div>
          <div className="text-muted-foreground">Action</div>
          <div>
            <Badge variant={log.action === "delete" ? "destructive" : log.action === "create" ? "default" : "secondary"} className="capitalize">
              {log.action}
            </Badge>
          </div>
          <div className="text-muted-foreground">Module</div>
          <div>{tableShortName(log.tableName)}</div>
          <div className="text-muted-foreground">Record</div>
          <div className="font-mono text-xs">{log.recordIdentifier || (log.recordId ? `#${log.recordId}` : "—")}</div>
        </div>

        {/* Changes */}
        {changedFields.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {isDelete ? "Deleted Snapshot" : isCreate ? "Created Values" : "Changed Fields"}
            </p>
            <div className="rounded-md border divide-y text-sm">
              {changedFields.map(([field, vals]) => {
                const isEntries = field === "entries";
                return (
                  <div key={field} className={isEntries ? "px-3 py-2 space-y-1" : "grid grid-cols-[160px_1fr] gap-2 px-3 py-2"}>
                    <span className={`text-muted-foreground font-medium ${isEntries ? "block text-xs uppercase tracking-wide" : ""}`}>
                      {fieldLabel(field)}
                    </span>
                    {isEntries ? (
                      isUpdate ? (
                        <div className="space-y-2 mt-1">
                          <div>
                            <span className="text-xs text-muted-foreground uppercase tracking-wide">Before</span>
                            <EntriesTable entries={(vals as any)?.old ?? []} />
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground uppercase tracking-wide">After</span>
                            <EntriesTable entries={(vals as any)?.new ?? []} />
                          </div>
                        </div>
                      ) : isCreate ? (
                        <EntriesTable entries={(vals as any)?.new ?? []} />
                      ) : (
                        <EntriesTable entries={(vals as any)?.old ?? []} />
                      )
                    ) : (
                      <div>
                        {isCreate ? (
                          renderFieldValue(field, vals, "new")
                        ) : isDelete ? (
                          renderFieldValue(field, vals, "old")
                        ) : (
                          <span className="flex flex-wrap gap-1 items-center">
                            {renderFieldValue(field, vals, "old")}
                            <span className="text-muted-foreground">→</span>
                            {renderFieldValue(field, vals, "new")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Advanced */}
        <div>
          <Button variant="ghost" size="sm" className="gap-1 px-0 text-muted-foreground" onClick={() => setShowAdvanced(v => !v)}>
            <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            Advanced (raw JSON)
          </Button>
          {showAdvanced && (
            <div className="mt-2 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Full changes object</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyJson(log.changes)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(log.changes, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Log Table ────────────────────────────────────────────────────────────

export function EditLogTable({ companyId }: { companyId?: number }) {
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [filterAction, setFilterAction] = useState("");
  const [filterModule, setFilterModule] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const buildUrl = () => {
    const p = new URLSearchParams();
    if (filterAction) p.set("action", filterAction);
    if (filterModule) p.set("tableName", filterModule);
    if (filterSearch.trim()) p.set("search", filterSearch.trim());
    if (filterDateFrom) p.set("dateFrom", filterDateFrom);
    if (filterDateTo) p.set("dateTo", filterDateTo);
    const qs = p.toString();
    return `/api/audit-log${qs ? `?${qs}` : ""}`;
  };

  const queryUrl = buildUrl();

  const { data: auditLogs = [], isLoading, error } = useQuery<any[]>({
    queryKey: ["audit-log", companyId, filterAction, filterModule, filterSearch, filterDateFrom, filterDateTo],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!companyId,
  });

  const knownModules = [...new Set(auditLogs.map((l: any) => l.tableName))].sort();

  if (!companyId) return <p className="text-muted-foreground">Select a company to view edit logs.</p>;

  return (
    <>
      {selectedLog && <AuditLogDialog log={selectedLog} onClose={() => setSelectedLog(null)} />}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Input
          placeholder="Search by record…"
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
          className="h-8 w-44 text-sm"
          data-testid="input-audit-search"
        />
        <Select value={filterAction || "all"} onValueChange={v => setFilterAction(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-32 text-sm" data-testid="select-audit-action">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="create">Create</SelectItem>
            <SelectItem value="update">Update</SelectItem>
            <SelectItem value="delete">Delete</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterModule || "all"} onValueChange={v => setFilterModule(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 w-36 text-sm" data-testid="select-audit-module">
            <SelectValue placeholder="Module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modules</SelectItem>
            {knownModules.map(m => (
              <SelectItem key={m} value={m}>{tableShortName(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={filterDateFrom}
          onChange={e => setFilterDateFrom(e.target.value)}
          className="h-8 w-36 text-sm"
          data-testid="input-audit-date-from"
        />
        <Input
          type="date"
          value={filterDateTo}
          onChange={e => setFilterDateTo(e.target.value)}
          className="h-8 w-36 text-sm"
          data-testid="input-audit-date-to"
        />
        {(filterAction || filterModule || filterSearch || filterDateFrom || filterDateTo) && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => {
            setFilterAction(""); setFilterModule(""); setFilterSearch("");
            setFilterDateFrom(""); setFilterDateTo("");
          }} data-testid="button-audit-clear-filters">
            <X className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      {isLoading && <div className="flex items-center gap-2 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {error && <p className="text-destructive">Error loading audit logs.</p>}
      {!isLoading && !error && auditLogs.length === 0 && (
        <p className="text-muted-foreground py-4">No edit logs found. Changes will appear here when records are modified.</p>
      )}

      {!isLoading && auditLogs.length > 0 && (
        <div className="table-responsive">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Date</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log: any) => (
                <TableRow
                  key={log.id}
                  className="group cursor-pointer hover-elevate"
                  onClick={() => setSelectedLog(log)}
                  data-testid={`log-row-${log.id}`}
                >
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{fmtDate(log.createdAt)}</TableCell>
                  <TableCell className="text-sm font-medium">
                    {log.username && log.username !== "unknown" ? log.username : <span className="text-muted-foreground italic">Unknown</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.action === "delete" ? "destructive" : log.action === "create" ? "default" : "secondary"} className="capitalize text-xs">
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{tableShortName(log.tableName)}</TableCell>
                  <TableCell className="text-sm font-mono" data-testid={`log-record-${log.id}`}>
                    <span className="flex items-center gap-1 text-foreground">
                      {getRecordLabel(log)}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate" data-testid={`log-changes-${log.id}`}>
                    {getChangesSummary(log)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}


