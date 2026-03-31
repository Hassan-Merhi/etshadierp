import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Search, Pencil, Users, UserX, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { factoryApiRequest } from "@/lib/factoryApi";

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  department: string | null;
  monthlySalary: string;
  currentBalance: string;
  totalDeposits: string;
  totalWithdrawals: string;
  active: boolean;
  joinDate: string;
  employeeType: string;
}

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

const emptyForm = {
  firstName: "", lastName: "", code: "", department: "", phone: "",
  monthlySalary: "", joinDate: new Date().toISOString().split("T")[0],
};

export default function FactoryEmployees() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [endingContractEmployee, setEndingContractEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/factory/employees"],
    queryFn: async () => {
      const res = await factoryApiRequest("GET", "/api/factory/employees");
      if (!res.ok) throw new Error("Failed to fetch employees");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await factoryApiRequest("POST", "/api/factory/employees", data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create employee");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees"] });
      toast({ title: "Employee created" });
      setCreateOpen(false);
      setFormData({ ...emptyForm });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ variant: "destructive", title: e.message }); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/employees/${id}`, data);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to update employee");
      }
      return res.json();
    },
    onSuccess: (emp: Employee) => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees", emp.id] });
      toast({ title: "Employee updated" });
      setEditingEmployee(null);
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ variant: "destructive", title: e.message }); },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/employees/${id}`, { active: false });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to end contract");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees"] });
      toast({ title: "Contract ended", description: "Employee has been deactivated" });
      setEndingContractEmployee(null);
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ variant: "destructive", title: e.message }); },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await factoryApiRequest("PATCH", `/api/factory/employees/${id}`, { active: true });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to reactivate employee");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees"] });
      toast({ title: "Employee reactivated" });
    },
    onError: (e: any) => { if (e?._handledGlobally) return; toast({ variant: "destructive", title: e.message }); },
  });

  const filtered = employees.filter((e) => {
    const matchesSearch =
      !search ||
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      (e.code || "").toLowerCase().includes(search.toLowerCase()) ||
      (e.department || "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "All" ||
      (statusFilter === "Active" && e.active) ||
      (statusFilter === "Inactive" && !e.active);
    return matchesSearch && matchesStatus;
  });

  const fmt = (val: string | number | null | undefined) => {
    const n = parseFloat(String(val || 0));
    return isNaN(n) ? "$0.00" : `$${n.toFixed(2)}`;
  };

  function openCreate() {
    setFormData({ ...emptyForm });
    setCreateOpen(true);
  }

  function openEdit(emp: Employee) {
    setFormData({
      firstName: emp.firstName,
      lastName: emp.lastName,
      code: emp.code,
      department: emp.department || "",
      phone: emp.phone || "",
      monthlySalary: emp.monthlySalary || "",
      joinDate: emp.joinDate || "",
    });
    setEditingEmployee(emp);
  }

  function handleField(key: string, val: string) {
    setFormData((f) => ({ ...f, [key]: val }));
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-employee-search"
          />
        </div>
        <div className="flex gap-1">
          {["Active", "Inactive", "All"].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? "default" : "outline"}
              onClick={() => setStatusFilter(s)}
              data-testid={`button-filter-${s.toLowerCase()}`}
            >
              {s}
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-create-employee">
          <Plus className="h-4 w-4 mr-2" />
          New Employee
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No employees found</p>
            <Button size="sm" className="mt-4" onClick={openCreate} data-testid="button-create-employee-empty">
              <Plus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((emp) => {
            const fullName = `${emp.firstName} ${emp.lastName}`;
            const balance = parseFloat(emp.currentBalance || "0");
            return (
              <Card
                key={emp.id}
                className="cursor-pointer hover-elevate"
                onClick={() => navigate(`/factory/employees/${emp.id}`)}
                data-testid={`card-employee-${emp.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <Avatar className={`h-10 w-10 shrink-0 ${getAvatarColor(fullName)}`}>
                      <AvatarFallback className={`text-sm font-semibold ${getAvatarColor(fullName)}`}>
                        {getInitials(fullName)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{fullName}</span>
                        <Badge variant="outline" className="text-xs">{emp.code}</Badge>
                        {!emp.active && (
                          <Badge variant="outline" className="border-red-400 text-red-600 dark:text-red-400 text-xs">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {emp.department || "No department"}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-6 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Monthly Salary</div>
                        <div className="font-mono font-medium">{fmt(emp.monthlySalary)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Balance</div>
                        <div className={`font-mono font-semibold ${balance < 0 ? "text-red-600 dark:text-red-400" : balance > 0 ? "text-green-600 dark:text-green-400" : ""}`}>
                          {fmt(emp.currentBalance)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Total Deposits</div>
                        <div className="font-mono">{fmt(emp.totalDeposits)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Withdrawals</div>
                        <div className="font-mono">{fmt(emp.totalWithdrawals)}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(emp)}
                        data-testid={`button-edit-employee-${emp.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {emp.active ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEndingContractEmployee(emp)}
                          data-testid={`button-end-contract-${emp.id}`}
                          title="End Contract"
                        >
                          <UserX className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => reactivateMutation.mutate(emp.id)}
                          disabled={reactivateMutation.isPending}
                          data-testid={`button-reactivate-${emp.id}`}
                          title="Reactivate"
                        >
                          <UserCheck className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen || !!editingEmployee} onOpenChange={(open) => {
        if (!open) { setCreateOpen(false); setEditingEmployee(null); }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "Edit Employee" : "New Employee"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>First Name *</Label>
                <Input
                  value={formData.firstName}
                  onChange={(e) => handleField("firstName", e.target.value)}
                  placeholder="First name"
                  data-testid="input-first-name"
                />
              </div>
              <div className="space-y-1">
                <Label>Last Name *</Label>
                <Input
                  value={formData.lastName}
                  onChange={(e) => handleField("lastName", e.target.value)}
                  placeholder="Last name"
                  data-testid="input-last-name"
                />
              </div>
            </div>
            {!editingEmployee && (
              <div className="space-y-1">
                <Label>Code (optional)</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => handleField("code", e.target.value)}
                  placeholder="Auto-generated if blank"
                  data-testid="input-code"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label>Department</Label>
              <Input
                value={formData.department}
                onChange={(e) => handleField("department", e.target.value)}
                placeholder="e.g. Operations"
                data-testid="input-department"
              />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => handleField("phone", e.target.value)}
                placeholder="+1 234 567 8900"
                data-testid="input-phone"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Monthly Salary</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.monthlySalary}
                  onChange={(e) => handleField("monthlySalary", e.target.value)}
                  placeholder="0.00"
                  data-testid="input-monthly-salary"
                />
              </div>
              <div className="space-y-1">
                <Label>Join Date *</Label>
                <Input
                  type="date"
                  value={formData.joinDate}
                  onChange={(e) => handleField("joinDate", e.target.value)}
                  data-testid="input-join-date"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCreateOpen(false); setEditingEmployee(null); }}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingEmployee) {
                  updateMutation.mutate({ id: editingEmployee.id, data: formData });
                } else {
                  createMutation.mutate(formData);
                }
              }}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save"
            >
              {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End Contract Confirmation Dialog */}
      <Dialog open={!!endingContractEmployee} onOpenChange={(open) => { if (!open) setEndingContractEmployee(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>End Contract</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            End contract for <span className="font-semibold text-foreground">{endingContractEmployee?.firstName} {endingContractEmployee?.lastName}</span>? They will be marked inactive but can be reactivated later.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEndingContractEmployee(null)} disabled={deactivateMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => endingContractEmployee && deactivateMutation.mutate(endingContractEmployee.id)}
              disabled={deactivateMutation.isPending}
              data-testid="button-confirm-end-contract"
            >
              {deactivateMutation.isPending ? "Ending..." : "End Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
