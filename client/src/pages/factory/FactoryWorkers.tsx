import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Pencil, Search, Users, UserX, UserCheck, Upload, Download, Calculator, X, FileDown, Layers, Trash2, RefreshCw,
} from "lucide-react";
import { ExcelJS, writeFile } from "@/lib/excelHelper";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";
import type { FactoryWorker, FactoryWorkerCategory } from "@shared/schema";

interface CashAccount { id: number; name: string; code: string; }

const emptyForm = {
  fullName: "", fatherName: "", motherName: "", nationalId: "", passportNumber: "",
  dateOfBirth: "", gender: "", nationality: "", maritalStatus: "", numberOfChildren: 0,
  phone1: "", phone2: "", emergencyContactName: "", emergencyContactPhone: "",
  address: "", city: "", country: "", position: "", department: "",
  dateJoined: "", contractStartDate: "", contractEndDate: "",
  salaryType: "Monthly", baseSalary: "", perBaleRate: "", perKgRate: "",
  overtimeRate: "", shiftType: "", payFrequency: "Monthly", hourlyRate: "",
  weeklySalary: "", biWeeklySalary: "", transportAllowance: "", visaNumber: "", visaExpiry: "",
  workPermitNumber: "", workPermitExpiry: "", residentialPermit: "",
  residentialPermitExpiry: "", bankName: "", bankAccountNumber: "",
  paymentMethod: "Cash", notes: "",
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

export default function FactoryWorkers() {
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/factory/settings"],
    queryFn: async () => { const r = await fetch("/api/factory/settings"); return r.ok ? r.json() : {}; },
    staleTime: 60000,
  });

  const showCategories = settings?.workersTabCategoriesEnabled !== false;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");

  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<FactoryWorker | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [endContractWorker, setEndContractWorker] = useState<FactoryWorker | null>(null);
  const [endStep, setEndStep] = useState<1 | 2>(1);
  const [endStart, setEndStart] = useState("");
  const [endEnd, setEndEnd] = useState(new Date().toLocaleDateString('en-CA'));
  const [endCalculating, setEndCalculating] = useState(false);
  const [endResult, setEndResult] = useState<{ earned: string; paid: string; advances: string; balance: string } | null>(null);
  const [endCashAccountId, setEndCashAccountId] = useState("");
  const [endSubmitting, setEndSubmitting] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);

  const { data: cashAccounts } = useQuery<CashAccount[]>({
    queryKey: ["/api/factory/cash-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/factory/cash-accounts", { credentials: "include" });
      return res.json();
    },
  });

  const { data: workers, isLoading } = useQuery<FactoryWorker[]>({
    queryKey: ["/api/factory/workers"],
    queryFn: async () => {
      const res = await fetch("/api/factory/workers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch workers");
      return res.json();
    },
  });

  // ── Categories ─────────────────────────────────────────────────────────────
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FactoryWorkerCategory | null>(null);
  const [catName, setCatName] = useState("");
  const [catWorkerIds, setCatWorkerIds] = useState<number[]>([]);

  const { data: categories = [] } = useQuery<FactoryWorkerCategory[]>({
    queryKey: ["/api/factory/worker-categories"],
    queryFn: async () => {
      const res = await fetch("/api/factory/worker-categories", { credentials: "include" });
      return res.json();
    },
  });

  const createCatMutation = useMutation({
    mutationFn: (data: { name: string; workerIds: number[] }) =>
      factoryApiRequest("POST", "/api/factory/worker-categories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/worker-categories"] });
      setCategoryDialogOpen(false);
      toast({ title: "Category created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateCatMutation = useMutation({
    mutationFn: (data: { id: number; name: string; workerIds: number[] }) =>
      factoryApiRequest("PATCH", `/api/factory/worker-categories/${data.id}`, { name: data.name, workerIds: data.workerIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/worker-categories"] });
      setCategoryDialogOpen(false);
      toast({ title: "Category updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: number) => factoryApiRequest("DELETE", `/api/factory/worker-categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/worker-categories"] });
      toast({ title: "Category deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openNewCategory = () => {
    setEditingCategory(null);
    setCatName("");
    setCatWorkerIds([]);
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (cat: FactoryWorkerCategory) => {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatWorkerIds(Array.isArray(cat.workerIds) ? (cat.workerIds as number[]) : []);
    setCategoryDialogOpen(true);
  };

  const toggleCatWorker = (id: number) => {
    setCatWorkerIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleSaveCategory = () => {
    if (!catName.trim()) {
      toast({ title: "Name is required", variant: "destructive" }); return;
    }
    // Only keep active workers' IDs
    const activeIds = (workers ?? []).filter((w) => w.active).map((w) => w.id);
    const filteredIds = catWorkerIds.filter((id) => activeIds.includes(id));
    if (editingCategory) {
      updateCatMutation.mutate({ id: editingCategory.id, name: catName.trim(), workerIds: filteredIds });
    } else {
      createCatMutation.mutate({ name: catName.trim(), workerIds: filteredIds });
    }
  };
  // ── End Categories ─────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await factoryApiRequest("POST", "/api/factory/workers", { ...data });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Worker added" });
      resetForm(); setCreateOpen(false);
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/workers/${id}`, { ...data });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Worker updated" });
      resetForm(); setEditingWorker(null);
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${id}/reactivate`, {});
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data: FactoryWorker) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Worker reactivated", description: `${data.fullName} is now active again.` });
    },
    onError: (err: Error) => { if ((err as any)?._handledGlobally) return; toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const reassignCodesMutation = useMutation({
    mutationFn: async () => {
      const res = await factoryApiRequest("POST", "/api/factory/workers/reassign-codes", { prefix: "HMD" });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data: { updated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      setReassignOpen(false);
      toast({ title: "Codes reassigned", description: `${data.updated} workers updated with HMD codes.` });
    },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/factory/workers/import-excel", { method: "POST", credentials: "include", body: fd });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Import failed");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      const parts: string[] = [];
      if (result.created) parts.push(`${result.created} created`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      toast({ title: "Import complete", description: parts.join(", ") || "No changes" });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  };

  const resetForm = () => setFormData({ ...emptyForm });

  const openEdit = (w: FactoryWorker) => {
    setEditingWorker(w);
    setFormData({
      fullName: w.fullName || "", fatherName: w.fatherName || "", motherName: w.motherName || "",
      nationalId: w.nationalId || "", passportNumber: w.passportNumber || "",
      dateOfBirth: w.dateOfBirth || "", gender: w.gender || "", nationality: w.nationality || "",
      maritalStatus: w.maritalStatus || "", numberOfChildren: w.numberOfChildren ?? 0,
      phone1: w.phone1 || "", phone2: w.phone2 || "",
      emergencyContactName: w.emergencyContactName || "", emergencyContactPhone: w.emergencyContactPhone || "",
      address: w.address || "", city: w.city || "", country: w.country || "",
      position: w.position || "", department: w.department || "",
      dateJoined: w.dateJoined || "", contractStartDate: w.contractStartDate || "",
      contractEndDate: w.contractEndDate || "", salaryType: w.salaryType || "Monthly",
      baseSalary: w.baseSalary || "", perBaleRate: w.perBaleRate || "",
      perKgRate: w.perKgRate || "", overtimeRate: w.overtimeRate || "",
      shiftType: w.shiftType || "", payFrequency: (w as any).payFrequency || "Monthly",
      hourlyRate: (w as any).hourlyRate || "", weeklySalary: (w as any).weeklySalary || "",
      biWeeklySalary: (w as any).biWeeklySalary || "", transportAllowance: (w as any).transportAllowance || "", visaNumber: (w as any).visaNumber || "",
      visaExpiry: (w as any).visaExpiry || "", workPermitNumber: (w as any).workPermitNumber || "",
      workPermitExpiry: (w as any).workPermitExpiry || "",
      residentialPermit: (w as any).residentialPermit || "",
      residentialPermitExpiry: (w as any).residentialPermitExpiry || "",
      bankName: w.bankName || "", bankAccountNumber: w.bankAccountNumber || "",
      paymentMethod: w.paymentMethod || "Cash", notes: w.notes || "",
    });
  };

  const handleSubmit = () => {
    if (!formData.fullName.trim()) {
      toast({ title: "Full name is required", variant: "destructive" }); return;
    }
    if (editingWorker) updateMutation.mutate({ id: editingWorker.id, data: formData });
    else createMutation.mutate(formData);
  };

  const updateField = (field: string, value: string | number) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const openEndContract = (w: FactoryWorker) => {
    setEndContractWorker(w);
    setEndStep(1);
    setEndResult(null);
    setEndCashAccountId("");
    const today = new Date().toLocaleDateString('en-CA');
    const firstOfMonth = today.slice(0, 7) + "-01";
    setEndStart(w.contractStartDate || w.dateJoined || firstOfMonth);
    setEndEnd(today);
  };

  const handleCalculate = async () => {
    if (!endContractWorker || !endStart || !endEnd) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Settle-and-end requires a connection", variant: "destructive" }); return; }
    setEndCalculating(true);
    try {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${endContractWorker.id}/settle-and-end`, {
        startDate: endStart, endDate: endEnd, dryRun: true,
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
    if (!endContractWorker) return;
    if (!navigator.onLine) { toast({ title: "Not available offline", description: "Settle-and-end requires a connection", variant: "destructive" }); return; }
    setEndSubmitting(true);
    try {
      const res = await factoryApiRequest("POST", `/api/factory/workers/${endContractWorker.id}/settle-and-end`, {
        startDate: endStart, endDate: endEnd,
        payNow, cashAccountId: payNow ? endCashAccountId : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to end contract");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      toast({ title: "Contract ended", description: payNow ? `Paid $${data.balance}` : "Balance recorded as pending" });
      setEndContractWorker(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEndSubmitting(false);
    }
  };

  const filteredWorkers = useMemo(() => {
    if (!workers) return [];
    return workers.filter((w) => {
      if (statusFilter === "Active" && !w.active) return false;
      if (statusFilter === "Inactive" && w.active) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          w.fullName?.toLowerCase().includes(q) ||
          w.employeeCode?.toLowerCase().includes(q) ||
          w.position?.toLowerCase().includes(q) ||
          w.department?.toLowerCase().includes(q) ||
          w.phone1?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [workers, statusFilter, searchQuery]);

  const activeCount = workers?.filter((w) => w.active).length ?? 0;
  const inactiveCount = workers?.filter((w) => !w.active).length ?? 0;

  const handleExportSalaries = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Factory System";
    const ws = wb.addWorksheet("Workers Salaries");

    ws.columns = [
      { key: "no",         width: 6  },
      { key: "code",       width: 14 },
      { key: "name",       width: 30 },
      { key: "position",   width: 20 },
      { key: "department", width: 18 },
      { key: "salaryType", width: 14 },
      { key: "salary",     width: 16 },
    ];

    const headerRow = ws.addRow(["#", "Code", "Name", "Position", "Department", "Salary Type", "Base Salary"]);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    });
    headerRow.height = 22;

    let totalSalary = 0;
    filteredWorkers.forEach((w, idx) => {
      const salary = parseFloat(w.baseSalary || "0") || 0;
      totalSalary += salary;
      const row = ws.addRow([
        idx + 1,
        w.employeeCode || "",
        w.fullName || "",
        w.position || "",
        w.department || "",
        w.salaryType || "Monthly",
        salary,
      ]);
      row.getCell(7).numFmt = "#,##0.00";
      row.getCell(7).alignment = { horizontal: "right" };
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      });
      if (idx % 2 === 1) {
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        });
      }
    });

    const totalRow = ws.addRow([
      "", "", `Total Workers: ${filteredWorkers.length}`, "", "", "TOTAL", totalSalary,
    ]);
    totalRow.getCell(6).alignment = { horizontal: "right" };
    totalRow.getCell(7).numFmt = "#,##0.00";
    totalRow.getCell(7).alignment = { horizontal: "right" };
    totalRow.eachCell((cell) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.border = {
        top: { style: "medium" }, bottom: { style: "medium" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    });
    totalRow.height = 22;

    const date = new Date().toLocaleDateString('en-CA');
    await writeFile(wb, `workers-salaries-${date}.xlsx`);
  };

  const renderWorkerForm = () => (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Identity</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Full Name *</Label><Input value={formData.fullName} onChange={(e) => updateField("fullName", e.target.value)} data-testid="input-fullName" /></div>
          <div className="space-y-1"><Label className="text-xs">Father Name</Label><Input value={formData.fatherName} onChange={(e) => updateField("fatherName", e.target.value)} data-testid="input-fatherName" /></div>
          <div className="space-y-1"><Label className="text-xs">National ID</Label><Input value={formData.nationalId} onChange={(e) => updateField("nationalId", e.target.value)} data-testid="input-nationalId" /></div>
          <div className="space-y-1"><Label className="text-xs">Passport Number</Label><Input value={formData.passportNumber} onChange={(e) => updateField("passportNumber", e.target.value)} data-testid="input-passportNumber" /></div>
          <div className="space-y-1"><Label className="text-xs">Date of Birth</Label><Input type="date" value={formData.dateOfBirth} onChange={(e) => updateField("dateOfBirth", e.target.value)} data-testid="input-dateOfBirth" /></div>
          <div className="space-y-1"><Label className="text-xs">Gender</Label>
            <Select value={formData.gender} onValueChange={(v) => updateField("gender", v)}>
              <SelectTrigger data-testid="select-gender"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="Male">Male</SelectItem><SelectItem value="Female">Female</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Nationality</Label><Input value={formData.nationality} onChange={(e) => updateField("nationality", e.target.value)} data-testid="input-nationality" /></div>
          <div className="space-y-1"><Label className="text-xs">Marital Status</Label>
            <Select value={formData.maritalStatus} onValueChange={(v) => updateField("maritalStatus", v)}>
              <SelectTrigger data-testid="select-maritalStatus"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="Single">Single</SelectItem><SelectItem value="Married">Married</SelectItem><SelectItem value="Divorced">Divorced</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Contact</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Phone 1</Label><Input value={formData.phone1} onChange={(e) => updateField("phone1", e.target.value)} data-testid="input-phone1" /></div>
          <div className="space-y-1"><Label className="text-xs">Phone 2</Label><Input value={formData.phone2} onChange={(e) => updateField("phone2", e.target.value)} data-testid="input-phone2" /></div>
          <div className="space-y-1"><Label className="text-xs">Emergency Contact Name</Label><Input value={formData.emergencyContactName} onChange={(e) => updateField("emergencyContactName", e.target.value)} data-testid="input-emergencyContactName" /></div>
          <div className="space-y-1"><Label className="text-xs">Emergency Contact Phone</Label><Input value={formData.emergencyContactPhone} onChange={(e) => updateField("emergencyContactPhone", e.target.value)} data-testid="input-emergencyContactPhone" /></div>
          <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Address</Label><Input value={formData.address} onChange={(e) => updateField("address", e.target.value)} data-testid="input-address" /></div>
          <div className="space-y-1"><Label className="text-xs">City</Label><Input value={formData.city} onChange={(e) => updateField("city", e.target.value)} data-testid="input-city" /></div>
          <div className="space-y-1"><Label className="text-xs">Country</Label><Input value={formData.country} onChange={(e) => updateField("country", e.target.value)} data-testid="input-country" /></div>
        </div>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Employment</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Position</Label><Input value={formData.position} onChange={(e) => updateField("position", e.target.value)} data-testid="input-position" /></div>
          <div className="space-y-1"><Label className="text-xs">Department</Label><Input value={formData.department} onChange={(e) => updateField("department", e.target.value)} data-testid="input-department" /></div>
          <div className="space-y-1"><Label className="text-xs">Date Joined</Label><Input type="date" value={formData.dateJoined} onChange={(e) => updateField("dateJoined", e.target.value)} data-testid="input-dateJoined" /></div>
          <div className="space-y-1"><Label className="text-xs">Contract Start</Label><Input type="date" value={formData.contractStartDate} onChange={(e) => updateField("contractStartDate", e.target.value)} data-testid="input-contractStartDate" /></div>
          <div className="space-y-1"><Label className="text-xs">Salary Type</Label>
            <Select value={formData.salaryType} onValueChange={(v) => updateField("salaryType", v)}>
              <SelectTrigger data-testid="select-salaryType"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Monthly">Monthly</SelectItem><SelectItem value="Daily">Daily</SelectItem><SelectItem value="Per Bale">Per Bale</SelectItem><SelectItem value="Per KG">Per KG</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Base Salary</Label><Input type="number" step="0.01" value={formData.baseSalary} onChange={(e) => updateField("baseSalary", e.target.value)} data-testid="input-baseSalary" /></div>
          <div className="space-y-1"><Label className="text-xs">Transport Allowance (monthly)</Label><Input type="number" step="0.01" value={(formData as any).transportAllowance} onChange={(e) => updateField("transportAllowance", e.target.value)} data-testid="input-transportAllowance" /></div>
          <div className="space-y-1"><Label className="text-xs">Per Bale Rate</Label><Input type="number" step="0.0001" value={formData.perBaleRate} onChange={(e) => updateField("perBaleRate", e.target.value)} data-testid="input-perBaleRate" /></div>
          <div className="space-y-1"><Label className="text-xs">Per KG Rate</Label><Input type="number" step="0.0001" value={formData.perKgRate} onChange={(e) => updateField("perKgRate", e.target.value)} data-testid="input-perKgRate" /></div>
          <div className="space-y-1"><Label className="text-xs">Pay Frequency</Label>
            <Select value={formData.payFrequency} onValueChange={(v) => updateField("payFrequency", v)}>
              <SelectTrigger data-testid="select-payFrequency"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Monthly">Monthly</SelectItem><SelectItem value="Weekly">Weekly</SelectItem><SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem><SelectItem value="Hourly">Hourly</SelectItem></SelectContent>
            </Select>
          </div>
          {formData.payFrequency === "Weekly" && <div className="space-y-1"><Label className="text-xs">Weekly Salary</Label><Input type="number" step="0.01" value={formData.weeklySalary} onChange={(e) => updateField("weeklySalary", e.target.value)} data-testid="input-weeklySalary" /></div>}
          {formData.payFrequency === "Bi-Weekly" && <div className="space-y-1"><Label className="text-xs">Bi-Weekly Salary</Label><Input type="number" step="0.01" value={formData.biWeeklySalary} onChange={(e) => updateField("biWeeklySalary", e.target.value)} data-testid="input-biWeeklySalary" /></div>}
          {formData.payFrequency === "Hourly" && <div className="space-y-1"><Label className="text-xs">Hourly Rate</Label><Input type="number" step="0.0001" value={formData.hourlyRate} onChange={(e) => updateField("hourlyRate", e.target.value)} data-testid="input-hourlyRate" /></div>}
          <div className="space-y-1"><Label className="text-xs">Payment Method</Label>
            <Select value={formData.paymentMethod} onValueChange={(v) => updateField("paymentMethod", v)}>
              <SelectTrigger data-testid="select-paymentMethod"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Cash">Cash</SelectItem><SelectItem value="Bank">Bank</SelectItem><SelectItem value="Transfer">Transfer</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Documents</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Visa Number</Label><Input value={formData.visaNumber} onChange={(e) => updateField("visaNumber", e.target.value)} data-testid="input-visaNumber" /></div>
          <div className="space-y-1"><Label className="text-xs">Visa Expiry</Label><Input type="date" value={formData.visaExpiry} onChange={(e) => updateField("visaExpiry", e.target.value)} data-testid="input-visaExpiry" /></div>
          <div className="space-y-1"><Label className="text-xs">Work Permit No.</Label><Input value={formData.workPermitNumber} onChange={(e) => updateField("workPermitNumber", e.target.value)} data-testid="input-workPermitNumber" /></div>
          <div className="space-y-1"><Label className="text-xs">Work Permit Expiry</Label><Input type="date" value={formData.workPermitExpiry} onChange={(e) => updateField("workPermitExpiry", e.target.value)} data-testid="input-workPermitExpiry" /></div>
          <div className="space-y-1"><Label className="text-xs">Bank Name</Label><Input value={formData.bankName} onChange={(e) => updateField("bankName", e.target.value)} data-testid="input-bankName" /></div>
          <div className="space-y-1"><Label className="text-xs">Bank Account No.</Label><Input value={formData.bankAccountNumber} onChange={(e) => updateField("bankAccountNumber", e.target.value)} data-testid="input-bankAccountNumber" /></div>
        </div>
      </div>
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground mb-3">Notes</h4>
        <Textarea value={formData.notes} onChange={(e) => updateField("notes", e.target.value)} rows={3} data-testid="input-notes" />
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-md" />)}
      </div>
    );
  }

  const balance = endResult ? parseFloat(endResult.balance) : 0;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="workers">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-title">Workers</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                <span className="font-medium text-foreground">{activeCount}</span> active
                {inactiveCount > 0 && <span className="ml-2"><span className="font-medium text-foreground">{inactiveCount}</span> inactive</span>}
              </p>
            </div>
            <TabsList>
              <TabsTrigger value="workers" data-testid="tab-workers">Workers</TabsTrigger>
              {showCategories && (
                <TabsTrigger value="categories" data-testid="tab-categories">
                  <Layers className="h-3.5 w-3.5 mr-1.5" />Categories
                  {categories.length > 0 && <Badge variant="secondary" className="ml-1.5 text-xs no-default-active-elevate">{categories.length}</Badge>}
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
            <Button variant="outline" onClick={() => window.open("/api/factory/workers/template.xlsx", "_blank")} data-testid="button-download-template">
              <Download className="h-4 w-4 mr-2" />Template
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importLoading} data-testid="button-import-workers">
              <Upload className="h-4 w-4 mr-2" />{importLoading ? "Importing..." : "Import Excel"}
            </Button>
            <Button variant="outline" onClick={handleExportSalaries} disabled={!filteredWorkers.length} data-testid="button-export-salaries">
              <FileDown className="h-4 w-4 mr-2" />Export Salaries
            </Button>
            <Button variant="outline" onClick={() => setReassignOpen(true)} data-testid="button-reassign-codes">
              <RefreshCw className="h-4 w-4 mr-2" />Reassign Codes
            </Button>
            <Button onClick={() => { resetForm(); setCreateOpen(true); }} data-testid="button-add-worker">
              <Plus className="h-4 w-4 mr-2" />Add Worker
            </Button>
          </div>
        </div>

        <TabsContent value="workers" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by name, code, position..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" data-testid="input-search" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

      {filteredWorkers.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Users className="mx-auto h-10 w-10 mb-3 opacity-40" />
          <p className="font-medium" data-testid="text-empty">No workers found</p>
          <p className="text-sm mt-1">
            {searchQuery || statusFilter !== "All" ? "Try adjusting your search or filters" : "Add your first worker to get started"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredWorkers.map((worker) => (
            <div
              key={worker.id}
              className="group cursor-pointer"
              onClick={() => setLocation(`/factory/workers/${worker.id}`)}
              data-testid={`card-worker-${worker.id}`}
            >
              <Card className="hover-elevate h-full">
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <Avatar className={`h-12 w-12 text-sm font-semibold ${getAvatarColor(worker.fullName)}`}>
                      {worker.photoUrl ? <AvatarImage src={worker.photoUrl} /> : null}
                      <AvatarFallback className={getAvatarColor(worker.fullName)}>
                        {getInitials(worker.fullName)}
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
                      {worker.fullName}
                    </p>
                    {worker.position && (
                      <p className="text-xs text-muted-foreground mt-0.5">{worker.position}</p>
                    )}
                    {worker.department && (
                      <p className="text-xs text-muted-foreground">{worker.department}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <span className="text-xs text-muted-foreground font-mono" data-testid={`text-code-${worker.id}`}>
                      {worker.employeeCode || "—"}
                    </span>
                    <div
                      className="flex gap-1 visible md:invisible md:group-hover:visible"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button size="icon" variant="ghost" onClick={() => openEdit(worker)} data-testid={`button-edit-worker-${worker.id}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {worker.active ? (
                        <Button size="icon" variant="ghost" onClick={() => openEndContract(worker)} data-testid={`button-end-contract-${worker.id}`}>
                          <UserX className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => reactivateMutation.mutate(worker.id)}
                          disabled={reactivateMutation.isPending}
                          data-testid={`button-reactivate-${worker.id}`}
                        >
                          <UserCheck className="h-3.5 w-3.5 text-green-600" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
        )}
        </TabsContent>

        {showCategories && <TabsContent value="categories" className="mt-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Group workers into categories to quickly filter them during stock entry and history.
              </p>
              <Button onClick={openNewCategory} data-testid="button-add-category">
                <Plus className="h-4 w-4 mr-2" />New Category
              </Button>
            </div>

            {categories.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground border rounded-md">
                <Layers className="mx-auto h-8 w-8 mb-3 opacity-40" />
                <p className="font-medium">No categories yet</p>
                <p className="text-sm mt-1">Create a category to group workers for quick filtering</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {categories.map((cat) => {
                  const ids = Array.isArray(cat.workerIds) ? (cat.workerIds as number[]) : [];
                  const catWorkers = (workers ?? []).filter((w) => ids.includes(w.id));
                  const activeMembers = catWorkers.filter((w) => w.active);
                  return (
                    <Card key={cat.id} data-testid={`card-category-${cat.id}`}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-sm" data-testid={`text-cat-name-${cat.id}`}>{cat.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {activeMembers.length} active worker{activeMembers.length !== 1 ? "s" : ""}
                              {ids.length > activeMembers.length && (
                                <span className="ml-1">({ids.length - activeMembers.length} inactive)</span>
                              )}
                            </p>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <Button size="icon" variant="ghost" onClick={() => openEditCategory(cat)} data-testid={`button-edit-cat-${cat.id}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteCatMutation.mutate(cat.id)}
                              disabled={deleteCatMutation.isPending}
                              data-testid={`button-delete-cat-${cat.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        {activeMembers.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {activeMembers.slice(0, 6).map((w) => (
                              <Badge key={w.id} variant="secondary" className="text-xs font-normal no-default-active-elevate">
                                {w.fullName}
                              </Badge>
                            ))}
                            {activeMembers.length > 6 && (
                              <Badge variant="outline" className="text-xs font-normal no-default-active-elevate">
                                +{activeMembers.length - 6} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>}
      </Tabs>

      {/* Category dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={(open) => { if (!open) setCategoryDialogOpen(false); }}>
        <DialogContent className="max-w-md" data-testid="dialog-category-form">
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "New Category"}</DialogTitle>
            <DialogDescription>
              {editingCategory ? "Update the category name and worker assignments." : "Create a group of workers for easy filtering."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Category Name *</Label>
              <Input
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="e.g. Pressing Team A"
                data-testid="input-cat-name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Workers</Label>
              <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                {(workers ?? []).filter((w) => w.active || catWorkerIds.includes(w.id)).map((w) => (
                  <label
                    key={w.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover-elevate ${!w.active ? "opacity-50" : ""}`}
                    data-testid={`label-cat-worker-${w.id}`}
                  >
                    <Checkbox
                      checked={catWorkerIds.includes(w.id)}
                      onCheckedChange={() => !w.active ? undefined : toggleCatWorker(w.id)}
                      disabled={!w.active}
                      data-testid={`checkbox-cat-worker-${w.id}`}
                    />
                    <span className="text-sm flex-1">{w.fullName}</span>
                    {!w.active && <Badge variant="secondary" className="text-xs no-default-active-elevate">Inactive</Badge>}
                  </label>
                ))}
                {(workers ?? []).filter((w) => w.active || catWorkerIds.includes(w.id)).length === 0 && (
                  <p className="text-sm text-muted-foreground px-3 py-4 text-center">No workers available</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {catWorkerIds.filter(id => (workers ?? []).find(w => w.id === id && w.active)).length} active workers selected.
                Inactive workers are automatically excluded.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)} data-testid="button-cancel-cat">Cancel</Button>
            <Button
              onClick={handleSaveCategory}
              disabled={createCatMutation.isPending || updateCatMutation.isPending}
              data-testid="button-save-cat"
            >
              {(createCatMutation.isPending || updateCatMutation.isPending) ? "Saving..." : editingCategory ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen || editingWorker !== null} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setEditingWorker(null); resetForm(); } }}>
        <DialogContent className="max-w-2xl" data-testid="dialog-worker-form">
          <DialogHeader>
            <DialogTitle>{editingWorker ? "Edit Worker" : "Add Worker"}</DialogTitle>
            <DialogDescription>{editingWorker ? "Update worker details" : "Fill in the worker details below"}</DialogDescription>
          </DialogHeader>
          {renderWorkerForm()}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditingWorker(null); resetForm(); }} data-testid="button-cancel-worker">Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-worker">
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingWorker ? "Update" : "Add Worker"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={endContractWorker !== null} onOpenChange={(open) => { if (!open) setEndContractWorker(null); }}>
        <DialogContent data-testid="dialog-end-contract">
          <DialogHeader>
            <DialogTitle>End Contract — {endContractWorker?.fullName}</DialogTitle>
            <DialogDescription>
              {endStep === 1 ? "Set the period to calculate the final settlement." : "Review the settlement and choose how to pay."}
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
              <Button onClick={handleCalculate} disabled={endCalculating || !endStart || !endEnd} className="w-full" data-testid="button-calculate-settlement">
                <Calculator className="h-4 w-4 mr-2" />
                {endCalculating ? "Calculating..." : "Calculate Settlement"}
              </Button>
            </div>
          )}

          {endStep === 2 && endResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Earned</p>
                  <p className="font-semibold text-sm" data-testid="text-settlement-earned">${parseFloat(endResult.earned).toFixed(2)}</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Already Paid</p>
                  <p className="font-semibold text-sm" data-testid="text-settlement-paid">${parseFloat(endResult.paid).toFixed(2)}</p>
                </div>
                <div className={`rounded-md border p-3 text-center ${parseFloat(endResult.advances) > 0 ? "border-orange-300 bg-orange-50 dark:bg-orange-900/20" : ""}`}>
                  <p className="text-xs text-muted-foreground mb-1">Advances</p>
                  <p className="font-semibold text-sm" data-testid="text-settlement-advances">${parseFloat(endResult.advances).toFixed(2)}</p>
                </div>
                <div className={`rounded-md border p-3 text-center ${balance > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20" : "border-green-300 bg-green-50 dark:bg-green-900/20"}`}>
                  <p className="text-xs text-muted-foreground mb-1">Balance Owed</p>
                  <p className="font-semibold text-sm" data-testid="text-settlement-balance">${balance.toFixed(2)}</p>
                </div>
              </div>

              {balance > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">Cash Account (for Pay Now)</Label>
                  <Select value={endCashAccountId} onValueChange={setEndCashAccountId}>
                    <SelectTrigger data-testid="select-end-cash-account"><SelectValue placeholder="Select account..." /></SelectTrigger>
                    <SelectContent>
                      {cashAccounts?.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="icon" onClick={() => { setEndStep(1); setEndResult(null); }} data-testid="button-back-step">
                  <X className="h-4 w-4" />
                </Button>
                {balance > 0 ? (
                  <>
                    <Button
                      className="flex-1"
                      onClick={() => handleEndContract(true)}
                      disabled={endSubmitting || !endCashAccountId}
                      data-testid="button-pay-now"
                    >
                      {endSubmitting ? "Processing..." : `Pay Now $${balance.toFixed(2)}`}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEndContract(false)}
                      disabled={endSubmitting}
                      data-testid="button-pay-later"
                    >
                      Pay Later — End Contract
                    </Button>
                  </>
                ) : (
                  <Button className="flex-1" onClick={() => handleEndContract(false)} disabled={endSubmitting} data-testid="button-end-contract-confirm">
                    {endSubmitting ? "Processing..." : "End Contract"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reassign Codes Confirmation Dialog */}
      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reassign Worker Codes</DialogTitle>
            <DialogDescription>
              This will replace every worker's current code with a new sequential HMD code (HMD001, HMD002, …) ordered by worker ID. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{(workers ?? []).length}</span> workers will be updated.
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setReassignOpen(false)} disabled={reassignCodesMutation.isPending} data-testid="button-reassign-cancel">
              Cancel
            </Button>
            <Button onClick={() => reassignCodesMutation.mutate()} disabled={reassignCodesMutation.isPending} data-testid="button-reassign-confirm">
              {reassignCodesMutation.isPending ? "Updating…" : "Yes, Reassign All Codes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
