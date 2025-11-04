import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Employee } from "@shared/schema";
import { DollarSign, TrendingDown, TrendingUp, Users, AlertCircle, CalendarIcon, Plus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const depositSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

const withdrawalSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  paymentAccountType: z.enum(["bank", "cash"]),
  paymentAccountId: z.string().min(1, "Payment account is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

const bulkPaymentSchema = z.object({
  paymentAccountType: z.enum(["bank", "cash"]),
  paymentAccountId: z.string().min(1, "Payment account is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

const salaryAdvanceSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  amount: z.string().min(1, "Amount is required").refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Amount must be positive"),
  advanceDate: z.date({
    required_error: "Advance date is required",
  }),
  cashAccountId: z.string().min(1, "Cash account is required"),
  notes: z.string().optional(),
});

const deductionSchema = z.object({
  deductionAmount: z.string().min(1, "Deduction amount is required").refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) > 0, "Deduction amount must be positive"),
  payrollMonth: z.string().min(1, "Payroll month is required").regex(/^\d{4}-\d{2}$/, "Payroll month must be in format YYYY-MM (e.g., 2024-01)"),
});

type DepositFormData = z.infer<typeof depositSchema>;
type WithdrawalFormData = z.infer<typeof withdrawalSchema>;
type BulkPaymentFormData = z.infer<typeof bulkPaymentSchema>;
type SalaryAdvanceFormData = z.infer<typeof salaryAdvanceSchema>;
type DeductionFormData = z.infer<typeof deductionSchema>;

interface WorkerPayment {
  workerId: number;
  amount: string;
  selected: boolean;
}

interface SalaryAdvance {
  id: number;
  companyId: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  advanceDate: string;
  amount: string;
  remainingBalance: string;
  fullyPaid: boolean;
  voucherId?: number;
  notes?: string;
  createdAt: string;
}

export default function Payroll() {
  const [selectedTab, setSelectedTab] = useState("employees");
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false);
  const [bulkPaymentDialogOpen, setBulkPaymentDialogOpen] = useState(false);
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [deductionDialogOpen, setDeductionDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedAdvance, setSelectedAdvance] = useState<SalaryAdvance | null>(null);
  const [workerPayments, setWorkerPayments] = useState<Record<number, WorkerPayment>>({});
  const { selectedCompany } = useCompany();
  const { toast } = useToast();

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: !!selectedCompany,
  });

  const { data: bankAccounts, isLoading: bankAccountsLoading } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!selectedCompany,
  });

  const { data: ledgerAccounts } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts"],
    enabled: !!selectedCompany,
  });

  const { data: workerPaymentSummary } = useQuery<{
    workerPayments: Array<{
      workerId: number;
      workerCode: string;
      workerName: string;
      totalPaid: string;
    }>;
    grandTotal: string;
  }>({
    queryKey: ["/api/payroll/worker-payments-summary"],
    enabled: !!selectedCompany,
  });

  const { data: salaryAdvances, isLoading: advancesLoading } = useQuery<SalaryAdvance[]>({
    queryKey: ["/api/salary-advances", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const cashAccounts = ledgerAccounts?.filter((acc) => acc.accountType === "Cash") || [];
  
  // Calculate summary stats for salary advances
  const advancesStats = useMemo(() => {
    if (!salaryAdvances) return { totalAdvances: 0, outstandingBalance: 0, unpaidCount: 0 };
    
    const totalAdvances = salaryAdvances.reduce((sum, adv) => sum + parseFloat(adv.amount), 0);
    const outstandingBalance = salaryAdvances.reduce((sum, adv) => sum + parseFloat(adv.remainingBalance), 0);
    const unpaidCount = salaryAdvances.filter(adv => !adv.fullyPaid).length;
    
    return { totalAdvances, outstandingBalance, unpaidCount };
  }, [salaryAdvances]);

  const employeeStaff = employees?.filter((emp) => emp.employeeType === "Employee") || [];
  const workerStaff = employees?.filter((emp) => emp.employeeType === "Worker") || [];

  // Create stable worker IDs key for dependency tracking
  const workerIds = useMemo(() => 
    workerStaff.map(w => w.id).sort().join(','),
    [workerStaff.map(w => w.id).join(',')]
  );

  // Initialize worker payments when workers load or change
  useEffect(() => {
    if (workerStaff.length > 0) {
      setWorkerPayments(prev => {
        const newPayments: Record<number, WorkerPayment> = {};
        workerStaff.forEach((worker) => {
          // Preserve existing amount if already set, otherwise use monthly salary
          newPayments[worker.id] = prev[worker.id] || {
            workerId: worker.id,
            amount: worker.monthlySalary || "0",
            selected: true,
          };
        });
        return newPayments;
      });
    } else {
      setWorkerPayments({});
    }
  }, [selectedCompany, workerIds, workerStaff]);

  const depositForm = useForm<DepositFormData>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      amount: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const withdrawalForm = useForm<WithdrawalFormData>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: {
      amount: "",
      paymentAccountType: "bank",
      paymentAccountId: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const bulkPaymentForm = useForm<BulkPaymentFormData>({
    resolver: zodResolver(bulkPaymentSchema),
    defaultValues: {
      paymentAccountType: "bank",
      paymentAccountId: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const advanceForm = useForm<SalaryAdvanceFormData>({
    resolver: zodResolver(salaryAdvanceSchema),
    defaultValues: {
      employeeId: "",
      amount: "",
      advanceDate: new Date(),
      cashAccountId: "",
      notes: "",
    },
  });

  const deductionForm = useForm<DeductionFormData>({
    resolver: zodResolver(deductionSchema),
    defaultValues: {
      deductionAmount: "",
      payrollMonth: "",
    },
  });

  const depositMutation = useMutation({
    mutationFn: async (data: DepositFormData) => {
      return await apiRequest("POST", "/api/payroll/deposit-employee", {
        employeeId: selectedEmployee?.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Salary deposited successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setDepositDialogOpen(false);
      depositForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: async (data: WithdrawalFormData) => {
      return await apiRequest("POST", "/api/payroll/withdraw-employee", {
        employeeId: selectedEmployee?.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Withdrawal processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setWithdrawalDialogOpen(false);
      withdrawalForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkPaymentMutation = useMutation({
    mutationFn: async (data: BulkPaymentFormData) => {
      const selectedPayments = Object.values(workerPayments).filter(p => p.selected);
      return await apiRequest("POST", "/api/payroll/bulk-pay-workers", {
        payments: selectedPayments,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bulk payment processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/worker-payments-summary"] });
      setBulkPaymentDialogOpen(false);
      bulkPaymentForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const advanceMutation = useMutation({
    mutationFn: async (data: SalaryAdvanceFormData) => {
      return await apiRequest("POST", "/api/salary-advances", {
        employeeId: parseInt(data.employeeId),
        amount: data.amount,
        advanceDate: format(data.advanceDate, "yyyy-MM-dd"),
        cashAccountId: parseInt(data.cashAccountId),
        notes: data.notes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Salary advance created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      setAdvanceDialogOpen(false);
      advanceForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deductionMutation = useMutation({
    mutationFn: async (data: DeductionFormData) => {
      if (!selectedAdvance) throw new Error("No advance selected");
      return await apiRequest("POST", `/api/salary-advances/${selectedAdvance.id}/deduction`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Deduction recorded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances"] });
      setDeductionDialogOpen(false);
      deductionForm.reset();
      setSelectedAdvance(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeposit = (employee: Employee) => {
    setSelectedEmployee(employee);
    setDepositDialogOpen(true);
  };

  const handleWithdrawal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setWithdrawalDialogOpen(true);
  };

  const handleRecordDeduction = (advance: SalaryAdvance) => {
    setSelectedAdvance(advance);
    setDeductionDialogOpen(true);
    deductionForm.reset();
  };

  const handleToggleWorker = (workerId: number) => {
    setWorkerPayments(prev => ({
      ...prev,
      [workerId]: {
        ...prev[workerId],
        selected: !prev[workerId]?.selected,
      },
    }));
  };

  const handleUpdateAmount = (workerId: number, amount: string) => {
    setWorkerPayments(prev => ({
      ...prev,
      [workerId]: {
        workerId,
        amount,
        selected: prev[workerId]?.selected ?? true,
      },
    }));
  };

  const handleSelectAll = () => {
    const allSelected = Object.values(workerPayments).every(p => p.selected);
    setWorkerPayments(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        updated[parseInt(key)].selected = !allSelected;
      });
      return updated;
    });
  };

  const selectedPayments = Object.values(workerPayments).filter(p => p.selected);
  const totalAmount = selectedPayments.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

  if (employeesLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Payroll</h1>
        <Card className="p-6">
          <Skeleton className="h-[400px] w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Payroll</h1>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid grid-cols-3 w-[600px]">
          <TabsTrigger value="employees" data-testid="tab-employees">
            Employees ({employeeStaff.length})
          </TabsTrigger>
          <TabsTrigger value="workers" data-testid="tab-workers">
            Workers ({workerStaff.length})
          </TabsTrigger>
          <TabsTrigger value="advances" data-testid="tab-advances">
            Salary Advances ({salaryAdvances?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Warehouse Staff (Employees)</h2>
                <p className="text-sm text-muted-foreground">
                  Employees maintain running balance accounts. Deposit salary to increase balance, withdraw to decrease.
                </p>
              </div>

              {employeeStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No employees found</p>
                  <p className="text-sm mt-2">Create employees from the Create Master Data page</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-code">Code</TableHead>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-salary" className="text-right">Monthly Salary</TableHead>
                        <TableHead data-testid="header-balance" className="text-right">Balance</TableHead>
                        <TableHead data-testid="header-total-deposits" className="text-right">Total Deposits</TableHead>
                        <TableHead data-testid="header-total-withdrawals" className="text-right">Total Withdrawals</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
                        <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeStaff.map((employee) => (
                        <TableRow key={employee.id} data-testid={`row-employee-${employee.id}`}>
                          <TableCell data-testid={`cell-code-${employee.id}`}>
                            {employee.code}
                          </TableCell>
                          <TableCell data-testid={`cell-name-${employee.id}`}>
                            {employee.firstName} {employee.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-salary-${employee.id}`} className="text-right font-mono">
                            {parseFloat(employee.monthlySalary).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-balance-${employee.id}`} className="text-right font-mono">
                            {parseFloat(employee.currentBalance).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-deposits-${employee.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(employee.totalDeposits).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-withdrawals-${employee.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(employee.totalWithdrawals).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${employee.id}`}>
                            <Badge variant={employee.active ? "default" : "secondary"}>
                              {employee.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`cell-actions-${employee.id}`} className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeposit(employee)}
                                data-testid={`button-deposit-${employee.id}`}
                              >
                                <TrendingUp className="h-4 w-4 mr-1" />
                                Deposit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleWithdrawal(employee)}
                                disabled={parseFloat(employee.currentBalance) <= 0}
                                data-testid={`button-withdraw-${employee.id}`}
                              >
                                <TrendingDown className="h-4 w-4 mr-1" />
                                Withdraw
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="workers">
          {/* Worker Payment Summary */}
          <Card className="p-6 mb-4">
            <h3 className="text-lg font-semibold mb-4">Worker Payment Summary</h3>
            {workerPaymentSummary ? (
              <div className="space-y-4">
                <div className="max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Worker Name</TableHead>
                        <TableHead className="text-right">Total Paid</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerPaymentSummary.workerPayments.map((wp) => (
                        <TableRow key={wp.workerId} data-testid={`worker-payment-${wp.workerId}`}>
                          <TableCell className="font-mono">{wp.workerCode}</TableCell>
                          <TableCell>{wp.workerName}</TableCell>
                          <TableCell className="text-right font-mono" data-testid={`text-paid-${wp.workerId}`}>
                            {parseFloat(wp.totalPaid).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <span className="text-lg font-semibold">Grand Total Paid:</span>
                  <span className="text-lg font-semibold font-mono" data-testid="text-grand-total">
                    {parseFloat(workerPaymentSummary.grandTotal).toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </Card>

          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Shop Floor Staff (Workers)</h2>
                  <p className="text-sm text-muted-foreground">
                    Select workers and adjust amounts to process bulk salary payments
                  </p>
                </div>
                <Button
                  onClick={() => setBulkPaymentDialogOpen(true)}
                  disabled={selectedPayments.length === 0}
                  data-testid="button-bulk-payment"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Pay Selected ({selectedPayments.length})
                </Button>
              </div>

              {selectedPayments.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>{selectedPayments.length} workers selected</strong> - Total payment: {totalAmount.toFixed(2)}
                  </AlertDescription>
                </Alert>
              )}

              {workerStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No workers found</p>
                  <p className="text-sm mt-2">Create workers from the Create Master Data page</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={Object.values(workerPayments).every(p => p.selected)}
                            onCheckedChange={handleSelectAll}
                            data-testid="checkbox-select-all"
                          />
                        </TableHead>
                        <TableHead data-testid="header-code">Code</TableHead>
                        <TableHead data-testid="header-name">Name</TableHead>
                        <TableHead data-testid="header-department">Department</TableHead>
                        <TableHead data-testid="header-monthly-salary" className="text-right">Monthly Salary</TableHead>
                        <TableHead data-testid="header-payment-amount" className="text-right">Payment Amount</TableHead>
                        <TableHead data-testid="header-status">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workerStaff.map((worker) => (
                        <TableRow 
                          key={worker.id} 
                          data-testid={`row-worker-${worker.id}`}
                          className={workerPayments[worker.id]?.selected ? "bg-muted/50" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={workerPayments[worker.id]?.selected || false}
                              onCheckedChange={() => handleToggleWorker(worker.id)}
                              data-testid={`checkbox-worker-${worker.id}`}
                            />
                          </TableCell>
                          <TableCell data-testid={`cell-code-${worker.id}`}>
                            {worker.code}
                          </TableCell>
                          <TableCell data-testid={`cell-name-${worker.id}`}>
                            {worker.firstName} {worker.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-department-${worker.id}`}>
                            {worker.department || "-"}
                          </TableCell>
                          <TableCell data-testid={`cell-monthly-salary-${worker.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(worker.monthlySalary).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-amount-${worker.id}`} className="text-right">
                            <Input
                              type="number"
                              step="0.01"
                              value={workerPayments[worker.id]?.amount || "0"}
                              onChange={(e) => handleUpdateAmount(worker.id, e.target.value)}
                              className="w-32 text-right font-mono ml-auto"
                              data-testid={`input-amount-${worker.id}`}
                            />
                          </TableCell>
                          <TableCell data-testid={`cell-status-${worker.id}`}>
                            <Badge variant={worker.active ? "default" : "secondary"}>
                              {worker.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="advances">
          {/* Summary Statistics */}
          <div className="grid gap-4 md:grid-cols-3 mb-4">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Advances Given</p>
                  <p className="text-2xl font-semibold font-mono" data-testid="text-total-advances">
                    ${advancesStats.totalAdvances.toFixed(2)}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-muted-foreground" />
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Outstanding Balance</p>
                  <p className="text-2xl font-semibold font-mono" data-testid="text-outstanding-balance">
                    ${advancesStats.outstandingBalance.toFixed(2)}
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-destructive" />
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Unpaid Advances</p>
                  <p className="text-2xl font-semibold" data-testid="text-unpaid-count">
                    {advancesStats.unpaidCount}
                  </p>
                </div>
                <AlertCircle className="h-8 w-8 text-orange-500" />
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Salary Advances</h2>
                  <p className="text-sm text-muted-foreground">
                    Track advances given to employees and record deductions
                  </p>
                </div>
                <Button
                  onClick={() => setAdvanceDialogOpen(true)}
                  data-testid="button-new-advance"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Advance
                </Button>
              </div>

              {advancesLoading ? (
                <Skeleton className="h-[400px] w-full" />
              ) : !salaryAdvances || salaryAdvances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No salary advances found</p>
                  <p className="text-sm mt-2">Click "New Advance" to record a salary advance</p>
                </div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead data-testid="header-employee">Employee</TableHead>
                        <TableHead data-testid="header-advance-date">Advance Date</TableHead>
                        <TableHead data-testid="header-amount" className="text-right">Amount</TableHead>
                        <TableHead data-testid="header-remaining" className="text-right">Remaining Balance</TableHead>
                        <TableHead data-testid="header-paid-status">Status</TableHead>
                        <TableHead data-testid="header-advance-actions" className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {salaryAdvances.map((advance) => (
                        <TableRow key={advance.id} data-testid={`row-advance-${advance.id}`}>
                          <TableCell data-testid={`cell-employee-${advance.id}`}>
                            <div>
                              <div className="font-medium">{advance.employeeName}</div>
                              <div className="text-sm text-muted-foreground">{advance.employeeCode}</div>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`cell-date-${advance.id}`}>
                            {format(new Date(advance.advanceDate), "MMM dd, yyyy")}
                          </TableCell>
                          <TableCell data-testid={`cell-amount-${advance.id}`} className="text-right font-mono">
                            ${parseFloat(advance.amount).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-remaining-${advance.id}`} className="text-right font-mono">
                            ${parseFloat(advance.remainingBalance).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-status-${advance.id}`}>
                            <Badge variant={advance.fullyPaid ? "default" : "secondary"} data-testid={`badge-status-${advance.id}`}>
                              {advance.fullyPaid ? "Fully Paid" : "Outstanding"}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`cell-actions-${advance.id}`} className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRecordDeduction(advance)}
                              disabled={advance.fullyPaid}
                              data-testid={`button-record-deduction-${advance.id}`}
                            >
                              Record Deduction
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Employee Deposit Dialog */}
      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent data-testid="dialog-deposit">
          <DialogHeader>
            <DialogTitle>Deposit Salary</DialogTitle>
            <DialogDescription>
              Add salary to {selectedEmployee?.firstName} {selectedEmployee?.lastName}'s balance account
            </DialogDescription>
          </DialogHeader>

          <Form {...depositForm}>
            <form onSubmit={depositForm.handleSubmit((data) => depositMutation.mutate(data))} className="space-y-4">
              <FormField
                control={depositForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-deposit-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={depositForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-deposit-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={depositForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        {...field}
                        data-testid="input-deposit-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDepositDialogOpen(false)}
                  data-testid="button-cancel-deposit"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={depositMutation.isPending} data-testid="button-submit-deposit">
                  {depositMutation.isPending ? "Processing..." : "Deposit"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Employee Withdrawal Dialog */}
      <Dialog open={withdrawalDialogOpen} onOpenChange={setWithdrawalDialogOpen}>
        <DialogContent data-testid="dialog-withdrawal">
          <DialogHeader>
            <DialogTitle>Withdraw Salary</DialogTitle>
            <DialogDescription>
              Withdraw from {selectedEmployee?.firstName} {selectedEmployee?.lastName}'s balance: {selectedEmployee?.currentBalance}
            </DialogDescription>
          </DialogHeader>

          <Form {...withdrawalForm}>
            <form onSubmit={withdrawalForm.handleSubmit((data) => withdrawalMutation.mutate(data))} className="space-y-4">
              <FormField
                control={withdrawalForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-withdrawal-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="paymentAccountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment From</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-withdrawal-account-type">
                          <SelectValue placeholder="Select account type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="bank">Bank Account</SelectItem>
                        <SelectItem value="cash">Cash Account</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="paymentAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {withdrawalForm.watch("paymentAccountType") === "cash" ? "Cash Account" : "Bank Account"}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-withdrawal-account">
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {withdrawalForm.watch("paymentAccountType") === "cash" ? (
                          cashAccounts.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No cash accounts available
                            </SelectItem>
                          ) : (
                            cashAccounts.map((account) => (
                              <SelectItem key={account.id} value={account.id.toString()}>
                                {account.name}
                              </SelectItem>
                            ))
                          )
                        ) : bankAccountsLoading ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          bankAccounts?.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.accountNumber})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-withdrawal-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={withdrawalForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        {...field}
                        data-testid="input-withdrawal-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWithdrawalDialogOpen(false)}
                  data-testid="button-cancel-withdrawal"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={withdrawalMutation.isPending} data-testid="button-submit-withdrawal">
                  {withdrawalMutation.isPending ? "Processing..." : "Withdraw"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Bulk Payment Dialog */}
      <Dialog open={bulkPaymentDialogOpen} onOpenChange={setBulkPaymentDialogOpen}>
        <DialogContent data-testid="dialog-bulk-payment" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Process Bulk Payment</DialogTitle>
            <DialogDescription>
              Pay {selectedPayments.length} workers - Total amount: {totalAmount.toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          <div className="border rounded-md p-4 mb-4 bg-muted/30 max-h-60 overflow-y-auto">
            <h4 className="font-semibold mb-3">Payment Summary</h4>
            <div className="space-y-2">
              {selectedPayments.map((payment) => {
                const worker = workerStaff.find(w => w.id === payment.workerId);
                return (
                  <div key={payment.workerId} className="flex justify-between text-sm">
                    <span>{worker?.firstName} {worker?.lastName} ({worker?.code})</span>
                    <span className="font-mono">{parseFloat(payment.amount).toFixed(2)}</span>
                  </div>
                );
              })}
              <div className="pt-2 border-t mt-3 flex justify-between font-semibold">
                <span>Total</span>
                <span className="font-mono">{totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <Form {...bulkPaymentForm}>
            <form onSubmit={bulkPaymentForm.handleSubmit((data) => bulkPaymentMutation.mutate(data))} className="space-y-4">
              <FormField
                control={bulkPaymentForm.control}
                name="paymentAccountType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment From</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-bulk-account-type">
                          <SelectValue placeholder="Select account type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="bank">Bank Account</SelectItem>
                        <SelectItem value="cash">Cash Account</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={bulkPaymentForm.control}
                name="paymentAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {bulkPaymentForm.watch("paymentAccountType") === "cash" ? "Cash Account" : "Bank Account"}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-bulk-account">
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {bulkPaymentForm.watch("paymentAccountType") === "cash" ? (
                          cashAccounts.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No cash accounts available
                            </SelectItem>
                          ) : (
                            cashAccounts.map((account) => (
                              <SelectItem key={account.id} value={account.id.toString()}>
                                {account.name}
                              </SelectItem>
                            ))
                          )
                        ) : bankAccountsLoading ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : (
                          bankAccounts?.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.accountNumber})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={bulkPaymentForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-bulk-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={bulkPaymentForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes..."
                        {...field}
                        data-testid="input-bulk-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBulkPaymentDialogOpen(false)}
                  data-testid="button-cancel-bulk"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={bulkPaymentMutation.isPending} data-testid="button-submit-bulk">
                  {bulkPaymentMutation.isPending ? "Processing..." : `Pay ${selectedPayments.length} Workers`}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* New Salary Advance Dialog */}
      <Dialog open={advanceDialogOpen} onOpenChange={setAdvanceDialogOpen}>
        <DialogContent data-testid="dialog-new-advance" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Salary Advance</DialogTitle>
            <DialogDescription>
              Record a salary advance given to an employee
            </DialogDescription>
          </DialogHeader>

          <Form {...advanceForm}>
            <form onSubmit={advanceForm.handleSubmit((data) => advanceMutation.mutate(data))} className="space-y-4">
              <FormField
                control={advanceForm.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-advance-employee">
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employeesLoading ? (
                          <SelectItem value="loading" disabled>
                            Loading...
                          </SelectItem>
                        ) : employees && employees.length > 0 ? (
                          employees.map((employee) => (
                            <SelectItem key={employee.id} value={employee.id.toString()}>
                              {employee.firstName} {employee.lastName} ({employee.code})
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="none" disabled>
                            No employees available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={advanceForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-advance-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={advanceForm.control}
                name="advanceDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Advance Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            data-testid="button-advance-date"
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={advanceForm.control}
                name="cashAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cash Account</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-advance-cash-account">
                          <SelectValue placeholder="Select cash account" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cashAccounts.length === 0 ? (
                          <SelectItem value="none" disabled>
                            No cash accounts available
                          </SelectItem>
                        ) : (
                          cashAccounts.map((account) => (
                            <SelectItem key={account.id} value={account.id.toString()}>
                              {account.name} ({account.code})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={advanceForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes / Reason (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Reason for advance..."
                        {...field}
                        data-testid="input-advance-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAdvanceDialogOpen(false)}
                  data-testid="button-cancel-advance"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={advanceMutation.isPending} data-testid="button-submit-advance">
                  {advanceMutation.isPending ? "Processing..." : "Create Advance"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Record Deduction Dialog */}
      <Dialog open={deductionDialogOpen} onOpenChange={setDeductionDialogOpen}>
        <DialogContent data-testid="dialog-record-deduction">
          <DialogHeader>
            <DialogTitle>Record Salary Deduction</DialogTitle>
            <DialogDescription>
              Record a deduction from this salary advance
            </DialogDescription>
          </DialogHeader>

          {selectedAdvance && (
            <div className="border rounded-md p-4 mb-4 bg-muted/30 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Employee:</span>
                <span className="font-medium">{selectedAdvance.employeeName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Original Amount:</span>
                <span className="font-mono">${parseFloat(selectedAdvance.amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Remaining Balance:</span>
                <span className="font-mono font-semibold" data-testid="text-deduction-remaining">
                  ${parseFloat(selectedAdvance.remainingBalance).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <Form {...deductionForm}>
            <form onSubmit={deductionForm.handleSubmit((data) => deductionMutation.mutate(data))} className="space-y-4">
              <FormField
                control={deductionForm.control}
                name="deductionAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deduction Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-deduction-amount"
                      />
                    </FormControl>
                    <FormMessage />
                    {selectedAdvance && (
                      <p className="text-sm text-muted-foreground">
                        Maximum: ${parseFloat(selectedAdvance.remainingBalance).toFixed(2)}
                      </p>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={deductionForm.control}
                name="payrollMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payroll Month</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="YYYY-MM (e.g., 2024-01)"
                        {...field}
                        data-testid="input-payroll-month"
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-sm text-muted-foreground">
                      Format: YYYY-MM (e.g., 2024-01 for January 2024)
                    </p>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeductionDialogOpen(false)}
                  data-testid="button-cancel-deduction"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={deductionMutation.isPending} data-testid="button-submit-deduction">
                  {deductionMutation.isPending ? "Processing..." : "Record Deduction"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
