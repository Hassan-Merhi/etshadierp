import { Fragment, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Plus, Trash2, Banknote, RotateCcw, BookOpen, Loader2, Users } from "lucide-react";
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
import type { FactoryWorker } from "@shared/schema";

interface AdvanceRecord {
  id: number;
  companyId: number;
  workerId: number;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  cashAccountId: number | null;
  notes: string | null;
  fullyPaid: boolean;
  repaymentType: string;
  createdAt: string;
  workerName: string;
}

interface RepaymentRecord {
  id: number;
  advanceId: number;
  workerId: number;
  repaymentDate: string;
  amount: string;
  cashAccountId: number | null;
  notes: string | null;
  createdAt: string;
  advanceDate: string;
  advanceAmount: string;
  advanceRemainingBalance: string;
  workerName: string;
  cashAccountName: string | null;
}

interface CashAccount { id: number; name: string; code: string; }

function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2)}`;
}

export default function FactoryAdvancesTab() {
  const [subTab, setSubTab] = useState("advances");

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showRepayments = settings?.advancesTabRepaymentsEnabled !== false && !hiddenTabs.includes("hide_tab_advances_repayments");

  return (
    <Tabs value={showRepayments ? subTab : "advances"} onValueChange={setSubTab}>
      <TabsList className="mb-4">
        <TabsTrigger value="advances" data-testid="subtab-advances">
          <Banknote className="h-4 w-4 mr-2" />
          Advances
        </TabsTrigger>
        {showRepayments && (
          <TabsTrigger value="repayments" data-testid="subtab-repayments">
            <RotateCcw className="h-4 w-4 mr-2" />
            Repayments
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="advances" className="mt-0">
        <AdvancesView />
      </TabsContent>
      {showRepayments && (
        <TabsContent value="repayments" className="mt-0">
          <RepaymentsView />
        </TabsContent>
      )}
    </Tabs>
  );
}

function AdvancesView() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [postAccountingOpen, setPostAccountingOpen] = useState(false);
  const [postCashAccountId, setPostCashAccountId] = useState("");
  const [filterWorker, setFilterWorker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<AdvanceRecord | null>(null);
  const [reverseTarget, setReverseTarget] = useState<AdvanceRecord | null>(null);

  const [form, setForm] = useState({
    workerId: "",
    advanceDate: new Date().toLocaleDateString('en-CA'),
    amount: "",
    cashAccountId: "",
    notes: "",
    repaymentType: "salary_deduction" as string,
  });

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    advanceDate: new Date().toLocaleDateString('en-CA'),
    cashAccountId: "",
    repaymentType: "salary_deduction" as string,
    notes: "",
  });
  const [bulkAmounts, setBulkAmounts] = useState<Record<number, string>>({});
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());

  const { data: advances, isLoading } = useQuery<AdvanceRecord[]>({
    queryKey: ["/api/factory/advances", filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      const url = `/api/factory/advances${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to load advances"); }
      return res.json();
    },
  });

  const { data: workers } = useQuery<FactoryWorker[]>({
    queryKey: ["/api/factory/workers?active=true"],
  });

  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
  });

  const { data: unvouchered, isLoading: unvoucheredLoading, refetch: refetchUnvouchered } = useQuery<AdvanceRecord[]>({
    queryKey: ["/api/factory/advances/unvouchered"],
    queryFn: async () => {
      const res = await fetch("/api/factory/advances/unvouchered", { credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    enabled: postAccountingOpen,
  });

  const postAccountingMutation = useMutation({
    mutationFn: async (data: { cashAccountId: number }) => {
      const res = await apiRequest("POST", "/api/factory/advances/post-accounting", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed");
      return json;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      toast({ title: "Accounting posted", description: `${data.posted} advance(s) posted successfully` });
      setPostAccountingOpen(false);
      setPostCashAccountId("");
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const reconcileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/advances/reconcile", {});
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Reconciliation failed");
      return json;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      toast({ title: "Reconciliation complete", description: data.message });
      setReconcileOpen(false);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/factory/workers/${form.workerId}/advances`, {
        advanceDate: form.advanceDate,
        amount: form.amount,
        cashAccountId: form.cashAccountId ? parseInt(form.cashAccountId) : undefined,
        notes: form.notes || undefined,
        repaymentType: form.repaymentType,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create advance");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      toast({ title: "Advance recorded" });
      setAddOpen(false);
      setForm({ workerId: "", advanceDate: new Date().toLocaleDateString('en-CA'), amount: "", cashAccountId: "", notes: "", repaymentType: "salary_deduction" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/advances/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      toast({ title: "Advance deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/factory/advances/${id}/reverse`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to reverse advance");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      toast({ title: "Advance reversed", description: "Advance restored to outstanding — repayments removed." });
      setReverseTarget(null);
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const items = Array.from(bulkSelected)
        .map((wid) => ({ workerId: wid, amount: bulkAmounts[wid] || "" }))
        .filter((i) => parseFloat(i.amount) > 0);
      const res = await apiRequest("POST", "/api/factory/advances/bulk", {
        items,
        advanceDate: bulkForm.advanceDate,
        cashAccountId: bulkForm.cashAccountId ? parseInt(bulkForm.cashAccountId) : undefined,
        repaymentType: bulkForm.repaymentType,
        notes: bulkForm.notes || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create bulk advances");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/unvouchered"] });
      toast({ title: "Bulk advances recorded", description: `${data.created} advance(s) created` });
      setBulkOpen(false);
      setBulkAmounts({});
      setBulkSelected(new Set());
      setBulkForm({ advanceDate: new Date().toLocaleDateString('en-CA'), cashAccountId: "", repaymentType: "salary_deduction", notes: "" });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    let list = Array.isArray(advances) ? advances : [];
    if (filterWorker !== "all") list = list.filter((a) => a.workerId === parseInt(filterWorker));
    return list;
  }, [advances, filterWorker]);

  const stats = useMemo(() => {
    const all = Array.isArray(advances) ? advances : [];
    const totalGiven = all.reduce((s, a) => s + parseFloat(a.amount || "0"), 0);
    const totalOutstanding = all.filter((a) => !a.fullyPaid).reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
    const outstandingCount = all.filter((a) => !a.fullyPaid).length;
    return { totalGiven, totalOutstanding, outstandingCount, total: all.length };
  }, [advances]);

  const formatDate = (val: string | null | undefined) => {
    if (!val) return "\u2014";
    try { return formatDisplayDate(val); } catch { return "\u2014"; }
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
            <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30">
              <Banknote className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Given</p>
              <p className="text-lg font-bold" data-testid="text-advances-total-given">{fmt(stats.totalGiven)}</p>
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
              <p className="text-lg font-bold" data-testid="text-advances-outstanding">{fmt(stats.totalOutstanding)}</p>
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
              <p className="text-lg font-bold" data-testid="text-advances-active-count">{stats.outstandingCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-48" data-testid="select-filter-worker">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {(workers || []).map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>{w.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40" data-testid="select-filter-status">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="outstanding">Outstanding</SelectItem>
            <SelectItem value="paid">Fully Paid</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setReconcileOpen(true)} data-testid="button-reconcile-advances">
            <RotateCcw className="h-4 w-4 mr-2" />Reconcile Balances
          </Button>
          <Button variant="outline" onClick={() => setPostAccountingOpen(true)} data-testid="button-post-accounting">
            <BookOpen className="h-4 w-4 mr-2" />Post Accounting
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="button-bulk-advance">
            <Users className="h-4 w-4 mr-2" />Bulk Advance
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-advance">
            <Plus className="h-4 w-4 mr-2" />Add Advance
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
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
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No advances found
                  </TableCell>
                </TableRow>
              ) : filtered.map((adv) => (
                <TableRow key={adv.id} data-testid={`row-advance-${adv.id}`}>
                  <TableCell className="font-medium" data-testid={`text-advance-worker-${adv.id}`}>
                    {adv.workerName}
                  </TableCell>
                  <TableCell data-testid={`text-advance-date-${adv.id}`}>
                    {formatDate(adv.advanceDate)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-advance-amount-${adv.id}`}>
                    {fmt(adv.amount)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-advance-remaining-${adv.id}`}>
                    {fmt(adv.remainingBalance)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={adv.repaymentType === "manual_repayment"
                        ? "border-blue-400 text-blue-700 dark:text-blue-400"
                        : "border-slate-400 text-slate-700 dark:text-slate-400"
                      }
                      data-testid={`badge-advance-type-${adv.id}`}
                    >
                      {adv.repaymentType === "manual_repayment" ? "Loan" : "Salary Ded."}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={adv.fullyPaid
                        ? "border-green-500 text-green-700 dark:text-green-400"
                        : "border-amber-400 text-amber-700 dark:text-amber-400"
                      }
                      data-testid={`badge-advance-status-${adv.id}`}
                    >
                      {adv.fullyPaid ? "Paid" : "Outstanding"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {adv.notes || "\u2014"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {adv.fullyPaid ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setReverseTarget(adv)}
                          title="Reverse this advance"
                          data-testid={`button-reverse-advance-${adv.id}`}
                        >
                          <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(adv)}
                          data-testid={`button-delete-advance-${adv.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={bulkOpen} onOpenChange={(open) => { if (!open) { setBulkOpen(false); setBulkAmounts({}); setBulkSelected(new Set()); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Advance</DialogTitle>
            <DialogDescription>Record advances for multiple workers at once</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Shared fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={bulkForm.advanceDate}
                  onChange={(e) => setBulkForm((p) => ({ ...p, advanceDate: e.target.value }))}
                  data-testid="input-bulk-advance-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Cash Account</Label>
                <Select value={bulkForm.cashAccountId} onValueChange={(v) => setBulkForm((p) => ({ ...p, cashAccountId: v }))}>
                  <SelectTrigger data-testid="select-bulk-cash-account">
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    {(cashAccounts || []).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Repayment Type</Label>
                <Select value={bulkForm.repaymentType} onValueChange={(v) => setBulkForm((p) => ({ ...p, repaymentType: v }))}>
                  <SelectTrigger data-testid="select-bulk-repayment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="salary_deduction">Deduct from Salary</SelectItem>
                    <SelectItem value="manual_repayment">Manual Repayment (Loan)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  placeholder="Optional notes for all"
                  value={bulkForm.notes}
                  onChange={(e) => setBulkForm((p) => ({ ...p, notes: e.target.value }))}
                  data-testid="input-bulk-notes"
                />
              </div>
            </div>

            {/* Worker table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Workers & Amounts</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkSelected(new Set((workers || []).map((w) => w.id)))}
                    data-testid="button-bulk-select-all"
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBulkSelected(new Set())}
                    data-testid="button-bulk-deselect-all"
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead className="w-40">Amount ($)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(workers || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                          No workers found
                        </TableCell>
                      </TableRow>
                    ) : (workers || []).map((w) => {
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
                          data-testid={`row-bulk-worker-${w.id}`}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => setBulkSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(w.id)) next.delete(w.id); else next.add(w.id);
                                return next;
                              })}
                              data-testid={`checkbox-bulk-worker-${w.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{w.fullName}</TableCell>
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
                              data-testid={`input-bulk-amount-${w.id}`}
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
                  {" — "}Total: {fmt(Array.from(bulkSelected).reduce((s, wid) => s + parseFloat(bulkAmounts[wid] || "0"), 0))}
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)} data-testid="button-cancel-bulk-advance">Cancel</Button>
            <Button
              onClick={() => bulkMutation.mutate()}
              disabled={
                bulkMutation.isPending ||
                Array.from(bulkSelected).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0).length === 0
              }
              data-testid="button-submit-bulk-advance"
            >
              {bulkMutation.isPending ? "Saving..." : `Record ${Array.from(bulkSelected).filter((wid) => parseFloat(bulkAmounts[wid] || "0") > 0).length || ""} Advance(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Advance</DialogTitle>
            <DialogDescription>Give a cash advance to a factory worker</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Worker</Label>
              <Select value={form.workerId} onValueChange={(v) => setForm({ ...form, workerId: v })}>
                <SelectTrigger data-testid="select-advance-worker">
                  <SelectValue placeholder="Select worker" />
                </SelectTrigger>
                <SelectContent>
                  {(workers || []).map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.fullName}</SelectItem>
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
                  onChange={(e) => setForm({ ...form, advanceDate: e.target.value })}
                  data-testid="input-advance-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  data-testid="input-advance-amount"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cash Account</Label>
              <Select value={form.cashAccountId} onValueChange={(v) => setForm({ ...form, cashAccountId: v })}>
                <SelectTrigger data-testid="select-advance-cash-account">
                  <SelectValue placeholder="Select cash account (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {(cashAccounts || []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Repayment Type</Label>
              <Select value={form.repaymentType} onValueChange={(v) => setForm({ ...form, repaymentType: v })}>
                <SelectTrigger data-testid="select-advance-repayment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="salary_deduction">Deduct from Salary</SelectItem>
                  <SelectItem value="manual_repayment">Manual Repayment (Loan)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="resize-none"
                data-testid="input-advance-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} data-testid="button-cancel-advance">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.workerId || !form.amount || parseFloat(form.amount) <= 0 || createMutation.isPending}
              data-testid="button-submit-advance"
            >
              {createMutation.isPending ? "Saving..." : "Record Advance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Advance</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this advance of {fmt(deleteTarget?.amount)} for {deleteTarget?.workerName}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse Advance Dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={(open) => !open && setReverseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Advance</DialogTitle>
            <DialogDescription>
              This will reverse the advance of <strong>{fmt(reverseTarget?.amount)}</strong> for <strong>{reverseTarget?.workerName}</strong>.
              All repayments linked to this advance will be removed and the balance will be restored to outstanding.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
            Use this only if the advance was recorded by mistake or the repayments need to be undone. The advance record itself will remain but be marked outstanding again.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)} data-testid="button-cancel-reverse">Cancel</Button>
            <Button
              variant="default"
              className="bg-amber-600 text-white"
              onClick={() => reverseTarget && reverseMutation.mutate(reverseTarget.id)}
              disabled={reverseMutation.isPending}
              data-testid="button-confirm-reverse"
            >
              {reverseMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reversing...</> : <><RotateCcw className="h-4 w-4 mr-2" />Reverse Advance</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={postAccountingOpen} onOpenChange={(open) => { setPostAccountingOpen(open); if (!open) setPostCashAccountId(""); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Post Accounting for Old Advances</DialogTitle>
            <DialogDescription>
              Create payment vouchers for advances that were recorded without a cash account deduction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cash Account to Credit</Label>
              <Select value={postCashAccountId} onValueChange={setPostCashAccountId}>
                <SelectTrigger data-testid="select-post-cash-account">
                  <SelectValue placeholder="Select cash account" />
                </SelectTrigger>
                <SelectContent>
                  {(cashAccounts || []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Unvouchered Advances</Label>
              {unvoucheredLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : !unvouchered?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No unvouchered advances found</p>
                  <p className="text-xs mt-1">All advances already have accounting entries</p>
                </div>
              ) : (
                <div className="border rounded-md mt-2 max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const grouped: Record<string, typeof unvouchered> = {};
                        for (const adv of unvouchered) {
                          const key = adv.workerName || `Worker #${adv.workerId}`;
                          if (!grouped[key]) grouped[key] = [];
                          grouped[key].push(adv);
                        }
                        return Object.entries(grouped).map(([workerName, advs]) => (
                          <Fragment key={workerName}>
                            <TableRow>
                              <TableCell colSpan={3} className="bg-muted/50 font-medium text-sm py-1.5">
                                {workerName}
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({advs.length} advance{advs.length !== 1 ? "s" : ""} — {fmt(advs.reduce((s, a) => s + parseFloat(a.amount || "0"), 0))})
                                </span>
                              </TableCell>
                            </TableRow>
                            {advs.map((adv) => (
                              <TableRow key={adv.id} data-testid={`row-unvouchered-${adv.id}`}>
                                <TableCell className="text-sm pl-6">{formatDate(adv.advanceDate)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">{fmt(adv.amount)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {adv.repaymentType === "manual_repayment" ? "Loan" : "Salary Ded."}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ));
                      })()}
                    </TableBody>
                  </Table>
                </div>
              )}
              {unvouchered && unvouchered.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Total: {fmt(unvouchered.reduce((s, a) => s + parseFloat(a.amount || "0"), 0))} across {unvouchered.length} advance(s)
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPostAccountingOpen(false); setPostCashAccountId(""); }} data-testid="button-cancel-post-accounting">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!postCashAccountId || !unvouchered?.length) return;
                postAccountingMutation.mutate({
                  cashAccountId: parseInt(postCashAccountId),
                });
              }}
              disabled={!postCashAccountId || !unvouchered?.length || postAccountingMutation.isPending}
              data-testid="button-confirm-post-accounting"
            >
              {postAccountingMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Posting...</>
              ) : (
                <>Post {unvouchered?.length || 0} Entries</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile confirmation dialog */}
      <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reconcile Advance Balances</DialogTitle>
            <DialogDescription>
              This will recalculate every worker's outstanding advance balances from scratch — replaying all historical payroll deductions and manual repayments in order. Use this to correct balances from payrolls that ran before automatic reconciliation was in place.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReconcileOpen(false)} data-testid="button-cancel-reconcile">
              Cancel
            </Button>
            <Button
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending}
              data-testid="button-confirm-reconcile"
            >
              {reconcileMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reconciling...</>
              ) : (
                <>Reconcile Now</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RepaymentsView() {
  const { formatDisplayDate } = useDateFormat();
  const [filterWorker, setFilterWorker] = useState("all");

  const { data: workers } = useQuery<FactoryWorker[]>({
    queryKey: ["/api/factory/workers"],
    queryFn: async () => {
      const res = await fetch("/api/factory/workers?active=true", { credentials: "include" });
      return res.json();
    },
  });

  const { data: repayments, isLoading } = useQuery<RepaymentRecord[]>({
    queryKey: ["/api/factory/advance-repayments", filterWorker],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterWorker !== "all") params.set("workerId", filterWorker);
      const url = `/api/factory/advance-repayments${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to load repayments"); }
      return res.json();
    },
  });

  const stats = useMemo(() => {
    const all = Array.isArray(repayments) ? repayments : [];
    const totalRepaid = all.reduce((s, r) => s + parseFloat(r.amount || "0"), 0);
    return { totalRepaid, count: all.length };
  }, [repayments]);

  const formatDate = (val: string | null | undefined) => {
    if (!val) return "\u2014";
    try { return formatDisplayDate(val); } catch { return "\u2014"; }
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

  const list = Array.isArray(repayments) ? repayments : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-100 dark:bg-green-900/30">
              <RotateCcw className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Repaid</p>
              <p className="text-lg font-bold" data-testid="text-repayments-total">{fmt(stats.totalRepaid)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900/30">
              <Banknote className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Repayments</p>
              <p className="text-lg font-bold" data-testid="text-repayments-count">{stats.count}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-48" data-testid="select-repayments-filter-worker">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {(workers || []).map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>{w.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="sticky top-0 z-30 bg-background">
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Loan Date</TableHead>
                <TableHead>Repayment Date</TableHead>
                <TableHead className="text-right">Amount Paid</TableHead>
                <TableHead>Cash Account</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No repayments found
                  </TableCell>
                </TableRow>
              ) : list.map((r) => (
                <TableRow key={r.id} data-testid={`row-repayment-${r.id}`}>
                  <TableCell className="font-medium" data-testid={`text-repayment-worker-${r.id}`}>
                    {r.workerName}
                  </TableCell>
                  <TableCell data-testid={`text-repayment-loan-date-${r.id}`}>
                    {formatDate(r.advanceDate)}
                  </TableCell>
                  <TableCell data-testid={`text-repayment-date-${r.id}`}>
                    {formatDate(r.repaymentDate)}
                  </TableCell>
                  <TableCell className="text-right font-mono" data-testid={`text-repayment-amount-${r.id}`}>
                    {fmt(r.amount)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground" data-testid={`text-repayment-account-${r.id}`}>
                    {r.cashAccountName || "\u2014"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                    {r.notes || "\u2014"}
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
