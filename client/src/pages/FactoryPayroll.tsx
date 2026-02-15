import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, FileText, DollarSign, Users, Calendar, Loader2, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

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

  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/user/companies"],
  });

  const firstCompanyId = companies.length > 0 ? companies[0].id : null;
  const selectedCompanyId = companyId ?? firstCompanyId;

  const payrollQueryParams = new URLSearchParams();
  if (selectedCompanyId) payrollQueryParams.set("companyId", String(selectedCompanyId));
  if (filterStartDate) payrollQueryParams.set("startDate", filterStartDate);
  if (filterEndDate) payrollQueryParams.set("endDate", filterEndDate);
  if (statusFilter !== "ALL") payrollQueryParams.set("status", statusFilter);
  const payrollUrl = `/api/factory/payroll?${payrollQueryParams.toString()}`;

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
      const res = await apiRequest("POST", "/api/factory/payroll/generate", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payroll"] });
      setShowGenerateDialog(false);
      toast({ title: "Payroll generated", description: `${data.length} payroll records created.` });
    },
    onError: (e: any) => {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/factory/payroll/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/payroll"] });
      setEditRecord(null);
      toast({ title: "Payroll updated" });
    },
    onError: (e: any) => {
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

  const handleExportPdf = async () => {
    if (!selectedCompanyId) return;
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
    </div>
  );
}
