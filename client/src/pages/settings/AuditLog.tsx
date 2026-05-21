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
      if (data.role === "POS" && !data.assignedLocationId) {
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
  if (Array.isArray(v)) return `(${v.length} item${v.length !== 1 ? "s" : ""})`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "—";
    const preview = keys.slice(0, 3).map(k => `${fieldLabel(k)}: ${String(v[k] ?? "—")}`).join(", ");
    return keys.length > 3 ? `${preview}, +${keys.length - 3} more` : preview;
  }
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

// Returns true for keys that carry pre-formatted item-diff strings
function isItemDiffKey(field: string): boolean {
  return /^item_(added|removed|changed)_/.test(field);
}

export function getDetailsSentence(log: any): string {
  const c = log.changes || {};
  const vType =
    c.voucherType?.new ?? c.voucherType?.old ??
    c.type?.new ?? c.type?.old ?? "";
  const module = tableShortName(log.tableName).replace(/s$/, "");
  const typePart = vType ? `${vType} ${module}` : module;
  const ref = log.recordIdentifier ?? (log.recordId ? `#${log.recordId}` : "");
  const refPart = ref ? ` ${ref}` : "";

  if (log.action === "create") {
    const amt = c.amount?.new
      ? ` — ${parseFloat(c.amount.new).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : "";
    return `Created ${typePart}${refPart}${amt}.`;
  }

  if (log.action === "delete") {
    if (!c || Object.keys(c).length === 0)
      return `Deleted ${typePart}${refPart}. Details not captured in this log.`;
    const amt = c.amount?.old
      ? ` — ${parseFloat(c.amount.old).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
      : "";
    return `Deleted ${typePart}${refPart}${amt}.`;
  }

  // update — 1. item-level diff keys (pre-formatted readable strings)
  for (const [key, vals] of Object.entries(c)) {
    if (isItemDiffKey(key)) {
      const v = vals as any;
      const txt = (v?.new ?? v?.old ?? "") as string;
      if (txt) return txt;
    }
  }

  // update — 2. first meaningful scalar change (skip same-value fields)
  const SKIP = new Set(["entries", "voucherType", "voucherNumber"]);
  for (const [key, vals] of Object.entries(c)) {
    if (SKIP.has(key) || isItemDiffKey(key)) continue;
    const v = vals as any;
    const oldFmt = fmtBusinessValue(key, v?.old);
    const newFmt = fmtBusinessValue(key, v?.new);
    if (oldFmt === newFmt) continue;
    const label = BUSINESS_FIELD_LABELS[key] ?? fieldLabel(key);
    if (v?.old !== undefined && v?.new !== undefined) {
      return `Changed ${typePart}${refPart} ${label.toLowerCase()} from ${oldFmt} to ${newFmt}.`;
    }
  }

  // No meaningful changes detected
  return `Updated ${typePart}${refPart}.`;
}

// Keep legacy name as alias so any other callers are not broken
export const getChangesSummary = getDetailsSentence;

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

// ── Detail Dialog helpers ──────────────────────────────────────────────────────

const BUSINESS_FIELD_LABELS: Record<string, string> = {
  voucherType: "Voucher Type",
  date: "Date",
  amount: "Amount",
  description: "Description",
  narration: "Narration",
  location: "Location",
  optional: "Status",
  ledgerAccount: "Ledger Account",
  debitAccount: "Debit Account",
  creditAccount: "Credit Account",
  cashAccount: "Cash / Bank Account",
  customer: "Customer",
  supplier: "Supplier",
  paymentMethod: "Payment Method",
  currency: "Currency",
  exchangeRate: "Exchange Rate",
  sourceLocation: "Source Location",
  destinationLocation: "Destination Location",
  company: "Company",
  reference: "Reference",
  name: "Name",
  status: "Status",
  type: "Type",
  balance: "Balance",
  phone: "Phone",
  email: "Email",
  address: "Address",
  contactPerson: "Contact Person",
  notes: "Notes",
  paymentTerms: "Payment Terms",
  taxNumber: "Tax Number",
  code: "Code",
  unit: "Unit",
  category: "Category",
  quantity: "Quantity",
  unitPrice: "Unit Price",
  total: "Total",
};

function isLikelyTechnical(field: string, vals: any): boolean {
  if (/Id$|_id$|Ids$/.test(field)) return true;
  const v = (vals as any)?.old ?? (vals as any)?.new;
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return true;
  return false;
}

function fmtBusinessValue(field: string, value: any): string {
  if (value === null || value === undefined) return "—";
  if (field === "optional") return value ? "Optional" : "Active";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field === "amount" || field === "balance" || field === "total" || field === "unitPrice") {
    const n = parseFloat(String(value));
    if (!isNaN(n)) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (field === "exchangeRate" || field === "quantity") {
    const n = parseFloat(String(value));
    if (!isNaN(n)) return n.toLocaleString();
  }
  if (field === "date" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(value)))) {
    try {
      const d = new Date(String(value));
      if (!isNaN(d.getTime())) return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch { /* fall through */ }
  }
  if (Array.isArray(value)) return `(${value.length} item${value.length !== 1 ? "s" : ""})`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "—";
    const preview = keys.slice(0, 3).map(k => `${fieldLabel(k)}: ${String((value as any)[k] ?? "—")}`).join(", ");
    return keys.length > 3 ? `${preview}, +${keys.length - 3} more` : preview;
  }
  return String(value);
}

function getHeaderSentence(log: any): string {
  const changes = log.changes || {};
  const user =
    log.username && log.username !== "unknown"
      ? log.username
      : log.userId
        ? `User #${log.userId.slice(0, 8)}`
        : "Unknown user";
  const verb = log.action === "create" ? "created" : log.action === "delete" ? "deleted" : "updated";
  const vType = changes.voucherType?.new ?? changes.voucherType?.old ?? changes.type?.new ?? changes.type?.old ?? "";
  const module = tableShortName(log.tableName).replace(/s$/, "");
  const typePart = vType ? `${vType} ${module.toLowerCase()}` : module.toLowerCase();
  const ref = log.recordIdentifier ?? (log.recordId ? `#${log.recordId}` : "");
  return `${user} ${verb} ${typePart}${ref ? ` ${ref}` : ""} on ${fmtDate(log.createdAt)}.`;
}

function fmtEntryAmount(v: string | number): string {
  const n = parseFloat(String(v));
  return isNaN(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function compareEntries(oldArr: any[], newArr: any[]) {
  const oldMap = new Map<string, any>(oldArr.map(e => [e.account, e]));
  const newMap = new Map<string, any>(newArr.map(e => [e.account, e]));
  const added: any[] = [];
  const removed: any[] = [];
  const changed: Array<{ account: string; old: any; new: any }> = [];
  for (const [account, entry] of newMap) {
    if (!oldMap.has(account)) {
      added.push(entry);
    } else {
      const old = oldMap.get(account)!;
      if (
        parseFloat(old.debit || "0") !== parseFloat(entry.debit || "0") ||
        parseFloat(old.credit || "0") !== parseFloat(entry.credit || "0") ||
        (old.narration ?? "") !== (entry.narration ?? "")
      ) {
        changed.push({ account, old, new: entry });
      }
    }
  }
  for (const [account, entry] of oldMap) {
    if (!newMap.has(account)) removed.push(entry);
  }
  return { added, removed, changed };
}

// ── Detail Dialog ──────────────────────────────────────────────────────────────

export function AuditLogDialog({ log, onClose }: { log: any; onClose: () => void }) {
  const [showFull, setShowFull] = useState(false);
  const { data: me } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const isAdminOrDev = me?.role === "Admin" || me?.role === "Developer" || me?.role === "Owner";

  const changes: Record<string, { old?: any; new?: any }> = log.changes || {};
  const isDelete = log.action === "delete";
  const isCreate = log.action === "create";
  const isUpdate = log.action === "update";

  const { entries: entriesChange, ...scalarChanges } = changes as any;
  const oldEntries: any[] = entriesChange?.old ?? [];
  const newEntries: any[] = entriesChange?.new ?? [];
  const hasEntries = oldEntries.length > 0 || newEntries.length > 0;
  const entryDiff = isUpdate ? compareEntries(oldEntries, newEntries) : { added: [], removed: [], changed: [] };

  const voucherType =
    changes.voucherType?.new ?? changes.voucherType?.old ??
    changes.type?.new ?? changes.type?.old ?? "";

  // Split scalar fields: readable vs technical
  const readableFields = Object.entries(scalarChanges).filter(([k, v]) => !isLikelyTechnical(k, v));
  const technicalFields = Object.entries(scalarChanges).filter(([k, v]) => isLikelyTechnical(k, v));

  const renderRow = (field: string, vals: any) => {
    // Item-level diff keys — pre-formatted readable strings
    if (isItemDiffKey(field)) {
      const isAdded = field.startsWith("item_added_");
      const isRemoved = field.startsWith("item_removed_");
      const text = (vals as any)?.new ?? (vals as any)?.old ?? "";
      if (!text) return null;
      return (
        <div key={field} className="flex gap-2 text-sm py-1.5 border-b last:border-0 items-start">
          <span className={`font-bold shrink-0 select-none ${isAdded ? "text-green-600 dark:text-green-400" : isRemoved ? "text-destructive" : "text-muted-foreground"}`}>
            {isAdded ? "+" : isRemoved ? "−" : "~"}
          </span>
          <span className={isAdded ? "text-green-700 dark:text-green-300" : isRemoved ? "text-destructive/90" : ""}>{text}</span>
        </div>
      );
    }

    const label = BUSINESS_FIELD_LABELS[field] ?? fieldLabel(field);
    const oldFmt = fmtBusinessValue(field, vals?.old);
    const newFmt = fmtBusinessValue(field, vals?.new);
    // skip unchanged fields on updates
    if (isUpdate && oldFmt === newFmt) return null;

    return (
      <div key={field} className="flex gap-3 text-sm py-1.5 border-b last:border-0 items-start">
        <span className="text-muted-foreground w-40 shrink-0">{label}</span>
        {isCreate && <span className="font-medium">{newFmt}</span>}
        {isDelete && <span className="font-medium">{oldFmt}</span>}
        {isUpdate && (
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-destructive line-through">{oldFmt}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium text-green-600 dark:text-green-400">{newFmt}</span>
          </span>
        )}
      </div>
    );
  };

  const renderedRows = readableFields.map(([field, vals]) => renderRow(field, vals)).filter(Boolean);
  const hasMainContent = renderedRows.length > 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-medium leading-snug pr-6">
            {getHeaderSentence(log)}
          </DialogTitle>
        </DialogHeader>

        {/* Summary card */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm rounded-md border p-3 bg-muted/30">
          <span className="text-muted-foreground">User</span>
          <span className="font-medium">{log.username || "Unknown"}</span>
          <span className="text-muted-foreground">Date & Time</span>
          <span>{fmtDate(log.createdAt)}</span>
          <span className="text-muted-foreground">Action</span>
          <span>
            <Badge
              variant={isDelete ? "destructive" : isCreate ? "default" : "secondary"}
              className="capitalize text-xs"
            >
              {log.action}
            </Badge>
          </span>
          <span className="text-muted-foreground">Module</span>
          <span>{tableShortName(log.tableName)}</span>
          {voucherType && (
            <>
              <span className="text-muted-foreground">Type</span>
              <span>{voucherType}</span>
            </>
          )}
          {log.recordIdentifier && (
            <>
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono text-xs">{log.recordIdentifier}</span>
            </>
          )}
        </div>

        {/* Business details section */}
        <div className="space-y-1.5">
          <p className="text-sm font-semibold">
            {isDelete ? "Deleted record details" : isCreate ? "Created record details" : "What changed"}
          </p>
          {isDelete && (
            <p className="text-xs text-muted-foreground">
              This record was deleted. Before deletion, it contained:
            </p>
          )}
          {hasMainContent ? (
            <div className="rounded-md border px-3 divide-y">
              {renderedRows}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isUpdate
                ? Object.keys(changes).length > 0
                  ? "No meaningful field changes were captured for this log."
                  : "Legacy audit log: field-level details were not captured."
                : isDelete
                  ? "Legacy audit log: details were not captured for this deletion."
                  : null}
            </p>
          )}
        </div>

        {/* Accounting / entry details */}
        {hasEntries && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Accounting Details</p>
            {isUpdate ? (
              <div className="space-y-3">
                {entryDiff.added.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-green-600 dark:text-green-400">Entries added</p>
                    {entryDiff.added.map((e, i) => (
                      <div key={i} className="text-sm py-1 border-b last:border-0">
                        <span className="font-medium">{e.account}</span>
                        {parseFloat(e.debit) > 0 && <span className="text-muted-foreground"> — debit <span className="font-medium text-foreground">{fmtEntryAmount(e.debit)}</span></span>}
                        {parseFloat(e.credit) > 0 && <span className="text-muted-foreground"> — credit <span className="font-medium text-foreground">{fmtEntryAmount(e.credit)}</span></span>}
                        {e.narration && <span className="text-muted-foreground"> | {e.narration}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {entryDiff.removed.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-destructive">Entries removed</p>
                    {entryDiff.removed.map((e, i) => (
                      <div key={i} className="text-sm py-1 border-b last:border-0">
                        <span className="font-medium">{e.account}</span>
                        {parseFloat(e.debit) > 0 && <span className="text-muted-foreground"> — debit <span className="font-medium text-foreground">{fmtEntryAmount(e.debit)}</span></span>}
                        {parseFloat(e.credit) > 0 && <span className="text-muted-foreground"> — credit <span className="font-medium text-foreground">{fmtEntryAmount(e.credit)}</span></span>}
                      </div>
                    ))}
                  </div>
                )}
                {entryDiff.changed.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Entries modified</p>
                    {entryDiff.changed.map((c, i) => (
                      <div key={i} className="py-1.5 border-b last:border-0 space-y-0.5">
                        <div className="text-sm font-medium">{c.account}</div>
                        {parseFloat(c.old.debit) !== parseFloat(c.new.debit) && (
                          <div className="text-xs flex gap-1.5 items-center">
                            <span className="text-muted-foreground w-12 shrink-0">Debit</span>
                            <span className="text-destructive line-through">{fmtEntryAmount(c.old.debit)}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium text-green-600 dark:text-green-400">{fmtEntryAmount(c.new.debit)}</span>
                          </div>
                        )}
                        {parseFloat(c.old.credit) !== parseFloat(c.new.credit) && (
                          <div className="text-xs flex gap-1.5 items-center">
                            <span className="text-muted-foreground w-12 shrink-0">Credit</span>
                            <span className="text-destructive line-through">{fmtEntryAmount(c.old.credit)}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium text-green-600 dark:text-green-400">{fmtEntryAmount(c.new.credit)}</span>
                          </div>
                        )}
                        {(c.old.narration ?? "") !== (c.new.narration ?? "") && (
                          <div className="text-xs flex gap-1.5 items-center">
                            <span className="text-muted-foreground w-12 shrink-0">Note</span>
                            <span className="text-destructive line-through">{c.old.narration || "—"}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium text-green-600 dark:text-green-400">{c.new.narration || "—"}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {entryDiff.added.length === 0 && entryDiff.removed.length === 0 && entryDiff.changed.length === 0 && (
                  <p className="text-sm text-muted-foreground">Accounting entries were unchanged.</p>
                )}
              </div>
            ) : (
              <div className="rounded-md border divide-y">
                {(isCreate ? newEntries : oldEntries).map((e: any, i: number) => (
                  <div key={i} className="text-sm px-3 py-1.5">
                    <span className="font-medium">{e.account}</span>
                    {parseFloat(e.debit) > 0 && <span className="text-muted-foreground"> — debit <span className="font-medium text-foreground">{fmtEntryAmount(e.debit)}</span></span>}
                    {parseFloat(e.credit) > 0 && <span className="text-muted-foreground"> — credit <span className="font-medium text-foreground">{fmtEntryAmount(e.credit)}</span></span>}
                    {e.narration && <span className="text-muted-foreground"> | {e.narration}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Full alteration details — Admin / Owner / Developer only, collapsed */}
        {isAdminOrDev && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 px-0 text-muted-foreground"
              onClick={() => setShowFull(v => !v)}
              data-testid="button-audit-full-details"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showFull ? "rotate-180" : ""}`} />
              Full alteration details
            </Button>

            {showFull && (
              <div className="mt-2 rounded-md border divide-y text-sm">
                {/* All readable fields — unchanged fields filtered out for updates */}
                {readableFields.length > 0 && (
                  <div className="px-3 py-2 divide-y">
                    {readableFields.map(([field, vals]) => {
                      // Item-level diff keys rendered as coloured lines
                      if (isItemDiffKey(field)) {
                        const isAdded = field.startsWith("item_added_");
                        const isRemoved = field.startsWith("item_removed_");
                        const text = (vals as any)?.new ?? (vals as any)?.old ?? "";
                        if (!text) return null;
                        return (
                          <div key={field} className="flex gap-2 py-1.5 items-start">
                            <span className={`font-bold shrink-0 select-none ${isAdded ? "text-green-600 dark:text-green-400" : isRemoved ? "text-destructive" : "text-muted-foreground"}`}>
                              {isAdded ? "+" : isRemoved ? "−" : "~"}
                            </span>
                            <span className={isAdded ? "text-green-700 dark:text-green-300" : isRemoved ? "text-destructive/90" : ""}>{text}</span>
                          </div>
                        );
                      }

                      const label = BUSINESS_FIELD_LABELS[field] ?? fieldLabel(field);
                      const oldFmt = fmtBusinessValue(field, (vals as any)?.old);
                      const newFmt = fmtBusinessValue(field, (vals as any)?.new);
                      // Filter out unchanged fields on updates
                      if (isUpdate && oldFmt === newFmt) return null;
                      return (
                        <div key={field} className="flex gap-3 py-1.5 items-start">
                          <span className="text-muted-foreground w-40 shrink-0">{label}</span>
                          {isCreate && <span>{newFmt}</span>}
                          {isDelete && <span>{oldFmt}</span>}
                          {isUpdate && (
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-destructive">{oldFmt}</span>
                              <span className="text-muted-foreground">→</span>
                              <span>{newFmt}</span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Technical / ID fields */}
                {technicalFields.length > 0 && (
                  <div className="px-3 py-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">System fields</p>
                    <div className="divide-y">
                      {technicalFields.map(([field, vals]) => (
                        <div key={field} className="flex gap-3 py-1 text-xs items-start">
                          <span className="text-muted-foreground w-40 shrink-0">{fieldLabel(field)}</span>
                          {isCreate && <span>{fmtValue((vals as any)?.new)}</span>}
                          {isDelete && <span>{fmtValue((vals as any)?.old)}</span>}
                          {isUpdate && (
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-destructive">{fmtValue((vals as any)?.old)}</span>
                              <span className="text-muted-foreground">→</span>
                              <span>{fmtValue((vals as any)?.new)}</span>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full entries tables */}
                {hasEntries && (
                  <div className="px-3 py-2 space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Accounting entries</p>
                    {isUpdate ? (
                      <>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Before</p>
                          <EntriesTable entries={oldEntries} />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">After</p>
                          <EntriesTable entries={newEntries} />
                        </div>
                      </>
                    ) : (
                      <EntriesTable entries={isCreate ? newEntries : oldEntries} />
                    )}
                  </div>
                )}

                {/* Metadata */}
                <div className="px-3 py-2 text-xs text-muted-foreground flex flex-wrap gap-4">
                  <span>Log ID: {log.id}</span>
                  <span>Table: {log.tableName}</span>
                  {log.recordId && <span>Record ID: {log.recordId}</span>}
                  {log.companyId && <span>Company ID: {log.companyId}</span>}
                  {log.userId && <span>User ID: {log.userId}</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Log Table ────────────────────────────────────────────────────────────

export function EditLogTable({ companyId }: { companyId?: number }) {
  const [selectedLog, setSelectedLog] = useState<any | null>(null);
  const [filterAction, setFilterAction] = useState("update,delete");
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
          <SelectTrigger className="h-8 w-40 text-sm" data-testid="select-audit-action">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="update,delete">Updates &amp; Deletes</SelectItem>
            <SelectItem value="create">Create only</SelectItem>
            <SelectItem value="update">Update only</SelectItem>
            <SelectItem value="delete">Delete only</SelectItem>
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
        {(filterAction !== "update,delete" || filterModule || filterSearch || filterDateFrom || filterDateTo) && (
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => {
            setFilterAction("update,delete"); setFilterModule(""); setFilterSearch("");
            setFilterDateFrom(""); setFilterDateTo("");
          }} data-testid="button-audit-clear-filters">
            <X className="h-3 w-3 mr-1" /> Reset
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
                <TableHead className="whitespace-nowrap">Date & Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditLogs.map((log: any) => {
                const displayUser =
                  log.username && log.username !== "unknown"
                    ? log.username
                    : log.userId
                      ? `User #${log.userId.slice(0, 8)}`
                      : null;
                return (
                  <TableRow
                    key={log.id}
                    className="group cursor-pointer hover-elevate"
                    onClick={() => setSelectedLog(log)}
                    data-testid={`log-row-${log.id}`}
                  >
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{fmtDate(log.createdAt)}</TableCell>
                    <TableCell className="text-sm font-medium">
                      {displayUser ?? <span className="text-muted-foreground italic">Unknown</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.action === "delete" ? "destructive" : log.action === "create" ? "default" : "secondary"} className="capitalize text-xs">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{tableShortName(log.tableName)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-sm" data-testid={`log-details-${log.id}`}>
                      <span className="flex items-center gap-1">
                        <span className="truncate">{getDetailsSentence(log)}</span>
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}


