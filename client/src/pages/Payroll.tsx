import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { insertEmployeeSchema } from "@shared/schema";
import { DollarSign, TrendingDown, TrendingUp, Users, AlertCircle, CalendarIcon, Plus, Pencil, Trash2, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const depositSchema = z.object({
  amount: z.string().min(1, "Amount is required"),
  date: z.string().min(1, "Date is required"),
  notes: z.string().optional(),
});

const bonusSchema = z.object({
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
type BonusFormData = z.infer<typeof bonusSchema>;
type WithdrawalFormData = z.infer<typeof withdrawalSchema>;
type BulkPaymentFormData = z.infer<typeof bulkPaymentSchema>;
type SalaryAdvanceFormData = z.infer<typeof salaryAdvanceSchema>;
type DeductionFormData = z.infer<typeof deductionSchema>;

const workerFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  code: z.string().optional(),
  monthlySalary: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Monthly salary must be >= 0"),
  department: z.string().optional(),
  active: z.boolean().default(true),
});

type WorkerFormData = z.infer<typeof workerFormSchema>;

// Employee form schema - omit companyId and employeeType since they're set in the mutation
const employeeFormSchema = insertEmployeeSchema.omit({ companyId: true, employeeType: true }).extend({
  monthlySalary: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0, "Monthly salary must be >= 0"),
  openingBalance: z.string().optional(),
  employeeGroupId: z.string().optional(),
});

type EmployeeFormData = z.infer<typeof employeeFormSchema>;

interface WorkerPayment {
  workerId: number;
  amount: string;
  selected: boolean;
  manuallyEdited?: boolean;
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
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false);
  const [bulkPaymentDialogOpen, setBulkPaymentDialogOpen] = useState(false);
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [deductionDialogOpen, setDeductionDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [selectedAdvance, setSelectedAdvance] = useState<SalaryAdvance | null>(null);
  const [newWorkerDialogOpen, setNewWorkerDialogOpen] = useState(false);
  const [editWorkerDialogOpen, setEditWorkerDialogOpen] = useState(false);
  const [selectedWorkerForEdit, setSelectedWorkerForEdit] = useState<Employee | null>(null);
  const [workerOverrides, setWorkerOverrides] = useState<Record<number, { amount?: string; selected?: boolean; manuallyEdited?: boolean }>>({});
  const [createEmployeeDialogOpen, setCreateEmployeeDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<{ employee: Employee; employeeBalance: number; ledgerBalance: number } | null>(null);
  const [deleteWorkerConflict, setDeleteWorkerConflict] = useState<{ employee: Employee; employeeBalance: number; ledgerBalance: number } | null>(null);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: employees, isLoading: employeesLoading} = useQuery<Array<Employee & { calculatedBalance: string }>>({
    queryKey: ["/api/employees", selectedCompany?.id],
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

  const { data: employeeGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/employee-groups", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Worker Groups query with members
  interface WorkerGroupWithMembers {
    id: number;
    name: string;
    description?: string;
    members: Employee[];
  }
  
  const { data: workerGroups = [] } = useQuery<WorkerGroupWithMembers[]>({
    queryKey: ["/api/worker-groups/with-members", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Worker Groups state
  const [workerGroupsExpanded, setWorkerGroupsExpanded] = useState<Record<number, boolean>>({});
  const [newWorkerGroupName, setNewWorkerGroupName] = useState("");
  const [newWorkerGroupDescription, setNewWorkerGroupDescription] = useState("");
  const [createWorkerGroupDialogOpen, setCreateWorkerGroupDialogOpen] = useState(false);
  const [selectedWorkerGroupForMembers, setSelectedWorkerGroupForMembers] = useState<WorkerGroupWithMembers | null>(null);
  const [workerGroupMembersDialogOpen, setWorkerGroupMembersDialogOpen] = useState(false);
  const [workerGroupMemberSelections, setWorkerGroupMemberSelections] = useState<Record<number, boolean>>({});

  // Employee Groups state
  const [groupsExpanded, setGroupsExpanded] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);
  const [selectedGroupForMembers, setSelectedGroupForMembers] = useState<any | null>(null);
  const [groupMembersDialogOpen, setGroupMembersDialogOpen] = useState(false);
  const [groupMemberSelections, setGroupMemberSelections] = useState<Record<number, boolean>>({});

  // Bulk Deposit state
  const [bulkDepositSelections, setBulkDepositSelections] = useState<Record<number, boolean>>({});
  const [bulkDepositDialogOpen, setBulkDepositDialogOpen] = useState(false);
  const [bulkDepositDate, setBulkDepositDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkDepositNotes, setBulkDepositNotes] = useState("");

  // Bulk Bonus state
  const [bulkBonusDialogOpen, setBulkBonusDialogOpen] = useState(false);
  const [bulkBonusDate, setBulkBonusDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkBonusNotes, setBulkBonusNotes] = useState("");
  const [bulkBonusAmounts, setBulkBonusAmounts] = useState<Record<number, string>>({});

  // Bulk Withdrawal state
  const [bulkWithdrawalDialogOpen, setBulkWithdrawalDialogOpen] = useState(false);
  const [bulkWithdrawalDate, setBulkWithdrawalDate] = useState(new Date().toISOString().split('T')[0]);
  const [bulkWithdrawalNotes, setBulkWithdrawalNotes] = useState("");
  const [bulkWithdrawalAmounts, setBulkWithdrawalAmounts] = useState<Record<number, string>>({});
  const [bulkWithdrawalAccountType, setBulkWithdrawalAccountType] = useState<"bank" | "cash">("cash");
  const [bulkWithdrawalAccountId, setBulkWithdrawalAccountId] = useState("");

  const { data: groupMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"],
    enabled: !!selectedGroupForMembers?.id,
  });

  // Employee Groups mutations
  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/employee-groups", {
        name: newGroupName,
        description: newGroupDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee group created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedCompany?.id] });
      setNewGroupName("");
      setNewGroupDescription("");
      setCreateGroupDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create employee group",
        variant: "destructive",
      });
    },
  });

  const addWorkerToGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await apiRequest("POST", `/api/employee-groups/${groupId}/members`, { employeeId: workerId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"] });
    },
  });

  const removeWorkerFromGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await apiRequest("DELETE", `/api/employee-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"] });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      await apiRequest("DELETE", `/api/employee-groups/${groupId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee group deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedCompany?.id] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete employee group",
        variant: "destructive",
      });
    },
  });

  // Worker Group mutations
  const createWorkerGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/worker-groups", {
        name: newWorkerGroupName,
        description: newWorkerGroupDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Worker group created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      setNewWorkerGroupName("");
      setNewWorkerGroupDescription("");
      setCreateWorkerGroupDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create worker group",
        variant: "destructive",
      });
    },
  });

  const addWorkerToWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await apiRequest("POST", `/api/worker-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      toast({
        title: "Success",
        description: "Worker added to group",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add worker to group",
        variant: "destructive",
      });
    },
  });

  const removeWorkerFromWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await apiRequest("DELETE", `/api/worker-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      toast({
        title: "Success",
        description: "Worker removed from group",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove worker from group",
        variant: "destructive",
      });
    },
  });

  const deleteWorkerGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      await apiRequest("DELETE", `/api/worker-groups/${groupId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Worker group deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete worker group",
        variant: "destructive",
      });
    },
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

  const employeeStaff = useMemo(
    () => employees?.filter((emp) => emp.employeeType === "Employee") || [],
    [employees]
  );
  
  const workerStaff = useMemo(
    () => employees?.filter((emp) => emp.employeeType === "Worker") || [],
    [employees]
  );

  // Calculate outstanding advances for each worker
  const workerAdvances = useMemo(() => {
    if (!salaryAdvances || !workerStaff.length) return {};
    
    const advances: Record<number, { total: number; count: number }> = {};
    workerStaff.forEach(worker => {
      const workerAdvancesList = salaryAdvances.filter(
        adv => adv.employeeId === worker.id && !adv.fullyPaid
      );
      const total = workerAdvancesList.reduce(
        (sum, adv) => sum + parseFloat(adv.remainingBalance || "0"),
        0
      );
      advances[worker.id] = {
        total,
        count: workerAdvancesList.length,
      };
    });
    return advances;
  }, [salaryAdvances, workerStaff]);

  // Compute base worker payments from salary and advances
  const computedPayments = useMemo(() => {
    const payments: Record<number, WorkerPayment> = {};
    workerStaff.forEach((worker) => {
      const monthlySalary = parseFloat(worker.monthlySalary || "0");
      const advanceAmount = workerAdvances[worker.id]?.total || 0;
      const netPayment = monthlySalary - advanceAmount;
      
      payments[worker.id] = {
        workerId: worker.id,
        amount: netPayment.toFixed(2),
        selected: true,
        manuallyEdited: false,
      };
    });
    return payments;
  }, [workerStaff, workerAdvances]);

  // Merge computed payments with manual overrides
  const workerPayments = useMemo(() => {
    const finalPayments: Record<number, WorkerPayment> = {};
    Object.keys(computedPayments).forEach((id) => {
      const workerId = parseInt(id);
      const computed = computedPayments[workerId];
      const override = workerOverrides[workerId];
      
      if (override?.manuallyEdited) {
        // Use override amount but keep other computed values
        finalPayments[workerId] = {
          ...computed,
          amount: override.amount ?? computed.amount,
          selected: override.selected ?? computed.selected,
          manuallyEdited: true,
        };
      } else {
        // Use computed values, but preserve selection state if available
        finalPayments[workerId] = {
          ...computed,
          selected: override?.selected ?? computed.selected,
        };
      }
    });
    return finalPayments;
  }, [computedPayments, workerOverrides]);

  // Clean up overrides when workers are removed
  useEffect(() => {
    const workerIds = new Set(workerStaff.map(w => w.id));
    setWorkerOverrides(prev => {
      const cleaned = { ...prev };
      let hasChanges = false;
      Object.keys(cleaned).forEach(id => {
        if (!workerIds.has(parseInt(id))) {
          delete cleaned[parseInt(id)];
          hasChanges = true;
        }
      });
      return hasChanges ? cleaned : prev;
    });
  }, [workerStaff]);

  // Compute ungrouped workers (not in any worker group)
  const ungroupedWorkers = useMemo(() => {
    const groupedWorkerIds = new Set<number>();
    workerGroups.forEach(group => {
      group.members.forEach(member => {
        groupedWorkerIds.add(member.id);
      });
    });
    return workerStaff.filter(worker => !groupedWorkerIds.has(worker.id));
  }, [workerStaff, workerGroups]);

  // Worker forms
  const newWorkerForm = useForm<WorkerFormData>({
    resolver: zodResolver(workerFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      code: "",
      monthlySalary: "0",
      department: "",
      active: true,
    },
  });

  const editWorkerForm = useForm<WorkerFormData>({
    resolver: zodResolver(workerFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      code: "",
      monthlySalary: "0",
      department: "",
      active: true,
    },
  });

  // Populate edit form when worker is selected
  useEffect(() => {
    if (selectedWorkerForEdit && editWorkerDialogOpen) {
      editWorkerForm.reset({
        firstName: selectedWorkerForEdit.firstName,
        lastName: selectedWorkerForEdit.lastName,
        code: selectedWorkerForEdit.code,
        monthlySalary: selectedWorkerForEdit.monthlySalary,
        department: selectedWorkerForEdit.department || "",
        active: selectedWorkerForEdit.active,
      });
    }
  }, [selectedWorkerForEdit, editWorkerDialogOpen, editWorkerForm]);

  const depositForm = useForm<DepositFormData>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      amount: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const bonusForm = useForm<BonusFormData>({
    resolver: zodResolver(bonusSchema),
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

  const createEmployeeForm = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      code: "",
      monthlySalary: "0",
      department: "",
      joinDate: new Date().toISOString().split('T')[0],
      openingBalance: "",
      active: true,
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

  const bonusMutation = useMutation({
    mutationFn: async (data: BonusFormData) => {
      return await apiRequest("POST", "/api/payroll/bonus-employee", {
        employeeId: selectedEmployee?.id,
        ...data,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bonus given successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setBonusDialogOpen(false);
      bonusForm.reset();
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
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

  const bulkDepositMutation = useMutation({
    mutationFn: async () => {
      // Only include employees with valid salaries
      const selectedEmployees = employeeStaff.filter(emp => bulkDepositSelections[emp.id]);
      const validEmployees = selectedEmployees.filter(emp => {
        const salary = parseFloat(emp.monthlySalary || "0");
        return !isNaN(salary) && salary > 0;
      });
      if (validEmployees.length === 0) {
        throw new Error("No employees with valid salary amounts selected");
      }
      const deposits = validEmployees.map(emp => ({
        employeeId: emp.id,
        amount: emp.monthlySalary,
      }));
      return await apiRequest("POST", "/api/payroll/bulk-deposit-employees", {
        deposits,
        date: bulkDepositDate,
        notes: bulkDepositNotes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bulk salary deposit processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setBulkDepositDialogOpen(false);
      setBulkDepositSelections({});
      setBulkDepositNotes("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkBonusMutation = useMutation({
    mutationFn: async () => {
      const bonuses = Object.entries(bulkBonusAmounts)
        .filter(([_, amount]) => {
          const parsed = parseFloat(amount);
          return !isNaN(parsed) && parsed > 0;
        })
        .map(([employeeId, amount]) => ({
          employeeId: parseInt(employeeId),
          amount,
        }));
      if (bonuses.length === 0) {
        throw new Error("No valid bonus amounts entered");
      }
      return await apiRequest("POST", "/api/payroll/bulk-bonus-employees", {
        bonuses,
        date: bulkBonusDate,
        notes: bulkBonusNotes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bulk bonus deposit processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setBulkBonusDialogOpen(false);
      setBulkBonusAmounts({});
      setBulkBonusNotes("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkWithdrawalMutation = useMutation({
    mutationFn: async () => {
      const withdrawals = Object.entries(bulkWithdrawalAmounts)
        .filter(([_, amount]) => {
          const parsed = parseFloat(amount);
          return !isNaN(parsed) && parsed > 0;
        })
        .map(([employeeId, amount]) => ({
          employeeId: parseInt(employeeId),
          amount,
        }));
      if (withdrawals.length === 0) {
        throw new Error("No valid withdrawal amounts entered");
      }
      if (!bulkWithdrawalAccountId) {
        throw new Error("Please select a payment account");
      }
      return await apiRequest("POST", "/api/payroll/bulk-withdraw-employees", {
        withdrawals,
        date: bulkWithdrawalDate,
        notes: bulkWithdrawalNotes,
        paymentAccountType: bulkWithdrawalAccountType,
        paymentAccountId: bulkWithdrawalAccountId,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bulk withdrawal processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setBulkWithdrawalDialogOpen(false);
      setBulkWithdrawalAmounts({});
      setBulkWithdrawalNotes("");
      setBulkWithdrawalAccountId("");
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
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
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

  const createWorkerMutation = useMutation({
    mutationFn: async (data: WorkerFormData) => {
      return await apiRequest("POST", "/api/employees", {
        ...data,
        employeeType: "Worker",
        companyId: selectedCompany?.id,
        joinDate: new Date().toISOString().split("T")[0],
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Worker created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setNewWorkerDialogOpen(false);
      newWorkerForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateWorkerMutation = useMutation({
    mutationFn: async (data: WorkerFormData & { id: number }) => {
      return await apiRequest("PUT", `/api/employees/${data.id}`, {
        ...data,
        employeeType: "Worker",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Worker updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setEditWorkerDialogOpen(false);
      editWorkerForm.reset();
      setSelectedWorkerForEdit(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteWorkerMutation = useMutation({
    mutationFn: async ({ id, forceDelete = false }: { id: number; forceDelete?: boolean }) => {
      const queryParam = forceDelete ? "?forceDelete=true" : "";
      return await apiRequest("DELETE", `/api/employees/${id}${queryParam}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Worker deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setSelectedWorkerForEdit(null);
    },
    onError: (error: any) => {
      // Don't show toast for 409 - let the confirmation dialog handle it
      if (error.status !== 409) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
        setSelectedWorkerForEdit(null);
      }
    },
  });

  // Employee mutations
  const createEmployeeMutation = useMutation({
    mutationFn: async (data: EmployeeFormData) => {
      if (!selectedCompany?.id) throw new Error("No company selected");
      const { employeeGroupId, ...employeeData } = data;
      const payload: any = {
        ...employeeData,
        companyId: selectedCompany.id,
        employeeType: "Employee",
        monthlySalary: data.monthlySalary || "0",
        openingBalance: data.openingBalance || "0",
      };
      
      // Include employeeGroupId if selected (parse from string to number)
      if (employeeGroupId && employeeGroupId !== "" && employeeGroupId !== "none") {
        payload.employeeGroupId = parseInt(employeeGroupId, 10);
      }
      
      return await apiRequest("POST", "/api/employees", payload);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedCompany?.id] });
      setCreateEmployeeDialogOpen(false);
      createEmployeeForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteEmployeeMutation = useMutation({
    mutationFn: async ({ id, forceDelete = false }: { id: number; forceDelete?: boolean }) => {
      const queryParam = forceDelete ? "?forceDelete=true" : "";
      return await apiRequest("DELETE", `/api/employees/${id}${queryParam}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setEmployeeToDelete(null);
    },
    onError: (error: any) => {
      // Don't show toast for 409 - let the confirmation dialog handle it
      if (error.status !== 409) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive",
        });
        setEmployeeToDelete(null);
      }
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

  const handleBonus = (employee: Employee) => {
    setSelectedEmployee(employee);
    setBonusDialogOpen(true);
  };

  const handleRecordDeduction = (advance: SalaryAdvance) => {
    setSelectedAdvance(advance);
    setDeductionDialogOpen(true);
    deductionForm.reset();
  };

  const handleDeleteEmployee = async (employee: Employee) => {
    try {
      await deleteEmployeeMutation.mutateAsync({ id: employee.id, forceDelete: false });
    } catch (error: any) {
      if (error.status === 409 && error.requiresConfirmation) {
        // Balance exists - show second confirmation dialog with balance details
        setDeleteConflict({
          employee,
          employeeBalance: error.employeeBalance || 0,
          ledgerBalance: error.ledgerBalance || 0,
        });
      }
    }
  };

  const handleForceDeleteEmployee = async () => {
    if (!deleteConflict) return;
    
    try {
      await deleteEmployeeMutation.mutateAsync({ id: deleteConflict.employee.id, forceDelete: true });
      setDeleteConflict(null);
    } catch (error: any) {
      // Error will be handled by mutation's onError
      setDeleteConflict(null);
    }
  };

  const handleDeleteWorker = async (worker: Employee) => {
    try {
      await deleteWorkerMutation.mutateAsync({ id: worker.id, forceDelete: false });
    } catch (error: any) {
      if (error.status === 409 && error.requiresConfirmation) {
        // Balance exists - show second confirmation dialog with balance details
        setDeleteWorkerConflict({
          employee: worker,
          employeeBalance: error.employeeBalance || 0,
          ledgerBalance: error.ledgerBalance || 0,
        });
      }
    }
  };

  const handleForceDeleteWorker = async () => {
    if (!deleteWorkerConflict) return;
    
    try {
      await deleteWorkerMutation.mutateAsync({ id: deleteWorkerConflict.employee.id, forceDelete: true });
      setDeleteWorkerConflict(null);
    } catch (error: any) {
      // Error will be handled by mutation's onError
      setDeleteWorkerConflict(null);
    }
  };

  const handleToggleWorker = (workerId: number) => {
    setWorkerOverrides(prev => ({
      ...prev,
      [workerId]: {
        ...prev[workerId],
        selected: !(workerPayments[workerId]?.selected ?? true),
      },
    }));
  };

  const handleUpdateAmount = (workerId: number, amount: string) => {
    setWorkerOverrides(prev => ({
      ...prev,
      [workerId]: {
        ...prev[workerId],
        amount,
        manuallyEdited: true,
      },
    }));
  };

  const handleSelectAll = () => {
    const allSelected = Object.values(workerPayments).every(p => p.selected);
    const newSelected = !allSelected;
    setWorkerOverrides(prev => {
      const updated = { ...prev };
      Object.keys(workerPayments).forEach(id => {
        updated[parseInt(id)] = {
          ...updated[parseInt(id)],
          selected: newSelected,
        };
      });
      return updated;
    });
  };

  const selectedPayments = Object.values(workerPayments).filter(p => p.selected);
  const totalAmount = selectedPayments.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

  // Bulk Deposit helpers
  const handleToggleEmployeeDeposit = (employeeId: number) => {
    setBulkDepositSelections(prev => ({
      ...prev,
      [employeeId]: !prev[employeeId],
    }));
  };

  const handleSelectAllEmployees = () => {
    const allSelected = employeeStaff.every(emp => bulkDepositSelections[emp.id]);
    if (allSelected) {
      setBulkDepositSelections({});
    } else {
      const newSelections: Record<number, boolean> = {};
      employeeStaff.forEach(emp => {
        newSelections[emp.id] = true;
      });
      setBulkDepositSelections(newSelections);
    }
  };

  const selectedEmployeesForDeposit = employeeStaff.filter(emp => bulkDepositSelections[emp.id]);
  const validSelectedEmployees = selectedEmployeesForDeposit.filter(emp => {
    const salary = parseFloat(emp.monthlySalary || "0");
    return !isNaN(salary) && salary > 0;
  });
  const bulkDepositTotal = validSelectedEmployees.reduce(
    (sum, emp) => sum + parseFloat(emp.monthlySalary || "0"),
    0
  );
  const hasInvalidSalaries = selectedEmployeesForDeposit.length !== validSelectedEmployees.length;

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
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-lg font-semibold">Warehouse Staff (Employees)</h2>
                  <p className="text-sm text-muted-foreground">
                    Employees maintain running balance accounts. Deposit salary to increase balance, withdraw to decrease.
                  </p>
                </div>
                <Button
                  onClick={() => setCreateEmployeeDialogOpen(true)}
                  data-testid="button-create-employee"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create Employee
                </Button>
              </div>

              {/* Employee Groups Management */}
              <Collapsible open={groupsExpanded} onOpenChange={setGroupsExpanded}>
                <Card className="border-dashed">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="w-full flex items-center justify-between p-4 hover-elevate"
                      data-testid="button-toggle-groups"
                    >
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        <span className="font-medium">Employee Groups ({employeeGroups.length})</span>
                      </div>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          groupsExpanded && "rotate-180"
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <p className="text-sm text-muted-foreground">
                          Organize employees into groups for easier management
                        </p>
                        <Button
                          size="sm"
                          onClick={() => setCreateGroupDialogOpen(true)}
                          data-testid="button-create-group"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Create Group
                        </Button>
                      </div>
                      
                      {employeeGroups.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground">
                          <p className="text-sm">No groups created yet</p>
                        </div>
                      ) : (
                        <div className="border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead data-testid="header-group-name">Group Name</TableHead>
                                <TableHead data-testid="header-group-description">Description</TableHead>
                                <TableHead data-testid="header-group-actions" className="text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {employeeGroups.map((group: any) => (
                                <TableRow key={group.id} data-testid={`row-group-${group.id}`}>
                                  <TableCell data-testid={`cell-group-name-${group.id}`}>
                                    {group.name}
                                  </TableCell>
                                  <TableCell data-testid={`cell-group-description-${group.id}`} className="text-muted-foreground">
                                    {group.description || "—"}
                                  </TableCell>
                                  <TableCell data-testid={`cell-group-actions-${group.id}`} className="text-right">
                                    <ConfirmationDialog
                                      trigger={
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          data-testid={`button-delete-group-${group.id}`}
                                        >
                                          <Trash2 className="h-4 w-4 mr-1" />
                                          Delete
                                        </Button>
                                      }
                                      title="Delete Employee Group"
                                      description={`Are you sure you want to delete the group "${group.name}"? This will remove all employee assignments to this group.`}
                                      onConfirm={() => deleteGroupMutation.mutate(group.id)}
                                      confirmText="Delete"
                                      cancelText="Cancel"
                                    />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Bulk Deposit Section */}
              {selectedEmployeesForDeposit.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span>
                      <strong>{selectedEmployeesForDeposit.length} employees selected</strong> - Total deposit: {bulkDepositTotal.toFixed(2)}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => setBulkDepositDialogOpen(true)}
                      data-testid="button-bulk-deposit"
                    >
                      <TrendingUp className="h-4 w-4 mr-1" />
                      Deposit Selected ({selectedEmployeesForDeposit.length})
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Bulk Bonus & Withdrawal Buttons */}
              {employeeStaff.length > 0 && (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBulkBonusAmounts({});
                      setBulkBonusDialogOpen(true);
                    }}
                    data-testid="button-open-bulk-bonus"
                  >
                    <DollarSign className="h-4 w-4 mr-1" />
                    Bulk Bonus Deposit
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBulkWithdrawalAmounts({});
                      setBulkWithdrawalAccountId("");
                      setBulkWithdrawalDialogOpen(true);
                    }}
                    data-testid="button-open-bulk-withdrawal"
                  >
                    <TrendingDown className="h-4 w-4 mr-1" />
                    Bulk Withdrawal
                  </Button>
                </div>
              )}

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
                        <TableHead className="w-12">
                          <Checkbox
                            checked={employeeStaff.length > 0 && employeeStaff.every(emp => bulkDepositSelections[emp.id])}
                            onCheckedChange={handleSelectAllEmployees}
                            data-testid="checkbox-select-all-employees"
                          />
                        </TableHead>
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
                      {employeeStaff.map((employee) => {
                        // Use the calculated balance from the API
                        const balance = parseFloat(employee.calculatedBalance || "0");
                        
                        return (
                        <TableRow 
                          key={employee.id} 
                          data-testid={`row-employee-${employee.id}`}
                          className={bulkDepositSelections[employee.id] ? "bg-muted/50" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={bulkDepositSelections[employee.id] || false}
                              onCheckedChange={() => handleToggleEmployeeDeposit(employee.id)}
                              data-testid={`checkbox-employee-${employee.id}`}
                            />
                          </TableCell>
                          <TableCell data-testid={`cell-name-${employee.id}`}>
                            {employee.firstName} {employee.lastName}
                          </TableCell>
                          <TableCell data-testid={`cell-salary-${employee.id}`} className="text-right font-mono">
                            {parseFloat(employee.monthlySalary).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-balance-${employee.id}`} className="text-right font-mono">
                            {balance.toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-deposits-${employee.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(employee.totalDeposits || "0").toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`cell-withdrawals-${employee.id}`} className="text-right font-mono text-muted-foreground">
                            {parseFloat(employee.totalWithdrawals || "0").toFixed(2)}
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
                                onClick={() => handleBonus(employee)}
                                data-testid={`button-bonus-${employee.id}`}
                              >
                                <DollarSign className="h-4 w-4 mr-1" />
                                Bonus
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleWithdrawal(employee)}
                                disabled={balance <= 0}
                                data-testid={`button-withdraw-${employee.id}`}
                              >
                                <TrendingDown className="h-4 w-4 mr-1" />
                                Withdraw
                              </Button>
                              <ConfirmationDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    data-testid={`button-delete-${employee.id}`}
                                  >
                                    <Trash2 className="h-4 w-4 mr-1" />
                                    Delete
                                  </Button>
                                }
                                title="Delete Employee"
                                description={`Are you sure you want to delete ${employee.firstName} ${employee.lastName}? This action cannot be undone.`}
                                confirmText="Delete"
                                variant="destructive"
                                onConfirm={() => handleDeleteEmployee(employee)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                      })}
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
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-semibold">Worker Payment Summary</h3>
              <Button
                onClick={() => setNewWorkerDialogOpen(true)}
                data-testid="button-create-worker"
              >
                <Plus className="h-4 w-4 mr-1" />
                Create Workers
              </Button>
            </div>
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
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Bulk Worker Payments</h2>
                  <p className="text-sm text-muted-foreground">
                    Select workers and adjust amounts to process bulk salary payments
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCreateWorkerGroupDialogOpen(true)}
                    data-testid="button-create-worker-group"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Group
                  </Button>
                  <Button
                    onClick={() => setBulkPaymentDialogOpen(true)}
                    disabled={selectedPayments.length === 0}
                    data-testid="button-bulk-payment"
                  >
                    <Users className="h-4 w-4 mr-2" />
                    Pay Selected ({selectedPayments.length})
                  </Button>
                </div>
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
                <div className="space-y-4">
                  {/* Worker Groups */}
                  {workerGroups.map((group) => {
                    const isExpanded = workerGroupsExpanded[group.id] ?? true;
                    const groupMembers = group.members || [];
                    const groupTotal = groupMembers.reduce((sum, member) => {
                      const payment = workerPayments[member.id];
                      return sum + (payment?.selected ? parseFloat(payment.amount || "0") : 0);
                    }, 0);
                    const selectedCount = groupMembers.filter(m => workerPayments[m.id]?.selected).length;
                    
                    return (
                      <Collapsible
                        key={group.id}
                        open={isExpanded}
                        onOpenChange={(open) => setWorkerGroupsExpanded(prev => ({ ...prev, [group.id]: open }))}
                      >
                        <Card className="border">
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between p-4 cursor-pointer hover-elevate">
                              <div className="flex items-center gap-3">
                                <ChevronDown className={cn("h-5 w-5 transition-transform", isExpanded && "rotate-180")} />
                                <div>
                                  <h3 className="font-semibold">{group.name}</h3>
                                  <p className="text-sm text-muted-foreground">
                                    {groupMembers.length} workers - {selectedCount} selected - Total: {groupTotal.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedWorkerGroupForMembers(group);
                                    setWorkerGroupMembersDialogOpen(true);
                                    // Initialize selections
                                    const selections: Record<number, boolean> = {};
                                    groupMembers.forEach(m => { selections[m.id] = true; });
                                    setWorkerGroupMemberSelections(selections);
                                  }}
                                  data-testid={`button-manage-group-${group.id}`}
                                >
                                  <Pencil className="h-4 w-4 mr-1" />
                                  Manage
                                </Button>
                                <ConfirmationDialog
                                  trigger={
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      data-testid={`button-delete-group-${group.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  }
                                  title="Delete Worker Group"
                                  description={`Are you sure you want to delete the group "${group.name}"? Workers will not be deleted but will become ungrouped.`}
                                  confirmText="Delete"
                                  variant="destructive"
                                  onConfirm={() => deleteWorkerGroupMutation.mutate(group.id)}
                                />
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-12">
                                      <Checkbox
                                        checked={groupMembers.every(m => workerPayments[m.id]?.selected)}
                                        onCheckedChange={(checked) => {
                                          groupMembers.forEach(member => {
                                            setWorkerOverrides(prev => ({
                                              ...prev,
                                              [member.id]: {
                                                ...prev[member.id],
                                                selected: !!checked,
                                              }
                                            }));
                                          });
                                        }}
                                        data-testid={`checkbox-select-all-group-${group.id}`}
                                      />
                                    </TableHead>
                                    <TableHead data-testid="header-name">Name</TableHead>
                                    <TableHead data-testid="header-monthly-salary" className="text-right">Monthly Salary</TableHead>
                                    <TableHead data-testid="header-advances" className="text-right">Advances</TableHead>
                                    <TableHead data-testid="header-payment-amount" className="text-right">Payment Amount</TableHead>
                                    <TableHead data-testid="header-actions" className="w-16">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {groupMembers.map((worker) => {
                                    const advanceInfo = workerAdvances[worker.id] || { total: 0, count: 0 };
                                    const monthlySalary = parseFloat(worker.monthlySalary || "0");
                                    const paymentAmount = parseFloat(workerPayments[worker.id]?.amount || "0");
                                    const hasNegativePayment = paymentAmount < 0;
                                    
                                    return (
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
                                        <TableCell data-testid={`cell-name-${worker.id}`}>
                                          {worker.firstName} {worker.lastName}
                                        </TableCell>
                                        <TableCell data-testid={`cell-monthly-salary-${worker.id}`} className="text-right font-mono text-muted-foreground">
                                          {monthlySalary.toFixed(2)}
                                        </TableCell>
                                        <TableCell data-testid={`cell-advances-${worker.id}`} className="text-right font-mono">
                                          {advanceInfo.total > 0 ? (
                                            <span className="text-destructive">
                                              {advanceInfo.total.toFixed(2)}
                                              {advanceInfo.count > 0 && (
                                                <span className="text-xs text-muted-foreground ml-1">
                                                  ({advanceInfo.count})
                                                </span>
                                              )}
                                            </span>
                                          ) : (
                                            "-"
                                          )}
                                        </TableCell>
                                        <TableCell data-testid={`cell-amount-${worker.id}`} className="text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <Input
                                              type="number"
                                              step="0.01"
                                              value={workerPayments[worker.id]?.amount || "0"}
                                              onChange={(e) => handleUpdateAmount(worker.id, e.target.value)}
                                              className={cn(
                                                "w-32 text-right font-mono",
                                                hasNegativePayment && "border-destructive"
                                              )}
                                              data-testid={`input-amount-${worker.id}`}
                                            />
                                            {hasNegativePayment && (
                                              <AlertCircle className="h-4 w-4 text-destructive" />
                                            )}
                                          </div>
                                        </TableCell>
                                        <TableCell>
                                          <ConfirmationDialog
                                            trigger={
                                              <Button
                                                size="icon"
                                                variant="ghost"
                                                className="text-destructive hover:text-destructive"
                                                data-testid={`button-delete-worker-${worker.id}`}
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            }
                                            title="Delete Worker"
                                            description={`Are you sure you want to delete ${worker.firstName} ${worker.lastName}? This action cannot be undone.`}
                                            confirmText="Delete"
                                            variant="destructive"
                                            onConfirm={() => handleDeleteWorker(worker)}
                                          />
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    );
                  })}

                  {/* Ungrouped Workers */}
                  {ungroupedWorkers.length > 0 && (
                    <Card className="border">
                      <div className="p-4">
                        <h3 className="font-semibold text-muted-foreground">Ungrouped Workers</h3>
                        <p className="text-sm text-muted-foreground">
                          {ungroupedWorkers.length} workers not assigned to any group
                        </p>
                      </div>
                      <div className="border-t">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-12">
                                <Checkbox
                                  checked={ungroupedWorkers.every(w => workerPayments[w.id]?.selected)}
                                  onCheckedChange={(checked) => {
                                    ungroupedWorkers.forEach(worker => {
                                      setWorkerOverrides(prev => ({
                                        ...prev,
                                        [worker.id]: {
                                          ...prev[worker.id],
                                          selected: !!checked,
                                        }
                                      }));
                                    });
                                  }}
                                  data-testid="checkbox-select-all-ungrouped"
                                />
                              </TableHead>
                              <TableHead data-testid="header-name">Name</TableHead>
                              <TableHead data-testid="header-monthly-salary" className="text-right">Monthly Salary</TableHead>
                              <TableHead data-testid="header-advances" className="text-right">Advances</TableHead>
                              <TableHead data-testid="header-payment-amount" className="text-right">Payment Amount</TableHead>
                              <TableHead data-testid="header-actions" className="w-16">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ungroupedWorkers.map((worker) => {
                              const advanceInfo = workerAdvances[worker.id] || { total: 0, count: 0 };
                              const monthlySalary = parseFloat(worker.monthlySalary || "0");
                              const paymentAmount = parseFloat(workerPayments[worker.id]?.amount || "0");
                              const hasNegativePayment = paymentAmount < 0;
                              
                              return (
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
                                  <TableCell data-testid={`cell-name-${worker.id}`}>
                                    {worker.firstName} {worker.lastName}
                                  </TableCell>
                                  <TableCell data-testid={`cell-monthly-salary-${worker.id}`} className="text-right font-mono text-muted-foreground">
                                    {monthlySalary.toFixed(2)}
                                  </TableCell>
                                  <TableCell data-testid={`cell-advances-${worker.id}`} className="text-right font-mono">
                                    {advanceInfo.total > 0 ? (
                                      <span className="text-destructive">
                                        {advanceInfo.total.toFixed(2)}
                                        {advanceInfo.count > 0 && (
                                          <span className="text-xs text-muted-foreground ml-1">
                                            ({advanceInfo.count})
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      "-"
                                    )}
                                  </TableCell>
                                  <TableCell data-testid={`cell-amount-${worker.id}`} className="text-right">
                                    <div className="flex items-center justify-end gap-2">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        value={workerPayments[worker.id]?.amount || "0"}
                                        onChange={(e) => handleUpdateAmount(worker.id, e.target.value)}
                                        className={cn(
                                          "w-32 text-right font-mono",
                                          hasNegativePayment && "border-destructive"
                                        )}
                                        data-testid={`input-amount-${worker.id}`}
                                      />
                                      {hasNegativePayment && (
                                        <AlertCircle className="h-4 w-4 text-destructive" />
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <ConfirmationDialog
                                      trigger={
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="text-destructive hover:text-destructive"
                                          data-testid={`button-delete-worker-${worker.id}`}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      }
                                      title="Delete Worker"
                                      description={`Are you sure you want to delete ${worker.firstName} ${worker.lastName}? This action cannot be undone.`}
                                      confirmText="Delete"
                                      variant="destructive"
                                      onConfirm={() => handleDeleteWorker(worker)}
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </Card>
                  )}

                  {/* If no groups and no ungrouped workers but workerStaff has items (edge case) */}
                  {workerGroups.length === 0 && ungroupedWorkers.length === 0 && workerStaff.length > 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Workers are being loaded...</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Create Worker Group Dialog */}
          <Dialog open={createWorkerGroupDialogOpen} onOpenChange={setCreateWorkerGroupDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Worker Group</DialogTitle>
                <DialogDescription>
                  Create a new group to organize workers for bulk payments
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="worker-group-name">Group Name</Label>
                  <Input
                    id="worker-group-name"
                    value={newWorkerGroupName}
                    onChange={(e) => setNewWorkerGroupName(e.target.value)}
                    placeholder="e.g., Factory A, Construction Team"
                    data-testid="input-worker-group-name"
                  />
                </div>
                <div>
                  <Label htmlFor="worker-group-description">Description (Optional)</Label>
                  <Textarea
                    id="worker-group-description"
                    value={newWorkerGroupDescription}
                    onChange={(e) => setNewWorkerGroupDescription(e.target.value)}
                    placeholder="Brief description of this group"
                    data-testid="input-worker-group-description"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setCreateWorkerGroupDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createWorkerGroupMutation.mutate()}
                    disabled={!newWorkerGroupName.trim() || createWorkerGroupMutation.isPending}
                    data-testid="button-confirm-create-group"
                  >
                    {createWorkerGroupMutation.isPending ? "Creating..." : "Create Group"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Manage Worker Group Members Dialog */}
          <Dialog open={workerGroupMembersDialogOpen} onOpenChange={setWorkerGroupMembersDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Manage Group: {selectedWorkerGroupForMembers?.name}</DialogTitle>
                <DialogDescription>
                  Add or remove workers from this group
                </DialogDescription>
              </DialogHeader>
              {(() => {
                // Use live query data to get current group membership
                const currentGroup = workerGroups.find(g => g.id === selectedWorkerGroupForMembers?.id);
                const currentMembers = currentGroup?.members || [];
                
                return (
                  <div className="space-y-4">
                    <h4 className="font-medium">Available Workers</h4>
                    <div className="border rounded-md max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">In Group</TableHead>
                            <TableHead>Name</TableHead>
                            <TableHead className="text-right">Monthly Salary</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {workerStaff.map((worker) => {
                            // Use live data to check membership
                            const isInGroup = currentMembers.some(m => m.id === worker.id);
                            
                            return (
                              <TableRow key={worker.id} data-testid={`row-member-${worker.id}`}>
                                <TableCell>
                                  <Checkbox
                                    checked={isInGroup}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        addWorkerToWorkerGroupMutation.mutate({
                                          groupId: selectedWorkerGroupForMembers!.id,
                                          workerId: worker.id,
                                        });
                                      } else {
                                        removeWorkerFromWorkerGroupMutation.mutate({
                                          groupId: selectedWorkerGroupForMembers!.id,
                                          workerId: worker.id,
                                        });
                                      }
                                    }}
                                    disabled={addWorkerToWorkerGroupMutation.isPending || removeWorkerFromWorkerGroupMutation.isPending}
                                    data-testid={`checkbox-member-${worker.id}`}
                                  />
                                </TableCell>
                                <TableCell>{worker.firstName} {worker.lastName}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {parseFloat(worker.monthlySalary || "0").toFixed(2)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={() => setWorkerGroupMembersDialogOpen(false)}>
                        Done
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="advances">
          {(() => {
            // Filter advances to show only workers
            const workerAdvancesList = salaryAdvances?.filter(adv => 
              workerStaff.some(worker => worker.id === adv.employeeId)
            ) || [];
            
            // Recalculate stats for workers only
            const workerAdvancesStats = {
              totalAdvances: workerAdvancesList.reduce((sum, adv) => sum + parseFloat(adv.amount), 0),
              outstandingBalance: workerAdvancesList.reduce((sum, adv) => sum + parseFloat(adv.remainingBalance), 0),
              unpaidCount: workerAdvancesList.filter(adv => !adv.fullyPaid).length,
            };
            
            return (
              <>
                {/* Summary Statistics */}
                <div className="grid gap-4 md:grid-cols-3 mb-4">
                  <Card className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">Total Advances Given</p>
                        <p className="text-2xl font-semibold font-mono" data-testid="text-total-advances">
                          ${workerAdvancesStats.totalAdvances.toFixed(2)}
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
                          ${workerAdvancesStats.outstandingBalance.toFixed(2)}
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
                          {workerAdvancesStats.unpaidCount}
                        </p>
                      </div>
                      <AlertCircle className="h-8 w-8 text-orange-500" />
                    </div>
                  </Card>
                </div>

                {/* Worker Management Section */}
                <Card className="p-6 mb-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">Manage Workers</h2>
                        <p className="text-sm text-muted-foreground">
                          Add, edit, or remove workers from this company
                        </p>
                      </div>
                      <Button
                        onClick={() => setNewWorkerDialogOpen(true)}
                        data-testid="button-new-worker"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        New Worker
                      </Button>
                    </div>

                    {workerStaff.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <p className="text-sm">No workers found. Click "New Worker" to add one.</p>
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        {workerStaff.map((worker) => {
                          const advanceInfo = workerAdvances[worker.id] || { total: 0, count: 0 };
                          const hasAdvances = advanceInfo.total > 0;
                          const balance = parseFloat(worker.currentBalance || "0");
                          const canDelete = !hasAdvances && balance === 0;
                          
                          return (
                            <div
                              key={worker.id}
                              className="flex items-center justify-between p-3 border rounded-md hover-elevate"
                              data-testid={`worker-row-${worker.id}`}
                            >
                              <div className="flex items-center gap-4">
                                <div>
                                  <div className="font-medium">
                                    {worker.firstName} {worker.lastName}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {worker.code} • Salary: ${parseFloat(worker.monthlySalary).toFixed(2)}
                                  </div>
                                </div>
                                {hasAdvances && (
                                  <Badge variant="secondary" className="text-destructive">
                                    ${advanceInfo.total.toFixed(2)} advance
                                  </Badge>
                                )}
                                {balance !== 0 && (
                                  <Badge variant="secondary">
                                    Balance: ${balance.toFixed(2)}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedWorkerForEdit(worker);
                                    setEditWorkerDialogOpen(true);
                                  }}
                                  data-testid={`button-edit-worker-${worker.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <ConfirmationDialog
                                  trigger={
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      data-testid={`button-delete-worker-${worker.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  }
                                  title="Delete Worker"
                                  description={`Are you sure you want to delete ${worker.firstName} ${worker.lastName}? This action cannot be undone.`}
                                  confirmText="Delete"
                                  variant="destructive"
                                  onConfirm={() => handleDeleteWorker(worker)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">Salary Advances (Workers Only)</h2>
                        <p className="text-sm text-muted-foreground">
                          Track advances given to workers and record deductions
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
                    ) : workerStaff.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>No workers found</p>
                        <p className="text-sm mt-2">Create workers from the Workers tab or Create Master Data page</p>
                      </div>
                    ) : workerAdvancesList.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <p>No salary advances found for workers</p>
                        <p className="text-sm mt-2">Click "New Advance" to record a salary advance for a worker</p>
                      </div>
                    ) : (
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead data-testid="header-employee">Worker</TableHead>
                              <TableHead data-testid="header-advance-date">Advance Date</TableHead>
                              <TableHead data-testid="header-amount" className="text-right">Amount</TableHead>
                              <TableHead data-testid="header-remaining" className="text-right">Remaining Balance</TableHead>
                              <TableHead data-testid="header-paid-status">Status</TableHead>
                              <TableHead data-testid="header-advance-actions" className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {workerAdvancesList.map((advance) => (
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
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleRecordDeduction(advance)}
                                      disabled={advance.fullyPaid}
                                      data-testid={`button-record-deduction-${advance.id}`}
                                    >
                                      Record Deduction
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
              </>
            );
          })()}
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

      {/* Employee Bonus Dialog */}
      <Dialog open={bonusDialogOpen} onOpenChange={setBonusDialogOpen}>
        <DialogContent data-testid="dialog-bonus">
          <DialogHeader>
            <DialogTitle>Give Bonus</DialogTitle>
            <DialogDescription>
              Give a bonus to {selectedEmployee?.firstName} {selectedEmployee?.lastName}
            </DialogDescription>
          </DialogHeader>

          <Form {...bonusForm}>
            <form onSubmit={bonusForm.handleSubmit((data) => bonusMutation.mutate(data))} className="space-y-4">
              <FormField
                control={bonusForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bonus Amount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-bonus-amount"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={bonusForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-bonus-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={bonusForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Reason for bonus..."
                        {...field}
                        data-testid="input-bonus-notes"
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
                  onClick={() => setBonusDialogOpen(false)}
                  data-testid="button-cancel-bonus"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={bonusMutation.isPending} data-testid="button-submit-bonus">
                  {bonusMutation.isPending ? "Processing..." : "Give Bonus"}
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

      {/* New Worker Dialog */}
      <Dialog open={newWorkerDialogOpen} onOpenChange={setNewWorkerDialogOpen}>
        <DialogContent data-testid="dialog-new-worker">
          <DialogHeader>
            <DialogTitle>Add New Worker</DialogTitle>
            <DialogDescription>
              Create a new worker for this company
            </DialogDescription>
          </DialogHeader>

          <Form {...newWorkerForm}>
            <form onSubmit={newWorkerForm.handleSubmit((data) => createWorkerMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={newWorkerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-new-worker-firstname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={newWorkerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-new-worker-lastname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={newWorkerForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker Code (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Auto-generated if left blank" {...field} data-testid="input-new-worker-code" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newWorkerForm.control}
                name="monthlySalary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Salary</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        {...field}
                        data-testid="input-new-worker-salary"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newWorkerForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-new-worker-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={newWorkerForm.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-new-worker-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewWorkerDialogOpen(false)}
                  data-testid="button-cancel-new-worker"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createWorkerMutation.isPending} data-testid="button-submit-new-worker">
                  {createWorkerMutation.isPending ? "Creating..." : "Create Worker"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Worker Dialog */}
      <Dialog open={editWorkerDialogOpen} onOpenChange={setEditWorkerDialogOpen}>
        <DialogContent data-testid="dialog-edit-worker">
          <DialogHeader>
            <DialogTitle>Edit Worker</DialogTitle>
            <DialogDescription>
              Update worker information for {selectedWorkerForEdit?.firstName} {selectedWorkerForEdit?.lastName}
            </DialogDescription>
          </DialogHeader>

          <Form {...editWorkerForm}>
            <form onSubmit={editWorkerForm.handleSubmit((data) => {
              if (selectedWorkerForEdit) {
                updateWorkerMutation.mutate({ ...data, id: selectedWorkerForEdit.id });
              }
            })} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editWorkerForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-worker-firstname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editWorkerForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-worker-lastname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editWorkerForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker Code</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-worker-code" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editWorkerForm.control}
                name="monthlySalary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Salary</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        {...field}
                        data-testid="input-edit-worker-salary"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editWorkerForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-worker-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editWorkerForm.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-edit-worker-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditWorkerDialogOpen(false)}
                  data-testid="button-cancel-edit-worker"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateWorkerMutation.isPending} data-testid="button-submit-edit-worker">
                  {updateWorkerMutation.isPending ? "Updating..." : "Update Worker"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Worker Balance Conflict Dialog */}
      <AlertDialog open={!!deleteWorkerConflict} onOpenChange={(open) => !open && setDeleteWorkerConflict(null)}>
        <AlertDialogContent data-testid="dialog-delete-worker-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>Worker Has Non-Zero Balance</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWorkerConflict && (
                <>
                  <span className="font-semibold">{deleteWorkerConflict.employee.firstName} {deleteWorkerConflict.employee.lastName}</span> has a non-zero balance:
                  <div className="mt-2 space-y-1 font-mono text-sm">
                    <div>Employee Balance: {deleteWorkerConflict.employeeBalance.toFixed(2)}</div>
                    <div>Ledger Balance: {deleteWorkerConflict.ledgerBalance.toFixed(2)}</div>
                  </div>
                  <p className="mt-3">
                    Deleting this worker will also delete their linked ledger account. This action cannot be undone.
                  </p>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteWorkerConflict(null)} data-testid="button-cancel-force-delete-worker">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceDeleteWorker}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-force-delete-worker"
            >
              Delete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Employee Dialog */}
      <Dialog open={createEmployeeDialogOpen} onOpenChange={setCreateEmployeeDialogOpen}>
        <DialogContent data-testid="dialog-create-employee">
          <DialogHeader>
            <DialogTitle>Create New Employee</DialogTitle>
            <DialogDescription>
              Add a new warehouse staff employee to the payroll system
            </DialogDescription>
          </DialogHeader>

          <Form {...createEmployeeForm}>
            <form onSubmit={createEmployeeForm.handleSubmit((data) => createEmployeeMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={createEmployeeForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} data-testid="input-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={createEmployeeForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} data-testid="input-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={createEmployeeForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee Code (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Auto-generated if left blank" {...field} data-testid="input-code" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={createEmployeeForm.control}
                name="monthlySalary"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly Salary</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-monthly-salary"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={createEmployeeForm.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Warehouse" {...field} value={field.value || ""} data-testid="input-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={createEmployeeForm.control}
                name="joinDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-join-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={createEmployeeForm.control}
                name="openingBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opening Balance (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        data-testid="input-opening-balance"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={createEmployeeForm.control}
                name="employeeGroupId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee Group (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-employee-group">
                          <SelectValue placeholder="Select a group" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none" data-testid="option-no-group">
                          No Group
                        </SelectItem>
                        {employeeGroups.map((group: any) => (
                          <SelectItem key={group.id} value={group.id.toString()} data-testid={`option-group-${group.id}`}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateEmployeeDialogOpen(false)}
                  data-testid="button-cancel-create"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createEmployeeMutation.isPending} data-testid="button-submit-create">
                  {createEmployeeMutation.isPending ? "Creating..." : "Create Employee"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Balance Conflict Warning Dialog */}
      <AlertDialog open={!!deleteConflict} onOpenChange={(open) => !open && setDeleteConflict(null)}>
        <AlertDialogContent data-testid="dialog-delete-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle>Employee Has Non-Zero Balance</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConflict && (
                <>
                  <span className="font-semibold">{deleteConflict.employee.firstName} {deleteConflict.employee.lastName}</span> has a non-zero balance:
                  <div className="mt-2 space-y-1 font-mono text-sm">
                    <div>Employee Balance: {deleteConflict.employeeBalance.toFixed(2)}</div>
                    <div>Ledger Balance: {deleteConflict.ledgerBalance.toFixed(2)}</div>
                  </div>
                  <p className="mt-3">
                    Deleting this employee will also delete their linked ledger account. This action cannot be undone.
                  </p>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConflict(null)} data-testid="button-cancel-force-delete">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceDeleteEmployee}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-force-delete"
            >
              Delete Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Group Dialog */}
      <Dialog open={createGroupDialogOpen} onOpenChange={setCreateGroupDialogOpen}>
        <DialogContent data-testid="dialog-create-group">
          <DialogHeader>
            <DialogTitle>Create Employee Group</DialogTitle>
            <DialogDescription>
              Create a new group to organize employees
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Group Name</label>
              <Input
                placeholder="e.g., Warehouse Team"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                data-testid="input-group-name"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Description (Optional)</label>
              <Textarea
                placeholder="Brief description of the group"
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                data-testid="input-group-description"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateGroupDialogOpen(false);
                  setNewGroupName("");
                  setNewGroupDescription("");
                }}
                data-testid="button-cancel-group"
              >
                Cancel
              </Button>
              <Button
                onClick={() => createGroupMutation.mutate()}
                disabled={!newGroupName.trim() || createGroupMutation.isPending}
                data-testid="button-submit-group"
              >
                {createGroupMutation.isPending ? "Creating..." : "Create Group"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Group Members Dialog */}
      <Dialog open={groupMembersDialogOpen} onOpenChange={setGroupMembersDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-manage-group-members">
          <DialogHeader>
            <DialogTitle>Manage Group Members: {selectedGroupForMembers?.name}</DialogTitle>
            <DialogDescription>
              Select workers to add or remove from this group
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-96 overflow-y-auto">
            {(employeeStaff || []).map((worker) => {
              const isMember = groupMembers.some((m: any) => m.id === worker.id);
              return (
                <div key={worker.id} className="flex items-center gap-2 p-2 rounded border">
                  <Checkbox
                    id={`worker-${worker.id}`}
                    checked={isMember}
                    onCheckedChange={(checked) => {
                      if (checked && selectedGroupForMembers) {
                        addWorkerToGroupMutation.mutate({ groupId: selectedGroupForMembers.id, workerId: worker.id });
                      } else if (!checked && selectedGroupForMembers) {
                        removeWorkerFromGroupMutation.mutate({ groupId: selectedGroupForMembers.id, workerId: worker.id });
                      }
                    }}
                    data-testid={`checkbox-worker-${worker.id}`}
                  />
                  <label htmlFor={`worker-${worker.id}`} className="cursor-pointer flex-1">
                    {worker.firstName} {worker.lastName}
                  </label>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => setGroupMembersDialogOpen(false)}
              data-testid="button-close-members-dialog"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Deposit Dialog */}
      <Dialog open={bulkDepositDialogOpen} onOpenChange={setBulkDepositDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-bulk-deposit">
          <DialogHeader>
            <DialogTitle>Bulk Salary Deposit</DialogTitle>
            <DialogDescription>
              Deposit monthly salary for {validSelectedEmployees.length} employees
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {hasInvalidSalaries && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Some selected employees have zero or invalid salaries and will be skipped.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>Deposit Date</Label>
              <Input
                type="date"
                value={bulkDepositDate}
                onChange={(e) => setBulkDepositDate(e.target.value)}
                data-testid="input-bulk-deposit-date"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="e.g., November 2025 salary"
                value={bulkDepositNotes}
                onChange={(e) => setBulkDepositNotes(e.target.value)}
                data-testid="input-bulk-deposit-notes"
              />
            </div>

            <div className="border rounded-md p-4 space-y-2 max-h-60 overflow-y-auto">
              <div className="text-sm font-medium mb-2">Employees to receive deposit:</div>
              {validSelectedEmployees.map((emp) => (
                <div key={emp.id} className="flex justify-between text-sm">
                  <span>{emp.firstName} {emp.lastName}</span>
                  <span className="font-mono">{parseFloat(emp.monthlySalary).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold pt-2 border-t mt-2">
                <span>Total</span>
                <span className="font-mono">{bulkDepositTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setBulkDepositDialogOpen(false)}
                data-testid="button-cancel-bulk-deposit"
              >
                Cancel
              </Button>
              <Button
                onClick={() => bulkDepositMutation.mutate()}
                disabled={bulkDepositMutation.isPending || validSelectedEmployees.length === 0}
                data-testid="button-confirm-bulk-deposit"
              >
                {bulkDepositMutation.isPending ? "Processing..." : `Deposit All (${validSelectedEmployees.length})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Withdrawal Dialog */}
      <Dialog open={bulkWithdrawalDialogOpen} onOpenChange={setBulkWithdrawalDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-bulk-withdrawal">
          <DialogHeader>
            <DialogTitle>Bulk Withdrawal</DialogTitle>
            <DialogDescription>
              Enter withdrawal amounts for each employee. Leave blank or zero to skip.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Withdrawal Date</Label>
                <Input
                  type="date"
                  value={bulkWithdrawalDate}
                  onChange={(e) => setBulkWithdrawalDate(e.target.value)}
                  data-testid="input-bulk-withdrawal-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select value={bulkWithdrawalAccountType} onValueChange={(val: any) => {
                  setBulkWithdrawalAccountType(val);
                  setBulkWithdrawalAccountId("");
                }}>
                  <SelectTrigger data-testid="select-withdrawal-account-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash Account</SelectItem>
                    <SelectItem value="bank">Bank Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Account</Label>
                <Select value={bulkWithdrawalAccountId} onValueChange={setBulkWithdrawalAccountId}>
                  <SelectTrigger data-testid="select-withdrawal-account">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bulkWithdrawalAccountType === "cash" 
                      ? cashAccounts?.map(acc => (
                          <SelectItem key={acc.id} value={acc.id.toString()}>{acc.name}</SelectItem>
                        ))
                      : bankAccounts?.map(acc => (
                          <SelectItem key={acc.id} value={acc.id.toString()}>{acc.accountName}</SelectItem>
                        ))
                    }
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="e.g., November 2025 withdrawal"
                value={bulkWithdrawalNotes}
                onChange={(e) => setBulkWithdrawalNotes(e.target.value)}
                data-testid="input-bulk-withdrawal-notes"
              />
            </div>

            <div className="border rounded-md flex-1 overflow-hidden">
              <div className="max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right w-40">Withdrawal Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employeeStaff.map((emp) => (
                      <TableRow key={emp.id}>
                        <TableCell>{emp.firstName} {emp.lastName}</TableCell>
                        <TableCell className="text-right font-mono">{parseFloat(emp.calculatedBalance || "0").toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            className="text-right font-mono w-32 ml-auto"
                            value={bulkWithdrawalAmounts[emp.id] || ""}
                            onChange={(e) => setBulkWithdrawalAmounts(prev => ({
                              ...prev,
                              [emp.id]: e.target.value
                            }))}
                            data-testid={`input-withdrawal-${emp.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-sm">
                <span className="text-muted-foreground">Total Withdrawal: </span>
                <span className="font-semibold font-mono">
                  {Object.values(bulkWithdrawalAmounts)
                    .reduce((sum, amt) => sum + (parseFloat(amt) || 0), 0)
                    .toFixed(2)}
                </span>
                <span className="text-muted-foreground ml-2">
                  ({Object.values(bulkWithdrawalAmounts).filter(amt => parseFloat(amt) > 0).length} employees)
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setBulkWithdrawalDialogOpen(false)}
                  data-testid="button-cancel-bulk-withdrawal"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => bulkWithdrawalMutation.mutate()}
                  disabled={bulkWithdrawalMutation.isPending || Object.values(bulkWithdrawalAmounts).filter(amt => parseFloat(amt) > 0).length === 0 || !bulkWithdrawalAccountId}
                  data-testid="button-confirm-bulk-withdrawal"
                >
                  {bulkWithdrawalMutation.isPending ? "Processing..." : "Process Withdrawals"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Bonus Dialog */}
      <Dialog open={bulkBonusDialogOpen} onOpenChange={setBulkBonusDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="dialog-bulk-bonus">
          <DialogHeader>
            <DialogTitle>Bulk Bonus Deposit</DialogTitle>
            <DialogDescription>
              Enter bonus amounts for each employee. Leave blank or zero to skip.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bonus Date</Label>
                <Input
                  type="date"
                  value={bulkBonusDate}
                  onChange={(e) => setBulkBonusDate(e.target.value)}
                  data-testid="input-bulk-bonus-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input
                  placeholder="e.g., Q4 2025 performance bonus"
                  value={bulkBonusNotes}
                  onChange={(e) => setBulkBonusNotes(e.target.value)}
                  data-testid="input-bulk-bonus-notes"
                />
              </div>
            </div>

            <div className="border rounded-md flex-1 overflow-hidden">
              <div className="max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right w-40">Bonus Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employeeStaff.map((emp) => (
                      <TableRow key={emp.id}>
                        <TableCell>{emp.firstName} {emp.lastName}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            className="text-right font-mono w-32 ml-auto"
                            value={bulkBonusAmounts[emp.id] || ""}
                            onChange={(e) => setBulkBonusAmounts(prev => ({
                              ...prev,
                              [emp.id]: e.target.value
                            }))}
                            data-testid={`input-bonus-${emp.id}`}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-sm">
                <span className="text-muted-foreground">Total Bonus: </span>
                <span className="font-semibold font-mono">
                  {Object.values(bulkBonusAmounts)
                    .reduce((sum, amt) => sum + (parseFloat(amt) || 0), 0)
                    .toFixed(2)}
                </span>
                <span className="text-muted-foreground ml-2">
                  ({Object.values(bulkBonusAmounts).filter(amt => parseFloat(amt) > 0).length} employees)
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setBulkBonusDialogOpen(false)}
                  data-testid="button-cancel-bulk-bonus"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => bulkBonusMutation.mutate()}
                  disabled={bulkBonusMutation.isPending || Object.values(bulkBonusAmounts).filter(amt => parseFloat(amt) > 0).length === 0}
                  data-testid="button-confirm-bulk-bonus"
                >
                  {bulkBonusMutation.isPending ? "Processing..." : "Deposit Bonuses"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
