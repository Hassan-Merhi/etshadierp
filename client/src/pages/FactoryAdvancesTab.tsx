import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Plus, Trash2, Banknote, RotateCcw, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <Tabs value={subTab} onValueChange={setSubTab}>
      <TabsList className="mb-4">
        <TabsTrigger value="advances" data-testid="subtab-advances">
          <Banknote className="h-4 w-4 mr-2" />
          Advances
        </TabsTrigger>
        <TabsTrigger value="repayments" data-testid="subtab-repayments">
          <RotateCcw className="h-4 w-4 mr-2" />
          Repayments
        </TabsTrigger>
      </TabsList>

      <TabsContent value="advances" className="mt-0">
        <AdvancesView />
      </TabsContent>
      <TabsContent value="repayments" className="mt-0">
        <RepaymentsView />
      </TabsContent>
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

  const [form, setForm] = useState({
    workerId: "",
    advanceDate: new Date().toISOString().split("T")[0],
    amount: "",
    cashAccountId: "",
    notes: "",
    repaymentType: "salary_deduction" as string,
  });

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
    queryKey: ["/api/factory/workers"],
    queryFn: async () => {
      const res = await fetch("/api/factory/workers?active=true", { credentials: "include" });
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
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
      toast({ title: "Advance recorded" });
      setAddOpen(false);
      setForm({ workerId: "", advanceDate: new Date().toISOString().split("T")[0], amount: "", cashAccountId: "", notes: "", repaymentType: "salary_deduction" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/advances/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      toast({ title: "Advance deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
          <Button variant="outline" onClick={() => { setPostAccountingOpen(true); refetchUnvouchered(); }} data-testid="button-post-accounting">
            <BookOpen className="h-4 w-4 mr-2" />Post Accounting
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-advance">
            <Plus className="h-4 w-4 mr-2" />Add Advance
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
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
                    {!adv.fullyPaid && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(adv)}
                        data-testid={`button-delete-advance-${adv.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
                    <TableHeader>
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
                          <>
                            <TableRow key={`header-${workerName}`}>
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
                          </>
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
            <TableHeader>
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
