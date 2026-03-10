import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import {
  Play, CheckCircle2, Clock, DollarSign, ChevronDown, X, Users,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payrolls"] });
      toast({ title: "Marked as paid" });
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
      toast({ title: "Marked as paid", description: `${selectedIds.size} records updated` });
      setSelectedIds(new Set()); setBulkPayOpen(false); setBulkCashAccountId("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const stats = useMemo(() => {
    const all = payrolls || [];
    const uniqueWorkers = new Set(all.map((p) => p.workerId)).size;
    const pending = all.filter((p) => p.status !== "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
    const paid = all.filter((p) => p.status === "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0);
    return { uniqueWorkers, pending, paid };
  }, [payrolls]);

  const previewData = useMemo(() => {
    if (!activeWorkers.length) return [];
    const target = runForm.targetAll ? activeWorkers : activeWorkers.filter((w) => runForm.pickedWorkerIds.includes(w.id));
    const start = new Date(runForm.periodStart);
    const end = new Date(runForm.periodEnd);
    const days = runForm.daysCount ? parseInt(runForm.daysCount) : Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    const bonus = parseFloat(runForm.bonusPerWorker || "0");
    const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

    return target.map((w) => {
      const base = parseFloat(w.baseSalary || "0");
      const freq = (w as any).payFrequency || w.salaryType || "Monthly";
      let calc = 0;
      if (freq === "Weekly") calc = (days / 7) * parseFloat((w as any).weeklySalary || base.toString());
      else if (freq === "Bi-Weekly") calc = (days / 14) * parseFloat((w as any).biWeeklySalary || base.toString());
      else if (freq === "Daily" || w.salaryType === "Daily") calc = days * base;
      else calc = base * (days / daysInMonth);
      const net = calc + bonus;
      return { id: w.id, name: w.fullName, position: w.position, base: calc, bonus, net };
    });
  }, [activeWorkers, runForm]);

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
          <p className="text-xs text-muted-foreground">{payrolls?.length || 0} total records</p>
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
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : payrolls?.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <DollarSign className="mx-auto h-8 w-8 mb-3 opacity-30" />
              <p className="font-medium">No payroll records yet</p>
              <p className="text-sm mt-1">Click "Run Payroll" to generate records</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(v) => {
                          if (v) setSelectedIds(new Set(unpaidPayrolls.map((p) => p.id)));
                          else setSelectedIds(new Set());
                        }}
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-center">Attendance</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Bonus</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid On</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrolls?.map((p) => {
                    const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.DRAFT;
                    const canPay = p.status !== "PAID";
                    return (
                      <TableRow key={p.id} data-testid={`row-payroll-${p.id}`}>
                        <TableCell>
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
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(p.periodStart, formatDisplayDate)} – {fmtDate(p.periodEnd, formatDisplayDate)}
                        </TableCell>
                        <TableCell className="text-center" data-testid={`text-attendance-${p.id}`}>
                          {p.totalWorkingDays && p.totalWorkingDays > 0 ? (
                            <div className="text-sm font-mono">
                              <span>{Number(p.presentDays) % 1 === 0 ? Number(p.presentDays).toFixed(0) : p.presentDays}/{p.totalWorkingDays}</span>
                              <span className="block text-xs text-muted-foreground">{Number(p.absentDays) > 0 ? `${Number(p.absentDays) % 1 === 0 ? Number(p.absentDays).toFixed(0) : p.absentDays} absent` : "full"}</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">${fmt(p.baseSalary)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">${fmt(p.bonuses)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">${fmt(p.deductions)}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold">${fmt(p.netSalary)}</TableCell>
                        <TableCell>
                          <Badge variant={cfg.variant} className={`text-xs ${cfg.className}`}>
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.paidAt ? fmtDate(p.paidAt, formatDisplayDate) : "—"}</TableCell>
                        <TableCell>
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
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
              <Label className="text-xs">Cash Account</Label>
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
            <Button onClick={() => setPreviewOpen(true)} data-testid="button-preview-payroll">
              <ChevronDown className="h-4 w-4 mr-2" />Preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-preview-payroll">
          <DialogHeader>
            <DialogTitle>Payroll Preview</DialogTitle>
            <DialogDescription>
              {previewData.length} workers · Period: {runForm.periodStart} to {runForm.periodEnd} · Total: ${previewData.reduce((s, r) => s + r.net, 0).toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{r.name}</p>
                      {r.position && <p className="text-xs text-muted-foreground">{r.position}</p>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">${r.base.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">${r.bonus.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">${r.net.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Back</Button>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || previewData.length === 0}
              data-testid="button-confirm-payroll"
            >
              {generateMutation.isPending ? "Generating..." : `Generate ${previewData.length} Records`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={(open) => { if (!open) { setPayOpen(false); setPayTargetId(null); } }}>
        <DialogContent data-testid="dialog-mark-paid">
          <DialogHeader>
            <DialogTitle>Mark as Paid</DialogTitle>
            <DialogDescription>Select the cash account to record this payment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Cash Account</Label>
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

      <Dialog open={bulkPayOpen} onOpenChange={setBulkPayOpen}>
        <DialogContent data-testid="dialog-bulk-pay">
          <DialogHeader>
            <DialogTitle>Pay {selectedIds.size} Records</DialogTitle>
            <DialogDescription>Select the cash account for this bulk payment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Cash Account</Label>
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
    </div>
  );
}
