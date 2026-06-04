import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { PageHeader } from "@/components/PageHeader";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import type { Employee } from "@shared/schema";
import { insertEmployeeSchema } from "@shared/schema";
import { DollarSign, TrendingDown, TrendingUp, Users, AlertCircle, CalendarIcon, Plus, Pencil, Trash2, ChevronDown, ExternalLink, User, HardHat, Banknote, ArrowDownCircle, ArrowUpCircle, Gift, Receipt, PlayCircle, X, Loader2, RefreshCw, Percent, Package, Save, ChevronRight, Printer, MinusCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { format } from "date-fns";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { ERPWorkerDetail } from "@/components/ERPWorkerDetail";
import ERPRunPayroll from "@/components/ERPRunPayroll";
import ERPAdvancesTab from "@/components/ERPAdvancesTab";
import type { DepositFormData, BonusFormData, WithdrawalFormData, BulkPaymentFormData, SalaryAdvanceFormData, DeductionFormData, WorkerFormData, EmployeeFormData, WorkerPayment, SalaryAdvance } from "./payroll/payrollSchemas";
import { depositSchema, bonusSchema, withdrawalSchema, bulkPaymentSchema, salaryAdvanceSchema, deductionSchema, workerFormSchema, employeeFormSchema, getThisMonthRange, getEmpAvatarColor, getEmpInitials, EMP_AVATAR_COLORS } from "./payroll/payrollSchemas";
import { DepositDialog } from "./payroll/DepositDialog";
import { WithdrawalDialog } from "./payroll/WithdrawalDialog";
import { BulkPaymentDialog } from "./payroll/BulkPaymentDialog";
import { WorkerDialogs } from "./payroll/WorkerDialogs";
import { AdvanceDialogs } from "./payroll/AdvanceDialogs";
import { BonusDialog } from "./payroll/BonusDialog";
import { EmployeeCrudDialogs } from "./payroll/EmployeeCrudDialogs";
import { BulkDialogs } from "./payroll/BulkDialogs";
import { EmployeeStatementDialog } from "./payroll/EmployeeStatementDialog";
import { EditEmployeeDialog } from "./payroll/EditEmployeeDialog";

export default function Payroll() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const cleanTxnDesc = (text: string): string => {
    if (!text) return text;
    return text.replace(/\s*-\s*[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{5,}\s*$/i, "").trim();
  };
  const [selectedTab, setSelectedTab] = useState("employees");
  const [empSearch, setEmpSearch] = useState("");
  const [empStatusFilter, setEmpStatusFilter] = useState("Active");
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  const [bonusTab, setBonusTab] = useState<"sales" | "bales">("sales");
  const [bonusSalesPeriod, setBonusSalesPeriod] = useState<"thisMonth" | "custom">("thisMonth");
  const [bonusSalesLocationId, setBonusSalesLocationId] = useState<string>("");
  const [bonusSalesStart, setBonusSalesStart] = useState<string>("");
  const [bonusSalesEnd, setBonusSalesEnd] = useState<string>("");
  const [bonusSalesPreview, setBonusSalesPreview] = useState<{ totalSalesAmount: string; totalQuantity: string; locationName: string } | null>(null);
  const [bonusSalesLoading, setBonusSalesLoading] = useState(false);
  const [bonusSalesCustomPct, setBonusSalesCustomPct] = useState<string>("");
  const [bonusDate, setBonusDate] = useState<string>(new Date().toLocaleDateString('en-CA'));
  const [bonusNotes, setBonusNotes] = useState<string>("");
  const [balesRows, setBalesRows] = useState<Array<{ locationId: string; sourceCompanyId: string; qty: string; rate: string; preview: string | null; loading: boolean }>>([{ locationId: "", sourceCompanyId: "", qty: "", rate: "", preview: null, loading: false }]);
  const [balesPeriod, setBalesPeriod] = useState<"thisMonth" | "custom">("thisMonth");
  const [balesStart, setBalesStart] = useState<string>("");
  const [balesEnd, setBalesEnd] = useState<string>("");
  const [withdrawalDialogOpen, setWithdrawalDialogOpen] = useState(false);
  const [bulkPaymentDialogOpen, setBulkPaymentDialogOpen] = useState(false);
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [advanceWorkerComboOpen, setAdvanceWorkerComboOpen] = useState(false);
  const [advanceToDelete, setAdvanceToDelete] = useState<number | null>(null);
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
  const [statementEmployee, setStatementEmployee] = useState<(Employee & { calculatedBalance?: string }) | null>(null);
  const [statementExpanded, setStatementExpanded] = useState(false);
  const [editEmployeeDialogOpen, setEditEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedWorkerProfileId, setSelectedWorkerProfileId] = useState<number | null>(null);
  const [workerProfileSearch, setWorkerProfileSearch] = useState("");
  const [workerProfileGroupFilter, setWorkerProfileGroupFilter] = useState<number | null>(null);
  const [workerDeductionTarget, setWorkerDeductionTarget] = useState<Employee | null>(null);
  const [workerDeductionAmount, setWorkerDeductionAmount] = useState("");
  const [workerDeductionReason, setWorkerDeductionReason] = useState("");
  const [workerDeductionDate, setWorkerDeductionDate] = useState(new Date().toLocaleDateString("en-CA"));
  const { selectedCompany, companies } = useCompany();
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

  // Fetch employee transactions when a statement employee is selected
  // Reset expanded state when a new statement is opened
  useEffect(() => { if (statementEmployee) setStatementExpanded(false); }, [statementEmployee?.id]);

  const { data: rawEmployeeTransactions = [], isLoading: transactionsLoading } = useQuery<any[]>({
    queryKey: ["/api/accounts/employee", statementEmployee?.id, "transactions"],
    queryFn: async () => {
      if (!statementEmployee?.id) return [];
      const res = await fetch(`/api/accounts/employee/${statementEmployee.id}/transactions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transactions");
      return res.json();
    },
    enabled: !!statementEmployee?.id,
  });

  // Normalize the transaction format — API returns voucherDate/debitAmount/creditAmount/entryId
  const employeeTransactions = rawEmployeeTransactions.map((t: any) => {
    const debit = parseFloat(t.debitAmount || "0");
    const credit = parseFloat(t.creditAmount || "0");
    const isDebitTxn = debit > 0;
    return {
      ...t,
      id: t.id ?? t.entryId,
      date: t.date ?? t.voucherDate,
      amount: t.amount ?? (isDebitTxn ? t.debitAmount : t.creditAmount),
      isDebit: t.isDebit !== undefined ? t.isDebit : isDebitTxn,
      debitAmount: t.debitAmount ?? (isDebitTxn ? t.amount : "0"),
      creditAmount: t.creditAmount ?? (!isDebitTxn ? t.amount : "0"),
    };
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
  const [bulkDepositDate, setBulkDepositDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [bulkDepositNotes, setBulkDepositNotes] = useState("");

  // Edit employee bale rates state
  const [editBaleRates, setEditBaleRates] = useState<{ locationId: string; rate: string; sourceCompanyId: string }[]>([]);
  // Edit employee bale pct rates state (% bonus by location)
  const [editBalePctRates, setEditBalePctRates] = useState<{ locationId: string; pct: string; sourceCompanyId: string }[]>([]);
  const [bulkBonusAutoMonth, setBulkBonusAutoMonth] = useState<"thisMonth" | "custom">("thisMonth");
  const [bulkBonusAutoStart, setBulkBonusAutoStart] = useState(() => getThisMonthRange().start);
  const [bulkBonusAutoEnd, setBulkBonusAutoEnd] = useState(() => getThisMonthRange().end);
  const [bulkBonusAutoLoading, setBulkBonusAutoLoading] = useState(false);
  const [bulkBonusAutoPctLocationId, setBulkBonusAutoPctLocationId] = useState<string>("");

  // Bulk Bonus state
  const [bulkBonusDialogOpen, setBulkBonusDialogOpen] = useState(false);
  const [bulkBonusDate, setBulkBonusDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [bulkBonusNotes, setBulkBonusNotes] = useState("");
  const [bulkBonusAmounts, setBulkBonusAmounts] = useState<Record<number, string>>({});
  const [bulkBonusBreakdowns, setBulkBonusBreakdowns] = useState<Record<number, string[]>>({});
  const [bulkBonusStep, setBulkBonusStep] = useState<"edit" | "preview">("edit");
  // Pending bonuses: calculated per-employee, saved for later bulk posting
  const [pendingBonuses, setPendingBonuses] = useState<Record<number, { amount: number; description: string; employeeName: string }>>({});

  // Bulk Withdrawal state
  const [bulkWithdrawalDialogOpen, setBulkWithdrawalDialogOpen] = useState(false);
  const [bulkWithdrawalDate, setBulkWithdrawalDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [bulkWithdrawalNotes, setBulkWithdrawalNotes] = useState("");
  const [bulkWithdrawalAmounts, setBulkWithdrawalAmounts] = useState<Record<number, string>>({});
  const [bulkWithdrawalAccountType, setBulkWithdrawalAccountType] = useState<"bank" | "cash">("cash");
  const [bulkWithdrawalAccountId, setBulkWithdrawalAccountId] = useState("");

  const { data: groupMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"],
    enabled: !!selectedGroupForMembers?.id,
  });

  const { data: editingBaleRates } = useQuery<Array<{ id: number; locationId: number; rate: string }>>({
    queryKey: ["/api/employees", editingEmployee?.id, "bale-rates"],
    queryFn: async () => {
      if (!editingEmployee?.id) return [];
      const res = await modeApiRequest("GET", `/api/employees/${editingEmployee.id}/bale-rates`);
      return res.json();
    },
    enabled: !!editingEmployee && editEmployeeDialogOpen,
  });

  const { data: editingBalePctRates } = useQuery<Array<{ id: number; locationId: number; pct: string; sourceCompanyId?: number | null }>>({
    queryKey: ["/api/employees", editingEmployee?.id, "bale-pct-rates"],
    queryFn: async () => {
      if (!editingEmployee?.id) return [];
      const res = await modeApiRequest("GET", `/api/employees/${editingEmployee.id}/bale-pct-rates`);
      return res.json();
    },
    enabled: !!editingEmployee && editEmployeeDialogOpen,
  });

  const { data: locations = [] } = useQuery<Array<{ id: number; name: string; companyId: number }>>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  // Fetch locations for all other companies the user has access to (for cross-company bale rates)
  const otherCompanies = companies.filter(c => c.id !== selectedCompany?.id);
  const { data: allCompanyLocations = [] } = useQuery<Array<{ id: number; name: string; companyId: number; companyName: string }>>({
    queryKey: ["/api/all-company-locations", companies.map(c => c.id).join(",")],
    queryFn: async () => {
      const results: Array<{ id: number; name: string; companyId: number; companyName: string }> = [];
      for (const company of otherCompanies) {
        try {
          const res = await fetch(`/api/locations?companyId=${company.id}`, { credentials: "include" });
          if (res.ok) {
            const locs = await res.json();
            for (const loc of locs) {
              results.push({ id: loc.id, name: loc.name, companyId: company.id, companyName: company.name });
            }
          }
        } catch {}
      }
      return results;
    },
    enabled: otherCompanies.length > 0,
  });

  // Employee Groups mutations
  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await modeApiRequest("POST", "/api/employee-groups", {
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
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to create employee group",
        variant: "destructive",
      });
    },
  });

  const addWorkerToGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await modeApiRequest("POST", `/api/employee-groups/${groupId}/members`, { employeeId: workerId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"] });
    },
  });

  const removeWorkerFromGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await modeApiRequest("DELETE", `/api/employee-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"] });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      await modeApiRequest("DELETE", `/api/employee-groups/${groupId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Employee group deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedCompany?.id] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
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
      const res = await modeApiRequest("POST", "/api/worker-groups", {
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
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to create worker group",
        variant: "destructive",
      });
    },
  });

  const addWorkerToWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await modeApiRequest("POST", `/api/worker-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      toast({
        title: "Success",
        description: "Worker added to group",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to add worker to group",
        variant: "destructive",
      });
    },
  });

  const removeWorkerFromWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) => {
      await modeApiRequest("DELETE", `/api/worker-groups/${groupId}/members/${workerId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      toast({
        title: "Success",
        description: "Worker removed from group",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to remove worker from group",
        variant: "destructive",
      });
    },
  });

  const deleteWorkerGroupMutation = useMutation({
    mutationFn: async (groupId: number) => {
      await modeApiRequest("DELETE", `/api/worker-groups/${groupId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Worker group deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
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

  const filteredEmployeeStaff = useMemo(() => {
    return employeeStaff.filter((emp) => {
      const matchesSearch = !empSearch ||
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(empSearch.toLowerCase()) ||
        (emp.code || "").toLowerCase().includes(empSearch.toLowerCase()) ||
        (emp.department || "").toLowerCase().includes(empSearch.toLowerCase());
      const matchesStatus =
        empStatusFilter === "All" ||
        (empStatusFilter === "Active" && emp.active) ||
        (empStatusFilter === "Inactive" && !emp.active);
      return matchesSearch && matchesStatus;
    });
  }, [employeeStaff, empSearch, empStatusFilter]);

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
        amount: netPayment.toString(),
        selected: worker.active !== false,
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
      (group.members || []).forEach(member => {
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
        active: selectedWorkerForEdit.active !== false,
      });
    }
  }, [selectedWorkerForEdit, editWorkerDialogOpen, editWorkerForm]);

  const depositForm = useForm<DepositFormData>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      amount: "",
      date: new Date().toLocaleDateString('en-CA'),
      notes: "",
    },
  });

  const bonusForm = useForm<BonusFormData>({
    resolver: zodResolver(bonusSchema),
    defaultValues: {
      amount: "",
      date: new Date().toLocaleDateString('en-CA'),
      notes: "",
    },
  });

  const withdrawalForm = useForm<WithdrawalFormData>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: {
      amount: "",
      paymentAccountType: "bank",
      paymentAccountId: "",
      date: new Date().toLocaleDateString('en-CA'),
      notes: "",
    },
  });

  const bulkPaymentForm = useForm<BulkPaymentFormData>({
    resolver: zodResolver(bulkPaymentSchema),
    defaultValues: {
      paymentAccountType: "bank",
      paymentAccountId: "",
      date: new Date().toLocaleDateString('en-CA'),
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
      isOpeningBalance: false,
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
      joinDate: new Date().toLocaleDateString('en-CA'),
      openingBalance: "",
      active: true,
      salesBonusPct: "",
      balesBonusRate: "",
    },
  });

  const editEmployeeForm = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      code: "",
      monthlySalary: "0",
      department: "",
      joinDate: new Date().toLocaleDateString('en-CA'),
      active: true,
      salesBonusPct: "",
      balesBonusRate: "",
    },
  });

  // Computed after editEmployeeForm is initialized — watches a field for dependent dropdown
  const pctSourceCompanyId = editEmployeeForm.watch("salesBonusPctSourceCompanyId") || "";
  const pctLocations = pctSourceCompanyId
    ? allCompanyLocations.filter(l => String(l.companyId) === pctSourceCompanyId)
    : locations;

  const depositMutation = useMutation({
    mutationFn: async (data: DepositFormData) => {
      return await modeApiRequest("POST", "/api/payroll/deposit-employee", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setDepositDialogOpen(false);
      depositForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bonusMutation = useMutation({
    mutationFn: async (data: BonusFormData) => {
      return await modeApiRequest("POST", "/api/payroll/bonus-employee", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setBonusDialogOpen(false);
      bonusForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: async (data: WithdrawalFormData) => {
      return await modeApiRequest("POST", "/api/payroll/withdraw-employee", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setWithdrawalDialogOpen(false);
      withdrawalForm.reset();
      setSelectedEmployee(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
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
      return await modeApiRequest("POST", "/api/payroll/bulk-pay-workers", {
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
      if ((error as any)?._handledGlobally) return;
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
      return await modeApiRequest("POST", "/api/payroll/bulk-deposit-employees", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setBulkDepositDialogOpen(false);
      setBulkDepositSelections({});
      setBulkDepositNotes("");
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
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
      return await modeApiRequest("POST", "/api/payroll/bulk-bonus-employees", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setBulkBonusDialogOpen(false);
      setBulkBonusAmounts({});
      setBulkBonusBreakdowns({});
      setBulkBonusNotes("");
      setBulkBonusStep("edit");
      setPendingBonuses({});
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePrintBulkBonus = () => {
    const rows = employeeStaff
      .filter(emp => parseFloat(bulkBonusAmounts[emp.id] || "0") > 0)
      .map(emp => {
        const pending = pendingBonuses[emp.id];
        const desc = pending?.description || (bulkBonusNotes || "Bonus");
        const amt = parseFloat(bulkBonusAmounts[emp.id] || "0");
        return `<tr><td>${emp.firstName} ${emp.lastName}</td><td>${desc}</td><td style="text-align:right;font-family:monospace">${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>`;
      }).join("");
    const total = Object.values(bulkBonusAmounts).reduce((s, a) => s + (parseFloat(a) || 0), 0);
    const empCount = Object.values(bulkBonusAmounts).filter(a => parseFloat(a) > 0).length;
    const html = `<!DOCTYPE html><html><head><title>Bulk Bonus — ${bulkBonusDate}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; margin: 32px; color: #111; }
      h2 { margin: 0 0 4px; } p { margin: 2px 0; color: #555; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th { border-bottom: 2px solid #111; padding: 6px 8px; text-align: left; font-size: 12px; }
      td { border-bottom: 1px solid #ddd; padding: 6px 8px; }
      tfoot td { border-top: 2px solid #111; font-weight: bold; }
      .right { text-align: right; font-family: monospace; }
    </style></head><body>
    <h2>Bulk Bonus Deposit</h2>
    <p>Date: ${bulkBonusDate}</p>
    ${bulkBonusNotes ? `<p>Notes: ${bulkBonusNotes}</p>` : ""}
    <table>
      <thead><tr><th>Employee</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2">${empCount} employee${empCount !== 1 ? "s" : ""}</td><td class="right">${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr></tfoot>
    </table>
    </body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

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
      return await modeApiRequest("POST", "/api/payroll/bulk-withdraw-employees", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setBulkWithdrawalDialogOpen(false);
      setBulkWithdrawalAmounts({});
      setBulkWithdrawalNotes("");
      setBulkWithdrawalAccountId("");
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const advanceMutation = useMutation({
    mutationFn: async (data: SalaryAdvanceFormData) => {
      return await modeApiRequest("POST", "/api/salary-advances", {
        employeeId: parseInt(data.employeeId),
        amount: data.amount,
        advanceDate: format(data.advanceDate, "yyyy-MM-dd"),
        cashAccountId: data.isOpeningBalance ? undefined : parseInt(data.cashAccountId || "0"),
        notes: data.notes,
        isOpeningBalance: data.isOpeningBalance,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Salary advance created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      setAdvanceDialogOpen(false);
      advanceForm.reset();
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteAdvanceMutation = useMutation({
    mutationFn: async (advanceId: number) => {
      return await modeApiRequest("DELETE", `/api/salary-advances/${advanceId}`, undefined);
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Salary advance deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const workerDeductionMutation = useMutation({
    mutationFn: async () => {
      if (!workerDeductionTarget) throw new Error("No worker selected");
      const amt = parseFloat(workerDeductionAmount);
      if (isNaN(amt) || amt <= 0) throw new Error("Amount must be a positive number");
      return await modeApiRequest("POST", `/api/factory/workers/${workerDeductionTarget.id}/deductions`, {
        amount: workerDeductionAmount,
        reason: workerDeductionReason || null,
        deductionDate: workerDeductionDate,
      });
    },
    onSuccess: () => {
      toast({ title: "Deduction added", description: "Pending deduction saved. It will be applied at next payroll." });
      queryClient.invalidateQueries({ queryKey: [`/api/factory/workers/${workerDeductionTarget?.id}/deductions`] });
      setWorkerDeductionTarget(null);
      setWorkerDeductionAmount("");
      setWorkerDeductionReason("");
      setWorkerDeductionDate(new Date().toLocaleDateString("en-CA"));
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deductionMutation = useMutation({
    mutationFn: async (data: DeductionFormData) => {
      if (!selectedAdvance) throw new Error("No advance selected");
      return await modeApiRequest("POST", `/api/salary-advances/${selectedAdvance.id}/deduction`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Deduction recorded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/salary-advances", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/net-profit"] });
      setDeductionDialogOpen(false);
      deductionForm.reset();
      setSelectedAdvance(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createWorkerMutation = useMutation({
    mutationFn: async (data: WorkerFormData) => {
      return await modeApiRequest("POST", "/api/employees", {
        ...data,
        employeeType: "Worker",
        companyId: selectedCompany?.id,
        joinDate: new Date().toLocaleDateString('en-CA'),
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
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateWorkerMutation = useMutation({
    mutationFn: async (data: WorkerFormData & { id: number }) => {
      return await modeApiRequest("PATCH", `/api/employees/${data.id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members"] });
      setEditWorkerDialogOpen(false);
      editWorkerForm.reset();
      setSelectedWorkerForEdit(null);
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
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
      return await modeApiRequest("DELETE", `/api/employees/${id}${queryParam}`);
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
      if ((error as any)?._handledGlobally) return;
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
      
      return await modeApiRequest("POST", "/api/employees", payload);
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
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const editEmployeeMutation = useMutation({
    mutationFn: async (data: EmployeeFormData) => {
      if (!editingEmployee) throw new Error("No employee selected for editing");
      const { employeeGroupId, openingBalance, ...rest } = data;
      const payload: any = { ...rest };
      payload.employeeGroupId = (employeeGroupId && employeeGroupId !== "" && employeeGroupId !== "none")
        ? parseInt(employeeGroupId, 10)
        : null;
      await modeApiRequest("PATCH", `/api/employees/${editingEmployee.id}`, payload);
      // Save per-location bale rates
      const validRates = editBaleRates.filter(r => r.locationId && parseFloat(r.rate) > 0);
      await modeApiRequest("PUT", `/api/employees/${editingEmployee.id}/bale-rates`, { rates: validRates });
      // Save per-location bale pct rates
      const validPctRates = editBalePctRates.filter(r => r.locationId && parseFloat(r.pct) > 0);
      await modeApiRequest("PUT", `/api/employees/${editingEmployee.id}/bale-pct-rates`, { rates: validPctRates });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Employee updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", editingEmployee?.id, "bale-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", editingEmployee?.id, "bale-pct-rates"] });
      setEditEmployeeDialogOpen(false);
      setEditingEmployee(null);
      editEmployeeForm.reset();
    },
    onError: (error: Error) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Populate edit form when editing employee changes
  useEffect(() => {
    if (editingEmployee && editEmployeeDialogOpen) {
      editEmployeeForm.reset({
        firstName: editingEmployee.firstName,
        lastName: editingEmployee.lastName,
        code: editingEmployee.code || "",
        monthlySalary: editingEmployee.monthlySalary || "0",
        department: editingEmployee.department || "",
        joinDate: editingEmployee.joinDate || new Date().toLocaleDateString('en-CA'),
        active: editingEmployee.active !== false,
        employeeGroupId: (editingEmployee as any).employeeGroupId?.toString() || "",
        salesBonusPct: editingEmployee.salesBonusPct != null ? String(editingEmployee.salesBonusPct) : "",
        salesBonusPctSourceCompanyId: (editingEmployee as any).salesBonusPctSourceCompanyId != null ? String((editingEmployee as any).salesBonusPctSourceCompanyId) : "",
        salesBonusPctLocationId: (editingEmployee as any).salesBonusPctLocationId != null ? String((editingEmployee as any).salesBonusPctLocationId) : "",
        balesBonusRate: editingEmployee.balesBonusRate != null ? String(editingEmployee.balesBonusRate) : "",
      });
    }
    if (!editEmployeeDialogOpen) { setEditBaleRates([]); setEditBalePctRates([]); }
  }, [editingEmployee, editEmployeeDialogOpen]);

  useEffect(() => {
    if (editEmployeeDialogOpen && editingBaleRates) {
      setEditBaleRates(editingBaleRates.map((r: any) => ({ locationId: String(r.locationId), rate: String(r.rate), sourceCompanyId: r.sourceCompanyId ? String(r.sourceCompanyId) : "" })));
    }
  }, [editingBaleRates, editEmployeeDialogOpen]);

  useEffect(() => {
    if (editEmployeeDialogOpen && editingBalePctRates) {
      setEditBalePctRates(editingBalePctRates.map((r: any) => ({ locationId: String(r.locationId), pct: String(r.pct), sourceCompanyId: r.sourceCompanyId ? String(r.sourceCompanyId) : "" })));
    }
  }, [editingBalePctRates, editEmployeeDialogOpen]);

  const deleteEmployeeMutation = useMutation({
    mutationFn: async ({ id, forceDelete = false }: { id: number; forceDelete?: boolean }) => {
      const queryParam = forceDelete ? "?forceDelete=true" : "";
      return await modeApiRequest("DELETE", `/api/employees/${id}${queryParam}`);
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
      if ((error as any)?._handledGlobally) return;
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
    depositForm.reset({
      amount: employee.monthlySalary || "",
      date: new Date().toLocaleDateString('en-CA'),
      notes: "",
    });
    setDepositDialogOpen(true);
  };

  const handleWithdrawal = (employee: Employee) => {
    setSelectedEmployee(employee);
    setWithdrawalDialogOpen(true);
  };

  const handleBonus = (employee: Employee) => {
    setSelectedEmployee(employee);
    const range = getThisMonthRange();
    setBonusTab("sales");
    setBonusSalesPeriod("thisMonth");
    setBonusSalesLocationId("");
    setBonusSalesStart(range.start);
    setBonusSalesEnd(range.end);
    setBonusSalesPreview(null);
    setBonusSalesCustomPct(employee.salesBonusPct != null ? String(employee.salesBonusPct) : "");
    setBonusDate(new Date().toLocaleDateString('en-CA'));
    setBonusNotes("");
    setBalesRows([{ locationId: "", sourceCompanyId: "", qty: "", rate: employee.balesBonusRate != null ? String(employee.balesBonusRate) : "", preview: null, loading: false }]);
    setBalesPeriod("thisMonth");
    setBalesStart(range.start);
    setBalesEnd(range.end);
    setBonusDialogOpen(true);
  };

  const fetchSalesPreview = async () => {
    if (!bonusSalesLocationId) return;
    const start = bonusSalesPeriod === "thisMonth" ? getThisMonthRange().start : bonusSalesStart;
    const end = bonusSalesPeriod === "thisMonth" ? getThisMonthRange().end : bonusSalesEnd;
    setBonusSalesLoading(true);
    try {
      const otherCompanyLoc = allCompanyLocations.find(l => l.id === parseInt(bonusSalesLocationId));
      const srcParam = otherCompanyLoc ? `&sourceCompanyId=${otherCompanyLoc.companyId}` : "";
      const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${bonusSalesLocationId}&startDate=${start}&endDate=${end}${srcParam}`);
      const data = await res.json();
      setBonusSalesPreview(data);
    } catch (e) {
      setBonusSalesPreview(null);
    }
    setBonusSalesLoading(false);
  };

  const fetchBalesQty = async (idx: number) => {
    const row = balesRows[idx];
    if (!row.locationId) return;
    const start = balesPeriod === "thisMonth" ? getThisMonthRange().start : balesStart;
    const end = balesPeriod === "thisMonth" ? getThisMonthRange().end : balesEnd;
    setBalesRows(prev => prev.map((r, i) => i === idx ? { ...r, loading: true } : r));
    try {
      const srcParam = row.sourceCompanyId ? `&sourceCompanyId=${row.sourceCompanyId}` : "";
      const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${row.locationId}&startDate=${start}&endDate=${end}${srcParam}`);
      const data = await res.json();
      setBalesRows(prev => prev.map((r, i) => i === idx ? { ...r, qty: Number(data.totalQuantity || 0).toFixed(0), loading: false } : r));
    } catch {
      setBalesRows(prev => prev.map((r, i) => i === idx ? { ...r, loading: false } : r));
    }
  };

  const getSmartBonusAmount = (): { amount: number; description: string } => {
    if (bonusTab === "sales") {
      if (!bonusSalesPreview) return { amount: 0, description: "" };
      const pct = parseFloat(bonusSalesCustomPct || "0");
      const sales = parseFloat(bonusSalesPreview.totalSalesAmount || "0");
      return {
        amount: (sales * pct) / 100,
        description: `Sales bonus ${pct}% of ${formatAmount(sales)} at ${bonusSalesPreview.locationName}`,
      };
    } else {
      const amount = balesRows.reduce((sum, r) => sum + parseFloat(r.qty || "0") * parseFloat(r.rate || "0"), 0);
      const parts = balesRows
        .filter(r => r.locationId && parseFloat(r.qty || "0") > 0)
        .map(r => {
          const loc = locations.find(l => l.id === parseInt(r.locationId))
            ?? allCompanyLocations.find(l => l.id === parseInt(r.locationId));
          return `${Number(r.qty).toFixed(0)} units × ${formatAmount(parseFloat(r.rate || "0"))} at ${loc?.name ?? "Unknown"}`;
        });
      return { amount, description: parts.join("; ") };
    }
  };

  const submitSmartBonus = async () => {
    const { amount, description } = getSmartBonusAmount();
    if (amount <= 0) return;
    try {
      await modeApiRequest("POST", "/api/payroll/bonus-employee", {
        employeeId: selectedEmployee?.id,
        amount: amount.toFixed(2),
        date: bonusDate,
        notes: bonusNotes || description,
      });
      toast({ title: "Bonus given", description: `${formatAmount(amount)} bonus processed` });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees-with-balances", selectedCompany?.id] });
      setBonusDialogOpen(false);
      setSelectedEmployee(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const autoCalculateBonuses = async () => {
    setBulkBonusAutoLoading(true);
    const start = bulkBonusAutoMonth === "thisMonth" ? getThisMonthRange().start : bulkBonusAutoStart;
    const end = bulkBonusAutoMonth === "thisMonth" ? getThisMonthRange().end : bulkBonusAutoEnd;
    const newAmounts: Record<number, string> = {};
    const newBreakdowns: Record<number, string[]> = {};
    try {
      for (const emp of employeeStaff) {
        const pct = parseFloat(emp.salesBonusPct || "0");
        const hasPct = pct > 0;

        const ratesRes = await modeApiRequest("GET", `/api/employees/${emp.id}/bale-rates`);
        const rates: Array<{ locationId: number; rate: string; sourceCompanyId?: number }> = await ratesRes.json();
        const hasBaleRates = rates && rates.length > 0;

        const pctRatesRes = await modeApiRequest("GET", `/api/employees/${emp.id}/bale-pct-rates`);
        const pctRates: Array<{ locationId: number; pct: string; sourceCompanyId?: number }> = await pctRatesRes.json();
        const hasPerLocationPct = pctRates && pctRates.length > 0;

        if (!hasBaleRates && !hasPct && !hasPerLocationPct) continue;

        let total = 0;
        const lines: string[] = [];

        if (hasBaleRates) {
          for (const r of rates) {
            const srcParam = (r as any).sourceCompanyId ? `&sourceCompanyId=${(r as any).sourceCompanyId}` : "";
            const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${r.locationId}&startDate=${start}&endDate=${end}${srcParam}`);
            const data = await res.json();
            const qty = parseFloat(data.totalQuantity || "0");
            const rate = parseFloat(r.rate || "0");
            const contrib = qty * rate;
            total += contrib;
            lines.push(`${data.locationName || `Loc ${r.locationId}`}: ${qty.toLocaleString()} units × ${rate} = ${contrib.toFixed(2)}`);
          }
        }
        // Per-location % bonus rates take priority over global salesBonusPct
        if (hasPerLocationPct) {
          for (const r of pctRates) {
            const srcParam = r.sourceCompanyId ? `&sourceCompanyId=${r.sourceCompanyId}` : "";
            const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${r.locationId}&startDate=${start}&endDate=${end}${srcParam}`);
            const data = await res.json();
            const salesAmt = parseFloat(data.totalSalesAmount || "0");
            const rPct = parseFloat(r.pct || "0");
            const contrib = (salesAmt * rPct) / 100;
            total += contrib;
            lines.push(`${data.locationName || `Loc ${r.locationId}`}: ${salesAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} × ${rPct}% = ${contrib.toFixed(2)}`);
          }
        } else {
          // Fallback: global salesBonusPct with per-employee or global location picker
          const empPctLocationId = (emp as any).salesBonusPctLocationId;
          const resolvedPctLocationId = empPctLocationId ? String(empPctLocationId) : bulkBonusAutoPctLocationId;
          if (hasPct && resolvedPctLocationId) {
            const empPctSrcCompanyId = (emp as any).salesBonusPctSourceCompanyId;
            const pctSrcParam = empPctSrcCompanyId ? `&sourceCompanyId=${empPctSrcCompanyId}` : "";
            const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${resolvedPctLocationId}&startDate=${start}&endDate=${end}${pctSrcParam}`);
            const data = await res.json();
            const salesAmt = parseFloat(data.totalSalesAmount || "0");
            const contrib = (salesAmt * pct) / 100;
            total += contrib;
            lines.push(`${data.locationName || `Loc ${resolvedPctLocationId}`}: ${salesAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} × ${pct}% = ${contrib.toFixed(2)}`);
          }
        }

        if (total > 0.005) {
          newAmounts[emp.id] = total.toFixed(2);
          newBreakdowns[emp.id] = lines;
        }
      }
      setBulkBonusAmounts(prev => ({ ...prev, ...newAmounts }));
      setBulkBonusBreakdowns(prev => ({ ...prev, ...newBreakdowns }));
      const count = Object.keys(newAmounts).length;
      toast({ title: "Auto-calculated", description: `Bonus calculated for ${count} employee${count !== 1 ? "s" : ""}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setBulkBonusAutoLoading(false);
  };

  const saveBonusToPending = () => {
    const { amount, description } = getSmartBonusAmount();
    if (amount <= 0 || !selectedEmployee) return;
    const empId = selectedEmployee.id;
    const empName = `${selectedEmployee.firstName} ${selectedEmployee.lastName}`;
    setPendingBonuses(prev => ({ ...prev, [empId]: { amount, description, employeeName: empName } }));
    toast({ title: "Bonus saved", description: `${formatAmount(amount)} saved for ${empName}. Open Bulk Bonus Deposit to review and post.` });
    setBonusDialogOpen(false);
    setSelectedEmployee(null);
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
        <PageHeader title="Payroll" />
        <Card className="p-6">
          <Skeleton className="h-[400px] w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Payroll</h1>

      {/* ── Mobile tab selector ── */}
      <div className="md:hidden">
        <Select value={selectedTab} onValueChange={setSelectedTab}>
          <SelectTrigger className="w-full" data-testid="select-payroll-tab">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="employees"><span className="flex items-center gap-2"><Users className="h-4 w-4" />Employees</span></SelectItem>
            <SelectItem value="worker-profiles"><span className="flex items-center gap-2"><User className="h-4 w-4" />Worker Profiles</span></SelectItem>
            <SelectItem value="run-payroll"><span className="flex items-center gap-2"><PlayCircle className="h-4 w-4" />Run Payroll</span></SelectItem>
            <SelectItem value="advances"><span className="flex items-center gap-2"><Banknote className="h-4 w-4" />Advances</span></SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-4 md:gap-6">
        {/* ── Desktop left nav ── */}
        <nav className="hidden md:block w-56 shrink-0 space-y-4">
          {[
            {
              label: "Payroll",
              items: [
                { key: "employees", label: "Employees", icon: Users as LucideIcon },
                { key: "worker-profiles", label: "Worker Profiles", icon: User as LucideIcon },
                { key: "run-payroll", label: "Run Payroll", icon: PlayCircle as LucideIcon },
                { key: "advances", label: "Advances", icon: Banknote as LucideIcon },
              ],
            },
          ].map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = selectedTab === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setSelectedTab(item.key)}
                      data-testid={`tab-${item.key}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
        {selectedTab === "employees" && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-employee-search"
                />
              </div>
              <div className="flex gap-1">
                {["Active", "Inactive", "All"].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={empStatusFilter === s ? "default" : "outline"}
                    onClick={() => setEmpStatusFilter(s)}
                    data-testid={`button-emp-filter-${s.toLowerCase()}`}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              <Button size="sm" onClick={() => setCreateEmployeeDialogOpen(true)} data-testid="button-create-employee">
                <Plus className="h-4 w-4 mr-2" />
                New Employee
              </Button>
            </div>

            <div className="space-y-4">
              {/* Payroll Actions */}
              {employeeStaff.length > 0 && (
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" data-testid="button-open-payroll-actions">
                        Payroll Actions
                        {Object.keys(pendingBonuses).length > 0 && (
                          <Badge className="ml-2" variant="default">
                            {Object.keys(pendingBonuses).length}
                          </Badge>
                        )}
                        <ChevronDown className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => { setBulkDepositSelections({}); setBulkDepositDialogOpen(true); }}
                        data-testid="button-open-bulk-deposit"
                      >
                        <ArrowDownCircle className="h-4 w-4 mr-2" /> Bulk Deposit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          const fromPending: Record<number, string> = {};
                          for (const [empId, pb] of Object.entries(pendingBonuses)) {
                            fromPending[parseInt(empId)] = pb.amount.toFixed(2);
                          }
                          setBulkBonusAmounts(fromPending);
                          setBulkBonusStep("edit");
                          setBulkBonusDialogOpen(true);
                        }}
                        data-testid="button-open-bulk-bonus"
                      >
                        <Gift className="h-4 w-4 mr-2" /> Bulk Bonus Deposit
                        {Object.keys(pendingBonuses).length > 0 && (
                          <Badge className="ml-2" variant="default">
                            {Object.keys(pendingBonuses).length}
                          </Badge>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => { setBulkWithdrawalAmounts({}); setBulkWithdrawalAccountId(""); setBulkWithdrawalDialogOpen(true); }}
                        data-testid="button-open-bulk-withdrawal"
                      >
                        <ArrowUpCircle className="h-4 w-4 mr-2" /> Bulk Withdrawal
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {employeeStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No employees found</p>
                  <p className="text-sm mt-2">Create employees from the Create Master Data page</p>
                </div>
              ) : filteredEmployeeStaff.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No employees match your search</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredEmployeeStaff.map((employee) => {
                    const balance = parseFloat(employee.calculatedBalance || "0");
                    const initials = getEmpInitials(employee.firstName, employee.lastName);
                    const avatarColor = getEmpAvatarColor(`${employee.firstName}${employee.lastName}`);
                    return (
                      <Card key={employee.id} data-testid={`card-employee-${employee.id}`}>
                        <CardContent className="p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            {/* Avatar + Name — fixed width so stats align across all cards */}
                            <div className="flex items-center gap-3 w-56 shrink-0 min-w-0">
                              <Avatar className="h-10 w-10 shrink-0">
                                <AvatarFallback className={`text-sm font-bold ${avatarColor}`}>
                                  {initials}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={() => setStatementEmployee(employee)}
                                    className="font-semibold text-base hover:underline cursor-pointer truncate"
                                    data-testid={`link-employee-statement-${employee.id}`}
                                  >
                                    {employee.firstName} {employee.lastName}
                                  </button>
                                  {!employee.active && (
                                    <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                  )}
                                </div>
                                {employee.department && (
                                  <p className="text-xs text-muted-foreground truncate">{employee.department}</p>
                                )}
                              </div>
                            </div>

                            {/* Stats — equal-width columns, fills remaining space */}
                            <div className="grid grid-cols-4 flex-1 min-w-0">
                              <div>
                                <p className="text-xs text-muted-foreground">Salary</p>
                                <p className="font-mono text-sm font-medium">{formatAmount(parseFloat(employee.monthlySalary))}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Balance</p>
                                <p className={`font-mono text-sm font-bold ${balance >= 0 ? "text-green-500 dark:text-green-400" : "text-destructive"}`}>
                                  {formatAmount(balance)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Deposits</p>
                                <p className="font-mono text-sm text-muted-foreground">{formatAmount(parseFloat(employee.totalDeposits || "0"))}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Withdrawals</p>
                                <p className="font-mono text-sm text-muted-foreground">{formatAmount(parseFloat(employee.totalWithdrawals || "0"))}</p>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 shrink-0">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" data-testid={`button-actions-${employee.id}`}>
                                    Actions <ChevronDown className="h-3.5 w-3.5 ml-1" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleDeposit(employee)} data-testid={`button-deposit-${employee.id}`}>
                                    <TrendingUp className="h-4 w-4 mr-2" /> Deposit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleBonus(employee)} data-testid={`button-bonus-${employee.id}`}>
                                    <DollarSign className="h-4 w-4 mr-2" /> Bonus
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleWithdrawal(employee)} data-testid={`button-withdraw-${employee.id}`}>
                                    <TrendingDown className="h-4 w-4 mr-2" /> Withdraw
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <Button size="icon" variant="ghost" onClick={() => { setEditingEmployee(employee); setEditEmployeeDialogOpen(true); }} data-testid={`button-edit-${employee.id}`}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <ConfirmationDialog
                                trigger={
                                  <Button size="icon" variant="ghost" className="text-destructive" data-testid={`button-delete-${employee.id}`}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                }
                                title="Delete Employee"
                                description={`Are you sure you want to delete ${[employee.firstName, employee.lastName].filter(Boolean).join(" ")}? This action cannot be undone.`}
                                confirmText="Delete"
                                variant="destructive"
                                onConfirm={() => handleDeleteEmployee(employee)}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {selectedTab === "workers" && (
          <>
          {/* Worker Payment Summary */}
          <Card className="p-6 mb-4">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
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
                            {formatAmount(parseFloat(wp.totalPaid))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between pt-4 border-t">
                  <span className="text-lg font-semibold">Grand Total Paid:</span>
                  <span className="text-lg font-semibold font-mono" data-testid="text-grand-total">
                    {formatAmount(parseFloat(workerPaymentSummary.grandTotal))}
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
                    <strong>{selectedPayments.length} workers selected</strong> - Total payment: {formatAmount(totalAmount)}
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
                                    {groupMembers.length} workers - {selectedCount} selected - Total: {formatAmount(groupTotal)}
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
                            <div className="border-t overflow-x-auto">
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
                                          <button
                                            onClick={() => setStatementEmployee(worker)}
                                            className="flex items-center gap-1 text-primary hover:underline cursor-pointer whitespace-nowrap"
                                            data-testid={`link-worker-statement-${worker.id}`}
                                          >
                                            {[worker.firstName, worker.lastName].filter(Boolean).join(" ")}
                                            <DollarSign className="h-3 w-3" />
                                          </button>
                                        </TableCell>
                                        <TableCell data-testid={`cell-monthly-salary-${worker.id}`} className="text-right font-mono text-muted-foreground">
                                          {formatAmount(monthlySalary)}
                                        </TableCell>
                                        <TableCell data-testid={`cell-advances-${worker.id}`} className="text-right font-mono">
                                          {advanceInfo.total > 0 ? (
                                            <span className="text-destructive">
                                              {formatAmount(advanceInfo.total)}
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
                                            description={`Are you sure you want to delete ${[worker.firstName, worker.lastName].filter(Boolean).join(" ")}? This action cannot be undone.`}
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
                      <div className="border-t overflow-x-auto">
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
                                    <button
                                      onClick={() => setStatementEmployee(worker)}
                                      className="flex items-center gap-1 text-primary hover:underline cursor-pointer whitespace-nowrap"
                                      data-testid={`link-worker-statement-${worker.id}`}
                                    >
                                      {[worker.firstName, worker.lastName].filter(Boolean).join(" ")}
                                      <DollarSign className="h-3 w-3" />
                                    </button>
                                  </TableCell>
                                  <TableCell data-testid={`cell-monthly-salary-${worker.id}`} className="text-right font-mono text-muted-foreground">
                                    {formatAmount(monthlySalary)}
                                  </TableCell>
                                  <TableCell data-testid={`cell-advances-${worker.id}`} className="text-right font-mono">
                                    {advanceInfo.total > 0 ? (
                                      <span className="text-destructive">
                                        {formatAmount(advanceInfo.total)}
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
                                    <div className="flex items-center gap-1">
                                      {workerGroups.length > 0 && (
                                        <Select
                                          onValueChange={(groupId) => {
                                            addWorkerToWorkerGroupMutation.mutate({
                                              groupId: parseInt(groupId),
                                              workerId: worker.id,
                                            });
                                          }}
                                        >
                                          <SelectTrigger
                                            className="h-8 w-32 text-xs"
                                            data-testid={`select-move-group-${worker.id}`}
                                          >
                                            <SelectValue placeholder="Move to group" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {workerGroups.map(g => (
                                              <SelectItem key={g.id} value={String(g.id)}>
                                                {g.name}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      )}
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
                                        description={`Are you sure you want to delete ${[worker.firstName, worker.lastName].filter(Boolean).join(" ")}? This action cannot be undone.`}
                                        confirmText="Delete"
                                        variant="destructive"
                                        onConfirm={() => handleDeleteWorker(worker)}
                                      />
                                    </div>
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
            <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-y-auto">
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
                                <TableCell>{[worker.firstName, worker.lastName].filter(Boolean).join(" ")}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(parseFloat(worker.monthlySalary || "0"))}
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
        </>
        )}

        {selectedTab === "worker-profiles" && (() => {
          const selectedWorkerProfile = selectedWorkerProfileId
            ? workerStaff.find(w => w.id === selectedWorkerProfileId) ?? null
            : null;

          // Workers belonging to the selected group filter (-1 = ungrouped)
          const allGroupedWorkerIds = workerGroups.flatMap(g => (g.members || []).map(m => m.id));
          const workerIdsInSelectedGroup = workerProfileGroupFilter === -1
            ? workerStaff.filter(w => !allGroupedWorkerIds.includes(w.id)).map(w => w.id)
            : workerProfileGroupFilter !== null
              ? (workerGroups.find(g => g.id === workerProfileGroupFilter)?.members || []).map(m => m.id)
              : null;

          const filteredWorkers = workerStaff.filter(w => {
            if (workerIdsInSelectedGroup !== null && !workerIdsInSelectedGroup.includes(w.id)) return false;
            const q = workerProfileSearch.toLowerCase();
            if (!q) return true;
            return (
              `${w.firstName} ${w.lastName}`.toLowerCase().includes(q) ||
              (w.code || "").toLowerCase().includes(q) ||
              (w.department || "").toLowerCase().includes(q)
            );
          });

          // Group membership lookup: workerId → group name
          const workerGroupMap: Record<number, string> = {};
          workerGroups.forEach(g => (g.members || []).forEach(m => { workerGroupMap[m.id] = g.name; }));

          if (selectedWorkerProfile) {
            return (
              <ERPWorkerDetail
                worker={selectedWorkerProfile as any}
                onBack={() => setSelectedWorkerProfileId(null)}
                onEdit={(w) => {
                  setSelectedWorkerForEdit(w as any);
                  setEditWorkerDialogOpen(true);
                }}
              />
            );
          }

          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold">Worker Profiles</h2>
                  <p className="text-sm text-muted-foreground">
                    Click a worker to view their profile, statement, advances, and documents
                  </p>
                </div>
                <Button onClick={() => setNewWorkerDialogOpen(true)} data-testid="button-new-worker-profile">
                  <Plus className="h-4 w-4 mr-2" /> New Worker
                </Button>
              </div>

              {/* Group filter tabs */}
              {workerGroups.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setWorkerProfileGroupFilter(null)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${workerProfileGroupFilter === null ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
                    data-testid="filter-group-all"
                  >
                    All Workers ({workerStaff.length})
                  </button>
                  {workerGroups.map(g => {
                    const count = workerStaff.filter(w => (g.members || []).some(m => m.id === w.id)).length;
                    return (
                      <button
                        key={g.id}
                        onClick={() => setWorkerProfileGroupFilter(g.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${workerProfileGroupFilter === g.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
                        data-testid={`filter-group-${g.id}`}
                      >
                        {g.name} ({count})
                      </button>
                    );
                  })}
                  {(() => {
                    const ungroupedCount = workerStaff.filter(w => !workerGroups.some(g => (g.members || []).some(m => m.id === w.id))).length;
                    if (ungroupedCount === 0) return null;
                    return (
                      <button
                        onClick={() => setWorkerProfileGroupFilter(-1)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${workerProfileGroupFilter === -1 ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80"}`}
                        data-testid="filter-group-ungrouped"
                      >
                        Ungrouped ({ungroupedCount})
                      </button>
                    );
                  })()}
                </div>
              )}

              {/* Search */}
              <Input
                placeholder="Search by name, code, or department..."
                value={workerProfileSearch}
                onChange={(e) => setWorkerProfileSearch(e.target.value)}
                data-testid="input-search-worker-profiles"
              />

              {/* Card grid */}
              {employeesLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-36" />
                  ))}
                </div>
              ) : filteredWorkers.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <HardHat className="mx-auto h-8 w-8 mb-3 opacity-30" />
                    <p className="text-sm">{workerStaff.length === 0 ? "No workers found. Create workers using the New Worker button." : "No workers match your search or filter."}</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredWorkers.map((worker) => {
                    const initials = getEmpInitials(worker.firstName, worker.lastName);
                    const avatarColor = getEmpAvatarColor(`${worker.firstName}${worker.lastName}`);
                    const isActive = worker.active !== false;
                    return (
                      <Card
                        key={worker.id}
                        className="cursor-pointer hover-elevate"
                        onClick={() => setSelectedWorkerProfileId(worker.id)}
                        data-testid={`card-worker-profile-${worker.id}`}
                      >
                        <CardContent className="p-4 flex flex-col items-center text-center relative">
                          <div className="absolute top-3 right-3">
                            <Badge
                              variant={isActive ? "default" : "secondary"}
                              className="text-xs"
                              data-testid={`badge-worker-status-${worker.id}`}
                            >
                              {isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <Avatar className="h-14 w-14 mt-1 mb-3">
                            <AvatarFallback className={`text-base font-semibold ${avatarColor}`}>
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <p className="font-semibold text-sm leading-tight uppercase" data-testid={`text-worker-name-${worker.id}`}>
                            {[worker.firstName, worker.lastName].filter(Boolean).join(" ")}
                          </p>
                          {workerGroupMap[worker.id] ? (
                            <Badge variant="secondary" className="mt-2 text-xs">
                              {workerGroupMap[worker.id]}
                            </Badge>
                          ) : workerGroups.length > 0 ? (
                            <div className="mt-2 w-full" onClick={(e) => e.stopPropagation()}>
                              <Select
                                onValueChange={(groupId) => {
                                  addWorkerToWorkerGroupMutation.mutate({
                                    groupId: parseInt(groupId),
                                    workerId: worker.id,
                                  });
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs w-full" data-testid={`select-card-move-group-${worker.id}`}>
                                  <SelectValue placeholder="Add to group…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {workerGroups.map(g => (
                                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                          <p className="font-mono text-sm font-medium mt-2" data-testid={`text-worker-salary-${worker.id}`}>
                            {formatAmount(parseFloat(worker.monthlySalary || "0"))}
                          </p>
                          <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); setWorkerDeductionTarget(worker as any); }}
                              data-testid={`button-deduction-worker-${worker.id}`}
                              title="Add deduction"
                            >
                              <MinusCircle className="h-3.5 w-3.5 text-amber-500" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); setSelectedWorkerForEdit(worker); setEditWorkerDialogOpen(true); }}
                              data-testid={`button-edit-profile-worker-${worker.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {selectedTab === "run-payroll" && (
          <ERPRunPayroll />
        )}

        {selectedTab === "advances" && (
          <ERPAdvancesTab />
        )}
        </div>
      </div>

      {/* Employee Deposit Dialog */}
      <DepositDialog
        open={depositDialogOpen}
        onOpenChange={setDepositDialogOpen}
        selectedEmployee={selectedEmployee}
        form={depositForm}
        mutation={depositMutation}
      />

      {/* Employee Smart Bonus Dialog */}
      <BonusDialog
        open={bonusDialogOpen}
        onOpenChange={setBonusDialogOpen}
        selectedEmployee={selectedEmployee}
        bonusTab={bonusTab}
        setBonusTab={setBonusTab}
        bonusSalesPreview={bonusSalesPreview}
        setBonusSalesPreview={setBonusSalesPreview}
        bonusSalesCustomPct={bonusSalesCustomPct}
        setBonusSalesCustomPct={setBonusSalesCustomPct}
        bonusSalesLocationId={bonusSalesLocationId}
        setBonusSalesLocationId={setBonusSalesLocationId}
        bonusSalesPeriod={bonusSalesPeriod}
        setBonusSalesPeriod={setBonusSalesPeriod}
        bonusSalesStart={bonusSalesStart}
        setBonusSalesStart={setBonusSalesStart}
        bonusSalesEnd={bonusSalesEnd}
        setBonusSalesEnd={setBonusSalesEnd}
        bonusSalesLoading={bonusSalesLoading}
        fetchSalesPreview={fetchSalesPreview}
        balesRows={balesRows}
        setBalesRows={setBalesRows}
        balesPeriod={balesPeriod}
        setBalesPeriod={setBalesPeriod}
        balesStart={balesStart}
        setBalesStart={setBalesStart}
        balesEnd={balesEnd}
        setBalesEnd={setBalesEnd}
        fetchBalesQty={fetchBalesQty}
        bonusDate={bonusDate}
        setBonusDate={setBonusDate}
        bonusNotes={bonusNotes}
        setBonusNotes={setBonusNotes}
        saveBonusToPending={saveBonusToPending}
        submitSmartBonus={submitSmartBonus}
        locations={locations}
        allCompanyLocations={allCompanyLocations}
      />

      {/* Employee Withdrawal Dialog */}
      <WithdrawalDialog
        open={withdrawalDialogOpen}
        onOpenChange={setWithdrawalDialogOpen}
        selectedEmployee={selectedEmployee}
        form={withdrawalForm}
        mutation={withdrawalMutation}
        cashAccounts={cashAccounts}
        bankAccounts={bankAccounts}
        bankAccountsLoading={bankAccountsLoading}
      />

      {/* Bulk Payment Dialog */}
      <BulkPaymentDialog
        open={bulkPaymentDialogOpen}
        onOpenChange={setBulkPaymentDialogOpen}
        selectedPayments={selectedPayments}
        totalAmount={totalAmount}
        workerStaff={workerStaff}
        form={bulkPaymentForm}
        mutation={bulkPaymentMutation}
        cashAccounts={cashAccounts}
        bankAccounts={bankAccounts}
        bankAccountsLoading={bankAccountsLoading}
      />

      {/* Advance / Deduction Dialogs */}
      <AdvanceDialogs
        advanceDialogOpen={advanceDialogOpen}
        setAdvanceDialogOpen={setAdvanceDialogOpen}
        advanceForm={advanceForm}
        advanceMutation={advanceMutation}
        advanceWorkerComboOpen={advanceWorkerComboOpen}
        setAdvanceWorkerComboOpen={setAdvanceWorkerComboOpen}
        workerStaff={workerStaff}
        cashAccounts={cashAccounts}
        deductionDialogOpen={deductionDialogOpen}
        setDeductionDialogOpen={setDeductionDialogOpen}
        selectedAdvance={selectedAdvance}
        deductionForm={deductionForm}
        deductionMutation={deductionMutation}
        advanceToDelete={advanceToDelete}
        setAdvanceToDelete={setAdvanceToDelete}
        deleteAdvanceMutation={deleteAdvanceMutation}
      />

      {/* Worker Dialogs */}
      <WorkerDialogs
        newWorkerDialogOpen={newWorkerDialogOpen}
        setNewWorkerDialogOpen={setNewWorkerDialogOpen}
        newWorkerForm={newWorkerForm}
        createWorkerMutation={createWorkerMutation}
        editWorkerDialogOpen={editWorkerDialogOpen}
        setEditWorkerDialogOpen={setEditWorkerDialogOpen}
        selectedWorkerForEdit={selectedWorkerForEdit}
        editWorkerForm={editWorkerForm}
        updateWorkerMutation={updateWorkerMutation}
        deleteWorkerConflict={deleteWorkerConflict}
        setDeleteWorkerConflict={setDeleteWorkerConflict}
        handleForceDeleteWorker={handleForceDeleteWorker}
      />


      {/* Employee CRUD Dialogs */}
      <EmployeeCrudDialogs
        createEmployeeDialogOpen={createEmployeeDialogOpen}
        setCreateEmployeeDialogOpen={setCreateEmployeeDialogOpen}
        createEmployeeForm={createEmployeeForm}
        createEmployeeMutation={createEmployeeMutation}
        employeeGroups={employeeGroups}
        deleteConflict={deleteConflict}
        setDeleteConflict={setDeleteConflict}
        handleForceDeleteEmployee={handleForceDeleteEmployee}
        createGroupDialogOpen={createGroupDialogOpen}
        setCreateGroupDialogOpen={setCreateGroupDialogOpen}
        newGroupName={newGroupName}
        setNewGroupName={setNewGroupName}
        newGroupDescription={newGroupDescription}
        setNewGroupDescription={setNewGroupDescription}
        createGroupMutation={createGroupMutation}
        groupMembersDialogOpen={groupMembersDialogOpen}
        setGroupMembersDialogOpen={setGroupMembersDialogOpen}
        selectedGroupForMembers={selectedGroupForMembers}
        employeeStaff={employeeStaff}
        groupMembers={groupMembers}
        addWorkerToGroupMutation={addWorkerToGroupMutation}
        removeWorkerFromGroupMutation={removeWorkerFromGroupMutation}
      />

      {/* Bulk Dialogs */}
      <BulkDialogs
        bulkDepositDialogOpen={bulkDepositDialogOpen}
        setBulkDepositDialogOpen={setBulkDepositDialogOpen}
        bulkDepositDate={bulkDepositDate}
        setBulkDepositDate={setBulkDepositDate}
        bulkDepositNotes={bulkDepositNotes}
        setBulkDepositNotes={setBulkDepositNotes}
        employeeStaff={employeeStaff}
        bulkDepositSelections={bulkDepositSelections}
        handleSelectAllEmployees={handleSelectAllEmployees}
        handleToggleEmployeeDeposit={handleToggleEmployeeDeposit}
        bulkDepositTotal={bulkDepositTotal}
        validSelectedEmployees={validSelectedEmployees}
        bulkDepositMutation={bulkDepositMutation}
        bulkWithdrawalDialogOpen={bulkWithdrawalDialogOpen}
        setBulkWithdrawalDialogOpen={setBulkWithdrawalDialogOpen}
        bulkWithdrawalDate={bulkWithdrawalDate}
        setBulkWithdrawalDate={setBulkWithdrawalDate}
        bulkWithdrawalAccountType={bulkWithdrawalAccountType}
        setBulkWithdrawalAccountType={setBulkWithdrawalAccountType}
        bulkWithdrawalAccountId={bulkWithdrawalAccountId}
        setBulkWithdrawalAccountId={setBulkWithdrawalAccountId}
        bulkWithdrawalNotes={bulkWithdrawalNotes}
        setBulkWithdrawalNotes={setBulkWithdrawalNotes}
        bulkWithdrawalAmounts={bulkWithdrawalAmounts}
        setBulkWithdrawalAmounts={setBulkWithdrawalAmounts}
        bulkWithdrawalMutation={bulkWithdrawalMutation}
        cashAccounts={cashAccounts}
        bankAccounts={bankAccounts}
        bulkBonusDialogOpen={bulkBonusDialogOpen}
        setBulkBonusDialogOpen={setBulkBonusDialogOpen}
        bulkBonusStep={bulkBonusStep}
        setBulkBonusStep={setBulkBonusStep}
        bulkBonusDate={bulkBonusDate}
        setBulkBonusDate={setBulkBonusDate}
        bulkBonusNotes={bulkBonusNotes}
        setBulkBonusNotes={setBulkBonusNotes}
        bulkBonusAutoMonth={bulkBonusAutoMonth}
        setBulkBonusAutoMonth={setBulkBonusAutoMonth}
        bulkBonusAutoStart={bulkBonusAutoStart}
        setBulkBonusAutoStart={setBulkBonusAutoStart}
        bulkBonusAutoEnd={bulkBonusAutoEnd}
        setBulkBonusAutoEnd={setBulkBonusAutoEnd}
        autoCalculateBonuses={autoCalculateBonuses}
        bulkBonusAutoLoading={bulkBonusAutoLoading}
        bulkBonusAutoPctLocationId={bulkBonusAutoPctLocationId}
        setBulkBonusAutoPctLocationId={setBulkBonusAutoPctLocationId}
        bulkBonusAmounts={bulkBonusAmounts}
        setBulkBonusAmounts={setBulkBonusAmounts}
        pendingBonuses={pendingBonuses}
        bulkBonusBreakdowns={bulkBonusBreakdowns}
        bulkBonusMutation={bulkBonusMutation}
        handlePrintBulkBonus={handlePrintBulkBonus}
        locations={locations}
      />

      {/* Employee Statement Dialog */}
      <EmployeeStatementDialog
        statementEmployee={statementEmployee}
        setStatementEmployee={setStatementEmployee}
        transactionsLoading={transactionsLoading}
        employeeTransactions={employeeTransactions}
        statementExpanded={statementExpanded}
        setStatementExpanded={setStatementExpanded}
        cleanTxnDesc={cleanTxnDesc}
      />

      {/* Edit Employee Dialog */}
      <EditEmployeeDialog
        open={editEmployeeDialogOpen}
        onOpenChange={setEditEmployeeDialogOpen}
        setEditingEmployee={setEditingEmployee}
        editEmployeeForm={editEmployeeForm}
        editEmployeeMutation={editEmployeeMutation}
        employeeGroups={employeeGroups}
        otherCompanies={otherCompanies}
        selectedCompany={selectedCompany}
        locations={locations}
        allCompanyLocations={allCompanyLocations}
        editBaleRates={editBaleRates}
        setEditBaleRates={setEditBaleRates}
        editBalePctRates={editBalePctRates}
        setEditBalePctRates={setEditBalePctRates}
        pctLocations={pctLocations}
      />

      {/* Worker Deduction Dialog */}
      <Dialog open={!!workerDeductionTarget} onOpenChange={(open) => { if (!open) { setWorkerDeductionTarget(null); setWorkerDeductionAmount(""); setWorkerDeductionReason(""); } }}>
        <DialogContent data-testid="dialog-worker-deduction">
          <DialogHeader>
            <DialogTitle>Add Deduction</DialogTitle>
            <DialogDescription>
              {workerDeductionTarget
                ? `Deduction for ${[workerDeductionTarget.firstName, (workerDeductionTarget as any).lastName].filter(Boolean).join(" ")}. Pending deductions are applied automatically at the next payroll run.`
                : "Add a pending deduction for this worker."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="ded-amount">Amount</Label>
              <Input
                id="ded-amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={workerDeductionAmount}
                onChange={(e) => setWorkerDeductionAmount(e.target.value)}
                data-testid="input-worker-deduction-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ded-reason">Reason (optional)</Label>
              <Input
                id="ded-reason"
                placeholder="e.g. Uniform, Damage, etc."
                value={workerDeductionReason}
                onChange={(e) => setWorkerDeductionReason(e.target.value)}
                data-testid="input-worker-deduction-reason"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ded-date">Date</Label>
              <Input
                id="ded-date"
                type="date"
                value={workerDeductionDate}
                onChange={(e) => setWorkerDeductionDate(e.target.value)}
                data-testid="input-worker-deduction-date"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setWorkerDeductionTarget(null); setWorkerDeductionAmount(""); setWorkerDeductionReason(""); }} data-testid="button-cancel-worker-deduction">
              Cancel
            </Button>
            <Button
              onClick={() => workerDeductionMutation.mutate()}
              disabled={workerDeductionMutation.isPending || !workerDeductionAmount}
              data-testid="button-submit-worker-deduction"
            >
              {workerDeductionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Deduction
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
