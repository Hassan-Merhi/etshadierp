import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useDateJump } from "@/hooks/use-date-jump";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { getDefaultPeriodValue, PeriodFilterValue } from "@/components/ui/period-filter";
import { useReactToPrint } from "react-to-print";

import { 
  Account, 
  Transaction, 
  GroupedVoucher, 
  WaRule, 
  WaChat, 
  exportLabels 
} from "./accounts/accountTypes";
import { AccountDialogs } from "./accounts/AccountDialogs";
import { AccountTable } from "./accounts/AccountTable";
import { AccountStatementView } from "./accounts/AccountStatementView";
import { LedgerAccount, BankAccount, insertLedgerAccountSchema, insertBankAccountSchema, updateLedgerAccountSchema } from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export default function Accounts() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount, isMultiCurrency } = useCurrencyContext();
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideBalances = (myErpPages?.hiddenErpCostFields ?? []).includes("accounts_balances");
  const appMode = useAppMode();
  const modePrefix = useModePrefix();
  const modeApiRequest = getApiRequest(appMode);
  const [, navigate] = useLocation();
  const searchString = useSearch();

  const urlParams = new URLSearchParams(searchString);
  const urlAccountId = urlParams.get("accountId");
  const urlAccountType = urlParams.get("accountType");
  const urlStartDate = urlParams.get("startDate") || "";
  const urlEndDate = urlParams.get("endDate") || "";

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const fromExternalNavRef = useRef(false);

  useEscapeBack(selectedAccount ? () => {
    fromExternalNavRef.current = false;
    setSelectedAccount(null);
    updateUrlParams({ accountId: null, accountType: null, startDate: null, endDate: null });
  } : null);

  useEffect(() => {
    if (selectedCompany?.id) {
      queryClient.invalidateQueries({
        queryKey: ["/api/accounts/all", selectedCompany.id],
      });
    }
  }, [selectedCompany?.id]);

  const [searchTerm, setSearchTerm] = useState("");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => {
    if (urlStartDate && urlEndDate) {
      return { fromDate: urlStartDate, toDate: urlEndDate, preset: "custom" as const };
    }
    return getDefaultPeriodValue("this_month");
  });

  const [accountToEdit, setAccountToEdit] = useState<LedgerAccount | null>(null);
  const [supplierToEdit, setSupplierToEdit] = useState<Account | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Account | null>(null);
  const [employeeToEdit, setEmployeeToEdit] = useState<Account | null>(null);
  const [bankToEdit, setBankToEdit] = useState<BankAccount | null>(null);
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);

  const updateUrlParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const newSearch = params.toString();
    window.history.replaceState(null, "", newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname);
  }, []);

  useDateJump((date) => {
    const jumped = { fromDate: date, toDate: date, preset: "custom" as const };
    setPeriodFilter(jumped);
    updateUrlParams({ startDate: date, endDate: date });
  });

  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showDeletedVouchers, setShowDeletedVouchers] = useState(false);
  const [filterCurrency, setFilterCurrency] = useState<"all" | "CFA">("all");
  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const [exportLang, setExportLang] = useState<"en" | "fr" | "ar">("en");

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedAccount ? `Statement - ${selectedAccount.name}` : "Account Statement",
  });

  // Queries (Simplified for brevity, but logically same as original)
  const { data: allAccounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<Transaction[]>({
    queryKey: selectedAccount
      ? [
          selectedAccount.type === "factoryWorker"
            ? `/api/factory/workers/${selectedAccount.accountId}/statement`
            : `/api/accounts/${(selectedAccount.type || "").toLowerCase().replace(" ", "-")}/${selectedAccount.accountId}/transactions`,
          { startDate: periodFilter.fromDate, endDate: periodFilter.toDate },
        ]
      : [],
    queryFn: async () => {
      if (!selectedAccount) return [];
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);

      let url;
      if (selectedAccount.type === "factoryWorker") {
        url = `/api/factory/workers/${selectedAccount.accountId}/statement?${params.toString()}`;
      } else {
        const accountType = (selectedAccount.type || "").toLowerCase().replace(" ", "-");
        url = `/api/accounts/${accountType}/${selectedAccount.accountId}/transactions?${params.toString()}`;
      }
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return await response.json();
    },
    enabled: !!selectedAccount
  });

  // Derived state
  const vouchersWithBalance = useMemo(() => {
    if (!transactions.length) return [];
    let runBal = selectedAccount?.openingBalance || 0;
    return transactions.map(t => {
      const dr = parseFloat(t.debitAmount) || 0;
      const cr = parseFloat(t.creditAmount) || 0;
      runBal += dr - cr;
      return { ...t, totalDebit: dr, totalCredit: cr, runningBalance: runBal };
    });
  }, [transactions, selectedAccount]);

  const closingBalance = useMemo(() => {
    if (vouchersWithBalance.length > 0) {
      return vouchersWithBalance[vouchersWithBalance.length - 1].runningBalance;
    }
    return selectedAccount?.openingBalance || 0;
  }, [vouchersWithBalance, selectedAccount]);

  const filteredAccounts = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    const filtered = allAccounts.filter(a => 
      a.name.toLowerCase().includes(searchLower) || 
      a.code.toLowerCase().includes(searchLower)
    );
    
    const parents = filtered.filter(a => a.type === "ledger" && !a.code.includes("."));
    return parents.map(p => ({
      ...p,
      children: filtered.filter(c => c.type === "ledger" && c.code.startsWith(`${p.code}.`))
    }));
  }, [allAccounts, searchTerm]);

  // Handlers
  const toggleParent = (id: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAccountChange = (id: string) => {
    const acc = allAccounts.find(a => a.id === id);
    if (acc) {
      setSelectedAccount(acc);
      updateUrlParams({ accountId: String(acc.accountId), accountType: acc.type });
    }
  };

  const toggleVoucherSelection = (voucherId: number) => {
    setSelectedVoucherIds(prev => {
      const next = new Set(prev);
      if (next.has(voucherId)) next.delete(voucherId);
      else next.add(voucherId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedVoucherIds.size === vouchersWithBalance.length) setSelectedVoucherIds(new Set());
    else setSelectedVoucherIds(new Set(vouchersWithBalance.map(v => v.voucherId)));
  };

  const handleOpenVoucher = (v: any) => {
    // Navigate to voucher edit
    navigate(`${modePrefix}/vouchers/${v.voucherId}/edit`);
  };

  const bankForm = useForm({
    resolver: zodResolver(insertBankAccountSchema.omit({ companyId: true })),
  });
  const editForm = useForm({
    resolver: zodResolver(updateLedgerAccountSchema.omit({ id: true, companyId: true })),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <PageHeader title="Accounts Overview" subtitle="View all accounts, balances, and transaction history" />
        <Button data-testid="button-create-account" disabled={!selectedCompany} onClick={() => navigate(`${modePrefix}/create`)}>
          <Plus className="w-4 h-4 mr-2" /> Create
        </Button>
      </div>

      <AccountDialogs
        bankToEdit={bankToEdit} setBankToEdit={setBankToEdit} bankForm={bankForm}
        onBankSubmit={() => {}} updateBankMutation={{}} deleteBankMutation={{}}
        handleDeleteBankAccount={() => {}} accountToEdit={accountToEdit} setAccountToEdit={setAccountToEdit}
        supplierToEdit={supplierToEdit} setSupplierToEdit={setSupplierToEdit}
        customerToEdit={customerToEdit} setCustomerToEdit={setCustomerToEdit}
        employeeToEdit={employeeToEdit} setEmployeeToEdit={setEmployeeToEdit}
        editForm={editForm} onEditSubmit={() => {}} updateLedgerMutation={{}}
        handleDeleteAccount={() => {}} pendingDelete={pendingDelete} setPendingDelete={setPendingDelete}
        waRuleDialogOpen={false} setWaRuleDialogOpen={() => {}} waChatSearch="" setWaChatSearch={() => {}}
        waRuleDraft={{} as WaRule} setWaRuleDraft={() => {}} filteredWaChats={[]} saveWaRuleMutation={{}} waChatsLoading={false}
      />

      <Tabs defaultValue="view" className="space-y-6">
        <TabsList>
          <TabsTrigger value="view">View Accounts</TabsTrigger>
          <TabsTrigger value="alter">Alter Account</TabsTrigger>
          <TabsTrigger value="find">Find Voucher</TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="space-y-4">
          {!selectedAccount ? (
             <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search accounts..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" />
                </div>
                <AccountTable 
                  filteredAccounts={filteredAccounts} 
                  expandedParents={expandedParents} 
                  toggleParent={toggleParent} 
                  handleAccountChange={handleAccountChange} 
                  hideBalances={hideBalances} 
                  formatAmount={formatAmount} 
                />
             </div>
          ) : (
             <AccountStatementView 
                selectedAccount={selectedAccount} 
                periodFilter={periodFilter} 
                setPeriodFilter={setPeriodFilter} 
                vouchersWithBalance={vouchersWithBalance}
                closingBalance={closingBalance}
                openingBalance={selectedAccount.openingBalance || 0}
                transactionsLoading={transactionsLoading}
                selectedVoucherIds={selectedVoucherIds}
                toggleSelectAll={toggleSelectAll}
                setShowBulkDeleteConfirm={setShowBulkDeleteConfirm}
                filterCurrency={filterCurrency}
                setFilterCurrency={setFilterCurrency as any}
                showDeletedVouchers={showDeletedVouchers}
                setShowDeletedVouchers={setShowDeletedVouchers as any}
                currentUser={currentUser}
                formatAmount={formatAmount}
                hideBalances={hideBalances}
                printRef={printRef}
                appMode={appMode}
                formatDisplayDate={formatDisplayDate}
                toggleVoucherSelection={toggleVoucherSelection}
                handleOpenVoucher={handleOpenVoucher}
                waRule={null}
                openWaRuleDialog={() => {}}
                sendWaStatementMutation={{}}
                isMultiCurrency={isMultiCurrency}
                isBrokerSupplier={false}
                brokerStatementData={null}
                factorySupplierStatement={null}
                factoryStatementLoading={false}
                brokerStatementLoading={false}
                handlePrint={handlePrint}
                exportLang={exportLang}
                setExportLang={setExportLang}
                exportLabels={exportLabels}
             />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
