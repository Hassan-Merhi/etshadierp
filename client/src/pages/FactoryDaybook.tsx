import { useState, useMemo, useEffect } from "react";
import { addDays, format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BookOpen, Eye, ExternalLink, History, List, AlignJustify, SlidersHorizontal, Package } from "lucide-react";
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
  const [isDetailed, setIsDetailed] = useState(true);
  const [editEntry, setEditEntry] = useState<DaybookEntry | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmountCurrency, setEditAmountCurrency] = useState("");
  const [editAmountUsd, setEditAmountUsd] = useState("");
  const [editReason, setEditReason] = useState("");
  const [showHistory, setShowHistory] = useState<number | null>(null);
  const [baleViewerEntry, setBaleViewerEntry] = useState<DaybookEntry | null>(null);
  const [baleChooserEntry, setBaleChooserEntry] = useState<DaybookEntry | null>(null);

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

  const condensedRows = useMemo(() => {
    const grouped: Record<string, {
      date: string;
      txType: string;
      currencyCode: string;
      count: number;
      totalAmountCurrency: number;
      fxRateToUsd: string | null;
      totalAmountUsd: number;
    }> = {};
    entries.forEach((e) => {
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
  }, [entries]);

  const editMutation = useMutation({
    mutationFn: async ({ entryId, data }: { entryId: number; data: any }) => {
      const res = await factoryApiRequest("PUT", `/api/factory/daybook/${entryId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      setEditEntry(null);
      setEditReason("");
      toast({ title: "Entry updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const { data: editHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/daybook", showHistory, "edits"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/daybook/${showHistory}/edits`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showHistory !== null,
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

  const openSourceRecord = (entry: DaybookEntry) => {
    if (entry.txType === "BALE_STOCK_ENTRY") {
      const bales = parseBalesMeta(entry);
      if (bales.length === 1) {
        navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bales[0].ref)}`);
      } else if (bales.length > 1) {
        setBaleViewerEntry(entry);
      }
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

  const editSourceRecord = (entry: DaybookEntry) => {
    if (entry.txType === "BALE_STOCK_ENTRY") {
      const bales = parseBalesMeta(entry);
      if (bales.length === 1) {
        navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bales[0].ref)}`);
      } else if (bales.length > 1) {
        setBaleChooserEntry(entry);
      }
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
    editMutation.mutate({
      entryId: editEntry.id,
      data: {
        description: editDescription,
        amountCurrency: editAmountCurrency,
        amountUsd: editAmountUsd,
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
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Amount (Currency)</TableHead>
                      <TableHead className="text-right">FX Rate</TableHead>
                      <TableHead className="text-right">Amount (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {condensedRows.map((row, idx) => (
                      <TableRow key={idx} data-testid={`row-condensed-${row.date}-${row.txType}`}>
                        <TableCell className="font-mono text-sm whitespace-nowrap">
                          {formatDisplayDate(row.date + "T00:00:00")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="default">{formatTxType(row.txType)}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {row.count === 1 ? "1 entry" : `${row.count} entries`}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{row.currencyCode}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatNumber(row.totalAmountCurrency)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {row.currencyCode === "USD"
                            ? "-"
                            : row.fxRateToUsd
                            ? parseFloat(row.fxRateToUsd).toFixed(4)
                            : "mixed"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          ${formatNumber(row.totalAmountUsd)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No transactions found</h3>
                <p className="text-muted-foreground mt-2">Factory transactions will appear here as you perform operations</p>
              </div>
            )
          ) : entries.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Amount (Currency)</TableHead>
                    <TableHead className="text-right">FX Rate</TableHead>
                    <TableHead className="text-right">Amount (USD)</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const balesMeta = parseBalesMeta(entry);
                    const hasSource = (!!VOUCHER_TX_TYPES[entry.txType] || entry.txType === "INVOICE") && !!entry.referenceId
                      || (entry.txType === "BALE_STOCK_ENTRY" && balesMeta.length > 0);
                    const isBaleTransfer = entry.txType === "BALE_TRANSFER";
                    const isRowClickable = isBaleTransfer;
                    return (
                    <TableRow
                      key={entry.id}
                      data-testid={`row-daybook-${entry.id}`}
                      className={isRowClickable ? "cursor-pointer hover-elevate" : ""}
                      onClick={isRowClickable ? (e) => handleEntryClick(entry, e) : undefined}
                    >
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {formatDisplayDate(entry.txDate + "T00:00:00")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">
                          {formatTxType(entry.txType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={entry.description}>
                        {entry.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{entry.currencyCode}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatNumber(parseFloat(entry.amountCurrency || "0"))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {entry.currencyCode === "USD" ? "-" : parseFloat(entry.fxRateToUsd).toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        ${formatNumber(parseFloat(entry.amountUsd || "0"))}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {hasSource && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="View"
                              onClick={(e) => { e.stopPropagation(); openSourceRecord(entry); }}
                              data-testid={`button-view-source-${entry.id}`}
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                          )}
                          {hasSource && (
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
                          {canEditDaybook && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Edit daybook entry"
                              onClick={(e) => { e.stopPropagation(); openEditDialog(entry); }}
                              data-testid={`button-edit-daybook-${entry.id}`}
                            >
                              <SlidersHorizontal className="h-3 w-3" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" title="Edit history" onClick={(e) => { e.stopPropagation(); setShowHistory(entry.id); }} data-testid={`button-history-daybook-${entry.id}`}>
                            <History className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
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
          {editEntry && (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Description</Label>
                <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} data-testid="input-edit-description" />
              </div>
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
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showHistory !== null} onOpenChange={(open) => { if (!open) setShowHistory(null); }}>
        <DialogContent data-testid="dialog-edit-history">
          <DialogHeader>
            <DialogTitle>Edit History</DialogTitle>
            <DialogDescription>All changes made to this entry</DialogDescription>
          </DialogHeader>
          {editHistory.length === 0 ? (
            <p className="text-center text-muted-foreground py-4 text-sm">No edits have been made to this entry</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {editHistory.map((edit: any) => (
                <div key={edit.id} className="rounded-md border p-3 space-y-1" data-testid={`edit-history-${edit.id}`}>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatDisplayDate(edit.editedAt)} {new Date(edit.editedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>User #{edit.editedBy || "?"}</span>
                  </div>
                  <p className="text-sm font-medium">Reason: {edit.reason}</p>
                  {(() => {
                    try {
                      const before = JSON.parse(edit.beforeJson || "{}");
                      const after = JSON.parse(edit.afterJson || "{}");
                      const changes: string[] = [];
                      if (before.description !== after.description) changes.push("description");
                      if (before.amountCurrency !== after.amountCurrency) changes.push("amount");
                      if (before.amountUsd !== after.amountUsd) changes.push("amount (USD)");
                      if (before.txDate !== after.txDate) changes.push("date");
                      return changes.length > 0 ? (
                        <p className="text-xs text-muted-foreground">Changed: {changes.join(", ")}</p>
                      ) : null;
                    } catch { return null; }
                  })()}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bale Viewer Dialog — shows all bales from a multi-bale stock entry */}
      <Dialog open={baleViewerEntry !== null} onOpenChange={(open) => { if (!open) setBaleViewerEntry(null); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-bale-viewer">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Bales from this stock entry
            </DialogTitle>
            <DialogDescription>
              {baleViewerEntry && (() => {
                const bales = parseBalesMeta(baleViewerEntry);
                return `${bales.length} bale${bales.length !== 1 ? "s" : ""} created`;
              })()}
            </DialogDescription>
          </DialogHeader>
          {baleViewerEntry && (() => {
            const bales = parseBalesMeta(baleViewerEntry);
            return (
              <div className="max-h-80 overflow-y-auto space-y-1">
                {bales.map((bale) => (
                  <div
                    key={bale.ref}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover-elevate cursor-pointer"
                    onClick={() => { setBaleViewerEntry(null); navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.ref)}`); }}
                    data-testid={`bale-viewer-row-${bale.ref}`}
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
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Bale Chooser Dialog — choose a bale then open Barcode Lookup */}
      <Dialog open={baleChooserEntry !== null} onOpenChange={(open) => { if (!open) setBaleChooserEntry(null); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-bale-chooser">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Choose a bale
            </DialogTitle>
            <DialogDescription>
              Select a bale to open in Barcode Lookup
            </DialogDescription>
          </DialogHeader>
          {baleChooserEntry && (() => {
            const bales = parseBalesMeta(baleChooserEntry);
            return (
              <div className="max-h-80 overflow-y-auto space-y-1">
                {bales.map((bale) => (
                  <button
                    key={bale.ref}
                    type="button"
                    className="w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm hover-elevate text-left"
                    onClick={() => { setBaleChooserEntry(null); navigate(`/factory/barcode-lookup?ref=${encodeURIComponent(bale.ref)}`); }}
                    data-testid={`bale-chooser-row-${bale.ref}`}
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
                  </button>
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
