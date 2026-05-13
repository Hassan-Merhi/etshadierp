import { useState, useMemo, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import {
  Play, CheckCircle2, Clock, DollarSign, ChevronDown, ChevronRight, X, Users, Trash2, CalendarDays, Printer, RotateCcw, Wrench, FileDown, ShieldCheck, Layers,
} from "lucide-react";
import * as XLSX from "@/lib/excelHelper";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { FactoryWorker } from "@shared/schema";

interface PayrollRecord {
  id: number; workerId: number; periodStart: string; periodEnd: string;
  baseSalary: string; bonuses: string; deductions: string; advances: string;
  netSalary: string; status: string; cashAccountId: number | null;
  paidAt: string | null; notes: string | null;
  totalWorkingDays?: number; presentDays?: string; absentDays?: string;
  worker?: { id: number; fullName: string; employeeCode: string | null; position: string | null };
}
interface CashAccount { id: number; name: string; code: string; }

interface AttendanceEntry { date: string; status: string; }
interface PendingAdvance {
  id: number;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  notes: string | null;
}
interface PreviewWorkerRow {
  id: number;
  name: string;
  position: string | null;
  base: number;
  bonus: number;
  transport: number;
  transportMonthly: number;
  advanceDeduction: number;
  totalAdvanceBalance: number;
  pendingAdvances: PendingAdvance[];
  net: number;
  totalWorkingDays: number;
  presentDays: number;
  absentDays: number;
  presentDates: AttendanceEntry[];
  absentDates: AttendanceEntry[];
  halfDayDates: AttendanceEntry[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  APPROVED: { label: "Approved", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  PAID: { label: "Paid", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
};

function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function fmtDate(d: string | null | undefined, fmt: (d: string | Date) => string) {
  if (!d) return "—";
  return fmt(d);
}

interface PayrollGroup {
  key: string;
  periodStart: string;
  periodEnd: string;
  records: PayrollRecord[];
}

interface BatchRowProps {
  group: PayrollGroup;
  expanded: Set<string>;
  toggleGroup: (key: string) => void;
  selectedIds: Set<number>;
  setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
  setPayTargetId: (id: number) => void;
  setPayCashAccountId: (v: string) => void;
  setPayOpen: (v: boolean) => void;
  setFixAcctTargetId: (id: number) => void;
  setFixAcctCashId: (v: string) => void;
  setFixAcctOpen: (v: boolean) => void;
  setUndoTargetId: (id: number) => void;
  setDeleteBatchGroup: (g: PayrollGroup) => void;
  formatDisplayDate: (d: string | Date) => string;
  condensed?: boolean;
}

function BatchRow({ group, expanded, toggleGroup, selectedIds, setSelectedIds, setPayTargetId, setPayCashAccountId, setPayOpen, setFixAcctTargetId, setFixAcctCashId, setFixAcctOpen, setUndoTargetId, setDeleteBatchGroup, formatDisplayDate, condensed }: BatchRowProps) {
  const isExpanded = expanded.has(group.key);
  const total = group.records.reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
  const paidCount = group.records.filter((p) => p.status === "PAID").length;
  const unpaidCount = group.records.length - paidCount;
  const groupUnpaid = group.records.filter((p) => p.status !== "PAID");
  const allGroupSelected = groupUnpaid.length > 0 && groupUnpaid.every((p) => selectedIds.has(p.id));

  return (
    <div>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
        onClick={() => toggleGroup(group.key)}
        data-testid={`group-${group.key}`}
      >
        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${condensed ? "text-xs" : "text-sm"}`}>
            {fmtDate(group.periodStart, formatDisplayDate)} – {fmtDate(group.periodEnd, formatDisplayDate)}
          </p>
          <p className="text-xs text-muted-foreground">{group.records.length} worker{group.records.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className={`font-semibold font-mono ${condensed ? "text-xs" : "text-sm"}`}>${total.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              {paidCount > 0 && <span className="text-green-600 dark:text-green-400">{paidCount} paid</span>}
              {paidCount > 0 && unpaidCount > 0 && " · "}
              {unpaidCount > 0 && <span className="text-amber-600 dark:text-amber-400">{unpaidCount} pending</span>}
            </p>
          </div>
          {groupUnpaid.length > 0 && (
            <Checkbox
              checked={allGroupSelected}
              onCheckedChange={(v) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  groupUnpaid.forEach((p) => v ? next.add(p.id) : next.delete(p.id));
                  return next;
                });
              }}
              onClick={(e) => e.stopPropagation()}
              data-testid={`checkbox-group-${group.key}`}
            />
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); setDeleteBatchGroup(group); }}
            data-testid={`button-delete-batch-${group.key}`}
            title="Delete batch — reverses all payments and accounting entries"
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10 pl-8 text-xs h-9 font-semibold"></TableHead>
                <TableHead className="text-xs h-9 font-semibold">Worker</TableHead>
                <TableHead className="text-center text-xs h-9 font-semibold">Present</TableHead>
                <TableHead className="text-center text-xs h-9 font-semibold">Absent</TableHead>
                <TableHead className="text-right text-xs h-9 font-semibold">Net</TableHead>
                <TableHead className="text-xs h-9 font-semibold">Status</TableHead>
                <TableHead className="text-xs h-9 font-semibold">Paid On</TableHead>
                <TableHead className="text-xs h-9"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.records.map((p) => {
                const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.DRAFT;
                const canPay = p.status !== "PAID";
                return (
                  <TableRow key={p.id} data-testid={`row-payroll-${p.id}`}>
                    <TableCell className="pl-8">
                      {canPay && (
                        <Checkbox
                          checked={selectedIds.has(p.id)}
                          onCheckedChange={() => setSelectedIds((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                          data-testid={`checkbox-payroll-${p.id}`}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{p.worker?.fullName || `Worker #${p.workerId}`}</p>
                        {p.worker?.position && <p className="text-xs text-muted-foreground">{p.worker.position}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm" data-testid={`text-present-${p.id}`}>
                      {p.presentDays != null ? (Number(p.presentDays) % 1 === 0 ? Number(p.presentDays).toFixed(0) : p.presentDays) : "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm" data-testid={`text-absent-${p.id}`}>
                      {p.absentDays != null ? (Number(p.absentDays) % 1 === 0 ? Number(p.absentDays).toFixed(0) : p.absentDays) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">${fmt(p.netSalary)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs no-default-active-elevate ${cfg.className}`}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.paidAt ? fmtDate(p.paidAt, formatDisplayDate) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canPay && (
                          <Button size="sm" variant="outline" onClick={() => { setPayTargetId(p.id); setPayCashAccountId(""); setPayOpen(true); }} data-testid={`button-pay-${p.id}`}>
                            Pay
                          </Button>
                        )}
                        {(p.status === "PAID" || p.status === "APPROVED") && !p.cashAccountId && (
                          <Button size="icon" variant="ghost" onClick={() => { setFixAcctTargetId(p.id); setFixAcctCashId(""); setFixAcctOpen(true); }} data-testid={`button-fix-acct-${p.id}`} title="Generate missing accounting entry">
                            <Wrench className="h-4 w-4 text-amber-500" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => setUndoTargetId(p.id)} data-testid={`button-undo-payroll-${p.id}`} title="Undo — reverses all accounting entries">
                          <RotateCcw className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function FactoryPayrollTab() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();

  const [runOpen, setRunOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payTargetId, setPayTargetId] = useState<number | null>(null);
  const [payCashAccountId, setPayCashAccountId] = useState("");
  const [payPaymentDate, setPayPaymentDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkCashAccountId, setBulkCashAccountId] = useState("");
  const [bulkPaymentDate, setBulkPaymentDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [undoTargetId, setUndoTargetId] = useState<number | null>(null);
  const [deleteBatchGroup, setDeleteBatchGroup] = useState<PayrollGroup | null>(null);
  const [showCompletedBatches, setShowCompletedBatches] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairResult, setRepairResult] = useState<{ deletedPayrollVouchers: number; deletedAdvanceVouchers: number; total: number } | null>(null);
  const [fixAcctOpen, setFixAcctOpen] = useState(false);
  const [fixAcctTargetId, setFixAcctTargetId] = useState<number | null>(null);
  const [fixAcctCashId, setFixAcctCashId] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Post-pay PDF state
  const [paidPayrollIds, setPaidPayrollIds] = useState<number[]>([]);
  const [printSummaryOpen, setPrintSummaryOpen] = useState(false);

  const _now = new Date();
  // Use local date parts to avoid UTC-offset stripping a day (e.g. UTC+3 midnight → previous UTC day)
  const _pad = (n: number) => String(n).padStart(2, "0");
  const _lastDayLocal = new Date(_now.getFullYear(), _now.getMonth() + 1, 0);
  const _lastDayOfMonth = `${_lastDayLocal.getFullYear()}-${_pad(_lastDayLocal.getMonth() + 1)}-${_pad(_lastDayLocal.getDate())}`;
  const _periodStartLocal = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-01`;

  const [runForm, setRunForm] = useState({
    periodStart: _periodStartLocal,
    periodEnd: _lastDayOfMonth,
    frequency: "Monthly",
    daysCount: "",
    bonusPerWorker: "",
    cashAccountId: "",
    targetAll: true,
    pickedWorkerIds: [] as number[],
    notes: "",
  });

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewWorkerRow[]>([]);
  // advanceOverrides: workerId → approved deduction amount (string for input binding)
  const [advanceOverrides, setAdvanceOverrides] = useState<Record<number, string>>({});
  const [transportOverrides, setTransportOverrides] = useState<Record<number, string>>({});
  const [expandedAdvanceWorkers, setExpandedAdvanceWorkers] = useState<Set<number>>(new Set());
  const [attendanceDetail, setAttendanceDetail] = useState<{
    name: string;
    presentDates: AttendanceEntry[];
    absentDates: AttendanceEntry[];
    halfDayDates: AttendanceEntry[];
  } | null>(null);

  const { data: payrolls, isLoading } = useQuery<PayrollRecord[]>({
    queryKey: ["/api/factory/payrolls"],
    queryFn: async () => {
      const res = await fetch("/api/factory/payrolls", { credentials: "include" });
      return res.json();
    },
  });

  const { data: workers } = useQuery<FactoryWorker[]>({
    queryKey: ["/api/factory/workers"],
    queryFn: async () => {
      const res = await fetch("/api/factory/workers", { credentials: "include" });
      return res.json();
    },
  });

  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/factory/cash-accounts", { credentials: "include" });
      return res.json();
    },
  });

  const activeWorkers = useMemo(() => workers?.filter((w) => w.active) || [], [workers]);

  // Group payrolls by period
  const payrollGroups = useMemo((): PayrollGroup[] => {
    const map = new Map<string, PayrollGroup>();
    for (const p of payrolls || []) {
      const key = `${p.periodStart}|${p.periodEnd}`;
      if (!map.has(key)) {
        map.set(key, { key, periodStart: p.periodStart, periodEnd: p.periodEnd, records: [] });
      }
      map.get(key)!.records.push(p);
    }
    return Array.from(map.values());
  }, [payrolls]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        periodStart: runForm.periodStart,
        periodEnd: runForm.periodEnd,
        bonusPerWorker: runForm.bonusPerWorker,
      };
      if (!runForm.targetAll) body.workerIds = runForm.pickedWorkerIds;
      if (runForm.daysCount) body.daysCount = runForm.daysCount;
      const res = await apiRequest("POST", "/api/factory/payrolls/preview", body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load preview");
      return data as PreviewWorkerRow[];
    },
    onSuccess: (data) => {
      setPreviewRows(data);
      // Initialize overrides: default to full advance balance for each worker
      const overrides: Record<number, string> = {};
      const tOverrides: Record<number, string> = {};
      for (const row of data) {
        overrides[row.id] = row.totalAdvanceBalance.toFixed(2);
        tOverrides[row.id] = row.transportMonthly.toFixed(2);
      }
      setAdvanceOverrides(overrides);
      setTransportOverrides(tOverrides);
      setExpandedAdvanceWorkers(new Set());
      setPreviewOpen(true);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      // Convert advanceOverrides to numeric values keyed by workerId string
      const numericOverrides: Record<string, number> = {};
      for (const [wid, amt] of Object.entries(advanceOverrides)) {
        numericOverrides[wid] = parseFloat(amt) || 0;
      }
      const numericTransportOverrides: Record<string, number> = {};
      for (const [wid, amt] of Object.entries(transportOverrides)) {
        numericTransportOverrides[wid] = parseFloat(amt) || 0;
      }
      const body: any = {
        periodStart: runForm.periodStart, periodEnd: runForm.periodEnd,
        bonusPerWorker: runForm.bonusPerWorker, notes: runForm.notes,
        cashAccountId: runForm.cashAccountId || undefined,
        advanceOverrides: numericOverrides,
        transportOverrides: numericTransportOverrides,
      };
      if (!runForm.targetAll) body.workerIds = runForm.pickedWorkerIds;
      if (runForm.daysCount) body.daysCount = runForm.daysCount;
      const res = await apiRequest("POST", "/api/factory/payrolls/generate-bulk", body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to generate payroll");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Payroll generated", description: `${data.created} records created` });
      setRunOpen(false); setPreviewOpen(false);
      // Auto-expand the new group
      const key = `${runForm.periodStart}|${runForm.periodEnd}`;
      setExpandedGroups((prev) => new Set([...prev, key]));
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, cashId, paymentDate }: { id: number; cashId: string; paymentDate: string }) => {
      const res = await apiRequest("PATCH", `/api/factory/payrolls/${id}/mark-paid`, {
        cashAccountId: cashId ? parseInt(cashId) : undefined,
        paymentDate,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      setPaidPayrollIds([vars.id]);
      setPrintSummaryOpen(true);
      setPayOpen(false); setPayTargetId(null); setPayCashAccountId("");
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkMarkPaidMutation = useMutation({
    mutationFn: async ({ cashId, paymentDate }: { cashId: string; paymentDate: string }) => {
      const res = await apiRequest("POST", "/api/factory/payrolls/mark-paid-bulk", {
        payrollIds: [...selectedIds], cashAccountId: cashId ? parseInt(cashId) : undefined, paymentDate,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      setPaidPayrollIds([...selectedIds]);
      setPrintSummaryOpen(true);
      setSelectedIds(new Set()); setBulkPayOpen(false); setBulkCashAccountId("");
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/payroll/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Draft payroll deleted" });
      setDeleteTargetId(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/factory/payroll/${id}/undo`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to undo"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      const msg = data.previousStatus === "PAID"
        ? "Payroll reverted to Draft — payment and accounting entries removed"
        : "Payroll deleted and advances restored";
      toast({ title: "Undo successful", description: msg });
      setUndoTargetId(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Undo failed", description: err.message, variant: "destructive" });
    },
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (group: PayrollGroup) => {
      for (const p of group.records) {
        const res = await apiRequest("POST", `/api/factory/payroll/${p.id}/undo`);
        if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to undo"); }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/daybook"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      toast({ title: "Batch deleted", description: "All records reversed and accounting entries removed." });
      setDeleteBatchGroup(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Batch delete failed", description: err.message, variant: "destructive" });
    },
  });

  const repairMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/repair-orphaned-vouchers", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Repair failed");
      return data as { deletedPayrollVouchers: number; deletedAdvanceVouchers: number; total: number; message: string };
    },
    onSuccess: (data) => {
      setRepairResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      toast({ title: "Ledger repaired", description: `${data.total} orphaned voucher${data.total !== 1 ? "s" : ""} removed` });
    },
    onError: (e: Error) => toast({ title: "Repair failed", description: e.message, variant: "destructive" }),
  });

  const fixAcctMutation = useMutation({
    mutationFn: async ({ id, cashId }: { id: number; cashId: string }) => {
      const res = await apiRequest("PATCH", `/api/factory/payrolls/${id}/fix-accounting`, {
        cashAccountId: parseInt(cashId),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      toast({ title: "Accounting entry generated", description: "The payment voucher has been created for this payroll." });
      setFixAcctOpen(false); setFixAcctTargetId(null); setFixAcctCashId("");
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const printSummaryPDF = async () => {
    const res = await apiRequest("POST", "/api/factory/payrolls/payment-summary-pdf", { payrollIds: paidPayrollIds });
    if (!res.ok) { toast({ title: "PDF failed", variant: "destructive" }); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const stats = useMemo(() => {
    const all = payrolls || [];
    const uniqueWorkers = new Set(all.map((p) => p.workerId)).size;
    const pending = all.filter((p) => p.status !== "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
    const paid = all.filter((p) => p.status === "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
    return { uniqueWorkers, pending, paid };
  }, [payrolls]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const unpaidPayrolls = (payrolls || []).filter((p) => p.status !== "PAID");
  const allSelected = unpaidPayrolls.length > 0 && unpaidPayrolls.every((p) => selectedIds.has(p.id));
  const activeGroups = payrollGroups.filter((g) => g.records.some((p) => p.status !== "PAID"));
  const completedGroups = payrollGroups.filter((g) => g.records.every((p) => p.status === "PAID"));

  return (
    <div className="space-y-5">

      {/* Stats pills */}
      <div className="flex flex-wrap gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-36 rounded-lg" />
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-40 rounded-lg" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Workers on Payroll</span>
              <span className="font-semibold" data-testid="stat-workers">{stats.uniqueWorkers}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Batches</span>
              <span className="font-semibold">{payrollGroups.length}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Clock className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">Pending</span>
              <span className="font-semibold font-mono text-amber-600 dark:text-amber-400" data-testid="stat-pending">${stats.pending.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-muted-foreground">Total Paid</span>
              <span className="font-semibold font-mono text-emerald-600 dark:text-emerald-400" data-testid="stat-paid">${stats.paid.toFixed(2)}</span>
            </div>
          </>
        )}
      </div>

      {/* Filter / actions row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-muted-foreground">
          {payrolls?.length || 0} record{payrolls?.length !== 1 ? "s" : ""} · {payrollGroups.length} batch{payrollGroups.length !== 1 ? "es" : ""}
        </p>
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button variant="outline" onClick={() => setBulkPayOpen(true)} data-testid="button-bulk-pay">
              <DollarSign className="h-4 w-4 mr-2" />
              Pay {selectedIds.size} Selected
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => { setRepairResult(null); setRepairOpen(true); }}
            data-testid="button-repair-ledger"
            title="Repair Ledger — remove stale entries from undone payrolls"
          >
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button onClick={() => setRunOpen(true)} data-testid="button-run-payroll">
            <Play className="h-4 w-4 mr-2" />
            Run Payroll
          </Button>
        </div>
      </div>

      {/* Records list */}
      <div className="border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
          </div>
        ) : payrollGroups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No payroll records yet</p>
            <p className="text-xs text-muted-foreground">Click "Run Payroll" to generate records for your workers</p>
          </div>
        ) : (
          <div>
            {/* ── Active batches (any pending records) ── */}
            {activeGroups.length === 0 && completedGroups.length > 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                All batches are fully paid — see completed batches below.
              </div>
            )}
            <div className="divide-y">
              {activeGroups.map((group) => <BatchRow key={group.key} group={group} expanded={expandedGroups} toggleGroup={toggleGroup} selectedIds={selectedIds} setSelectedIds={setSelectedIds} setPayTargetId={setPayTargetId} setPayCashAccountId={setPayCashAccountId} setPayOpen={setPayOpen} setFixAcctTargetId={setFixAcctTargetId} setFixAcctCashId={setFixAcctCashId} setFixAcctOpen={setFixAcctOpen} setUndoTargetId={setUndoTargetId} setDeleteBatchGroup={setDeleteBatchGroup} formatDisplayDate={formatDisplayDate} />)}
            </div>

            {/* ── Completed batches (all paid) ── */}
            {completedGroups.length > 0 && (
              <div className={activeGroups.length > 0 ? "border-t" : ""}>
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover-elevate"
                  onClick={() => setShowCompletedBatches((v) => !v)}
                  data-testid="toggle-completed-batches"
                >
                  {showCompletedBatches ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {completedGroups.length} completed batch{completedGroups.length !== 1 ? "es" : ""}
                </button>
                {showCompletedBatches && (
                  <div className="divide-y bg-muted/20">
                    {completedGroups.map((group) => <BatchRow key={group.key} group={group} expanded={expandedGroups} toggleGroup={toggleGroup} selectedIds={selectedIds} setSelectedIds={setSelectedIds} setPayTargetId={setPayTargetId} setPayCashAccountId={setPayCashAccountId} setPayOpen={setPayOpen} setFixAcctTargetId={setFixAcctTargetId} setFixAcctCashId={setFixAcctCashId} setFixAcctOpen={setFixAcctOpen} setUndoTargetId={setUndoTargetId} setDeleteBatchGroup={setDeleteBatchGroup} formatDisplayDate={formatDisplayDate} condensed />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Run Payroll Dialog */}
      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-run-payroll">
          <DialogHeader>
            <DialogTitle>Run Payroll</DialogTitle>
            <DialogDescription>Configure the payroll period and settings, then preview before generating.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Period Start</Label>
                <Input type="date" value={runForm.periodStart} onChange={(e) => setRunForm((f) => ({ ...f, periodStart: e.target.value }))} data-testid="input-period-start" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Period End</Label>
                <Input type="date" value={runForm.periodEnd} onChange={(e) => setRunForm((f) => ({ ...f, periodEnd: e.target.value }))} data-testid="input-period-end" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Days Count (auto)</Label>
                <Input type="number" placeholder="Auto-calculated" value={runForm.daysCount} onChange={(e) => setRunForm((f) => ({ ...f, daysCount: e.target.value }))} data-testid="input-days-count" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bonus Per Worker</Label>
                <Input type="number" step="0.01" value={runForm.bonusPerWorker} onChange={(e) => setRunForm((f) => ({ ...f, bonusPerWorker: e.target.value }))} data-testid="input-bonus" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cash Account (optional, used at payment)</Label>
              <Select value={runForm.cashAccountId} onValueChange={(v) => setRunForm((f) => ({ ...f, cashAccountId: v }))}>
                <SelectTrigger data-testid="select-cash-account"><SelectValue placeholder="Select account (optional)" /></SelectTrigger>
                <SelectContent>
                  {cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Workers</Label>
              <div className="flex gap-3">
                <Button
                  variant={runForm.targetAll ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRunForm((f) => ({ ...f, targetAll: true, pickedWorkerIds: [] }))}
                  data-testid="button-all-workers"
                >
                  All Active ({activeWorkers.length})
                </Button>
                <Button
                  variant={!runForm.targetAll ? "default" : "outline"}
                  size="sm"
                  onClick={() => setRunForm((f) => ({ ...f, targetAll: false }))}
                  data-testid="button-select-workers"
                >
                  Select Workers
                </Button>
              </div>
              {!runForm.targetAll && (
                <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                  {activeWorkers.map((w) => (
                    <div key={w.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`worker-${w.id}`}
                        checked={runForm.pickedWorkerIds.includes(w.id)}
                        onCheckedChange={(v) => setRunForm((f) => ({
                          ...f,
                          pickedWorkerIds: v ? [...f.pickedWorkerIds, w.id] : f.pickedWorkerIds.filter((id) => id !== w.id),
                        }))}
                        data-testid={`checkbox-worker-${w.id}`}
                      />
                      <label htmlFor={`worker-${w.id}`} className="text-sm cursor-pointer">{w.fullName} — {w.position || "—"}</label>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={runForm.notes} onChange={(e) => setRunForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. March 2026 payroll" data-testid="input-payroll-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>Cancel</Button>
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending}
              data-testid="button-preview-payroll"
            >
              <ChevronDown className="h-4 w-4 mr-2" />
              {previewMutation.isPending ? "Loading..." : "Preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl" data-testid="dialog-preview-payroll">
          <DialogHeader>
            <DialogTitle>Payroll Preview</DialogTitle>
            <DialogDescription>
              {previewRows.length} workers · {runForm.periodStart} to {runForm.periodEnd} · Net Total: ${previewRows.reduce((s, r) => {
                const monthlyRate = parseFloat(transportOverrides[r.id] ?? r.transportMonthly.toFixed(2));
                const hasAtt = r.presentDates.length > 0 || r.absentDates.length > 0 || r.halfDayDates.length > 0;
                const prorated = hasAtt && r.totalWorkingDays > 0 ? (r.presentDays / r.totalWorkingDays) * monthlyRate : monthlyRate;
                return s + r.base + r.bonus + prorated - parseFloat(advanceOverrides[r.id] || "0");
              }, 0).toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {previewRows.map((r) => {
              const hasAtt = r.presentDates.length > 0 || r.absentDates.length > 0 || r.halfDayDates.length > 0;
              const deductAmt = parseFloat(advanceOverrides[r.id] || "0");
              const monthlyRate = parseFloat(transportOverrides[r.id] ?? r.transportMonthly.toFixed(2));
              const proratedTransport = hasAtt && r.totalWorkingDays > 0
                ? (r.presentDays / r.totalWorkingDays) * monthlyRate
                : monthlyRate;
              const computedNet = r.base + r.bonus + proratedTransport - deductAmt;
              const isExpanded = expandedAdvanceWorkers.has(r.id);
              return (
                <div key={r.id} className="border rounded-md" data-testid={`row-preview-${r.id}`}>
                  {/* Main worker row */}
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      {r.position && <p className="text-xs text-muted-foreground">{r.position}</p>}
                    </div>
                    {/* Attendance */}
                    <div className="flex items-center gap-2 text-xs">
                      {hasAtt ? (
                        <>
                          <Button variant="ghost" size="sm" className="h-auto py-0.5 px-2 font-mono text-green-700 dark:text-green-400"
                            onClick={() => setAttendanceDetail({ name: r.name, presentDates: r.presentDates, absentDates: r.absentDates, halfDayDates: r.halfDayDates })}
                            data-testid={`button-present-${r.id}`}>
                            {r.presentDays % 1 === 0 ? r.presentDays.toFixed(0) : r.presentDays}d present
                          </Button>
                          {r.absentDays > 0 && (
                            <Button variant="ghost" size="sm" className="h-auto py-0.5 px-2 font-mono text-red-700 dark:text-red-400"
                              onClick={() => setAttendanceDetail({ name: r.name, presentDates: r.presentDates, absentDates: r.absentDates, halfDayDates: r.halfDayDates })}
                              data-testid={`button-absent-${r.id}`}>
                              {r.absentDays % 1 === 0 ? r.absentDays.toFixed(0) : r.absentDays}d absent
                            </Button>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">No attendance</span>
                      )}
                    </div>
                    {/* Salary breakdown */}
                    <div className="flex flex-wrap items-center gap-3 text-sm font-mono ml-auto">
                      <span className="text-muted-foreground">Base: ${r.base.toFixed(2)}</span>
                      {r.bonus > 0 && <span className="text-muted-foreground">Bonus: ${r.bonus.toFixed(2)}</span>}
                      {r.transportMonthly > 0 && (
                        <span className="text-muted-foreground flex flex-wrap items-center gap-1">
                          <span>Transport/mo:</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={transportOverrides[r.id] ?? r.transportMonthly.toFixed(2)}
                            onChange={(e) => setTransportOverrides((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="w-20 h-6 text-xs font-mono px-1"
                            data-testid={`input-transport-${r.id}`}
                          />
                          {hasAtt && r.totalWorkingDays > 0 && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-mono whitespace-nowrap">
                              {r.presentDays % 1 === 0 ? r.presentDays.toFixed(0) : r.presentDays}/{r.totalWorkingDays}d
                              {" = "}${proratedTransport.toFixed(2)}
                            </span>
                          )}
                        </span>
                      )}
                      <span className="font-semibold">Net: ${computedNet.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Advances section */}
                  {r.totalAdvanceBalance > 0 && (
                    <div className="border-t bg-muted/30 px-3 py-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" size="sm" className="h-auto py-0.5 px-1 gap-1 text-xs"
                          onClick={() => setExpandedAdvanceWorkers((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                            return next;
                          })}
                          data-testid={`button-expand-advances-${r.id}`}>
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {r.pendingAdvances.length} outstanding advance{r.pendingAdvances.length !== 1 ? "s" : ""} · Total: ${r.totalAdvanceBalance.toFixed(2)}
                        </Button>
                        <div className="flex items-center gap-2 ml-auto">
                          <span className="text-xs text-muted-foreground">Deduct:</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={r.totalAdvanceBalance}
                            value={advanceOverrides[r.id] ?? r.totalAdvanceBalance.toFixed(2)}
                            onChange={(e) => setAdvanceOverrides((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="w-28 h-7 text-xs font-mono"
                            data-testid={`input-advance-deduct-${r.id}`}
                          />
                          <Button variant="outline" size="sm" className="h-7 text-xs"
                            onClick={() => setAdvanceOverrides((prev) => ({ ...prev, [r.id]: r.totalAdvanceBalance.toFixed(2) }))}
                            data-testid={`button-deduct-all-${r.id}`}>
                            All
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs"
                            onClick={() => setAdvanceOverrides((prev) => ({ ...prev, [r.id]: "0" }))}
                            data-testid={`button-deduct-none-${r.id}`}>
                            None
                          </Button>
                        </div>
                      </div>

                      {/* Advance records breakdown */}
                      {isExpanded && (
                        <div className="space-y-1 pt-1">
                          {r.pendingAdvances.map((adv) => (
                            <div key={adv.id} className="flex flex-wrap items-center gap-2 text-xs py-1 border-t border-border/50">
                              <span className="font-mono text-muted-foreground">{adv.advanceDate}</span>
                              <span className="text-muted-foreground">Original: <span className="font-mono">${parseFloat(adv.amount).toFixed(2)}</span></span>
                              <span>Remaining: <span className="font-mono font-medium">${parseFloat(adv.remainingBalance).toFixed(2)}</span></span>
                              {adv.notes && <span className="text-muted-foreground italic truncate max-w-[200px]">{adv.notes}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Back</Button>
            <Button
              variant="outline"
              onClick={async () => {
                const rows = previewRows.map((r) => {
                  const mRate = parseFloat(transportOverrides[r.id] ?? r.transportMonthly.toFixed(2));
                  const rHasAtt = r.presentDates.length > 0 || r.absentDates.length > 0 || r.halfDayDates.length > 0;
                  const transportAmt = rHasAtt && r.totalWorkingDays > 0
                    ? (r.presentDays / r.totalWorkingDays) * mRate
                    : mRate;
                  const deductAmt = parseFloat(advanceOverrides[r.id] || "0");
                  const net = r.base + r.bonus + transportAmt - deductAmt;
                  return {
                    "Name": r.name,
                    "Position": r.position || "",
                    "Present Days": r.presentDays,
                    "Total Days": r.totalWorkingDays,
                    "Absent Days": r.absentDays,
                    "Base ($)": r.base.toFixed(2),
                    "Bonus ($)": r.bonus.toFixed(2),
                    "Transport/mo ($)": mRate.toFixed(2),
                    "Transport Paid ($)": transportAmt.toFixed(2),
                    "Advance Deduction ($)": deductAmt.toFixed(2),
                    "Net Pay ($)": net.toFixed(2),
                  };
                });
                const totalNet = previewRows.reduce((s, r) => {
                  const mRate = parseFloat(transportOverrides[r.id] ?? r.transportMonthly.toFixed(2));
                  const rHasAtt = r.presentDates.length > 0 || r.absentDates.length > 0 || r.halfDayDates.length > 0;
                  const transportAmt = rHasAtt && r.totalWorkingDays > 0
                    ? (r.presentDays / r.totalWorkingDays) * mRate
                    : mRate;
                  const deductAmt = parseFloat(advanceOverrides[r.id] || "0");
                  return s + r.base + r.bonus + transportAmt - deductAmt;
                }, 0);
                rows.push({
                  "Name": "TOTAL",
                  "Position": "",
                  "Present Days": "" as any,
                  "Absent Days": "" as any,
                  "Base ($)": "",
                  "Bonus ($)": "",
                  "Transport ($)": "",
                  "Advance Deduction ($)": "",
                  "Net Pay ($)": totalNet.toFixed(2),
                });
                const ws = XLSX.utils.json_to_sheet(rows);
                const colWidths = [
                  { wch: 28 }, { wch: 22 }, { wch: 14 }, { wch: 13 },
                  { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 14 },
                ];
                ws["!cols"] = colWidths;
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Payroll");
                await XLSX.writeFile(wb, `Payroll_${runForm.periodStart}_${runForm.periodEnd}.xlsx`);
              }}
              data-testid="button-export-payroll-excel"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || previewRows.length === 0}
              data-testid="button-confirm-payroll"
            >
              {generateMutation.isPending ? "Generating..." : `Generate ${previewRows.length} Records`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attendance Detail Dialog */}
      <Dialog open={attendanceDetail !== null} onOpenChange={(open) => { if (!open) setAttendanceDetail(null); }}>
        <DialogContent className="max-w-md" data-testid="dialog-attendance-detail">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Attendance Details — {attendanceDetail?.name}
            </DialogTitle>
          </DialogHeader>
          {attendanceDetail && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {attendanceDetail.presentDates.length === 0 && attendanceDetail.absentDates.length === 0 && attendanceDetail.halfDayDates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No attendance records for this period.</p>
              ) : (
                <>
                  {attendanceDetail.presentDates.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">
                        Present ({attendanceDetail.presentDates.length})
                      </p>
                      <div className="space-y-0.5">
                        {attendanceDetail.presentDates.map((e) => (
                          <div key={e.date} className="flex items-center justify-between text-sm py-0.5">
                            <span className="font-mono text-muted-foreground">{e.date}</span>
                            <Badge variant="outline" className="text-xs border-green-400 text-green-700 dark:text-green-400">{e.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {attendanceDetail.halfDayDates.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">
                        Half Day ({attendanceDetail.halfDayDates.length})
                      </p>
                      <div className="space-y-0.5">
                        {attendanceDetail.halfDayDates.map((e) => (
                          <div key={e.date} className="flex items-center justify-between text-sm py-0.5">
                            <span className="font-mono text-muted-foreground">{e.date}</span>
                            <Badge variant="outline" className="text-xs border-amber-400 text-amber-700 dark:text-amber-400">{e.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {attendanceDetail.absentDates.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">
                        Absent ({attendanceDetail.absentDates.length})
                      </p>
                      <div className="space-y-0.5">
                        {attendanceDetail.absentDates.map((e) => (
                          <div key={e.date} className="flex items-center justify-between text-sm py-0.5">
                            <span className="font-mono text-muted-foreground">{e.date}</span>
                            <Badge variant="outline" className="text-xs border-red-400 text-red-700 dark:text-red-400">{e.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttendanceDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Pay Dialog */}
      <Dialog open={payOpen} onOpenChange={(open) => { if (!open) { setPayOpen(false); setPayTargetId(null); } }}>
        <DialogContent data-testid="dialog-mark-paid">
          <DialogHeader>
            <DialogTitle>Pay Worker</DialogTitle>
            <DialogDescription>Select the payment date and cash or bank account. This will settle the payroll liability.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Payment Date</Label>
              <Input
                type="date"
                value={payPaymentDate}
                onChange={(e) => setPayPaymentDate(e.target.value)}
                data-testid="input-pay-payment-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cash / Bank Account</Label>
              <Select value={payCashAccountId} onValueChange={setPayCashAccountId}>
                <SelectTrigger data-testid="select-pay-cash-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button
              onClick={() => payTargetId && markPaidMutation.mutate({ id: payTargetId, cashId: payCashAccountId, paymentDate: payPaymentDate })}
              disabled={markPaidMutation.isPending || !payPaymentDate}
              data-testid="button-confirm-pay"
            >
              {markPaidMutation.isPending ? "Saving..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix Accounting Dialog — generate missing voucher for old PAID payrolls */}
      <Dialog open={fixAcctOpen} onOpenChange={(open) => { if (!open) { setFixAcctOpen(false); setFixAcctTargetId(null); } }}>
        <DialogContent className="max-w-sm" data-testid="dialog-fix-accounting">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-amber-500" />
              Generate Accounting Entry
            </DialogTitle>
            <DialogDescription>
              This payroll was marked paid without recording a cash account. Select which account the money came from to generate the missing payment voucher.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Cash / Bank Account</Label>
              <Select value={fixAcctCashId} onValueChange={setFixAcctCashId}>
                <SelectTrigger data-testid="select-fix-cash-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFixAcctOpen(false)}>Cancel</Button>
            <Button
              onClick={() => fixAcctTargetId && fixAcctMutation.mutate({ id: fixAcctTargetId, cashId: fixAcctCashId })}
              disabled={fixAcctMutation.isPending || !fixAcctCashId}
              data-testid="button-confirm-fix-acct"
            >
              {fixAcctMutation.isPending ? "Generating..." : "Generate Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Pay Dialog */}
      <Dialog open={bulkPayOpen} onOpenChange={setBulkPayOpen}>
        <DialogContent data-testid="dialog-bulk-pay">
          <DialogHeader>
            <DialogTitle>Pay {selectedIds.size} Records</DialogTitle>
            <DialogDescription>Select the payment date and cash or bank account for this bulk payment. This settles the payroll liability for all selected workers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Payment Date</Label>
              <Input
                type="date"
                value={bulkPaymentDate}
                onChange={(e) => setBulkPaymentDate(e.target.value)}
                data-testid="input-bulk-payment-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cash / Bank Account</Label>
              <Select value={bulkCashAccountId} onValueChange={setBulkCashAccountId}>
                <SelectTrigger data-testid="select-bulk-cash-account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPayOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkMarkPaidMutation.mutate({ cashId: bulkCashAccountId, paymentDate: bulkPaymentDate })}
              disabled={bulkMarkPaidMutation.isPending || !bulkPaymentDate}
              data-testid="button-confirm-bulk-pay"
            >
              {bulkMarkPaidMutation.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-payment: Print Summary Dialog */}
      <Dialog open={printSummaryOpen} onOpenChange={setPrintSummaryOpen}>
        <DialogContent data-testid="dialog-print-summary">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Payment Recorded
            </DialogTitle>
            <DialogDescription>
              {paidPayrollIds.length} worker{paidPayrollIds.length !== 1 ? "s" : ""} marked as paid. You can print a compact payment summary PDF.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintSummaryOpen(false)}>Close</Button>
            <Button onClick={printSummaryPDF} data-testid="button-print-summary">
              <Printer className="h-4 w-4 mr-2" />
              Print Summary PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Undo Confirmation */}
      {(() => {
        const undoTarget = undoTargetId ? (payrolls || []).find((p) => p.id === undoTargetId) : null;
        const isPaid = undoTarget?.status === "PAID";
        return (
          <Dialog open={undoTargetId !== null} onOpenChange={(open) => !open && setUndoTargetId(null)}>
            <DialogContent data-testid="dialog-undo">
              <DialogHeader>
                <DialogTitle>Undo Payroll</DialogTitle>
                <DialogDescription>
                  {isPaid
                    ? "This will revert the payroll back to Draft, remove the payment record, and delete all related accounting entries. Advance deductions will also be restored."
                    : "This will delete the draft payroll and restore any advance deductions made at generation time."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setUndoTargetId(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => undoTargetId && undoMutation.mutate(undoTargetId)}
                  disabled={undoMutation.isPending}
                  data-testid="button-confirm-undo"
                >
                  {undoMutation.isPending ? "Undoing..." : "Undo"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Batch Delete Confirmation */}
      <Dialog open={deleteBatchGroup !== null} onOpenChange={(open) => !open && setDeleteBatchGroup(null)}>
        <DialogContent data-testid="dialog-delete-batch">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete Entire Batch
            </DialogTitle>
            <DialogDescription>
              This will reverse all {deleteBatchGroup?.records.length} payroll record{deleteBatchGroup?.records.length !== 1 ? "s" : ""} for{" "}
              <strong>{deleteBatchGroup ? `${fmtDate(deleteBatchGroup.periodStart, (d) => d.toString())} – ${fmtDate(deleteBatchGroup.periodEnd, (d) => d.toString())}` : ""}</strong>.
              All payments will be undone, accounting entries deleted, and advance deductions restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteBatchGroup(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteBatchGroup && batchDeleteMutation.mutate(deleteBatchGroup)}
              disabled={batchDeleteMutation.isPending}
              data-testid="button-confirm-delete-batch"
            >
              {batchDeleteMutation.isPending ? "Deleting..." : "Delete Batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Draft Payroll</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this draft payroll record? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTargetId && deleteMutation.mutate(deleteTargetId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Repair Ledger Dialog */}
      <Dialog open={repairOpen} onOpenChange={(open) => { if (!open) setRepairOpen(false); }}>
        <DialogContent data-testid="dialog-repair-ledger">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" />
              Repair Ledger
            </DialogTitle>
            <DialogDescription>
              This scans for payment vouchers that were left behind when payrolls were undone or advances were deleted — the ones making your cash account balance incorrect. It will permanently remove them from the ledger.
            </DialogDescription>
          </DialogHeader>

          {repairResult && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <p className="font-medium text-foreground">Repair complete</p>
              <p className="text-muted-foreground">Payroll payment vouchers removed: <span className="font-semibold text-foreground">{repairResult.deletedPayrollVouchers}</span></p>
              <p className="text-muted-foreground">Advance payment vouchers removed: <span className="font-semibold text-foreground">{repairResult.deletedAdvanceVouchers}</span></p>
              <p className="text-muted-foreground">Total removed: <span className="font-semibold text-foreground">{repairResult.total}</span></p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairOpen(false)}>
              {repairResult ? "Close" : "Cancel"}
            </Button>
            {!repairResult && (
              <Button
                onClick={() => repairMutation.mutate()}
                disabled={repairMutation.isPending}
                data-testid="button-confirm-repair"
              >
                {repairMutation.isPending ? "Scanning & repairing..." : "Run Repair"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
