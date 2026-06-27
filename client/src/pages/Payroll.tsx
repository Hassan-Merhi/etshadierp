import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import type { Employee } from "@shared/schema";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";

import ERPRunPayroll from "@/components/ERPRunPayroll";
import {
  depositSchema,
  withdrawalSchema,
  bulkPaymentSchema,
  getThisMonthRange,
  type DepositFormData,
  type WithdrawalFormData,
  type BulkPaymentFormData,
  type SalaryAdvance,
} from "./payroll/payrollSchemas";

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

import { EmployeesTab } from "./payroll/EmployeesTab";
import { WorkersTab } from "./payroll/WorkersTab";
import { WorkerProfilesTab } from "./payroll/WorkerProfilesTab";
import { GroupsTab } from "./payroll/GroupsTab";
import { AdvancesTab } from "./payroll/AdvancesTab";
import { WorkerDeductionDialog } from "./payroll/PayrollDialogs";

export default function Payroll() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { formatAmount } = useCurrencyContext();
  const { toast } = useToast();
  const { selectedCompany, companies } = useCompany();

  const [selectedTab, setSelectedTab] = useState("employees");

  // Shared state for dialogs
  const [empSearch, setEmpSearch] = useState("");
  const [empStatusFilter, setEmpStatusFilter] = useState("Active");
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false);
  const [bonusTab, setBonusTab] = useState<"sales" | "bales">("sales");
  const [bonusSalesPeriod, setBonusSalesPeriod] = useState<"thisMonth" | "custom">("thisMonth");
  const [bonusSalesLocationId, setBonusSalesLocationId] = useState<string>("");
  const [bonusSalesStart, setBonusSalesStart] = useState<string>("");
  const [bonusSalesEnd, setBonusSalesEnd] = useState<string>("");
  const [bonusSalesPreview, setBonusSalesPreview] = useState<{
    totalSalesAmount: string;
    totalQuantity: string;
    locationName: string;
  } | null>(null);
  const [bonusSalesLoading, setBonusSalesLoading] = useState(false);
  const [bonusSalesCustomPct, setBonusSalesCustomPct] = useState<string>("");
  const [bonusDate, setBonusDate] = useState<string>(new Date().toLocaleDateString("en-CA"));
  const [bonusNotes, setBonusNotes] = useState<string>("");
  const [balesRows, setBalesRows] = useState<
    Array<{
      locationId: string;
      sourceCompanyId: string;
      qty: string;
      rate: string;
      preview: string | null;
      loading: boolean;
    }>
  >([{ locationId: "", sourceCompanyId: "", qty: "", rate: "", preview: null, loading: false }]);
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
  const [workerOverrides, setWorkerOverrides] = useState<
    Record<number, { amount?: string; selected?: boolean; manuallyEdited?: boolean }>
  >({});
  const [createEmployeeDialogOpen, setCreateEmployeeDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<{
    employee: Employee;
    employeeBalance: number;
    ledgerBalance: number;
  } | null>(null);
  const [deleteWorkerConflict, setDeleteWorkerConflict] = useState<{
    employee: Employee;
    employeeBalance: number;
    ledgerBalance: number;
  } | null>(null);
  const [statementEmployee, setStatementEmployee] = useState<(Employee & { calculatedBalance?: string }) | null>(null);
  const [statementExpanded, setStatementExpanded] = useState(false);
  const [editEmployeeDialogOpen, setEditEmployeeDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [workerDeductionTarget, setWorkerDeductionTarget] = useState<Employee | null>(null);
  const [workerDeductionAmount, setWorkerDeductionAmount] = useState("");
  const [workerDeductionReason, setWorkerDeductionReason] = useState("");
  const [workerDeductionDate, setWorkerDeductionDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [bulkDepositSelections, setBulkDepositSelections] = useState<Record<number, boolean>>({});
  const [bulkDepositDialogOpen, setBulkDepositDialogOpen] = useState(false);
  const [bulkDepositDate, setBulkDepositDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [bulkDepositNotes, setBulkDepositNotes] = useState("");
  const [editBaleRates, setEditBaleRates] = useState<{ locationId: string; rate: string; sourceCompanyId: string }[]>(
    []
  );
  const [editBalePctRates, setEditBalePctRates] = useState<
    { locationId: string; pct: string; sourceCompanyId: string }[]
  >([]);
  const [bulkBonusAutoMonth, setBulkBonusAutoMonth] = useState<"thisMonth" | "custom">("thisMonth");
  const [bulkBonusAutoStart, setBulkBonusAutoStart] = useState(() => getThisMonthRange().start);
  const [bulkBonusAutoEnd, setBulkBonusAutoEnd] = useState(() => getThisMonthRange().end);
  const [bulkBonusAutoLoading, setBulkBonusAutoLoading] = useState(false);
  const [bulkBonusAutoPctLocationId, setBulkBonusAutoPctLocationId] = useState<string>("");
  const [bulkBonusDialogOpen, setBulkBonusDialogOpen] = useState(false);
  const [bulkBonusDate, setBulkBonusDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [bulkBonusNotes, setBulkBonusNotes] = useState("");
  const [bulkBonusAmounts, setBulkBonusAmounts] = useState<Record<number, string>>({});
  const [bulkBonusBreakdowns, setBulkBonusBreakdowns] = useState<Record<number, string[]>>({});
  const [bulkBonusStep, setBulkBonusStep] = useState<"edit" | "preview">("edit");
  const [pendingBonuses, setPendingBonuses] = useState<
    Record<number, { amount: number; description: string; employeeName: string }>
  >({});
  const [bulkWithdrawalDialogOpen, setBulkWithdrawalDialogOpen] = useState(false);
  const [bulkWithdrawalDate, setBulkWithdrawalDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [bulkWithdrawalNotes, setBulkWithdrawalNotes] = useState("");
  const [bulkWithdrawalAmounts, setBulkWithdrawalAmounts] = useState<Record<number, string>>({});
  const [bulkWithdrawalAccountType, setBulkWithdrawalAccountType] = useState<"bank" | "cash">("cash");
  const [bulkWithdrawalAccountId, setBulkWithdrawalAccountId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [createGroupDialogOpen, setCreateGroupDialogOpen] = useState(false);
  const [selectedGroupForMembers, setSelectedGroupForMembers] = useState<any | null>(null);
  const [groupMembersDialogOpen, setGroupMembersDialogOpen] = useState(false);

  // Worker tab state
  const [workerGroupsExpanded, setWorkerGroupsExpanded] = useState<Record<number, boolean>>({});
  const [createWorkerGroupDialogOpen, setCreateWorkerGroupDialogOpen] = useState(false);
  const [selectedWorkerGroupForMembers, setSelectedWorkerGroupForMembers] = useState<any | null>(null);
  const [workerGroupMembersDialogOpen, setWorkerGroupMembersDialogOpen] = useState(false);
  const [workerGroupMemberSelections, setWorkerGroupMemberSelections] = useState<Record<number, boolean>>({});

  // Queries
  const { data: employees = [], isLoading: employeesLoading } = useQuery<
    Array<Employee & { calculatedBalance: string }>
  >({
    queryKey: ["/api/employees", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: bankAccounts = [], isLoading: bankAccountsLoading } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!selectedCompany,
  });

  const { data: ledgerAccountsList = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return [];
      const res = await fetch(`/api/ledger-accounts?companyId=${selectedCompany.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch ledger accounts");
      return res.json();
    },
    enabled: !!selectedCompany,
  });
  const cashAccounts = useMemo(
    () => ledgerAccountsList.filter((a: any) => a.accountType === "Cash"),
    [ledgerAccountsList]
  );

  const { data: employeeTransactions = [], isLoading: transactionsLoading } = useQuery<any[]>({
    queryKey: ["/api/accounts/employee", statementEmployee?.id],
    queryFn: async () => {
      if (!statementEmployee) return [];
      const res = await fetch(`/api/accounts/employee/${statementEmployee.id}/transactions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch employee transactions");
      return res.json();
    },
    enabled: !!statementEmployee,
  });

  const { data: employeeGroups = [] } = useQuery<any[]>({
    queryKey: ["/api/employee-groups", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: locations = [] } = useQuery<Array<{ id: number; name: string; companyId: number }>>({
    queryKey: ["/api/locations", selectedCompany?.id],
    enabled: !!selectedCompany?.id,
  });

  const otherCompanies = companies.filter((c) => c.id !== selectedCompany?.id);
  const { data: allCompanyLocations = [] } = useQuery<
    Array<{ id: number; name: string; companyId: number; companyName: string }>
  >({
    queryKey: ["/api/all-company-locations", companies.map((c) => c.id).join(",")],
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

  const { data: workerPaymentSummary = null } = useQuery<any>({
    queryKey: ["/api/payroll/worker-payments-summary", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: workerGroupsData = [] } = useQuery<any[]>({
    queryKey: ["/api/worker-groups/with-members", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const employeeStaff = useMemo(() => employees.filter((e) => e.employeeType === "Employee"), [employees]);
  const workerStaff = useMemo(() => employees.filter((e) => e.employeeType === "Worker"), [employees]);

  // Derived worker payment state (merges monthlySalary defaults with manual overrides)
  const workerPayments = useMemo(() => {
    const map: Record<number, { selected: boolean; amount: string; manuallyEdited: boolean }> = {};
    workerStaff.forEach((w) => {
      const override = workerOverrides[w.id] || {};
      map[w.id] = {
        selected: override.selected ?? false,
        amount: override.amount ?? (w.monthlySalary || "0"),
        manuallyEdited: override.manuallyEdited ?? false,
      };
    });
    return map;
  }, [workerStaff, workerOverrides]);

  const ungroupedWorkers = useMemo(() => {
    const groupedIds = new Set(
      workerGroupsData.flatMap((g: any) => (g.members || []).map((m: any) => m.id))
    );
    return workerStaff.filter((w) => !groupedIds.has(w.id));
  }, [workerStaff, workerGroupsData]);

  const selectedPayments = useMemo(
    () => workerStaff.filter((w) => workerPayments[w.id]?.selected),
    [workerStaff, workerPayments]
  );

  const totalAmount = useMemo(
    () => selectedPayments.reduce((s, w) => s + parseFloat(workerPayments[w.id]?.amount || "0"), 0),
    [selectedPayments, workerPayments]
  );

  const filteredEmployeeStaff = useMemo(() => {
    return employeeStaff.filter((emp) => {
      const matchesSearch =
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(empSearch.toLowerCase()) ||
        (emp.code && emp.code.toLowerCase().includes(empSearch.toLowerCase()));
      const matchesStatus =
        empStatusFilter === "All" ? true : empStatusFilter === "Active" ? emp.active !== false : emp.active === false;
      return matchesSearch && matchesStatus;
    });
  }, [employeeStaff, empSearch, empStatusFilter]);

  // Forms
  const depositForm = useForm<DepositFormData>({ resolver: zodResolver(depositSchema) });
  const withdrawalForm = useForm<WithdrawalFormData>({ resolver: zodResolver(withdrawalSchema) });
  const bulkPaymentForm = useForm<BulkPaymentFormData>({ resolver: zodResolver(bulkPaymentSchema) });
  const advanceForm = useForm<any>();
  const deductionForm = useForm<any>();
  const newWorkerForm = useForm<any>();
  const editWorkerForm = useForm<any>();
  const createEmployeeForm = useForm<any>();
  const editEmployeeForm = useForm<any>();

  // Reset statementExpanded whenever a new employee statement is opened
  useEffect(() => {
    if (statementEmployee) setStatementExpanded(false);
  }, [statementEmployee?.id]);

  const cleanTxnDesc = (desc: string) => {
    if (!desc) return "-";
    return (
      desc
        .replace(/^(SAL-DEP|SAL-WD|SAL-BON)-[\w-]+\s*/i, "")
        .replace(/\s*-\s*(SAL-DEP|SAL-WD|SAL-BON)-[\w-]+$/i, "")
        .trim() || desc
    );
  };

  // Mutations (Logic simplified for orchestrator)
  const depositMutation = useMutation({
    mutationFn: async (data: DepositFormData) => {
      if (!selectedEmployee) throw new Error("No employee selected");
      return await modeApiRequest("POST", "/api/payroll/deposit-employee", {
        employeeId: selectedEmployee.id,
        amount: data.amount,
        date: data.date,
        notes: data.notes || "",
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Deposit recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/employee", selectedEmployee?.id] });
      setDepositDialogOpen(false);
      depositForm.reset();
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: async (data: WithdrawalFormData) => {
      if (!selectedEmployee) throw new Error("No employee selected");
      return await modeApiRequest("POST", "/api/payroll/withdraw-employee", {
        employeeId: selectedEmployee.id,
        amount: data.amount,
        paymentAccountType: data.paymentAccountType,
        paymentAccountId: data.paymentAccountId,
        date: data.date,
        notes: data.notes || "",
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Withdrawal recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/employee", selectedEmployee?.id] });
      setWithdrawalDialogOpen(false);
      withdrawalForm.reset();
    },
  });

  // Handlers
  const handleDeposit = (emp: Employee) => {
    setSelectedEmployee(emp);
    depositForm.reset({ amount: emp.monthlySalary || "", date: new Date().toLocaleDateString("en-CA"), notes: "" });
    setDepositDialogOpen(true);
  };

  const handleWithdrawal = (emp: Employee) => {
    setSelectedEmployee(emp);
    withdrawalForm.reset({
      amount: "",
      paymentAccountType: "cash",
      paymentAccountId: "",
      date: new Date().toLocaleDateString("en-CA"),
      notes: "",
    });
    setWithdrawalDialogOpen(true);
  };

  const handleDeleteEmployee = (emp: Employee) => {
    if (confirm(`Are you sure you want to delete ${emp.firstName}?`)) {
      // call mutation
    }
  };

  // Worker tab handlers
  const handleToggleWorker = (id: number) => {
    setWorkerOverrides((prev: any) => ({
      ...prev,
      [id]: { ...prev[id], selected: !prev[id]?.selected },
    }));
  };

  const handleUpdateAmount = (id: number, val: string) => {
    setWorkerOverrides((prev: any) => ({
      ...prev,
      [id]: { ...prev[id], amount: val, manuallyEdited: true },
    }));
  };

  const handleDeleteWorker = (worker: Employee) => {
    if (confirm(`Delete worker ${worker.firstName} ${worker.lastName}?`)) {
      modeApiRequest("DELETE", `/api/employees/${worker.id}`, undefined).then(() => {
        toast({ title: "Deleted", description: "Worker deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      }).catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
    }
  };

  const createWorkerMutation = useMutation({
    mutationFn: async (data: any) =>
      modeApiRequest("POST", "/api/employees", { ...data, companyId: selectedCompany?.id, employeeType: "Worker" }),
    onSuccess: () => {
      toast({ title: "Worker created" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setNewWorkerDialogOpen(false);
      newWorkerForm.reset();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateWorkerMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedWorkerForEdit) throw new Error("No worker selected");
      return modeApiRequest("PATCH", `/api/employees/${selectedWorkerForEdit.id}`, data);
    },
    onSuccess: () => {
      toast({ title: "Worker updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setEditWorkerDialogOpen(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleForceDeleteWorker = () => {
    if (!deleteWorkerConflict) return;
    modeApiRequest("DELETE", `/api/employees/${deleteWorkerConflict.employee.id}?force=true`, undefined)
      .then(() => {
        toast({ title: "Deleted", description: "Worker force-deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
        setDeleteWorkerConflict(null);
      })
      .catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  const deleteWorkerGroupMutation = useMutation({
    mutationFn: async (groupId: number) => modeApiRequest("DELETE", `/api/worker-groups/${groupId}`, undefined),
    onSuccess: () => {
      toast({ title: "Group deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
    },
  });

  const addWorkerToWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) =>
      modeApiRequest("POST", `/api/worker-groups/${groupId}/members`, { employeeId: workerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
    },
  });

  const workerDeductionMutation = useMutation({
    mutationFn: async () => {
      if (!workerDeductionTarget) throw new Error("No worker selected");
      return await modeApiRequest("POST", `/api/factory/workers/${workerDeductionTarget.id}/deductions`, {
        amount: workerDeductionAmount,
        reason: workerDeductionReason || null,
        deductionDate: workerDeductionDate,
      });
    },
    onSuccess: () => {
      toast({ title: "Deduction added", description: "Pending deduction saved." });
      setWorkerDeductionTarget(null);
      setWorkerDeductionAmount("");
      setWorkerDeductionReason("");
    },
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Payroll Management" />

      <div className="flex-1 overflow-y-auto p-4">
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="workers">Workers</TabsTrigger>
          <TabsTrigger value="advances">Advances + Deductions</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
          <TabsTrigger value="run-payroll">Run Payroll</TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <EmployeesTab
            empSearch={empSearch}
            setEmpSearch={setEmpSearch}
            empStatusFilter={empStatusFilter}
            setEmpStatusFilter={setEmpStatusFilter}
            setCreateEmployeeDialogOpen={setCreateEmployeeDialogOpen}
            employeeStaff={employeeStaff as any}
            filteredEmployeeStaff={filteredEmployeeStaff as any}
            pendingBonuses={pendingBonuses}
            setBulkDepositSelections={setBulkDepositSelections}
            setBulkDepositDialogOpen={setBulkDepositDialogOpen}
            setBulkBonusAmounts={setBulkBonusAmounts}
            setBulkBonusStep={setBulkBonusStep}
            setBulkBonusDialogOpen={setBulkBonusDialogOpen}
            setBulkWithdrawalAmounts={setBulkWithdrawalAmounts}
            setBulkWithdrawalAccountId={setBulkWithdrawalAccountId}
            setBulkWithdrawalDialogOpen={setBulkWithdrawalDialogOpen}
            setStatementEmployee={setStatementEmployee}
            handleDeposit={handleDeposit}
            handleBonus={() => {}} // simplified
            handleWithdrawal={handleWithdrawal}
            setEditingEmployee={setEditingEmployee}
            setEditEmployeeDialogOpen={setEditEmployeeDialogOpen}
            handleDeleteEmployee={handleDeleteEmployee}
          />
        </TabsContent>

        <TabsContent value="workers">
          <WorkersTab
            workerStaff={workerStaff}
            workerPaymentSummary={workerPaymentSummary}
            selectedPayments={selectedPayments}
            totalAmount={totalAmount}
            workerGroups={workerGroupsData}
            workerGroupsExpanded={workerGroupsExpanded}
            setWorkerGroupsExpanded={setWorkerGroupsExpanded}
            workerPayments={workerPayments}
            setWorkerOverrides={setWorkerOverrides}
            setBulkPaymentDialogOpen={setBulkPaymentDialogOpen}
            setNewWorkerDialogOpen={setNewWorkerDialogOpen}
            setWorkerDeductionTarget={setWorkerDeductionTarget}
            setSelectedWorkerForEdit={setSelectedWorkerForEdit}
            setEditWorkerDialogOpen={setEditWorkerDialogOpen}
            setCreateWorkerGroupDialogOpen={setCreateWorkerGroupDialogOpen}
            setSelectedWorkerGroupForMembers={setSelectedWorkerGroupForMembers}
            setWorkerGroupMembersDialogOpen={setWorkerGroupMembersDialogOpen}
            setWorkerGroupMemberSelections={setWorkerGroupMemberSelections}
            deleteWorkerGroupMutation={deleteWorkerGroupMutation}
            handleToggleWorker={handleToggleWorker}
            handleUpdateAmount={handleUpdateAmount}
            handleDeleteWorker={handleDeleteWorker as any}
            setStatementEmployee={setStatementEmployee}
            ungroupedWorkers={ungroupedWorkers}
            addWorkerToWorkerGroupMutation={addWorkerToWorkerGroupMutation}
          />
        </TabsContent>

        <TabsContent value="advances">
          <AdvancesTab />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsTab />
        </TabsContent>

        <TabsContent value="run-payroll">
          <ERPRunPayroll />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <DepositDialog
        open={depositDialogOpen}
        onOpenChange={setDepositDialogOpen}
        selectedEmployee={selectedEmployee}
        form={depositForm}
        mutation={depositMutation}
      />

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

      <EmployeeStatementDialog
        statementEmployee={statementEmployee}
        setStatementEmployee={setStatementEmployee}
        transactionsLoading={transactionsLoading}
        employeeTransactions={employeeTransactions}
        statementExpanded={statementExpanded}
        setStatementExpanded={setStatementExpanded as any}
        cleanTxnDesc={cleanTxnDesc}
      />

      <WorkerDeductionDialog
        target={workerDeductionTarget}
        onClose={() => setWorkerDeductionTarget(null)}
        amount={workerDeductionAmount}
        setAmount={setWorkerDeductionAmount}
        reason={workerDeductionReason}
        setReason={setWorkerDeductionReason}
        date={workerDeductionDate}
        setDate={setWorkerDeductionDate}
        mutation={workerDeductionMutation}
      />

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
      </div>
    </div>
  );
}
