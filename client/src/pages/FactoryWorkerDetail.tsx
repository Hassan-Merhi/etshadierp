import { useState, useRef } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Upload, Pencil, UserX, Package, DollarSign, Calculator,
  CheckCircle2, X, CreditCard, Building, Phone, Calendar,
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
import type { FactoryWorker, FactoryBale } from "@shared/schema";

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

export default function FactoryWorkerDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/factory/workers/:id");
  const workerId = params?.id ? parseInt(params.id) : null;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { formatDisplayDate } = useDateFormat();
  const formatDate = (val: string | null | undefined) => {
    if (!val) return "—";
    try { return formatDisplayDate(new Date(val)); } catch { return "—"; }
  };

  const [endStep, setEndStep] = useState<1 | 2>(1);
  const [endOpen, setEndOpen] = useState(false);
  const [endStart, setEndStart] = useState("");
  const [endEnd, setEndEnd] = useState(new Date().toISOString().split("T")[0]);
  const [endCalculating, setEndCalculating] = useState(false);
  const [endResult, setEndResult] = useState<{ earned: string; paid: string; balance: string } | null>(null);
  const [endCashAccountId, setEndCashAccountId] = useState("");
  const [endSubmitting, setEndSubmitting] = useState(false);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [payOpen, setPayOpen] = useState(false);
  const [payTargetId, setPayTargetId] = useState<number | null>(null);
  const [payCashAccountId, setPayCashAccountId] = useState("");

  const [editOpen, setEditOpen] = useState(false);

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

  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts", worker?.companyId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/cash-accounts?companyId=${worker?.companyId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!worker?.companyId,
  });

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
      toast({ title: "Marked as paid" });
      setPayOpen(false); setPayTargetId(null); setPayCashAccountId("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
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
    const today = new Date().toISOString().split("T")[0];
    const firstOfMonth = today.slice(0, 7) + "-01";
    setEndStart(worker.contractStartDate || worker.dateJoined || firstOfMonth);
    setEndEnd(today);
    setEndOpen(true);
  };

  const handleCalculate = async () => {
    if (!worker || !endStart || !endEnd) return;
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

  const payrollBalance = endResult ? parseFloat(endResult.balance) : 0;
  const totalEarned = payrolls?.reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0) ?? 0;
  const totalPaid = payrolls?.filter((p) => p.status === "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0) ?? 0;
  const totalPending = payrolls?.filter((p) => p.status !== "PAID").reduce((s, p) => s + parseFloat(p.netSalary || "0"), 0) ?? 0;

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
                {worker.active && (
                  <Button variant="destructive" className="w-full" onClick={openEndContract} data-testid="button-end-contract">
                    <UserX className="h-3.5 w-3.5 mr-2" />End Contract
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
              <TabsTrigger value="statement" data-testid="tab-statement">Statement</TabsTrigger>
              <TabsTrigger value="bales" data-testid="tab-bales">Bales</TabsTrigger>
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

            <TabsContent value="statement" className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total on Record</p>
                    <p className="text-xl font-bold" data-testid="stat-total-earned">${fmtNum(totalEarned)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Total Paid</p>
                    <p className="text-xl font-bold text-green-700 dark:text-green-400" data-testid="stat-total-paid">${fmtNum(totalPaid)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Pending</p>
                    <p className="text-xl font-bold text-amber-700 dark:text-amber-400" data-testid="stat-total-pending">${fmtNum(totalPending)}</p>
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
                            <TableHead className="text-right">Bonus</TableHead>
                            <TableHead className="text-right">Deductions</TableHead>
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
                                <TableCell className="text-right font-mono text-sm">${fmtNum(p.bonuses)}</TableCell>
                                <TableCell className="text-right font-mono text-sm">${fmtNum(p.deductions)}</TableCell>
                                <TableCell className="text-right font-mono text-sm font-semibold">${fmtNum(p.netSalary)}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`text-xs ${cfg.className}`}>{cfg.label}</Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-GB") : "—"}
                                </TableCell>
                                <TableCell>
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
            </TabsContent>

            <TabsContent value="bales">
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
            </TabsContent>
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
            </div>
          )}

          {endStep === 2 && endResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Earned</p>
                  <p className="font-semibold text-sm" data-testid="text-earned">${fmtNum(endResult.earned)}</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Already Paid</p>
                  <p className="font-semibold text-sm" data-testid="text-paid">${fmtNum(endResult.paid)}</p>
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
    </div>
  );
}
