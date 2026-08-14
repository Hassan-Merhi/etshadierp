import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Employee } from "@shared/schema";
import type { useCompany } from "@/contexts/CompanyContext";
import type { AccountOption, EmployeeGroup, EmployeeTransaction, WorkerGroup } from "./payrollTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function usePayrollData({
  selectedCompany,
  companies,
  statementEmployee,
  workerOverrides,
  empSearch,
  empStatusFilter,
}: {
  selectedCompany: ReturnType<typeof useCompany>["selectedCompany"];
  companies: ReturnType<typeof useCompany>["companies"];
  statementEmployee: (Employee & { calculatedBalance?: string }) | null;
  workerOverrides: Record<number, { amount?: string; selected?: boolean; manuallyEdited?: boolean }>;
  empSearch: string;
  empStatusFilter: string;
}) {
  // Queries
  const { data: employees = [], isLoading: employeesLoading } = useQuery<
    Array<Employee & { calculatedBalance: string }>
  >({
    queryKey: ["/api/employees", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: bankAccounts = [], isLoading: bankAccountsLoading } = useQuery<AccountOption[]>({
    queryKey: ["/api/bank-accounts"],
    enabled: !!selectedCompany,
  });

  const { data: ledgerAccountsList = [] } = useQuery<AccountOption[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany?.id) return [];
      const res = await fetch(`/api/ledger-accounts?companyId=${selectedCompany.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch ledger accounts");
      return (await res.json()) as AccountOption[];
    },
    enabled: !!selectedCompany,
  });
  const cashAccounts = useMemo(
    () => ledgerAccountsList.filter((account) => account.accountType === "Cash"),
    [ledgerAccountsList]
  );

  const { data: employeeTransactions = [], isLoading: transactionsLoading } = useQuery<EmployeeTransaction[]>({
    queryKey: ["/api/accounts/employee", statementEmployee?.id],
    queryFn: async () => {
      if (!statementEmployee) return [];
      const res = await fetch(`/api/accounts/employee/${statementEmployee.id}/transactions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch employee transactions");
      const payload: unknown = await res.json();
      const raw = Array.isArray(payload)
        ? payload
        : isRecord(payload) && Array.isArray(payload.transactions)
          ? payload.transactions
          : [];
      return raw.filter(isRecord).map((txn) => {
        const dr = Number(txn.debitAmount ?? txn.debit ?? 0) || 0;
        const cr = Number(txn.creditAmount ?? txn.credit ?? 0) || 0;
        const isDebit = dr > 0;
        return {
          ...txn,
          amount: isDebit ? dr : cr,
          isDebit,
          date: String(txn.voucherDate ?? txn.date ?? ""),
        };
      });
    },
    enabled: !!statementEmployee,
  });

  const { data: employeeGroups = [] } = useQuery<EmployeeGroup[]>({
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
            const locs: unknown = await res.json();
            for (const loc of Array.isArray(locs) ? locs.filter(isRecord) : []) {
              if (typeof loc.id !== "number" || typeof loc.name !== "string") continue;
              results.push({ id: loc.id, name: loc.name, companyId: company.id, companyName: company.name });
            }
          }
        } catch {
          continue;
        }
      }
      return results;
    },
    enabled: otherCompanies.length > 0,
  });

  const { data: workerGroupsData = [] } = useQuery<WorkerGroup[]>({
    queryKey: ["/api/worker-groups/with-members", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: workerPaymentSummary = null } = useQuery<unknown>({
    queryKey: ["/api/payroll/worker-payments-summary", selectedCompany?.id],
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
    const groupedIds = new Set(workerGroupsData.flatMap((group) => group.members.map((member) => member.id)));
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

  return {
    employees,
    employeesLoading,
    bankAccounts,
    bankAccountsLoading,
    ledgerAccountsList,
    cashAccounts,
    employeeTransactions,
    transactionsLoading,
    employeeGroups,
    locations,
    otherCompanies,
    allCompanyLocations,
    workerGroupsData,
    workerPaymentSummary,
    employeeStaff,
    workerStaff,
    workerPayments,
    ungroupedWorkers,
    selectedPayments,
    totalAmount,
    selectedPaymentsSummary,
    filteredEmployeeStaff,
  };
}
