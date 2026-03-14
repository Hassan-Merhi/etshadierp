import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import {
  Play, CheckCircle2, Clock, DollarSign, ChevronDown, ChevronRight, X, Users, Trash2, CalendarDays, Printer,
} from "lucide-react";
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
interface PreviewWorkerRow {
  id: number;
  name: string;
  position: string | null;
  base: number;
  bonus: number;
  advanceDeduction: number;
  net: number;
  totalWorkingDays: number;
  presentDays: number;
  absentDays: number;
  presentDates: AttendanceEntry[];
  absentDates: AttendanceEntry[];
  halfDayDates: AttendanceEntry[];
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline"; className: string }> = {
  DRAFT: { label: "Draft", variant: "outline", className: "border-amber-400 text-amber-700 dark:text-amber-400" },
  APPROVED: { label: "Approved", variant: "outline", className: "border-blue-400 text-blue-700 dark:text-blue-400" },
  PAID: { label: "Paid", variant: "outline", className: "border-green-500 text-green-700 dark:text-green-400" },
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

export default function FactoryPayrollTab() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();

  const [runOpen, setRunOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payTargetId, setPayTargetId] = useState<number | null>(null);
  const [payCashAccountId, setPayCashAccountId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkPayOpen, setBulkPayOpen] = useState(false);
  const [bulkCashAccountId, setBulkCashAccountId] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Post-pay PDF state
  const [paidPayrollIds, setPaidPayrollIds] = useState<number[]>([]);
  const [printSummaryOpen, setPrintSummaryOpen] = useState(false);

  const [runForm, setRunForm] = useState({
    periodStart: new Date().toISOString().slice(0, 7) + "-01",
    periodEnd: new Date().toISOString().split("T")[0],
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
      setPreviewOpen(true);
    },
    onError: (err: Error) => toast({ title: "Preview failed", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        periodStart: runForm.periodStart, periodEnd: runForm.periodEnd,
        bonusPerWorker: runForm.bonusPerWorker, notes: runForm.notes,
        cashAccountId: runForm.cashAccountId || undefined,
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
      toast({ title: "Payroll generated", description: `${data.created} records created` });
      setRunOpen(false); setPreviewOpen(false);
      // Auto-expand the new group
      const key = `${runForm.periodStart}|${runForm.periodEnd}`;
      setExpandedGroups((prev) => new Set([...prev, key]));
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, cashId }: { id: number; cashId: string }) => {
      const res = await apiRequest("PATCH", `/api/factory/payrolls/${id}/mark-paid`, {
        cashAccountId: cashId ? parseInt(cashId) : undefined,
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
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkMarkPaidMutation = useMutation({
    mutationFn: async (cashId: string) => {
      const res = await apiRequest("POST", "/api/factory/payrolls/mark-paid-bulk", {
        payrollIds: [...selectedIds], cashAccountId: cashId ? parseInt(cashId) : undefined,
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
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/payroll/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      toast({ title: "Draft payroll deleted" });
      setDeleteTargetId(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Workers on Payroll</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="stat-workers">{stats.uniqueWorkers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Paid</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="stat-paid">${stats.paid.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Payment</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="stat-pending">${stats.pending.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold">Payroll Records</h2>
          <p className="text-xs text-muted-foreground">{payrolls?.length || 0} total · {payrollGroups.length} batch{payrollGroups.length !== 1 ? "es" : ""}</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button variant="outline" onClick={() => setBulkPayOpen(true)} data-testid="button-bulk-pay">
              <DollarSign className="h-4 w-4 mr-2" />
              Pay {selectedIds.size} Selected
            </Button>
          )}
          <Button onClick={() => setRunOpen(true)} data-testid="button-run-payroll">
            <Play className="h-4 w-4 mr-2" />
            Run Payroll
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : payrollGroups.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <DollarSign className="mx-auto h-8 w-8 mb-3 opacity-30" />
              <p className="font-medium">No payroll records yet</p>
              <p className="text-sm mt-1">Click "Run Payroll" to generate records</p>
            </div>
          ) : (
            <div className="divide-y">
              {payrollGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.key);
                const total = group.records.reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
                const paidCount = group.records.filter((p) => p.status === "PAID").length;
                const unpaidCount = group.records.length - paidCount;
                const groupUnpaid = group.records.filter((p) => p.status !== "PAID");
                const allGroupSelected = groupUnpaid.length > 0 && groupUnpaid.every((p) => selectedIds.has(p.id));

                return (
                  <div key={group.key}>
                    {/* Batch summary row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
                      onClick={() => toggleGroup(group.key)}
                      data-testid={`group-${group.key}`}
                    >
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {fmtDate(group.periodStart, formatDisplayDate)} – {fmtDate(group.periodEnd, formatDisplayDate)}
                        </p>
                        <p className="text-xs text-muted-foreground">{group.records.length} worker{group.records.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-semibold font-mono">${total.toFixed(2)}</p>
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
                      </div>
                    </div>

                    {/* Expanded worker rows */}
                    {isExpanded && (
                      <div className="overflow-x-auto bg-muted/30">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10 pl-8"></TableHead>
                              <TableHead>Worker</TableHead>
                              <TableHead className="text-center">Present</TableHead>
                              <TableHead className="text-center">Absent</TableHead>
                              <TableHead className="text-right">Net</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Paid On</TableHead>
                              <TableHead></TableHead>
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
                                        onCheckedChange={() => toggleSelect(p.id)}
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
                                    <Badge variant={cfg.variant} className={`text-xs ${cfg.className}`}>
                                      {cfg.label}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">{p.paidAt ? fmtDate(p.paidAt, formatDisplayDate) : "—"}</TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      {canPay && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => { setPayTargetId(p.id); setPayCashAccountId(""); setPayOpen(true); }}
                                          data-testid={`button-pay-${p.id}`}
                                        >
                                          Pay
                                        </Button>
                                      )}
                                      {p.status === "DRAFT" && (
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          onClick={() => setDeleteTargetId(p.id)}
                                          data-testid={`button-delete-payroll-${p.id}`}
                                        >
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                      )}
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
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
        <DialogContent className="max-w-3xl" data-testid="dialog-preview-payroll">
          <DialogHeader>
            <DialogTitle>Payroll Preview</DialogTitle>
            <DialogDescription>
              {previewRows.length} workers · Period: {runForm.periodStart} to {runForm.periodEnd} · Total: ${previewRows.reduce((s, r) => s + r.net, 0).toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead className="text-center">Present</TableHead>
                  <TableHead className="text-center">Absent</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((r) => {
                  const hasAtt = r.totalWorkingDays > 0 || r.presentDates.length > 0 || r.absentDates.length > 0 || r.halfDayDates.length > 0;
                  return (
                    <TableRow key={r.id} data-testid={`row-preview-${r.id}`}>
                      <TableCell>
                        <p className="text-sm font-medium">{r.name}</p>
                        {r.position && <p className="text-xs text-muted-foreground">{r.position}</p>}
                      </TableCell>
                      <TableCell className="text-center">
                        {hasAtt ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto py-0.5 px-2 font-mono text-green-700 dark:text-green-400"
                            onClick={() => setAttendanceDetail({ name: r.name, presentDates: r.presentDates, absentDates: r.absentDates, halfDayDates: r.halfDayDates })}
                            data-testid={`button-present-${r.id}`}
                          >
                            {r.presentDays % 1 === 0 ? r.presentDays.toFixed(0) : r.presentDays}
                            {r.halfDayDates.length > 0 && (
                              <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">½</Badge>
                            )}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {hasAtt ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto py-0.5 px-2 font-mono text-red-700 dark:text-red-400"
                            onClick={() => setAttendanceDetail({ name: r.name, presentDates: r.presentDates, absentDates: r.absentDates, halfDayDates: r.halfDayDates })}
                            data-testid={`button-absent-${r.id}`}
                          >
                            {r.absentDays % 1 === 0 ? r.absentDays.toFixed(0) : r.absentDays}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">${r.base.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">${r.bonus.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">${r.net.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Back</Button>
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
            <DialogDescription>Select the cash or bank account to record this payment. This will settle the payroll liability.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
              onClick={() => payTargetId && markPaidMutation.mutate({ id: payTargetId, cashId: payCashAccountId })}
              disabled={markPaidMutation.isPending}
              data-testid="button-confirm-pay"
            >
              {markPaidMutation.isPending ? "Saving..." : "Confirm Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Pay Dialog */}
      <Dialog open={bulkPayOpen} onOpenChange={setBulkPayOpen}>
        <DialogContent data-testid="dialog-bulk-pay">
          <DialogHeader>
            <DialogTitle>Pay {selectedIds.size} Records</DialogTitle>
            <DialogDescription>Select the cash or bank account for this bulk payment. This settles the payroll liability for all selected workers.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
              onClick={() => bulkMarkPaidMutation.mutate(bulkCashAccountId)}
              disabled={bulkMarkPaidMutation.isPending}
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
    </div>
  );
}
