import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Search,
  Edit,
  FileText,
  ChevronsUpDown,
  Check,
  X,
  ArrowRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

import { Account, Transaction, GroupedVoucher, WaRule, WaChat, exportLabels } from "./accounts/accountTypes";
import { AccountDialogs } from "./accounts/AccountDialogs";
import { AccountTable } from "./accounts/AccountTable";
import { AccountStatementView } from "./accounts/AccountStatementView";
import {
  LedgerAccount,
  BankAccount,
  insertLedgerAccountSchema,
  insertBankAccountSchema,
  updateLedgerAccountSchema,
} from "@shared/schema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { apiRequest } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";

export default function Accounts() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount, formatAmountRaw, isMultiCurrency } = useCurrencyContext();

  const RATE_CONVERTED_ACCOUNT_TYPES = new Set(["bank"]);

  function formatAmountForAccount(amount: number, accountType?: string): string {
    return RATE_CONVERTED_ACCOUNT_TYPES.has(accountType || "") ? formatAmount(amount) : formatAmountRaw(amount);
  }
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

  useEscapeBack(
    selectedAccount
      ? () => {
          fromExternalNavRef.current = false;
          setSelectedAccount(null);
          updateUrlParams({ accountId: null, accountType: null, startDate: null, endDate: null });
        }
      : null
  );

  // Query key includes selectedCompany?.id so React Query refetches automatically on company switch — no manual useEffect needed.

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
  const [alterSearchTerm, setAlterSearchTerm] = useState("");
  const [alterSelectedAccount, setAlterSelectedAccount] = useState<Account | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const debouncedFindQuery = useDebounce(findQuery, 350);

  const updateUrlParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const newSearch = params.toString();
    window.history.replaceState(
      null,
      "",
      newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname
    );
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
  const [parentGroupOpen, setParentGroupOpen] = useState(false);

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => apiRequest("POST", "/api/vouchers/bulk-delete", { voucherIds: ids }),
    onSuccess: (_, ids) => {
      toast({ title: `Deleted ${ids.length} voucher(s)` });
      setSelectedVoucherIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/vouchers"] });
      if (selectedAccount) {
        const accountType = (selectedAccount.type || "").toLowerCase().replace(" ", "-");
        queryClient.invalidateQueries({
          queryKey: [`/api/accounts/${accountType}/${selectedAccount.accountId}/transactions`],
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });
  const { data: voucherSearchResults = [], isFetching: voucherSearchLoading } = useQuery<any[]>({
    queryKey: ["/api/vouchers/search", debouncedFindQuery],
    queryFn: async () => {
      if (!debouncedFindQuery.trim()) return [];
      const res = await fetch(`/api/vouchers/search?q=${encodeURIComponent(debouncedFindQuery)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: debouncedFindQuery.trim().length > 0,
  });

  const updateLedgerMutation = useMutation({
    mutationFn: async (data: {
      id: number;
      name?: string;
      accountType?: string;
      subType?: string | null;
      openingBalance?: string;
      openingBalanceSide?: string;
      active?: boolean;
      parentId?: number | null | undefined;
    }) => {
      const { id, ...rest } = data;
      return apiRequest("PUT", `/api/ledger-accounts/${id}`, rest);
    },
    onSuccess: () => {
      toast({ title: "Account updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const [filterCurrency, setFilterCurrency] = useState<"all" | "CFA">("all");
  const { data: currentUser } = useQuery<{ role?: string }>({ queryKey: ["/api/auth/me"] });
  const [exportLang, setExportLang] = useState<"en" | "fr" | "ar">("en");

  // ─── WhatsApp rule state ─────────────────────────────────────────────────
  const defaultWaRule: WaRule = { enabled: false, whatsappChatId: "", sendOnPayment: true, sendOnReceipt: true, sendOnJournal: true };
  const [waRuleDialogOpen, setWaRuleDialogOpen] = useState(false);
  const [waRuleDraft, setWaRuleDraft] = useState<WaRule>(defaultWaRule);
  const [waChatSearch, setWaChatSearch] = useState("");

  const selectedAccountIsLedger = selectedAccount?.type === "ledger";
  const selectedAccountId = selectedAccount?.accountId ?? null;

  const { data: waChatsRaw = [], isLoading: waChatsLoading } = useQuery<WaChat[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/chats/pos", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
    enabled: waRuleDialogOpen,
  });

  const { data: waRule = null } = useQuery<WaRule | null>({
    queryKey: ["/api/factory/accounts", selectedAccountId, "whatsapp-rule"],
    queryFn: async () => {
      const res = await fetch(`/api/factory/accounts/${selectedAccountId}/whatsapp-rule`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: selectedAccountIsLedger && !!selectedAccountId,
    staleTime: 30_000,
  });

  const filteredWaChats = useMemo(() => {
    if (!waChatSearch.trim()) return waChatsRaw;
    const s = waChatSearch.toLowerCase();
    return waChatsRaw.filter((c) => c.name.toLowerCase().includes(s));
  }, [waChatsRaw, waChatSearch]);

  const openWaRuleDialog = () => {
    setWaRuleDraft(waRule ?? defaultWaRule);
    setWaChatSearch("");
    setWaRuleDialogOpen(true);
  };

  const saveWaRuleMutation = useMutation({
    mutationFn: async (rule: WaRule) => {
      const res = await apiRequest("PUT", `/api/factory/accounts/${selectedAccountId}/whatsapp-rule`, rule);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "WhatsApp rule saved" });
      setWaRuleDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/factory/accounts", selectedAccountId, "whatsapp-rule"] });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const sendWaStatementMutation = useMutation({
    mutationFn: async ({ accountId, month }: { accountId: number; month: string }) => {
      const res = await apiRequest("POST", `/api/factory/accounts/${accountId}/send-statement-whatsapp`, { month });
      if (!res.ok) throw new Error((await res.json()).message || "Send failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Statement sent to WhatsApp" }); },
    onError: (err: any) => { toast({ title: "WhatsApp send failed", description: err?.message, variant: "destructive" }); },
  });

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

  // Dedicated query for Group accounts used by the Parent Group combobox.
  // Uses /api/ledger-accounts directly (same source as Account Groups page) so
  // groups created there always appear here without needing /api/accounts/all to refresh.
  // Groups = accounts marked with subType "Group" OR accounts that happen to have children
  // (backward-compat: groups created before subType tagging still show up)
  const { data: groupOptions = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger-accounts", selectedCompany?.id],
    queryFn: async () => {
      const url = selectedCompany?.id ? `/api/ledger-accounts?companyId=${selectedCompany.id}` : "/api/ledger-accounts";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch ledger accounts");
      return res.json();
    },
    select: (data: any[]) => {
      const parentIdSet = new Set<number>();
      data.forEach((a) => {
        if (a.parentId) parentIdSet.add(a.parentId);
      });
      return data.filter((a) => a.subType === "Group" || parentIdSet.has(a.id));
    },
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
    enabled: !!selectedAccount,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // Derived state
  const vouchersWithBalance = useMemo(() => {
    if (!transactions.length) return [];
    let runBal = selectedAccount?.openingBalance || 0;
    return transactions.map((t) => {
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
    return allAccounts.filter(
      (a) => a.name.toLowerCase().includes(searchLower) || a.code.toLowerCase().includes(searchLower)
    );
  }, [allAccounts, searchTerm]);

  // Handlers
  const toggleParent = (id: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAccountChange = (id: string) => {
    const acc = allAccounts.find((a) => a.id === id);
    if (acc) {
      setSelectedAccount(acc);
      updateUrlParams({ accountId: String(acc.accountId), accountType: acc.type });
    }
  };

  const toggleVoucherSelection = (voucherId: number) => {
    setSelectedVoucherIds((prev) => {
      const next = new Set(prev);
      if (next.has(voucherId)) next.delete(voucherId);
      else next.add(voucherId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedVoucherIds.size === vouchersWithBalance.length) setSelectedVoucherIds(new Set());
    else setSelectedVoucherIds(new Set(vouchersWithBalance.map((v) => v.voucherId)));
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
  const alterAccountType = editForm.watch("accountType") as string | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <PageHeader title="Accounts Overview" subtitle="View all accounts, balances, and transaction history" />
        <Button
          data-testid="button-create-account"
          disabled={!selectedCompany}
          onClick={() => navigate(`${modePrefix}/create`)}
        >
          <Plus className="w-4 h-4 mr-2" /> Create
        </Button>
      </div>

      <AccountDialogs
        bankToEdit={bankToEdit}
        setBankToEdit={setBankToEdit}
        bankForm={bankForm}
        onBankSubmit={() => {}}
        updateBankMutation={{}}
        deleteBankMutation={{}}
        handleDeleteBankAccount={() => {}}
        accountToEdit={accountToEdit}
        setAccountToEdit={setAccountToEdit}
        supplierToEdit={supplierToEdit}
        setSupplierToEdit={setSupplierToEdit}
        customerToEdit={customerToEdit}
        setCustomerToEdit={setCustomerToEdit}
        employeeToEdit={employeeToEdit}
        setEmployeeToEdit={setEmployeeToEdit}
        editForm={editForm}
        onEditSubmit={() => {}}
        updateLedgerMutation={{}}
        handleDeleteAccount={() => {}}
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        waRuleDialogOpen={waRuleDialogOpen}
        setWaRuleDialogOpen={setWaRuleDialogOpen}
        waChatSearch={waChatSearch}
        setWaChatSearch={setWaChatSearch}
        waRuleDraft={waRuleDraft}
        setWaRuleDraft={setWaRuleDraft}
        filteredWaChats={filteredWaChats}
        saveWaRuleMutation={saveWaRuleMutation}
        waChatsLoading={waChatsLoading}
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
              {/* Search — command-palette style */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search accounts by name or code…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-9"
                  data-testid="input-accounts-search"
                />
                {searchTerm && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSearchTerm("")}
                    data-testid="button-accounts-search-clear"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {accountsLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                  Loading accounts…
                </div>
              ) : searchTerm ? (
                /* Command-palette result list when searching */
                filteredAccounts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Search className="w-8 h-8 mb-3 opacity-30" />
                    <p className="text-sm font-medium">No accounts found</p>
                    <p className="text-xs mt-1 opacity-70">Try a different name or account code</p>
                  </div>
                ) : (
                  <div className="rounded-xl border overflow-hidden divide-y">
                    {filteredAccounts.map((acc) => {
                      const balanceSide = acc.balanceSide || (acc.balance >= 0 ? "Dr" : "Cr");
                      return (
                        <button
                          key={acc.id}
                          data-testid={`button-search-account-${acc.accountId}`}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors group"
                          onClick={() => {
                            handleAccountChange(acc.id);
                            setSearchTerm("");
                          }}
                        >
                          <div className="flex-1 min-w-0 flex items-center gap-2.5">
                            <span className="text-sm font-medium truncate">{acc.name}</span>
                            {acc.accountId && (
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                #{acc.accountId}
                              </span>
                            )}
                          </div>
                          {!hideBalances && (
                            <span
                              className={cn(
                                "font-mono tabular-nums text-sm font-medium shrink-0",
                                balanceSide === "Dr"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400"
                              )}
                            >
                              {formatAmountForAccount(Math.abs(acc.balance), acc.type)}
                              <span className="ml-1 text-[10px] opacity-60">{balanceSide}</span>
                            </span>
                          )}
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )
              ) : (
                /* Full account table when not searching */
                <AccountTable
                  filteredAccounts={filteredAccounts}
                  expandedParents={expandedParents}
                  toggleParent={toggleParent}
                  handleAccountChange={handleAccountChange}
                  hideBalances={hideBalances}
                  formatAmount={(amt) => formatAmountForAccount(amt, undefined)}
                />
              )}
            </div>
          ) : (
            <AccountStatementView
              selectedAccount={selectedAccount}
              onClose={() => setSelectedAccount(null)}
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
              formatAmount={(amt) => formatAmountForAccount(amt, selectedAccount?.type)}
              hideBalances={hideBalances}
              printRef={printRef}
              appMode={appMode}
              formatDisplayDate={formatDisplayDate}
              toggleVoucherSelection={toggleVoucherSelection}
              handleOpenVoucher={handleOpenVoucher}
              waRule={selectedAccountIsLedger ? (waRule ?? null) : null}
              openWaRuleDialog={selectedAccountIsLedger ? openWaRuleDialog : () => {}}
              sendWaStatementMutation={sendWaStatementMutation}
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

        <TabsContent value="alter">
          <div className="flex gap-4 h-[600px]">
            {/* Left: account list */}
            <div className="w-72 shrink-0 flex flex-col gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search accounts..."
                  value={alterSearchTerm}
                  onChange={(e) => setAlterSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-alter-search"
                />
              </div>
              <div className="flex-1 overflow-y-auto rounded-md border divide-y">
                {allAccounts
                  .filter(
                    (a) =>
                      a.type === "ledger" &&
                      (!alterSearchTerm ||
                        a.name.toLowerCase().includes(alterSearchTerm.toLowerCase()) ||
                        a.code.toLowerCase().includes(alterSearchTerm.toLowerCase()))
                  )
                  .map((a) => (
                    <button
                      key={a.id}
                      data-testid={`button-alter-account-${a.accountId}`}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors hover:bg-muted/40 ${
                        alterSelectedAccount?.id === a.id ? "bg-muted/60" : ""
                      }`}
                      onClick={() => {
                        setAlterSelectedAccount(a);
                        editForm.reset({
                          code: a.code,
                          name: a.name,
                          accountType: (a.accountType || a.type || "") as any,
                          subType: a.subType || "",
                          openingBalance: String(Math.abs(a.openingBalance || 0)),
                          openingBalanceSide: (a.openingBalanceSide as "Dr" | "Cr") || "Dr",
                          active: a.active !== false,
                          parentId: a.parentId ?? undefined,
                        });
                      }}
                    >
                      <span className="text-sm truncate">{a.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                        {a.subType === "Group" ? "Group" : "Ledger"}
                      </Badge>
                    </button>
                  ))}
              </div>
            </div>

            {/* Right: edit form or placeholder */}
            <div className="flex-1">
              {!alterSelectedAccount ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground rounded-md border">
                  <Edit className="w-10 h-10 mb-3 opacity-30" />
                  <p className="font-medium text-sm">Select an account</p>
                  <p className="text-xs mt-1">Choose an account from the list to edit it</p>
                </div>
              ) : (
                <Card className="h-full overflow-y-auto">
                  <CardContent className="pt-5">
                    <h3 className="font-semibold mb-4">{alterSelectedAccount.name}</h3>
                    <Form {...editForm}>
                      <form
                        onSubmit={editForm.handleSubmit((data) => {
                          updateLedgerMutation.mutate({
                            id: alterSelectedAccount.accountId,
                            ...data,
                          } as any);
                        })}
                        className="space-y-4"
                        noValidate
                      >
                        {/* Code — read only */}
                        <div className="space-y-1.5">
                          <Label>Account Code</Label>
                          <Input
                            value={alterSelectedAccount.code}
                            readOnly
                            className="bg-muted font-mono text-sm"
                            data-testid="input-alter-code"
                          />
                        </div>

                        {/* Name */}
                        <FormField
                          control={editForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Name</FormLabel>
                              <FormControl>
                                <Input {...field} data-testid="input-alter-name" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Account Type */}
                        <FormField
                          control={editForm.control}
                          name="accountType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Type</FormLabel>
                              <Select onValueChange={(v) => { field.onChange(v); editForm.setValue("subType", ""); }} value={field.value || ""}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-alter-account-type">
                                    <SelectValue placeholder="Select type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Asset">Asset</SelectItem>
                                  <SelectItem value="Liability">Liability</SelectItem>
                                  <SelectItem value="Equity">Equity</SelectItem>
                                  <SelectItem value="Income">Income</SelectItem>
                                  <SelectItem value="Expense">Expense</SelectItem>
                                  <SelectItem value="Bank">Bank</SelectItem>
                                  <SelectItem value="Cash">Cash</SelectItem>
                                  <SelectItem value="Indirect Expense">Indirect Expense</SelectItem>
                                  <SelectItem value="Direct Expense">Direct Expense</SelectItem>
                                  <SelectItem value="Government Taxes">Government Taxes</SelectItem>
                                  <SelectItem value="Loans">Loans</SelectItem>
                                  <SelectItem value="Duty Agent">Duty Agent</SelectItem>
                                  <SelectItem value="Transporter Agent">Transporter Agent</SelectItem>
                                  <SelectItem value="Accounts Payable">Accounts Payable</SelectItem>
                                  <SelectItem value="Profit">Profit</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Sub Type — only for types that have sub-types */}
                        {["Income", "Expense", "Liability", "Asset"].includes(alterAccountType || "") && (
                          <FormField
                            control={editForm.control}
                            name="subType"
                            render={({ field }) => {
                              const subTypeOptions: Record<string, string[]> = {
                                Income: ["Direct Income", "Indirect Income"],
                                Expense: ["Direct Expense", "Indirect Expense"],
                                Liability: ["Current Liability", "Long-term Liability", "Loans Payable", "Output Tax", "Tax Payable"],
                                Asset: ["Current Asset", "Fixed Asset", "Input Tax", "Tax Receivable"],
                              };
                              const opts = subTypeOptions[alterAccountType || ""] || [];
                              return (
                                <FormItem>
                                  <FormLabel>Sub Type</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value || ""}>
                                    <FormControl>
                                      <SelectTrigger data-testid="select-alter-sub-type">
                                        <SelectValue placeholder="Select sub type (optional)" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {opts.map((t) => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              );
                            }}
                          />
                        )}

                        {/* Opening Balance */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <FormField
                            control={editForm.control}
                            name="openingBalance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Opening Balance</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    value={field.value ?? "0"}
                                    data-testid="input-alter-balance"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editForm.control}
                            name="openingBalanceSide"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Balance Side</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || "Dr"}>
                                  <FormControl>
                                    <SelectTrigger data-testid="select-alter-balance-side">
                                      <SelectValue placeholder="Dr/Cr" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Dr">Dr (Debit)</SelectItem>
                                    <SelectItem value="Cr">Cr (Credit)</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Parent Group */}
                        {alterSelectedAccount?.subType !== "Group" && (
                          <FormField
                            control={editForm.control}
                            name="parentId"
                            render={({ field }) => {
                              const filteredGroups = groupOptions.filter(
                                (g: any) => g.id !== alterSelectedAccount?.accountId
                              );
                              const selectedGroup = filteredGroups.find((g: any) => g.id === field.value);
                              return (
                                <FormItem className="flex flex-col">
                                  <FormLabel>Parent Group</FormLabel>
                                  <Popover open={parentGroupOpen} onOpenChange={setParentGroupOpen}>
                                    <PopoverTrigger asChild>
                                      <FormControl>
                                        <Button
                                          variant="outline"
                                          role="combobox"
                                          className="w-full justify-between font-normal"
                                          data-testid="select-alter-parent-group"
                                        >
                                          <span className="truncate">
                                            {selectedGroup ? selectedGroup.name : "— No group —"}
                                          </span>
                                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                      </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[300px] p-0">
                                      <Command>
                                        <CommandInput placeholder="Search groups…" />
                                        <CommandEmpty>No groups found.</CommandEmpty>
                                        <CommandGroup>
                                          <CommandItem
                                            value="__none__"
                                            onSelect={() => {
                                              field.onChange(null);
                                              setParentGroupOpen(false);
                                            }}
                                          >
                                            <Check
                                              className={cn(
                                                "mr-2 h-4 w-4",
                                                field.value == null ? "opacity-100" : "opacity-0"
                                              )}
                                            />
                                            — No group —
                                          </CommandItem>
                                          {filteredGroups.map((g: any) => (
                                            <CommandItem
                                              key={g.id}
                                              value={g.name}
                                              onSelect={() => {
                                                field.onChange(g.id);
                                                setParentGroupOpen(false);
                                              }}
                                            >
                                              <Check
                                                className={cn(
                                                  "mr-2 h-4 w-4",
                                                  field.value === g.id ? "opacity-100" : "opacity-0"
                                                )}
                                              />
                                              {g.name}
                                            </CommandItem>
                                          ))}
                                        </CommandGroup>
                                      </Command>
                                    </PopoverContent>
                                  </Popover>
                                  <FormMessage />
                                </FormItem>
                              );
                            }}
                          />
                        )}

                        {/* Active toggle */}
                        <FormField
                          control={editForm.control}
                          name="active"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                              <div>
                                <FormLabel>Active Status</FormLabel>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Account is available for new entries
                                </p>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={!!field.value}
                                  onCheckedChange={field.onChange}
                                  data-testid="switch-alter-active"
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end gap-2 pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setAlterSelectedAccount(null);
                              editForm.reset();
                            }}
                            data-testid="button-alter-cancel"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={updateLedgerMutation.isPending}
                            data-testid="button-alter-save"
                          >
                            {updateLedgerMutation.isPending ? "Saving…" : "Save Changes"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="find">
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by voucher number, description, or amount (e.g. REC-001, duties, 3967)"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                className="pl-9"
                data-testid="input-find-voucher"
                autoFocus
              />
            </div>

            {!debouncedFindQuery.trim() ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium text-sm">Find any voucher</p>
                <p className="text-xs mt-1">Type a voucher number, description, or amount above</p>
              </div>
            ) : voucherSearchLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Searching…</div>
            ) : voucherSearchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium text-sm">No vouchers found</p>
                <p className="text-xs mt-1">Try a different number, description, or amount</p>
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden divide-y">
                {voucherSearchResults.map((v) => (
                  <button
                    key={v.id}
                    data-testid={`button-voucher-result-${v.id}`}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                    onClick={() => navigate(`${modePrefix}/vouchers/${v.id}/edit`)}
                  >
                    <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{v.voucherNumber}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {v.voucherType}
                        </Badge>
                        {v.locationName && <span className="text-xs text-muted-foreground">{v.locationName}</span>}
                      </div>
                      {v.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{v.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium">
                        {formatAmount(parseFloat(v.totalAmount || "0"))}
                        {v.currency && v.currency !== "USD" && (
                          <span className="text-xs text-muted-foreground ml-1">{v.currency}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDisplayDate(v.effectiveDate || v.voucherDate)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedVoucherIds.size} voucher(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected vouchers and reverse any associated inventory or balance
              changes. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-bulk-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-bulk-delete"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedVoucherIds))}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
