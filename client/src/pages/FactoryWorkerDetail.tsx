import { useState, useRef } from "react";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, Upload, User, Phone, MapPin, Briefcase, Calendar,
  Package, Weight, DollarSign, FileText, Shield, Heart, Users,
  Building, CreditCard, Clock, AlertTriangle, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { FactoryWorker, FactoryBale } from "@shared/schema";

interface WorkerWithStats extends FactoryWorker {
  stats: {
    totalBales: number;
    totalKg: string;
    totalEarnings: string;
    payrollCount: number;
  };
}

interface WorkerStats {
  workerId: number;
  workerName: string;
  salaryType: string;
  totalBales: number;
  totalKg: string;
  estimatedEarnings: string;
  totalPaid: string;
  payrollCount: number;
  recentPayrolls: any[];
}

export default function FactoryWorkerDetail() {
  const [, navigate] = useLocation();
  const [match, params] = useRoute("/factory/workers/:id");
  const workerId = params?.id ? parseInt(params.id) : null;

  const [endContractOpen, setEndContractOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [settlementStart, setSettlementStart] = useState("");
  const [settlementEnd, setSettlementEnd] = useState(new Date().toISOString().split("T")[0]);
  const [settleHours, setSettleHours] = useState("");
  const [settlementResult, setSettlementResult] = useState<{ earned: string; paid: string; balance: string; settlementPayrollId: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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

  const baleQueryParams = new URLSearchParams();
  if (startDate) baleQueryParams.set("startDate", startDate);
  if (endDate) baleQueryParams.set("endDate", endDate);
  const baleQueryString = baleQueryParams.toString();

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

  const settleMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${workerId}/settle-and-end`, {
        companyId: worker?.companyId,
        startDate: settlementStart || worker?.contractStartDate || worker?.dateJoined || new Date().toISOString().split("T")[0],
        endDate: settlementEnd,
        hoursWorked: settleHours ? parseFloat(settleHours) : undefined,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId, "stats"] });
      setSettlementResult(data);
    },
    onError: (err: Error) => {
      toast({ title: "Settlement Error", description: err.message, variant: "destructive" });
    },
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workerId) return;

    const formData = new FormData();
    formData.append("photo", file);

    try {
      const res = await fetch(`/api/factory/workers/${workerId}/photo`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to upload photo");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", workerId] });
      toast({ title: "Photo Updated", description: "Worker photo has been uploaded successfully" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const { formatDisplayDate } = useDateFormat();
  const formatDate = (val: string | null | undefined) => {
    if (!val) return "-";
    try { return formatDisplayDate(new Date(val)); } catch { return "-"; }
  };

  const formatCurrency = (val: string | number | null | undefined) => {
    if (val === null || val === undefined) return "-";
    const num = typeof val === "string" ? parseFloat(val) : val;
    if (isNaN(num) || num === 0) return "$0.00";
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (!workerId) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Invalid worker ID</p>
      </div>
    );
  }

  if (workerLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (workerError || !worker) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/factory/workers")}
          data-testid="button-back-workers-error"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">Worker not found</p>
        </div>
      </div>
    );
  }

  const infoRow = (label: string, value: string | number | null | undefined, testId?: string) => (
    <div className="flex justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right" data-testid={testId}>{value || "-"}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/factory/workers")}
          data-testid="button-back-workers"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-worker-name">
              {worker.fullName}
            </h1>
            {worker.position && (
              <Badge variant="secondary" data-testid="badge-worker-position">
                {worker.position}
              </Badge>
            )}
            <Badge
              variant={worker.active ? "default" : "destructive"}
              data-testid="badge-worker-status"
            >
              {worker.active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-worker-code">
            {worker.employeeCode || "No employee code"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <Avatar className="h-24 w-24">
          {worker.photoUrl ? (
            <AvatarImage src={worker.photoUrl} alt={worker.fullName} data-testid="img-worker-photo" />
          ) : null}
          <AvatarFallback className="text-2xl" data-testid="text-worker-avatar-fallback">
            {getInitials(worker.fullName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={handlePhotoUpload}
            data-testid="input-photo-upload"
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-upload-photo"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Photo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" />
              Personal Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {infoRow("Full Name", worker.fullName, "text-detail-fullname")}
            {infoRow("Father Name", worker.fatherName, "text-detail-father")}
            {infoRow("Mother Name", worker.motherName, "text-detail-mother")}
            {infoRow("National ID", worker.nationalId, "text-detail-nationalid")}
            {infoRow("Passport", worker.passportNumber, "text-detail-passport")}
            {infoRow("Date of Birth", formatDate(worker.dateOfBirth), "text-detail-dob")}
            {infoRow("Gender", worker.gender, "text-detail-gender")}
            {infoRow("Nationality", worker.nationality, "text-detail-nationality")}
            {infoRow("Marital Status", worker.maritalStatus, "text-detail-marital")}
            {infoRow("Children", worker.numberOfChildren ?? 0, "text-detail-children")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Contact Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {infoRow("Phone 1", worker.phone1, "text-detail-phone1")}
            {infoRow("Phone 2", worker.phone2, "text-detail-phone2")}
            {infoRow("Emergency Contact", worker.emergencyContactName
              ? `${worker.emergencyContactName}${worker.emergencyContactPhone ? ` (${worker.emergencyContactPhone})` : ""}`
              : null, "text-detail-emergency")}
            {infoRow("Address", worker.address, "text-detail-address")}
            {infoRow("City", worker.city, "text-detail-city")}
            {infoRow("Country", worker.country, "text-detail-country")}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Employment Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {infoRow("Employee Code", worker.employeeCode, "text-detail-code")}
            {infoRow("Position", worker.position, "text-detail-position")}
            {infoRow("Department", worker.department, "text-detail-department")}
            {infoRow("Date Joined", formatDate(worker.dateJoined), "text-detail-joined")}
            {infoRow("Contract Start", formatDate(worker.contractStartDate), "text-detail-contract-start")}
            {infoRow("Contract End", formatDate(worker.contractEndDate), "text-detail-contract-end")}
            {infoRow("Salary Type", worker.salaryType, "text-detail-salary-type")}
            {infoRow("Base Salary", formatCurrency(worker.baseSalary), "text-detail-base-salary")}
            {infoRow("Per Bale Rate", formatCurrency(worker.perBaleRate), "text-detail-bale-rate")}
            {infoRow("Per KG Rate", formatCurrency(worker.perKgRate), "text-detail-kg-rate")}
            {infoRow("Overtime Rate", formatCurrency(worker.overtimeRate), "text-detail-overtime-rate")}
            {infoRow("Shift Type", worker.shiftType, "text-detail-shift")}
            {infoRow("Payment Method", worker.paymentMethod, "text-detail-payment-method")}
            {infoRow("Bank Name", worker.bankName, "text-detail-bank")}
            {infoRow("Bank Account", worker.bankAccountNumber, "text-detail-bank-account")}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Productivity Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : stats ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Package className="h-3.5 w-3.5" />
                    Total Bales Produced
                  </div>
                  <div className="text-xl font-bold mt-1" data-testid="text-stat-total-bales">
                    {stats.totalBales}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Weight className="h-3.5 w-3.5" />
                    Total KG Processed
                  </div>
                  <div className="text-xl font-bold mt-1" data-testid="text-stat-total-kg">
                    {parseFloat(stats.totalKg).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} kg
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <DollarSign className="h-3.5 w-3.5" />
                    Total Earnings
                  </div>
                  <div className="text-xl font-bold mt-1" data-testid="text-stat-total-earnings">
                    {formatCurrency(stats.totalPaid)}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No stats available</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Bale History
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Label htmlFor="startDate" className="text-xs text-muted-foreground">From</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-auto"
                  data-testid="input-bale-start-date"
                />
              </div>
              <div className="flex items-center gap-1">
                <Label htmlFor="endDate" className="text-xs text-muted-foreground">To</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-auto"
                  data-testid="input-bale-end-date"
                />
              </div>
              {(startDate || endDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setStartDate(""); setEndDate(""); }}
                  data-testid="button-clear-date-filter"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {balesLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : bales && bales.length > 0 ? (
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
                      <TableCell className="font-medium text-sm" data-testid={`text-bale-code-${bale.id}`}>
                        {bale.baleCode}
                      </TableCell>
                      <TableCell className="text-sm" data-testid={`text-bale-product-${bale.id}`}>
                        {bale.productName || "-"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums" data-testid={`text-bale-weight-${bale.id}`}>
                        {parseFloat(bale.weightKg).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} kg
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums" data-testid={`text-bale-cost-${bale.id}`}>
                        {formatCurrency(bale.totalCost)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={bale.status === "FINALIZED" || bale.status === "IN_STOCK" ? "default" : "secondary"}
                          className="text-xs"
                          data-testid={`badge-bale-status-${bale.id}`}
                        >
                          {bale.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap" data-testid={`text-bale-date-${bale.id}`}>
                        {formatDate(bale.finalizedAt as any)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-lg font-medium">No bales found</p>
              <p className="text-sm">This worker has no bale records{startDate || endDate ? " in the selected date range" : ""}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {worker.active && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              End Contract
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              End this worker's contract. This will mark the worker as inactive and set the contract end date to today.
            </p>
            <Button
              variant="destructive"
              onClick={() => setEndContractOpen(true)}
              data-testid="button-end-contract"
            >
              End Contract
            </Button>
          </CardContent>
        </Card>
      )}

      {worker.notes && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap" data-testid="text-worker-notes">{worker.notes}</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={endContractOpen} onOpenChange={(open) => { setEndContractOpen(open); if (!open) setSettlementResult(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>End Contract &amp; Settlement</DialogTitle>
          </DialogHeader>
          {settlementResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">Settlement calculated successfully</span>
              </div>
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total Earned</span>
                  <span className="font-semibold">${parseFloat(settlementResult.earned).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Already Paid</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">-${parseFloat(settlementResult.paid).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center border-t pt-3">
                  <span className="text-sm font-semibold">Balance Owed</span>
                  <span className={`font-bold text-lg ${parseFloat(settlementResult.balance) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    ${parseFloat(settlementResult.balance).toFixed(2)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Settlement payroll record #{settlementResult.settlementPayrollId} has been created. Worker is now inactive.</p>
              <DialogFooter>
                <Button onClick={() => { setEndContractOpen(false); setSettlementResult(null); navigate("/factory/workers"); }} data-testid="button-close-settlement">
                  Close
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Calculate final settlement for <strong>{worker.fullName}</strong> and end their contract.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Settlement Start</Label>
                  <Input
                    type="date"
                    value={settlementStart || worker.contractStartDate || worker.dateJoined || ""}
                    onChange={(e) => setSettlementStart(e.target.value)}
                    data-testid="input-settlement-start"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Settlement End</Label>
                  <Input
                    type="date"
                    value={settlementEnd}
                    onChange={(e) => setSettlementEnd(e.target.value)}
                    data-testid="input-settlement-end"
                  />
                </div>
              </div>
              {((worker as any).payFrequency === "Hourly") && (
                <div className="space-y-1">
                  <Label className="text-xs">Hours Worked</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={settleHours}
                    onChange={(e) => setSettleHours(e.target.value)}
                    placeholder="Total hours in period"
                    data-testid="input-settle-hours"
                  />
                </div>
              )}
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setEndContractOpen(false)} data-testid="button-cancel-end-contract">
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => settleMutation.mutate()}
                  disabled={settleMutation.isPending}
                  data-testid="button-confirm-end-contract"
                >
                  {settleMutation.isPending ? "Calculating..." : "Confirm End Contract"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
