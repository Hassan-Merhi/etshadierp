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
      const raw: any[] = await res.json();
      return raw.map((txn: any) => {
        const dr = parseFloat(txn.debitAmount ?? txn.debit ?? "0") || 0;
        const cr = parseFloat(txn.creditAmount ?? txn.credit ?? "0") || 0;
        const isDebit = dr > 0;
        return {
          ...txn,
          amount: isDebit ? dr : cr,
          isDebit,
          date: txn.voucherDate ?? txn.date ?? "",
        };
      });
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

  const selectedPaymentsSummary = useMemo(
    () => selectedPayments.map((w) => ({ workerId: w.id, amount: workerPayments[w.id]?.amount || "0" })),
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

  // Pre-populate edit worker form when a worker is selected for editing
  useEffect(() => {
    if (selectedWorkerForEdit) {
      editWorkerForm.reset({
        firstName: selectedWorkerForEdit.firstName ?? "",
        lastName: selectedWorkerForEdit.lastName ?? "",
        code: selectedWorkerForEdit.code ?? "",
        monthlySalary: selectedWorkerForEdit.monthlySalary ?? "",
        department: selectedWorkerForEdit.department ?? "",
        active: selectedWorkerForEdit.active ?? true,
      });
    }
  }, [selectedWorkerForEdit]);
  const createEmployeeForm = useForm<any>();
  const editEmployeeForm = useForm<any>();

  // Reset statementExpanded whenever a new employee statement is opened
  useEffect(() => {
    if (statementEmployee) setStatementExpanded(false);
  }, [statementEmployee?.id]);

  // Pre-populate edit employee form + load bale rates when editingEmployee changes
  useEffect(() => {
    if (!editingEmployee) return;
    editEmployeeForm.reset({
      firstName: editingEmployee.firstName || "",
      lastName: editingEmployee.lastName || "",
      code: editingEmployee.code || "",
      monthlySalary: editingEmployee.monthlySalary || "",
      employeeGroupId: editingEmployee.employeeGroupId ? String(editingEmployee.employeeGroupId) : "",
      salesBonusPct: editingEmployee.salesBonusPct ? String(editingEmployee.salesBonusPct) : "",
      salesBonusPctLocationId: editingEmployee.salesBonusPctLocationId
        ? String(editingEmployee.salesBonusPctLocationId)
        : "",
      salesBonusPctSourceCompanyId: editingEmployee.salesBonusPctSourceCompanyId
        ? String(editingEmployee.salesBonusPctSourceCompanyId)
        : "",
    });
    // Load bale rates
    fetch(`/api/employees/${editingEmployee.id}/bale-rates`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((data: any[]) =>
        setEditBaleRates(
          data.map((r: any) => ({
            locationId: String(r.locationId),
            rate: String(r.rate),
            sourceCompanyId: r.sourceCompanyId ? String(r.sourceCompanyId) : "",
          }))
        )
      )
      .catch(() => setEditBaleRates([]));
    // Load pct rates
    fetch(`/api/employees/${editingEmployee.id}/bale-pct-rates`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : [])
      .then((data: any[]) =>
        setEditBalePctRates(
          data.map((r: any) => ({
            locationId: String(r.locationId),
            pct: String(r.pct),
            sourceCompanyId: r.sourceCompanyId ? String(r.sourceCompanyId) : "",
          }))
        )
      )
      .catch(() => setEditBalePctRates([]));
  }, [editingEmployee?.id]);

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

  const handleBonus = (emp: Employee) => {
    setSelectedEmployee(emp);
    setBonusTab("sales");
    setBonusSalesPreview(null);
    setBonusSalesCustomPct(emp.salesBonusPct ? String(emp.salesBonusPct) : "");
    setBonusSalesLocationId(emp.salesBonusPctLocationId ? String(emp.salesBonusPctLocationId) : "");
    setBonusSalesPeriod("thisMonth");
    setBonusSalesStart("");
    setBonusSalesEnd("");
    setBalesRows([{
      locationId: "",
      sourceCompanyId: "",
      qty: "",
      rate: emp.balesBonusRate != null ? String(emp.balesBonusRate) : "",
      preview: null,
      loading: false,
    }]);
    setBalesPeriod("thisMonth");
    setBonusDate(new Date().toLocaleDateString("en-CA"));
    setBonusNotes("");
    setBonusDialogOpen(true);
  };

  const fetchSalesPreview = async () => {
    if (!bonusSalesLocationId) return;
    setBonusSalesLoading(true);
    setBonusSalesPreview(null);
    try {
      const { getThisMonthRange: tmr } = await import("./payroll/payrollSchemas");
      const range = bonusSalesPeriod === "thisMonth" ? tmr() : { start: bonusSalesStart, end: bonusSalesEnd };
      const otherLoc = allCompanyLocations.find((l: any) => l.id === parseInt(bonusSalesLocationId));
      const sourceParam = otherLoc ? `&sourceCompanyId=${otherLoc.companyId}` : "";
      const res = await fetch(
        `/api/payroll/sales-summary?locationId=${bonusSalesLocationId}&startDate=${range.start}&endDate=${range.end}${sourceParam}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBonusSalesPreview(data);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBonusSalesLoading(false);
    }
  };

  const fetchBalesQty = async (idx: number) => {
    const row = balesRows[idx];
    if (!row.locationId) return;
    setBalesRows((prev: any[]) => prev.map((r: any, i: number) => i === idx ? { ...r, loading: true } : r));
    try {
      const { getThisMonthRange: tmr } = await import("./payroll/payrollSchemas");
      const range = balesPeriod === "thisMonth" ? tmr() : { start: balesStart, end: balesEnd };
      const sourceParam = row.sourceCompanyId ? `&sourceCompanyId=${row.sourceCompanyId}` : "";
      const res = await fetch(
        `/api/payroll/sales-summary?locationId=${row.locationId}&startDate=${range.start}&endDate=${range.end}${sourceParam}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBalesRows((prev: any[]) => prev.map((r: any, i: number) =>
        i === idx ? { ...r, qty: data.totalQuantity, loading: false } : r
      ));
    } catch (e: any) {
      setBalesRows((prev: any[]) => prev.map((r: any, i: number) => i === idx ? { ...r, loading: false } : r));
      toast({ title: "Error fetching qty", description: e.message, variant: "destructive" });
    }
  };

  const getBonusAmount = (): number => {
    if (bonusTab === "sales") {
      if (!bonusSalesPreview) return 0;
      return (parseFloat(bonusSalesPreview.totalSalesAmount || "0") * parseFloat(bonusSalesCustomPct || "0")) / 100;
    } else {
      return balesRows.reduce((s: number, r: any) => s + parseFloat(r.qty || "0") * parseFloat(r.rate || "0"), 0);
    }
  };

  const saveBonusToPending = () => {
    if (!selectedEmployee) return;
    const amount = getBonusAmount();
    if (amount <= 0) return;
    const descParts: string[] = [];
    if (bonusTab === "sales" && bonusSalesPreview) {
      descParts.push(`Sales bonus ${bonusSalesCustomPct}% on ${bonusSalesPreview.locationName}`);
    } else {
      balesRows.filter((r: any) => parseFloat(r.qty || "0") > 0 && parseFloat(r.rate || "0") > 0).forEach((r: any) => {
        const loc = locations.find((l: any) => l.id === parseInt(r.locationId)) ?? allCompanyLocations.find((l: any) => l.id === parseInt(r.locationId));
        descParts.push(`${parseFloat(r.qty)} bales @ ${r.rate} (${loc?.name ?? r.locationId})`);
      });
    }
    setPendingBonuses((prev: any) => ({
      ...prev,
      [selectedEmployee.id]: {
        amount,
        description: descParts.join(", ") || "Bonus",
        employeeName: `${selectedEmployee.firstName} ${selectedEmployee.lastName}`,
      },
    }));
    setBonusDialogOpen(false);
    toast({ title: "Saved to bulk", description: `Bonus of ${amount.toFixed(2)} saved for ${selectedEmployee.firstName}` });
  };

  const bonusMutation = useMutation({
    mutationFn: async ({ employeeId, amount }: { employeeId: number; amount: number }) => {
      return await modeApiRequest("POST", "/api/payroll/bonus-employee", {
        employeeId,
        amount: amount.toFixed(2),
        date: bonusDate,
        notes: bonusNotes || "",
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Bonus recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      if (selectedEmployee) queryClient.invalidateQueries({ queryKey: ["/api/accounts/employee", selectedEmployee.id] });
      setBonusDialogOpen(false);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const submitSmartBonus = () => {
    if (!selectedEmployee) return;
    const amount = getBonusAmount();
    if (amount <= 0) return;
    bonusMutation.mutate({ employeeId: selectedEmployee.id, amount });
  };

  // ── Bulk deposit helpers ─────────────────────────────────────────────────
  const handleSelectAllEmployees = (checked: any) => {
    if (checked) {
      const all: Record<number, boolean> = {};
      employeeStaff.forEach((e) => { all[e.id] = true; });
      setBulkDepositSelections(all);
    } else {
      setBulkDepositSelections({});
    }
  };

  const handleToggleEmployeeDeposit = (id: number) => {
    setBulkDepositSelections((prev: Record<number, boolean>) => ({ ...prev, [id]: !prev[id] }));
  };

  const validSelectedEmployees = useMemo(
    () => employeeStaff.filter((e) => bulkDepositSelections[e.id] && parseFloat(e.monthlySalary || "0") > 0),
    [employeeStaff, bulkDepositSelections]
  );

  const bulkDepositTotal = useMemo(
    () => validSelectedEmployees.reduce((s, e) => s + parseFloat(e.monthlySalary || "0"), 0),
    [validSelectedEmployees]
  );

  const bulkDepositMutation = useMutation({
    mutationFn: async () => {
      const deposits = validSelectedEmployees.map((e) => ({ employeeId: e.id, amount: e.monthlySalary }));
      return modeApiRequest("POST", "/api/payroll/bulk-deposit-employees", {
        deposits,
        date: bulkDepositDate,
        notes: bulkDepositNotes || "",
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: `Deposited salary for ${validSelectedEmployees.length} employees` });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setBulkDepositDialogOpen(false);
      setBulkDepositSelections({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkWithdrawalMutation = useMutation({
    mutationFn: async () => {
      const withdrawals = Object.entries(bulkWithdrawalAmounts)
        .filter(([, amt]) => parseFloat(amt) > 0)
        .map(([empId, amount]) => ({ employeeId: parseInt(empId), amount }));
      return modeApiRequest("POST", "/api/payroll/bulk-withdraw-employees", {
        withdrawals,
        date: bulkWithdrawalDate,
        notes: bulkWithdrawalNotes || "",
        paymentAccountType: bulkWithdrawalAccountType,
        paymentAccountId: bulkWithdrawalAccountId,
      });
    },
    onSuccess: () => {
      const count = Object.values(bulkWithdrawalAmounts).filter((amt) => parseFloat(amt) > 0).length;
      toast({ title: "Success", description: `Processed withdrawals for ${count} employees` });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setBulkWithdrawalDialogOpen(false);
      setBulkWithdrawalAmounts({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkBonusMutation = useMutation({
    mutationFn: async () => {
      const bonuses = Object.entries(bulkBonusAmounts)
        .filter(([, amt]) => parseFloat(amt) > 0)
        .map(([empId, amount]) => ({ employeeId: parseInt(empId), amount }));
      return modeApiRequest("POST", "/api/payroll/bulk-bonus-employees", {
        bonuses,
        date: bulkBonusDate,
        notes: bulkBonusNotes || "",
      });
    },
    onSuccess: () => {
      const count = Object.values(bulkBonusAmounts).filter((amt) => parseFloat(amt) > 0).length;
      toast({ title: "Success", description: `Bonus deposited for ${count} employees` });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setBulkBonusDialogOpen(false);
      setBulkBonusAmounts({});
      setBulkBonusBreakdowns({});
      setPendingBonuses({});
      setBulkBonusStep("edit");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const bulkPaymentMutation = useMutation({
    mutationFn: async (data: BulkPaymentFormData) => {
      const payments = selectedPayments.map((w) => ({
        workerId: w.id,
        amount: workerPayments[w.id]?.amount || "0",
      }));
      return modeApiRequest("POST", "/api/payroll/bulk-pay-workers", {
        payments,
        paymentAccountType: data.paymentAccountType,
        paymentAccountId: data.paymentAccountId,
        date: data.date,
        notes: data.notes || "",
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: `Paid ${selectedPayments.length} workers` });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setBulkPaymentDialogOpen(false);
      bulkPaymentForm.reset();
      setWorkerOverrides({});
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const autoCalculateBonuses = async () => {
    setBulkBonusAutoLoading(true);
    try {
      const { getThisMonthRange: tmr } = await import("./payroll/payrollSchemas");
      const range = bulkBonusAutoMonth === "thisMonth" ? tmr() : { start: bulkBonusAutoStart, end: bulkBonusAutoEnd };

      const res = await modeApiRequest("POST", "/api/payroll/auto-calculate-bonuses", {
        startDate: range.start,
        endDate: range.end,
        pctLocationId: bulkBonusAutoPctLocationId || null,
      });
      const { results } = await res.json() as { results: Array<{ employeeId: number; amount: string; breakdown: string[] }> };

      const amounts: Record<number, string> = { ...bulkBonusAmounts };
      const breakdowns: Record<number, string[]> = { ...bulkBonusBreakdowns };

      for (const r of results) {
        if (parseFloat(r.amount) > 0) {
          amounts[r.employeeId] = r.amount;
          breakdowns[r.employeeId] = r.breakdown;
        }
      }

      setBulkBonusAmounts(amounts as any);
      setBulkBonusBreakdowns(breakdowns);
      const calculatedCount = results.filter((r) => parseFloat(r.amount) > 0).length;
      if (calculatedCount === 0) {
        toast({
          title: "Nothing calculated",
          description: "No bale sales found for the configured locations in this date range. Check that sales vouchers exist for June.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Done", description: `Bonuses calculated for ${calculatedCount} employee${calculatedCount !== 1 ? "s" : ""}` });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setBulkBonusAutoLoading(false);
    }
  };

  const handlePrintBulkBonus = () => {
    const rows = employeeStaff
      .filter((emp) => parseFloat(bulkBonusAmounts[emp.id] || "0") > 0)
      .map((emp) => {
        const pending = pendingBonuses[emp.id];
        const amount = parseFloat(bulkBonusAmounts[emp.id] || "0");
        return `${emp.firstName} ${emp.lastName}: $${amount.toFixed(2)}${pending?.description ? ` — ${pending.description}` : ""}`;
      });
    const total = employeeStaff.reduce((s, e) => s + parseFloat(bulkBonusAmounts[e.id] || "0"), 0);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Bulk Bonus — ${bulkBonusDate}</title>
      <style>body{font-family:sans-serif;padding:24px}h2{margin-bottom:8px}ul{list-style:none;padding:0}li{padding:6px 0;border-bottom:1px solid #eee}.total{font-weight:bold;margin-top:12px}</style>
      </head><body>
      <h2>Bulk Bonus Deposit</h2>
      <p>Date: ${bulkBonusDate}${bulkBonusNotes ? ` &nbsp;·&nbsp; ${bulkBonusNotes}` : ""}</p>
      <ul>${rows.map((r) => `<li>${r}</li>`).join("")}</ul>
      <p class="total">Total: $${total.toFixed(2)}</p>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  const handleDeleteEmployee = (emp: Employee) => {
    if (confirm(`Are you sure you want to delete ${emp.firstName}?`)) {
      modeApiRequest("DELETE", `/api/employees/${emp.id}`, undefined)
        .then(() => {
          toast({ title: "Deleted", description: "Employee deleted" });
          queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
        })
        .catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
    }
  };

  const handleForceDeleteEmployee = () => {
    if (!deleteConflict) return;
    modeApiRequest("DELETE", `/api/employees/${deleteConflict.employee.id}?force=true`, undefined)
      .then(() => {
        toast({ title: "Deleted", description: "Employee force-deleted" });
        queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
        setDeleteConflict(null);
      })
      .catch((e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  const editEmployeeMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!editingEmployee) throw new Error("No employee selected");
      await modeApiRequest("PATCH", `/api/employees/${editingEmployee.id}`, data);
      // Save bale rates
      await fetch(`/api/employees/${editingEmployee.id}/bale-rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          editBaleRates
            .filter((r) => r.locationId && r.rate)
            .map((r) => ({
              locationId: parseInt(r.locationId),
              rate: parseFloat(r.rate),
              sourceCompanyId: r.sourceCompanyId ? parseInt(r.sourceCompanyId) : null,
            }))
        ),
      });
      // Save pct rates
      await fetch(`/api/employees/${editingEmployee.id}/bale-pct-rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(
          editBalePctRates
            .filter((r) => r.locationId && r.pct)
            .map((r) => ({
              locationId: parseInt(r.locationId),
              pct: parseFloat(r.pct),
              sourceCompanyId: r.sourceCompanyId ? parseInt(r.sourceCompanyId) : null,
            }))
        ),
      });
    },
    onSuccess: () => {
      toast({ title: "Employee updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setEditEmployeeDialogOpen(false);
      setEditingEmployee(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createEmployeeMutation = useMutation({
    mutationFn: async (data: any) =>
      modeApiRequest("POST", "/api/employees", {
        ...data,
        companyId: selectedCompany?.id,
        employeeType: "Employee",
      }),
    onSuccess: () => {
      toast({ title: "Employee created" });
      queryClient.invalidateQueries({ queryKey: ["/api/employees", selectedCompany?.id] });
      setCreateEmployeeDialogOpen(false);
      createEmployeeForm.reset();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createGroupMutation = useMutation({
    mutationFn: async () =>
      modeApiRequest("POST", "/api/employee-groups", {
        name: newGroupName,
        description: newGroupDescription,
        companyId: selectedCompany?.id,
      }),
    onSuccess: () => {
      toast({ title: "Group created" });
      queryClient.invalidateQueries({ queryKey: ["/api/employee-groups", selectedCompany?.id] });
      setCreateGroupDialogOpen(false);
      setNewGroupName("");
      setNewGroupDescription("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: groupMembers = [] } = useQuery<any[]>({
    queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"],
    queryFn: async () => {
      if (!selectedGroupForMembers) return [];
      const res = await fetch(`/api/employee-groups/${selectedGroupForMembers.id}/members`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedGroupForMembers,
  });

  const addWorkerToGroupMutation = useMutation({
    mutationFn: async ({ groupId, employeeId }: { groupId: number; employeeId: number }) =>
      modeApiRequest("POST", `/api/employee-groups/${groupId}/members/${employeeId}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"],
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeWorkerFromGroupMutation = useMutation({
    mutationFn: async ({ groupId, employeeId }: { groupId: number; employeeId: number }) =>
      modeApiRequest("DELETE", `/api/employee-groups/${groupId}/members/${employeeId}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/employee-groups", selectedGroupForMembers?.id, "members"],
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
      modeApiRequest("POST", "/api/employees", {
        ...data,
        companyId: selectedCompany?.id,
        employeeType: "Worker",
        joinDate: data.joinDate || new Date().toLocaleDateString("en-CA"),
      }),
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
      modeApiRequest("POST", `/api/worker-groups/${groupId}/members/${workerId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-groups/with-members", selectedCompany?.id] });
    },
  });

  const removeWorkerFromWorkerGroupMutation = useMutation({
    mutationFn: async ({ groupId, workerId }: { groupId: number; workerId: number }) =>
      modeApiRequest("DELETE", `/api/worker-groups/${groupId}/members/${workerId}`),
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
            handleBonus={handleBonus}
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
          <AdvancesTab cashAccounts={cashAccounts} />
        </TabsContent>

        <TabsContent value="groups">
          <GroupsTab />
        </TabsContent>

        <TabsContent value="run-payroll">
          <ERPRunPayroll />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <BulkDialogs
        bulkDepositDialogOpen={bulkDepositDialogOpen}
        setBulkDepositDialogOpen={setBulkDepositDialogOpen}
        bulkDepositDate={bulkDepositDate}
        setBulkDepositDate={setBulkDepositDate}
        bulkDepositNotes={bulkDepositNotes}
        setBulkDepositNotes={setBulkDepositNotes}
        employeeStaff={employeeStaff as any}
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
        setBulkWithdrawalAmounts={setBulkWithdrawalAmounts as any}
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
        setBulkBonusAmounts={setBulkBonusAmounts as any}
        pendingBonuses={pendingBonuses}
        bulkBonusBreakdowns={bulkBonusBreakdowns}
        bulkBonusMutation={bulkBonusMutation}
        handlePrintBulkBonus={handlePrintBulkBonus}
        locations={locations}
      />

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

      <BulkPaymentDialog
        open={bulkPaymentDialogOpen}
        onOpenChange={setBulkPaymentDialogOpen}
        selectedPayments={selectedPaymentsSummary}
        totalAmount={totalAmount}
        workerStaff={workerStaff}
        form={bulkPaymentForm}
        mutation={bulkPaymentMutation}
        cashAccounts={cashAccounts}
        bankAccounts={bankAccounts}
        bankAccountsLoading={bankAccountsLoading}
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
        workerGroupMembersDialogOpen={workerGroupMembersDialogOpen}
        setWorkerGroupMembersDialogOpen={setWorkerGroupMembersDialogOpen}
        selectedWorkerGroupForMembers={selectedWorkerGroupForMembers}
        allWorkerGroups={workerGroupsData}
        allWorkers={workerStaff}
        addWorkerToWorkerGroupMutation={addWorkerToWorkerGroupMutation}
        removeWorkerFromWorkerGroupMutation={removeWorkerFromWorkerGroupMutation}
      />

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
        pctLocations={allCompanyLocations}
      />

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
        employeeStaff={employeeStaff as any}
        groupMembers={groupMembers}
        addWorkerToGroupMutation={addWorkerToGroupMutation}
        removeWorkerFromGroupMutation={removeWorkerFromGroupMutation}
      />
      </div>
    </div>
  );
}
