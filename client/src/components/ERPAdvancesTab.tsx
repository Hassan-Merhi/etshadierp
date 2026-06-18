import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Plus, Trash2, Banknote, RotateCcw, Users, Loader2, ChevronDown, ChevronRight, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";

interface AdvanceRecord {
  id: number;
  companyId: number;
  employeeId: number;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  notes: string | null;
  fullyPaid: boolean;
  isOpeningBalance: boolean;
  createdAt: string;
}

interface DeductionRecord {
  id: number;
  salaryAdvanceId: number;
  payrollMonth: string;
  deductionAmount: string;
  createdAt: string;
  advanceDate: string;
  advanceAmount: string;
  advanceRemaining: string;
  employeeId: number;
  workerName: string;
}

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  department: string | null;
  employeeType: string;
  monthlySalary: string | null;
  active: boolean;
}

interface LedgerAccount {
  id: number;
  name: string;
  code: string;
  accountType: string;
}

function fmt(val: string | number | null | undefined, formatAmount: (n: number) => string) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? formatAmount(0) : formatAmount(n);
}

export default function ERPAdvancesTab() {
  const [subTab, setSubTab] = useState("advances");

  return (
    <Tabs value={subTab} onValueChange={setSubTab}>
      <TabsList className="mb-4">
        <TabsTrigger value="advances" data-testid="subtab-erp-advances">
          <Banknote className="h-4 w-4 mr-2" />
          Advances
        </TabsTrigger>
        <TabsTrigger value="repayments" data-testid="subtab-erp-repayments">
          <RotateCcw className="h-4 w-4 mr-2" />
          Repayments
        </TabsTrigger>
        <TabsTrigger value="worker-deductions" data-testid="subtab-erp-worker-deductions">
          <Scissors className="h-4 w-4 mr-2" />
          Worker Deductions
        </TabsTrigger>
      </TabsList>
      <TabsContent value="advances" className="mt-0">
        <AdvancesView />
      </TabsContent>
      <TabsContent value="repayments" className="mt-0">
        <RepaymentsView />
      </TabsContent>
      <TabsContent value="worker-deductions" className="mt-0">
        <WorkerDeductionsView />
      </TabsContent>
    </Tabs>
  );
}

function AdvancesView() {
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [filterWorker, setFilterWorker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showPaid, setShowPaid] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdvanceRecord | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [bulkAmounts, setBulkAmounts] = useState<Record<number, string>>({});
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkForm, setBulkForm] = useState({
    advanceDate: new Date().toLocaleDateString('en-CA'),
    notes: "",
    cashAccountId: "",
  });
  const [form, setForm] = useState({
    employeeId: "",
    advanceDate: new Date().toLocaleDateString('en-CA'),
    amount: "",
    notes: "",
    cashAccountId: "",
  });

  const { data: advances, isLoading } = useQuery<AdvanceRecord[]>({
    queryKey: ["/api/salary-advances"],
  });

  const { data: allEmployees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: ledgerAccounts } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
  });
  const cashAccounts = (ledgerAccounts || []).filter((a) => a.accountType === "Cash");

  const workers = useMemo(
    () => (allEmployees || []).filter((e) => e.employeeType === "Worker"),
    [allEmployees],
  );

  const workerById = useMemo(() => {
    const map: Record<number, Employee> = {};
    for (const w of workers) map[w.id] = w;
    return map;
  }, [workers]);

  const workerAdvances = useMemo(() => {
    const workerIds = new Set(workers.map((w) => w.id));
    return (advances || []).filter((a) => workerIds.has(a.employeeId));
  }, [advances, workers]);

  const filtered = useMemo(() => {
    let list = workerAdvances;
    if (filterWorker !== "all") list = list.filter((a) => a.employeeId === parseInt(filterWorker));
    if (filterStatus === "outstanding") list = list.filter((a) => !a.fullyPaid);
    if (filterStatus === "paid") list = list.filter((a) => a.fullyPaid);
    return list;
  }, [workerAdvances, filterWorker, filterStatus]);

  const stats = useMemo(() => {
    const totalGiven = workerAdvances.reduce((s, a) => s + parseFloat(a.amount || "0"), 0);
    const totalOutstanding = workerAdvances.filter((a) => !a.fullyPaid).reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
    const outstandingCount = workerAdvances.filter((a) => !a.fullyPaid).length;
    return { totalGiven, totalOutstanding, outstandingCount };
  }, [workerAdvances]);

  const fmtDate = (val: string | null | undefined) => {
    if (!val) return "—";
    try { return formatDisplayDate(val); } catch { return "—"; }
  };

  const getWorkerName = (employeeId: number) => {
    const w = workerById[employeeId];
    if (!w) return String(employeeId);
    return `${w.firstName} ${w.lastName}`.trim();
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.employeeId) throw new Error("Please select a worker");
      if (!form.amount || parseFloat(form.amount) <= 0) throw new Error("Please enter a valid amount");
      if (!form.cashAccountId) throw new Error("Please select a cash account");
      const res = await apiRequest("POST", "/api/salary-advances", {
        employeeId: parseInt(form.employeeId),
        advanceDate: form.advanceDate,
        amount: form.amount,
        remainingBalance: form.amount,
        notes: form.notes || undefined,
        isOpeningBalance: false,
        cashAccountId: parseInt(form.cashAccountId),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create advance");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Advance recorded" });
      setAddOpen(false);
      setForm({ employeeId: "", advanceDate: new Date().toLocaleDateString('en-CA'), amount: "", notes: "", cashAccountId: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/salary-advances/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Advance deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const items = Array.from(bulkSelected)
        .map((wid) => ({ employeeId: wid, amount: bulkAmounts[wid] || "" }))
        .filter((i) => parseFloat(i.amount) > 0);
      if (items.length === 0) throw new Error("No workers with valid amounts");
      if (!bulkForm.cashAccountId) throw new Error("Please select a cash account");
      const results = await Promise.all(
        items.map((item) =>
          apiRequest("POST", "/api/salary-advances", {
            employeeId: item.employeeId,
            advanceDate: bulkForm.advanceDate,
            amount: item.amount,
            remainingBalance: item.amount,
            notes: bulkForm.notes || undefined,
            isOpeningBalance: false,
            cashAccountId: parseInt(bulkForm.cashAccountId),
          }),
        ),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) throw new Error(`${failed.length} advance(s) failed to create`);
      return { created: items.length };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Bulk advances recorded", description: `${data.created} advance(s) created` });
      setBulkOpen(false);
      setBulkAmounts({});
      setBulkSelected(new Set());
      setBulkForm({ advanceDate: new Date().toLocaleDateString('en-CA'), notes: "", cashAccountId: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/salary-advances/reconcile", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Reconciliation failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Reconciliation complete", description: data.message });
      setReconcileOpen(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-64 rounded-md" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30">
              <Banknote className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Given</p>
              <p className="text-lg font-bold" data-testid="text-erp-advances-total-given">
                {fmt(stats.totalGiven, formatAmount)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-amber-100 dark:bg-amber-900/30">
              <Banknote className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-lg font-bold" data-testid="text-erp-advances-outstanding">
                {fmt(stats.totalOutstanding, formatAmount)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30">
              <Banknote className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active Advances</p>
              <p className="text-lg font-bold" data-testid="text-erp-advances-active-count">
                {stats.outstandingCount}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-48" data-testid="select-erp-filter-worker">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {`${w.firstName} ${w.lastName}`.trim()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40" data-testid="select-erp-filter-status">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="outstanding">Outstanding</SelectItem>
            <SelectItem value="paid">Fully Paid</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="button-erp-bulk-advance">
            <Users className="h-4 w-4 mr-2" />Bulk Advance
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-erp-add-advance">
            <Plus className="h-4 w-4 mr-2" />Add Advance
          </Button>
        </div>
      </div>

      {(() => {
        const outstanding = filtered.filter(a => !a.fullyPaid);
        const paid        = filtered.filter(a => a.fullyPaid);

        const renderRow = (adv: AdvanceRecord) => (
          <TableRow key={adv.id} data-testid={`row-erp-advance-${adv.id}`}
            className={adv.fullyPaid ? "opacity-60" : ""}
          >
            <TableCell className="font-medium" data-testid={`text-erp-advance-worker-${adv.id}`}>
              {getWorkerName(adv.employeeId)}
            </TableCell>
            <TableCell>{fmtDate(adv.advanceDate)}</TableCell>
            <TableCell className="text-right font-mono">{fmt(adv.amount, formatAmount)}</TableCell>
            <TableCell className="text-right font-mono">{fmt(adv.remainingBalance, formatAmount)}</TableCell>
            <TableCell>
              <Badge variant="outline" className="border-slate-400 text-slate-700 dark:text-slate-400">
                Salary Ded.
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={adv.fullyPaid
                ? "border-green-500 text-green-700 dark:text-green-400"
                : "border-amber-400 text-amber-700 dark:text-amber-400"
              }>
                {adv.fullyPaid ? "Paid" : "Outstanding"}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
              {adv.notes || "—"}
            </TableCell>
            <TableCell>
              {!adv.fullyPaid && (
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(adv)}
                  data-testid={`button-delete-erp-advance-${adv.id}`}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        );

        const colHeaders = (
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
        );

        return (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                {colHeaders}
                <TableBody>
                  {outstanding.length === 0 && paid.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No advances found
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {outstanding.map(renderRow)}

                      {paid.length > 0 && (
                        <>
                          <TableRow
                            className="cursor-pointer hover-elevate bg-muted/30"
                            onClick={() => setShowPaid(p => !p)}
                            data-testid="row-toggle-paid"
                          >
                            <TableCell colSpan={8} className="py-2">
                              <span className="flex items-center gap-2 text-sm text-muted-foreground select-none">
                                {showPaid
                                  ? <ChevronDown className="h-4 w-4" />
                                  : <ChevronRight className="h-4 w-4" />
                                }
                                {paid.length} paid advance{paid.length !== 1 ? "s" : ""}
                              </span>
                            </TableCell>
                          </TableRow>
                          {showPaid && paid.map(renderRow)}
                        </>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })()}

      {/* Add Advance Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-erp-add-advance">
          <DialogHeader>
            <DialogTitle>Add Advance</DialogTitle>
            <DialogDescription>Record a salary advance for a worker</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Worker</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm((p) => ({ ...p, employeeId: v }))}>
                <SelectTrigger data-testid="select-erp-advance-worker">
                  <SelectValue placeholder="Select worker" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {`${w.firstName} ${w.lastName}`.trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.advanceDate}
                  onChange={(e) => setForm((p) => ({ ...p, advanceDate: e.target.value }))}
                  data-testid="input-erp-advance-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                  data-testid="input-erp-advance-amount"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cash Account</Label>
              <Select
                value={form.cashAccountId}
                onValueChange={(v) => setForm((p) => ({ ...p, cashAccountId: v }))}
              >
                <SelectTrigger data-testid="select-erp-advance-cash-account">
                  <SelectValue placeholder="Select cash account" />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.length === 0 ? (
                    <SelectItem value="none" disabled>No cash accounts available</SelectItem>
                  ) : (
                    cashAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.name} ({acc.code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Reason or notes..."
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className="resize-none"
                rows={2}
                data-testid="input-erp-advance-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              data-testid="button-submit-erp-advance"
            >
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Record Advance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Advance Dialog */}
      <Dialog open={bulkOpen} onOpenChange={(open) => { if (!open) { setBulkOpen(false); setBulkAmounts({}); setBulkSelected(new Set()); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-erp-bulk-advance">
          <DialogHeader>
            <DialogTitle>Bulk Advance</DialogTitle>
            <DialogDescription>Record advances for multiple workers at once</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={bulkForm.advanceDate}
                  onChange={(e) => setBulkForm((p) => ({ ...p, advanceDate: e.target.value }))}
                  data-testid="input-erp-bulk-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input
                  placeholder="Notes for all"
                  value={bulkForm.notes}
                  onChange={(e) => setBulkForm((p) => ({ ...p, notes: e.target.value }))}
                  data-testid="input-erp-bulk-notes"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cash Account</Label>
              <Select
                value={bulkForm.cashAccountId}
                onValueChange={(v) => setBulkForm((p) => ({ ...p, cashAccountId: v }))}
              >
                <SelectTrigger data-testid="select-erp-bulk-cash-account">
                  <SelectValue placeholder="Select cash account" />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.length === 0 ? (
                    <SelectItem value="none" disabled>No cash accounts available</SelectItem>
                  ) : (
                    cashAccounts.map((acc) => (
                      <SelectItem key={acc.id} value={String(acc.id)}>
                        {acc.name} ({acc.code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Workers & Amounts</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkSelected(new Set(workers.map((w) => w.id)))}
                    data-testid="button-erp-bulk-select-all"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkSelected(new Set())}
                    data-testid="button-erp-bulk-deselect-all"
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead className="w-40">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                          No workers found
                        </TableCell>
                      </TableRow>
                    ) : workers.map((w) => {
                      const selected = bulkSelected.has(w.id);
                      return (
                        <TableRow
                          key={w.id}
                          className={`cursor-pointer hover-elevate ${selected ? "bg-primary/5" : ""}`}
                          onClick={() => setBulkSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                            return next;
                          })}
                          data-testid={`row-erp-bulk-worker-${w.id}`}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => setBulkSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                                return next;
                              })}
                              data-testid={`checkbox-erp-bulk-${w.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{`${w.firstName} ${w.lastName}`.trim()}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              className="h-8 text-sm"
                              value={bulkAmounts[w.id] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setBulkAmounts((prev) => ({ ...prev, [w.id]: val }));
                                if (val && parseFloat(val) > 0) {
                                  setBulkSelected((prev) => { const n = new Set(prev); n.add(w.id); return n; });
                                }
                              }}
                              data-testid={`input-erp-bulk-amount-${w.id}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {bulkSelected.size > 0 && (
                <p className="text-xs text-muted-foreground text-right">
                  {Array.from(bulkSelected).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0).length} worker(s) with valid amounts
                  {" — "}
                  Total: {formatAmount(Array.from(bulkSelected).reduce((s, wid) => s + parseFloat(bulkAmounts[wid] || "0"), 0))}
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkMutation.mutate()}
              disabled={
                bulkMutation.isPending ||
                Array.from(bulkSelected).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0).length === 0
              }
              data-testid="button-submit-erp-bulk-advance"
            >
              {bulkMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                : `Record ${Array.from(bulkSelected).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0).length || ""} Advance(s)`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile confirmation */}
      <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconcile Advance Balances</DialogTitle>
            <DialogDescription>
              This will recalculate every worker's advance remaining balance from scratch based on all recorded payroll deductions. Use this if balances look incorrect after running a payroll. No data will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReconcileOpen(false)} data-testid="button-cancel-reconcile-erp">
              Cancel
            </Button>
            <Button
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending}
              data-testid="button-confirm-reconcile-erp"
            >
              {reconcileMutation.isPending ? "Reconciling..." : "Reconcile Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Advance</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the advance of {deleteTarget ? fmt(deleteTarget.amount, formatAmount) : ""} for {deleteTarget ? getWorkerName(deleteTarget.employeeId) : ""}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface WorkerDeductionRow {
  id: number;
  workerId: number;
  workerName: string | null;
  amount: string;
  reason: string | null;
  deductionDate: string;
  applied: boolean;
  payrollId: number | null;
  createdAt: string;
}

function WorkerDeductionsView() {
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const [filterWorker, setFilterWorker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const companyParam = selectedCompany?.id ? `?companyId=${selectedCompany.id}` : "";
  const { data: deductions, isLoading } = useQuery<WorkerDeductionRow[]>({
    queryKey: ["/api/factory/worker-deductions", selectedCompany?.id],
    queryFn: async () => {
      const res = await fetch(`/api/factory/worker-deductions${companyParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load deductions");
      return res.json();
    },
    enabled: !!selectedCompany?.id,
  });

  const workers = useMemo(() => {
    const seen = new Map<number, string>();
    (deductions || []).forEach((d) => {
      if (!seen.has(d.workerId)) seen.set(d.workerId, d.workerName || String(d.workerId));
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [deductions]);

  const filtered = useMemo(() => {
    if (!deductions) return [];
    return deductions.filter((d) => {
      if (filterWorker !== "all" && String(d.workerId) !== filterWorker) return false;
      if (filterStatus === "pending" && d.applied) return false;
      if (filterStatus === "applied" && !d.applied) return false;
      return true;
    });
  }, [deductions, filterWorker, filterStatus]);

  const stats = useMemo(() => {
    const all = deductions || [];
    const pending = all.filter((d) => !d.applied);
    const totalAmount = all.reduce((s, d) => s + parseFloat(d.amount || "0"), 0);
    const pendingAmount = pending.reduce((s, d) => s + parseFloat(d.amount || "0"), 0);
    return { total: all.length, pending: pending.length, totalAmount, pendingAmount };
  }, [deductions]);

  const fmtDate = (val: string | null | undefined) => {
    if (!val) return "—";
    try { return formatDisplayDate(val); } catch { return "—"; }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-64 rounded-md" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900/30">
              <Scissors className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Deductions</p>
              <p className="text-lg font-bold">{formatAmount(stats.totalAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-yellow-100 dark:bg-yellow-900/30">
              <Scissors className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending (not yet applied)</p>
              <p className="text-lg font-bold">{formatAmount(stats.pendingAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-muted">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending Entries</p>
              <p className="text-lg font-bold">{stats.pending} of {stats.total}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-48" data-testid="select-worker-deduction-worker">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40" data-testid="select-worker-deduction-status">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="applied">Applied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Deduction Date</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recorded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No deductions found
                  </TableCell>
                </TableRow>
              ) : filtered.map((d) => (
                <TableRow key={d.id} data-testid={`row-worker-deduction-${d.id}`}>
                  <TableCell className="font-medium">{d.workerName || "—"}</TableCell>
                  <TableCell>{fmtDate(d.deductionDate)}</TableCell>
                  <TableCell className="text-muted-foreground">{d.reason || "—"}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatAmount(parseFloat(d.amount || "0"))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.applied ? "secondary" : "outline"}>
                      {d.applied ? "Applied" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(d.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function RepaymentsView() {
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();

  const [filterWorker, setFilterWorker] = useState("all");

  const { data: deductions, isLoading } = useQuery<DeductionRecord[]>({
    queryKey: ["/api/salary-advance-deductions"],
  });

  const { data: allEmployees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const workers = useMemo(
    () => (allEmployees || []).filter((e) => e.employeeType === "Worker"),
    [allEmployees],
  );

  const filtered = useMemo(() => {
    if (!deductions) return [];
    if (filterWorker === "all") return deductions;
    return deductions.filter((d) => String(d.employeeId) === filterWorker);
  }, [deductions, filterWorker]);

  const stats = useMemo(() => {
    const all = deductions || [];
    const totalDeducted = all.reduce((s, d) => s + parseFloat(d.deductionAmount || "0"), 0);
    return { totalDeducted, count: all.length };
  }, [deductions]);

  const fmtDate = (val: string | null | undefined) => {
    if (!val) return "—";
    try { return formatDisplayDate(val); } catch { return "—"; }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-md" />)}
        </div>
        <Skeleton className="h-64 rounded-md" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30">
              <RotateCcw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Deducted</p>
              <p className="text-lg font-bold" data-testid="text-erp-deductions-total">
                {formatAmount(stats.totalDeducted)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30">
              <RotateCcw className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Entries</p>
              <p className="text-lg font-bold" data-testid="text-erp-deductions-count">
                {stats.count}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-48" data-testid="select-erp-repayment-worker">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {`${w.firstName} ${w.lastName}`.trim()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Payroll Month</TableHead>
                <TableHead className="text-right">Deducted</TableHead>
                <TableHead>Advance Date</TableHead>
                <TableHead className="text-right">Advance Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No deduction records found
                  </TableCell>
                </TableRow>
              ) : filtered.map((d) => (
                <TableRow key={d.id} data-testid={`row-erp-deduction-${d.id}`}>
                  <TableCell className="font-medium">{d.workerName}</TableCell>
                  <TableCell>{d.payrollMonth}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatAmount(parseFloat(d.deductionAmount || "0"))}
                  </TableCell>
                  <TableCell>{fmtDate(d.advanceDate)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatAmount(parseFloat(d.advanceAmount || "0"))}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(d.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
