import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { DollarSign, TrendingDown, TrendingUp, Users, AlertCircle, CalendarIcon, Plus, Pencil, Trash2, ChevronDown, ExternalLink, User, HardHat, Banknote, ArrowDownCircle, ArrowUpCircle, Gift, Receipt, PlayCircle, X, Loader2, RefreshCw, Percent, Package, Save, ChevronRight, Printer } from "lucide-react";
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
        active: selectedWorkerForEdit.active,
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
      return await modeApiRequest("PUT", `/api/employees/${data.id}`, {
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
        active: editingEmployee.active,
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

        if (hasBaleRates) {
          for (const r of rates) {
            const srcParam = (r as any).sourceCompanyId ? `&sourceCompanyId=${(r as any).sourceCompanyId}` : "";
            const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${r.locationId}&startDate=${start}&endDate=${end}${srcParam}`);
            const data = await res.json();
            // Per-unit bale bonus
            total += parseFloat(data.totalQuantity || "0") * parseFloat(r.rate || "0");
          }
        }
        // Per-location % bonus rates take priority over global salesBonusPct
        if (hasPerLocationPct) {
          for (const r of pctRates) {
            const srcParam = r.sourceCompanyId ? `&sourceCompanyId=${r.sourceCompanyId}` : "";
            const res = await modeApiRequest("GET", `/api/payroll/sales-summary?locationId=${r.locationId}&startDate=${start}&endDate=${end}${srcParam}`);
            const data = await res.json();
            total += (parseFloat(data.totalSalesAmount || "0") * parseFloat(r.pct || "0")) / 100;
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
            total += (parseFloat(data.totalSalesAmount || "0") * pct) / 100;
          }
        }

        if (total > 0.005) newAmounts[emp.id] = total.toFixed(2);
      }
      setBulkBonusAmounts(prev => ({ ...prev, ...newAmounts }));
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
                <div className="rounded-md border bg-muted/30 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Payroll Actions</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBulkDepositSelections({});
                        setBulkDepositDialogOpen(true);
                      }}
                      data-testid="button-open-bulk-deposit"
                    >
                      <ArrowDownCircle className="h-4 w-4 mr-2" />
                      Bulk Deposit
                    </Button>
                    <Button
                      variant="outline"
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
                      <Gift className="h-4 w-4 mr-2" />
                      Bulk Bonus Deposit
                      {Object.keys(pendingBonuses).length > 0 && (
                        <Badge className="ml-2" variant="default">
                          {Object.keys(pendingBonuses).length}
                        </Badge>
                      )}
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
                      <ArrowUpCircle className="h-4 w-4 mr-2" />
                      Bulk Withdrawal
                    </Button>
                  </div>
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
                          <div className="flex items-start gap-4">
                            <Avatar className="h-11 w-11 shrink-0">
                              <AvatarFallback className={`text-sm font-semibold ${avatarColor}`}>
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <button
                                  onClick={() => setStatementEmployee(employee)}
                                  className="font-semibold text-sm hover:underline cursor-pointer"
                                  data-testid={`link-employee-statement-${employee.id}`}
                                >
                                  {employee.firstName} {employee.lastName}
                                </button>
                                {employee.code && (
                                  <Badge variant="outline" className="text-xs font-mono">
                                    {employee.code}
                                  </Badge>
                                )}
                                {!employee.active && (
                                  <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                )}
                              </div>
                              {employee.department && (
                                <p className="text-xs text-muted-foreground">{employee.department}</p>
                              )}
                              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div>
                                  <span className="text-xs text-muted-foreground block">Monthly Salary</span>
                                  <span className="font-mono text-sm">{formatAmount(parseFloat(employee.monthlySalary))}</span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground block">Balance</span>
                                  <span className={`font-mono font-semibold text-sm ${balance >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                                    {formatAmount(balance)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground block">Total Deposits</span>
                                  <span className="font-mono text-sm text-muted-foreground">{formatAmount(parseFloat(employee.totalDeposits || "0"))}</span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground block">Withdrawals</span>
                                  <span className="font-mono text-sm text-muted-foreground">{formatAmount(parseFloat(employee.totalWithdrawals || "0"))}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1 shrink-0">
                              <Button size="sm" variant="outline" onClick={() => handleDeposit(employee)} data-testid={`button-deposit-${employee.id}`}>
                                <TrendingUp className="h-3.5 w-3.5 mr-1" /> Deposit
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleBonus(employee)} data-testid={`button-bonus-${employee.id}`}>
                                <DollarSign className="h-3.5 w-3.5 mr-1" /> Bonus
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleWithdrawal(employee)} data-testid={`button-withdraw-${employee.id}`}>
                                <TrendingDown className="h-3.5 w-3.5 mr-1" /> Withdraw
                              </Button>
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
                                description={`Are you sure you want to delete ${employee.firstName} ${employee.lastName}? This action cannot be undone.`}
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
                                            {worker.firstName} {worker.lastName}
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
                                      {worker.firstName} {worker.lastName}
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
                                <TableCell>{worker.firstName} {worker.lastName}</TableCell>
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
                    <div key={i} className="h-36 rounded-md bg-muted animate-pulse" />
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
                            {worker.firstName} {worker.lastName}
                          </p>
                          {worker.code && (
                            <p className="text-xs text-muted-foreground mt-0.5 font-mono" data-testid={`text-worker-code-${worker.id}`}>{worker.code}</p>
                          )}
                          {workerGroupMap[worker.id] && (
                            <Badge variant="secondary" className="mt-2 text-xs">
                              {workerGroupMap[worker.id]}
                            </Badge>
                          )}
                          <p className="font-mono text-sm font-medium mt-2" data-testid={`text-worker-salary-${worker.id}`}>
                            {formatAmount(parseFloat(worker.monthlySalary || "0"))}
                          </p>
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
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
      <Dialog open={depositDialogOpen} onOpenChange={setDepositDialogOpen}>
        <DialogContent data-testid="dialog-deposit">
          <DialogHeader>
            <DialogTitle>Deposit Salary</DialogTitle>
            <DialogDescription>
              Add salary to {selectedEmployee?.firstName} {selectedEmployee?.lastName}'s balance account
            </DialogDescription>
          </DialogHeader>

          <Form {...depositForm}>
            <form noValidate onSubmit={depositForm.handleSubmit((data) => depositMutation.mutate(data))} className="space-y-4">
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

      {/* Employee Smart Bonus Dialog */}
      <Dialog open={bonusDialogOpen} onOpenChange={setBonusDialogOpen}>
        <DialogContent data-testid="dialog-bonus" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Calculate Bonus</DialogTitle>
            <DialogDescription>
              {selectedEmployee?.firstName} {selectedEmployee?.lastName}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={bonusTab} onValueChange={(v) => { setBonusTab(v as "sales" | "bales"); setBonusSalesPreview(null); }}>
            <TabsList className="w-full">
              <TabsTrigger value="sales" className="flex-1" data-testid="tab-sales-bonus">
                <Percent className="h-4 w-4 mr-1" />
                Sales %
              </TabsTrigger>
              <TabsTrigger value="bales" className="flex-1" data-testid="tab-bales-bonus">
                <Package className="h-4 w-4 mr-1" />
                Bales / Units
              </TabsTrigger>
            </TabsList>

            {/* ── Sales % Tab ── */}
            <TabsContent value="sales" className="space-y-4 mt-4">
              {selectedEmployee?.salesBonusPct == null || parseFloat(selectedEmployee.salesBonusPct) === 0 ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    No sales bonus % configured for this employee. Edit the employee to set a percentage.
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-1">
                <Label>Bonus Rate (%)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  placeholder="e.g. 0.2"
                  value={bonusSalesCustomPct}
                  onChange={(e) => { setBonusSalesCustomPct(e.target.value); setBonusSalesPreview(null); }}
                  data-testid="input-sales-bonus-pct"
                />
                <p className="text-xs text-muted-foreground">Total sales × this % = bonus</p>
              </div>

              <div className="space-y-1">
                <Label>Location</Label>
                <Select value={bonusSalesLocationId} onValueChange={(v) => { setBonusSalesLocationId(v); setBonusSalesPreview(null); }}>
                  <SelectTrigger data-testid="select-sales-location">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>This Company</SelectLabel>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                      ))}
                    </SelectGroup>
                    {allCompanyLocations.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Other Companies</SelectLabel>
                        {allCompanyLocations.map((loc) => (
                          <SelectItem key={`oc-${loc.id}`} value={String(loc.id)}>{loc.name} ({loc.companyName})</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Period</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={bonusSalesPeriod === "thisMonth" ? "default" : "outline"}
                    onClick={() => { setBonusSalesPeriod("thisMonth"); setBonusSalesPreview(null); }}
                    data-testid="button-sales-this-month"
                  >
                    This Month
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={bonusSalesPeriod === "custom" ? "default" : "outline"}
                    onClick={() => { setBonusSalesPeriod("custom"); setBonusSalesPreview(null); }}
                    data-testid="button-sales-custom-period"
                  >
                    Custom
                  </Button>
                </div>
                {bonusSalesPeriod === "custom" && (
                  <div className="flex gap-2 mt-2">
                    <Input type="date" value={bonusSalesStart} onChange={(e) => { setBonusSalesStart(e.target.value); setBonusSalesPreview(null); }} data-testid="input-sales-start" />
                    <Input type="date" value={bonusSalesEnd} onChange={(e) => { setBonusSalesEnd(e.target.value); setBonusSalesPreview(null); }} data-testid="input-sales-end" />
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={fetchSalesPreview}
                disabled={!bonusSalesLocationId || bonusSalesLoading}
                data-testid="button-calculate-sales"
              >
                {bonusSalesLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Calculate Bonus
              </Button>

              {bonusSalesPreview && (
                <div className="rounded-md border bg-muted/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location</span>
                    <span className="font-medium">{bonusSalesPreview.locationName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Sales</span>
                    <span className="font-medium font-mono">{formatAmount(parseFloat(bonusSalesPreview.totalSalesAmount || "0"))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate</span>
                    <span className="font-medium">{bonusSalesCustomPct}%</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-base font-semibold">
                    <span>Bonus Amount</span>
                    <span className="text-green-600 dark:text-green-400 font-mono">
                      {formatAmount((parseFloat(bonusSalesPreview.totalSalesAmount || "0") * parseFloat(bonusSalesCustomPct || "0")) / 100)}
                    </span>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Bales / Units Tab ── */}
            <TabsContent value="bales" className="space-y-4 mt-4">
              <div className="space-y-1">
                <Label>Period</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={balesPeriod === "thisMonth" ? "default" : "outline"}
                    onClick={() => setBalesPeriod("thisMonth")}
                    data-testid="button-bales-this-month"
                  >
                    This Month
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={balesPeriod === "custom" ? "default" : "outline"}
                    onClick={() => setBalesPeriod("custom")}
                    data-testid="button-bales-custom-period"
                  >
                    Custom
                  </Button>
                </div>
                {balesPeriod === "custom" && (
                  <div className="flex gap-2 mt-2">
                    <Input type="date" value={balesStart} onChange={(e) => setBalesStart(e.target.value)} data-testid="input-bales-start" />
                    <Input type="date" value={balesEnd} onChange={(e) => setBalesEnd(e.target.value)} data-testid="input-bales-end" />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_72px_32px_72px_32px] gap-2 text-xs text-muted-foreground px-1">
                  <span>Location</span><span>Qty</span><span></span><span>Rate ($)</span><span></span>
                </div>
                {balesRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_72px_32px_72px_32px] gap-2 items-center">
                    <Select
                      value={row.locationId}
                      onValueChange={(v) => {
                        const otherLoc = allCompanyLocations.find(l => l.id === parseInt(v));
                        setBalesRows(prev => prev.map((r, i) => i === idx ? { ...r, locationId: v, sourceCompanyId: otherLoc ? String(otherLoc.companyId) : "", qty: "" } : r));
                      }}
                    >
                      <SelectTrigger data-testid={`select-bales-location-${idx}`} className="h-9">
                        <SelectValue placeholder="Shop" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>This Company</SelectLabel>
                          {locations.map((loc) => (
                            <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                          ))}
                        </SelectGroup>
                        {allCompanyLocations.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Other Companies</SelectLabel>
                            {allCompanyLocations.map((loc) => (
                              <SelectItem key={`oc-${loc.id}`} value={String(loc.id)}>{loc.name} ({loc.companyName})</SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="0"
                      value={row.qty}
                      className="h-9"
                      onChange={(e) => setBalesRows(prev => prev.map((r, i) => i === idx ? { ...r, qty: e.target.value } : r))}
                      data-testid={`input-bales-qty-${idx}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Fetch qty from sales data"
                      disabled={!row.locationId || row.loading}
                      onClick={() => fetchBalesQty(idx)}
                      data-testid={`button-fetch-qty-${idx}`}
                    >
                      {row.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    </Button>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={row.rate}
                      className="h-9"
                      onChange={(e) => setBalesRows(prev => prev.map((r, i) => i === idx ? { ...r, rate: e.target.value } : r))}
                      data-testid={`input-bales-rate-${idx}`}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setBalesRows(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))}
                      data-testid={`button-remove-bales-row-${idx}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {balesRows.map((row, idx) => {
                  const q = parseFloat(row.qty || "0");
                  const r = parseFloat(row.rate || "0");
                  const total = q * r;
                  if (total <= 0) return null;
                  const loc = locations.find(l => l.id === parseInt(row.locationId))
                    ?? allCompanyLocations.find(l => l.id === parseInt(row.locationId));
                  return (
                    <p key={`hint-${idx}`} className="text-xs text-muted-foreground px-1">
                      {loc?.name}: {Number(q).toFixed(0)} × {formatAmount(r)} = <strong>{formatAmount(total)}</strong>
                    </p>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBalesRows(prev => [...prev, { locationId: "", sourceCompanyId: "", qty: "", rate: selectedEmployee?.balesBonusRate != null ? String(selectedEmployee.balesBonusRate) : "", preview: null, loading: false }])}
                data-testid="button-add-bales-row"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Shop
              </Button>

              {(() => {
                const total = balesRows.reduce((sum, r) => sum + parseFloat(r.qty || "0") * parseFloat(r.rate || "0"), 0);
                if (total <= 0) return null;
                return (
                  <div className="rounded-md border bg-muted/30 p-3 flex justify-between items-center">
                    <span className="font-medium text-sm">Total Bonus</span>
                    <span className="text-green-600 dark:text-green-400 font-semibold font-mono">{formatAmount(total)}</span>
                  </div>
                );
              })()}
            </TabsContent>
          </Tabs>

          <Separator />

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={bonusDate} onChange={(e) => setBonusDate(e.target.value)} data-testid="input-bonus-date" />
            </div>
            <div className="space-y-1">
              <Label>Notes (Optional)</Label>
              <Textarea
                placeholder="Reason for bonus..."
                value={bonusNotes}
                onChange={(e) => setBonusNotes(e.target.value)}
                data-testid="input-bonus-notes"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 flex-wrap">
            <Button type="button" variant="outline" onClick={() => setBonusDialogOpen(false)} data-testid="button-cancel-bonus">
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={saveBonusToPending}
              disabled={
                bonusTab === "sales"
                  ? !bonusSalesPreview || parseFloat(bonusSalesCustomPct || "0") <= 0
                  : balesRows.reduce((s, r) => s + parseFloat(r.qty || "0") * parseFloat(r.rate || "0"), 0) <= 0
              }
              data-testid="button-save-bonus-to-bulk"
            >
              <Save className="h-4 w-4 mr-2" />
              Save to Bulk
            </Button>
            <Button
              type="button"
              onClick={submitSmartBonus}
              disabled={
                bonusTab === "sales"
                  ? !bonusSalesPreview || parseFloat(bonusSalesCustomPct || "0") <= 0
                  : balesRows.reduce((s, r) => s + parseFloat(r.qty || "0") * parseFloat(r.rate || "0"), 0) <= 0
              }
              data-testid="button-submit-bonus"
            >
              {bonusTab === "sales" && bonusSalesPreview
                ? `Give Now ${formatAmount((parseFloat(bonusSalesPreview.totalSalesAmount || "0") * parseFloat(bonusSalesCustomPct || "0")) / 100)}`
                : bonusTab === "bales"
                ? `Give Now ${formatAmount(balesRows.reduce((s, r) => s + parseFloat(r.qty || "0") * parseFloat(r.rate || "0"), 0))}`
                : "Give Now"}
            </Button>
          </div>
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
            <form noValidate onSubmit={withdrawalForm.handleSubmit((data) => withdrawalMutation.mutate(data))} className="space-y-4">
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
        <DialogContent data-testid="dialog-bulk-payment" className="max-w-4xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>Process Bulk Payment</DialogTitle>
            <DialogDescription>
              Pay {selectedPayments.length} workers - Total amount: {formatAmount(totalAmount)}
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
                    <span className="font-mono">{formatAmount(parseFloat(payment.amount))}</span>
                  </div>
                );
              })}
              <div className="pt-2 border-t mt-3 flex justify-between font-semibold">
                <span>Total</span>
                <span className="font-mono">{formatAmount(totalAmount)}</span>
              </div>
            </div>
          </div>

          <Form {...bulkPaymentForm}>
            <form noValidate onSubmit={bulkPaymentForm.handleSubmit((data) => bulkPaymentMutation.mutate(data))} className="space-y-4">
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
        <DialogContent data-testid="dialog-new-advance" className="max-w-lg w-[95vw] md:w-auto">
          <DialogHeader>
            <DialogTitle>New Salary Advance</DialogTitle>
            <DialogDescription>
              Record a salary advance given to a worker
            </DialogDescription>
          </DialogHeader>

          <Form {...advanceForm}>
            <form noValidate onSubmit={advanceForm.handleSubmit((data) => advanceMutation.mutate(data))} className="space-y-4">
              <FormField
                control={advanceForm.control}
                name="employeeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Worker</FormLabel>
                    <Popover open={advanceWorkerComboOpen} onOpenChange={setAdvanceWorkerComboOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            data-testid="select-advance-employee"
                            className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                          >
                            {field.value
                              ? (() => {
                                  const w = workerStaff.find(w => w.id.toString() === field.value);
                                  return w ? `${w.firstName} ${w.lastName} (${w.code})` : "Select worker";
                                })()
                              : "Select worker"}
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search workers..." />
                          <CommandList>
                            <CommandEmpty>No workers found.</CommandEmpty>
                            <CommandGroup>
                              {workerStaff.map((worker) => (
                                <CommandItem
                                  key={worker.id}
                                  value={`${worker.firstName} ${worker.lastName} ${worker.code}`}
                                  onSelect={() => {
                                    field.onChange(worker.id.toString());
                                    setAdvanceWorkerComboOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", field.value === worker.id.toString() ? "opacity-100" : "opacity-0")} />
                                  {worker.firstName} {worker.lastName} ({worker.code})
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
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
                              formatDisplayDate(field.value)
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
                name="isOpeningBalance"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/50">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-opening-balance"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Opening Balance (from Tally)</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Check this if importing an existing balance from your old system. This will not create any cash transaction.
                      </p>
                    </div>
                  </FormItem>
                )}
              />

              {!advanceForm.watch("isOpeningBalance") && (
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
              )}

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
                <span className="font-mono">{formatAmount(parseFloat(selectedAdvance.amount))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Remaining Balance:</span>
                <span className="font-mono font-semibold" data-testid="text-deduction-remaining">
                  {formatAmount(parseFloat(selectedAdvance.remainingBalance))}
                </span>
              </div>
            </div>
          )}

          <Form {...deductionForm}>
            <form noValidate onSubmit={deductionForm.handleSubmit((data) => deductionMutation.mutate(data))} className="space-y-4">
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
                        Maximum: {formatAmount(parseFloat(selectedAdvance.remainingBalance))}
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
            <form noValidate onSubmit={newWorkerForm.handleSubmit((data) => createWorkerMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <form noValidate onSubmit={editWorkerForm.handleSubmit((data) => {
              if (selectedWorkerForEdit) {
                updateWorkerMutation.mutate({ ...data, id: selectedWorkerForEdit.id });
              }
            })} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      {/* Delete Salary Advance Confirmation */}
      <AlertDialog open={advanceToDelete !== null} onOpenChange={(open) => !open && setAdvanceToDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-advance">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Salary Advance</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the advance and all associated deduction records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (advanceToDelete !== null) {
                  deleteAdvanceMutation.mutate(advanceToDelete);
                  setAdvanceToDelete(null);
                }
              }}
              data-testid="button-confirm-delete-advance"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                    <div>Employee Balance: {formatAmount(deleteWorkerConflict.employeeBalance)}</div>
                    <div>Ledger Balance: {formatAmount(deleteWorkerConflict.ledgerBalance)}</div>
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
            <form noValidate onSubmit={createEmployeeForm.handleSubmit((data) => createEmployeeMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Bonus Configuration (Optional)</p>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createEmployeeForm.control}
                    name="salesBonusPct"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Sales Bonus %</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.0001"
                            placeholder="e.g. 0.2"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-sales-bonus-pct-create"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createEmployeeForm.control}
                    name="balesBonusRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bales Rate ($/unit)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="e.g. 2.00"
                            {...field}
                            value={field.value || ""}
                            data-testid="input-bales-bonus-rate-create"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

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
                    <div>Employee Balance: {formatAmount(deleteConflict.employeeBalance)}</div>
                    <div>Ledger Balance: {formatAmount(deleteConflict.ledgerBalance)}</div>
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
        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-bulk-deposit">
          <DialogHeader>
            <DialogTitle>Bulk Salary Deposit</DialogTitle>
            <DialogDescription>
              Select employees and deposit their monthly salary. Leave an employee unchecked to skip them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            </div>

            <div className="border rounded-md flex-1 overflow-hidden">
              <div className="max-h-[360px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={employeeStaff.length > 0 && employeeStaff.every(emp => bulkDepositSelections[emp.id])}
                          onCheckedChange={handleSelectAllEmployees}
                          data-testid="checkbox-select-all-employees"
                        />
                      </TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Monthly Salary</TableHead>
                      <TableHead className="text-right">Current Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employeeStaff.map((emp) => {
                      const salary = parseFloat(emp.monthlySalary || "0");
                      const hasValidSalary = !isNaN(salary) && salary > 0;
                      return (
                        <TableRow
                          key={emp.id}
                          className={bulkDepositSelections[emp.id] ? "bg-muted/40" : ""}
                          onClick={() => handleToggleEmployeeDeposit(emp.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <TableCell>
                            <Checkbox
                              checked={bulkDepositSelections[emp.id] || false}
                              onCheckedChange={() => handleToggleEmployeeDeposit(emp.id)}
                              data-testid={`checkbox-deposit-employee-${emp.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{emp.firstName} {emp.lastName}</div>
                            {emp.code && <div className="text-xs text-muted-foreground">{emp.code}</div>}
                            {!hasValidSalary && (
                              <div className="text-xs text-destructive">No salary set — will be skipped</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">{formatAmount(salary)}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">{formatAmount(parseFloat(emp.calculatedBalance || "0"))}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t">
              <div className="text-sm">
                <span className="text-muted-foreground">Total deposit: </span>
                <span className="font-semibold font-mono">{formatAmount(bulkDepositTotal)}</span>
                <span className="text-muted-foreground ml-2">({validSelectedEmployees.length} employee{validSelectedEmployees.length !== 1 ? "s" : ""})</span>
              </div>
              <div className="flex gap-2">
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
                  {bulkDepositMutation.isPending ? "Processing..." : `Deposit ${validSelectedEmployees.length} Employee${validSelectedEmployees.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Withdrawal Dialog */}
      <Dialog open={bulkWithdrawalDialogOpen} onOpenChange={setBulkWithdrawalDialogOpen}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-bulk-withdrawal">
          <DialogHeader>
            <DialogTitle>Bulk Withdrawal</DialogTitle>
            <DialogDescription>
              Enter withdrawal amounts for each employee. Leave blank or zero to skip.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                        <TableCell className="text-right font-mono">{formatAmount(parseFloat(emp.calculatedBalance || "0"))}</TableCell>
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

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t">
              <div className="text-sm">
                <span className="text-muted-foreground">Total Withdrawal: </span>
                <span className="font-semibold font-mono">
                  {formatAmount(Object.values(bulkWithdrawalAmounts)
                    .reduce((sum, amt) => sum + (parseFloat(amt) || 0), 0))}
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
      <Dialog open={bulkBonusDialogOpen} onOpenChange={(open) => { if (!open) { setBulkBonusStep("edit"); } setBulkBonusDialogOpen(open); }}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-bulk-bonus">
          <DialogHeader>
            <DialogTitle>Bulk Bonus Deposit</DialogTitle>
            <DialogDescription>
              {bulkBonusStep === "edit"
                ? "Enter bonus amounts for each employee. Leave blank or zero to skip."
                : "Review the bonuses below before confirming."}
            </DialogDescription>
          </DialogHeader>

          {bulkBonusStep === "edit" ? (
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              {/* Auto-calculate from saved rates */}
              <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                <p className="text-sm font-medium">Auto-Calculate from Saved Rates</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant={bulkBonusAutoMonth === "thisMonth" ? "default" : "outline"}
                    onClick={() => setBulkBonusAutoMonth("thisMonth")}
                  >
                    This Month
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={bulkBonusAutoMonth === "custom" ? "default" : "outline"}
                    onClick={() => setBulkBonusAutoMonth("custom")}
                  >
                    Custom
                  </Button>
                  {bulkBonusAutoMonth === "custom" && (
                    <>
                      <Input type="date" className="h-8 w-36 text-sm" value={bulkBonusAutoStart} onChange={(e) => setBulkBonusAutoStart(e.target.value)} />
                      <Input type="date" className="h-8 w-36 text-sm" value={bulkBonusAutoEnd} onChange={(e) => setBulkBonusAutoEnd(e.target.value)} />
                    </>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    onClick={autoCalculateBonuses}
                    disabled={bulkBonusAutoLoading}
                    data-testid="button-auto-calculate-bonuses"
                  >
                    {bulkBonusAutoLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    Calculate All
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Sales % location:</span>
                  <Select value={bulkBonusAutoPctLocationId} onValueChange={setBulkBonusAutoPctLocationId}>
                    <SelectTrigger className="h-7 text-xs w-44">
                      <SelectValue placeholder="Select for % bonus" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bulkBonusAutoPctLocationId && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setBulkBonusAutoPctLocationId("")}>Clear</Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Per-unit bale rates use their configured locations. Sales % bonus uses the location selected above (leave blank to skip % calculation).</p>
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
                      {employeeStaff.map((emp) => {
                        const isPending = !!pendingBonuses[emp.id];
                        return (
                          <TableRow key={emp.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span>{emp.firstName} {emp.lastName}</span>
                                {isPending && (
                                  <Badge variant="secondary" className="text-xs">Calculated</Badge>
                                )}
                              </div>
                            </TableCell>
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
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t">
                <div className="text-sm">
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold font-mono">
                    {formatAmount(Object.values(bulkBonusAmounts).reduce((sum, amt) => sum + (parseFloat(amt) || 0), 0))}
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
                    onClick={() => setBulkBonusStep("preview")}
                    disabled={Object.values(bulkBonusAmounts).filter(amt => parseFloat(amt) > 0).length === 0}
                    data-testid="button-preview-bulk-bonus"
                  >
                    Preview
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
              <div className="border rounded-md flex-1 overflow-hidden">
                <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeStaff
                        .filter(emp => parseFloat(bulkBonusAmounts[emp.id] || "0") > 0)
                        .map(emp => {
                          const pending = pendingBonuses[emp.id];
                          return (
                            <TableRow key={emp.id}>
                              <TableCell className="font-medium">{emp.firstName} {emp.lastName}</TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                                {pending?.description || (bulkBonusNotes || "Bonus")}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">
                                {formatAmount(parseFloat(bulkBonusAmounts[emp.id] || "0"))}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t">
                <div className="text-sm">
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold font-mono">
                    {formatAmount(Object.values(bulkBonusAmounts).reduce((sum, amt) => sum + (parseFloat(amt) || 0), 0))}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    ({Object.values(bulkBonusAmounts).filter(amt => parseFloat(amt) > 0).length} employees)
                  </span>
                  {bulkBonusDate && (
                    <span className="text-muted-foreground ml-2">· {bulkBonusDate}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setBulkBonusStep("edit")}
                    data-testid="button-back-bulk-bonus"
                  >
                    Back
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handlePrintBulkBonus}
                    data-testid="button-print-bulk-bonus"
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </Button>
                  <Button
                    onClick={() => bulkBonusMutation.mutate()}
                    disabled={bulkBonusMutation.isPending}
                    data-testid="button-confirm-bulk-bonus"
                  >
                    {bulkBonusMutation.isPending ? "Processing..." : "Confirm & Deposit"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Employee Statement Dialog */}
      <Dialog open={!!statementEmployee} onOpenChange={(open) => !open && setStatementEmployee(null)}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {statementEmployee?.firstName} {statementEmployee?.lastName}
              {statementEmployee?.code && <span className="text-sm font-normal text-muted-foreground">({statementEmployee.code})</span>}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">Transaction history and account statement</p>
          </DialogHeader>

          {/* Summary Cards */}
          {!transactionsLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="font-mono font-semibold text-sm mt-1">
                  {formatAmount(parseFloat(statementEmployee?.calculatedBalance || "0"))}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {parseFloat(statementEmployee?.calculatedBalance || "0") >= 0 ? "Owed to employee" : "Advance taken"}
                </p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Total Deposited</p>
                <p className="font-mono font-semibold text-sm mt-1">
                  {formatAmount(employeeTransactions.filter((t: any) => !t.isDebit).reduce((s: number, t: any) => s + parseFloat(t.amount || "0"), 0))}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Credits</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Total Withdrawn</p>
                <p className="font-mono font-semibold text-sm mt-1">
                  {formatAmount(employeeTransactions.filter((t: any) => t.isDebit).reduce((s: number, t: any) => s + parseFloat(t.amount || "0"), 0))}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Debits</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Transactions</p>
                <p className="font-mono font-semibold text-sm mt-1">{employeeTransactions.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total entries</p>
              </div>
            </div>
          )}

          <div className="mt-2">
            {transactionsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : employeeTransactions.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No transactions found for this employee
              </div>
            ) : (() => {
              const sorted = [...employeeTransactions].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
              const totalDebit = sorted.reduce((s: number, t: any) => s + (t.isDebit ? parseFloat(t.amount || "0") : 0), 0);
              const totalCredit = sorted.reduce((s: number, t: any) => s + (!t.isDebit ? parseFloat(t.amount || "0") : 0), 0);
              const currentBalance = parseFloat(statementEmployee?.calculatedBalance || "0");
              const openingBalance = currentBalance - totalCredit + totalDebit;
              return (
                <div className="space-y-2">
                  {/* Toggle button */}
                  <button
                    type="button"
                    onClick={() => setStatementExpanded(prev => !prev)}
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover-elevate"
                    data-testid="button-toggle-statement"
                  >
                    <span className="text-muted-foreground">{sorted.length} transactions</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform text-muted-foreground", statementExpanded && "rotate-180")} />
                  </button>

                  {/* Collapsible transaction list */}
                  {statementExpanded && (
                    <div className="overflow-y-auto max-h-[50vh] space-y-0">
                      <div className="hidden md:block border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Debit</TableHead>
                              <TableHead className="text-right">Credit</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow className="bg-muted/20 font-medium">
                              <TableCell className="text-sm text-muted-foreground" colSpan={2}>Opening Balance</TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {openingBalance < 0 ? formatAmount(Math.abs(openingBalance)) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {openingBalance >= 0 ? formatAmount(openingBalance) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                            {sorted.map((txn: any) => (
                              <TableRow key={txn.id || `${txn.voucherId}-${txn.date}`}>
                                <TableCell className="font-mono text-sm whitespace-nowrap">
                                  {txn.date ? formatDisplayDate(txn.date) : "-"}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {cleanTxnDesc(txn.narration || txn.voucherDescription || txn.description || txn.voucherType || "-")}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {txn.isDebit ? formatAmount(parseFloat(txn.amount || "0")) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {!txn.isDebit ? formatAmount(parseFloat(txn.amount || "0")) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          <tfoot>
                            <TableRow className="border-t-2 font-semibold bg-muted/40">
                              <TableCell colSpan={2} className="text-sm">Total</TableCell>
                              <TableCell className="text-right font-mono text-sm">{formatAmount(totalDebit)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{formatAmount(totalCredit)}</TableCell>
                            </TableRow>
                            <TableRow className="font-semibold bg-muted/20">
                              <TableCell colSpan={3} className="text-sm text-muted-foreground">Current Balance</TableCell>
                              <TableCell className={`text-right font-mono text-sm ${currentBalance >= 0 ? "" : "text-destructive"}`}>
                                {formatAmount(Math.abs(currentBalance))}{currentBalance < 0 ? " (Dr)" : ""}
                              </TableCell>
                            </TableRow>
                          </tfoot>
                        </Table>
                      </div>
                      <div className="md:hidden space-y-0 border rounded-md overflow-hidden">
                        <div className="divide-y">
                          {sorted.map((txn: any) => (
                            <div key={txn.id || `${txn.voucherId}-${txn.date}`} className="flex items-start justify-between gap-3 px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-muted-foreground font-mono">{txn.date ? formatDisplayDate(txn.date) : "-"}</p>
                                <p className="text-sm truncate">{cleanTxnDesc(txn.narration || txn.voucherDescription || txn.description || txn.voucherType || "-")}</p>
                              </div>
                              <div className="text-right shrink-0">
                                {txn.isDebit ? (
                                  <p className="font-mono text-sm font-medium">{formatAmount(parseFloat(txn.amount || "0"))}</p>
                                ) : (
                                  <p className="font-mono text-sm font-medium text-green-600 dark:text-green-400">{formatAmount(parseFloat(txn.amount || "0"))}</p>
                                )}
                                <p className="text-xs text-muted-foreground">{txn.isDebit ? "Dr" : "Cr"}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="px-3 pt-2 pb-3 space-y-1 border-t-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Opening Balance</span>
                            <span className="font-mono font-semibold">{formatAmount(Math.abs(openingBalance))}{openingBalance < 0 ? " (Dr)" : ""}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Debit</span>
                            <span className="font-mono font-semibold">{formatAmount(totalDebit)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Total Credit</span>
                            <span className="font-mono font-semibold">{formatAmount(totalCredit)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-semibold">
                            <span>Current Balance</span>
                            <span className={`font-mono ${currentBalance >= 0 ? "" : "text-destructive"}`}>{formatAmount(Math.abs(currentBalance))}{currentBalance < 0 ? " (Dr)" : ""}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Employee Dialog */}
      <Dialog open={editEmployeeDialogOpen} onOpenChange={(open) => { setEditEmployeeDialogOpen(open); if (!open) setEditingEmployee(null); }}>
        <DialogContent data-testid="dialog-edit-employee">
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>
              Update employee details and monthly salary
            </DialogDescription>
          </DialogHeader>

          <Form {...editEmployeeForm}>
            <form noValidate onSubmit={editEmployeeForm.handleSubmit((data) => editEmployeeMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={editEmployeeForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editEmployeeForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={editEmployeeForm.control}
                  name="monthlySalary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monthly Salary</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-edit-monthly-salary" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editEmployeeForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee Code</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ""} data-testid="input-edit-code" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={editEmployeeForm.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Warehouse" {...field} value={field.value || ""} data-testid="input-edit-department" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editEmployeeForm.control}
                  name="joinDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Starting Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-edit-join-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={editEmployeeForm.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={(val) => field.onChange(val === "true")} value={field.value ? "true" : "false"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-active">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="true">Active</SelectItem>
                          <SelectItem value="false">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editEmployeeForm.control}
                  name="employeeGroupId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee Group</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-employee-group">
                            <SelectValue placeholder="No Group" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">No Group</SelectItem>
                          {employeeGroups.map((group: any) => (
                            <SelectItem key={group.id} value={group.id.toString()}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Bonus Configuration (Optional)</p>
                <FormField
                  control={editEmployeeForm.control}
                  name="salesBonusPct"
                  render={({ field }) => {
                    return (
                    <FormItem>
                      <FormLabel>Sales Bonus %</FormLabel>
                      <div className="flex gap-2 items-center flex-wrap">
                        <FormControl>
                          <Input
                            type="number"
                            step="0.0001"
                            placeholder="e.g. 0.2"
                            {...field}
                            value={field.value || ""}
                            className="w-28"
                            data-testid="input-edit-sales-bonus-pct"
                          />
                        </FormControl>
                        {otherCompanies.length > 0 && (
                          <FormField
                            control={editEmployeeForm.control}
                            name="salesBonusPctSourceCompanyId"
                            render={({ field: scField }) => (
                              <Select
                                value={scField.value || ""}
                                onValueChange={(v) => {
                                  scField.onChange(v === "__current__" ? "" : v);
                                  editEmployeeForm.setValue("salesBonusPctLocationId", "");
                                }}
                              >
                                <SelectTrigger className="w-32 text-xs" data-testid="select-edit-bonus-pct-source-company">
                                  <SelectValue placeholder={selectedCompany?.name || "This company"} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__current__">{selectedCompany?.name || "This company"}</SelectItem>
                                  {otherCompanies.map(c => (
                                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        )}
                        <FormField
                          control={editEmployeeForm.control}
                          name="salesBonusPctLocationId"
                          render={({ field: locField }) => (
                            <Select
                              value={locField.value || ""}
                              onValueChange={locField.onChange}
                            >
                              <SelectTrigger className="flex-1 min-w-[120px]" data-testid="select-edit-bonus-pct-location">
                                <SelectValue placeholder="Select location" />
                              </SelectTrigger>
                              <SelectContent>
                                {pctLocations.map(loc => (
                                  <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                      <FormMessage />
                    </FormItem>
                    );
                  }}
                />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Bale Bonus Rates by Location</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditBaleRates(prev => [...prev, { locationId: "", rate: "", sourceCompanyId: "" }])}
                      data-testid="button-add-bale-rate"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Add Location
                    </Button>
                  </div>
                  {editBaleRates.length === 0 && (
                    <p className="text-xs text-muted-foreground">No per-location rates configured. Add locations to enable auto-calculation.</p>
                  )}
                  {editBaleRates.map((row, idx) => {
                    const rowCompanyId = row.sourceCompanyId || "";
                    const locationsForRow = rowCompanyId
                      ? allCompanyLocations.filter(l => String(l.companyId) === rowCompanyId)
                      : locations;
                    return (
                    <div key={idx} className="flex gap-2 items-start flex-wrap">
                      {otherCompanies.length > 0 && (
                        <Select
                          value={rowCompanyId}
                          onValueChange={(v) => setEditBaleRates(prev => prev.map((r, i) => i === idx ? { ...r, sourceCompanyId: v === "__current__" ? "" : v, locationId: "" } : r))}
                        >
                          <SelectTrigger className="w-32 text-xs" data-testid={`select-bale-rate-company-${idx}`}>
                            <SelectValue placeholder={selectedCompany?.name || "This company"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__current__">{selectedCompany?.name || "This company"}</SelectItem>
                            {otherCompanies.map(c => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Select
                        value={row.locationId}
                        onValueChange={(v) => setEditBaleRates(prev => prev.map((r, i) => i === idx ? { ...r, locationId: v } : r))}
                      >
                        <SelectTrigger className="flex-1 min-w-[120px]" data-testid={`select-bale-rate-location-${idx}`}>
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          {locationsForRow.map(loc => (
                            <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Rate/unit"
                        className="w-28 text-right"
                        value={row.rate}
                        onChange={(e) => setEditBaleRates(prev => prev.map((r, i) => i === idx ? { ...r, rate: e.target.value } : r))}
                        data-testid={`input-bale-rate-${idx}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditBaleRates(prev => prev.filter((_, i) => i !== idx))}
                        data-testid={`button-remove-bale-rate-${idx}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Bales % by Location */}
              <div className="space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-1">
                  <Label className="text-sm">Bales % by Location</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setEditBalePctRates(prev => [...prev, { locationId: "", pct: "", sourceCompanyId: "" }])}
                    data-testid="button-add-bale-pct-rate"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Location
                  </Button>
                </div>
                {editBalePctRates.length === 0 && (
                  <p className="text-xs text-muted-foreground">No per-location % rates configured. Add locations to enable % auto-calculation.</p>
                )}
                {editBalePctRates.map((row, idx) => {
                  const rowCompanyId = row.sourceCompanyId || "";
                  const locationsForRow = rowCompanyId
                    ? allCompanyLocations.filter(l => String(l.companyId) === rowCompanyId)
                    : locations;
                  return (
                    <div key={idx} className="flex gap-2 items-start flex-wrap">
                      {otherCompanies.length > 0 && (
                        <Select
                          value={rowCompanyId}
                          onValueChange={(v) => setEditBalePctRates(prev => prev.map((r, i) => i === idx ? { ...r, sourceCompanyId: v === "__current__" ? "" : v, locationId: "" } : r))}
                        >
                          <SelectTrigger className="w-32 text-xs" data-testid={`select-bale-pct-rate-company-${idx}`}>
                            <SelectValue placeholder={selectedCompany?.name || "This company"} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__current__">{selectedCompany?.name || "This company"}</SelectItem>
                            {otherCompanies.map(c => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <Select
                        value={row.locationId}
                        onValueChange={(v) => setEditBalePctRates(prev => prev.map((r, i) => i === idx ? { ...r, locationId: v } : r))}
                      >
                        <SelectTrigger className="flex-1 min-w-[120px]" data-testid={`select-bale-pct-rate-location-${idx}`}>
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          {locationsForRow.map(loc => (
                            <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="% rate"
                        className="w-24 text-right"
                        value={row.pct}
                        onChange={(e) => setEditBalePctRates(prev => prev.map((r, i) => i === idx ? { ...r, pct: e.target.value } : r))}
                        data-testid={`input-bale-pct-rate-${idx}`}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditBalePctRates(prev => prev.filter((_, i) => i !== idx))}
                        data-testid={`button-remove-bale-pct-rate-${idx}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditEmployeeDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editEmployeeMutation.isPending} data-testid="button-save-employee">
                  {editEmployeeMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
