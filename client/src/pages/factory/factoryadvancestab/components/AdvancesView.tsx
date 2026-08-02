/**
 * AdvancesView — extracted sub-component.
 *
 * Extracted from FactoryAdvancesTab.tsx during the Phase 4 god-file split.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import {
  Plus,
  Trash2,
  Banknote,
  RotateCcw,
  BookOpen,
  Loader2,
  Users,
  CalendarDays,
  ChevronDown,
  SlidersHorizontal,
  SearchCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { FactoryWorker } from "@shared/schema";

import type { AdvanceRecord, CashAccount } from "../types";
import { fmt } from "../utils";

import { AdvanceDialog } from "./../dialogs/AdvanceDialog";
import { SettleDialog } from "./../dialogs/SettleDialog";
import { ConfirmDialog } from "./../dialogs/ConfirmDialog";
import { EditDialog } from "./../dialogs/EditDialog";
import { HistoryDialog } from "./../dialogs/HistoryDialog";
import { DeductionDialog } from "./../dialogs/DeductionDialog";
import { NoteDialog } from "./../dialogs/NoteDialog";
import { BulkDialog } from "./../dialogs/BulkDialog";
import { ExportDialog } from "./../dialogs/ExportDialog";

export interface AuditAdvance {
  id: number;
  workerId: number;
  workerName: string;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  fullyPaid: boolean;
  caseType: "missing_voucher" | "no_repayment";
  repayments: { id: number; repaymentDate: string; amount: string; cashAccountId: number | null }[];
  missingVoucherRepayments: { id: number; repaymentDate: string; amount: string; cashAccountId: number | null }[];
}

export function AdvancesView() {
  const { formatDisplayDate } = useDateFormat();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [postAccountingOpen, setPostAccountingOpen] = useState(false);
  const [postCashAccountId, setPostCashAccountId] = useState("");
  const [filterWorker, setFilterWorker] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<AdvanceRecord | null>(null);
  const [reverseTarget, setReverseTarget] = useState<AdvanceRecord | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCashAccountId, setBulkCashAccountId] = useState("");

  const [form, setForm] = useState({
    workerId: "",
    advanceDate: new Date().toLocaleDateString("en-CA"),
    amount: "",
    cashAccountId: "",
    notes: "",
    repaymentType: "salary_deduction" as string,
  });

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    advanceDate: new Date().toLocaleDateString("en-CA"),
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
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to load advances");
      }
      return res.json();
    },
  });

  const { data: workers } = useQuery<FactoryWorker[]>({
    queryKey: ["/api/factory/workers?active=true"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const {
    data: unvouchered,
    isLoading: unvoucheredLoading,
    refetch: refetchUnvouchered,
  } = useQuery<AdvanceRecord[]>({
    queryKey: ["/api/factory/advances/unvouchered"],
    queryFn: async () => {
      const res = await fetch("/api/factory/advances/unvouchered", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed");
      }
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
  const [confirmRepay, setConfirmRepay] = useState<{
    monthKey: string;
    monthLabel: string;
    items: AdvanceRecord[];
    total: number;
  } | null>(null);

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
    cashAccountId: "",
    amount: "",
    direction: "credit",
    date: "",
    narration: "Cash balance adjustment",
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
      setCashAdjForm({
        cashAccountId: "",
        amount: "",
        direction: "credit",
        date: "",
        narration: "Cash balance adjustment",
      });
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [repayAuditOpen, setRepayAuditOpen] = useState(false);
  const [repayAuditForm, setRepayAuditForm] = useState({ cashAccountId: "", repaymentDate: "" });

  interface AuditResult {
    advances: AuditAdvance[];
    summary: { total: number; ok: number; missingVoucher: number; noRepayment: number };
  }

  const {
    data: auditData,
    isLoading: auditLoading,
    refetch: refetchAudit,
  } = useQuery<AuditResult>({
    queryKey: ["/api/factory/advances/repayment-audit"],
    queryFn: async () => {
      const res = await fetch("/api/factory/advances/repayment-audit", { credentials: "include" });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || "Failed");
      }
      return res.json();
    },
    enabled: repayAuditOpen,
    staleTime: 15000,
    refetchOnMount: true,
  });

  const { data: auditCashBalance } = useQuery<{ balance: string; name: string }>({
    queryKey: ["/api/factory/cash-account-balance", repayAuditForm.cashAccountId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/cash-account-balance/${repayAuditForm.cashAccountId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch balance");
      return res.json();
    },
    enabled: !!repayAuditForm.cashAccountId && repayAuditOpen,
    staleTime: 15000,
    refetchOnMount: true,
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
    advanceId: number;
    workerName: string;
    advanceDate: string;
    originalAmount: string;
    currentBalance: string;
    newBalance: string;
    currentFullyPaid: boolean;
    newFullyPaid: boolean;
    changed: boolean;
  }

  const { data: reconcilePreview, isLoading: reconcilePreviewLoading } = useQuery<{
    changes: ReconcileChange[];
    totalAdvances: number;
  }>({
    queryKey: ["/api/factory/advances/reconcile/preview"],
    queryFn: async () => {
      const res = await fetch("/api/factory/advances/reconcile/preview", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Preview failed");
      return json;
    },
    enabled: reconcileOpen,
    staleTime: 15000,
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
      setForm({
        workerId: "",
        advanceDate: new Date().toLocaleDateString("en-CA"),
        amount: "",
        cashAccountId: "",
        notes: "",
        repaymentType: "salary_deduction",
      });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/factory/advances/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to delete");
      }
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
      setBulkForm({
        advanceDate: new Date().toLocaleDateString("en-CA"),
        cashAccountId: "",
        repaymentType: "salary_deduction",
        notes: "",
      });
    },
    onError: (err: Error) => {
      if (err?._handledGlobally) return;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const bulkUpdateCashAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/factory/advances/bulk-update-cash-account", {
        advanceIds: Array.from(selectedIds),
        cashAccountId: parseInt(bulkCashAccountId),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update cash accounts");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances"] });
      toast({ title: "Cash accounts updated", description: data.message });
      setSelectedIds(new Set());
      setBulkCashAccountId("");
    },
    onError: (err: Error) => {
      if ((err as any)?._handledGlobally) return;
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
    const totalOutstanding = all
      .filter((a) => !a.fullyPaid)
      .reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
    const outstandingCount = all.filter((a) => !a.fullyPaid).length;
    return { totalGiven, totalOutstanding, outstandingCount, total: all.length };
  }, [advances]);

  const formatDate = (val: string | null | undefined) => {
    if (!val) return "\u2014";
    try {
      return formatDisplayDate(val);
    } catch {
      return "\u2014";
    }
  };

  return (
    <div className="space-y-5">
      {/* Stats pills */}
      <div className="flex flex-wrap gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-10 w-44 rounded-lg" />
            <Skeleton className="h-10 w-32 rounded-lg" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Banknote className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Total Given</span>
              <span className="font-semibold font-mono" data-testid="text-advances-total-given">
                {fmt(stats.totalGiven)}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Banknote className="h-4 w-4 text-amber-500" />
              <span className="text-muted-foreground">Outstanding</span>
              <span
                className="font-semibold font-mono text-amber-600 dark:text-amber-400"
                data-testid="text-advances-outstanding"
              >
                {fmt(stats.totalOutstanding)}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Active</span>
              <span className="font-semibold" data-testid="text-advances-active-count">
                {stats.outstandingCount}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Filter + actions row */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-48" data-testid="select-filter-worker">
            <SelectValue placeholder="All Workers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {(workers || []).map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.fullName}
              </SelectItem>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-advances-actions">
                Actions <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setRepayByMonthOpen(true)} data-testid="button-repay-by-month">
                <CalendarDays className="h-4 w-4" />
                Repay by Month
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPostAccountingOpen(true)} data-testid="button-post-accounting">
                <BookOpen className="h-4 w-4" />
                Post Accounting
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRepayAuditOpen(true)} data-testid="button-repayment-audit">
                <SearchCheck className="h-4 w-4" />
                Repayment Audit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCashAdjOpen(true)} data-testid="button-cash-adjustment">
                <SlidersHorizontal className="h-4 w-4" />
                Cash Adjustment
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setReconcileOpen(true)} data-testid="button-reconcile-advances">
                <RotateCcw className="h-4 w-4" />
                Reconcile Balances
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="button-bulk-advance">
            <Users className="h-4 w-4 mr-2" />
            Bulk Advance
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-advance">
            <Plus className="h-4 w-4 mr-2" />
            Add Advance
          </Button>
        </div>
      </div>

      {/* Bulk action bar — visible when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/60 px-4 py-3">
          <span className="text-sm font-medium">
            {selectedIds.size} advance{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
            data-testid="button-clear-selection"
          >
            Clear
          </Button>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <Select value={bulkCashAccountId} onValueChange={setBulkCashAccountId}>
              <SelectTrigger className="w-52" data-testid="select-bulk-cash-account">
                <SelectValue placeholder="Select cash account…" />
              </SelectTrigger>
              <SelectContent>
                {(cashAccounts || []).map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => bulkUpdateCashAccountMutation.mutate()}
              disabled={!bulkCashAccountId || bulkUpdateCashAccountMutation.isPending}
              data-testid="button-bulk-update-cash-account"
            >
              {bulkUpdateCashAccountMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Update Cash Account
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-xl overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 h-9">
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id))}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedIds(new Set(filtered.map((a) => a.id)));
                    } else {
                      setSelectedIds(new Set());
                    }
                  }}
                  data-testid="checkbox-select-all"
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="text-xs h-9 font-semibold">Worker</TableHead>
              <TableHead className="text-xs h-9 font-semibold">Date</TableHead>
              <TableHead className="text-xs h-9 font-semibold text-right">Amount</TableHead>
              <TableHead className="text-xs h-9 font-semibold text-right">Remaining</TableHead>
              <TableHead className="text-xs h-9 font-semibold">Type</TableHead>
              <TableHead className="text-xs h-9 font-semibold">Status</TableHead>
              <TableHead className="text-xs h-9 font-semibold">Notes</TableHead>
              <TableHead className="text-xs h-9 w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}>
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <Banknote className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">No advances found</p>
                    <p className="text-xs text-muted-foreground">
                      {filterWorker !== "all" || filterStatus !== "all"
                        ? "Try adjusting your filters"
                        : "Record an advance to get started"}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((adv) => (
                <TableRow
                  key={adv.id}
                  className={`hover:bg-muted/40 ${selectedIds.has(adv.id) ? "bg-muted/30" : ""}`}
                  data-testid={`row-advance-${adv.id}`}
                >
                  <TableCell className="py-3">
                    <Checkbox
                      checked={selectedIds.has(adv.id)}
                      onCheckedChange={(checked) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(adv.id);
                          else next.delete(adv.id);
                          return next;
                        });
                      }}
                      data-testid={`checkbox-advance-${adv.id}`}
                      aria-label={`Select advance for ${adv.workerName}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium py-3" data-testid={`text-advance-worker-${adv.id}`}>
                    {adv.workerName}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground" data-testid={`text-advance-date-${adv.id}`}>
                    {formatDate(adv.advanceDate)}
                  </TableCell>
                  <TableCell
                    className="py-3 text-right font-mono text-sm"
                    data-testid={`text-advance-amount-${adv.id}`}
                  >
                    {fmt(adv.amount)}
                  </TableCell>
                  <TableCell
                    className="py-3 text-right font-mono text-sm"
                    data-testid={`text-advance-remaining-${adv.id}`}
                  >
                    {fmt(adv.remainingBalance)}
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant="secondary"
                      className={`text-xs no-default-active-elevate ${
                        adv.repaymentType === "manual_repayment"
                          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                      data-testid={`badge-advance-type-${adv.id}`}
                    >
                      {adv.repaymentType === "manual_repayment" ? "Loan" : "Salary Ded."}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3">
                    <Badge
                      variant="secondary"
                      className={`text-xs no-default-active-elevate ${
                        adv.fullyPaid
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                      data-testid={`badge-advance-status-${adv.id}`}
                    >
                      {adv.fullyPaid ? "Paid" : "Outstanding"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground max-w-[200px] truncate">
                    {adv.notes || "\u2014"}
                  </TableCell>
                  <TableCell className="py-3">
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AdvanceDialog
        bulkAmounts={bulkAmounts}
        bulkForm={bulkForm}
        bulkMutation={bulkMutation}
        bulkOpen={bulkOpen}
        bulkSelected={bulkSelected}
        cashAccounts={cashAccounts}
        setBulkAmounts={setBulkAmounts}
        setBulkForm={setBulkForm}
        setBulkOpen={setBulkOpen}
        setBulkSelected={setBulkSelected}
        workers={workers}
      />

      <SettleDialog
        addOpen={addOpen}
        cashAccounts={cashAccounts}
        createMutation={createMutation}
        form={form}
        setAddOpen={setAddOpen}
        setForm={setForm}
        workers={workers}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Advance</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this advance of {fmt(deleteTarget?.amount)} for {deleteTarget?.workerName}
              ?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
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
      <ConfirmDialog
        reverseMutation={reverseMutation}
        reverseTarget={reverseTarget}
        setReverseTarget={setReverseTarget}
      />

      {/* ── Repayment Audit Dialog ── */}
      <EditDialog
        auditCashBalance={auditCashBalance}
        auditData={auditData}
        auditLoading={auditLoading}
        cashAccounts={cashAccounts}
        formatDate={formatDate}
        refetchAudit={refetchAudit}
        repayAuditForm={repayAuditForm}
        repayAuditMutation={repayAuditMutation}
        repayAuditOpen={repayAuditOpen}
        setRepayAuditForm={setRepayAuditForm}
        setRepayAuditOpen={setRepayAuditOpen}
      />

      {/* ── Cash Account Adjustment Dialog ── */}
      <HistoryDialog
        cashAccounts={cashAccounts}
        cashAdjForm={cashAdjForm}
        cashAdjMutation={cashAdjMutation}
        cashAdjOpen={cashAdjOpen}
        setCashAdjForm={setCashAdjForm}
        setCashAdjOpen={setCashAdjOpen}
      />

      {/* ── Repay by Month Dialog ── */}
      <DeductionDialog
        advances={advances}
        cashAccounts={cashAccounts}
        repayByMonthExpanded={repayByMonthExpanded}
        repayByMonthForm={repayByMonthForm}
        repayByMonthMutation={repayByMonthMutation}
        repayByMonthOpen={repayByMonthOpen}
        repayingMonth={repayingMonth}
        setConfirmRepay={setConfirmRepay}
        setRepayByMonthExpanded={setRepayByMonthExpanded}
        setRepayByMonthForm={setRepayByMonthForm}
        setRepayByMonthOpen={setRepayByMonthOpen}
        setRepayingMonth={setRepayingMonth}
      />

      {/* ── Confirm Repay Dialog ── */}
      <NoteDialog
        cashAccounts={cashAccounts}
        confirmRepay={confirmRepay}
        repayByMonthForm={repayByMonthForm}
        repayByMonthMutation={repayByMonthMutation}
        setConfirmRepay={setConfirmRepay}
        setRepayingMonth={setRepayingMonth}
      />

      <BulkDialog
        cashAccounts={cashAccounts}
        formatDate={formatDate}
        postAccountingMutation={postAccountingMutation}
        postAccountingOpen={postAccountingOpen}
        postCashAccountId={postCashAccountId}
        setPostAccountingOpen={setPostAccountingOpen}
        setPostCashAccountId={setPostCashAccountId}
        unvouchered={unvouchered}
        unvoucheredLoading={unvoucheredLoading}
      />

      {/* Reconcile confirmation dialog */}
      <ExportDialog
        formatDate={formatDate}
        reconcileMutation={reconcileMutation}
        reconcileOpen={reconcileOpen}
        reconcilePreview={reconcilePreview}
        reconcilePreviewLoading={reconcilePreviewLoading}
        setReconcileOpen={setReconcileOpen}
      />
    </div>
  );
}
