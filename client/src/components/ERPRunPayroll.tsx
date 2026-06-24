import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Loader2,
  PlayCircle,
  Banknote,
  FileSpreadsheet,
  FileText,
  Printer,
  CheckCircle2,
  History,
  ArrowLeft,
  Trash2,
  ClipboardList,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useCompany } from "@/contexts/CompanyContext";

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
];
function getAvatarColor(name: string) {
  let h = 0;
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "0.00" : n.toFixed(2);
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
interface WorkerGroup {
  id: number;
  name: string;
  members: { id: number }[];
}
interface LedgerAccount {
  id: number;
  name: string;
  code: string;
  accountType: string;
}
interface SalaryAdvance {
  id: number;
  employeeId: number;
  amount: string;
  remainingBalance: string;
  fullyPaid: boolean;
}
interface PreviewItem {
  employeeId: number;
  employeeName: string;
  groupName: string;
  baseSalary: number;
  deduction: number;
  pendingDeductions: number;
  netPay: number;
}
interface WorkerDeductionRow {
  workerId: number;
  amount: string;
  applied: boolean;
}
interface PayrollRun {
  id: number;
  status: string;
  date: string;
  notes: string | null;
  paymentAccountId: number | null;
  paidAt: string | null;
  createdAt: string;
  itemCount: number;
  totalNet: string;
  totalBase: string;
  items: PayrollRunItem[];
}
interface PayrollRunItem {
  id: number;
  runId: number;
  employeeId: number;
  employeeName: string;
  groupName: string | null;
  baseSalary: string;
  deduction: string;
  netPay: string;
}

export default function ERPRunPayroll() {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const { selectedCompany } = useCompany();
  const companyId = selectedCompany?.id;

  const [activeTab, setActiveTab] = useState<"run" | "history">("run");

  // ── Step 1: worker selection ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<number | string, boolean>>({});
  const [selectedWorkers, setSelectedWorkers] = useState<Set<number>>(new Set());

  // ── Step 2: preview / draft ───────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2>(1);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [previewDate, setPreviewDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [previewNotes, setPreviewNotes] = useState("");

  // ── History: pay dialog ───────────────────────────────────────────────────
  const [payDialogRun, setPayDialogRun] = useState<PayrollRun | null>(null);
  const [payAccountId, setPayAccountId] = useState("");
  const [deleteRunId, setDeleteRunId] = useState<number | null>(null);
  const [undoRunId, setUndoRunId] = useState<number | null>(null);
  const [migrateConfirmOpen, setMigrateConfirmOpen] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{
    migrated: number;
    alreadyCorrect: number;
    noGroups: number;
    noVoucher: number;
    total: number;
  } | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const isDeveloper = currentUser?.role === "Developer";

  const { data: allEmployees, isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees", companyId],
  });

  const { data: workerGroupsRaw = [], isLoading: groupsLoading } = useQuery<WorkerGroup[]>({
    queryKey: ["/api/worker-groups/with-members", companyId],
    queryFn: async () => {
      const res = await fetch("/api/worker-groups/with-members", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts", companyId],
    queryFn: async () => {
      const res = await fetch("/api/ledger-accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: salaryAdvances = [] } = useQuery<SalaryAdvance[]>({
    queryKey: ["/api/salary-advances", companyId],
    queryFn: async () => {
      const res = await fetch("/api/salary-advances", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: workerDeductionsRaw = [] } = useQuery<WorkerDeductionRow[]>({
    queryKey: ["/api/factory/worker-deductions", companyId],
    queryFn: async () => {
      const res = await fetch("/api/factory/worker-deductions", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: payrollRuns = [], isLoading: runsLoading } = useQuery<PayrollRun[]>({
    queryKey: ["/api/payroll/runs", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/payroll/runs?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!companyId,
  });

  const cashAccounts = useMemo(() => ledgerAccounts.filter((a) => a.accountType === "Cash"), [ledgerAccounts]);
  const workers = useMemo(
    () => (allEmployees || []).filter((e) => e.employeeType === "Worker" && e.active),
    [allEmployees]
  );
  const workerGroups = useMemo(
    () =>
      workerGroupsRaw.filter((g: any) => {
        const t = g.groupType || g.group_type;
        return !t || t === "Worker";
      }),
    [workerGroupsRaw]
  );

  const advanceBalanceByEmployee = useMemo(() => {
    const map: Record<number, number> = {};
    for (const adv of salaryAdvances) {
      if (!adv.fullyPaid) {
        const bal = parseFloat(adv.remainingBalance || "0");
        if (bal > 0) map[adv.employeeId] = (map[adv.employeeId] || 0) + bal;
      }
    }
    return map;
  }, [salaryAdvances]);

  const pendingDeductionsByEmployee = useMemo(() => {
    const map: Record<number, number> = {};
    for (const d of workerDeductionsRaw) {
      if (!d.applied) {
        map[d.workerId] = (map[d.workerId] || 0) + parseFloat(d.amount || "0");
      }
    }
    return map;
  }, [workerDeductionsRaw]);

  const workerMemberships = useMemo(() => {
    const map: Record<number, number[]> = {};
    for (const g of workerGroups)
      for (const m of g.members || []) {
        if (!map[m.id]) map[m.id] = [];
        map[m.id].push(g.id);
      }
    return map;
  }, [workerGroups]);

  const ungroupedWorkers = useMemo(
    () => workers.filter((w) => !workerMemberships[w.id]?.length),
    [workers, workerMemberships]
  );

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return new Set(workers.map((w) => w.id));
    const q = searchQuery.toLowerCase();
    return new Set(
      workers
        .filter(
          (w) =>
            `${w.firstName} ${w.lastName}`.toLowerCase().includes(q) ||
            w.code?.toLowerCase().includes(q) ||
            (w.department || "").toLowerCase().includes(q)
        )
        .map((w) => w.id)
    );
  }, [workers, searchQuery]);

  const workerById = useMemo(() => {
    const map: Record<number, Employee> = {};
    for (const w of workers) map[w.id] = w;
    return map;
  }, [workers]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function toggleGroup(key: number | string) {
    setExpandedGroups((p) => ({ ...p, [key]: !(p[key] ?? true) }));
  }
  function toggleWorker(id: number) {
    setSelectedWorkers((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleGroupSelection(memberIds: number[]) {
    const visible = memberIds.filter((id) => filtered.has(id));
    const allSel = visible.every((id) => selectedWorkers.has(id));
    setSelectedWorkers((p) => {
      const n = new Set(p);
      allSel ? visible.forEach((id) => n.delete(id)) : visible.forEach((id) => n.add(id));
      return n;
    });
  }

  function enterPreview() {
    const items: PreviewItem[] = [];
    function addGroup(label: string, memberIds: number[]) {
      for (const id of memberIds) {
        if (!selectedWorkers.has(id) || !workerById[id]) continue;
        const w = workerById[id];
        const salary = parseFloat(w.monthlySalary || "0");
        const deduction = Math.min(advanceBalanceByEmployee[id] || 0, salary);
        const pendingDeductions = pendingDeductionsByEmployee[id] || 0;
        items.push({
          employeeId: id,
          employeeName: `${w.firstName} ${w.lastName}`.trim(),
          groupName: label,
          baseSalary: salary,
          deduction,
          pendingDeductions,
          netPay: Math.max(0, salary - deduction - pendingDeductions),
        });
      }
    }
    for (const g of workerGroups)
      addGroup(
        g.name,
        (g.members || []).map((m) => m.id)
      );
    if (ungroupedWorkers.length > 0)
      addGroup(
        "Ungrouped",
        ungroupedWorkers.map((w) => w.id)
      );
    setPreviewItems(items);
    setPreviewNotes("");
    setStep(2);
  }

  function updateDeduction(idx: number, val: string) {
    setPreviewItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const ded = Math.max(0, parseFloat(val) || 0);
        return { ...it, deduction: ded, netPay: Math.max(0, it.baseSalary - ded - it.pendingDeductions) };
      })
    );
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/runs", {
        date: previewDate,
        notes: previewNotes || undefined,
        items: previewItems.map((it) => ({
          employeeId: it.employeeId,
          employeeName: it.employeeName,
          groupName: it.groupName,
          baseSalary: it.baseSalary.toFixed(2),
          deduction: it.deduction.toFixed(2),
          netPay: it.netPay.toFixed(2),
        })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save draft");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      toast({ title: "Draft saved", description: "Payroll saved as draft. Go to History to pay it." });
      setStep(1);
      setSelectedWorkers(new Set());
      setPreviewItems([]);
      setActiveTab("history");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const payRunMutation = useMutation({
    mutationFn: async ({ runId, accountId }: { runId: number; accountId: string }) => {
      const res = await apiRequest("PATCH", `/api/payroll/runs/${runId}`, {
        action: "pay",
        paymentAccountId: parseInt(accountId),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to pay");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      toast({ title: "Payroll paid", description: "Ledger entries created successfully." });
      setPayDialogRun(null);
      setPayAccountId("");
      // Print immediately after paying
      if (payDialogRun) {
        const run = { ...payDialogRun, status: "PAID" };
        setTimeout(() => printRun(run), 300);
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteRunMutation = useMutation({
    mutationFn: async (runId: number) => {
      const res = await apiRequest("DELETE", `/api/payroll/runs/${runId}`, undefined);
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      toast({ title: "Draft deleted" });
      setDeleteRunId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const undoRunMutation = useMutation({
    mutationFn: async (runId: number) => {
      const res = await apiRequest("POST", `/api/payroll/runs/${runId}/undo`, {});
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || "Failed to undo");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      toast({
        title: "Payroll undone",
        description: "Run reversed to draft. Ledger entries and advance deductions removed.",
      });
      setUndoRunId(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const migrateGroupExpensesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/payroll/runs/migrate-group-expenses", {});
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || "Migration failed");
      }
      return res.json() as Promise<{
        migrated: number;
        alreadyCorrect: number;
        noGroups: number;
        noVoucher: number;
        total: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      setMigrateConfirmOpen(false);
      setMigrateResult(data);
    },
    onError: (e: Error) => {
      setMigrateConfirmOpen(false);
      toast({ title: "Migration failed", description: e.message, variant: "destructive" });
    },
  });

  // ── Helpers for the worker-salaries template ──────────────────────────────
  function getRunDateHeaders(runDate: string): string[] {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const base = new Date(runDate + "T00:00:00");
    return Array.from({ length: 10 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}`;
    });
  }

  function getWorkerCodeById(employeeId: number): string {
    return workerById[employeeId]?.code || "";
  }

  interface TemplateRow {
    code: string;
    name: string;
    days: string[];
  }
  function getRunTemplateRows(run: PayrollRun): TemplateRow[] {
    return (run.items || []).map((it) => ({
      code: getWorkerCodeById(it.employeeId),
      name: it.employeeName,
      days: Array<string>(10).fill(""),
    }));
  }

  // ── Print (payroll amounts template) ──────────────────────────────────────
  function printRun(run: PayrollRun) {
    const items = run.items || [];
    const totalBase = items.reduce((s, it) => s + parseFloat(it.baseSalary || "0"), 0);
    const totalDed = items.reduce((s, it) => s + parseFloat(it.deduction || "0"), 0);
    const totalNet = items.reduce((s, it) => s + parseFloat(it.netPay || "0"), 0);
    const hasDed = totalDed > 0;
    const cur = selectedCompany?.currency || "$";
    const fmt = (n: number) =>
      `${cur}\u00A0${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const statusBadge =
      run.status === "PAID"
        ? `<span style="background:#16a34a;color:#fff;font-weight:700;padding:2px 10px;border-radius:4px;font-size:11px">PAID</span>`
        : `<span style="background:#ca8a04;color:#fff;font-weight:700;padding:2px 10px;border-radius:4px;font-size:11px">DRAFT</span>`;

    const TH = (txt: string, align = "right") =>
      `<th style="background:#111;color:#fff;font-weight:700;font-size:10px;padding:6px 8px;text-align:${align};border:1px solid #333;white-space:nowrap">${txt}</th>`;

    const headerCols = [TH("Name", "left"), TH("Group", "left"), TH("Base Salary")];
    if (hasDed) headerCols.push(TH("Deduction"));
    headerCols.push(TH("Net Pay"));

    const bodyRows = items
      .map((it, i) => {
        const bg = i % 2 === 0 ? "#fff" : "#f5f5f5";
        const ded = parseFloat(it.deduction || "0");
        const TD = (txt: string, align = "right", bold = false) =>
          `<td style="border:1px solid #ccc;padding:5px 8px;text-align:${align};background:${bg};font-size:10px;${bold ? "font-weight:700;" : ""}">${txt}</td>`;
        const cells = [
          TD(it.employeeName, "left", true),
          TD(it.groupName || "—", "left"),
          TD(fmt(parseFloat(it.baseSalary || "0"))),
        ];
        if (hasDed) cells.push(TD(ded > 0 ? `<span style="color:#b91c1c">-${fmt(ded)}</span>` : "—"));
        cells.push(TD(`<strong>${fmt(parseFloat(it.netPay || "0"))}</strong>`));
        return `<tr>${cells.join("")}</tr>`;
      })
      .join("");

    const totalCells = [
      `<td colspan="2" style="border:1px solid #333;padding:5px 8px;font-weight:700;font-size:10px;background:#111;color:#fff;text-align:left">Total — ${items.length} worker${items.length !== 1 ? "s" : ""}</td>`,
      `<td style="border:1px solid #333;padding:5px 8px;font-weight:700;font-size:10px;background:#111;color:#fff;text-align:right">${fmt(totalBase)}</td>`,
    ];
    if (hasDed)
      totalCells.push(
        `<td style="border:1px solid #333;padding:5px 8px;font-weight:700;font-size:10px;background:#b91c1c;color:#fff;text-align:right">-${fmt(totalDed)}</td>`
      );
    totalCells.push(
      `<td style="border:1px solid #333;padding:5px 8px;font-weight:700;font-size:11px;background:#16a34a;color:#fff;text-align:right">${fmt(totalNet)}</td>`
    );

    const notesRow = run.notes
      ? `<p style="margin:6px 0 0;font-size:10px;color:#555"><strong>Notes:</strong> ${run.notes}</p>`
      : "";

    const html = `<!DOCTYPE html><html><head><title>Worker Salaries — ${run.date}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:11px;margin:16px;color:#000}
        table{border-collapse:collapse;width:100%}
        @media print{
          @page{size:A4 portrait;margin:12mm}
          .no-print{display:none}
        }
      </style>
      </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <h2 style="margin:0 0 4px;font-size:15px">Worker Salaries</h2>
          <div style="font-size:11px;color:#444"><strong>Date:</strong> ${run.date} &nbsp; ${statusBadge}</div>
          ${notesRow}
        </div>
        <div style="font-size:11px;color:#555;text-align:right">
          <div><strong>Workers:</strong> ${items.length}</div>
          <div style="margin-top:2px;font-size:13px;font-weight:700">Total: ${fmt(totalNet)}</div>
        </div>
      </div>
      <table>
        <thead><tr>${headerCols.join("")}</tr></thead>
        <tbody>${bodyRows}</tbody>
        <tfoot><tr>${totalCells.join("")}</tr></tfoot>
      </table>
      <div class="no-print" style="margin-top:14px;text-align:right">
        <button onclick="window.print()" style="padding:6px 16px;background:#000;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">Print / Save PDF</button>
      </div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  // ── Excel export (payroll amounts) ─────────────────────────────────────────
  async function exportRunExcel(run: PayrollRun) {
    const XLSXStyle = (await import("xlsx-js-style")) as any;
    const XLSX = XLSXStyle.default ?? XLSXStyle;

    const items = run.items || [];
    const hasDed = items.some((it) => parseFloat(it.deduction || "0") > 0);
    const cur = selectedCompany?.currency || "$";
    const fmtN = (n: number) => `${cur} ${n.toFixed(2)}`;

    const thinBlack = { style: "thin", color: { rgb: "000000" } };
    const allBorders = { top: thinBlack, bottom: thinBlack, left: thinBlack, right: thinBlack };

    const hCell = (v: string) => ({
      v,
      t: "s",
      s: {
        fill: { patternType: "solid", fgColor: { rgb: "111111" } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: allBorders,
      },
    });
    const dCell = (v: string, isAlt: boolean, opts?: { bold?: boolean; right?: boolean; color?: string }) => ({
      v,
      t: "s",
      s: {
        fill: { patternType: "solid", fgColor: { rgb: isAlt ? "F5F5F5" : "FFFFFF" } },
        font: { bold: opts?.bold ?? false, color: { rgb: opts?.color ?? "000000" } },
        alignment: { horizontal: opts?.right ? "right" : "left", vertical: "center" },
        border: allBorders,
      },
    });
    const totCell = (v: string, bg: string) => ({
      v,
      t: "s",
      s: {
        fill: { patternType: "solid", fgColor: { rgb: bg } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "right", vertical: "center" },
        border: allBorders,
      },
    });

    const headers = [hCell("Name"), hCell("Group"), hCell("Base Salary")];
    if (hasDed) headers.push(hCell("Deduction"));
    headers.push(hCell("Net Pay"));

    const wsData: any[][] = [headers];

    let totalBase = 0,
      totalDed = 0,
      totalNet = 0;
    items.forEach((it, i) => {
      const isAlt = i % 2 === 1;
      const base = parseFloat(it.baseSalary || "0");
      const ded = parseFloat(it.deduction || "0");
      const net = parseFloat(it.netPay || "0");
      totalBase += base;
      totalDed += ded;
      totalNet += net;
      const row = [
        dCell(it.employeeName, isAlt, { bold: true }),
        dCell(it.groupName || "—", isAlt),
        dCell(fmtN(base), isAlt, { right: true }),
      ];
      if (hasDed)
        row.push(dCell(ded > 0 ? `-${fmtN(ded)}` : "—", isAlt, { right: true, color: ded > 0 ? "B91C1C" : "000000" }));
      row.push(dCell(fmtN(net), isAlt, { bold: true, right: true }));
      wsData.push(row);
    });

    const totRow = [
      totCell(`Total (${items.length} workers)`, "111111"),
      totCell("", "111111"),
      totCell(fmtN(totalBase), "111111"),
    ];
    if (hasDed) totRow.push(totCell(`-${fmtN(totalDed)}`, "B91C1C"));
    totRow.push(totCell(fmtN(totalNet), "16A34A"));
    wsData.push(totRow);

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const colCount = hasDed ? 5 : 4;
    ws["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 13 }, ...(hasDed ? [{ wch: 13 }] : []), { wch: 13 }];
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payroll");
    XLSX.writeFile(wb, `payroll-${run.id}-${run.date}.xlsx`);
  }

  const isLoading = empLoading || groupsLoading;
  const totalSelectedBase = useMemo(
    () => Array.from(selectedWorkers).reduce((s, id) => s + parseFloat(workerById[id]?.monthlySalary || "0"), 0),
    [selectedWorkers, workerById]
  );
  const previewTotalNet = useMemo(() => previewItems.reduce((s, it) => s + it.netPay, 0), [previewItems]);
  const previewTotalBase = useMemo(() => previewItems.reduce((s, it) => s + it.baseSalary, 0), [previewItems]);

  // ── Worker card ────────────────────────────────────────────────────────────
  function renderWorkerCard(worker: Employee) {
    if (!filtered.has(worker.id)) return null;
    const fullName = [worker.firstName, worker.lastName].filter(Boolean).join(" ");
    const isSelected = selectedWorkers.has(worker.id);
    const advanceBalance = advanceBalanceByEmployee[worker.id] || 0;
    const salary = parseFloat(worker.monthlySalary || "0");
    return (
      <div
        key={worker.id}
        className={`cursor-pointer rounded-md transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}
        onClick={() => toggleWorker(worker.id)}
        data-testid={`card-worker-${worker.id}`}
      >
        <Card className={`hover-elevate h-full ${isSelected ? "bg-primary/5" : ""}`}>
          <CardContent className="p-4 flex flex-col h-full">
            <div className="flex items-start justify-between mb-3">
              <Avatar className={`h-12 w-12 text-sm font-semibold ${getAvatarColor(fullName)}`}>
                <AvatarFallback className={getAvatarColor(fullName)}>{getInitials(fullName)}</AvatarFallback>
              </Avatar>
              <Badge variant={worker.active ? "default" : "secondary"} className="text-xs no-default-active-elevate">
                {worker.active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm leading-tight">{fullName}</p>
              {worker.department && <p className="text-xs text-muted-foreground mt-0.5">{worker.department}</p>}
            </div>
            <div className="mt-3 pt-3 border-t space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">{formatAmount(salary)}</span>
              </div>
              {advanceBalance > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <Banknote className="h-3 w-3" />
                    Advance
                  </span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    -{formatAmount(advanceBalance)}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function renderGroup(label: string, memberIds: number[], groupKey: number | string) {
    const visible = memberIds.filter((id) => filtered.has(id) && workerById[id]);
    if (visible.length === 0) return null;
    const isExpanded = expandedGroups[groupKey] ?? true;
    const allSel = visible.every((id) => selectedWorkers.has(id));
    const someSel = visible.some((id) => selectedWorkers.has(id));
    return (
      <div key={groupKey} className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleGroup(groupKey)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
            data-testid={`group-toggle-${groupKey}`}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {label}
            <span className="text-xs font-normal text-muted-foreground">({visible.length})</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-6 px-2"
            onClick={() => toggleGroupSelection(memberIds)}
            data-testid={`group-select-all-${groupKey}`}
          >
            {allSel ? "Deselect all" : someSel ? "Select rest" : "Select all"}
          </Button>
        </div>
        {isExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visible.map((id) => renderWorkerCard(workerById[id]))}
          </div>
        )}
      </div>
    );
  }

  const hasResults = workers.some((w) => filtered.has(w.id));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as any);
          setStep(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="run" data-testid="tab-run-payroll">
            <PlayCircle className="h-4 w-4 mr-2" />
            Run Payroll
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-payroll-history">
            <History className="h-4 w-4 mr-2" />
            Payroll History
            {payrollRuns.filter((r) => r.status === "DRAFT").length > 0 && (
              <Badge variant="outline" className="ml-2 text-xs no-default-active-elevate">
                {payrollRuns.filter((r) => r.status === "DRAFT").length} draft
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Run Payroll ─────────────────────────────────────────── */}
        <TabsContent value="run" className="mt-4">
          {step === 1 ? (
            <>
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-52">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, code, department..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-workers"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">Payroll Date</Label>
                    <Input
                      type="date"
                      value={previewDate}
                      onChange={(e) => setPreviewDate(e.target.value)}
                      className="w-40"
                      data-testid="input-payroll-date"
                    />
                  </div>
                  {selectedWorkers.size > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {selectedWorkers.size} selected — {formatAmount(totalSelectedBase)}
                    </span>
                  )}
                  <Button
                    onClick={enterPreview}
                    disabled={selectedWorkers.size === 0}
                    data-testid="button-preview-payroll"
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    Preview Payroll ({selectedWorkers.size})
                  </Button>
                </div>
              </div>

              {!hasResults ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Users className="mx-auto h-10 w-10 mb-3 opacity-40" />
                  <p className="font-medium">
                    {searchQuery ? "No workers match your search" : "No active workers found"}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {workerGroups.map((group) =>
                    renderGroup(
                      group.name,
                      (group.members || []).map((m) => m.id),
                      group.id
                    )
                  )}
                  {ungroupedWorkers.filter((w) => filtered.has(w.id)).length > 0 &&
                    renderGroup(
                      "Ungrouped",
                      ungroupedWorkers.map((w) => w.id),
                      "ungrouped"
                    )}
                </div>
              )}
            </>
          ) : (
            /* ── Step 2: Preview & Save as Draft ───────────────────────── */
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)} data-testid="button-back-to-select">
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                  <h3 className="font-semibold text-sm">
                    Payroll Preview — {previewItems.length} worker{previewItems.length !== 1 ? "s" : ""}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => saveDraftMutation.mutate()}
                    disabled={saveDraftMutation.isPending || previewTotalNet <= 0}
                    data-testid="button-save-draft"
                  >
                    {saveDraftMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Save as Draft
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Date + Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Payroll Date</Label>
                  <Input
                    type="date"
                    value={previewDate}
                    onChange={(e) => setPreviewDate(e.target.value)}
                    data-testid="input-preview-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Input
                    placeholder="e.g. March 2026 payroll"
                    value={previewNotes}
                    onChange={(e) => setPreviewNotes(e.target.value)}
                    data-testid="input-preview-notes"
                  />
                </div>
              </div>

              {/* Preview table */}
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead className="text-muted-foreground text-xs font-medium">Group</TableHead>
                      <TableHead className="text-right">Base Salary</TableHead>
                      <TableHead className="text-right w-40">Advance Deduction</TableHead>
                      <TableHead className="text-right">Deductions</TableHead>
                      <TableHead className="text-right">Net Pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewItems.map((it, idx) => {
                      const advBal = advanceBalanceByEmployee[it.employeeId] || 0;
                      return (
                        <TableRow key={idx} data-testid={`row-preview-${it.employeeId}`}>
                          <TableCell className="font-medium text-sm">{it.employeeName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{it.groupName}</TableCell>
                          <TableCell className="text-right text-sm">{formatAmount(it.baseSalary)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                type="number"
                                min="0"
                                max={String(it.baseSalary)}
                                step="0.01"
                                placeholder="0.00"
                                className="h-8 text-sm w-28 text-right"
                                value={it.deduction === 0 ? "" : it.deduction}
                                onChange={(e) => updateDeduction(idx, e.target.value)}
                                data-testid={`input-deduction-${it.employeeId}`}
                              />
                              {advBal > 0 &&
                                (() => {
                                  const remaining = advBal - it.deduction;
                                  return remaining > 0.005 ? (
                                    <span className="text-xs text-amber-600 dark:text-amber-400">
                                      Remaining: {formatAmount(remaining)}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-green-600 dark:text-green-400">Fully deducted</span>
                                  );
                                })()}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {it.pendingDeductions > 0 ? (
                              <span className="text-orange-600 dark:text-orange-400 font-mono">
                                -{formatAmount(it.pendingDeductions)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell
                            className="text-right font-semibold text-sm"
                            data-testid={`text-net-${it.employeeId}`}
                          >
                            {formatAmount(it.netPay)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-6 text-sm text-muted-foreground px-1">
                <span>
                  Total Base: <span className="font-semibold text-foreground">{formatAmount(previewTotalBase)}</span>
                </span>
                <span>
                  Net Payable: <span className="font-semibold text-foreground">{formatAmount(previewTotalNet)}</span>
                </span>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 2: Payroll History ──────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          {runsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </div>
          ) : payrollRuns.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <History className="mx-auto h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">No payroll runs yet</p>
              <p className="text-sm mt-1">Select workers and run a payroll to get started.</p>
            </div>
          ) : (
            <>
              {isDeveloper && (
                <div className="flex justify-end mb-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMigrateConfirmOpen(true)}
                    disabled={migrateGroupExpensesMutation.isPending}
                    data-testid="button-migrate-group-expenses"
                  >
                    {migrateGroupExpensesMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    )}
                    Fix Historical Runs
                  </Button>
                </div>
              )}
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Workers</TableHead>
                      <TableHead className="text-right">Total Base</TableHead>
                      <TableHead className="text-right">Net Payable</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollRuns.map((run) => (
                      <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                        <TableCell className="font-medium text-sm">{run.date}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                          {run.notes || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm">{run.itemCount}</TableCell>
                        <TableCell className="text-right text-sm">{formatAmount(parseFloat(run.totalBase))}</TableCell>
                        <TableCell className="text-right font-semibold text-sm">
                          {formatAmount(parseFloat(run.totalNet))}
                        </TableCell>
                        <TableCell>
                          {run.status === "PAID" ? (
                            <Badge
                              variant="secondary"
                              className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 no-default-active-elevate"
                            >
                              Paid
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 no-default-active-elevate"
                            >
                              Draft
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => printRun(run)}
                              title="Print / PDF"
                              data-testid={`button-print-run-${run.id}`}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => exportRunExcel(run)}
                              title="Export Excel"
                              data-testid={`button-excel-run-${run.id}`}
                            >
                              <FileSpreadsheet className="h-4 w-4" />
                            </Button>
                            {run.status === "DRAFT" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setPayDialogRun(run);
                                    setPayAccountId("");
                                  }}
                                  data-testid={`button-pay-run-${run.id}`}
                                >
                                  <DollarSign className="h-3.5 w-3.5 mr-1" />
                                  Pay
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeleteRunId(run.id)}
                                  className="text-destructive"
                                  title="Delete draft"
                                  data-testid={`button-delete-run-${run.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {run.status === "PAID" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUndoRunId(run.id)}
                                className="text-destructive"
                                title="Undo payroll — reverses ledger entries and advance deductions"
                                data-testid={`button-undo-run-${run.id}`}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Pay Dialog ─────────────────────────────────────────────────────── */}
      <Dialog
        open={!!payDialogRun}
        onOpenChange={(open) => {
          if (!open) setPayDialogRun(null);
        }}
      >
        <DialogContent className="max-w-lg" data-testid="dialog-pay-run">
          <DialogHeader>
            <DialogTitle>Pay Payroll Draft</DialogTitle>
            <DialogDescription>
              This will create ledger entries and mark the payroll as paid. Net total:{" "}
              <strong>{payDialogRun ? formatAmount(parseFloat(payDialogRun.totalNet)) : ""}</strong>
            </DialogDescription>
          </DialogHeader>

          {payDialogRun && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-muted/40 px-4 py-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{payDialogRun.date}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Workers</span>
                  <span className="font-medium">{payDialogRun.itemCount}</span>
                </div>
                {payDialogRun.notes && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Notes</span>
                    <span className="font-medium">{payDialogRun.notes}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Payment Account (Cash)</Label>
                <Select value={payAccountId} onValueChange={setPayAccountId}>
                  <SelectTrigger data-testid="select-pay-account">
                    <SelectValue placeholder="Select cash account" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccounts.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        No cash accounts found
                      </SelectItem>
                    ) : (
                      cashAccounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Worker breakdown */}
              <div className="border rounded-md overflow-hidden max-h-56 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Worker</TableHead>
                      <TableHead className="text-right text-xs">Base</TableHead>
                      <TableHead className="text-right text-xs">Deduction</TableHead>
                      <TableHead className="text-right text-xs">Net Pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(payDialogRun.items || []).map((it, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm py-2">{it.employeeName}</TableCell>
                        <TableCell className="text-right text-sm py-2">
                          {formatAmount(parseFloat(it.baseSalary))}
                        </TableCell>
                        <TableCell className="text-right text-sm py-2 text-amber-600 dark:text-amber-400">
                          {parseFloat(it.deduction) > 0 ? `-${formatAmount(parseFloat(it.deduction))}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm py-2 font-semibold">
                          {formatAmount(parseFloat(it.netPay))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayDialogRun(null)} data-testid="button-cancel-pay">
              Cancel
            </Button>
            <Button
              onClick={() => payDialogRun && payRunMutation.mutate({ runId: payDialogRun.id, accountId: payAccountId })}
              disabled={payRunMutation.isPending || !payAccountId}
              data-testid="button-confirm-pay"
            >
              {payRunMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Confirm Payment
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ─────────────────────────────────────────────── */}
      <AlertDialog
        open={!!deleteRunId}
        onOpenChange={(open) => {
          if (!open) setDeleteRunId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft payroll run will be permanently deleted. No ledger entries were created for it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRunId && deleteRunMutation.mutate(deleteRunId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteRunMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Undo Confirmation ───────────────────────────────────────────────── */}
      <AlertDialog
        open={!!undoRunId}
        onOpenChange={(open) => {
          if (!open) setUndoRunId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Payroll Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reverse the payroll payment — the ledger entries (salary expense and cash) will be removed, any
              advance deductions applied during this payroll will be restored, and the run will go back to draft status.
              This cannot be undone automatically; you will need to re-pay the run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => undoRunId && undoRunMutation.mutate(undoRunId)}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-undo"
            >
              {undoRunMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Undo Payroll"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Migrate Confirmation ─────────────────────────────────────────────── */}
      <AlertDialog
        open={migrateConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setMigrateConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix Historical Payroll Runs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will scan all paid payroll runs and re-post any that used the old single "Salary Expense" account.
              They will be split into per-group expense accounts (e.g. "Kolwezi Worker Payroll Expense") based on the
              worker groups recorded in each run. The old accounting entries will be replaced — totals stay the same,
              only the expense account breakdown changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => migrateGroupExpensesMutation.mutate()}
              data-testid="button-confirm-migrate"
            >
              {migrateGroupExpensesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fix Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Migrate Result ───────────────────────────────────────────────────── */}
      <AlertDialog
        open={!!migrateResult}
        onOpenChange={(open) => {
          if (!open) setMigrateResult(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {migrateResult && migrateResult.migrated > 0 ? "Runs Updated" : "Check Complete"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {migrateResult && (
                  <>
                    {migrateResult.total === 0 && <p>No paid payroll runs found for this company.</p>}
                    {migrateResult.migrated > 0 && (
                      <p className="text-green-700 dark:text-green-400">
                        <strong>{migrateResult.migrated}</strong> run{migrateResult.migrated !== 1 ? "s" : ""}{" "}
                        successfully updated to use per-group expense accounts.
                      </p>
                    )}
                    {migrateResult.alreadyCorrect > 0 && (
                      <p>
                        <strong>{migrateResult.alreadyCorrect}</strong> run
                        {migrateResult.alreadyCorrect !== 1 ? "s" : ""} already using per-group expense accounts
                        correctly — no changes needed.
                      </p>
                    )}
                    {migrateResult.noGroups > 0 && (
                      <p className="text-muted-foreground">
                        <strong>{migrateResult.noGroups}</strong> run{migrateResult.noGroups !== 1 ? "s" : ""} have
                        workers with no group assigned — kept as single "Salary Expense" account.
                      </p>
                    )}
                    {migrateResult.noVoucher > 0 && (
                      <p className="text-muted-foreground">
                        <strong>{migrateResult.noVoucher}</strong> run{migrateResult.noVoucher !== 1 ? "s" : ""} had no
                        payment voucher found — skipped.
                      </p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setMigrateResult(null)} data-testid="button-close-migrate-result">
              Done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
