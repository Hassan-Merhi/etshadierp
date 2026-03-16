import { useState, useMemo, useEffect } from "react";
import { addDays, format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BookOpen, Eye, ExternalLink, List, AlignJustify, Package, Trash2, ChevronDown, ChevronRight } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/formatNumber";

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

function renderBaleStockAmount(entry: DaybookEntry, sym: string, amt: number): string {
  return `${sym}${formatNumber(amt)}`;
}

function formatDaybookDescription(entry: DaybookEntry): string {
  if (entry.txType === "BALE_STOCK_ENTRY") {
    const bales = parseBalesMeta(entry);
    if (bales.length === 1) {
      return bales[0].productName || bales[0].ref || "Unknown";
    }
    if (bales.length > 1) {
      return `${bales.length} bales`;
    }
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
  LOADING_CREATED: "Loading Created",
  LOADING_SUBMITTED: "Loading Submitted",
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

const VOUCHER_TX_TYPES: Record<string, string> = {
  PAYMENT: "payment",
  RECEIPT: "receipt",
  JOURNAL: "journal",
  INVOICE: "receipt",
  FREIGHT_PAYMENT: "payment",
};

function ViewEntryModal({ entry, onClose, onNavigate, formatDisplayDate }: {
  entry: DaybookEntry;
  onClose: () => void;
  onNavigate: (path: string) => void;
  formatDisplayDate: (d: string) => string;
}) {
  const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
  const isBaleStockEntry = entry.txType === "BALE_STOCK_ENTRY";

  const { data: voucherData } = useQuery<any>({
    queryKey: ["/api/vouchers", entry.referenceId],
    queryFn: async () => {
      const res = await fetch(`/api/vouchers/${entry.referenceId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isVoucherBacked && !!entry.referenceId,
  });

  const bales = parseBalesMeta(entry);
  const amt = parseFloat(entry.amountCurrency || "0");
  const sym = currencySymbol(entry.currencyCode);

  return (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <DialogTitle>Transaction Details</DialogTitle>
          <Badge variant="default">{formatTxType(entry.txType)}</Badge>
        </div>
        <DialogDescription>{formatDisplayDate(entry.txDate + "T00:00:00")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* Description */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Description</p>
          <p className="text-sm font-medium">{formatDaybookDescription(entry)}</p>
        </div>

        {/* Amount summary */}
        <div className="rounded-md border px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-lg font-bold font-mono">{renderBaleStockAmount(entry, sym, amt)}</p>
          </div>
          {entry.currencyCode !== "USD" && parseFloat(entry.fxRateToUsd) !== 1 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">USD Equivalent</p>
              <p className="text-sm font-mono">${formatNumber(parseFloat(entry.amountUsd || "0"))}</p>
            </div>
          )}
        </div>

        {/* Voucher entries */}
        {isVoucherBacked && voucherData && Array.isArray(voucherData.entries) && voucherData.entries.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Entries</p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {voucherData.entries.map((e: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <p className="font-medium">{e.accountName || e.account_name || "—"}</p>
                        {e.accountBalance !== undefined && (
                          <p className="text-xs text-muted-foreground">Balance: {sym}{formatNumber(parseFloat(e.accountBalance || "0"))}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{sym}{formatNumber(parseFloat(e.amount || e.debit || e.credit || "0"))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20">
                    <td className="px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{sym}{formatNumber(amt)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Bale list for stock entries */}
        {isBaleStockEntry && bales.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Bales ({bales.length})</p>
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
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const today = new Date().toISOString().split("T")[0];

  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const isAdminOrOwner = currentUser?.role === "Admin" || currentUser?.role === "Owner";
  const daybookEditDays = currentUser?.daybookEditDays || 0;
  const canEditDaybook = isAdminOrOwner || daybookEditDays > 0;

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [isDetailed, setIsDetailed] = useState(false);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<DaybookEntry | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmountCurrency, setEditAmountCurrency] = useState("");
  const [editAmountUsd, setEditAmountUsd] = useState("");
  const [editReason, setEditReason] = useState("");
  const [viewEntry, setViewEntry] = useState<DaybookEntry | null>(null);
  const [optionalFilter, setOptionalFilter] = useState<"all" | "exclude" | "only">("all");
  const [voidEntry, setVoidEntry] = useState<DaybookEntry | null>(null);

  // Keyboard date navigation: "-" = back 1 day, Shift+"+" = forward 1 day
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const fmt = "yyyy-MM-dd";
      if (e.key === "-") {
        e.preventDefault();
        setStartDate((prev) => format(addDays(new Date(prev + "T00:00:00"), -1), fmt));
        setEndDate((prev) => format(addDays(new Date(prev + "T00:00:00"), -1), fmt));
      } else if (e.key === "+" && e.shiftKey) {
        e.preventDefault();
        setStartDate((prev) => format(addDays(new Date(prev + "T00:00:00"), 1), fmt));
        setEndDate((prev) => format(addDays(new Date(prev + "T00:00:00"), 1), fmt));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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

  const filteredEntries = useMemo(() => {
    if (optionalFilter === "exclude") return entries.filter((e) => !e.optional);
    if (optionalFilter === "only") return entries.filter((e) => e.optional);
    return entries;
  }, [entries, optionalFilter]);

  const condensedRows = useMemo(() => {
    const grouped: Record<string, {
      date: string;
      txType: string;
      currencyCode: string;
      count: number;
      totalAmountCurrency: number;
      fxRateToUsd: string | null;
      totalAmountUsd: number;
      key: string;
    }> = {};
    filteredEntries.forEach((e) => {
      const key = `${e.txDate}|${e.txType}|${e.currencyCode}`;
      if (!grouped[key]) {
        grouped[key] = {
          date: e.txDate,
          txType: e.txType,
          currencyCode: e.currencyCode,
          count: 0,
          totalAmountCurrency: 0,
          fxRateToUsd: e.fxRateToUsd,
          totalAmountUsd: 0,
          key: key,
        };
      }
      grouped[key].count += 1;
      grouped[key].totalAmountCurrency += parseFloat(e.amountCurrency || "0");
      grouped[key].totalAmountUsd += parseFloat(e.amountUsd || "0");
      if (grouped[key].fxRateToUsd !== e.fxRateToUsd) {
        grouped[key].fxRateToUsd = null;
      }
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

  const editMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number; data: any }) => {
      const res = await factoryApiRequest("PUT", `/api/factory/daybook/${entryId}`, data);
      return res.json();
    },
    onSuccess: () => {
      // Invalidate daybook and all accounts/transaction queries so Accounts statements
      // immediately reflect the synced description
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      setEditEntry(null);
      setEditReason("");
      toast({ title: "Entry updated", description: "Description synced to source record." });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: async (entryId: number) => {
      const res = await factoryApiRequest("DELETE", `/api/factory/daybook/entry/${entryId}/void`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      setVoidEntry(null);
      toast({ title: "Voucher voided", description: "All accounting entries have been reversed." });
    },
    onError: (e: any) => toast({ title: "Void failed", description: e.message, variant: "destructive" }),
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
    if (entry.txType === "BALE_TRANSFER") {
      navigate("/factory/bale-transfers");
    }
  };

  const editSourceRecord = (entry: DaybookEntry) => {
    if (entry.txType === "BALE_STOCK_ENTRY") {
      return;
    }
    if (entry.txType === "INVOICE" && entry.referenceId) {
      navigate(`/factory/sales/invoices/${entry.referenceId}`);
      return;
    }
    const tab = VOUCHER_TX_TYPES[entry.txType];
    if (tab && entry.referenceId) {
      navigate(`/factory/vouchers?edit=${entry.referenceId}&tab=${tab}`);
    }
  };

  const handleEditSubmit = () => {
    if (!editEntry || !editReason.trim()) return;
    const isVoucherBacked = editEntry.referenceTable === "vouchers" || editEntry.id < 0;
    editMutation.mutate({
      entryId: editEntry.id,
      data: {
        description: editDescription,
        // For voucher-backed entries, amounts must be edited through the source record
        ...(!isVoucherBacked && {
          amountCurrency: editAmountCurrency,
          amountUsd: editAmountUsd,
        }),
        reason: editReason.trim(),
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Daybook</h1>
          <p className="text-muted-foreground mt-1">All factory transactions in one view</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
                data-testid="input-end-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={txTypeFilter} onValueChange={setTxTypeFilter}>
                <SelectTrigger className="w-48" data-testid="select-tx-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="PAYMENT">Payment</SelectItem>
                  <SelectItem value="RECEIPT">Receipt</SelectItem>
                  <SelectItem value="JOURNAL">Journal</SelectItem>
                  <SelectItem value="BALE_TRANSFER">Bale Transfer</SelectItem>
                  <SelectItem value="INVOICE">Invoice</SelectItem>
                  <SelectItem value="CONTAINER_IMPORT">Container Import</SelectItem>
                  <SelectItem value="OFFLOAD_RAW_STOCK">Offload Raw Stock</SelectItem>
                  <SelectItem value="COMMISSION">Commission</SelectItem>
                  <SelectItem value="BALE_PRESSING">Bale Pressing</SelectItem>
                  <SelectItem value="BALE_FINALIZE">Bale Finalize</SelectItem>
                  <SelectItem value="DOC_UPLOAD">Doc Upload</SelectItem>
                  <SelectItem value="DOC_DELETE">Doc Delete</SelectItem>
                  <SelectItem value="FREIGHT_ADD">Freight Add</SelectItem>
                  <SelectItem value="FREIGHT_DELETE">Freight Delete</SelectItem>
                  <SelectItem value="FREIGHT_PAYMENT">Freight Payment</SelectItem>
                  <SelectItem value="FREIGHT_PAYMENT_DELETE">Freight Pmt Delete</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Currency</Label>
              <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                <SelectTrigger className="w-32" data-testid="select-currency-filter">
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
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Optional</Label>
              <Select value={optionalFilter} onValueChange={(v) => setOptionalFilter(v as "all" | "exclude" | "only")}>
                <SelectTrigger className="w-40" data-testid="select-optional-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entries</SelectItem>
                  <SelectItem value="exclude">Exclude Optional</SelectItem>
                  <SelectItem value="only">Only Optional</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Transactions
            </CardTitle>
            <Button
              variant={isDetailed ? "default" : "outline"}
              size="sm"
              onClick={() => setIsDetailed(!isDetailed)}
              data-testid="button-toggle-detailed"
            >
              {isDetailed ? (
                <><List className="h-4 w-4 mr-1" />Condensed</>
              ) : (
                <><AlignJustify className="h-4 w-4 mr-1" />Detailed</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !isDetailed ? (
            condensedRows.length > 0 ? (
              <div className="overflow-x-auto">
                {(() => {
                  const hasNonUsdC = condensedRows.some((r) => r.currencyCode !== "USD");
                  return (
                  <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      {hasNonUsdC && <TableHead className="text-right">FX Rate</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {condensedRows.map((row) => {
                      const isExpanded = expandedRowKey === row.key;
                      const expandedEntries = isExpanded ? getEntriesForCondensedRow(row.key) : [];
                      return (
                        <tbody key={row.key}>
                          <TableRow 
                            data-testid={`row-condensed-${row.date}-${row.txType}`}
                            onClick={() => setExpandedRowKey(isExpanded ? null : row.key)}
                            className="cursor-pointer hover-elevate"
                          >
                            <TableCell className="font-mono text-sm whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {formatDisplayDate(row.date + "T00:00:00")}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="default">{formatTxType(row.txType)}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {row.count === 1 ? "1 entry" : `${row.count} entries`}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {currencySymbol(row.currencyCode)}{formatNumber(row.totalAmountCurrency)}
                            </TableCell>
                            {hasNonUsdC && (
                              <TableCell className="text-right font-mono text-muted-foreground">
                                {row.currencyCode === "USD"
                                  ? "-"
                                  : row.fxRateToUsd
                                  ? parseFloat(row.fxRateToUsd).toFixed(4)
                                  : "mixed"}
                              </TableCell>
                            )}
                          </TableRow>
                          {isExpanded && expandedEntries.map((entry) => {
                            const isBaleTransfer = entry.txType === "BALE_TRANSFER";
                            const isRowClickable = isBaleTransfer;
                            const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
                            const canEdit = !!VOUCHER_TX_TYPES[entry.txType] && !!entry.referenceId && entry.txType !== "BALE_STOCK_ENTRY";
                            return (
                            <TableRow 
                              key={entry.id} 
                              data-testid={`row-expanded-${entry.id}`}
                              className={`bg-muted/30 ${isRowClickable ? "cursor-pointer" : ""}`}
                              onClick={isRowClickable ? (e) => handleEntryClick(entry, e) : undefined}
                            >
                              <TableCell className="pl-8 font-mono text-sm whitespace-nowrap">
                                {formatDisplayDate(entry.txDate + "T00:00:00")}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{formatTxType(entry.txType)}</Badge>
                              </TableCell>
                              <TableCell className="max-w-xs truncate" title={formatDaybookDescription(entry)}>
                                {formatDaybookDescription(entry)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                {currencySymbol(entry.currencyCode)}{formatNumber(entry.amountCurrency)}
                              </TableCell>
                              {hasNonUsdC && (
                                <TableCell className="text-right font-mono text-muted-foreground">
                                  {entry.currencyCode === "USD"
                                    ? "-"
                                    : entry.fxRateToUsd
                                    ? parseFloat(entry.fxRateToUsd).toFixed(4)
                                    : "-"}
                                </TableCell>
                              )}
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    title="View details"
                                    onClick={(e) => { e.stopPropagation(); setViewEntry(entry); }}
                                    data-testid={`button-view-${entry.id}`}
                                  >
                                    <Eye className="h-3 w-3" />
                                  </Button>
                                  {canEdit && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Edit"
                                      onClick={(e) => { e.stopPropagation(); editSourceRecord(entry); }}
                                      data-testid={`button-edit-source-${entry.id}`}
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </Button>
                                  )}
                                  {isAdminOrOwner && isVoucherBacked && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Void voucher"
                                      onClick={(e) => { e.stopPropagation(); setVoidEntry(entry); }}
                                      data-testid={`button-void-voucher-${entry.id}`}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
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
              <div className="text-center py-12">
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
                <p className="text-muted-foreground mt-2">Factory transactions will appear here as you perform operations</p>
              </div>
            )
          ) : filteredEntries.length > 0 ? (
            <div className="overflow-x-auto">
              {(() => {
                const hasNonUsd = filteredEntries.some((e) => e.currencyCode !== "USD");
                return (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    {hasNonUsd && <TableHead className="text-right">FX Rate</TableHead>}
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => {
                    const isBaleTransfer = entry.txType === "BALE_TRANSFER";
                    const isRowClickable = isBaleTransfer;
                    const isVoucherBacked = entry.referenceTable === "vouchers" && !!entry.referenceId;
                    const canEdit = !!VOUCHER_TX_TYPES[entry.txType] && !!entry.referenceId && entry.txType !== "BALE_STOCK_ENTRY";
                    return (
                    <TableRow
                      key={entry.id}
                      data-testid={`row-daybook-${entry.id}`}
                      className={`${isRowClickable ? "cursor-pointer hover-elevate" : ""} ${entry.optional ? "opacity-50" : ""}`}
                      onClick={isRowClickable ? (e) => handleEntryClick(entry, e) : undefined}
                    >
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {formatDisplayDate(entry.txDate + "T00:00:00")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge variant="default">
                            {formatTxType(entry.txType)}
                          </Badge>
                          {entry.optional && (
                            <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-optional-${entry.id}`}>
                              Optional
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={formatDaybookDescription(entry)}>
                        {formatDaybookDescription(entry)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {renderBaleStockAmount(entry, currencySymbol(entry.currencyCode), parseFloat(entry.amountCurrency || "0"))}
                      </TableCell>
                      {hasNonUsd && (
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {entry.currencyCode === "USD" ? "-" : parseFloat(entry.fxRateToUsd).toFixed(4)}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="View details"
                            onClick={(e) => { e.stopPropagation(); setViewEntry(entry); }}
                            data-testid={`button-view-${entry.id}`}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          {canEdit && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Edit"
                              onClick={(e) => { e.stopPropagation(); editSourceRecord(entry); }}
                              data-testid={`button-edit-source-${entry.id}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          )}
                          {isAdminOrOwner && isVoucherBacked && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Void voucher"
                              onClick={(e) => { e.stopPropagation(); setVoidEntry(entry); }}
                              data-testid={`button-void-voucher-${entry.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
                );
              })()}
            </div>
          ) : (
            <div className="text-center py-12">
              <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
              <p className="text-muted-foreground mt-2">Factory transactions will appear here as you perform operations</p>
            </div>
          )}
        </CardContent>
      </Card>

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
                  <Button disabled={!editReason.trim() || editMutation.isPending} onClick={handleEditSubmit} data-testid="button-submit-edit">
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
        <DialogContent className="max-w-lg" data-testid="dialog-view-entry">
          {viewEntry && <ViewEntryModal entry={viewEntry} onClose={() => setViewEntry(null)} onNavigate={navigate} formatDisplayDate={formatDisplayDate} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={voidEntry !== null} onOpenChange={(open) => { if (!open) setVoidEntry(null); }}>
        <AlertDialogContent data-testid="dialog-void-voucher">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this voucher?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse all accounting entries. This action cannot be undone.
              {voidEntry && (
                <span className="block mt-2 font-medium text-foreground">
                  {voidEntry.description}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-void">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => voidEntry && voidMutation.mutate(voidEntry.id)}
              disabled={voidMutation.isPending}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-void"
            >
              {voidMutation.isPending ? "Voiding..." : "Void Voucher"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
