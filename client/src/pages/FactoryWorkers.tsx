import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Pencil, Search, Users, UserX, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { FactoryWorker } from "@shared/schema";

interface Company {
  id: number;
  name: string;
  code: string;
}

const emptyForm = {
  fullName: "",
  fatherName: "",
  motherName: "",
  nationalId: "",
  passportNumber: "",
  dateOfBirth: "",
  gender: "",
  nationality: "",
  maritalStatus: "",
  numberOfChildren: 0,
  phone1: "",
  phone2: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  address: "",
  city: "",
  country: "",
  position: "",
  department: "",
  dateJoined: "",
  contractStartDate: "",
  contractEndDate: "",
  salaryType: "Monthly",
  baseSalary: "",
  perBaleRate: "",
  perKgRate: "",
  overtimeRate: "",
  shiftType: "",
  bankName: "",
  bankAccountNumber: "",
  paymentMethod: "Cash",
  notes: "",
};

export default function FactoryWorkers() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [companyId, setCompanyId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [positionFilter, setPositionFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<FactoryWorker | null>(null);
  const [endContractWorker, setEndContractWorker] = useState<FactoryWorker | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/user/companies"],
  });

  const { data: workers, isLoading } = useQuery<FactoryWorker[]>({
    queryKey: ["/api/factory/workers", companyId],
    queryFn: async () => {
      const res = await fetch(`/api/factory/workers?companyId=${companyId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch workers");
      return res.json();
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/factory/workers", { ...data, companyId });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create worker");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", companyId] });
      toast({ title: "Created", description: "Worker added successfully" });
      resetForm();
      setCreateOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/factory/workers/${id}`, { ...data, companyId });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update worker");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", companyId] });
      toast({ title: "Updated", description: "Worker updated successfully" });
      resetForm();
      setEditingWorker(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const endContractMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/factory/workers/${id}/end-contract`, { companyId });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to end contract");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers", companyId] });
      toast({ title: "Contract Ended", description: "Worker contract has been ended" });
      setEndContractWorker(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ ...emptyForm });
  };

  const openEdit = (w: FactoryWorker) => {
    setEditingWorker(w);
    setFormData({
      fullName: w.fullName || "",
      fatherName: w.fatherName || "",
      motherName: w.motherName || "",
      nationalId: w.nationalId || "",
      passportNumber: w.passportNumber || "",
      dateOfBirth: w.dateOfBirth || "",
      gender: w.gender || "",
      nationality: w.nationality || "",
      maritalStatus: w.maritalStatus || "",
      numberOfChildren: w.numberOfChildren ?? 0,
      phone1: w.phone1 || "",
      phone2: w.phone2 || "",
      emergencyContactName: w.emergencyContactName || "",
      emergencyContactPhone: w.emergencyContactPhone || "",
      address: w.address || "",
      city: w.city || "",
      country: w.country || "",
      position: w.position || "",
      department: w.department || "",
      dateJoined: w.dateJoined || "",
      contractStartDate: w.contractStartDate || "",
      contractEndDate: w.contractEndDate || "",
      salaryType: w.salaryType || "Monthly",
      baseSalary: w.baseSalary || "",
      perBaleRate: w.perBaleRate || "",
      perKgRate: w.perKgRate || "",
      overtimeRate: w.overtimeRate || "",
      shiftType: w.shiftType || "",
      bankName: w.bankName || "",
      bankAccountNumber: w.bankAccountNumber || "",
      paymentMethod: w.paymentMethod || "Cash",
      notes: w.notes || "",
    });
  };

  const handleSubmit = () => {
    if (!formData.fullName.trim()) {
      toast({ title: "Validation", description: "Full name is required", variant: "destructive" });
      return;
    }
    if (editingWorker) {
      updateMutation.mutate({ id: editingWorker.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const updateField = (field: string, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const positions = useMemo(() => {
    if (!workers) return [];
    return Array.from(new Set(workers.map((w) => w.position).filter(Boolean))) as string[];
  }, [workers]);

  const departments = useMemo(() => {
    if (!workers) return [];
    return Array.from(new Set(workers.map((w) => w.department).filter(Boolean))) as string[];
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    if (!workers) return [];
    return workers.filter((w) => {
      if (statusFilter === "Active" && !w.active) return false;
      if (statusFilter === "Inactive" && w.active) return false;
      if (positionFilter !== "All" && w.position !== positionFilter) return false;
      if (departmentFilter !== "All" && w.department !== departmentFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match =
          w.fullName?.toLowerCase().includes(q) ||
          w.employeeCode?.toLowerCase().includes(q) ||
          w.position?.toLowerCase().includes(q) ||
          w.department?.toLowerCase().includes(q) ||
          w.phone1?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [workers, statusFilter, positionFilter, departmentFilter, searchQuery]);

  const dialogOpen = createOpen || editingWorker !== null;
  const dialogTitle = editingWorker ? "Edit Worker" : "Add Worker";

  const renderWorkerForm = () => (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Identity</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Full Name *</Label>
            <Input value={formData.fullName} onChange={(e) => updateField("fullName", e.target.value)} data-testid="input-fullName" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Father Name</Label>
            <Input value={formData.fatherName} onChange={(e) => updateField("fatherName", e.target.value)} data-testid="input-fatherName" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mother Name</Label>
            <Input value={formData.motherName} onChange={(e) => updateField("motherName", e.target.value)} data-testid="input-motherName" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">National ID</Label>
            <Input value={formData.nationalId} onChange={(e) => updateField("nationalId", e.target.value)} data-testid="input-nationalId" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Passport Number</Label>
            <Input value={formData.passportNumber} onChange={(e) => updateField("passportNumber", e.target.value)} data-testid="input-passportNumber" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date of Birth</Label>
            <Input type="date" value={formData.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} data-testid="input-dateOfBirth" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Gender</Label>
            <Select value={formData.gender} onValueChange={(v) => updateField("gender", v)}>
              <SelectTrigger data-testid="select-gender"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Male</SelectItem>
                <SelectItem value="Female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nationality</Label>
            <Input value={formData.nationality} onChange={(e) => updateField("nationality", e.target.value)} data-testid="input-nationality" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Marital Status</Label>
            <Select value={formData.maritalStatus} onValueChange={(v) => updateField("maritalStatus", v)}>
              <SelectTrigger data-testid="select-maritalStatus"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Single">Single</SelectItem>
                <SelectItem value="Married">Married</SelectItem>
                <SelectItem value="Divorced">Divorced</SelectItem>
                <SelectItem value="Widowed">Widowed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Number of Children</Label>
            <Input type="number" min={0} value={formData.numberOfChildren} onChange={(e) => updateField("numberOfChildren", parseInt(e.target.value) || 0)} data-testid="input-numberOfChildren" />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Contact</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Phone 1</Label>
            <Input value={formData.phone1} onChange={(e) => updateField("phone1", e.target.value)} data-testid="input-phone1" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone 2</Label>
            <Input value={formData.phone2} onChange={(e) => updateField("phone2", e.target.value)} data-testid="input-phone2" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Emergency Contact Name</Label>
            <Input value={formData.emergencyContactName} onChange={(e) => updateField("emergencyContactName", e.target.value)} data-testid="input-emergencyContactName" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Emergency Contact Phone</Label>
            <Input value={formData.emergencyContactPhone} onChange={(e) => updateField("emergencyContactPhone", e.target.value)} data-testid="input-emergencyContactPhone" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Address</Label>
            <Input value={formData.address} onChange={(e) => updateField("address", e.target.value)} data-testid="input-address" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">City</Label>
            <Input value={formData.city} onChange={(e) => updateField("city", e.target.value)} data-testid="input-city" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Country</Label>
            <Input value={formData.country} onChange={(e) => updateField("country", e.target.value)} data-testid="input-country" />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Employment</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Position</Label>
            <Input value={formData.position} onChange={(e) => updateField("position", e.target.value)} data-testid="input-position" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Department</Label>
            <Input value={formData.department} onChange={(e) => updateField("department", e.target.value)} data-testid="input-department" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Date Joined</Label>
            <Input type="date" value={formData.dateJoined} onChange={(e) => updateField("dateJoined", e.target.value)} data-testid="input-dateJoined" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Contract Start</Label>
            <Input type="date" value={formData.contractStartDate} onChange={(e) => updateField("contractStartDate", e.target.value)} data-testid="input-contractStartDate" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Contract End</Label>
            <Input type="date" value={formData.contractEndDate} onChange={(e) => updateField("contractEndDate", e.target.value)} data-testid="input-contractEndDate" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Salary Type</Label>
            <Select value={formData.salaryType} onValueChange={(v) => updateField("salaryType", v)}>
              <SelectTrigger data-testid="select-salaryType"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Monthly">Monthly</SelectItem>
                <SelectItem value="Daily">Daily</SelectItem>
                <SelectItem value="Per Bale">Per Bale</SelectItem>
                <SelectItem value="Per KG">Per KG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Base Salary</Label>
            <Input type="number" step="0.01" value={formData.baseSalary} onChange={(e) => updateField("baseSalary", e.target.value)} data-testid="input-baseSalary" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Per Bale Rate</Label>
            <Input type="number" step="0.0001" value={formData.perBaleRate} onChange={(e) => updateField("perBaleRate", e.target.value)} data-testid="input-perBaleRate" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Per KG Rate</Label>
            <Input type="number" step="0.0001" value={formData.perKgRate} onChange={(e) => updateField("perKgRate", e.target.value)} data-testid="input-perKgRate" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Overtime Rate</Label>
            <Input type="number" step="0.01" value={formData.overtimeRate} onChange={(e) => updateField("overtimeRate", e.target.value)} data-testid="input-overtimeRate" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Shift Type</Label>
            <Input value={formData.shiftType} onChange={(e) => updateField("shiftType", e.target.value)} data-testid="input-shiftType" />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Financial</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Bank Name</Label>
            <Input value={formData.bankName} onChange={(e) => updateField("bankName", e.target.value)} data-testid="input-bankName" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bank Account Number</Label>
            <Input value={formData.bankAccountNumber} onChange={(e) => updateField("bankAccountNumber", e.target.value)} data-testid="input-bankAccountNumber" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Payment Method</Label>
            <Select value={formData.paymentMethod} onValueChange={(v) => updateField("paymentMethod", v)}>
              <SelectTrigger data-testid="select-paymentMethod"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bank">Bank</SelectItem>
                <SelectItem value="Transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Notes</h4>
        <Textarea
          value={formData.notes}
          onChange={(e) => updateField("notes", e.target.value)}
          rows={3}
          data-testid="input-notes"
        />
      </div>
    </div>
  );

  if (!companyId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Workers</h1>
          <p className="text-muted-foreground mt-1">Select a company to manage workers</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <Label className="text-sm">Select Company</Label>
              <Select onValueChange={(v) => setCompanyId(Number(v))}>
                <SelectTrigger data-testid="select-company"><SelectValue placeholder="Choose a company" /></SelectTrigger>
                <SelectContent>
                  {companies?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeCount = workers?.filter((w) => w.active).length ?? 0;
  const inactiveCount = workers?.filter((w) => !w.active).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-title">Factory Workers</h1>
          <p className="text-muted-foreground mt-1">
            {activeCount} active worker{activeCount !== 1 ? "s" : ""}
            {inactiveCount > 0 && ` / ${inactiveCount} inactive`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={String(companyId)} onValueChange={(v) => setCompanyId(Number(v))}>
            <SelectTrigger className="w-48" data-testid="select-company"><SelectValue /></SelectTrigger>
            <SelectContent>
              {companies?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => { resetForm(); setCreateOpen(true); }}
            data-testid="button-add-worker"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Worker
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1 flex-1 min-w-48">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Name, code, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {positions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Position</Label>
                <Select value={positionFilter} onValueChange={setPositionFilter}>
                  <SelectTrigger className="w-40" data-testid="select-position-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Positions</SelectItem>
                    {positions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {departments.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Department</Label>
                <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                  <SelectTrigger className="w-40" data-testid="select-department-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredWorkers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Photo</TableHead>
                    <TableHead>Employee Code</TableHead>
                    <TableHead>Full Name</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Salary Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWorkers.map((worker) => (
                    <TableRow
                      key={worker.id}
                      className={`cursor-pointer ${!worker.active ? "opacity-60" : ""}`}
                      onClick={() => setLocation(`/factory/workers/${worker.id}`)}
                      data-testid={`row-worker-${worker.id}`}
                    >
                      <TableCell>
                        <Avatar className="h-8 w-8">
                          {worker.photoUrl ? (
                            <AvatarImage src={worker.photoUrl} />
                          ) : (
                            <AvatarFallback>{worker.fullName?.substring(0, 2).toUpperCase()}</AvatarFallback>
                          )}
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-mono text-sm" data-testid={`text-code-${worker.id}`}>
                        {worker.employeeCode || "-"}
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-name-${worker.id}`}>
                        {worker.fullName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {worker.position || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {worker.department || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{worker.salaryType}</Badge>
                      </TableCell>
                      <TableCell>
                        {worker.active ? (
                          <Badge variant="default" className="bg-green-600 text-xs" data-testid={`badge-status-${worker.id}`}>Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs" data-testid={`badge-status-${worker.id}`}>Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(worker)}
                            data-testid={`button-edit-worker-${worker.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {worker.active && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEndContractWorker(worker)}
                              data-testid={`button-end-contract-${worker.id}`}
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold" data-testid="text-empty">No workers found</h3>
              <p className="text-muted-foreground mt-2">
                {searchQuery || statusFilter !== "All" || positionFilter !== "All" || departmentFilter !== "All"
                  ? "Try adjusting your filters"
                  : "Add your first worker to get started"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setEditingWorker(null); resetForm(); } }}>
        <DialogContent className="max-w-2xl" data-testid="dialog-worker-form">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {editingWorker ? "Update the worker details below" : "Fill in the worker details below"}
            </DialogDescription>
          </DialogHeader>
          {renderWorkerForm()}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingWorker(null); resetForm(); }}
              data-testid="button-cancel-worker"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-submit-worker"
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingWorker ? "Update Worker" : "Add Worker"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={endContractWorker !== null} onOpenChange={(open) => { if (!open) setEndContractWorker(null); }}>
        <DialogContent data-testid="dialog-end-contract">
          <DialogHeader>
            <DialogTitle>End Contract</DialogTitle>
            <DialogDescription>
              Are you sure you want to end the contract for <strong>{endContractWorker?.fullName}</strong>? This will mark the worker as inactive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndContractWorker(null)} data-testid="button-cancel-end-contract">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => endContractWorker && endContractMutation.mutate(endContractWorker.id)}
              disabled={endContractMutation.isPending}
              data-testid="button-confirm-end-contract"
            >
              {endContractMutation.isPending ? "Ending..." : "End Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
