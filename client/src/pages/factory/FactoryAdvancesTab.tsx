import { Fragment, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { Plus, Trash2, Banknote, RotateCcw, BookOpen, Loader2, Users, CalendarDays, ChevronDown, ChevronRight, SlidersHorizontal, SearchCheck, CheckCircle2, AlertCircle } from "lucide-react";
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

  const [repayByMonthOpen, setRepayByMonthOpen] = useState(false);
  const [repayByMonthForm, setRepayByMonthForm] = useState({
    repaymentDate: "",
    cashAccountId: "",
  });
  const [repayByMonthExpanded, setRepayByMonthExpanded] = useState<Set<string>>(new Set());
  const [repayingMonth, setRepayingMonth] = useState<string | null>(null);
  const [confirmRepay, setConfirmRepay] = useState<{ monthKey: string; monthLabel: string; items: AdvanceRecord[]; total: number } | null>(null);

  const repayByMonthMutation = useMutation({
    mutationFn: async (month: string) => {
      const res = await apiRequest("POST", "/api/factory/advances/repay-by-month", {
        month,
        repaymentDate: repayByMonthForm.repaymentDate,
        cashAccountId: parseInt(repayByMonthForm.cashAccountId),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to repay");
      return { ...data, month };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advance-repayments"] });
      toast({
        title: "Repayments recorded",
        description: `${data.repaid} advance(s) repaid — total $${parseFloat(data.total).toFixed(2)}`,
      });
      setRepayingMonth(null);
    },
    onError: (err: Error) => {
      setRepayingMonth(null);
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [cashAdjOpen, setCashAdjOpen] = useState(false);
  const [cashAdjForm, setCashAdjForm] = useState({
    cashAccountId: "", amount: "", direction: "credit", date: "", narration: "Cash balance adjustment",
  });
  const cashAdjMutation = useMutation({
    mutationFn: async (data: typeof cashAdjForm) => {
      const res = await apiRequest("POST", "/api/factory/advances/cash-adjustment", {
        cashAccountId: parseInt(data.cashAccountId),
        amount: data.amount,
        direction: data.direction,
        date: data.date,
        narration: data.narration,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Adjustment posted", description: "Cash account balance corrected." });
      setCashAdjOpen(false);
      setCashAdjForm({ cashAccountId: "", amount: "", direction: "credit", date: "", narration: "Cash balance adjustment" });
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [repayAuditOpen, setRepayAuditOpen] = useState(false);
  const [repayAuditForm, setRepayAuditForm] = useState({ cashAccountId: "", repaymentDate: "" });

  interface AuditAdvance {
    id: number; workerId: number; workerName: string;
    advanceDate: string; amount: string; remainingBalance: string; fullyPaid: boolean;
    caseType: "missing_voucher" | "no_repayment";
    repayments: { id: number; repaymentDate: string; amount: string; cashAccountId: number | null }[];
    missingVoucherRepayments: { id: number; repaymentDate: string; amount: string; cashAccountId: number | null }[];
  }
  interface AuditResult {
    advances: AuditAdvance[];
    summary: { total: number; ok: number; missingVoucher: number; noRepayment: number };
  }

  const { data: auditData, isLoading: auditLoading, refetch: refetchAudit } = useQuery<AuditResult>({
    queryKey: ["/api/factory/advances/repayment-audit"],
    queryFn: async () => {
      const res = await fetch("/api/factory/advances/repayment-audit", { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Failed"); }
      return res.json();
    },
    enabled: repayAuditOpen,
  });

  const { data: auditCashBalance } = useQuery<{ balance: string; name: string }>({
    queryKey: ["/api/factory/cash-account-balance", repayAuditForm.cashAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/cash-account-balance/${repayAuditForm.cashAccountId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch balance");
      return res.json();
    },
    enabled: !!repayAuditForm.cashAccountId && repayAuditOpen,
  });

  const repayAuditMutation = useMutation({
    mutationFn: async (form: typeof repayAuditForm) => {
      const res = await apiRequest("POST", "/api/factory/advances/post-repayment-vouchers", {
        cashAccountId: parseInt(form.cashAccountId),
        repaymentDate: form.repaymentDate,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed");
      return json;
    },
    onSuccess: (data) => {
      toast({ title: "Repayment entries posted", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/repayment-audit"] });
      setRepayAuditOpen(false);
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [reconcileOpen, setReconcileOpen] = useState(false);

  interface ReconcileChange {
    advanceId: number; workerName: string; advanceDate: string;
    originalAmount: string; currentBalance: string; newBalance: string;
    currentFullyPaid: boolean; newFullyPaid: boolean; changed: boolean;
  }

  const { data: reconcilePreview, isLoading: reconcilePreviewLoading } = useQuery<{ changes: ReconcileChange[]; totalAdvances: number }>({
    queryKey: ["/api/factory/advances/reconcile/preview"],
    queryFn: async () => {
      const res = await fetch("/api/factory/advances/reconcile/preview", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Preview failed");
      return json;
    },
    enabled: reconcileOpen,
    staleTime: 0,
  });

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
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances/reconcile/preview"] });
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
          <Button variant="outline" onClick={() => setRepayAuditOpen(true)} data-testid="button-repayment-audit">
            <SearchCheck className="h-4 w-4 mr-2" />Repayment Audit
          </Button>
          <Button variant="outline" onClick={() => setCashAdjOpen(true)} data-testid="button-cash-adjustment">
            <SlidersHorizontal className="h-4 w-4 mr-2" />Cash Adjustment
          </Button>
          <Button variant="outline" onClick={() => setReconcileOpen(true)} data-testid="button-reconcile-advances">
            <RotateCcw className="h-4 w-4 mr-2" />Reconcile Balances
          </Button>
          <Button variant="outline" onClick={() => setPostAccountingOpen(true)} data-testid="button-post-accounting">
            <BookOpen className="h-4 w-4 mr-2" />Post Accounting
          </Button>
          <Button variant="outline" onClick={() => setRepayByMonthOpen(true)} data-testid="button-repay-by-month">
            <CalendarDays className="h-4 w-4 mr-2" />Repay by Month
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

      {/* ── Repayment Audit Dialog ── */}
      <Dialog open={repayAuditOpen} onOpenChange={(open) => { setRepayAuditOpen(open); if (!open) setRepayAuditForm({ cashAccountId: "", repaymentDate: "" }); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Repayment Audit — Salary Deduction Advances</DialogTitle>
            <DialogDescription>
              Scans every Salary Deduction advance and finds ones where the cash account is missing an entry — either the voucher was deleted (Case A) or the advance was marked paid without any repayment record (Case B).
            </DialogDescription>
          </DialogHeader>

          {auditLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />Scanning advances…
            </div>
          ) : !auditData ? null : (() => {
            const { summary, advances: auditAdvances } = auditData;
            const missingTotal = auditAdvances.reduce((s, a) => {
              if (a.caseType === "missing_voucher") {
                return s + a.missingVoucherRepayments.reduce((ss, r) => ss + parseFloat(r.amount || "0"), 0);
              }
              return s + parseFloat(a.amount || "0");
            }, 0);

            const grouped: Record<string, AuditAdvance[]> = {};
            for (const a of auditAdvances) {
              const k = a.workerName || `Worker #${a.workerId}`;
              if (!grouped[k]) grouped[k] = [];
              grouped[k].push(a);
            }

            return (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Advances</p>
                    <p className="font-bold">{summary.total}</p>
                  </div>
                  <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Already OK</p>
                    <p className="font-bold text-green-700 dark:text-green-400">{summary.ok}</p>
                  </div>
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Missing Voucher</p>
                    <p className="font-bold text-amber-700 dark:text-amber-400">{summary.missingVoucher}</p>
                  </div>
                  <div className="rounded-md bg-red-50 dark:bg-red-900/20 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">No Record</p>
                    <p className="font-bold text-red-700 dark:text-red-400">{summary.noRepayment}</p>
                  </div>
                </div>

                {auditAdvances.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                    <p className="text-sm font-medium">All repayments are fully accounted for</p>
                    <p className="text-xs">Every paid advance has matching voucher entries on the cash account.</p>
                  </div>
                ) : (
                  <>
                    {/* Controls */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Default Cash Account <span className="text-destructive">*</span></Label>
                        <Select value={repayAuditForm.cashAccountId} onValueChange={(v) => setRepayAuditForm((p) => ({ ...p, cashAccountId: v }))}>
                          <SelectTrigger data-testid="select-audit-cash-account">
                            <SelectValue placeholder="Select cash account" />
                          </SelectTrigger>
                          <SelectContent>
                            {(cashAccounts || []).map((a) => (
                              <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Default Repayment Date <span className="text-destructive">*</span></Label>
                        <Input type="date" value={repayAuditForm.repaymentDate} onChange={(e) => setRepayAuditForm((p) => ({ ...p, repaymentDate: e.target.value }))} data-testid="input-audit-date" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-2">Used for entries that have no existing date/account on record (No Record cases). Case A entries use their original repayment data.</p>

                    {/* Posting impact panel */}
                    {repayAuditForm.cashAccountId && (
                      <div className="rounded-md border overflow-hidden text-sm">
                        <div className="px-4 py-2 bg-muted/20 text-xs font-medium text-muted-foreground border-b">
                          Posting Impact — Journal: DR Factory Workers Salary Payable / CR Factory Worker Advances
                        </div>
                        <div className="grid grid-cols-3 divide-x">
                          <div className="px-4 py-3 text-center">
                            <p className="text-xs text-muted-foreground mb-1">Cash Account Balance</p>
                            <p className="font-mono font-bold">
                              {auditCashBalance ? fmt(parseFloat(auditCashBalance.balance)) : "…"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">No change</p>
                          </div>
                          <div className="px-4 py-3 text-center">
                            <p className="text-xs text-muted-foreground mb-1">Factory Worker Advances</p>
                            <p className="font-mono font-bold text-green-700 dark:text-green-400">−{fmt(missingTotal)}</p>
                            <p className="text-xs text-muted-foreground mt-1">Decreases (CR)</p>
                          </div>
                          <div className="px-4 py-3 text-center">
                            <p className="text-xs text-muted-foreground mb-1">Workers Salary Payable</p>
                            <p className="font-mono font-bold text-amber-700 dark:text-amber-400">−{fmt(missingTotal)}</p>
                            <p className="text-xs text-muted-foreground mt-1">Decreases (DR)</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Per-worker breakdown */}
                    <div className="border rounded-md overflow-hidden">
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/20">
                        <span>Worker / Advance Date</span>
                        <span className="text-right">Amount</span>
                        <span className="text-right">Missing</span>
                        <span>Case</span>
                        <span>Status</span>
                      </div>
                      <div className="divide-y max-h-64 overflow-y-auto">
                        {Object.entries(grouped).map(([workerName, wAdvances]) => (
                          <Fragment key={workerName}>
                            <div className="px-4 py-1.5 bg-muted/30 text-xs font-semibold text-muted-foreground">
                              {workerName}
                            </div>
                            {wAdvances.map((a) => {
                              const missingAmt = a.caseType === "missing_voucher"
                                ? a.missingVoucherRepayments.reduce((s, r) => s + parseFloat(r.amount || "0"), 0)
                                : parseFloat(a.amount || "0");
                              return (
                                <div key={a.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-4 py-2 text-sm items-center" data-testid={`row-audit-${a.id}`}>
                                  <span className="text-xs text-muted-foreground pl-2">{formatDate(a.advanceDate)}</span>
                                  <span className="font-mono text-right text-xs">{fmt(a.amount)}</span>
                                  <span className="font-mono text-right font-medium">{fmt(missingAmt)}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {a.caseType === "missing_voucher" ? "Case A" : "Case B"}
                                  </Badge>
                                  <AlertCircle className="h-4 w-4 text-amber-500" />
                                </div>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-4 py-2 text-sm font-bold bg-muted/20 border-t">
                        <span>Total Missing</span>
                        <span></span>
                        <span className="font-mono text-right">{fmt(missingTotal)}</span>
                        <span></span><span></span>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p><span className="font-medium">Case A</span> — repayment record exists but voucher was deleted. Will re-create the DR Cash / CR Advances voucher.</p>
                      <p><span className="font-medium">Case B</span> — advance marked paid with no repayment record. Will create both the repayment record and the voucher.</p>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => refetchAudit()} disabled={auditLoading} data-testid="button-audit-refresh">
              {auditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
            </Button>
            <Button variant="outline" onClick={() => setRepayAuditOpen(false)} data-testid="button-audit-cancel">Cancel</Button>
            <Button
              onClick={() => repayAuditMutation.mutate(repayAuditForm)}
              disabled={
                !auditData || auditData.advances.length === 0 ||
                !repayAuditForm.cashAccountId || !repayAuditForm.repaymentDate ||
                repayAuditMutation.isPending
              }
              data-testid="button-audit-confirm"
            >
              {repayAuditMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Posting…</>
                : `Post Missing Entries — ${fmt(auditData?.advances.reduce((s, a) => s + (a.caseType === "missing_voucher" ? a.missingVoucherRepayments.reduce((ss, r) => ss + parseFloat(r.amount || "0"), 0) : parseFloat(a.amount || "0")), 0) ?? 0)}`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cash Account Adjustment Dialog ── */}
      <Dialog open={cashAdjOpen} onOpenChange={(open) => { setCashAdjOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cash Account Balance Adjustment</DialogTitle>
            <DialogDescription>
              Posts a correcting journal entry against the cash account without modifying any existing records.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cash Account <span className="text-destructive">*</span></Label>
              <Select value={cashAdjForm.cashAccountId} onValueChange={(v) => setCashAdjForm((p) => ({ ...p, cashAccountId: v }))}>
                <SelectTrigger data-testid="select-cadj-account">
                  <SelectValue placeholder="Select cash account" />
                </SelectTrigger>
                <SelectContent>
                  {(cashAccounts || []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Adjustment Amount <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={cashAdjForm.amount}
                  onChange={(e) => setCashAdjForm((p) => ({ ...p, amount: e.target.value }))}
                  data-testid="input-cadj-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select value={cashAdjForm.direction} onValueChange={(v) => setCashAdjForm((p) => ({ ...p, direction: v }))}>
                  <SelectTrigger data-testid="select-cadj-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">Credit — reduce balance ↓</SelectItem>
                    <SelectItem value="debit">Debit — increase balance ↑</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Date <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={cashAdjForm.date}
                onChange={(e) => setCashAdjForm((p) => ({ ...p, date: e.target.value }))}
                data-testid="input-cadj-date"
              />
            </div>

            <div className="space-y-2">
              <Label>Narration</Label>
              <Input
                value={cashAdjForm.narration}
                onChange={(e) => setCashAdjForm((p) => ({ ...p, narration: e.target.value }))}
                data-testid="input-cadj-narration"
              />
            </div>

            {/* Journal preview */}
            {cashAdjForm.cashAccountId && cashAdjForm.amount && parseFloat(cashAdjForm.amount) > 0 && (() => {
              const acct = (cashAccounts || []).find((a) => String(a.id) === cashAdjForm.cashAccountId);
              const isCredit = cashAdjForm.direction === "credit";
              return (
                <div className="rounded-md border overflow-hidden text-sm">
                  <div className="grid grid-cols-3 px-3 py-1.5 bg-muted/20 text-xs font-medium text-muted-foreground">
                    <span>Account</span><span className="text-right text-blue-600 dark:text-blue-400">DR</span><span className="text-right text-amber-600 dark:text-amber-400">CR</span>
                  </div>
                  <div className="grid grid-cols-3 px-3 py-2 border-t">
                    <span className="text-muted-foreground">Advance Adjustments</span>
                    <span className="text-right font-mono text-blue-700 dark:text-blue-400">{isCredit ? fmt(cashAdjForm.amount) : "—"}</span>
                    <span className="text-right font-mono text-amber-700 dark:text-amber-400">{isCredit ? "—" : fmt(cashAdjForm.amount)}</span>
                  </div>
                  <div className="grid grid-cols-3 px-3 py-2 border-t">
                    <span className="text-muted-foreground">{acct?.name ?? "Cash Account"}</span>
                    <span className="text-right font-mono text-blue-700 dark:text-blue-400">{isCredit ? "—" : fmt(cashAdjForm.amount)}</span>
                    <span className="text-right font-mono text-amber-700 dark:text-amber-400">{isCredit ? fmt(cashAdjForm.amount) : "—"}</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCashAdjOpen(false)} data-testid="button-cadj-cancel">Cancel</Button>
            <Button
              onClick={() => cashAdjMutation.mutate(cashAdjForm)}
              disabled={!cashAdjForm.cashAccountId || !cashAdjForm.amount || !cashAdjForm.date || parseFloat(cashAdjForm.amount) <= 0 || cashAdjMutation.isPending}
              data-testid="button-cadj-confirm"
            >
              {cashAdjMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Posting…</>
                : `Post ${cashAdjForm.direction === "credit" ? "Credit" : "Debit"} — ${fmt(cashAdjForm.amount)}`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Repay by Month Dialog ── */}
      <Dialog
        open={repayByMonthOpen}
        onOpenChange={(open) => {
          if (!open) { setRepayByMonthExpanded(new Set()); setRepayingMonth(null); }
          setRepayByMonthOpen(open);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Repay by Month</DialogTitle>
            <DialogDescription>
              Bulk-repay all outstanding advances (Loans and Salary Deductions) grouped by the month they were given.
            </DialogDescription>
          </DialogHeader>

          {/* Shared repayment fields */}
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label>Repayment Date</Label>
              <Input
                type="date"
                value={repayByMonthForm.repaymentDate}
                onChange={(e) => setRepayByMonthForm((p) => ({ ...p, repaymentDate: e.target.value }))}
                data-testid="input-rbm-repayment-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Cash Account <span className="text-destructive">*</span></Label>
              <Select
                value={repayByMonthForm.cashAccountId}
                onValueChange={(v) => setRepayByMonthForm((p) => ({ ...p, cashAccountId: v }))}
              >
                <SelectTrigger data-testid="select-rbm-cash-account">
                  <SelectValue placeholder="Select cash account" />
                </SelectTrigger>
                <SelectContent>
                  {(cashAccounts || []).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Month groups derived from advances data */}
          {(() => {
            const allOutstanding = (advances || []).filter((a) => !a.fullyPaid);

            if (allOutstanding.length === 0) {
              return (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No outstanding advances to repay.
                </div>
              );
            }

            // Group by YYYY-MM
            const groups = new Map<string, AdvanceRecord[]>();
            for (const a of allOutstanding) {
              const key = (a.advanceDate || "").substring(0, 7);
              if (!key) continue;
              const list = groups.get(key) || [];
              list.push(a);
              groups.set(key, list);
            }

            const sortedKeys = [...groups.keys()].sort().reverse();

            return (
              <div className="space-y-3">
                {sortedKeys.map((monthKey) => {
                  const items = groups.get(monthKey)!;
                  const total = items.reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
                  const [year, mon] = monthKey.split("-");
                  const monthLabel = new Date(parseInt(year), parseInt(mon) - 1, 1)
                    .toLocaleString("default", { month: "long", year: "numeric" });
                  const isExpanded = repayByMonthExpanded.has(monthKey);
                  const isPending = repayingMonth === monthKey && repayByMonthMutation.isPending;

                  return (
                    <div key={monthKey} className="border rounded-md overflow-hidden">
                      {/* Month header row */}
                      <div
                        className="flex items-center justify-between px-4 py-3 bg-muted/40 cursor-pointer hover-elevate"
                        onClick={() => setRepayByMonthExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(monthKey)) next.delete(monthKey); else next.add(monthKey);
                          return next;
                        })}
                        data-testid={`row-rbm-month-${monthKey}`}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          }
                          <span className="font-semibold">{monthLabel}</span>
                          <Badge variant="outline" className="text-xs">
                            {items.length} advance{items.length !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                            {fmt(total)}
                          </span>
                          <Button
                            size="sm"
                            disabled={!repayByMonthForm.cashAccountId || !repayByMonthForm.repaymentDate || isPending || repayByMonthMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmRepay({ monthKey, monthLabel, items, total });
                            }}
                            data-testid={`button-rbm-repay-${monthKey}`}
                          >
                            {isPending
                              ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Repaying...</>
                              : <>Repay All in {new Date(parseInt(year), parseInt(mon) - 1, 1).toLocaleString("default", { month: "long" })}</>
                            }
                          </Button>
                        </div>
                      </div>

                      {/* Expanded worker rows */}
                      {isExpanded && (
                        <div className="divide-y">
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1 text-xs font-medium text-muted-foreground bg-muted/20">
                            <span>Worker</span>
                            <span className="text-right">Original</span>
                            <span className="text-right">Remaining</span>
                          </div>
                          {items.map((adv) => (
                            <div
                              key={adv.id}
                              className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-sm"
                              data-testid={`row-rbm-advance-${adv.id}`}
                            >
                              <span className="font-medium">{adv.workerName}</span>
                              <span className="font-mono text-right text-muted-foreground">{fmt(adv.amount)}</span>
                              <span className="font-mono text-right font-semibold text-amber-700 dark:text-amber-400">
                                {fmt(adv.remainingBalance)}
                              </span>
                            </div>
                          ))}
                          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-sm bg-muted/20">
                            <span className="font-semibold text-muted-foreground">Total</span>
                            <span></span>
                            <span className="font-mono text-right font-bold">{fmt(total)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Hint when date or account not set */}
          {(!repayByMonthForm.repaymentDate || !repayByMonthForm.cashAccountId) && (
            <p className="text-xs text-muted-foreground text-center pb-1">
              {!repayByMonthForm.repaymentDate && !repayByMonthForm.cashAccountId
                ? "Set a repayment date and cash account to enable repayment."
                : !repayByMonthForm.repaymentDate
                  ? "Set a repayment date to enable repayment."
                  : "Select a cash account to enable repayment."
              }
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRepayByMonthOpen(false)} data-testid="button-rbm-close">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Repay Dialog ── */}
      <Dialog open={!!confirmRepay} onOpenChange={(open) => { if (!open) setConfirmRepay(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Repayment — {confirmRepay?.monthLabel}</DialogTitle>
            <DialogDescription>
              Review the advances below. Clicking Confirm will mark all of them as fully paid
              and post the accounting entries.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1 text-sm">
            {/* Summary line */}
            <div className="flex justify-between items-center py-2 px-3 rounded-md bg-muted/40 font-medium">
              <span>Repayment date</span>
              <span className="font-mono">{repayByMonthForm.repaymentDate}</span>
            </div>
            <div className="flex justify-between items-center py-2 px-3 rounded-md bg-muted/40 font-medium">
              <span>Cash account</span>
              <span>{(cashAccounts || []).find((a) => String(a.id) === repayByMonthForm.cashAccountId)?.name ?? "—"}</span>
            </div>
          </div>

          {/* Per-advance breakdown */}
          <div className="border rounded-md overflow-hidden mt-2">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1 text-xs font-medium text-muted-foreground bg-muted/20">
              <span>Worker</span>
              <span className="text-right">Original</span>
              <span className="text-right">Will repay</span>
            </div>
            <div className="divide-y">
              {(confirmRepay?.items || []).map((adv) => (
                <div key={adv.id} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-sm">
                  <span className="font-medium">{adv.workerName}</span>
                  <span className="font-mono text-right text-muted-foreground">{fmt(adv.amount)}</span>
                  <span className="font-mono text-right font-semibold text-amber-700 dark:text-amber-400">
                    {fmt(adv.remainingBalance)}
                  </span>
                </div>
              ))}
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2 text-sm font-bold bg-muted/20">
                <span>Total</span>
                <span></span>
                <span className="font-mono text-right">{fmt(confirmRepay?.total ?? 0)}</span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmRepay(null)}
              disabled={repayByMonthMutation.isPending}
              data-testid="button-confirm-repay-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!confirmRepay) return;
                setRepayingMonth(confirmRepay.monthKey);
                setConfirmRepay(null);
                repayByMonthMutation.mutate(confirmRepay.monthKey);
              }}
              disabled={repayByMonthMutation.isPending}
              data-testid="button-confirm-repay-ok"
            >
              {repayByMonthMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
                : `Confirm — Pay ${fmt(confirmRepay?.total ?? 0)}`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={postAccountingOpen} onOpenChange={(open) => { setPostAccountingOpen(open); if (!open) setPostCashAccountId(""); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Post Accounting for Old Advances — Preview</DialogTitle>
            <DialogDescription>
              Creates a Payment voucher (DR Factory Worker Advances / CR Cash) for every advance that has no accounting entry yet. Review what will be posted before confirming.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Cash account selector */}
            <div className="space-y-2">
              <Label>Cash Account to Credit <span className="text-destructive">*</span></Label>
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

            {/* Preview section */}
            {unvoucheredLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Loading…
              </div>
            ) : !unvouchered?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No unvouchered advances found</p>
                <p className="text-xs mt-1">All advances already have accounting entries</p>
              </div>
            ) : (() => {
              const selectedAcct = (cashAccounts || []).find((a) => String(a.id) === postCashAccountId);
              const grandTotal = unvouchered.reduce((s, a) => s + parseFloat(a.amount || "0"), 0);
              const grouped: Record<string, typeof unvouchered> = {};
              for (const adv of unvouchered) {
                const key = adv.workerName || `Worker #${adv.workerId}`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(adv);
              }

              return (
                <div className="space-y-4">
                  {/* Summary boxes */}
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-center">
                      <p className="text-xs text-muted-foreground mb-1">Advances to Post</p>
                      <p className="font-bold">{unvouchered.length}</p>
                    </div>
                    <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-center">
                      <p className="text-xs text-muted-foreground mb-1">DR Factory Advances</p>
                      <p className="font-bold font-mono text-blue-700 dark:text-blue-400">{fmt(grandTotal)}</p>
                    </div>
                    <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-center">
                      <p className="text-xs text-muted-foreground mb-1">
                        CR {selectedAcct ? selectedAcct.name : "Cash Account"}
                      </p>
                      <p className="font-bold font-mono text-amber-700 dark:text-amber-400">{fmt(grandTotal)}</p>
                    </div>
                  </div>

                  {/* Per-advance breakdown */}
                  <div className="border rounded-md overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/20">
                      <span>Worker / Date</span>
                      <span className="text-right">Type</span>
                      <span className="text-right text-blue-600 dark:text-blue-400">DR Advances</span>
                      <span className="text-right text-amber-600 dark:text-amber-400">CR {selectedAcct?.name ?? "Cash"}</span>
                    </div>
                    <div className="divide-y max-h-56 overflow-y-auto">
                      {Object.entries(grouped).map(([workerName, advs]) => (
                        <Fragment key={workerName}>
                          <div className="px-4 py-1.5 bg-muted/30 text-xs font-semibold text-muted-foreground flex justify-between">
                            <span>{workerName}</span>
                            <span className="font-mono">{fmt(advs.reduce((s, a) => s + parseFloat(a.amount || "0"), 0))}</span>
                          </div>
                          {advs.map((adv) => (
                            <div
                              key={adv.id}
                              className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-2 text-sm items-center"
                              data-testid={`row-unvouchered-${adv.id}`}
                            >
                              <span className="text-muted-foreground text-xs">{formatDate(adv.advanceDate)}</span>
                              <Badge variant="outline" className="text-xs">
                                {adv.repaymentType === "manual_repayment" ? "Loan" : "Salary Ded."}
                              </Badge>
                              <span className="font-mono text-right text-blue-700 dark:text-blue-400">{fmt(adv.amount)}</span>
                              <span className="font-mono text-right text-amber-700 dark:text-amber-400">{fmt(adv.amount)}</span>
                            </div>
                          ))}
                        </Fragment>
                      ))}
                    </div>
                    {/* Grand total row */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-2 text-sm font-bold bg-muted/20 border-t">
                      <span>Total</span>
                      <span></span>
                      <span className="font-mono text-right text-blue-700 dark:text-blue-400">{fmt(grandTotal)}</span>
                      <span className="font-mono text-right text-amber-700 dark:text-amber-400">{fmt(grandTotal)}</span>
                    </div>
                  </div>

                  {!postCashAccountId && (
                    <p className="text-xs text-muted-foreground text-center">Select a cash account above to enable posting.</p>
                  )}
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setPostAccountingOpen(false); setPostCashAccountId(""); }} data-testid="button-cancel-post-accounting">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!postCashAccountId || !unvouchered?.length) return;
                postAccountingMutation.mutate({ cashAccountId: parseInt(postCashAccountId) });
              }}
              disabled={!postCashAccountId || !unvouchered?.length || postAccountingMutation.isPending}
              data-testid="button-confirm-post-accounting"
            >
              {postAccountingMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Posting…</>
                : `Confirm — Post ${fmt(unvouchered?.reduce((s, a) => s + parseFloat(a.amount || "0"), 0) ?? 0)} (${unvouchered?.length ?? 0} entries)`
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile confirmation dialog */}
      <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reconcile Advance Balances — Preview</DialogTitle>
            <DialogDescription>
              Replays all payroll deductions and manual repayments in order to recalculate every Salary Deduction advance balance from scratch. Review the changes below before confirming.
            </DialogDescription>
          </DialogHeader>

          {reconcilePreviewLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculating preview…
            </div>
          ) : !reconcilePreview ? null : (() => {
            const dirty = reconcilePreview.changes.filter((c) => c.changed);
            const clean = reconcilePreview.changes.filter((c) => !c.changed);
            return (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Advances</p>
                    <p className="font-bold">{reconcilePreview.totalAdvances}</p>
                  </div>
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Will Change</p>
                    <p className="font-bold text-amber-700 dark:text-amber-400">{dirty.length}</p>
                  </div>
                  <div className="rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Already Correct</p>
                    <p className="font-bold text-green-700 dark:text-green-400">{clean.length}</p>
                  </div>
                </div>

                {dirty.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    All balances are already correct — nothing will change.
                  </div>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/20">
                      <span>Worker</span>
                      <span className="text-right">Date</span>
                      <span className="text-right">Original</span>
                      <span className="text-right">Current Balance</span>
                      <span className="text-right">New Balance</span>
                    </div>
                    <div className="divide-y">
                      {dirty.map((c) => (
                        <div
                          key={c.advanceId}
                          className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-4 py-2 text-sm items-center"
                          data-testid={`row-reconcile-preview-${c.advanceId}`}
                        >
                          <span className="font-medium">{c.workerName}</span>
                          <span className="text-muted-foreground text-right font-mono text-xs">
                            {c.advanceDate ? formatDate(c.advanceDate) : "—"}
                          </span>
                          <span className="font-mono text-right text-muted-foreground">{fmt(c.originalAmount)}</span>
                          <span className="font-mono text-right text-amber-700 dark:text-amber-400">{fmt(c.currentBalance)}</span>
                          <span className={`font-mono text-right font-semibold ${parseFloat(c.newBalance) === 0 ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>
                            {fmt(c.newBalance)}
                            {c.newFullyPaid && !c.currentFullyPaid && (
                              <span className="ml-1 text-xs text-green-600 dark:text-green-400">(paid)</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReconcileOpen(false)} data-testid="button-cancel-reconcile">
              Cancel
            </Button>
            <Button
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending || reconcilePreviewLoading || (reconcilePreview?.changes.filter(c => c.changed).length === 0)}
              data-testid="button-confirm-reconcile"
            >
              {reconcileMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Reconciling…</>
                : reconcilePreview?.changes.filter(c => c.changed).length === 0
                  ? "Nothing to Change"
                  : `Confirm — Update ${reconcilePreview?.changes.filter(c => c.changed).length ?? "…"} Record(s)`
              }
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
