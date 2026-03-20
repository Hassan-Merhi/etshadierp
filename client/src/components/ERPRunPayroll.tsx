import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, Search, ChevronDown, ChevronRight, DollarSign, Loader2, PlayCircle, Banknote, Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

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
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
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
  status: string;
}

export default function ERPRunPayroll() {
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<number | string, boolean>>({});
  const [selectedWorkers, setSelectedWorkers] = useState<Set<number>>(new Set());
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payAccountId, setPayAccountId] = useState("");
  const [payNotes, setPayNotes] = useState("");
  // advanceOverrides: employeeId → deduction amount string
  const [advanceOverrides, setAdvanceOverrides] = useState<Record<number, string>>({});

  const { data: allEmployees, isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: workerGroupsRaw = [], isLoading: groupsLoading } = useQuery<WorkerGroup[]>({
    queryKey: ["/api/worker-groups/with-members"],
    queryFn: async () => {
      const res = await fetch("/api/worker-groups/with-members", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: ledgerAccounts = [] } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/ledger-accounts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: salaryAdvances = [] } = useQuery<SalaryAdvance[]>({
    queryKey: ["/api/salary-advances"],
    queryFn: async () => {
      const res = await fetch("/api/salary-advances", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const cashAccounts = useMemo(
    () => ledgerAccounts.filter((a) => a.accountType === "Cash"),
    [ledgerAccounts],
  );

  const workers = useMemo(
    () => (allEmployees || []).filter((e) => e.employeeType === "Worker" && e.active),
    [allEmployees],
  );

  const workerGroups = useMemo(
    () => workerGroupsRaw.filter((g: any) => {
      const type = g.groupType || g.group_type;
      return !type || type === "Worker";
    }),
    [workerGroupsRaw],
  );

  // Outstanding advance balance per employee
  const advanceBalanceByEmployee = useMemo(() => {
    const map: Record<number, number> = {};
    for (const adv of salaryAdvances) {
      if (adv.status === "Active" || adv.status === "active" || adv.status === "Partial") {
        const bal = parseFloat(adv.remainingBalance || "0");
        if (bal > 0) {
          map[adv.employeeId] = (map[adv.employeeId] || 0) + bal;
        }
      }
    }
    return map;
  }, [salaryAdvances]);

  const workerMemberships = useMemo(() => {
    const map: Record<number, number[]> = {};
    for (const g of workerGroups) {
      for (const m of g.members || []) {
        if (!map[m.id]) map[m.id] = [];
        map[m.id].push(g.id);
      }
    }
    return map;
  }, [workerGroups]);

  const ungroupedWorkers = useMemo(
    () => workers.filter((w) => !(workerMemberships[w.id]?.length)),
    [workers, workerMemberships],
  );

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return new Set(workers.map((w) => w.id));
    const q = searchQuery.toLowerCase();
    return new Set(
      workers
        .filter((w) => `${w.firstName} ${w.lastName}`.toLowerCase().includes(q) || w.code?.toLowerCase().includes(q) || (w.department || "").toLowerCase().includes(q))
        .map((w) => w.id),
    );
  }, [workers, searchQuery]);

  const workerById = useMemo(() => {
    const map: Record<number, Employee> = {};
    for (const w of workers) map[w.id] = w;
    return map;
  }, [workers]);

  function toggleGroup(key: number | string) {
    setExpandedGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }

  function toggleWorker(id: number) {
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function toggleGroupSelection(memberIds: number[]) {
    const visibleIds = memberIds.filter((id) => filtered.has(id));
    const allSelected = visibleIds.every((id) => selectedWorkers.has(id));
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      if (allSelected) { visibleIds.forEach((id) => next.delete(id)); }
      else { visibleIds.forEach((id) => next.add(id)); }
      return next;
    });
  }

  function openPayDialog() {
    // Initialize advance overrides: default to full outstanding balance
    const overrides: Record<number, string> = {};
    for (const id of selectedWorkers) {
      const balance = advanceBalanceByEmployee[id] || 0;
      overrides[id] = balance.toFixed(2);
    }
    setAdvanceOverrides(overrides);
    setPayDialogOpen(true);
  }

  // Net pay per worker = salary - advance deduction
  function getNetPay(id: number): number {
    const w = workerById[id];
    const salary = parseFloat(w?.monthlySalary || "0");
    const deduction = parseFloat(advanceOverrides[id] || "0");
    return Math.max(0, salary - deduction);
  }

  const totalPayable = useMemo(() => {
    return Array.from(selectedWorkers).reduce((s, id) => s + getNetPay(id), 0);
  }, [selectedWorkers, advanceOverrides, workerById]);

  interface PayrollRow {
    group: string;
    name: string;
    base: number;
    deduction: number;
    net: number;
    isGroupTotal?: boolean;
    isGrandTotal?: boolean;
  }

  function buildPayrollData(): PayrollRow[] {
    const rows: PayrollRow[] = [];
    function addGroup(label: string, memberIds: number[]) {
      const members = memberIds.filter((id) => workerById[id]);
      if (members.length === 0) return;
      let groupBase = 0, groupDeduction = 0, groupNet = 0;
      for (const id of members) {
        const w = workerById[id];
        const salary = parseFloat(w.monthlySalary || "0");
        const advanceBal = advanceBalanceByEmployee[id] || 0;
        const deduction = Math.min(advanceBal, salary);
        const net = Math.max(0, salary - deduction);
        groupBase += salary; groupDeduction += deduction; groupNet += net;
        rows.push({ group: label, name: `${w.firstName} ${w.lastName}`.trim(), base: salary, deduction, net });
      }
      rows.push({ group: label, name: `${label} — TOTAL`, base: groupBase, deduction: groupDeduction, net: groupNet, isGroupTotal: true });
    }
    for (const group of workerGroups) addGroup(group.name, (group.members || []).map((m) => m.id));
    if (ungroupedWorkers.length > 0) addGroup("Ungrouped", ungroupedWorkers.map((w) => w.id));
    const allBase = rows.filter((r) => r.isGroupTotal).reduce((s, r) => s + r.base, 0);
    const allDed = rows.filter((r) => r.isGroupTotal).reduce((s, r) => s + r.deduction, 0);
    const allNet = rows.filter((r) => r.isGroupTotal).reduce((s, r) => s + r.net, 0);
    rows.push({ group: "", name: "GRAND TOTAL", base: allBase, deduction: allDed, net: allNet, isGrandTotal: true });
    return rows;
  }

  async function exportExcel() {
    const XLSXStyle = await import("xlsx-js-style");
    const XLSX = XLSXStyle.default || XLSXStyle;
    const data = buildPayrollData();
    const dateStr = new Date().toLocaleDateString();

    const wsData: any[][] = [
      ["Payroll Report", "", "", "", dateStr],
      [],
      ["Group", "Worker", "Base Salary", "Advance Deduction", "Net Pay"],
    ];

    for (const row of data) {
      wsData.push([row.group, row.name, row.base, row.deduction, row.net]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws["!cols"] = [{ wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 20 }, { wch: 16 }];

    // Style helpers
    const headerFill = { fgColor: { rgb: "1E3A5F" } };
    const groupTotalFill = { fgColor: { rgb: "D6E4F0" } };
    const grandTotalFill = { fgColor: { rgb: "1E3A5F" } };
    const altFill = { fgColor: { rgb: "F4F8FC" } };
    const white = { fgColor: { rgb: "FFFFFF" } };

    const bold = { bold: true };
    const boldWhite = { bold: true, color: { rgb: "FFFFFF" } };
    const numFmt = "#,##0.00";

    // Title row
    const titleCell = ws["A1"];
    if (titleCell) {
      titleCell.s = { font: { bold: true, sz: 14, color: { rgb: "1E3A5F" } }, alignment: { horizontal: "left" } };
    }

    // Header row (row index 2 = row 3 in 1-based)
    ["A3", "B3", "C3", "D3", "E3"].forEach((addr) => {
      if (!ws[addr]) ws[addr] = { v: "" };
      ws[addr].s = {
        font: boldWhite,
        fill: headerFill,
        alignment: { horizontal: addr === "A3" || addr === "B3" ? "left" : "right" },
        border: { bottom: { style: "thin", color: { rgb: "FFFFFF" } } },
      };
    });

    // Data rows start at row 4 (index 3)
    let excelRow = 4;
    let altToggle = false;
    for (const row of data) {
      const cols = ["A", "B", "C", "D", "E"];
      const isTotal = row.isGroupTotal || row.isGrandTotal;
      const fill = row.isGrandTotal ? grandTotalFill : row.isGroupTotal ? groupTotalFill : altToggle ? altFill : white;
      const fontColor = row.isGrandTotal ? { color: { rgb: "FFFFFF" } } : {};

      cols.forEach((col, i) => {
        const addr = `${col}${excelRow}`;
        if (!ws[addr]) ws[addr] = { v: "" };
        const isNum = i >= 2;
        ws[addr].s = {
          font: { ...(isTotal ? bold : {}), ...fontColor },
          fill,
          numFmt: isNum ? numFmt : undefined,
          alignment: { horizontal: isNum ? "right" : "left" },
        };
        if (isNum && ws[addr].v !== undefined) ws[addr].t = "n";
      });

      if (!isTotal) altToggle = !altToggle;
      else altToggle = false;
      excelRow++;
    }

    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: excelRow - 1, c: 4 } });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payroll");
    XLSX.writeFile(wb, `payroll-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function exportPDF() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const data = buildPayrollData();
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const dateStr = new Date().toLocaleDateString();
    const primaryBlue = [30, 58, 95] as [number, number, number];
    const lightBlue = [214, 228, 240] as [number, number, number];

    // Title
    doc.setFontSize(18);
    doc.setTextColor(...primaryBlue);
    doc.setFont("helvetica", "bold");
    doc.text("Payroll Report", 14, 18);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(dateStr, 14, 25);

    // Build table body — insert group label rows
    const body: any[] = [];
    let currentGroup = "";
    for (const row of data) {
      if (!row.isGrandTotal && row.group && row.group !== currentGroup && !row.isGroupTotal) {
        currentGroup = row.group;
        body.push([{ content: row.group, colSpan: 5, styles: { fillColor: primaryBlue, textColor: 255, fontStyle: "bold", fontSize: 9 } }]);
      }
      if (row.isGrandTotal) {
        body.push([
          { content: "GRAND TOTAL", colSpan: 2, styles: { fillColor: primaryBlue, textColor: 255, fontStyle: "bold", halign: "left" } },
          { content: row.base.toFixed(2), styles: { fillColor: primaryBlue, textColor: 255, fontStyle: "bold", halign: "right" } },
          { content: row.deduction.toFixed(2), styles: { fillColor: primaryBlue, textColor: 255, fontStyle: "bold", halign: "right" } },
          { content: row.net.toFixed(2), styles: { fillColor: primaryBlue, textColor: 255, fontStyle: "bold", halign: "right" } },
        ]);
      } else if (row.isGroupTotal) {
        body.push([
          { content: "", styles: { fillColor: lightBlue } },
          { content: `${row.group} Total`, styles: { fillColor: lightBlue, fontStyle: "bold" } },
          { content: row.base.toFixed(2), styles: { fillColor: lightBlue, fontStyle: "bold", halign: "right" } },
          { content: row.deduction.toFixed(2), styles: { fillColor: lightBlue, fontStyle: "bold", halign: "right" } },
          { content: row.net.toFixed(2), styles: { fillColor: lightBlue, fontStyle: "bold", halign: "right" } },
        ]);
      } else {
        body.push([
          { content: "", styles: { halign: "center" } },
          row.name,
          { content: row.base.toFixed(2), styles: { halign: "right" } },
          { content: row.deduction > 0 ? `-${row.deduction.toFixed(2)}` : "—", styles: { halign: "right", textColor: row.deduction > 0 ? [180, 100, 0] : [150, 150, 150] } },
          { content: row.net.toFixed(2), styles: { halign: "right", fontStyle: "bold" } },
        ]);
      }
    }

    autoTable(doc, {
      startY: 30,
      head: [[
        { content: "#", styles: { halign: "center" } },
        "Worker",
        { content: "Base Salary", styles: { halign: "right" } },
        { content: "Deduction", styles: { halign: "right" } },
        { content: "Net Pay", styles: { halign: "right" } },
      ]],
      body,
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 70 },
        2: { cellWidth: 32, halign: "right" },
        3: { cellWidth: 32, halign: "right" },
        4: { cellWidth: 32, halign: "right" },
      },
      headStyles: { fillColor: primaryBlue, textColor: 255, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
      styles: { cellPadding: 2.5 },
    });

    doc.save(`payroll-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  const totalSelected = useMemo(() => {
    return Array.from(selectedWorkers).reduce((s, id) => {
      return s + parseFloat(workerById[id]?.monthlySalary || "0");
    }, 0);
  }, [selectedWorkers, workerById]);

  const payMutation = useMutation({
    mutationFn: async () => {
      const payments = Array.from(selectedWorkers)
        .map((id) => ({ workerId: id, amount: fmt(getNetPay(id)) }))
        .filter((p) => parseFloat(p.amount) > 0);
      if (!payAccountId) throw new Error("Please select a payment account");
      if (payments.length === 0) throw new Error("No workers with valid amounts");
      const res = await apiRequest("POST", "/api/payroll/bulk-pay-workers", {
        payments,
        paymentAccountId: parseInt(payAccountId),
        date: payDate,
        notes: payNotes || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to process payroll");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/worker-payments-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      toast({ title: "Payroll processed", description: `${selectedWorkers.size} worker(s) paid successfully` });
      setPayDialogOpen(false);
      setSelectedWorkers(new Set());
      setAdvanceOverrides({});
      setPayNotes("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const isLoading = empLoading || groupsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-md" />)}
        </div>
      </div>
    );
  }

  function renderWorkerCard(worker: Employee) {
    if (!filtered.has(worker.id)) return null;
    const fullName = `${worker.firstName} ${worker.lastName}`.trim();
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
                <AvatarFallback className={getAvatarColor(fullName)}>
                  {getInitials(fullName)}
                </AvatarFallback>
              </Avatar>
              <Badge
                variant={worker.active ? "default" : "secondary"}
                className="text-xs no-default-active-elevate"
                data-testid={`badge-status-${worker.id}`}
              >
                {worker.active ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm leading-tight" data-testid={`text-name-${worker.id}`}>
                {fullName}
              </p>
              {worker.department && (
                <p className="text-xs text-muted-foreground mt-0.5">{worker.department}</p>
              )}
            </div>
            <div className="mt-3 pt-3 border-t space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">{worker.code || "—"}</span>
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
    const visibleMembers = memberIds.filter((id) => filtered.has(id) && workerById[id]);
    if (visibleMembers.length === 0) return null;
    const isExpanded = expandedGroups[groupKey] ?? true;
    const allSelected = visibleMembers.every((id) => selectedWorkers.has(id));
    const someSelected = visibleMembers.some((id) => selectedWorkers.has(id));
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
            <span className="text-xs font-normal text-muted-foreground">({visibleMembers.length})</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-6 px-2"
            onClick={() => toggleGroupSelection(memberIds)}
            data-testid={`group-select-all-${groupKey}`}
          >
            {allSelected ? "Deselect all" : someSelected ? "Select rest" : "Select all"}
          </Button>
        </div>
        {isExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleMembers.map((id) => renderWorkerCard(workerById[id]))}
          </div>
        )}
      </div>
    );
  }

  const hasResults = workers.some((w) => filtered.has(w.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
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
        <div className="flex items-center gap-2">
          {selectedWorkers.size > 0 && (
            <span className="text-sm text-muted-foreground">
              {selectedWorkers.size} selected — {formatAmount(totalSelected)}
            </span>
          )}
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={workers.length === 0}
            data-testid="button-export-excel"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button
            variant="outline"
            onClick={exportPDF}
            disabled={workers.length === 0}
            data-testid="button-export-pdf"
          >
            <FileText className="h-4 w-4 mr-2" />
            PDF
          </Button>
          <Button
            onClick={openPayDialog}
            disabled={selectedWorkers.size === 0}
            data-testid="button-run-payroll"
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            Pay Selected ({selectedWorkers.size})
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
              group.id,
            ),
          )}
          {ungroupedWorkers.filter((w) => filtered.has(w.id)).length > 0 &&
            renderGroup("Ungrouped", ungroupedWorkers.map((w) => w.id), "ungrouped")}
        </div>
      )}

      <Dialog open={payDialogOpen} onOpenChange={(open) => { if (!open) setPayDialogOpen(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-run-payroll">
          <DialogHeader>
            <DialogTitle>Process Payroll</DialogTitle>
            <DialogDescription>
              Review advances and confirm net pay for {selectedWorkers.size} worker(s). Net total: {formatAmount(totalPayable)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  data-testid="input-pay-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Account</Label>
                <Select value={payAccountId} onValueChange={setPayAccountId}>
                  <SelectTrigger data-testid="select-pay-account">
                    <SelectValue placeholder="Select cash account" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccounts.length === 0 ? (
                      <SelectItem value="__none" disabled>No cash accounts found</SelectItem>
                    ) : cashAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="e.g. March 2026 payroll"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                className="resize-none"
                rows={2}
                data-testid="input-pay-notes"
              />
            </div>

            <div className="space-y-2">
              <Label>Workers & Net Pay</Label>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Worker</TableHead>
                      <TableHead className="text-right">Base Salary</TableHead>
                      <TableHead className="text-right">Advance Deduction</TableHead>
                      <TableHead className="text-right">Net Pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(selectedWorkers).map((id) => {
                      const w = workerById[id];
                      if (!w) return null;
                      const fullName = `${w.firstName} ${w.lastName}`.trim();
                      const salary = parseFloat(w.monthlySalary || "0");
                      const advanceBalance = advanceBalanceByEmployee[id] || 0;
                      const deduction = parseFloat(advanceOverrides[id] || "0");
                      const netPay = Math.max(0, salary - deduction);
                      return (
                        <TableRow key={id} data-testid={`row-pay-worker-${id}`}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{fullName}</p>
                              {w.department && <p className="text-xs text-muted-foreground">{w.department}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatAmount(salary)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                type="number"
                                min="0"
                                max={String(advanceBalance)}
                                step="0.01"
                                placeholder="0.00"
                                className="h-8 text-sm w-28 text-right"
                                value={advanceOverrides[id] || ""}
                                onChange={(e) => setAdvanceOverrides((prev) => ({ ...prev, [id]: e.target.value }))}
                                data-testid={`input-advance-deduction-${id}`}
                              />
                              {advanceBalance > 0 && (
                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                  Outstanding: {formatAmount(advanceBalance)}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-sm" data-testid={`text-net-pay-${id}`}>
                            {formatAmount(netPay)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-6 text-xs text-muted-foreground px-1">
                <span>Total Base: <span className="font-semibold text-foreground">{formatAmount(totalSelected)}</span></span>
                <span>Net Payable: <span className="font-semibold text-foreground">{formatAmount(totalPayable)}</span></span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayDialogOpen(false)} data-testid="button-cancel-pay">
              Cancel
            </Button>
            <Button
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending || !payAccountId || totalPayable <= 0}
              data-testid="button-confirm-pay"
            >
              {payMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processing...</>
              ) : (
                <><DollarSign className="h-4 w-4 mr-2" />Process Payroll</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
