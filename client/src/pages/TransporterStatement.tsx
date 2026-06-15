import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDateFormat } from "@/contexts/DateFormatContext";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Settings2, Pencil, Check, X, TrendingDown, TrendingUp, Minus,
  RefreshCw, Printer, MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Transporter {
  id: number;
  name: string;
  code: string;
  accountType: string;
  openingBalance: string | null;
  openingBalanceSide: string | null;
}

interface StatementRow {
  id: number;
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  date: string;
  description: string;
  narration: string;
  debit: string | null;
  credit: string | null;
  runningBalance: string;
  numberPlate: string | null;
  offloadDate: string | null;
  dateToBePaid: string | null;
  hasManualDueDate: boolean;
  containerNumber: string | null;
  status: "unpaid" | "partial" | "paid" | null;
  paidAmount: string | null;
}

interface StatementResponse {
  account: {
    id: number;
    name: string;
    code: string;
    openingBalance: string | null;
    openingBalanceSide: string | null;
  };
  paymentTermsDays: number;
  openingBalance: string;
  closingBalance: string;
  rows: StatementRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(v: string | null | undefined): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmt(v: string | null): string {
  if (!v) return "";
  const n = parseFloat(v);
  if (isNaN(n) || n === 0) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, paidAmount, total }: {
  status: "unpaid" | "partial" | "paid" | null;
  paidAmount: string | null;
  total: string | null;
}) {
  if (!status) return null;
  if (status === "paid") {
    return (
      <Badge className="text-[10px] bg-green-600/10 text-green-700 dark:text-green-400 border-green-600/20" variant="outline">
        Paid
      </Badge>
    );
  }
  if (status === "partial") {
    const remaining = parseFloat(total || "0") - parseFloat(paidAmount || "0");
    return (
      <Badge className="text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" variant="outline">
        Partial · {fmtAmt(remaining.toFixed(2))} left
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] bg-destructive/10 text-destructive border-destructive/20" variant="outline">
      Unpaid
    </Badge>
  );
}

// ─── Inline Due Date Editor ──────────────────────────────────────────────────

function DueDateCell({
  row,
  onSave,
}: {
  row: StatementRow;
  onSave: (entryId: number, dueDate: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.dateToBePaid ?? "");
  const { formatDisplayDate: formatDate } = useDateFormat();

  function handleSave() {
    onSave(row.id, value || null);
    setEditing(false);
  }

  function handleCancel() {
    setValue(row.dateToBePaid ?? "");
    setEditing(false);
  }

  const isOverdue = row.dateToBePaid && row.dateToBePaid < today() && row.status !== "paid";

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          className="w-[130px] h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid={`input-due-date-${row.id}`}
        />
        <Button size="icon" variant="ghost" onClick={handleSave} data-testid={`btn-due-save-${row.id}`}>
          <Check className="h-3.5 w-3.5 text-green-600" />
        </Button>
        <Button size="icon" variant="ghost" onClick={handleCancel} data-testid={`btn-due-cancel-${row.id}`}>
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 group cursor-pointer"
      onClick={() => { setValue(row.dateToBePaid ?? ""); setEditing(true); }}
      data-testid={`cell-due-date-${row.id}`}
    >
      {row.dateToBePaid ? (
        <span className={cn(
          "text-sm",
          isOverdue ? "text-destructive font-medium" : "text-foreground",
        )}>
          {formatDate(row.dateToBePaid)}
          {row.hasManualDueDate && (
            <span className="ml-1 text-xs text-muted-foreground">(manual)</span>
          )}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/60 italic">set date</span>
      )}
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 print:hidden" />
    </div>
  );
}

// ─── Settings Popover ────────────────────────────────────────────────────────

function SettingsPopover({
  accountId,
  paymentTermsDays,
  onSaved,
}: {
  accountId: number;
  paymentTermsDays: number;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [days, setDays] = useState(String(paymentTermsDays));
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (d: number) =>
      apiRequest("PUT", `/api/transporter-statement/${accountId}/settings`, { paymentTermsDays: d }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      setOpen(false);
      onSaved();
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err?.message, variant: "destructive" });
    },
  });

  function handleSave() {
    const n = parseInt(days);
    if (isNaN(n) || n < 0) return;
    mutation.mutate(n);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" data-testid="btn-transporter-settings">
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-3">
          <p className="text-sm font-medium">Payment Terms</p>
          <div className="space-y-1.5">
            <Label htmlFor="payment-days" className="text-xs text-muted-foreground">
              Days after offload date
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="payment-days"
                type="number"
                min={0}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-24"
                data-testid="input-payment-days"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            "Date to be Paid" = Offload Date + this many days. Override individual rows by clicking the date cell.
          </p>
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={mutation.isPending}
            data-testid="btn-save-payment-settings"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TransporterStatement({ embedded }: { embedded?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { formatDisplayDate: formatDate } = useDateFormat();

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState(monthAgo());
  const [dateTo, setDateTo] = useState(today());

  // Load Loans accounts
  const { data: transporters = [], isLoading: loadingTransporters } = useQuery<Transporter[]>({
    queryKey: ["/api/transporter-statement/transporters"],
  });

  // Load statement
  const {
    data: statement,
    isLoading: loadingStatement,
    isFetching,
    isError: statementError,
    error: statementErrorObj,
  } = useQuery<StatementResponse>({
    queryKey: ["/api/transporter-statement", selectedAccountId, "statement", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const r = await fetch(`/api/transporter-statement/${selectedAccountId}/statement?${params}`, {
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${r.status}`);
      }
      return r.json();
    },
    enabled: !!selectedAccountId,
  });

  // Settings mutation callback
  function handleSettingsSaved() {
    queryClient.invalidateQueries({
      queryKey: ["/api/transporter-statement", selectedAccountId, "statement"],
    });
  }

  // Due date mutation
  const dueDateMutation = useMutation({
    mutationFn: ({ entryId, dueDate }: { entryId: number; dueDate: string | null }) =>
      apiRequest("PUT", `/api/transporter-entry-due-dates/${entryId}`, { dueDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/transporter-statement", selectedAccountId, "statement"],
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save due date", description: err?.message, variant: "destructive" });
    },
  });

  function handleDueDateSave(entryId: number, dueDate: string | null) {
    dueDateMutation.mutate({ entryId, dueDate });
  }

  // Send WhatsApp summary mutation
  const whatsappMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/transporter-statement/${selectedAccountId}/send-whatsapp`, {
        dateFrom,
        dateTo,
      }),
    onSuccess: (data: any) => {
      toast({
        title: "WhatsApp sent",
        description: `Delivered to ${data?.sent ?? 0} recipient(s).`,
      });
    },
    onError: (err: any) => {
      toast({ title: "WhatsApp failed", description: err?.message, variant: "destructive" });
    },
  });

  // Reallocate mutation (FIFO)
  const reallocateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/transporter-statement/${selectedAccountId}/reallocate`, {}),
    onSuccess: () => {
      toast({ title: "Allocations updated", description: "FIFO allocation has been re-run." });
      queryClient.invalidateQueries({
        queryKey: ["/api/transporter-statement", selectedAccountId, "statement"],
      });
    },
    onError: (err: any) => {
      toast({ title: "Reallocation failed", description: err?.message, variant: "destructive" });
    },
  });

  // Print handler
  function handlePrint() {
    window.print();
  }

  // Summary stats
  const stats = useMemo(() => {
    if (!statement) return null;
    let totalDebit = 0;
    let totalCredit = 0;
    let totalPaid = 0;
    let overdueCount = 0;
    const now = today();
    for (const r of (statement.rows ?? [])) {
      totalDebit += parseFloat(r.debit || "0");
      totalCredit += parseFloat(r.credit || "0");
      totalPaid += parseFloat(r.paidAmount || "0");
      if (r.dateToBePaid && r.dateToBePaid < now && r.status && r.status !== "paid") {
        overdueCount++;
      }
    }
    return { totalDebit, totalCredit, totalPaid, overdueCount };
  }, [statement]);

  const closingBal = statement ? parseFloat(statement.closingBalance) : 0;
  const selectedTransporter = transporters.find((t) => String(t.id) === selectedAccountId);

  return (
    <>
      {/* ── Print stylesheet ─────────────────────────────────────────────── */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #transporter-print-area,
          #transporter-print-area * { visibility: visible; }
          #transporter-print-area { position: absolute; inset: 0; padding: 24px; }

          .print\\:hidden { display: none !important; }

          #transporter-print-area .print-header {
            margin-bottom: 16px;
          }
          #transporter-print-area .print-header h1 {
            font-size: 22px;
            font-weight: 700;
            margin: 0 0 2px;
          }
          #transporter-print-area .print-header p {
            font-size: 13px;
            color: #555;
            margin: 0;
          }

          #transporter-print-area table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }
          #transporter-print-area thead tr {
            background: #0d7c66;
            color: white;
          }
          #transporter-print-area thead th {
            padding: 6px 8px;
            text-align: left;
            font-weight: 600;
          }
          #transporter-print-area thead th.text-right {
            text-align: right;
          }
          #transporter-print-area tbody tr:nth-child(even) {
            background: #f0faf8;
          }
          #transporter-print-area tbody td {
            padding: 5px 8px;
            border-bottom: 1px solid #e0e0e0;
          }
          #transporter-print-area tbody td.text-right {
            text-align: right;
          }
          #transporter-print-area .print-footer {
            margin-top: 16px;
            font-size: 10px;
            color: #888;
            text-align: right;
          }
          #transporter-print-area .summary-row td {
            background: #e6f7f3;
            font-weight: 600;
          }
        }
      `}</style>

      <div id="transporter-print-area" className={cn("flex flex-col h-full overflow-hidden", embedded ? "" : "p-4")}>

        {/* ── Print header (only visible when printing) ─── */}
        <div className="print-header hidden print:block">
          <h1>{selectedTransporter?.name ?? "Transporter"}</h1>
          <p>Statement of Accounts &nbsp;·&nbsp; Printed on {new Date().toLocaleDateString()}</p>
        </div>

        {/* ── Toolbar (hidden when printing) ──────────── */}
        <div className="flex flex-wrap items-end gap-3 mb-4 shrink-0 print:hidden">
          <div className="flex flex-col gap-1 min-w-[220px]">
            <Label className="text-xs text-muted-foreground">Transporter Account</Label>
            {loadingTransporters ? (
              <Skeleton className="h-9 w-[220px]" />
            ) : (
              <Select
                value={selectedAccountId}
                onValueChange={setSelectedAccountId}
                data-testid="select-transporter"
              >
                <SelectTrigger className="w-[220px]" data-testid="trigger-transporter">
                  <SelectValue placeholder="Select transporter…" />
                </SelectTrigger>
                <SelectContent>
                  {transporters.length === 0 && (
                    <SelectItem value="__none__" disabled>No Loans accounts found</SelectItem>
                  )}
                  {transporters.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)} data-testid={`option-transporter-${t.id}`}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[140px]"
              data-testid="input-date-from"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[140px]"
              data-testid="input-date-to"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {selectedAccountId && (
              <>
                <Button
                  variant="outline"
                  onClick={() => reallocateMutation.mutate()}
                  disabled={reallocateMutation.isPending}
                  data-testid="btn-reallocate"
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2", reallocateMutation.isPending && "animate-spin")} />
                  {reallocateMutation.isPending ? "Running…" : "Reallocate"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => whatsappMutation.mutate()}
                  disabled={whatsappMutation.isPending}
                  data-testid="btn-send-whatsapp"
                >
                  <MessageCircle className={cn("h-4 w-4 mr-2", whatsappMutation.isPending && "animate-pulse")} />
                  {whatsappMutation.isPending ? "Sending…" : "Send WhatsApp"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handlePrint}
                  data-testid="btn-print"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Print / Export PDF
                </Button>
              </>
            )}
            {selectedAccountId && statement && (
              <SettingsPopover
                accountId={parseInt(selectedAccountId)}
                paymentTermsDays={statement.paymentTermsDays}
                onSaved={handleSettingsSaved}
              />
            )}
          </div>
        </div>

        {/* ── Summary strip ────────────────────────────── */}
        {selectedAccountId && statement && stats && (
          <div className="flex flex-wrap gap-3 mb-4 shrink-0 print:hidden">
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
              <TrendingDown className="h-4 w-4 text-destructive" />
              <span className="text-muted-foreground">Total Paid:</span>
              <span className="font-medium tabular-nums">{fmtNum(String(stats.totalDebit))}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-muted-foreground">Total Charged:</span>
              <span className="font-medium tabular-nums">{fmtNum(String(stats.totalCredit))}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
              <Minus className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Outstanding:</span>
              <span className={cn(
                "font-medium tabular-nums",
                closingBal > 0 ? "text-amber-600 dark:text-amber-400" : closingBal < 0 ? "text-green-600" : "",
              )}>
                {fmtNum(statement.closingBalance)}
                {closingBal > 0 && <span className="ml-1 text-xs">Cr</span>}
                {closingBal < 0 && <span className="ml-1 text-xs">Dr</span>}
              </span>
            </div>
            {stats.overdueCount > 0 && (
              <div className="flex items-center gap-2 rounded-md border bg-destructive/10 px-3 py-2 text-sm">
                <span className="text-destructive font-medium">{stats.overdueCount} overdue</span>
              </div>
            )}
          </div>
        )}

        {/* ── Table ────────────────────────────────────── */}
        <div className="flex-1 overflow-auto rounded-md border bg-card">
          {!selectedAccountId ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground print:hidden">
              <p className="text-sm">Select a transporter account to view the statement</p>
            </div>
          ) : loadingStatement ? (
            <div className="p-4 space-y-2 print:hidden">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : statementError ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-destructive print:hidden">
              <p className="text-sm font-medium">Failed to load statement</p>
              <p className="text-xs text-muted-foreground">{(statementErrorObj as any)?.message ?? "Unknown error"}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[110px]">Number Plate</TableHead>
                  <TableHead className="w-[110px] text-right">Debit</TableHead>
                  <TableHead className="w-[110px] text-right">Credit</TableHead>
                  <TableHead className="w-[120px] text-right">Balance</TableHead>
                  <TableHead className="w-[150px]">Date to be Paid</TableHead>
                  <TableHead className="w-[110px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Opening balance row */}
                {statement && (
                  <TableRow className="bg-muted/30 text-xs text-muted-foreground italic">
                    <TableCell></TableCell>
                    <TableCell>Opening Balance</TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-foreground not-italic">
                      {fmtNum(statement.openingBalance)}
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}

                {(statement?.rows?.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10 text-sm">
                      No entries for the selected period
                    </TableCell>
                  </TableRow>
                ) : (
                  statement?.rows?.map((row) => {
                    const bal = parseFloat(row.runningBalance);
                    const isOverdue = row.dateToBePaid && row.dateToBePaid < today() && row.status && row.status !== "paid";
                    const isPaid = row.status === "paid";
                    return (
                      <TableRow
                        key={row.id}
                        className={cn(
                          isOverdue ? "bg-destructive/5" : "",
                          isPaid ? "opacity-50" : "",
                        )}
                        data-testid={`row-statement-${row.id}`}
                      >
                        <TableCell className="text-sm tabular-nums whitespace-nowrap">
                          {formatDate(row.date)}
                        </TableCell>
                        <TableCell className="text-sm max-w-[260px]">
                          <div className="truncate" title={row.description}>
                            {row.description || row.narration || row.voucherNumber}
                          </div>
                          {row.voucherNumber && (
                            <div className="text-xs text-muted-foreground">{row.voucherNumber}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.numberPlate ? (
                            <Badge variant="outline" className="font-mono text-xs">
                              {row.numberPlate}
                            </Badge>
                          ) : row.containerNumber ? (
                            <span className="text-xs text-muted-foreground">{row.containerNumber}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-destructive">
                          {fmtAmt(row.debit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-green-700 dark:text-green-400">
                          {fmtAmt(row.credit)}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right tabular-nums text-sm font-medium",
                          bal > 0 ? "text-amber-700 dark:text-amber-400" : bal < 0 ? "text-green-700 dark:text-green-400" : "text-muted-foreground",
                        )}>
                          {fmtNum(row.runningBalance)}
                        </TableCell>
                        <TableCell>
                          <DueDateCell row={row} onSave={handleDueDateSave} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={row.status}
                            paidAmount={row.paidAmount}
                            total={row.credit}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}

                {/* Closing balance row */}
                {statement?.rows && statement.rows.length > 0 && (
                  <TableRow className="bg-muted/30 font-semibold text-xs summary-row">
                    <TableCell></TableCell>
                    <TableCell className="text-muted-foreground italic">Closing Balance</TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {fmtNum(String(stats?.totalDebit ?? 0))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-700 dark:text-green-400">
                      {fmtNum(String(stats?.totalCredit ?? 0))}
                    </TableCell>
                    <TableCell className={cn(
                      "text-right tabular-nums",
                      closingBal > 0 ? "text-amber-700 dark:text-amber-400" : closingBal < 0 ? "text-green-700 dark:text-green-400" : "",
                    )}>
                      {fmtNum(statement.closingBalance)}
                      {closingBal !== 0 && (
                        <span className="ml-1 font-normal text-xs text-muted-foreground">
                          {closingBal > 0 ? "Cr" : "Dr"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Print footer */}
        <div className="print-footer hidden print:block">
          Printed on {new Date().toLocaleString()} &nbsp;·&nbsp; {selectedTransporter?.name}
        </div>

        {isFetching && !loadingStatement && (
          <p className="text-xs text-muted-foreground mt-1 shrink-0 print:hidden">Refreshing…</p>
        )}
      </div>
    </>
  );
}
