import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BookOpen, Filter, Download, Edit, History } from "lucide-react";
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
  description: string;
  currencyCode: string;
  amountCurrency: string;
  fxRateToUsd: string;
  amountUsd: string;
  createdAt: string;
  createdBy: number | null;
}

const TX_TYPE_LABELS: Record<string, string> = {
  CONTAINER_IMPORT: "Container Import",
  OFFLOAD_RAW_STOCK: "Offload Raw Stock",
  COMMISSION: "Commission",
  BALE_PRESSING: "Bale Pressing",
  BALE_FINALIZE: "Bale Finalize",
  INVOICE: "Invoice",
  PAYMENT: "Payment",
  DOC_UPLOAD: "Doc Upload",
  DOC_DELETE: "Doc Delete",
  FREIGHT_ADD: "Freight Add",
  FREIGHT_DELETE: "Freight Delete",
  FREIGHT_PAYMENT: "Freight Payment",
  FREIGHT_PAYMENT_DELETE: "Freight Pmt Delete",
  WORKER_CREATED: "Worker Created",
  WORKER_EDITED: "Worker Edited",
  CONTRACT_ENDED: "Contract Ended",
  WORKER_PHOTO_UPLOADED: "Worker Photo",
  PAYROLL_GENERATED: "Payroll Generated",
  REPORT_GENERATED: "Report Generated",
};

const TX_TYPE_COLORS: Record<string, string> = {
  CONTAINER_IMPORT: "default",
  OFFLOAD_RAW_STOCK: "secondary",
  COMMISSION: "outline",
  BALE_PRESSING: "secondary",
  BALE_FINALIZE: "default",
  INVOICE: "default",
  PAYMENT: "secondary",
  DOC_UPLOAD: "outline",
  DOC_DELETE: "destructive",
  FREIGHT_ADD: "default",
  FREIGHT_DELETE: "destructive",
  FREIGHT_PAYMENT: "secondary",
  FREIGHT_PAYMENT_DELETE: "destructive",
  WORKER_CREATED: "default",
  WORKER_EDITED: "outline",
  CONTRACT_ENDED: "destructive",
  WORKER_PHOTO_UPLOADED: "outline",
  PAYROLL_GENERATED: "secondary",
  REPORT_GENERATED: "outline",
};

export default function FactoryDaybook() {
  const { toast } = useToast();
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  const isAdminOrOwner = currentUser?.role === "Admin" || currentUser?.role === "Owner";
  const daybookEditDays = currentUser?.daybookEditDays || 0;
  const canEditDaybook = isAdminOrOwner || daybookEditDays > 0;

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [txTypeFilter, setTxTypeFilter] = useState("ALL");
  const [currencyFilter, setCurrencyFilter] = useState("ALL");
  const [editEntry, setEditEntry] = useState<DaybookEntry | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmountCurrency, setEditAmountCurrency] = useState("");
  const [editAmountUsd, setEditAmountUsd] = useState("");
  const [editReason, setEditReason] = useState("");
  const [showHistory, setShowHistory] = useState<number | null>(null);

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

  const totalUsd = useMemo(
    () => entries.reduce((sum, e) => sum + parseFloat(e.amountUsd || "0"), 0),
    [entries]
  );

  const uniqueCurrencies = useMemo(
    () => Array.from(new Set(entries.map((e) => e.currencyCode))).sort(),
    [entries]
  );

  const txTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach((e) => {
      counts[e.txType] = (counts[e.txType] || 0) + 1;
    });
    return counts;
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
                  <SelectItem value="CONTAINER_IMPORT">Container Import</SelectItem>
                  <SelectItem value="OFFLOAD_RAW_STOCK">Offload Raw Stock</SelectItem>
                  <SelectItem value="COMMISSION">Commission</SelectItem>
                  <SelectItem value="BALE_PRESSING">Bale Pressing</SelectItem>
                  <SelectItem value="BALE_FINALIZE">Bale Finalize</SelectItem>
                  <SelectItem value="INVOICE">Invoice</SelectItem>
                  <SelectItem value="PAYMENT">Payment</SelectItem>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Entries</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-entries">{entries.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total (USD)</p>
            <p className="text-2xl font-bold font-mono" data-testid="text-total-usd">${formatNumber(totalUsd)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Currencies</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {uniqueCurrencies.length > 0 ? uniqueCurrencies.map((c) => (
                <Badge key={c} variant="secondary">{c}</Badge>
              )) : <span className="text-muted-foreground text-sm">-</span>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Types</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {Object.entries(txTypeCounts).map(([type, count]) => (
                <Badge key={type} variant="outline" className="text-xs">
                  {TX_TYPE_LABELS[type] || type}: {count}
                </Badge>
              ))}
              {Object.keys(txTypeCounts).length === 0 && (
                <span className="text-muted-foreground text-sm">-</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : entries.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
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
                  {entries.map((entry) => (
                    <TableRow key={entry.id} data-testid={`row-daybook-${entry.id}`}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {new Date(entry.txDate + "T00:00:00").toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={(TX_TYPE_COLORS[entry.txType] as any) || "outline"}>
                          {TX_TYPE_LABELS[entry.txType] || entry.txType}
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
                          {canEditDaybook && (
                            <Button size="icon" variant="ghost" onClick={() => openEditDialog(entry)} data-testid={`button-edit-daybook-${entry.id}`}>
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => setShowHistory(entry.id)} data-testid={`button-history-daybook-${entry.id}`}>
                            <History className="h-3 w-3" />
                          </Button>
                        </div>
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
              <p className="text-muted-foreground mt-2">
                Factory transactions will appear here as you perform operations
              </p>
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
                    <span>{new Date(edit.editedAt).toLocaleString()}</span>
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
    </div>
  );
}
