import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Download, FileText, DollarSign, Users, Calendar, Loader2, Edit, Upload, Table2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormat } from "@/contexts/DateFormatContext";

interface PayrollRecord {
  id: number;
  companyId: number;
  workerId: number;
  periodStart: string;
  periodEnd: string;
  baseSalary: string;
  baleEarnings: string;
  kgEarnings: string;
  overtimePay: string;
  bonuses: string;
  deductions: string;
  advances: string;
  netSalary: string;
  balesCount: number;
  kgProcessed: string;
  overtimeHours: string;
  status: string;
  notes: string | null;
  workerName: string;
  workerCode: string;
  workerPosition: string;
  workerSalaryType: string;
  workerDepartment: string;
}

interface Company {
  id: number;
  code: string;
  name: string;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "DRAFT":
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" data-testid={`badge-status-${status}`}>DRAFT</Badge>;
    case "APPROVED":
      return <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" data-testid={`badge-status-${status}`}>APPROVED</Badge>;
    case "PAID":
      return <Badge variant="secondary" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" data-testid={`badge-status-${status}`}>PAID</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-status-${status}`}>{status}</Badge>;
  }
}

export default function FactoryPayrollPage() {
  const { toast } = useToast();
  const today = new Date().toLocaleDateString('en-CA');
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');

  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const { data: myAccess } = useQuery<any>({ queryKey: ["/api/factory/my-access"], staleTime: 60000 });
  const hiddenTabs = myAccess?.hiddenCostFields ?? [];

  const showWorkerMaster = settings?.payrollTabWorkerMasterEnabled !== false && !hiddenTabs.includes("hide_tab_payroll_worker_master");

  const [companyId, setCompanyId] = useState<number | null>(null);
  const [filterStartDate, setFilterStartDate] = useState(thirtyDaysAgo);
  const [filterEndDate, setFilterEndDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [genStartDate, setGenStartDate] = useState(thirtyDaysAgo);
  const [genEndDate, setGenEndDate] = useState(today);

  const [editRecord, setEditRecord] = useState<PayrollRecord | null>(null);
  const [editBonuses, setEditBonuses] = useState("");
  const [editDeductions, setEditDeductions] = useState("");
  const [editAdvances, setEditAdvances] = useState("");
  const [editOvertimeHours, setEditOvertimeHours] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("DRAFT");

  const [showPayDialog, setShowPayDialog] = useState(false);
  const [paySource, setPaySource] = useState("Cash");
  const [payDate, setPayDate] = useState(today);
  const [payReference, setPayReference] = useState("");

  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const [workerSearch, setWorkerSearch] = useState("");
  const [workerImporting, setWorkerImporting] = useState(false);
  const workerFileInput = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/user/companies"],
  });

  const firstCompanyId = companies.length > 0 ? companies[0].id : null;
  const selectedCompanyId = companyId ?? firstCompanyId;

  useEffect(() => {
    if (companies.length === 1 && companyId === null) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const payrollQueryParams = new URLSearchParams();
  if (selectedCompanyId) payrollQueryParams.set("companyId", String(selectedCompanyId));
  if (filterStartDate) payrollQueryParams.set("startDate", filterStartDate);
  if (filterEndDate) payrollQueryParams.set("endDate", filterEndDate);
  if (statusFilter !== "ALL") payrollQueryParams.set("status", statusFilter);
  const payrollUrl = `/api/factory/payroll?${payrollQueryParams.toString()}`;

  const { formatDisplayDate } = useDateFormat();

  const { data: allWorkers = [], isLoading: workersLoading } = useQuery<any[]>({
    queryKey: ["/api/factory/workers", selectedCompanyId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers?companyId=${selectedCompanyId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const filteredWorkers = useMemo(() => {
    if (!workerSearch.trim()) return allWorkers;
    const q = workerSearch.toLowerCase();
    return allWorkers.filter((w: any) =>
      (w.fullName || "").toLowerCase().includes(q) ||
      (w.employeeCode || "").toLowerCase().includes(q) ||
      (w.phone1 || "").toLowerCase().includes(q) ||
      (w.position || "").toLowerCase().includes(q)
    );
  }, [allWorkers, workerSearch]);

  const handleWorkerImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCompanyId) return;
    setWorkerImporting(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("companyId", String(selectedCompanyId));
    try {
      const res = await fetch("/api/factory/workers/import-excel", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Import failed");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", selectedCompanyId] });
      toast({ title: "Import complete", description: `Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped}` });
      if (data.errors?.length) console.warn("Import errors:", data.errors);
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setWorkerImporting(false);
      if (workerFileInput.current) workerFileInput.current.value = "";
    }
  };

  const { data: payrollRecords = [], isLoading, isError } = useQuery<PayrollRecord[]>({
    queryKey: ["/api/factory/payroll", selectedCompanyId, filterStartDate, filterEndDate, statusFilter],
    queryFn: async () => {
      const res = await fetch(payrollUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payroll data");
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const generateMutation = useMutation({
    mutationFn: async (data: { companyId: number; startDate: string; endDate: string }) => {
      const res = await factoryApiRequest("POST", "/api/factory/payroll/generate", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payroll"] });
      setShowGenerateDialog(false);
      toast({ title: "Payroll generated", description: `${data.length} payroll records created.` });
    },
    onError: (e: any) => {
      if (e?._handledGlobally) return;
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/payroll/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payroll"] });
      setEditRecord(null);
      setShowPayDialog(false);
      toast({ title: "Payroll updated" });
    },
    onError: (e: any) => {
      if (e?._handledGlobally) return;
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const openEditDialog = (record: PayrollRecord) => {
    setEditRecord(record);
    setEditBonuses(record.bonuses || "0");
    setEditDeductions(record.deductions || "0");
    setEditAdvances(record.advances || "0");
    setEditOvertimeHours(record.overtimeHours || "0");
    setEditNotes(record.notes || "");
    setEditStatus(record.status);
  };

  const handleAdjustSubmit = () => {
    if (!editRecord) return;
    if (editStatus === "PAID" && editRecord.status !== "PAID") {
      setPayDate(today);
      setPaySource("Cash");
      setPayReference("");
      setShowPayDialog(true);
      return;
    }
    adjustMutation.mutate({
      id: editRecord.id,
      data: {
        bonuses: editBonuses,
        deductions: editDeductions,
        advances: editAdvances,
        overtimeHours: editOvertimeHours,
        notes: editNotes,
        status: editStatus,
      },
    });
  };

  const handleConfirmPayment = () => {
    if (!editRecord) return;
    adjustMutation.mutate({
      id: editRecord.id,
      data: {
        bonuses: editBonuses,
        deductions: editDeductions,
        advances: editAdvances,
        overtimeHours: editOvertimeHours,
        notes: editNotes,
        status: "PAID",
        paymentSource: paySource,
        paymentDate: payDate,
        paymentReference: payReference,
      },
    });
  };

  const handleExportPdf = async () => {
    if (!selectedCompanyId) return;
    if (!navigator.onLine) { window.print(); return; }
    setExportingPdf(true);
    try {
      const res = await fetch("/api/factory/payroll/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, startDate: filterStartDate, endDate: filterEndDate }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-${filterStartDate}-${filterEndDate}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF exported" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportExcel = async () => {
    if (!selectedCompanyId) return;
    setExportingExcel(true);
    try {
      const res = await fetch("/api/factory/payroll/export-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyId: selectedCompanyId, startDate: filterStartDate, endDate: filterEndDate }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-${filterStartDate}-${filterEndDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Excel exported" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExportingExcel(false);
    }
  };

  const totals = useMemo(() => {
    return payrollRecords.reduce(
      (acc, r) => ({
        baseSalary: acc.baseSalary + parseFloat(r.baseSalary || "0"),
        baleEarnings: acc.baleEarnings + parseFloat(r.baleEarnings || "0"),
        kgEarnings: acc.kgEarnings + parseFloat(r.kgEarnings || "0"),
        overtimePay: acc.overtimePay + parseFloat(r.overtimePay || "0"),
        bonuses: acc.bonuses + parseFloat(r.bonuses || "0"),
        deductions: acc.deductions + parseFloat(r.deductions || "0"),
        advances: acc.advances + parseFloat(r.advances || "0"),
        netSalary: acc.netSalary + parseFloat(r.netSalary || "0"),
      }),
      { baseSalary: 0, baleEarnings: 0, kgEarnings: 0, overtimePay: 0, bonuses: 0, deductions: 0, advances: 0, netSalary: 0 }
    );
  }, [payrollRecords]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Worker Payroll</h1>
          <p className="text-muted-foreground mt-1">Generate and manage factory worker payroll</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {companies.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Company</Label>
              <Select
                value={selectedCompanyId ? String(selectedCompanyId) : ""}
                onValueChange={(val) => setCompanyId(parseInt(val))}
              >
                <SelectTrigger className="w-48" data-testid="select-company">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Button onClick={() => setShowGenerateDialog(true)} disabled={!selectedCompanyId} data-testid="button-generate-payroll">
              <DollarSign className="h-4 w-4 mr-1" />
              Generate Payroll
            </Button>
            <Button variant="outline" onClick={handleExportPdf} disabled={!selectedCompanyId || exportingPdf} data-testid="button-export-pdf">
              {exportingPdf ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
              Export PDF
            </Button>
            <Button variant="outline" onClick={handleExportExcel} disabled={!selectedCompanyId || exportingExcel} data-testid="button-export-excel">
              {exportingExcel ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Export Excel
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="payroll" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payroll" data-testid="tab-payroll-records">
            <FileText className="h-4 w-4 mr-1" />
            Payroll Records
          </TabsTrigger>
          {showWorkerMaster && (
            <TabsTrigger value="workers" data-testid="tab-worker-master">
              <Table2 className="h-4 w-4 mr-1" />
              Worker Master Sheet
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="payroll" className="space-y-4">

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-40"
                data-testid="input-filter-start-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-40"
                data-testid="input-filter-end-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Records</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-total-records">{payrollRecords.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Total Net Salary</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-total-net">${totals.netSalary.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Total Base</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" data-testid="text-total-base">${totals.baseSalary.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Period</p>
            </div>
            <p className="text-sm font-mono mt-1" data-testid="text-period">{filterStartDate} - {filterEndDate}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Payroll Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedCompanyId ? (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">Select a company</h3>
              <p className="text-muted-foreground mt-2">Choose a company to view payroll records</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading payroll...</span>
            </div>
          ) : isError ? (
            <div className="text-center py-12">
              <p className="text-destructive">Failed to load payroll data. Please try again.</p>
            </div>
          ) : payrollRecords.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No payroll records found</h3>
              <p className="text-muted-foreground mt-2">Generate payroll or adjust the filters to see records</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee Code</TableHead>
                    <TableHead>Worker Name</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead className="text-right">Base Salary</TableHead>
                    <TableHead className="text-right">Bale Earnings</TableHead>
                    <TableHead className="text-right">KG Earnings</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Bonuses</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Advances</TableHead>
                    <TableHead className="text-right">Net Salary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollRecords.map((record) => (
                    <TableRow key={record.id} data-testid={`row-payroll-${record.id}`}>
                      <TableCell className="font-mono text-sm">{record.workerCode || "-"}</TableCell>
                      <TableCell className="font-medium">{record.workerName || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{record.workerPosition || "-"}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.baseSalary || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.baleEarnings || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.kgEarnings || "0").toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.overtimePay || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.bonuses || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.deductions || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">{parseFloat(record.advances || "0").toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">{parseFloat(record.netSalary || "0").toFixed(2)}</TableCell>
                      <TableCell>{getStatusBadge(record.status)}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => openEditDialog(record)} data-testid={`button-edit-payroll-${record.id}`}>
                          <Edit className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 font-bold" data-testid="row-payroll-totals">
                    <TableCell colSpan={3} className="text-right">TOTALS</TableCell>
                    <TableCell className="text-right font-mono">{totals.baseSalary.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totals.baleEarnings.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totals.kgEarnings.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{totals.overtimePay.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totals.bonuses.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totals.deductions.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totals.advances.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono">{totals.netSalary.toFixed(2)}</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent data-testid="dialog-generate-payroll">
          <DialogHeader>
            <DialogTitle>Generate Payroll</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={genStartDate}
                onChange={(e) => setGenStartDate(e.target.value)}
                data-testid="input-gen-start-date"
              />
            </div>
            <div className="space-y-1">
              <Label>End Date</Label>
              <Input
                type="date"
                value={genEndDate}
                onChange={(e) => setGenEndDate(e.target.value)}
                data-testid="input-gen-end-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)} data-testid="button-cancel-generate">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedCompanyId) {
                  generateMutation.mutate({ companyId: selectedCompanyId, startDate: genStartDate, endDate: genEndDate });
                }
              }}
              disabled={generateMutation.isPending || !genStartDate || !genEndDate}
              data-testid="button-submit-generate"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPayDialog} onOpenChange={(open) => { if (!open) setShowPayDialog(false); }}>
        <DialogContent data-testid="dialog-confirm-payment">
          <DialogHeader>
            <DialogTitle>Confirm Payment</DialogTitle>
          </DialogHeader>
          {editRecord && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Recording payment for <span className="font-medium text-foreground">{editRecord.workerName}</span> — net salary <span className="font-mono font-medium text-foreground">{parseFloat(editRecord.netSalary || "0").toFixed(2)}</span>
              </p>
              <div className="space-y-1">
                <Label>Payment Source</Label>
                <Select value={paySource} onValueChange={setPaySource}>
                  <SelectTrigger data-testid="select-pay-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="Bank">Bank</SelectItem>
                    <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Payment Date</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} data-testid="input-pay-date" />
              </div>
              <div className="space-y-1">
                <Label>Reference / Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="e.g. cheque no. or transfer ref" data-testid="input-pay-reference" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)} data-testid="button-cancel-payment">
              Cancel
            </Button>
            <Button onClick={handleConfirmPayment} disabled={adjustMutation.isPending || !payDate} data-testid="button-confirm-payment">
              {adjustMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Mark as Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editRecord !== null} onOpenChange={(open) => { if (!open) setEditRecord(null); }}>
        <DialogContent data-testid="dialog-adjust-payroll">
          <DialogHeader>
            <DialogTitle>Adjust Payroll</DialogTitle>
          </DialogHeader>
          {editRecord && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Worker: <span className="font-medium text-foreground">{editRecord.workerName}</span> ({editRecord.workerCode})
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Bonuses</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editBonuses}
                    onChange={(e) => setEditBonuses(e.target.value)}
                    data-testid="input-edit-bonuses"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Deductions</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editDeductions}
                    onChange={(e) => setEditDeductions(e.target.value)}
                    data-testid="input-edit-deductions"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Advances</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editAdvances}
                    onChange={(e) => setEditAdvances(e.target.value)}
                    data-testid="input-edit-advances"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Overtime Hours</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editOvertimeHours}
                    onChange={(e) => setEditOvertimeHours(e.target.value)}
                    data-testid="input-edit-overtime-hours"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional notes"
                  data-testid="input-edit-notes"
                />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="PAID">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)} data-testid="button-cancel-adjust">
              Cancel
            </Button>
            <Button onClick={handleAdjustSubmit} disabled={adjustMutation.isPending} data-testid="button-submit-adjust">
              {adjustMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
        </TabsContent>

        {showWorkerMaster && <TabsContent value="workers" className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Input
                placeholder="Search by name, code or phone..."
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                className="max-w-sm"
                data-testid="input-worker-search"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={workerFileInput}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleWorkerImport}
                data-testid="input-worker-import-file"
              />
              <Button
                variant="outline"
                onClick={() => workerFileInput.current?.click()}
                disabled={workerImporting || !selectedCompanyId}
                data-testid="button-import-workers"
              >
                {workerImporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Import Workers Excel
              </Button>
              <a
                href={selectedCompanyId ? "/api/factory/workers/template.xlsx" : "#"}
                download
                onClick={(e) => { if (!selectedCompanyId) e.preventDefault(); }}
              >
                <Button variant="outline" disabled={!selectedCompanyId} data-testid="button-download-template">
                  <Download className="h-4 w-4 mr-1" />
                  Download Template
                </Button>
              </a>
            </div>
          </div>

          <Card>
            <CardContent className="pt-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Code</TableHead>
                    <TableHead className="whitespace-nowrap">Full Name</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap">Position</TableHead>
                    <TableHead className="whitespace-nowrap">Department</TableHead>
                    <TableHead className="whitespace-nowrap">Phone 1</TableHead>
                    <TableHead className="whitespace-nowrap">Phone 2</TableHead>
                    <TableHead className="whitespace-nowrap">Emergency Contact</TableHead>
                    <TableHead className="whitespace-nowrap">Date Joined</TableHead>
                    <TableHead className="whitespace-nowrap">Contract Start</TableHead>
                    <TableHead className="whitespace-nowrap">Salary Type</TableHead>
                    <TableHead className="whitespace-nowrap">Pay Frequency</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Base Salary</TableHead>
                    <TableHead className="whitespace-nowrap">Visa No.</TableHead>
                    <TableHead className="whitespace-nowrap">Work Permit</TableHead>
                    <TableHead className="whitespace-nowrap">Residential Permit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workersLoading ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : filteredWorkers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">
                        {workerSearch ? "No workers match your search" : "No workers found. Import or add workers."}
                      </TableCell>
                    </TableRow>
                  ) : filteredWorkers.map((w: any) => (
                    <TableRow
                      key={w.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => navigate(`/factory/workers/${w.id}`)}
                      data-testid={`row-worker-${w.id}`}
                    >
                      <TableCell className="whitespace-nowrap font-mono text-xs">{w.employeeCode || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{w.fullName}</TableCell>
                      <TableCell>
                        <Badge variant={w.active ? "secondary" : "outline"} className={w.active ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400" : ""}>
                          {w.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{w.position || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.department || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.phone1 || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.phone2 || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.emergencyContactName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.dateJoined ? formatDisplayDate(new Date(w.dateJoined)) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.contractStartDate ? formatDisplayDate(new Date(w.contractStartDate)) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.salaryType || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.payFrequency || "Monthly"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{w.baseSalary ? parseFloat(w.baseSalary).toFixed(2) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.visaNumber || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.workPermitNumber || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{w.residentialPermit || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>}
      </Tabs>
    </div>
  );
}
