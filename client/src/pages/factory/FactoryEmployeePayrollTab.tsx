import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Play, DollarSign, Users, Loader2, ChevronDown, ChevronRight, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  monthlySalary: string;
  currentBalance: string;
  department: string | null;
  active: boolean;
  employeeType: string;
}

function fmt(val: string | number | null | undefined) {
  const n = parseFloat(String(val || 0));
  return isNaN(n) ? "0.00" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const today = () => new Date().toLocaleDateString('en-CA');

export default function FactoryEmployeePayrollTab() {
  const { toast } = useToast();
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payDate, setPayDate] = useState(today());
  const [payNotes, setPayNotes] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [deductions, setDeductions] = useState<Record<number, string>>({});
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/factory/employees"],
    queryFn: async () => {
      const res = await fetch("/api/factory/employees", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const all = await res.json();
      return all.filter((e: Employee) => e.active);
    },
  });

  const openPayroll = () => {
    const initial: Record<number, string> = {};
    for (const e of employees) initial[e.id] = parseFloat(e.monthlySalary || "0") > 0 ? fmt(e.monthlySalary).replace(/,/g, "") : "";
    setAmounts(initial);
    setDeductions({});
    setPayrollOpen(true);
  };

  // net per employee = salary - deduction
  const getNet = (empId: number) => {
    const sal = parseFloat(amounts[empId] || "0") || 0;
    const ded = parseFloat(deductions[empId] || "0") || 0;
    return Math.max(0, sal - ded);
  };

  const totalNet = useMemo(() =>
    employees.reduce((s, e) => s + getNet(e.id), 0)
  , [amounts, deductions, employees]);

  const payrollMutation = useMutation({
    mutationFn: async () => {
      const deposits = employees
        .map((e) => ({
          employeeId: e.id,
          amount: parseFloat(amounts[e.id] || "0") || 0,
          deduction: parseFloat(deductions[e.id] || "0") || 0,
        }))
        .filter((d) => d.amount > 0 || d.deduction > 0);
      if (deposits.length === 0) throw new Error("No amounts entered");
      const res = await fetch("/api/factory/employees/bulk-payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deposits, date: payDate, notes: payNotes || null }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Payroll run complete", description: `Total paid: ${fmt(totalNet)}` });
      setPayrollOpen(false);
      setAmounts({});
      setDeductions({});
      setPayNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    const map: Record<string, Employee[]> = {};
    for (const e of employees) {
      const dept = e.department || "No Department";
      if (!map[dept]) map[dept] = [];
      map[dept].push(e);
    }
    return map;
  }, [employees]);

  const totalMonthlyBase = useMemo(() =>
    employees.reduce((s, e) => s + parseFloat(e.monthlySalary || "0"), 0)
  , [employees]);

  if (isLoading) {
    return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{employees.length} active employees</span>
          <span>Base payroll: <strong className="text-foreground">{fmt(totalMonthlyBase)}</strong>/mo</span>
        </div>
        <Button onClick={openPayroll} data-testid="button-run-payroll">
          <Play className="h-4 w-4 mr-2" /> Run Payroll
        </Button>
      </div>

      {employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No active employees found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {Object.entries(grouped).map(([dept, emps]) => {
            const deptTotal = emps.reduce((s, e) => s + parseFloat(e.monthlySalary || "0"), 0);
            const isExpanded = expandedGroup === dept;
            return (
              <Card key={dept}>
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedGroup(isExpanded ? null : dept)}
                  data-testid={`button-toggle-dept-${dept}`}
                >
                  <CardHeader className="p-3 flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      {dept}
                      <Badge variant="secondary" className="ml-1">{emps.length}</Badge>
                    </CardTitle>
                    <span className="text-sm font-mono text-muted-foreground">{fmt(deptTotal)}/mo</span>
                  </CardHeader>
                </button>
                {isExpanded && (
                  <CardContent className="p-0 pb-2">
                    <Table>
                      <TableHeader className="sticky top-0 z-30 bg-background">
                        <TableRow>
                          <TableHead className="pl-6">Employee</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead className="text-right">Monthly Salary</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {emps.map((emp) => (
                          <TableRow key={emp.id} data-testid={`row-employee-${emp.id}`}>
                            <TableCell className="pl-6 font-medium">{emp.firstName} {emp.lastName}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{emp.code || "—"}</TableCell>
                            <TableCell className="text-right font-mono">{fmt(emp.monthlySalary)}</TableCell>
                            <TableCell className={`text-right font-mono ${parseFloat(emp.currentBalance) > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                              {fmt(emp.currentBalance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={payrollOpen} onOpenChange={setPayrollOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Run Employee Payroll</DialogTitle>
            <DialogDescription>Enter the salary and any deduction per employee. Net = Salary − Deduction.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Payment Date</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} data-testid="input-payroll-date" />
              </div>
              <div>
                <Label>Notes</Label>
                <Input placeholder="e.g. March 2026..." value={payNotes} onChange={(e) => setPayNotes(e.target.value)} data-testid="input-payroll-notes" />
              </div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center px-3 pb-1 text-xs text-muted-foreground font-medium border-b">
              <span>Employee</span>
              <span className="w-24 text-right">Salary</span>
              <span className="w-4" />
              <span className="w-24 text-right">Deduct</span>
              <span className="w-20 text-right">Net</span>
            </div>

            <div className="rounded-md border divide-y">
              {employees.map((emp) => {
                const sal = parseFloat(amounts[emp.id] || "0") || 0;
                const ded = parseFloat(deductions[emp.id] || "0") || 0;
                const net = Math.max(0, sal - ded);
                return (
                  <div key={emp.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 items-center px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{emp.firstName} {emp.lastName}</p>
                      <p className="text-xs text-muted-foreground">{emp.code || emp.department || ""}</p>
                    </div>
                    <Input
                      type="number"
                      className="w-24 text-right"
                      placeholder="0.00"
                      value={amounts[emp.id] || ""}
                      onChange={(e) => setAmounts((a) => ({ ...a, [emp.id]: e.target.value }))}
                      data-testid={`input-payroll-amount-${emp.id}`}
                    />
                    <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Input
                      type="number"
                      className="w-24 text-right"
                      placeholder="0.00"
                      min="0"
                      value={deductions[emp.id] || ""}
                      onChange={(e) => setDeductions((d) => ({ ...d, [emp.id]: e.target.value }))}
                      data-testid={`input-payroll-deduction-${emp.id}`}
                    />
                    <div className={`w-20 text-right font-mono text-sm font-semibold ${ded > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                      {fmt(net)}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between text-sm font-medium pt-1 border-t">
              <span>Total Net Payroll</span>
              <span className="font-mono">{fmt(totalNet)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayrollOpen(false)}>Cancel</Button>
            <Button onClick={() => payrollMutation.mutate()} disabled={payrollMutation.isPending || totalNet === 0} data-testid="button-confirm-payroll">
              {payrollMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DollarSign className="h-4 w-4 mr-2" />}
              Pay {fmt(totalNet)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
