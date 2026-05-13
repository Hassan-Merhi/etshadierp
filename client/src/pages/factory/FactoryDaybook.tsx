import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useAdminOverride } from "@/hooks/use-admin-override";
import { addDays, format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import {
  BookOpen, Eye, EyeOff, ExternalLink, List, AlignJustify, Package,
  Trash2, ChevronDown, ChevronRight, Filter, X, FileDown, Plus,
  LayoutList, Layers,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { useAppMode } from "@/contexts/AppModeContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";
import { utils, writeFile } from "@/lib/excelHelper";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { cn } from "@/lib/utils";
import { hasAnyOpenDialog } from "@/hooks/use-escape-back";

interface DaybookEntry {
  id: number;
  companyId: number;
  txDate: string;
  txType: string;
  referenceId: number | null;
  referenceTable: string | null;
  description: string;
  metaJson: string | null;
  currencyCode: string;
  amountCurrency: string;
  fxRateToUsd: string;
  amountUsd: string;
  optional?: boolean;
  createdAt: string;
  createdBy: number | null;
}

interface BaleMeta {
  id: number;
  ref: string;
  productName: string;
  weightKg: string;
  status: string;
}

function parseBalesMeta(entry: DaybookEntry): BaleMeta[] {
  if (!entry.metaJson) return [];
  try {
    const parsed = JSON.parse(entry.metaJson);
    return Array.isArray(parsed.bales) ? parsed.bales : [];
  } catch {
    return [];
  }
}

function formatDaybookDescription(entry: DaybookEntry): string {
  if (entry.txType === "BALE_STOCK_ENTRY") {
    const bales = parseBalesMeta(entry);
    if (bales.length === 1) return bales[0].productName || bales[0].ref || "Unknown";
    if (bales.length > 1) return `${bales.length} bales`;
    return entry.description
      .replace(/^Stock entry:\s*/i, "")
      .replace(/\d+ bales? - /i, "")
      .replace(/\s*[–-]\s*REF\w+/g, "")
      .replace(/,\s*REF\w+/g, "")
      .trim();
  }
  return entry.description;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", AUD: "A$", LBP: "LL", LKR: "₨",
};
function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code + " ";
}

const TX_TYPE_LABELS: Record<string, string> = {
  CONTAINER_IMPORT: "Container Import",
  OFFLOAD_RAW_STOCK: "Offload Raw Stock",
  COMMISSION: "Commission",
  DUTY: "Duty",
  BALE_PRESSING: "Bale Pressing",
  BALE_FINALIZE: "Bale Finalize",
  BALE_STOCK_ENTRY: "Bale Stock Entry",
  BALE_REMOVAL: "Bale Removal",
  BALE_TRANSFER: "Bale Transfer",
  BALE_IMPORT: "Bale Import",
  BALE_REIMPORT: "Bale Reimport",
  OPENING_BALANCE_RAW: "Opening Balance",
  MIX_BATCH_CREATED: "Mix Batch Created",
  ORDER_VERIFIED: "Order Verified",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  JOURNAL: "Journal",
  DOC_UPLOAD: "Doc Upload",
  DOC_DELETE: "Doc Delete",
  FREIGHT_ADD: "Freight Add",
  FREIGHT_DELETE: "Freight Delete",
  FREIGHT_PAYMENT: "Freight Payment",
  FREIGHT_PAYMENT_DELETE: "Freight Pmt Delete",
  WORKER_CREATED: "Worker Created",
  WORKER_EDITED: "Worker Edited",
  WORKER_IMPORT: "Worker Import",
  CONTRACT_ENDED: "Contract Ended",
  CONTRACT_SETTLED: "Contract Settled",
  WORKER_PHOTO_UPLOADED: "Worker Photo",
  PAYROLL_GENERATED: "Payroll Generated",
  PAYROLL_PAYMENT: "Payroll Payment",
  PAYROLL_STATUS_CHANGE: "Payroll Status",
  BALE_SALE: "POS Sale",
  POS_EXPENSE: "POS Deduction",
  SUPPLIER_PAYMENT: "Supplier Payment",
  SUPPLIER_PAYMENT_DELETE: "Supplier Pmt. Deleted",
  ORDER_CANCELLED: "Order Cancelled",
  REPORT_GENERATED: "Report Generated",
  PAYMENT_VOIDED: "Payment Voided",
  RECEIPT_VOIDED: "Receipt Voided",
  JOURNAL_VOIDED: "Journal Voided",
};

function formatTxType(type: string): string {
  if (TX_TYPE_LABELS[type]) return TX_TYPE_LABELS[type];
  return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function getFactoryTxTypeBadge(type: string): { variant: "default" | "secondary" | "destructive" | "outline"; className?: string } {
  switch (type) {
    case "PAYMENT":
    case "SUPPLIER_PAYMENT":
    case "FREIGHT_PAYMENT":
    case "PAYROLL_PAYMENT":
      return { variant: "outline", className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40" };
    case "RECEIPT":
      return { variant: "outline", className: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40" };
    case "JOURNAL":
      return { variant: "outline", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40" };
    case "INVOICE":
      return { variant: "outline", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40" };
    case "CONTAINER_IMPORT":
      return { variant: "outline", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40" };
    case "COMMISSION":
    case "DUTY":
      return { variant: "outline", className: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/40" };
    case "BALE_PRESSING":
    case "BALE_FINALIZE":
      return { variant: "outline", className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/40" };
    case "BALE_STOCK_ENTRY":
    case "BALE_IMPORT":
    case "BALE_REIMPORT":
    case "OPENING_BALANCE_RAW":
      return { variant: "outline", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40" };
    case "BALE_SALE":
      return { variant: "outline", className: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/40" };
    case "POS_EXPENSE":
      return { variant: "outline", className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40" };
    case "BALE_REMOVAL":
    case "BALE_TRANSFER":
      return { variant: "outline", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40" };
    case "OFFLOAD_RAW_STOCK":
      return { variant: "outline", className: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40" };
    case "FREIGHT_ADD":
      return { variant: "outline", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40" };
    case "ORDER_VERIFIED":
      return { variant: "outline", className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40" };
    case "PAYROLL_GENERATED":
    case "WORKER_CREATED":
    case "WORKER_EDITED":
    case "WORKER_IMPORT":
    case "CONTRACT_ENDED":
    case "CONTRACT_SETTLED":
      return { variant: "outline", className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/40" };
    default:
      return { variant: "outline" };
  }
}

const VOUCHER_TX_TYPES: Record<string, string> = {
  PAYMENT: "payment",
  RECEIPT: "receipt",
  JOURNAL: "journal",
  INVOICE: "receipt",
  FREIGHT_PAYMENT: "payment",
  BALE_SALE: "factory_pos",
  POS_EXPENSE: "factory_pos",
};

// ─── Factory Daybook sessionStorage persistence ───────────────────────────────
const FACTORY_DAYBOOK_STATE_KEY = "factory-daybook-ui-state";

interface FactoryDaybookUIState {
  periodFilter: PeriodFilterValue;
  txTypeFilter: string;
  currencyFilter: string;
  statusFilter: string;
  searchQuery: string;
  minAmount: string;
  maxAmount: string;
  hiddenRowIds: string[];
  showHidden: boolean;
  viewMode: "detailed" | "condensed";
  scrollY: number;
}

function loadFactoryDaybookState(): FactoryDaybookUIState | null {
  try {
    const raw = sessionStorage.getItem(FACTORY_DAYBOOK_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FactoryDaybookUIState;
  } catch {
    return null;
  }
}

function saveFactoryDaybookState(state: FactoryDaybookUIState): void {
  try {
    sessionStorage.setItem(FACTORY_DAYBOOK_STATE_KEY, JSON.stringify(state));
  } catch {}
}

function ViewEntryModal({ entry, onClose, onNavigate, formatDisplayDate }: {
  entry: DaybookEntry;
  onClose: () => void;
  onNavigate: (path: string) => void;
  formatDisplayDate: (d: string) => string;
}) {
  const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
  const isBaleStockEntry = entry.txType === "BALE_STOCK_ENTRY";
  const isBaleRemoval = entry.txType === "BALE_REMOVAL";
  const hasBalesMeta = isBaleStockEntry || isBaleRemoval;

  const { data: viewEntries = [] } = useQuery<any[]>({
    queryKey: [`/api/vouchers/${entry.referenceId}/view-entries`],
    enabled: isVoucherBacked && !!entry.referenceId,
  });

  const bales = parseBalesMeta(entry);
  const amt = parseFloat(entry.amountCurrency || "0");
  const sym = currencySymbol(entry.currencyCode);

  const totalDebit = viewEntries.reduce((s, e) => s + parseFloat(e.debitAmount || "0"), 0);
  const totalCredit = viewEntries.reduce((s, e) => s + parseFloat(e.creditAmount || "0"), 0);

  const { variant: badgeVariant, className: badgeClass } = getFactoryTxTypeBadge(entry.txType);

  if (isVoucherBacked) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Voucher Details</DialogTitle>
          <DialogDescription>View voucher information</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 md:space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Date</p>
              <p className="font-medium">{formatDisplayDate(entry.txDate + "T00:00:00")}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Type</p>
              <Badge variant={badgeVariant} className={badgeClass}>{formatTxType(entry.txType)}</Badge>
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Description</p>
            <p className="text-sm">{formatDaybookDescription(entry)}</p>
          </div>
          <div>
            <h3 className="font-semibold mb-3">Entries</h3>
            {viewEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No entries found</p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-30 bg-muted/50">
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Debit</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewEntries.map((e: any, i: number) => (
                      <tr key={e.id ?? i} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <p className="font-medium">{e.accountName || "—"}</p>
                          {e.balance !== undefined && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Balance: {sym}{formatNumber(parseFloat(e.balance || "0"))}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {parseFloat(e.debitAmount || "0") > 0 ? `${sym}${formatNumber(parseFloat(e.debitAmount))}` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {parseFloat(e.creditAmount || "0") > 0 ? `${sym}${formatNumber(parseFloat(e.creditAmount))}` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/50 font-bold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right font-mono">{sym}{formatNumber(totalDebit)}</td>
                      <td className="px-3 py-2 text-right font-mono">{sym}{formatNumber(totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <DialogTitle>Transaction Details</DialogTitle>
          <Badge variant={badgeVariant} className={badgeClass}>{formatTxType(entry.txType)}</Badge>
        </div>
        <DialogDescription>{formatDisplayDate(entry.txDate + "T00:00:00")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm font-medium">{formatDaybookDescription(entry)}</p>
        </div>
        <div className="rounded-md border px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-lg font-bold font-mono">{sym}{formatNumber(amt)}</p>
          </div>
          {entry.currencyCode !== "USD" && parseFloat(entry.fxRateToUsd) !== 1 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">USD Equivalent</p>
              <p className="text-sm font-mono">${formatNumber(parseFloat(entry.amountUsd || "0"))}</p>
            </div>
          )}
        </div>
        {isBaleRemoval && bales.length === 0 && (
          <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            Bale details were not recorded for this entry (created before bale tracking was enabled).
          </div>
        )}
        {hasBalesMeta && bales.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
              {isBaleRemoval ? "Removed Bales" : "Bales"} ({bales.length})
            </p>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {bales.map((bale) => (
                <div
                  key={bale.ref}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover-elevate cursor-pointer"
                  onClick={() => { onClose(); onNavigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.ref)}`); }}
                  data-testid={`view-bale-row-${bale.ref}`}
                >
                  <div>
                    <span className="font-mono font-medium">{bale.ref}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{bale.productName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">{parseFloat(bale.weightKg).toFixed(1)} kg</span>
                    <Badge variant={bale.status === "IN_STOCK" ? "secondary" : "outline"} className="text-xs">
                      {bale.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function FactoryDaybook() {
  const { wrapAdminAction, AdminDialog } = useAdminOverride();
  const { formatDisplayDate, formatDisplayTime } = useDateFormat();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const appMode = useAppMode();
  const routePrefix = appMode === "properties" ? "/properties" : "/factory";

  const { data: currentUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isAdminOrOwner = currentUser?.role === "Admin" || currentUser?.role === "Owner" || currentUser?.role === "Developer";

  // ── Filter state ──────────────────────────────────────────────────────────
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(getDefaultPeriodValue("today"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "exclude" | "only">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  // ── View/UX state ─────────────────────────────────────────────────────────
  const [isDetailed, setIsDetailed] = useState(false);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [hiddenRowIds, setHiddenRowIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const scrollYRef = useRef(0);

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [editEntry, setEditEntry] = useState<DaybookEntry | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmountCurrency, setEditAmountCurrency] = useState("");
  const [editAmountUsd, setEditAmountUsd] = useState("");
  const [editReason, setEditReason] = useState("");
  const [viewEntry, setViewEntry] = useState<DaybookEntry | null>(null);
  const [voidEntry, setVoidEntry] = useState<DaybookEntry | null>(null);
  const [isExportingDetailed, setIsExportingDetailed] = useState(false);

  // ── Derive API date params from periodFilter ──────────────────────────────
  const startDate = periodFilter.fromDate;
  const endDate = periodFilter.toDate;

  // ── Keyboard date navigation ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (hasAnyOpenDialog()) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const fmt = "yyyy-MM-dd";
      const isBack = e.key === "-" || e.code === "Minus";
      const isForward = (e.key === "+" && e.shiftKey) || (e.code === "Equal" && e.shiftKey) || e.key === "=";
      if (isBack) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate + "T00:00:00"), -1), fmt),
          toDate: format(addDays(new Date(prev.toDate + "T00:00:00"), -1), fmt),
          preset: "custom",
        }));
      } else if (isForward) {
        e.preventDefault();
        setPeriodFilter((prev) => ({
          fromDate: format(addDays(new Date(prev.fromDate + "T00:00:00"), 1), fmt),
          toDate: format(addDays(new Date(prev.toDate + "T00:00:00"), 1), fmt),
          preset: "custom",
        }));
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // ── Scroll selected row into view ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedRowId) return;
    const el = document.querySelector(`[data-row-id="${selectedRowId}"]`);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [selectedRowId]);

  // ── API query ─────────────────────────────────────────────────────────────
  const queryParams = new URLSearchParams();
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);
  if (txTypeFilter !== "ALL") queryParams.set("txType", txTypeFilter);
  if (currencyFilter !== "ALL") queryParams.set("currencyCode", currencyFilter);

  const { data: entries = [], isLoading } = useQuery<DaybookEntry[]>({
    queryKey: ["/api/factory/daybook", startDate, endDate, txTypeFilter, currencyFilter],
    queryFn: async () => {
      const res = await fetch(`/api/factory/daybook?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch daybook");
      return res.json();
    },
  });

  // ── Client-side filters (search, amount range, status) ────────────────────
  const filteredEntries = useMemo(() => {
    let result = entries;
    // Non-admins only see their own entries
    if (!isAdminOrOwner && currentUser?.id) {
      result = result.filter((e) => e.createdBy === currentUser.id);
    }
    if (statusFilter === "exclude") result = result.filter((e) => !e.optional);
    else if (statusFilter === "only") result = result.filter((e) => e.optional);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) =>
        formatDaybookDescription(e).toLowerCase().includes(q) ||
        formatTxType(e.txType).toLowerCase().includes(q) ||
        e.txType.toLowerCase().includes(q)
      );
    }
    const minAmt = minAmount ? parseFloat(minAmount) : null;
    const maxAmt = maxAmount ? parseFloat(maxAmount) : null;
    if (minAmt !== null || maxAmt !== null) {
      result = result.filter((e) => {
        const amt = parseFloat(e.amountCurrency || "0");
        if (minAmt !== null && amt < minAmt) return false;
        if (maxAmt !== null && amt > maxAmt) return false;
        return true;
      });
    }
    return result;
  }, [entries, statusFilter, searchQuery, minAmount, maxAmount]);

  // Visible entries in detailed view (hide/unhide logic)
  const visibleEntries = useMemo(() => {
    if (showHidden) return filteredEntries;
    return filteredEntries.filter((e) => !hiddenRowIds.has(String(e.id)));
  }, [filteredEntries, hiddenRowIds, showHidden]);

  // ── Keyboard navigation: arrows, Ctrl+H / Ctrl+U (detailed view only) ────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (hasAnyOpenDialog()) return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      const isEditable = document.activeElement?.getAttribute("contenteditable");
      if (["input", "textarea", "select"].includes(tag) || isEditable) return;

      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isDetailed) {
        e.preventDefault();
        if (visibleEntries.length === 0) return;
        const currentIndex = selectedRowId
          ? visibleEntries.findIndex((en) => String(en.id) === selectedRowId)
          : -1;
        if (e.key === "ArrowDown") {
          const next = currentIndex < visibleEntries.length - 1 ? currentIndex + 1 : 0;
          setSelectedRowId(String(visibleEntries[next].id));
        } else {
          const prev = currentIndex > 0 ? currentIndex - 1 : visibleEntries.length - 1;
          setSelectedRowId(String(visibleEntries[prev].id));
        }
        return;
      }

      if (e.ctrlKey && e.key === "h" && isDetailed) {
        e.preventDefault();
        if (selectedRowId && !hiddenRowIds.has(selectedRowId)) {
          const toHide = selectedRowId;
          const nextVisible = visibleEntries.filter((en) => String(en.id) !== toHide);
          const idx = visibleEntries.findIndex((en) => String(en.id) === toHide);
          const nextSel = nextVisible[idx] ?? nextVisible[idx - 1] ?? null;
          setHiddenRowIds((prev) => { const next = new Set(prev); next.add(toHide); return next; });
          setSelectedRowId(nextSel ? String(nextSel.id) : null);
        }
        return;
      }

      if (e.ctrlKey && e.key === "u" && isDetailed) {
        e.preventDefault();
        if (selectedRowId && hiddenRowIds.has(selectedRowId)) {
          const rid = selectedRowId;
          setHiddenRowIds((prev) => { const next = new Set(prev); next.delete(rid); return next; });
        } else {
          const arr = Array.from(hiddenRowIds);
          if (arr.length > 0) {
            const last = arr[arr.length - 1];
            setHiddenRowIds((prev) => { const next = new Set(prev); next.delete(last); return next; });
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedRowId, visibleEntries, hiddenRowIds, isDetailed]);

  // ── Condensed grouped rows ────────────────────────────────────────────────
  const condensedRows = useMemo(() => {
    const grouped: Record<string, {
      date: string; txType: string; currencyCode: string;
      count: number; totalAmountCurrency: number;
      fxRateToUsd: string | null; totalAmountUsd: number; key: string;
    }> = {};
    filteredEntries.forEach((e) => {
      const key = `${e.txDate}|${e.txType}|${e.currencyCode}`;
      if (!grouped[key]) {
        grouped[key] = { date: e.txDate, txType: e.txType, currencyCode: e.currencyCode, count: 0, totalAmountCurrency: 0, fxRateToUsd: e.fxRateToUsd, totalAmountUsd: 0, key };
      }
      grouped[key].count += 1;
      grouped[key].totalAmountCurrency += parseFloat(e.amountCurrency || "0");
      grouped[key].totalAmountUsd += parseFloat(e.amountUsd || "0");
      if (grouped[key].fxRateToUsd !== e.fxRateToUsd) grouped[key].fxRateToUsd = null;
    });
    return Object.values(grouped).sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return a.txType.localeCompare(b.txType);
    });
  }, [filteredEntries]);

  const getEntriesForCondensedRow = (rowKey: string): DaybookEntry[] => {
    const [date, txType, currencyCode] = rowKey.split("|");
    return filteredEntries.filter((e) => e.txDate === date && e.txType === txType && e.currencyCode === currencyCode);
  };

  // ── Active filters detection ──────────────────────────────────────────────
  const hasActiveFilters =
    periodFilter.preset !== "today" ||
    txTypeFilter !== "ALL" ||
    currencyFilter !== "ALL" ||
    statusFilter !== "all" ||
    !!searchQuery ||
    !!minAmount ||
    !!maxAmount;

  const clearFilters = () => {
    setPeriodFilter(getDefaultPeriodValue("today"));
    setTxTypeFilter("ALL");
    setCurrencyFilter("ALL");
    setStatusFilter("all");
    setSearchQuery("");
    setMinAmount("");
    setMaxAmount("");
  };

  // ── Session persistence: restore on mount ─────────────────────────────────
  useEffect(() => {
    const saved = loadFactoryDaybookState();
    if (!saved) return;
    setPeriodFilter(saved.periodFilter);
    setTxTypeFilter(saved.txTypeFilter || "ALL");
    setCurrencyFilter(saved.currencyFilter || "ALL");
    setStatusFilter((saved.statusFilter as "all" | "exclude" | "only") || "all");
    setSearchQuery(saved.searchQuery || "");
    setMinAmount(saved.minAmount || "");
    setMaxAmount(saved.maxAmount || "");
    setHiddenRowIds(new Set(saved.hiddenRowIds || []));
    setShowHidden(saved.showHidden || false);
    if (saved.viewMode) setIsDetailed(saved.viewMode === "detailed");
    const scrollY = saved.scrollY || 0;
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Session persistence: save on every state change ───────────────────────
  useEffect(() => {
    saveFactoryDaybookState({
      periodFilter,
      txTypeFilter,
      currencyFilter,
      statusFilter,
      searchQuery,
      minAmount,
      maxAmount,
      hiddenRowIds: Array.from(hiddenRowIds),
      showHidden,
      viewMode: isDetailed ? "detailed" : "condensed",
      scrollY: scrollYRef.current,
    });
  }, [periodFilter, txTypeFilter, currencyFilter, statusFilter, searchQuery, minAmount, maxAmount, hiddenRowIds, showHidden, isDetailed]);

  // ── Session persistence: track scroll ────────────────────────────────────
  useEffect(() => {
    const handleScroll = () => {
      scrollYRef.current = window.scrollY;
      try {
        const raw = sessionStorage.getItem(FACTORY_DAYBOOK_STATE_KEY);
        if (raw) {
          const state = JSON.parse(raw);
          state.scrollY = window.scrollY;
          sessionStorage.setItem(FACTORY_DAYBOOK_STATE_KEY, JSON.stringify(state));
        }
      } catch {}
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ── Session persistence: clear on unmount if leaving daybook flow ─────────
  useEffect(() => {
    return () => {
      const path = window.location.pathname;
      const isDaybookFlow = path.includes("/factory/daybook") || path.includes("/factory/vouchers") || path.includes("/properties/daybook") || path.includes("/properties/vouchers");
      if (!isDaybookFlow) sessionStorage.removeItem(FACTORY_DAYBOOK_STATE_KEY);
    };
  }, []);

  // ── Excel export: summary ─────────────────────────────────────────────────
  const handleExportToExcel = async () => {
    if (filteredEntries.length === 0) {
      toast({ title: "No data to export", description: "No entries found for the current filters.", variant: "destructive" });
      return;
    }
    const exportData = filteredEntries.map((e) => ({
      Date: formatDisplayDate(e.txDate + "T00:00:00"),
      Type: formatTxType(e.txType),
      Description: formatDaybookDescription(e),
      Currency: e.currencyCode,
      Amount: parseFloat(e.amountCurrency || "0"),
      "FX Rate": parseFloat(e.fxRateToUsd || "1"),
      "Amount (USD)": parseFloat(e.amountUsd || "0"),
      Optional: e.optional ? "Yes" : "No",
    }));
    const worksheet = utils.json_to_sheet(exportData);
    worksheet["!cols"] = [
      { wch: 12 }, { wch: 22 }, { wch: 40 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 10 },
    ];
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, "Factory Daybook");
    const fileName = `FactoryDaybook_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    await writeFile(workbook, fileName);
    toast({ title: "Export successful", description: `Downloaded ${fileName} with ${filteredEntries.length} entries.` });
  };

  // ── Excel export: detailed (with voucher debit/credit entries) ────────────
  const handleExportDetailedToExcel = async () => {
    if (filteredEntries.length === 0) {
      toast({ title: "No data to export", description: "No entries found for the current filters.", variant: "destructive" });
      return;
    }
    setIsExportingDetailed(true);
    try {
      type DetailRow = {
        Date: string; Type: string; Description: string;
        Currency: string; Amount: number; "Amount (USD)": number;
        Optional: string; "Account Name": string; Debit: string; Credit: string;
      };
      const detailedData: DetailRow[] = [];

      for (const entry of filteredEntries) {
        const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
        const baseRow = {
          Date: formatDisplayDate(entry.txDate + "T00:00:00"),
          Type: formatTxType(entry.txType),
          Description: formatDaybookDescription(entry),
          Currency: entry.currencyCode,
          Amount: parseFloat(entry.amountCurrency || "0"),
          "Amount (USD)": parseFloat(entry.amountUsd || "0"),
          Optional: entry.optional ? "Yes" : "No",
        };
        if (isVoucherBacked) {
          try {
            const res = await fetch(`/api/vouchers/${entry.referenceId}/view-entries`, { credentials: "include" });
            if (res.ok) {
              const raw = await res.json();
              const vEntries: any[] = Array.isArray(raw) ? raw : (raw.entries || []);
              if (vEntries.length > 0) {
                for (const ve of vEntries) {
                  detailedData.push({
                    ...baseRow,
                    "Account Name": ve.accountName || "",
                    Debit: parseFloat(ve.debitAmount || "0") > 0 ? String(parseFloat(ve.debitAmount)) : "",
                    Credit: parseFloat(ve.creditAmount || "0") > 0 ? String(parseFloat(ve.creditAmount)) : "",
                  });
                }
                continue;
              }
            }
          } catch {}
        }
        detailedData.push({ ...baseRow, "Account Name": "", Debit: "", Credit: "" });
      }

      const workbook = utils.book_new();
      const dataByType: Record<string, DetailRow[]> = {};
      for (const row of detailedData) {
        if (!dataByType[row.Type]) dataByType[row.Type] = [];
        dataByType[row.Type].push(row);
      }
      for (const type of Object.keys(dataByType).sort()) {
        const ws = utils.json_to_sheet(dataByType[type]);
        ws["!cols"] = [
          { wch: 12 }, { wch: 22 }, { wch: 40 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 30 }, { wch: 15 }, { wch: 15 },
        ];
        const sheetName = type.substring(0, 31).replace(/[\\/*?[\]:]/g, "_");
        utils.book_append_sheet(workbook, ws, sheetName);
      }

      const fileName = `FactoryDaybook_Detailed_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      await writeFile(workbook, fileName);
      toast({ title: "Export successful", description: `Downloaded ${fileName} with ${detailedData.length} entries.` });
    } catch (error) {
      toast({ title: "Export failed", description: "An error occurred while exporting.", variant: "destructive" });
    } finally {
      setIsExportingDetailed(false);
    }
  };

  // ── Mutations ─────────────────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number; data: any }) => {
      const res = await factoryApiRequest("PUT", `/api/factory/daybook/${entryId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      setEditEntry(null);
      setEditReason("");
      toast({ title: "Entry updated", description: "Description synced to source record." });
    },
    onError: (e: any) => {
      if (e?._handledGlobally) return;
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (entryId: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/daybook/entry/${entryId}/void`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      setVoidEntry(null);
      toast({ title: "Voucher voided", description: "All accounting entries have been reversed." });
    },
    onError: (e: any) => {
      if (e?._handledGlobally) return;
      toast({ title: "Void failed", description: e.message, variant: "destructive" });
    },
  });

  const openEditDialog = (entry: DaybookEntry) => {
    setEditEntry(entry);
    setEditDescription(entry.description);
    setEditAmountCurrency(entry.amountCurrency);
    setEditAmountUsd(entry.amountUsd);
    setEditReason("");
  };

  const handleEntryClick = (entry: DaybookEntry, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (entry.txType === "BALE_TRANSFER") navigate(`${routePrefix}/bale-transfers`);
  };

  const editSourceRecord = (entry: DaybookEntry) => {
    if (entry.txType === "BALE_STOCK_ENTRY") return;
    if (entry.txType === "INVOICE" && entry.referenceId) {
      navigate(`${routePrefix}/sales/invoices/${entry.referenceId}`);
      return;
    }
    if (entry.txType === "BALE_SALE" && entry.referenceId) {
      navigate(`${routePrefix}/pos?edit=${entry.referenceId}`);
      return;
    }
    const tab = VOUCHER_TX_TYPES[entry.txType];
    if (tab && entry.referenceId) navigate(`${routePrefix}/vouchers?edit=${entry.referenceId}&tab=${tab}`);
  };

  const handleEditSubmit = () => {
    if (!editEntry || !editReason.trim()) return;
    const isVoucherBacked = editEntry.referenceTable === "vouchers" || editEntry.id < 0;
    editMutation.mutate({
      entryId: editEntry.id,
      data: {
        description: editDescription,
        ...(!isVoucherBacked && { amountCurrency: editAmountCurrency, amountUsd: editAmountUsd }),
        reason: editReason.trim(),
      },
    });
  };

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderEntryActions = (entry: DaybookEntry, size: "icon" | "sm" = "icon") => {
    const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
    const canEditEntry = !!VOUCHER_TX_TYPES[entry.txType] && !!entry.referenceId && entry.txType !== "BALE_STOCK_ENTRY";
    const rid = String(entry.id);
    const isHidden = hiddenRowIds.has(rid);
    return (
      <div className="flex gap-1">
        <Button size={size} variant="ghost" title="View details"
          onClick={(e) => { e.stopPropagation(); setViewEntry(entry); }}
          data-testid={`button-view-${entry.id}`}
        ><Eye className="h-3 w-3" /></Button>
        {canEditEntry && (
          <Button size={size} variant="ghost" title="Edit source"
            onClick={(e) => { e.stopPropagation(); editSourceRecord(entry); }}
            data-testid={`button-edit-source-${entry.id}`}
          ><ExternalLink className="h-3 w-3" /></Button>
        )}
        <Button size={size} variant="ghost"
          title={isHidden ? "Unhide row" : "Hide row"}
          onClick={(e) => {
            e.stopPropagation();
            if (isHidden) {
              setHiddenRowIds((prev) => { const next = new Set(prev); next.delete(rid); return next; });
            } else {
              setHiddenRowIds((prev) => { const next = new Set(prev); next.add(rid); return next; });
              if (selectedRowId === rid) setSelectedRowId(null);
            }
          }}
          data-testid={isHidden ? `button-unhide-${entry.id}` : `button-hide-${entry.id}`}
        >{isHidden ? <Eye className="h-3 w-3 text-muted-foreground" /> : <EyeOff className="h-3 w-3 text-muted-foreground" />}</Button>
        {isAdminOrOwner && isVoucherBacked && (
          <Button size={size} variant="ghost" title="Void voucher"
            onClick={(e) => { e.stopPropagation(); setVoidEntry(entry); }}
            data-testid={`button-void-voucher-${entry.id}`}
          ><Trash2 className="h-3 w-3" /></Button>
        )}
      </div>
    );
  };

  const hasNonUsd = filteredEntries.some((e) => e.currencyCode !== "USD");

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader title="Factory Daybook" subtitle="All factory transactions in one view" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              disabled={filteredEntries.length === 0 || isExportingDetailed}
              data-testid="button-export-excel"
              className="gap-2"
            >
              <FileDown className="w-4 h-4" />
              {isExportingDetailed ? "Exporting..." : "Export"}
              <ChevronDown className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleExportToExcel} data-testid="export-simple">
              Summary Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportDetailedToExcel} data-testid="export-detailed">
              Detailed Export (with entries)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              <CardTitle>Filters</CardTitle>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters" className="gap-1">
                <X className="w-4 h-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Period</Label>
              <PeriodFilter value={periodFilter} onChange={setPeriodFilter} data-testid="period-filter" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
                <SelectTrigger className="w-40" data-testid="select-tx-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="PAYMENT">Payment</SelectItem>
                  <SelectItem value="RECEIPT">Receipt</SelectItem>
                  <SelectItem value="JOURNAL">Journal</SelectItem>
                  <SelectItem value="INVOICE">Invoice</SelectItem>
                  <SelectItem value="BALE_TRANSFER">Bale Transfer</SelectItem>
                  <SelectItem value="CONTAINER_IMPORT">Container Import</SelectItem>
                  <SelectItem value="OFFLOAD_RAW_STOCK">Offload Raw Stock</SelectItem>
                  <SelectItem value="COMMISSION">Commission</SelectItem>
                  <SelectItem value="BALE_PRESSING">Bale Pressing</SelectItem>
                  <SelectItem value="BALE_FINALIZE">Bale Finalize</SelectItem>
                  <SelectItem value="BALE_STOCK_ENTRY">Bale Stock Entry</SelectItem>
                  <SelectItem value="BALE_REMOVAL">Bale Removal</SelectItem>
                  <SelectItem value="FREIGHT_PAYMENT">Freight Payment</SelectItem>
                  <SelectItem value="SUPPLIER_PAYMENT">Supplier Payment</SelectItem>
                  <SelectItem value="PAYROLL_PAYMENT">Payroll Payment</SelectItem>
                  <SelectItem value="DOC_UPLOAD">Doc Upload</SelectItem>
                  <SelectItem value="DOC_DELETE">Doc Delete</SelectItem>
                  <SelectItem value="FREIGHT_ADD">Freight Add</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                <SelectTrigger className="w-28" data-testid="select-currency-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="AUD">AUD</SelectItem>
                  <SelectItem value="LBP">LBP</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "exclude" | "only")}>
                <SelectTrigger className="w-36" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entries</SelectItem>
                  <SelectItem value="exclude">Exclude Optional</SelectItem>
                  <SelectItem value="only">Only Optional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Min Amount</Label>
              <Input
                type="number" placeholder="0" value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                data-testid="input-min-amount" className="w-[110px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Amount</Label>
              <Input
                type="number" placeholder="∞" value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                data-testid="input-max-amount" className="w-[110px]"
              />
            </div>
            <div className="space-y-2 flex-1 min-w-[180px]">
              <Label>Search</Label>
              <Input
                placeholder="Description or type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Transactions
              {filteredEntries.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({isDetailed
                    ? `${visibleEntries.length}${hiddenRowIds.size > 0 && !showHidden ? ` of ${filteredEntries.length}` : ""} ${visibleEntries.length === 1 ? "entry" : "entries"}`
                    : `${condensedRows.length} group${condensedRows.length === 1 ? "" : "s"}`})
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {isDetailed && (
                <>
                  <Button
                    variant={showHidden ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setShowHidden((v) => !v)}
                    className="gap-1"
                    data-testid="button-toggle-show-hidden"
                    disabled={hiddenRowIds.size === 0}
                    title={hiddenRowIds.size === 0 ? "No hidden rows" : showHidden ? "Hide hidden rows" : `Show ${hiddenRowIds.size} hidden row${hiddenRowIds.size !== 1 ? "s" : ""}`}
                  >
                    {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    {showHidden ? "Showing hidden" : "Show hidden"}
                    {hiddenRowIds.size > 0 && <Badge className="ml-1">{hiddenRowIds.size}</Badge>}
                  </Button>
                  {hiddenRowIds.size > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setHiddenRowIds(new Set()); setShowHidden(false); }}
                      className="gap-1 text-muted-foreground"
                      data-testid="button-clear-hidden-rows"
                      title="Clear all hidden rows"
                    >
                      <X className="w-4 h-4" />
                      Clear
                    </Button>
                  )}
                </>
              )}
              <div className="flex items-center border rounded-md overflow-hidden">
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setIsDetailed(true)}
                  data-testid="button-view-detailed"
                  className={cn("rounded-none h-8 px-3 gap-1", isDetailed && "bg-muted")}
                  title="Detailed view"
                >
                  <LayoutList className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs">Detailed</span>
                </Button>
                <div className="w-px bg-border h-6" />
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setIsDetailed(false)}
                  data-testid="button-view-condensed"
                  className={cn("rounded-none h-8 px-3 gap-1", !isDetailed && "bg-muted")}
                  title="Condensed view"
                >
                  <Layers className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs">Condensed</span>
                </Button>
              </div>
            </div>
          </div>
          <CardDescription>All factory transactions in one view</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {hasActiveFilters ? (
                <div>
                  <p className="mb-2">No transactions found matching your filters.</p>
                  <Button variant="outline" onClick={clearFilters} data-testid="button-clear-filters-empty">
                    Clear Filters
                  </Button>
                </div>
              ) : (
                <>
                  <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
                  <p className="mt-2">Factory transactions will appear here as you perform operations</p>
                </>
              )}
            </div>
          ) : !isDetailed ? (
            /* ── CONDENSED VIEW ── */
            <div className="table-responsive">
              {(() => {
                const hasNonUsdC = condensedRows.some((r) => r.currencyCode !== "USD");
                return (
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead className="w-full">Date</TableHead>
                        {isAdminOrOwner && <TableHead className="text-right whitespace-nowrap">Amount</TableHead>}
                        {isAdminOrOwner && hasNonUsdC && <TableHead className="text-right whitespace-nowrap">FX Rate</TableHead>}
                        <TableHead className="w-0 p-0"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {condensedRows.map((row) => {
                        const isExpanded = expandedRowKey === row.key;
                        const expandedEntries = isExpanded ? getEntriesForCondensedRow(row.key) : [];
                        const { variant: bv, className: bc } = getFactoryTxTypeBadge(row.txType);
                        return (
                          <tbody key={row.key}>
                            <TableRow
                              data-testid={`row-condensed-${row.date}-${row.txType}`}
                              onClick={() => setExpandedRowKey(isExpanded ? null : row.key)}
                              className="cursor-pointer hover-elevate"
                            >
                              <TableCell className="whitespace-nowrap py-4">
                                <div className="flex items-center gap-2">
                                  {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">{formatDisplayDate(row.date + "T00:00:00")}</span>
                                      <Badge variant={bv} className={cn(bc, "whitespace-nowrap")}>{formatTxType(row.txType)}</Badge>
                                    </div>
                                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{row.count} {row.count === 1 ? "entry" : "entries"}</div>
                                  </div>
                                </div>
                              </TableCell>
                              {isAdminOrOwner && (
                                <TableCell className="py-4 text-right">
                                  <div className="font-mono font-semibold">{currencySymbol(row.currencyCode)}{formatNumber(row.totalAmountCurrency)}</div>
                                  {row.currencyCode !== "USD" && (
                                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{row.currencyCode}</div>
                                  )}
                                </TableCell>
                              )}
                              {isAdminOrOwner && hasNonUsdC && (
                                <TableCell className="py-4 text-right font-mono text-muted-foreground text-sm">
                                  {row.currencyCode === "USD" ? "—" : row.fxRateToUsd ? parseFloat(row.fxRateToUsd).toFixed(4) : "mixed"}
                                </TableCell>
                              )}
                              <TableCell className="w-0 p-0" />
                            </TableRow>
                            {isExpanded && expandedEntries.map((entry) => {
                              const isBaleTransfer = entry.txType === "BALE_TRANSFER";
                              const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
                              const canEdit = !!VOUCHER_TX_TYPES[entry.txType] && !!entry.referenceId && entry.txType !== "BALE_STOCK_ENTRY";
                              const { variant: ev, className: ec } = getFactoryTxTypeBadge(entry.txType);
                              return (
                                <TableRow
                                  key={entry.id}
                                  data-testid={`row-expanded-${entry.id}`}
                                  className={`bg-muted/30 ${isBaleTransfer ? "cursor-pointer" : ""}`}
                                  onClick={isBaleTransfer ? (e) => handleEntryClick(entry, e) : undefined}
                                >
                                  <TableCell className="pl-8 py-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Badge variant={ev} className={cn(ec, "whitespace-nowrap")}>{formatTxType(entry.txType)}</Badge>
                                      {entry.optional && (
                                        <Badge variant="outline" className="text-muted-foreground text-xs" data-testid={`badge-optional-${entry.id}`}>Optional</Badge>
                                      )}
                                      <span className="text-sm text-muted-foreground truncate max-w-xs" title={formatDaybookDescription(entry)}>
                                        {formatDaybookDescription(entry)}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-2 text-right font-mono font-medium">
                                    {currencySymbol(entry.currencyCode)}{formatNumber(parseFloat(entry.amountCurrency))}
                                  </TableCell>
                                  {hasNonUsdC && (
                                    <TableCell className="py-2 text-right font-mono text-muted-foreground">
                                      {entry.currencyCode === "USD" ? "-" : entry.fxRateToUsd ? parseFloat(entry.fxRateToUsd).toFixed(4) : "-"}
                                    </TableCell>
                                  )}
                                  <TableCell className="py-2">
                                    <div className="flex gap-1">
                                      <Button size="icon" variant="ghost" title="View details"
                                        onClick={(e) => { e.stopPropagation(); setViewEntry(entry); }}
                                        data-testid={`button-view-${entry.id}`}
                                      ><Eye className="h-3 w-3" /></Button>
                                      {canEdit && (
                                        <Button size="icon" variant="ghost" title="Edit"
                                          onClick={(e) => { e.stopPropagation(); editSourceRecord(entry); }}
                                          data-testid={`button-edit-source-${entry.id}`}
                                        ><ExternalLink className="h-3 w-3" /></Button>
                                      )}
                                      {isAdminOrOwner && isVoucherBacked && (
                                        <Button size="icon" variant="ghost" title="Void"
                                          onClick={(e) => { e.stopPropagation(); setVoidEntry(entry); }}
                                          data-testid={`button-void-voucher-${entry.id}`}
                                        ><Trash2 className="h-3 w-3" /></Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </tbody>
                        );
                      })}
                    </TableBody>
                  </Table>
                );
              })()}
            </div>
          ) : (
            /* ── DETAILED VIEW ── */
            <>
              {/* Mobile card layout */}
              <div className="md:hidden space-y-3 p-3">
                {visibleEntries.map((entry) => {
                  const rid = String(entry.id);
                  const isHidden = hiddenRowIds.has(rid);
                  const { variant: bv, className: bc } = getFactoryTxTypeBadge(entry.txType);
                  return (
                    <div
                      key={entry.id}
                      data-row-id={rid}
                      className={cn(
                        "border rounded-md p-3 space-y-2 transition-colors",
                        selectedRowId === rid && "bg-accent/30 border-accent",
                        isHidden && showHidden && "opacity-50",
                        entry.optional && "opacity-70",
                      )}
                      onClick={() => setSelectedRowId(rid)}
                      data-testid={`card-entry-${entry.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={bv} className={bc} data-testid={`badge-type-${entry.id}`}>
                            {formatTxType(entry.txType)}
                          </Badge>
                          {entry.optional && (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-optional-${entry.id}`}>Optional</Badge>
                          )}
                          {isHidden && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Hidden</Badge>
                          )}
                        </div>
                        {isAdminOrOwner && (
                          <span className="font-mono font-medium text-sm whitespace-nowrap">
                            {currencySymbol(entry.currencyCode)}{formatNumber(parseFloat(entry.amountCurrency || "0"))}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDisplayDate(entry.txDate + "T00:00:00")}
                      </div>
                      <p className="text-sm truncate">{formatDaybookDescription(entry)}</p>
                      <div className="flex items-center gap-1 pt-1 border-t">
                        {renderEntryActions(entry)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Date</TableHead>
                      <TableHead className="w-full">Description</TableHead>
                      {isAdminOrOwner && <TableHead className="text-right whitespace-nowrap">Amount</TableHead>}
                      {isAdminOrOwner && hasNonUsd && <TableHead className="text-right whitespace-nowrap">FX Rate</TableHead>}
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleEntries.map((entry) => {
                      const rid = String(entry.id);
                      const isHidden = hiddenRowIds.has(rid);
                      const isBaleTransfer = entry.txType === "BALE_TRANSFER";
                      const { variant: bv, className: bc } = getFactoryTxTypeBadge(entry.txType);
                      return (
                        <TableRow
                          key={entry.id}
                          data-testid={`row-daybook-${entry.id}`}
                          data-row-id={rid}
                          className={cn(
                            isBaleTransfer ? "cursor-pointer hover-elevate" : "",
                            entry.optional && "opacity-60",
                            selectedRowId === rid && "bg-accent/20",
                            isHidden && showHidden && "opacity-40",
                          )}
                          onClick={(e) => {
                            setSelectedRowId(rid);
                            if (isBaleTransfer) handleEntryClick(entry, e);
                          }}
                        >
                          <TableCell className="whitespace-nowrap py-4">
                            <div className="font-medium text-sm">{formatDisplayDate(entry.txDate + "T00:00:00")}</div>
                            <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                              {formatDisplayTime(entry.createdAt)}
                            </div>
                            <div className="flex items-center gap-1 flex-wrap mt-1">
                              <Badge variant={bv} className={cn(bc, "whitespace-nowrap")} data-testid={`badge-type-${entry.id}`}>
                                {formatTxType(entry.txType)}
                              </Badge>
                              {entry.optional && (
                                <Badge variant="outline" className="text-muted-foreground text-xs" data-testid={`badge-optional-${entry.id}`}>
                                  Optional
                                </Badge>
                              )}
                              {isHidden && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">Hidden</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-4 max-w-xs truncate" title={formatDaybookDescription(entry)}>
                            {formatDaybookDescription(entry)}
                          </TableCell>
                          {isAdminOrOwner && (
                            <TableCell className="py-4 text-right">
                              <div className="font-mono font-semibold">{currencySymbol(entry.currencyCode)}{formatNumber(parseFloat(entry.amountCurrency || "0"))}</div>
                              {entry.currencyCode !== "USD" && parseFloat(entry.amountUsd || "0") > 0 && (
                                <div className="text-xs text-muted-foreground font-mono mt-0.5">${formatNumber(parseFloat(entry.amountUsd))}</div>
                              )}
                            </TableCell>
                          )}
                          {isAdminOrOwner && hasNonUsd && (
                            <TableCell className="py-4 text-right font-mono text-muted-foreground text-sm">
                              {entry.currencyCode === "USD" ? "—" : parseFloat(entry.fxRateToUsd).toFixed(4)}
                            </TableCell>
                          )}
                          <TableCell className="py-4">
                            {renderEntryActions(entry)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editEntry !== null} onOpenChange={(open) => { if (!open) setEditEntry(null); }}>
        <DialogContent data-testid="dialog-edit-daybook">
          <DialogHeader>
            <DialogTitle>Edit Daybook Entry</DialogTitle>
            <DialogDescription>Modify the entry details. A reason is required for the audit trail.</DialogDescription>
          </DialogHeader>
          {editEntry && (() => {
            const isVoucherBacked = editEntry.referenceTable === "vouchers" || editEntry.id < 0;
            return (
              <div className="space-y-4">
                {isVoucherBacked && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground" data-testid="note-voucher-sync">
                    Saving will update the description on the linked voucher, so Accounts statements stay in sync. To change amounts, use the source record edit button.
                  </div>
                )}
                <div>
                  <Label className="text-sm font-medium">Description</Label>
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} data-testid="input-edit-description" />
                </div>
                {!isVoucherBacked && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-sm font-medium">Amount ({editEntry.currencyCode})</Label>
                      <Input type="number" step="0.01" value={editAmountCurrency} onChange={(e) => setEditAmountCurrency(e.target.value)} data-testid="input-edit-amount-currency" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Amount (USD)</Label>
                      <Input type="number" step="0.01" value={editAmountUsd} onChange={(e) => setEditAmountUsd(e.target.value)} data-testid="input-edit-amount-usd" />
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-sm font-medium">Reason for edit *</Label>
                  <Textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Why is this change needed?" data-testid="input-edit-reason" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditEntry(null)} data-testid="button-cancel-edit">Cancel</Button>
                  <Button disabled={!editReason.trim() || editMutation.isPending} onClick={() => wrapAdminAction(handleEditSubmit, "Edit Entry")} data-testid="button-submit-edit">
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* View Details Modal */}
      <Dialog open={viewEntry !== null} onOpenChange={(open) => { if (!open) setViewEntry(null); }}>
        <DialogContent className="w-full max-w-[95vw] md:max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-view-entry">
          {viewEntry && <ViewEntryModal entry={viewEntry} onClose={() => setViewEntry(null)} onNavigate={navigate} formatDisplayDate={formatDisplayDate} />}
        </DialogContent>
      </Dialog>

      {/* Void Alert */}
      <AlertDialog open={voidEntry !== null} onOpenChange={(open) => { if (!open) setVoidEntry(null); }}>
        <AlertDialogContent data-testid="dialog-void-voucher">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this voucher?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse all accounting entries. This action cannot be undone.
              {voidEntry && <span className="block mt-2 font-medium text-foreground">{voidEntry.description}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-void">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => wrapAdminAction(() => voidEntry && voidMutation.mutate(voidEntry.id), "Void Entry")}
              disabled={voidMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-void"
            >
              {voidMutation.isPending ? "Voiding..." : "Void Voucher"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {AdminDialog}
    </div>
  );
}
