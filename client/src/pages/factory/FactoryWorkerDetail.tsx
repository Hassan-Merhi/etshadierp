import { useState, useRef } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useEscapeBack } from "@/hooks/use-escape-back";
import {
  ArrowLeft, Upload, Pencil, UserX, UserCheck, Package, DollarSign, Calculator,
  CheckCircle2, X, CreditCard, Building, Phone, Calendar,
  FileText, FileImage, File, Trash2, Banknote, Plus, Loader2,
  ChevronDown, ChevronRight, RotateCcw, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { FactoryWorker, FactoryBale, FactoryWorkerDocument, FactoryWorkerAdvance } from "@shared/schema";

interface WorkerWithStats extends FactoryWorker {
  stats?: {
    totalBales: number; totalKg: string; totalEarnings: string; payrollCount: number;
  };
}

interface WorkerStats {
  workerId: number; workerName: string; salaryType: string;
  totalBales: number; totalKg: string; estimatedEarnings: string;
  totalPaid: string; payrollCount: number; recentPayrolls: any[];
}

interface PayrollRecord {
  id: number; workerId: number; periodStart: string; periodEnd: string;
  baseSalary: string; bonuses: string; deductions: string; advances: string;
  netSalary: string; status: string; cashAccountId: number | null;
  paidAt: string | null; notes: string | null;
}

interface CashAccount { id: number; name: string; code: string; }

const PAYROLL_STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "border-amber-400 text-amber-700 dark:text-amber-400" },
  APPROVED: { label: "Approved", className: "border-blue-400 text-blue-700 dark:text-blue-400" },
  PAID: { label: "Paid", className: "border-green-500 text-green-700 dark:text-green-400" },
};

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700",
  "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700", "bg-cyan-100 text-cyan-700",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "$0.00" : `$${n.toFixed(2)}`;
}

function fmtNum(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

interface AdvanceRowProps {
  adv: FactoryWorkerAdvance;
  isLoan: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRepay: () => void;
  formatDate: (d: string | null | undefined) => string;
  fmt: (v: string | number | null | undefined) => string;
}

function AdvanceRow({ adv, isLoan, isExpanded, onToggleExpand, onRepay, formatDate, fmt }: AdvanceRowProps) {
  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
    enabled: isLoan && isExpanded,
  });

  const { data: repayments } = useQuery<any[]>({
    queryKey: ["/api/factory/advances", adv.id, "repayments"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/advances/${adv.id}/repayments`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isLoan && isExpanded,
  });

  const cashAccountMap = new Map((cashAccounts || []).map((a) => [a.id, a.name]));

  const repaymentsWithRunningBalance = (repayments || []).slice().sort(
    (a: any, b: any) => new Date(a.repaymentDate).getTime() - new Date(b.repaymentDate).getTime()
  ).reduce((acc: any[], r: any) => {
    const prevBal = acc.length > 0 ? acc[acc.length - 1].balanceAfter : parseFloat(adv.amount || "0");
    const balAfter = prevBal - parseFloat(r.amount || "0");
    acc.push({ ...r, balanceAfter: Math.max(0, balAfter) });
    return acc;
  }, []).reverse();

  return (
    <>
      <TableRow data-testid={`row-worker-advance-${adv.id}`}>
        <TableCell className="px-2">
          {isLoan && (
            <Button size="icon" variant="ghost" onClick={onToggleExpand} data-testid={`button-expand-advance-${adv.id}`}>
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          )}
        </TableCell>
        <TableCell>{formatDate(adv.advanceDate)}</TableCell>
        <TableCell className="text-right font-mono">{fmt(adv.amount)}</TableCell>
        <TableCell className="text-right font-mono">{fmt(adv.remainingBalance)}</TableCell>
        <TableCell>
          <Badge
            variant="outline"
            className={isLoan
              ? "border-blue-400 text-blue-700 dark:text-blue-400"
              : "border-slate-400 text-slate-700 dark:text-slate-400"
            }
            data-testid={`badge-advance-type-${adv.id}`}
          >
            {isLoan ? "Loan" : "Salary Ded."}
          </Badge>
        </TableCell>
        <TableCell>
          <Badge
            variant="outline"
            className={adv.fullyPaid
              ? "border-green-500 text-green-700 dark:text-green-400"
              : "border-amber-400 text-amber-700 dark:text-amber-400"
            }
          >
            {adv.fullyPaid ? "Paid" : "Outstanding"}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">{adv.notes || "\u2014"}</TableCell>
        <TableCell>
          {isLoan && !adv.fullyPaid && (
            <Button size="sm" variant="outline" onClick={onRepay} data-testid={`button-repay-advance-${adv.id}`}>
              <RotateCcw className="h-3 w-3 mr-1" /> Repay
            </Button>
          )}
        </TableCell>
      </TableRow>
      {isLoan && isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Repayment History</div>
            {repaymentsWithRunningBalance.length === 0 ? (
              <p className="text-xs text-muted-foreground">No repayments recorded yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs">Cash Account</TableHead>
                    <TableHead className="text-xs text-right">Balance After</TableHead>
                    <TableHead className="text-xs">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {repaymentsWithRunningBalance.map((r: any) => (
                    <TableRow key={r.id} data-testid={`row-repayment-${r.id}`}>
                      <TableCell className="text-xs">{formatDate(r.repaymentDate)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(r.amount)}</TableCell>
                      <TableCell className="text-xs">{r.cashAccountId ? (cashAccountMap.get(r.cashAccountId) || `#${r.cashAccountId}`) : "\u2014"}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(r.balanceAfter)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.notes || "\u2014"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function FactoryWorkerDetail() {
  const [, navigate] = useLocation();
  useEscapeBack(() => navigate("/factory/workers"));
  const [, params] = useRoute("/factory/workers/:id");
  const workerId = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const { data: tabSettings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const showStatement = tabSettings?.workerDetailTabStatementEnabled !== false;
  const showAdvances  = tabSettings?.workerDetailTabAdvancesEnabled  !== false;
  const showBales     = tabSettings?.workerDetailTabBalesEnabled      !== false;
  const showDocuments = tabSettings?.workerDetailTabDocumentsEnabled  !== false;

  const { formatDisplayDate } = useDateFormat();
  const formatDate = (val: string | Date | null | undefined) => {
    if (!val) return "—";
    try { return formatDisplayDate(val instanceof Date ? val : new Date(val)); } catch { return "—"; }
  };

  const [endStep, setEndStep] = useState<1 | 2>(1);
  const [endOpen, setEndOpen] = useState(false);
  const [endStart, setEndStart] = useState("");
  const [endEnd, setEndEnd] = useState(new Date().toLocaleDateString('en-CA'));
  const [endCalculating, setEndCalculating] = useState(false);
  const [endResult, setEndResult] = useState<{ earned: string; paid: string; advances: string; balance: string } | null>(null);
  const [endCashAccountId, setEndCashAccountId] = useState("");
  const [endSubmitting, setEndSubmitting] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [payOpen, setPayOpen] = useState(false);
  const [payTargetId, setPayTargetId] = useState<number | null>(null);
  const [payCashAccountId, setPayCashAccountId] = useState("");

  const [fixAcctOpen, setFixAcctOpen] = useState(false);
  const [fixAcctTargetId, setFixAcctTargetId] = useState<number | null>(null);
  const [fixAcctCashId, setFixAcctCashId] = useState("");

  const [editOpen, setEditOpen] = useState(false);

  const [advanceDate, setAdvanceDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceNotes, setAdvanceNotes] = useState("");
  const [advanceRepaymentType, setAdvanceRepaymentType] = useState("salary_deduction");
  const [advanceCashAccountId, setAdvanceCashAccountId] = useState("");
  const [showAdvanceForm, setShowAdvanceForm] = useState(false);

  const [repayAdvanceId, setRepayAdvanceId] = useState<number | null>(null);
  const [repayDate, setRepayDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [repayAmount, setRepayAmount] = useState("");
  const [repayCashAccountId, setRepayCashAccountId] = useState("");
  const [repayNotes, setRepayNotes] = useState("");
  const [expandedAdvanceId, setExpandedAdvanceId] = useState<number | null>(null);
  const [pendingDeleteDocId, setPendingDeleteDocId] = useState<number | null>(null);

  const { data: worker, isLoading: workerLoading, error: workerError } = useQuery<WorkerWithStats>({
    queryKey: ["/api/factory/workers", workerId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers/${workerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch worker");
      return res.json();
    },
    enabled: !!workerId,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<WorkerStats>({
    queryKey: ["/api/factory/workers", workerId, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers/${workerId}/stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    enabled: !!workerId,
  });

  const { data: payrolls, isLoading: payrollsLoading } = useQuery<PayrollRecord[]>({
    queryKey: ["/api/factory/workers", workerId, "payrolls"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers/${workerId}/payrolls`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payrolls");
      return res.json();
    },
    enabled: !!workerId,
  });

  const baleQueryString = [startDate && `startDate=${startDate}`, endDate && `endDate=${endDate}`].filter(Boolean).join("&");
  const { data: bales, isLoading: balesLoading } = useQuery<FactoryBale[]>({
    queryKey: ["/api/factory/workers", workerId, "bales", startDate, endDate],
    queryFn: async () => {
      const url = `/api/factory/workers/${workerId}/bales${baleQueryString ? `?${baleQueryString}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch bales");
      return res.json();
    },
    enabled: !!workerId,
  });

  const { data: documents, isLoading: docsLoading } = useQuery<FactoryWorkerDocument[]>({
    queryKey: ["/api/factory/workers", workerId, "documents"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers/${workerId}/documents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch documents");
      return res.json();
    },
    enabled: !!workerId,
  });

  const { data: workerAdvances, isLoading: advancesLoading } = useQuery<FactoryWorkerAdvance[]>({
    queryKey: ["/api/factory/workers", workerId, "advances"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers/${workerId}/advances`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch advances");
      return res.json();
    },
    enabled: !!workerId,
  });

  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
  });

  const createAdvanceMutation = useMutation({
    mutationFn: async (data: { advanceDate: string; amount: string; notes: string; repaymentType: string; cashAccountId?: number }) => {
      const res = await apiRequest("POST", `/api/factory/workers/${workerId}/advances`, data);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "advances"] });
      toast({ title: "Advance recorded" });
      setAdvanceAmount("");
      setAdvanceNotes("");
      setAdvanceRepaymentType("salary_deduction");
      setAdvanceCashAccountId("");
      setShowAdvanceForm(false);
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const repaymentMutation = useMutation({
    mutationFn: async (data: { advanceId: number; repaymentDate: string; amount: string; cashAccountId?: number; notes?: string }) => {
      const res = await apiRequest("POST", `/api/factory/advances/${data.advanceId}/repayments`, data);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/advances", vars.advanceId, "repayments"] });
      toast({ title: "Repayment recorded" });
      setRepayAdvanceId(null);
      setRepayAmount("");
      setRepayNotes("");
      setRepayCashAccountId("");
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (advanceId: number) => {
      const res = await apiRequest("DELETE", `/api/factory/advances/${advanceId}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "advances"] });
      toast({ title: "Advance deleted" });
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: number) => {
      const res = await apiRequest("DELETE", `/api/factory/workers/${workerId}/documents/${docId}`);
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed to delete"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workerId) return;
    if (docInputRef.current) docInputRef.current.value = "";
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/factory/workers/${workerId}/documents`, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Upload failed"); }
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "documents"] });
      toast({ title: "Document uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploadingDoc(false);
    }
  };

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, cashId }: { id: number; cashId: string }) => {
      const res = await apiRequest("PATCH", `/api/factory/payrolls/${id}/mark-paid`, {
        companyId: worker?.companyId, cashAccountId: cashId ? parseInt(cashId) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "payrolls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "advances"] });
      toast({ title: "Marked as paid" });
      setPayOpen(false); setPayTargetId(null); setPayCashAccountId("");
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const fixAcctMutation = useMutation({
    mutationFn: async ({ id, cashId }: { id: number; cashId: string }) => {
      const res = await apiRequest("PATCH", `/api/factory/payrolls/${id}/fix-accounting`, {
        companyId: worker?.companyId, cashAccountId: parseInt(cashId),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "payrolls"] });
      toast({ title: "Accounting entry generated" });
      setFixAcctOpen(false); setFixAcctTargetId(null); setFixAcctCashId("");
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${workerId}/reactivate`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data: FactoryWorker) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Worker reactivated", description: `${data.fullName} is now active again.` });
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workerId) return;
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const res = await fetch(`/api/factory/workers/${workerId}/photo`, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Upload failed"); }
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId] });
      toast({ title: "Photo updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openEndContract = () => {
    if (!worker) return;
    setEndStep(1);
    setEndResult(null);
    setEndCashAccountId("");
    const today = new Date().toLocaleDateString('en-CA');
    const firstOfMonth = today.slice(0, 7) + "-01";
    setEndStart(worker.contractStartDate || worker.dateJoined || firstOfMonth);
    setEndEnd(today);
    setEndOpen(true);
  };

  const handleCalculate = async () => {
    if (!worker || !endStart || !endEnd) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Settle-and-end requires a connection", variant: "destructive" }); return; }
    setEndCalculating(true);
    try {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${workerId}/settle-and-end`, {
        companyId: worker.companyId, startDate: endStart, endDate: endEnd, dryRun: true,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Calculation failed");
      setEndResult(data);
      setEndStep(2);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEndCalculating(false);
    }
  };

  const handleEndContract = async (payNow: boolean) => {
    if (!worker) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Settle-and-end requires a connection", variant: "destructive" }); return; }
    setEndSubmitting(true);
    try {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${workerId}/settle-and-end`, {
        companyId: worker.companyId, startDate: endStart, endDate: endEnd,
        payNow, cashAccountId: payNow ? endCashAccountId : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to end contract");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "payrolls"] });
      toast({ title: "Contract ended", description: payNow ? `Paid ${fmt(data.balance)}` : "Balance recorded as pending" });
      setEndOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEndSubmitting(false);
    }
  };

  const handleSkipAndEnd = async () => {
    if (!worker) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Requires a connection", variant: "destructive" }); return; }
    setEndSubmitting(true);
    try {
      const today = new Date().toLocaleDateString('en-CA');
      const res = await factoryApiRequest("POST", `/api/factory/workers/${workerId}/settle-and-end`, {
        companyId: worker.companyId, endDate: endEnd || today, skipSettlement: true,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to end contract");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "payrolls"] });
      toast({ title: "Contract ended", description: "Worker deactivated. No settlement payroll was created." });
      setEndOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEndSubmitting(false);
    }
  };

  const payrollBalance = endResult ? parseFloat(endResult.balance) : 0;
  const totalPaidSalary = payrolls?.filter((p) => p.status === "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0) ?? 0;
  const totalPaidBonuses = payrolls?.filter((p) => p.status === "PAID").reduce((s, p) => s + parseFloat(p.bonuses || "0"), 0) ?? 0;
  const totalAdvancesGiven = workerAdvances?.reduce((s, a) => s + parseFloat(a.amount || "0"), 0) ?? 0;
  const totalPaid = totalPaidSalary;
  const totalPending = payrolls?.filter((p) => p.status !== "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0) ?? 0;
  const advancesLeft = (workerAdvances || []).filter((a) => !a.fullyPaid).reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
  // netSalary already has advance deductions baked in, so subtract only the REMAINING advance balance to avoid double-counting
  const netBalance = totalPaidSalary + totalPaidBonuses - advancesLeft;

  if (!workerId) return <div className="flex items-center justify-center py-20 text-muted-foreground">Invalid worker ID</div>;

  if (workerLoading) {
    return (
      <div className="flex gap-6">
        <Skeleton className="w-72 h-96 shrink-0 rounded-md" />
        <Skeleton className="flex-1 h-96 rounded-md" />
      </div>
    );
  }

  if (workerError || !worker) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/factory/workers")} data-testid="button-back-error">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center justify-center py-20 text-muted-foreground">Worker not found</div>
      </div>
    );
  }

  const infoRow = (label: string, value: string | number | null | undefined, testId?: string) => (
    <div className="flex justify-between py-1.5 border-b last:border-0 text-sm">
      <span className="text-muted-foreground shrink-0 mr-3">{label}</span>
      <span className="font-medium text-right" data-testid={testId}>{value || "—"}</span>
    </div>
  );

  const avatarColor = getAvatarColor(worker.fullName);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="icon" onClick={() => navigate("/factory/workers")} data-testid="button-back-workers">
        <ArrowLeft className="h-4 w-4" />
      </Button>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="w-full lg:w-72 shrink-0 space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="relative">
                  <Avatar className={`h-20 w-20 text-lg font-bold ${avatarColor}`}>
                    {worker.photoUrl ? <AvatarImage src={worker.photoUrl} alt={worker.fullName} data-testid="img-worker-photo" /> : null}
                    <AvatarFallback className={avatarColor} data-testid="text-worker-avatar">
                      {getInitials(worker.fullName)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div>
                  <h2 className="font-bold text-lg leading-tight" data-testid="text-worker-name">{worker.fullName}</h2>
                  {worker.position && <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-worker-position">{worker.position}</p>}
                  {worker.department && <p className="text-xs text-muted-foreground">{worker.department}</p>}
                </div>
                <Badge
                  variant={worker.active ? "default" : "secondary"}
                  className="no-default-active-elevate"
                  data-testid="badge-worker-status"
                >
                  {worker.active ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="border-t pt-3 space-y-2">
                {worker.employeeCode && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground text-xs">Code</span>
                    <span className="font-mono text-xs ml-auto" data-testid="text-worker-code">{worker.employeeCode}</span>
                  </div>
                )}
                {worker.nationality && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground text-xs">Nationality</span>
                    <span className="text-xs ml-auto">{worker.nationality}</span>
                  </div>
                )}
                {worker.phone1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs ml-auto" data-testid="text-worker-phone">{worker.phone1}</span>
                  </div>
                )}
                {worker.dateJoined && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs ml-auto">Joined {formatDate(worker.dateJoined)}</span>
                  </div>
                )}
                {worker.salaryType && (
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs ml-auto">{worker.salaryType} — {fmt(worker.baseSalary)}</span>
                  </div>
                )}
              </div>

              <div className="border-t pt-3 space-y-2">
                <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handlePhotoUpload} data-testid="input-photo-upload" />
                <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-photo">
                  <Upload className="h-3.5 w-3.5 mr-2" />Upload Photo
                </Button>
                {worker.active ? (
                  <Button variant="destructive" className="w-full" onClick={openEndContract} data-testid="button-end-contract">
                    <UserX className="h-3.5 w-3.5 mr-2" />End Contract
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full text-green-600 border-green-600"
                    onClick={() => reactivateMutation.mutate()}
                    disabled={reactivateMutation.isPending}
                    data-testid="button-reactivate-worker"
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-2" />
                    {reactivateMutation.isPending ? "Reactivating..." : "Reactivate Worker"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {!statsLoading && stats && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm text-muted-foreground">Production Stats</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4 space-y-3">
                <div className="text-center">
                  <p className="text-2xl font-bold" data-testid="text-stat-bales">{stats.totalBales}</p>
                  <p className="text-xs text-muted-foreground">Total Bales</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div>
                    <p className="font-semibold text-sm" data-testid="text-stat-kg">{parseFloat(stats.totalKg).toFixed(1)}</p>
                    <p className="text-xs text-muted-foreground">KG</p>
                  </div>
                  <div>
                    <p className="font-semibold text-sm" data-testid="text-stat-paid">{fmt(stats.totalPaid)}</p>
                    <p className="text-xs text-muted-foreground">Paid</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <Tabs defaultValue="profile">
            <TabsList className="mb-4">
              <TabsTrigger value="profile" data-testid="tab-profile">Profile</TabsTrigger>
              {showStatement && <TabsTrigger value="statement" data-testid="tab-statement">Statement</TabsTrigger>}
              {showAdvances  && <TabsTrigger value="advances" data-testid="tab-advances">Advances</TabsTrigger>}
              {showBales     && <TabsTrigger value="bales" data-testid="tab-bales">Bales</TabsTrigger>}
              {showDocuments && <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>}
            </TabsList>

            <TabsContent value="profile" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><span>Personal</span></CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Full Name", worker.fullName, "text-detail-fullname")}
                    {infoRow("Father Name", worker.fatherName, "text-detail-father")}
                    {infoRow("Mother Name", worker.motherName, "text-detail-mother")}
                    {infoRow("National ID", worker.nationalId, "text-detail-nationalid")}
                    {infoRow("Passport", worker.passportNumber, "text-detail-passport")}
                    {infoRow("Date of Birth", formatDate(worker.dateOfBirth), "text-detail-dob")}
                    {infoRow("Gender", worker.gender, "text-detail-gender")}
                    {infoRow("Nationality", worker.nationality, "text-detail-nationality")}
                    {infoRow("Marital Status", worker.maritalStatus, "text-detail-marital")}
                    {infoRow("Children", worker.numberOfChildren ?? "—", "text-detail-children")}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> Contact</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Phone 1", worker.phone1, "text-detail-phone1")}
                    {infoRow("Phone 2", worker.phone2, "text-detail-phone2")}
                    {infoRow("Emergency Name", worker.emergencyContactName, "text-detail-emergency")}
                    {infoRow("Emergency Phone", worker.emergencyContactPhone)}
                    {infoRow("Address", worker.address, "text-detail-address")}
                    {infoRow("City", worker.city, "text-detail-city")}
                    {infoRow("Country", worker.country, "text-detail-country")}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><Building className="h-3.5 w-3.5" /> Employment</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Employee Code", worker.employeeCode, "text-detail-code")}
                    {infoRow("Position", worker.position, "text-detail-position")}
                    {infoRow("Department", worker.department, "text-detail-department")}
                    {infoRow("Date Joined", formatDate(worker.dateJoined), "text-detail-joined")}
                    {infoRow("Contract Start", formatDate(worker.contractStartDate), "text-detail-contract-start")}
                    {infoRow("Contract End", formatDate(worker.contractEndDate), "text-detail-contract-end")}
                    {infoRow("Shift", worker.shiftType, "text-detail-shift")}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2"><CreditCard className="h-3.5 w-3.5" /> Compensation</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    {infoRow("Salary Type", worker.salaryType, "text-detail-salary-type")}
                    {infoRow("Base Salary", fmt(worker.baseSalary), "text-detail-base-salary")}
                    {infoRow("Transport Allowance", fmt((worker as any).transportAllowance), "text-detail-transport-allowance")}
                    {infoRow("Per Bale Rate", fmt(worker.perBaleRate), "text-detail-bale-rate")}
                    {infoRow("Per KG Rate", fmt(worker.perKgRate), "text-detail-kg-rate")}
                    {infoRow("Overtime Rate", fmt(worker.overtimeRate), "text-detail-overtime-rate")}
                    {infoRow("Pay Frequency", (worker as any).payFrequency)}
                    {infoRow("Payment Method", worker.paymentMethod, "text-detail-payment-method")}
                    {infoRow("Bank Name", worker.bankName, "text-detail-bank")}
                    {infoRow("Bank Account", worker.bankAccountNumber, "text-detail-bank-account")}
                  </CardContent>
                </Card>
              </div>
              {worker.notes && (
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm whitespace-pre-wrap" data-testid="text-worker-notes">{worker.notes}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {showStatement && <TabsContent value="statement" className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Net Balance</p>
                    <p className={`text-xl font-bold ${netBalance >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`} data-testid="stat-net-balance">
                      ${netBalance.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Paid + Bonus − Outstanding Advances</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                    <p className="text-xl font-bold text-green-700 dark:text-green-400" data-testid="stat-total-paid">${fmtNum(totalPaid)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Salary only</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Pending</p>
                    <p className="text-xl font-bold text-amber-700 dark:text-amber-400" data-testid="stat-total-pending">${fmtNum(totalPending)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Unpaid payrolls</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Advances Left</p>
                    <p className={`text-xl font-bold ${advancesLeft > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`} data-testid="stat-advances-left">
                      ${advancesLeft.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Outstanding balance</p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardContent className="p-0">
                  {payrollsLoading ? (
                    <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : !payrolls?.length ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <DollarSign className="mx-auto h-8 w-8 mb-3 opacity-30" />
                      <p className="font-medium">No payroll records</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Period</TableHead>
                            <TableHead className="text-right">Base</TableHead>
                            <TableHead className="text-right">Transport</TableHead>
                            <TableHead className="text-right">Bonus</TableHead>
                            <TableHead className="text-right">Advances</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Paid On</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payrolls.map((p) => {
                            const cfg = PAYROLL_STATUS[p.status] || PAYROLL_STATUS.DRAFT;
                            return (
                              <TableRow key={p.id} data-testid={`row-payroll-${p.id}`}>
                                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                  {p.periodStart?.slice(0, 10)} – {p.periodEnd?.slice(0, 10)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">${fmtNum(p.baseSalary)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">${fmtNum((p as any).transport || "0")}</TableCell>
                                <TableCell className="text-right font-mono text-sm">${fmtNum(p.bonuses)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">${fmtNum(p.advances)}</TableCell>
                                <TableCell className="text-right font-mono text-sm font-semibold">${fmtNum(p.netSalary)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {p.paidAt ? formatDate(p.paidAt) : "—"}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    {p.status !== "PAID" && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => { setPayTargetId(p.id); setPayCashAccountId(""); setPayOpen(true); }}
                                        data-testid={`button-pay-payroll-${p.id}`}
                                      >
                                        Pay
                                      </Button>
                                    )}
                                    {(p.status === "PAID" || p.status === "APPROVED") && !p.cashAccountId && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => { setFixAcctTargetId(p.id); setFixAcctCashId(""); setFixAcctOpen(true); }}
                                        data-testid={`button-fix-acct-${p.id}`}
                                        title="Generate missing accounting entry"
                                      >
                                        <Wrench className="h-4 w-4 text-amber-500" />
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Banknote className="h-4 w-4" />
                    Advances Given
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {advancesLoading ? (
                    <div className="p-4 space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : !workerAdvances?.length ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-sm">No advances given</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="text-right">Remaining</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {workerAdvances.map((adv) => (
                            <TableRow key={adv.id} data-testid={`row-statement-advance-${adv.id}`}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatDate(adv.advanceDate)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">${fmtNum(adv.amount)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">${fmtNum(adv.remainingBalance)}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-xs">
                                  {adv.repaymentType === "manual_repayment" ? "Loan" : "Salary Deduction"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={adv.fullyPaid ? "outline" : "default"} className="text-xs">
                                  {adv.fullyPaid ? "Repaid" : "Outstanding"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                                {adv.notes || "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>}

            {showAdvances && <TabsContent value="advances" className="space-y-4">
              {/* Advance balance KPIs */}
              {(() => {
                const allOutstanding = (workerAdvances || []).filter((a) => !a.fullyPaid);
                const salaryDeductionBal = allOutstanding.filter((a) => a.repaymentType !== "manual_repayment").reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
                const loanBal = allOutstanding.filter((a) => a.repaymentType === "manual_repayment").reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
                const totalOwed = salaryDeductionBal + loanBal;
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Card>
                      <CardHeader className="pb-1 pt-3 px-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Salary Advance Remaining</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        <p className={`text-xl font-bold font-mono ${salaryDeductionBal > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} data-testid="kpi-salary-advance-balance">
                          ${salaryDeductionBal.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{salaryDeductionBal > 0 ? "Worker owes company" : "No outstanding"}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-1 pt-3 px-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Loan Remaining</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        <p className={`text-xl font-bold font-mono ${loanBal > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} data-testid="kpi-loan-balance">
                          ${loanBal.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{loanBal > 0 ? "Worker owes company" : "No outstanding"}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-1 pt-3 px-4">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Total Balance</CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-3">
                        <p className={`text-xl font-bold font-mono ${totalOwed > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`} data-testid="kpi-total-advance-balance">
                          ${totalOwed.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{totalOwed > 0 ? "Worker owes company" : "All settled"}</p>
                      </CardContent>
                    </Card>
                  </div>
                );
              })()}

              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm">Advance History</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(() => {
                      const allOutstanding = (workerAdvances || []).filter((a) => !a.fullyPaid);
                      const salaryDeduction = allOutstanding.filter((a) => a.repaymentType !== "manual_repayment");
                      const manualRepayment = allOutstanding.filter((a) => a.repaymentType === "manual_repayment");
                      const salaryBal = salaryDeduction.reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
                      const loanBal = manualRepayment.reduce((s, a) => s + parseFloat(a.remainingBalance || "0"), 0);
                      return (
                        <>
                          {salaryBal > 0 && (
                            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400" data-testid="badge-advance-salary-balance">
                              Salary Ded: {fmt(salaryBal)}
                            </Badge>
                          )}
                          {loanBal > 0 && (
                            <Badge variant="outline" className="border-blue-400 text-blue-700 dark:text-blue-400" data-testid="badge-advance-loan-balance">
                              Loan: {fmt(loanBal)}
                            </Badge>
                          )}
                        </>
                      );
                    })()}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowAdvanceForm(true)}
                      data-testid="button-new-advance"
                    >
                      <Plus className="h-4 w-4 mr-1" /> New Advance
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {showAdvanceForm && (
                    <div className="p-4 border-b space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="space-y-1">
                          <Label className="text-xs">Date</Label>
                          <Input
                            type="date"
                            value={advanceDate}
                            onChange={(e) => setAdvanceDate(e.target.value)}
                            className="w-40"
                            data-testid="input-new-advance-date"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Amount ($)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={advanceAmount}
                            onChange={(e) => setAdvanceAmount(e.target.value)}
                            className="w-32"
                            data-testid="input-new-advance-amount"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Notes</Label>
                          <Input
                            placeholder="Optional"
                            value={advanceNotes}
                            onChange={(e) => setAdvanceNotes(e.target.value)}
                            className="w-40"
                            data-testid="input-new-advance-notes"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="space-y-1">
                          <Label className="text-xs">Repayment Type</Label>
                          <Select value={advanceRepaymentType} onValueChange={(v) => setAdvanceRepaymentType(v)}>
                            <SelectTrigger className="w-48" data-testid="select-advance-repayment-type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="salary_deduction">Deduct from Salary</SelectItem>
                              <SelectItem value="manual_repayment">Manual Repayment (Loan)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Cash Account (optional)</Label>
                          <Select value={advanceCashAccountId} onValueChange={setAdvanceCashAccountId}>
                            <SelectTrigger className="w-48" data-testid="select-advance-cash-account">
                              <SelectValue placeholder="None (no cash deduction)" />
                            </SelectTrigger>
                            <SelectContent>
                              {(cashAccounts || []).map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-end gap-2 mt-auto pt-4">
                          <Button
                            size="sm"
                            onClick={() => createAdvanceMutation.mutate({
                              advanceDate,
                              amount: advanceAmount,
                              notes: advanceNotes,
                              repaymentType: advanceRepaymentType,
                              ...(advanceCashAccountId ? { cashAccountId: parseInt(advanceCashAccountId) } : {}),
                            })}
                            disabled={!advanceAmount || parseFloat(advanceAmount) <= 0 || createAdvanceMutation.isPending}
                            data-testid="button-save-advance"
                          >
                            {createAdvanceMutation.isPending ? "Saving..." : "Save"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setShowAdvanceForm(false)} data-testid="button-cancel-advance">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="w-24"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(!workerAdvances || workerAdvances.length === 0) ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                            No advances recorded
                          </TableCell>
                        </TableRow>
                      ) : (() => {
                        const salaryAdvances = workerAdvances.filter((a) => a.repaymentType !== "manual_repayment");
                        const loanAdvances = workerAdvances.filter((a) => a.repaymentType === "manual_repayment");
                        const renderRows = (list: typeof workerAdvances, isLoan: boolean) =>
                          list.map((adv) => {
                            const isExpanded = expandedAdvanceId === adv.id;
                            return (
                              <AdvanceRow
                                key={adv.id}
                                adv={adv}
                                isLoan={isLoan}
                                isExpanded={isExpanded}
                                onToggleExpand={() => setExpandedAdvanceId(isExpanded ? null : adv.id)}
                                onRepay={() => {
                                  setRepayAdvanceId(adv.id);
                                  setRepayDate(new Date().toLocaleDateString('en-CA'));
                                  setRepayAmount("");
                                  setRepayCashAccountId("");
                                  setRepayNotes("");
                                }}
                                formatDate={formatDate}
                                fmt={fmt}
                              />
                            );
                          });
                        return (
                          <>
                            {salaryAdvances.length > 0 && (
                              <>
                                <TableRow>
                                  <TableCell colSpan={8} className="bg-muted/50 py-1.5 px-3 text-xs font-semibold text-muted-foreground">
                                    Salary Deduction Advances ({salaryAdvances.length})
                                  </TableCell>
                                </TableRow>
                                {renderRows(salaryAdvances, false)}
                              </>
                            )}
                            {loanAdvances.length > 0 && (
                              <>
                                <TableRow>
                                  <TableCell colSpan={8} className="bg-muted/50 py-1.5 px-3 text-xs font-semibold text-muted-foreground">
                                    Loan / Manual Repayment Advances ({loanAdvances.length})
                                  </TableCell>
                                </TableRow>
                                {renderRows(loanAdvances, true)}
                              </>
                            )}
                          </>
                        );
                      })()}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {repayAdvanceId && (() => {
                const adv = (workerAdvances || []).find((a) => a.id === repayAdvanceId);
                if (!adv) return null;
                const maxRepay = parseFloat(adv.remainingBalance || "0");
                return (
                  <Dialog open={true} onOpenChange={(open) => { if (!open) setRepayAdvanceId(null); }}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Record Repayment</DialogTitle>
                        <DialogDescription>
                          Advance of {fmt(adv.amount)} | Remaining: {fmt(adv.remainingBalance)}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-2">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Date</Label>
                            <Input
                              type="date"
                              value={repayDate}
                              onChange={(e) => setRepayDate(e.target.value)}
                              data-testid="input-repay-date"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Amount ($)</Label>
                            <Input
                              type="number"
                              min="0"
                              max={maxRepay}
                              step="0.01"
                              placeholder={`Max ${maxRepay.toFixed(2)}`}
                              value={repayAmount}
                              onChange={(e) => setRepayAmount(e.target.value)}
                              data-testid="input-repay-amount"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Cash Account (receives repayment)</Label>
                          <Select value={repayCashAccountId} onValueChange={setRepayCashAccountId}>
                            <SelectTrigger data-testid="select-repay-cash-account">
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
                          <Label>Notes</Label>
                          <Input
                            placeholder="Optional notes"
                            value={repayNotes}
                            onChange={(e) => setRepayNotes(e.target.value)}
                            data-testid="input-repay-notes"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setRepayAdvanceId(null)} data-testid="button-cancel-repay">
                          Cancel
                        </Button>
                        <Button
                          onClick={() => repaymentMutation.mutate({
                            advanceId: repayAdvanceId,
                            repaymentDate: repayDate,
                            amount: repayAmount,
                            cashAccountId: repayCashAccountId ? parseInt(repayCashAccountId) : undefined,
                            notes: repayNotes || undefined,
                          })}
                          disabled={!repayAmount || parseFloat(repayAmount) <= 0 || repaymentMutation.isPending}
                          data-testid="button-submit-repay"
                        >
                          {repaymentMutation.isPending ? "Saving..." : "Record Repayment"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                );
              })()}
            </TabsContent>}

            {showDocuments && <TabsContent value="documents" className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Worker Documents</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{documents?.length || 0} file{documents?.length !== 1 ? "s" : ""} uploaded</p>
                </div>
                <div>
                  <input
                    ref={docInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.xls"
                    onChange={handleDocUpload}
                    data-testid="input-doc-upload"
                  />
                  <Button
                    variant="outline"
                    onClick={() => docInputRef.current?.click()}
                    disabled={uploadingDoc}
                    data-testid="button-upload-doc"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploadingDoc ? "Uploading..." : "Upload Document"}
                  </Button>
                </div>
              </div>

              {docsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
                </div>
              ) : !documents?.length ? (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <FileText className="mx-auto h-8 w-8 mb-3 opacity-30" />
                    <p className="font-medium">No documents uploaded yet</p>
                    <p className="text-sm mt-1">Upload contracts, IDs, permits, or any other files</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {documents.map((doc) => {
                        const isImage = doc.fileType?.startsWith("image/");
                        const isPdf = doc.fileType === "application/pdf";
                        const Icon = isImage ? FileImage : isPdf ? FileText : File;
                        const sizeKb = doc.fileSize ? (doc.fileSize / 1024).toFixed(1) : null;
                        const uploadDate = doc.uploadedAt
                          ? formatDate(doc.uploadedAt)
                          : "—";
                        return (
                          <div key={doc.id} className="flex items-center gap-3 p-3" data-testid={`row-doc-${doc.id}`}>
                            <div className="shrink-0 text-muted-foreground">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" data-testid={`text-doc-name-${doc.id}`}>{doc.originalName}</p>
                              <p className="text-xs text-muted-foreground">
                                {uploadDate}{sizeKb ? ` · ${sizeKb} KB` : ""}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(doc.fileUrl, "_blank")}
                                data-testid={`button-download-doc-${doc.id}`}
                              >
                                Download
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setPendingDeleteDocId(doc.id)}
                                disabled={deleteDocMutation.isPending}
                                data-testid={`button-delete-doc-${doc.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>}

            {showBales && <TabsContent value="bales">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-sm flex items-center gap-2"><Package className="h-3.5 w-3.5" /> Bale History</CardTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="baleStart" className="text-xs text-muted-foreground">From</Label>
                        <Input id="baleStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-auto" data-testid="input-bale-start-date" />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label htmlFor="baleEnd" className="text-xs text-muted-foreground">To</Label>
                        <Input id="baleEnd" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-auto" data-testid="input-bale-end-date" />
                      </div>
                      {(startDate || endDate) && (
                        <Button variant="ghost" size="sm" onClick={() => { setStartDate(""); setEndDate(""); }} data-testid="button-clear-bale-dates">Clear</Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {balesLoading ? (
                    <Skeleton className="h-48 w-full" />
                  ) : bales?.length ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bale Code</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Weight KG</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bales.map((bale) => (
                            <TableRow key={bale.id} data-testid={`row-bale-${bale.id}`}>
                              <TableCell className="font-medium text-sm" data-testid={`text-bale-code-${bale.id}`}>{bale.baleCode}</TableCell>
                              <TableCell className="text-sm">{bale.productName || "—"}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{parseFloat(bale.weightKg).toFixed(3)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{fmt(bale.totalCost)}</TableCell>
                              <TableCell>
                                <Badge variant={bale.status === "FINALIZED" || bale.status === "IN_STOCK" ? "default" : "secondary"} className="text-xs">
                                  {bale.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{formatDate(bale.finalizedAt as any)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground">
                      <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No bales found</p>
                      <p className="text-sm mt-1">No bale records{startDate || endDate ? " in selected range" : ""}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>}
          </Tabs>
        </div>
      </div>

      <Dialog open={endOpen} onOpenChange={(open) => { if (!open) setEndOpen(false); }}>
        <DialogContent data-testid="dialog-end-contract">
          <DialogHeader>
            <DialogTitle>End Contract — {worker.fullName}</DialogTitle>
            <DialogDescription>
              {endStep === 1 ? "Set the settlement period to calculate the final balance." : "Review the settlement and choose payment."}
            </DialogDescription>
          </DialogHeader>

          {endStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Period Start</Label>
                  <Input type="date" value={endStart} onChange={(e) => setEndStart(e.target.value)} data-testid="input-end-start" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Period End</Label>
                  <Input type="date" value={endEnd} onChange={(e) => setEndEnd(e.target.value)} data-testid="input-end-end" />
                </div>
              </div>
              <Button onClick={handleCalculate} disabled={endCalculating || !endStart || !endEnd} className="w-full" data-testid="button-calculate">
                <Calculator className="h-4 w-4 mr-2" />
                {endCalculating ? "Calculating..." : "Calculate Settlement"}
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or</span></div>
              </div>
              <Button
                variant="outline"
                onClick={handleSkipAndEnd}
                disabled={endSubmitting}
                className="w-full text-muted-foreground"
                data-testid="button-skip-end-contract"
              >
                <UserX className="h-4 w-4 mr-2" />
                {endSubmitting ? "Ending..." : "End Contract Without Payment"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Immediately deactivates the worker. No settlement payroll is created.
              </p>
            </div>
          )}

          {endStep === 2 && endResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Earned</p>
                  <p className="font-semibold text-sm" data-testid="text-earned">${fmtNum(endResult.earned)}</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Already Paid</p>
                  <p className="font-semibold text-sm" data-testid="text-paid">${fmtNum(endResult.paid)}</p>
                </div>
                <div className={`rounded-md border p-3 text-center ${parseFloat(endResult.advances) > 0 ? "border-orange-300 bg-orange-50 dark:bg-orange-900/20" : ""}`}>
                  <p className="text-xs text-muted-foreground mb-1">Advances</p>
                  <p className="font-semibold text-sm" data-testid="text-advances">${fmtNum(endResult.advances)}</p>
                </div>
                <div className={`rounded-md border p-3 text-center ${payrollBalance > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20" : "border-green-300 bg-green-50 dark:bg-green-900/20"}`}>
                  <p className="text-xs text-muted-foreground mb-1">Balance</p>
                  <p className="font-semibold text-sm" data-testid="text-balance">${fmtNum(endResult.balance)}</p>
                </div>
              </div>
              {payrollBalance > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Cash Account (Pay Now)</Label>
                  <Select value={endCashAccountId} onValueChange={setEndCashAccountId}>
                    <SelectTrigger data-testid="select-cash-account"><SelectValue placeholder="Select account..." /></SelectTrigger>
                    <SelectContent>{cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="icon" onClick={() => { setEndStep(1); setEndResult(null); }}>
                  <X className="h-4 w-4" />
                </Button>
                {payrollBalance > 0 ? (
                  <>
                    <Button className="flex-1" onClick={() => handleEndContract(true)} disabled={endSubmitting || !endCashAccountId} data-testid="button-pay-now">
                      {endSubmitting ? "Processing..." : `Pay Now $${fmtNum(endResult.balance)}`}
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={() => handleEndContract(false)} disabled={endSubmitting} data-testid="button-pay-later">
                      Pay Later — End Contract
                    </Button>
                  </>
                ) : (
                  <Button className="flex-1" onClick={() => handleEndContract(false)} disabled={endSubmitting} data-testid="button-end-confirm">
                    {endSubmitting ? "Processing..." : "End Contract"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Fix Accounting Dialog */}
      <Dialog open={fixAcctOpen} onOpenChange={(open) => { if (!open) { setFixAcctOpen(false); setFixAcctTargetId(null); setFixAcctCashId(""); } }}>
        <DialogContent data-testid="dialog-fix-acct">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-amber-500" />
              Generate Missing Accounting Entry
            </DialogTitle>
            <DialogDescription>
              This payroll was marked paid without a cash account. Select an account to create the missing payment voucher.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Cash Account</Label>
              <Select value={fixAcctCashId} onValueChange={setFixAcctCashId}>
                <SelectTrigger data-testid="select-fix-acct-cash"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}</SelectContent>
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

      <Dialog open={payOpen} onOpenChange={(open) => { if (!open) { setPayOpen(false); setPayTargetId(null); } }}>
        <DialogContent data-testid="dialog-pay-payroll">
          <DialogHeader>
            <DialogTitle>Mark Payroll as Paid</DialogTitle>
            <DialogDescription>Select a cash account to record this payment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Cash Account</Label>
              <Select value={payCashAccountId} onValueChange={setPayCashAccountId}>
                <SelectTrigger data-testid="select-pay-cash"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}</SelectContent>
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

      {/* Delete Document Confirmation */}
      <Dialog open={pendingDeleteDocId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteDocId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Document?</DialogTitle>
            <DialogDescription>
              This will permanently remove the uploaded document. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPendingDeleteDocId(null)} disabled={deleteDocMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteDocMutation.isPending}
              onClick={() => { if (pendingDeleteDocId !== null) { deleteDocMutation.mutate(pendingDeleteDocId); setPendingDeleteDocId(null); } }}
              data-testid="button-confirm-delete-doc"
            >
              {deleteDocMutation.isPending ? "Deleting..." : "Delete Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
