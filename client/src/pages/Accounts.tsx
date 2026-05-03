import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { DeleteConfirmDialog } from "@/components/ConfirmationDialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Search,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
  X,
  Plus,
  Edit,
  ChevronRight,
  ChevronDown,
  Trash2,
  ExternalLink,
  FileDown,
  RotateCcw,
  History,
  ArrowUpRight,
  MessageCircle,
  Send,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useReactToPrint } from "react-to-print";
import { format } from "date-fns";
import { utils, writeFile } from "@/lib/excelHelper";
import { Checkbox } from "@/components/ui/checkbox";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  insertLedgerAccountSchema,
  updateLedgerAccountSchema,
  insertBankAccountSchema,
} from "@shared/schema";
import type {
  InsertLedgerAccount,
  UpdateLedgerAccount,
  LedgerAccount,
  BankAccount,
} from "@shared/schema";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { drCrClass } from "@/lib/formatNumber";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { useEscapeBack } from "@/hooks/use-escape-back";

interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
  balanceSide: string | null;
  openingBalance?: number;
  openingBalanceSide?: string | null;
  active: boolean;
}

interface Transaction {
  entryId: number;
  voucherId: number;
  debitAmount: string;
  creditAmount: string;
  narration: string;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  voucherDescription: string;
  currency?: string;
}

interface GroupedVoucher {
  voucherId: number;
  voucherNumber: string;
  voucherType: string;
  voucherDate: string;
  voucherDescription: string;
  narration: string;
  totalDebit: number;
  totalCredit: number;
  runningBalance?: number;
  runningBalanceCurrency?: string;
  currency?: string;
}

export default function Accounts() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatDisplayDate } = useDateFormat();
  const { formatAmount } = useCurrencyContext();
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideBalances = (myErpPages?.hiddenErpCostFields ?? []).includes("accounts_balances");
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, navigate] = useLocation();
  const searchString = useSearch();

  // Parse URL search params for filter persistence
  const urlParams = new URLSearchParams(searchString);
  const urlAccountId = urlParams.get("accountId");
  const urlAccountType = urlParams.get("accountType");
  const urlStartDate = urlParams.get("startDate") || "";
  const urlEndDate = urlParams.get("endDate") || "";
  const urlMonth = urlParams.get("month") || "";
  const urlYear = urlParams.get("year") || "";

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const fromExternalNavRef = useRef(false);

  useEscapeBack(selectedAccount ? () => {
    if (fromExternalNavRef.current) {
      window.history.back();
    } else {
      setSelectedAccount(null);
    }
  } : null);

  // Force refresh of account data when component mounts
  useEffect(() => {
    if (selectedCompany?.id) {
      queryClient.invalidateQueries({
        queryKey: ["/api/accounts/all", selectedCompany.id],
      });
    }
  }, [selectedCompany?.id]);

  // Initialize state from URL params
  const [searchTerm, setSearchTerm] = useState("");
  
  // Period filter state - use URL params if available, otherwise default to "this_month"
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => {
    if (urlStartDate && urlEndDate) {
      return { fromDate: urlStartDate, toDate: urlEndDate, preset: "custom" as const };
    }
    return getDefaultPeriodValue("this_month");
  });
  const [accountToEdit, setAccountToEdit] = useState<LedgerAccount | null>(
    null,
  );
  const [supplierToEdit, setSupplierToEdit] = useState<Account | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Account | null>(null);
  const [employeeToEdit, setEmployeeToEdit] = useState<Account | null>(null);

  // Helper to update URL params without full page reload
  // Reads current params from window.location.search to avoid stale state
  const updateUrlParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(window.location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
      const newSearch = params.toString();
      window.history.replaceState(
        null,
        "",
        newSearch
          ? `${window.location.pathname}?${newSearch}`
          : window.location.pathname,
      );
    },
    [],
  );
  useDateJump((date) => {
    const jumped = { fromDate: date, toDate: date, preset: "custom" as const };
    setPeriodFilter(jumped);
    updateUrlParams({ startDate: date, endDate: date });
  });

  const [editSearchTerm, setEditSearchTerm] = useState("");
  const [voucherSearchTerm, setVoucherSearchTerm] = useState("");
  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    new Set(),
  );
  const [bankToEdit, setBankToEdit] = useState<BankAccount | null>(null);
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<Set<number>>(
    new Set(),
  );
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showDeletedVouchers, setShowDeletedVouchers] = useState(false);

  // Export language selection
  const [exportLang, setExportLang] = useState<"en" | "fr" | "ar">("en");
  const [pendingDelete, setPendingDelete] = useState<(() => void) | null>(null);

  const exportLabels: Record<string, {
    ledger: string; type: string; debit: string; credit: string; runningBalance: string; date: string; notes: string;
    openingBalance: string; accountStatement: string; language: string;
  }> = {
    en: { ledger: "Ledger", type: "Type", debit: "Debit", credit: "Credit", runningBalance: "Running Balance", date: "Date", notes: "Notes", openingBalance: "Opening Balance", accountStatement: "Account Statement", language: "English" },
    fr: { ledger: "Compte", type: "Type", debit: "Débit", credit: "Crédit", runningBalance: "Solde courant", date: "Date", notes: "Notes", openingBalance: "Solde d'ouverture", accountStatement: "Relevé de compte", language: "Français" },
    ar: { ledger: "الحساب", type: "النوع", debit: "مدين", credit: "دائن", runningBalance: "الرصيد", date: "التاريخ", notes: "ملاحظات", openingBalance: "الرصيد الافتتاحي", accountStatement: "كشف حساب", language: "عربي" },
  };

  // Print functionality
  const printRef = useRef<HTMLDivElement>(null);
  const accountListRef = useRef<HTMLDivElement>(null);
  const editAccountListRef = useRef<HTMLDivElement>(null);

  const handleListArrowScroll = (
    e: React.KeyboardEvent,
    ref: React.RefObject<HTMLDivElement>,
  ) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ref.current?.scrollBy({ top: e.key === "ArrowDown" ? 48 : -48, behavior: "smooth" });
    }
  };

  // label that shows the chosen period on the printout
  const periodLabel = useMemo(() => {
    const hasStart = !!periodFilter.fromDate;
    const hasEnd = !!periodFilter.toDate;

    if (hasStart && hasEnd)
      return `${formatDisplayDate(periodFilter.fromDate)} → ${formatDisplayDate(periodFilter.toDate)}`;
    if (hasStart) return `From ${formatDisplayDate(periodFilter.fromDate)}`;
    if (hasEnd) return `Up to ${formatDisplayDate(periodFilter.toDate)}`;

    return "All dates";
  }, [periodFilter.fromDate, periodFilter.toDate, formatDisplayDate]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: selectedAccount
      ? `Statement - ${selectedAccount.name}`
      : "Account Statement",
  });
  // Factory suppliers — must be declared before factorySupplierAccounts uses it below
  const { data: factorySuppliersData = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/suppliers/with-balances"],
    enabled: appMode === "factory" && !!selectedCompany,
  });

  const { data: allAccounts = [], isLoading: accountsLoading } = useQuery<
    Account[]
  >({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // ── WhatsApp auto-statement rule ──────────────────────────────────────────
  interface WaRule {
    id?: number;
    enabled: boolean;
    whatsappChatId: string;
    sendOnPayment: boolean;
    sendOnReceipt: boolean;
    sendOnJournal: boolean;
  }
  interface WaChat { id: string; name: string; type: string; }

  const [waRuleDialogOpen, setWaRuleDialogOpen] = useState(false);
  const [waChatSearch, setWaChatSearch]         = useState("");
  const [waRuleDraft, setWaRuleDraft]           = useState<WaRule>({
    enabled: false, whatsappChatId: "", sendOnPayment: true, sendOnReceipt: true, sendOnJournal: false,
  });

  const ledgerAccountId =
    selectedAccount?.type === "ledger" ? selectedAccount.accountId : null;

  const { data: waRule, refetch: refetchWaRule } = useQuery<WaRule>({
    queryKey: ["/api/factory/accounts", ledgerAccountId, "whatsapp-rule"],
    queryFn: async () => {
      if (!ledgerAccountId) return null as any;
      const r = await modeApiRequest("GET", `/api/factory/accounts/${ledgerAccountId}/whatsapp-rule`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: (appMode === "factory" || appMode === "erp") && !!ledgerAccountId,
    staleTime: 30_000,
  });

  const { data: waChats = [], isLoading: waChatsLoading } = useQuery<WaChat[]>({
    queryKey: ["/api/whatsapp/chats/pos"],
    queryFn: async () => {
      const r = await modeApiRequest("GET", "/api/whatsapp/chats/pos");
      if (!r.ok) throw new Error("Failed to load chats");
      return r.json();
    },
    enabled: waRuleDialogOpen,
    staleTime: 60_000,
    retry: false,
  });

  const saveWaRuleMutation = useMutation({
    mutationFn: async (rule: WaRule) => {
      const r = await modeApiRequest("PUT", `/api/factory/accounts/${ledgerAccountId}/whatsapp-rule`, rule);
      if (!r.ok) throw new Error("Failed to save rule");
      return r.json();
    },
    onSuccess: () => {
      refetchWaRule();
      setWaRuleDialogOpen(false);
      toast({ title: "WhatsApp rule saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendWaStatementMutation = useMutation({
    mutationFn: async () => {
      const r = await modeApiRequest("POST", `/api/factory/accounts/${ledgerAccountId}/send-statement-whatsapp`, {
        startDate: periodFilter.fromDate,
        endDate: periodFilter.toDate,
        lang: "en",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Failed to send");
      return data;
    },
    onSuccess: () => toast({ title: "Statement sent to WhatsApp" }),
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  // Open WA rule dialog: seed draft from current rule
  function openWaRuleDialog() {
    setWaRuleDraft(
      waRule
        ? { ...waRule }
        : { enabled: false, whatsappChatId: "", sendOnPayment: true, sendOnReceipt: true, sendOnJournal: false }
    );
    setWaChatSearch("");
    setWaRuleDialogOpen(true);
  }

  const filteredWaChats = waChats.filter(
    (c) => c.name.toLowerCase().includes(waChatSearch.toLowerCase())
  );
  // ─────────────────────────────────────────────────────────────────────────

  // Filter out inventory accounts - they have their own dedicated page
  // Filter out supplier accounts - they have their own dedicated Suppliers page
  // Type comparison uses lowercase to match API response
  const baseAccounts = allAccounts.filter((account) => {
    const type = (account.type || "").toLowerCase();
    return (
      type === "ledger" &&
      account.code !== "PURCHASES" &&
      account.code !== "IMPORT_CHARGES"
    );
  });

  // In factory mode, append factory suppliers as accounts
  const factorySupplierAccounts: Account[] = appMode === "factory"
    ? factorySuppliersData.map((s: any) => ({
        id: `factorySupplier-${s.id}`,
        accountId: s.id,
        type: "factorySupplier" as const,
        name: s.name,
        code: `FS-${s.id}`,
        balance: parseFloat(s.totalValue || "0"),
        parentId: s.parentId || null,
        currencyBalances: s.currencyBalances || [],
      }))
    : [];

  const { data: factoryWorkersData = [] } = useQuery<any[]>({
    queryKey: ["/api/factory/workers/with-balances", selectedCompany?.id],
    enabled: appMode === "factory" && !!selectedCompany,
  });

  const factoryWorkerAccounts: Account[] = appMode === "factory"
    ? (Array.isArray(factoryWorkersData) ? factoryWorkersData : [])
        .filter((w: any) => w.active !== false)
        .map((w: any) => {
          const bal = parseFloat(w.currentBalance ?? "0");
          // Positive balance = worker owes us (advances > payroll) = Dr
          // Negative balance = we owe worker (payroll > advances) = Cr
          const side = bal >= 0 ? "Dr" : "Cr";
          return {
            id: `factoryWorker-${w.id}`,
            accountId: w.id,
            type: "factoryWorker" as const,
            name: w.fullName,
            code: w.employeeCode || `FW-${w.id}`,
            balance: bal,
            balanceSide: side,
            openingBalance: 0,
            openingBalanceSide: null,
            active: w.active ?? true,
          };
        })
    : [];

  const accounts = baseAccounts;

  const { data: ledgerAccounts = [], isLoading: ledgerAccountsLoading } =
    useQuery<LedgerAccount[]>({
      queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      queryFn: async () => {
        if (!selectedCompany) return [];
        const response = await fetch(
          `/api/ledger-accounts?companyId=${selectedCompany.id}`,
          {
            credentials: "include",
          },
        );
        if (!response.ok) throw new Error("Failed to fetch ledger accounts");
        return await response.json();
      },
      enabled: !!selectedCompany,
    });

  const { data: bankAccounts = [], isLoading: bankAccountsLoading } = useQuery<
    BankAccount[]
  >({
    queryKey: ["/api/bank-accounts", selectedCompany?.id],
    queryFn: async () => {
      if (!selectedCompany) return [];
      const response = await fetch(
        `/api/bank-accounts?companyId=${selectedCompany.id}`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("Failed to fetch bank accounts");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  const isFactorySupplierAccount = selectedAccount?.type === "factorySupplier";
  const isFactoryWorkerAccount = selectedAccount?.type === "factoryWorker";

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<
    Transaction[]
  >({
    queryKey: selectedAccount && !isFactorySupplierAccount
      ? [
          selectedAccount.type === "factoryWorker"
            ? `/api/factory/workers/${selectedAccount.accountId}/statement`
            : `/api/accounts/${(selectedAccount.type || "").toLowerCase().replace(" ", "-")}/${selectedAccount.accountId}/transactions`,
          { startDate: periodFilter.fromDate, endDate: periodFilter.toDate },
        ]
      : [],
    queryFn: async () => {
      if (!selectedAccount || isFactorySupplierAccount) return [];

      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);

      let url: string;
      if (selectedAccount.type === "factoryWorker") {
        url = `/api/factory/workers/${selectedAccount.accountId}/statement${
          params.toString() ? `?${params.toString()}` : ""
        }`;
      } else {
        let accountType = (selectedAccount.type || "").toLowerCase();
        if (accountType === "fixed asset") {
          accountType = "fixed-asset";
        }
        url = `/api/accounts/${accountType}/${selectedAccount.accountId}/transactions${
          params.toString() ? `?${params.toString()}` : ""
        }`;
      }

      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return await response.json();
    },
    enabled: !!selectedAccount && !isFactorySupplierAccount,
  });

  // Factory supplier statement (only when a factorySupplier account is selected)
  const { data: factorySupplierStatement, isLoading: factoryStatementLoading } = useQuery<any>({
    queryKey: selectedAccount && isFactorySupplierAccount
      ? ["/api/factory/suppliers", selectedAccount.accountId, "statement"]
      : [],
    queryFn: async () => {
      if (!selectedAccount || !isFactorySupplierAccount) return null;
      const res = await fetch(`/api/factory/suppliers/${selectedAccount.accountId}/statement`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory supplier statement");
      return res.json();
    },
    enabled: !!selectedAccount && isFactorySupplierAccount,
  });

  // Detect broker: has linked suppliers — then also fetch consolidated broker statement
  const isBrokerSupplier = !!(factorySupplierStatement?.linkedSupplierGroups?.length > 0);
  const { data: brokerStatementData, isLoading: brokerStatementLoading } = useQuery<any>({
    queryKey: selectedAccount && isBrokerSupplier
      ? ["/api/factory/suppliers", selectedAccount.accountId, "broker-statement"]
      : [],
    queryFn: async () => {
      if (!selectedAccount || !isBrokerSupplier) return null;
      const res = await fetch(`/api/factory/suppliers/${selectedAccount.accountId}/broker-statement`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch broker statement");
      return res.json();
    },
    enabled: !!selectedAccount && isBrokerSupplier,
  });

  // Per-currency balance breakdown for ledger accounts (all-time, no period filter)
  const isLedgerAccount = selectedAccount?.type === "ledger";
  const { data: ledgerCurrencyBalances } = useQuery<{ currency: string; totalDebit: number; totalCredit: number }[]>({
    queryKey: selectedAccount && isLedgerAccount
      ? [`/api/accounts/ledger/${selectedAccount.accountId}/currency-balances`]
      : [],
    queryFn: async () => {
      if (!selectedAccount || !isLedgerAccount) return [];
      const res = await fetch(`/api/accounts/ledger/${selectedAccount.accountId}/currency-balances`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedAccount && isLedgerAccount,
  });

  const prePeriodAccountType = selectedAccount
    ? (selectedAccount.type || "").toLowerCase().replace(" ", "-")
    : null;
  const { data: prePeriodData } = useQuery<{ balance: number }>({
    queryKey: selectedAccount && periodFilter.fromDate
      ? [`/api/accounts/${prePeriodAccountType}/${selectedAccount.accountId}/pre-period-balance`, { endDate: periodFilter.fromDate }]
      : [],
    queryFn: async () => {
      if (!selectedAccount || !periodFilter.fromDate || !prePeriodAccountType) return { balance: 0 };
      const res = await fetch(
        `/api/accounts/${prePeriodAccountType}/${selectedAccount.accountId}/pre-period-balance?endDate=${encodeURIComponent(periodFilter.fromDate)}`,
        { credentials: "include" }
      );
      if (!res.ok) return { balance: 0 };
      return res.json();
    },
    enabled: !!selectedAccount && !!periodFilter.fromDate && !isFactoryWorkerAccount,
  });

  // Deleted vouchers for current account (shown when toggle is active)
  const { data: deletedVouchers = [], isLoading: deletedVouchersLoading } = useQuery<any[]>({
    queryKey: selectedAccount && prePeriodAccountType && showDeletedVouchers
      ? [`/api/accounts/${prePeriodAccountType}/${selectedAccount.accountId}/deleted-vouchers`]
      : ["deleted-vouchers-disabled"],
    queryFn: async () => {
      if (!selectedAccount || !prePeriodAccountType) return [];
      const res = await fetch(
        `/api/accounts/${prePeriodAccountType}/${selectedAccount.accountId}/deleted-vouchers`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedAccount && !!prePeriodAccountType && showDeletedVouchers,
  });

  const { data: voucherSearchResults = [], isLoading: voucherSearchLoading } = useQuery<any[]>({
    queryKey: ["/api/vouchers/search", voucherSearchTerm],
    queryFn: async () => {
      if (!voucherSearchTerm.trim()) return [];
      const res = await fetch(`/api/vouchers/search?q=${encodeURIComponent(voucherSearchTerm.trim())}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: voucherSearchTerm.trim().length > 0,
  });

  const restoreVoucherMutation = useMutation({
    mutationFn: async (voucherId: number) => {
      const res = await fetch(`/api/deleted-items/voucher/${voucherId}/restore`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to restore voucher");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Voucher restored", description: "The voucher is back in the ledger." });
      queryClient.invalidateQueries({ queryKey: ["/api/deleted-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all", selectedCompany?.id] });
      if (selectedAccount && prePeriodAccountType) {
        queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            typeof q.queryKey[0] === "string" &&
            (q.queryKey[0] as string).startsWith(`/api/accounts/${prePeriodAccountType}/${selectedAccount.accountId}/`),
        });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Could not restore voucher.", variant: "destructive" });
    },
  });

  // Restore account from URL params when accounts load
  useEffect(() => {
    if (
      accounts.length > 0 &&
      urlAccountId &&
      urlAccountType &&
      !selectedAccount
    ) {
      const account = accounts.find(
        (a) =>
          a.accountId === parseInt(urlAccountId) &&
          (a.type || "").toLowerCase() === (urlAccountType || "").toLowerCase(),
      );
      if (account) {
        fromExternalNavRef.current = true;
        setSelectedAccount(account);
      }
    }
  }, [accounts, urlAccountId, urlAccountType, selectedAccount]);

  const handleAccountChange = (accountId: string) => {
    fromExternalNavRef.current = false;
    const account = accounts.find((a) => a.id === accountId);
    setSelectedAccount(account || null);
    setSearchTerm("");
    // Reset period filter to this_month when switching accounts
    const defaultPeriod = getDefaultPeriodValue("this_month");
    setPeriodFilter(defaultPeriod);
    // Save to URL
    if (account) {
      updateUrlParams({
        accountId: account.accountId.toString(),
        accountType: (account.type || "").toLowerCase(),
        startDate: defaultPeriod.fromDate,
        endDate: defaultPeriod.toDate,
      });
    } else {
      updateUrlParams({ accountId: null, accountType: null, startDate: null, endDate: null });
    }
  };

  // Handler for period filter changes - updates state and URL params
  const handlePeriodFilterChange = useCallback((newValue: PeriodFilterValue) => {
    setPeriodFilter(newValue);
    updateUrlParams({
      startDate: newValue.fromDate || null,
      endDate: newValue.toDate || null,
    });
  }, [updateUrlParams]);

  // Build account hierarchy
  const buildAccountHierarchy = () => {
    const accountMap = new Map<string, Account & { children: Account[] }>();
    const rootAccounts: (Account & { children: Account[] })[] = [];

    // First pass: create map of all accounts
    accounts.forEach((account) => {
      accountMap.set(account.id, { ...account, children: [] });
    });

    // Second pass: build hierarchy
    accounts.forEach((account) => {
      const mappedAccount = accountMap.get(account.id);
      if (!mappedAccount) return;

      // Factory supplier accounts: use account.parentId directly (they are not in ledgerAccounts)
      if (account.type === "factorySupplier" && account.parentId) {
        const parentAccount = accountMap.get(`factorySupplier-${account.parentId}`);
        if (parentAccount) {
          parentAccount.children.push(mappedAccount);
        } else {
          rootAccounts.push(mappedAccount);
        }
      } else if (account.type === "ledger") {
        // Only ledger-type accounts participate in the ledger account hierarchy.
        // Other types (employee, bank, supplier, customer, etc.) are always root-level
        // to prevent accidental ID collisions with unrelated ledger accounts.
        const ledgerAccount = ledgerAccounts.find(
          (la) => la.id === account.accountId,
        );
        if (ledgerAccount?.parentId) {
          const parentAccount = Array.from(accountMap.values()).find(
            (a) => a.accountId === ledgerAccount.parentId,
          );
          if (parentAccount) {
            parentAccount.children.push(mappedAccount);
          } else {
            rootAccounts.push(mappedAccount);
          }
        } else {
          rootAccounts.push(mappedAccount);
        }
      } else {
        rootAccounts.push(mappedAccount);
      }
    });

    return rootAccounts;
  };

  const accountHierarchy = useMemo(
    () => buildAccountHierarchy(),
    [accounts, ledgerAccounts],
  );

  const filteredAccounts = useMemo(() => {
    const searchLower = (searchTerm || "").trim().toLowerCase();

    // If no search, return original tree
    if (!searchLower) return accountHierarchy;

    const matchesSearch = (acc: any): boolean => {
      return (
        (acc.name || "").toLowerCase().includes(searchLower) ||
        (acc.code || "").toLowerCase().includes(searchLower) ||
        (acc.type || "").toLowerCase().includes(searchLower)
      );
    };

    // Recursively keep node if it matches OR any descendant matches.
    // Also prune children to only matching branches.
    const filterNode = (node: any): any | null => {
      const children = Array.isArray(node.children) ? node.children : [];

      const filteredChildren = children
        .map(filterNode)
        .filter((x: any): x is any => Boolean(x));

      if (matchesSearch(node) || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }

      return null;
    };

    return accountHierarchy
      .map(filterNode)
      .filter((x: any): x is any => Boolean(x));
  }, [accountHierarchy, searchTerm]);

  const toggleParent = (accountId: string) => {
    const newExpanded = new Set(expandedParents);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedParents(newExpanded);
  };

  const parseBalance = (value: any): number => {
    if (value === null || value === undefined || value === "") return 0;
    const parsed = typeof value === "string" ? parseFloat(value) : value;
    return isNaN(parsed) ? 0 : parsed;
  };

  // Group transactions by voucherId for Tally-style one-row-per-voucher display
  const groupTransactionsByVoucher = (): GroupedVoucher[] => {
    const voucherMap = new Map<number, GroupedVoucher>();

    transactions.forEach((txn) => {
      // voucherId should always be a number from the API, but ensure it's numeric
      const voucherId = Number(txn.voucherId);

      const existing = voucherMap.get(voucherId);
      const debit = parseBalance(txn.debitAmount);
      const credit = parseBalance(txn.creditAmount);

      if (existing) {
        existing.totalDebit += debit;
        existing.totalCredit += credit;
        // Keep the first narration or description we find
        if (!existing.narration && txn.narration) {
          existing.narration = txn.narration;
        }
      } else {
        voucherMap.set(voucherId, {
          voucherId: voucherId,
          voucherNumber: txn.voucherNumber,
          voucherType: txn.voucherType,
          voucherDate: txn.voucherDate,
          voucherDescription: txn.voucherDescription,
          narration: txn.narration || "",
          totalDebit: debit,
          totalCredit: credit,
          currency: txn.currency,
        });
      }
    });

    // Sort by date, then by voucher number
    return Array.from(voucherMap.values()).sort((a, b) => {
      const dateCompare =
        new Date(a.voucherDate).getTime() - new Date(b.voucherDate).getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.voucherNumber.localeCompare(b.voucherNumber);
    });
  };

  const groupedVouchers = groupTransactionsByVoucher();

  // Calculate opening balance
  // When a period start date is active, use the pre-period balance (sum of all transactions before the period)
  const getOpeningBalance = (): number => {
    if (periodFilter.fromDate && prePeriodData !== undefined) {
      return prePeriodData.balance;
    }
    const rawOpeningBalance = parseBalance(
      selectedAccount?.openingBalance ?? 0,
    );
    if (selectedAccount?.type === "supplier") {
      return rawOpeningBalance;
    } else {
      return selectedAccount?.openingBalanceSide === "Cr"
        ? -rawOpeningBalance
        : rawOpeningBalance;
    }
  };

  const openingBalance = getOpeningBalance();

  // Calculate running balance for grouped vouchers, tracking per-currency sub-balances
  const calculateGroupedRunningBalance = (): { vouchers: GroupedVoucher[]; finalRunningBalances: Map<string, number> } => {
    const runningBalances = new Map<string, number>();
    const baseCurrency = "USD";
    runningBalances.set(baseCurrency, openingBalance);
    const isSupplierAcc = selectedAccount?.type === "supplier";

    const vouchers = groupedVouchers.map((voucher) => {
      const curr = voucher.currency || baseCurrency;
      const existing = runningBalances.get(curr) ?? 0;
      const newBalance = isSupplierAcc
        ? existing + voucher.totalCredit - voucher.totalDebit
        : existing + voucher.totalDebit - voucher.totalCredit;
      runningBalances.set(curr, newBalance);
      return {
        ...voucher,
        runningBalance: newBalance,
        runningBalanceCurrency: curr !== baseCurrency ? curr : undefined,
      };
    });

    return { vouchers, finalRunningBalances: new Map(runningBalances) };
  };

  const { vouchers: vouchersWithBalance, finalRunningBalances } = calculateGroupedRunningBalance();

  const transactionTotals = vouchersWithBalance.reduce(
    (acc, v) => ({
      totalDebit: acc.totalDebit + v.totalDebit,
      totalCredit: acc.totalCredit + v.totalCredit,
    }),
    { totalDebit: 0, totalCredit: 0 },
  );

  // Closing balance = final USD running balance (includes opening balance + all USD-currency vouchers)
  const closingBalance = finalRunningBalances.get("USD") ?? openingBalance;

  // Actual account balance — the real current balance regardless of period filter.
  // Uses the same sign convention as closingBalance (positive = Dr for non-suppliers, positive = Cr for suppliers).
  const actualBalance = (() => {
    const raw = selectedAccount?.balance ?? 0;
    const side = selectedAccount?.balanceSide ?? "Dr";
    const isSupp = selectedAccount?.type === "supplier";
    if (isSupp) return side === "Cr" ? raw : -raw;
    return side === "Dr" ? raw : -raw;
  })();

  const handleExportStatementToExcel = async () => {
    if (!selectedAccount || vouchersWithBalance.length === 0) {
      toast({
        title: "No data to export",
        description: "Select an account with transactions to export.",
        variant: "destructive",
      });
      return;
    }

    const lbl = exportLabels[exportLang] ?? exportLabels["en"];
    const ledgerName = selectedAccount.name || "Account";
    const rows: any[][] = [];

    rows.push([lbl.ledger, lbl.type, lbl.debit, lbl.credit, lbl.runningBalance, lbl.date, lbl.notes]);

    const firstDate = vouchersWithBalance[0]?.voucherDate.split("T")[0] ?? "";
    const openingDateFormatted = firstDate
      ? format(new Date(firstDate + "T00:00:00"), "dd MMM yyyy")
      : "";
    rows.push([ledgerName, lbl.openingBalance, "", "", formatAmount(openingBalance), openingDateFormatted, ""]);

    for (const v of vouchersWithBalance) {
      const dateKey = v.voucherDate.split("T")[0];
      const formattedDate = format(new Date(dateKey + "T00:00:00"), "dd MMM yyyy");
      const noteText = (v.voucherDescription && v.voucherDescription.trim())
        ? v.voucherDescription.trim()
        : (v.narration && v.narration.trim()) ? v.narration.trim() : "";

      rows.push([
        ledgerName,
        v.voucherType,
        v.totalDebit > 0 ? formatAmount(v.totalDebit) : "",
        v.totalCredit > 0 ? formatAmount(v.totalCredit) : "",
        formatAmount(v.runningBalance ?? 0),
        formattedDate,
        noteText,
      ]);
    }

    const workbook = utils.book_new();
    const sheetData = {
      ...utils.aoa_to_sheet(rows),
      "!cols": [
        { wch: 25 },
        { wch: 14 },
        { wch: 15 },
        { wch: 15 },
        { wch: 18 },
        { wch: 14 },
        { wch: 30 },
      ],
    };

    const sheetLabel = ledgerName.substring(0, 31).replace(/[\\/*?[\]:]/g, "_");
    utils.book_append_sheet(workbook, sheetData, sheetLabel);

    const accountName = ledgerName.replace(/[\\/*?[\]:]/g, "_").substring(0, 40);
    const dateRange = periodFilter.fromDate && periodFilter.toDate
      ? `${periodFilter.fromDate}_to_${periodFilter.toDate}`
      : format(new Date(), "yyyy-MM-dd");
    const fileName = `Account_Statement_${accountName}_${dateRange}.xlsx`;
    await writeFile(workbook, fileName);

    toast({
      title: "Export successful",
      description: `Downloaded ${fileName} with ${vouchersWithBalance.length} transactions.`,
    });
  };

  const handleExportStatementToPDF = () => {
    if (!selectedAccount) return;
    const params = new URLSearchParams();
    if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
    if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
    params.append("lang", exportLang);
    const qs = `?${params.toString()}`;
    if (isFactoryWorkerAccount) {
      window.open(`/api/factory/workers/${selectedAccount.accountId}/statement-pdf${qs}`, "_blank");
    } else {
      let accountType = (selectedAccount.type || "").toLowerCase();
      if (accountType === "fixed asset") accountType = "fixed-asset";
      window.open(`/api/accounts/${accountType}/${selectedAccount.accountId}/statement-pdf${qs}`, "_blank");
    }
  };

  const handleVoucherClick = (voucher: GroupedVoucher) => {
    if (isFactoryWorkerAccount) return;
    const voucherTypeMap: Record<string, string> = {
      Payment: "payment",
      Receipt: "receipt",
      Journal: "journal",
      Consumption: "adjustment",
      Production: "adjustment",
      Mixed: "adjustment",
      StockTransfer: "transfer",
      "Stock Transfer": "transfer",
      "Credit Note": "credit-note",
      "Debit Note": "credit-note",
    };
    const base = appMode === "factory" ? "/factory" : "";
    const tabName = voucherTypeMap[voucher.voucherType];
    if (tabName) {
      navigate(`${base}/vouchers?edit=${voucher.voucherId}&tab=${tabName}`);
    } else {
      navigate(`${base}/vouchers/${voucher.voucherId}/edit`);
    }
  };

  const form = useForm<InsertLedgerAccount>({
    resolver: zodResolver(insertLedgerAccountSchema.omit({ companyId: true })),
    defaultValues: {
      code: "",
      name: "",
      accountType: "Asset",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    },
  });

  const bankForm = useForm<
    Omit<z.infer<typeof insertBankAccountSchema>, "companyId">
  >({
    resolver: zodResolver(insertBankAccountSchema.omit({ companyId: true })),
    defaultValues: {
      code: "",
      name: "",
      bankName: "",
      accountNumber: "",
      routingCode: "",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    },
  });

  const createLedgerMutation = useMutation({
    mutationFn: async (data: Omit<InsertLedgerAccount, "companyId">) => {
      if (!selectedCompany?.id) {
        throw new Error("No company selected");
      }
      return await modeApiRequest("POST", "/api/ledger-accounts", {
        ...data,
        companyId: selectedCompany.id,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Ledger account created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      });
      form.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to create ledger account",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InsertLedgerAccount) => {
    createLedgerMutation.mutate(data);
  };

  const editForm = useForm<UpdateLedgerAccount>({
    resolver: zodResolver(
      updateLedgerAccountSchema.omit({ id: true, companyId: true }),
    ),
    defaultValues: {
      code: "",
      name: "",
      accountType: "Asset",
      openingBalance: "0",
      openingBalanceSide: "Dr",
      active: true,
    },
  });

  const updateLedgerMutation = useMutation({
    mutationFn: async (data: UpdateLedgerAccount) => {
      if (!accountToEdit) {
        throw new Error("No account selected");
      }
      return await modeApiRequest(
        "PUT",
        `/api/ledger-accounts/${accountToEdit.id}`,
        data,
      );
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Account updated successfully",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setAccountToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update account",
        variant: "destructive",
      });
    },
  });

  const deleteLedgerMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return await modeApiRequest("DELETE", `/api/ledger-accounts/${accountId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Ledger account deleted successfully",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/ledger-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setAccountToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to delete account",
        variant: "destructive",
      });
    },
  });

  const updateSupplierMutation = useMutation({
    mutationFn: async (data: UpdateLedgerAccount) => {
      if (!supplierToEdit) throw new Error("No supplier selected");
      return await modeApiRequest("PATCH", `/api/suppliers/${supplierToEdit.accountId}`, {
        legalName: data.name,
        openingBalance: data.openingBalance,
        active: data.active,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Supplier updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setSupplierToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update supplier", variant: "destructive" });
    },
  });

  const deleteSupplierMutation = useMutation({
    mutationFn: async () => {
      if (!supplierToEdit) throw new Error("No supplier selected");
      return await modeApiRequest("DELETE", `/api/suppliers/${supplierToEdit.accountId}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Supplier deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setSupplierToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete supplier", variant: "destructive" });
    },
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async (data: UpdateLedgerAccount) => {
      if (!customerToEdit) throw new Error("No customer selected");
      return await modeApiRequest("PUT", `/api/customers/${customerToEdit.accountId}`, {
        legalName: data.name,
        openingBalance: data.openingBalance,
        openingBalanceSide: data.openingBalanceSide,
        active: data.active,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Customer updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      setCustomerToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update customer", variant: "destructive" });
    },
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: async () => {
      if (!customerToEdit) throw new Error("No customer selected");
      return await modeApiRequest("DELETE", `/api/customers/${customerToEdit.accountId}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Customer deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers/stats", selectedCompany?.id] });
      setCustomerToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete customer", variant: "destructive" });
    },
  });

  const updateEmployeeMutation = useMutation({
    mutationFn: async (data: UpdateLedgerAccount) => {
      if (!employeeToEdit) throw new Error("No employee selected");
      const nameParts = (data.name || "").trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      return await modeApiRequest("PATCH", `/api/employees/${employeeToEdit.accountId}`, {
        firstName,
        lastName,
        active: data.active,
      });
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Employee updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setEmployeeToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to update employee", variant: "destructive" });
    },
  });

  const deleteEmployeeMutation = useMutation({
    mutationFn: async () => {
      if (!employeeToEdit) throw new Error("No employee selected");
      return await modeApiRequest("DELETE", `/api/factory/employees/${employeeToEdit.accountId}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Employee deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/employees"] });
      setEmployeeToEdit(null);
      editForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete employee", variant: "destructive" });
    },
  });

  const deleteWorkerMutation = useMutation({
    mutationFn: async (workerId: number) => {
      return await modeApiRequest("DELETE", `/api/factory/workers/${workerId}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Worker deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/workers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete worker", variant: "destructive" });
    },
  });

  const deleteFixedAssetMutation = useMutation({
    mutationFn: async (assetId: number) => {
      return await modeApiRequest("DELETE", `/api/fixed-assets/${assetId}`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Fixed asset deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete fixed asset", variant: "destructive" });
    },
  });

  const deleteFactorySupplierMutation = useMutation({
    mutationFn: async (supplierId: number) => {
      return await modeApiRequest("DELETE", `/api/factory/suppliers/${supplierId}/permanent`);
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Supplier deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/factory/suppliers"] });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to delete supplier", variant: "destructive" });
    },
  });

  const createBankMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!selectedCompany?.id) {
        throw new Error("No company selected");
      }
      return await modeApiRequest("POST", "/api/bank-accounts", {
        ...data,
        companyId: selectedCompany.id,
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bank account created successfully",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/bank-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      bankForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to create bank account",
        variant: "destructive",
      });
    },
  });

  const updateBankMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!bankToEdit) {
        throw new Error("No bank account selected");
      }
      return await modeApiRequest(
        "PUT",
        `/api/bank-accounts/${bankToEdit.id}`,
        data,
      );
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bank account updated successfully",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/bank-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setBankToEdit(null);
      bankForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to update bank account",
        variant: "destructive",
      });
    },
  });

  const deleteBankMutation = useMutation({
    mutationFn: async (accountId: number) => {
      return await modeApiRequest("DELETE", `/api/bank-accounts/${accountId}`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Bank account deleted successfully",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/bank-accounts", selectedCompany?.id],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/all"] });
      setBankToEdit(null);
      bankForm.reset();
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to delete bank account",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteVouchersMutation = useMutation({
    mutationFn: async (voucherIds: number[]) => {
      return await modeApiRequest("POST", "/api/vouchers/bulk-delete", {
        voucherIds,
      });
    },
    onSuccess: (_, voucherIds) => {
      toast({
        title: "Success",
        description: `Deleted ${voucherIds.length} voucher(s) successfully`,
      });
      setSelectedVoucherIds(new Set());
      setShowBulkDeleteConfirm(false);
      queryClient.invalidateQueries({
        queryKey: ["/api/accounts/all", selectedCompany?.id],
      });

      if (selectedAccount) {
        const baseKey = `/api/accounts/${(selectedAccount.type || "")
          .toLowerCase()
          .replace(" ", "-")}/${selectedAccount.accountId}/transactions`;

        // refresh ALL date-range variants, since the query key includes { startDate, endDate }
        queryClient.invalidateQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) && q.queryKey[0] === baseKey,
        });
      }
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to delete vouchers",
        variant: "destructive",
      });
    },
  });

  const toggleVoucherSelection = (voucherId: number) => {
    setSelectedVoucherIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(voucherId)) {
        newSet.delete(voucherId);
      } else {
        newSet.add(voucherId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedVoucherIds.size === vouchersWithBalance.length) {
      setSelectedVoucherIds(new Set());
    } else {
      setSelectedVoucherIds(
        new Set(vouchersWithBalance.map((v) => v.voucherId)),
      );
    }
  };

  const handleBulkDelete = () => {
    if (selectedVoucherIds.size > 0) {
      bulkDeleteVouchersMutation.mutate(Array.from(selectedVoucherIds));
    }
  };

  const handleDeleteAccount = () => {
    if (supplierToEdit) {
      setPendingDelete(() => () => deleteSupplierMutation.mutate());
      return;
    }
    if (customerToEdit) {
      setPendingDelete(() => () => deleteCustomerMutation.mutate());
      return;
    }
    if (employeeToEdit) {
      setPendingDelete(() => () => deleteEmployeeMutation.mutate());
      return;
    }
    if (!accountToEdit) return;
    setPendingDelete(() => () => deleteLedgerMutation.mutate(accountToEdit.id));
  };

  const onEditSubmit = (data: UpdateLedgerAccount) => {
    if (supplierToEdit) {
      updateSupplierMutation.mutate(data);
      return;
    }
    if (customerToEdit) {
      updateCustomerMutation.mutate(data);
      return;
    }
    if (employeeToEdit) {
      updateEmployeeMutation.mutate(data);
      return;
    }
    updateLedgerMutation.mutate(data);
  };

  const handleSelectAccountForEdit = (account: LedgerAccount) => {
    setAccountToEdit(account);
    editForm.reset({
      code: account.code,
      name: account.name,
      accountType: account.accountType as any,
      subType: account.subType || undefined,
      openingBalance: account.openingBalance || "0",
      openingBalanceSide:
        (account.openingBalanceSide as "Dr" | "Cr") || undefined,
      active: account.active,
    });
  };

  const filteredAccountsForEdit = accounts.filter((account) => {
    const searchLower = (editSearchTerm || "").toLowerCase();
    return (
      (account.name || "").toLowerCase().includes(searchLower) ||
      (account.code || "").toLowerCase().includes(searchLower) ||
      (account.type || "").toLowerCase().includes(searchLower)
    );
  });

  const onBankSubmit = (data: any) => {
    if (bankToEdit) {
      updateBankMutation.mutate(data);
    } else {
      createBankMutation.mutate(data);
    }
  };

  const handleSelectBankForEdit = (bank: BankAccount) => {
    setBankToEdit(bank);
    bankForm.reset({
      code: bank.code,
      name: bank.name,
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      routingCode: bank.routingCode || "",
      openingBalance: bank.openingBalance || "0",
      openingBalanceSide: (bank.openingBalanceSide as "Dr" | "Cr") || "Dr",
      active: bank.active,
    });
  };

  const handleDeleteBankAccount = () => {
    if (!bankToEdit) return;
    setPendingDelete(() => () => deleteBankMutation.mutate(bankToEdit.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <PageHeader title="Accounts Overview" subtitle="View all accounts, balances, and transaction history" />
        </div>
        <Button
          data-testid="button-create-account"
          disabled={!selectedCompany}
          onClick={() => navigate(appMode === "factory" ? "/factory/create" : appMode === "properties" ? "/properties/create" : "/create")}
        >
          <Plus className="w-4 h-4 mr-2" />
          Create
        </Button>
      </div>

      {/* Bank Account Edit Dialog */}
      <Dialog
        open={!!bankToEdit}
        onOpenChange={(open) => {
          if (!open) {
            setBankToEdit(null);
            bankForm.reset();
          }
        }}
      >
        <DialogContent className="max-w-md w-[95vw] sm:w-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {bankToEdit ? "Edit Bank Account" : "Create Bank Account"}
            </DialogTitle>
            <DialogDescription>
              {bankToEdit
                ? "Update bank account details"
                : "Add a new bank account"}
            </DialogDescription>
          </DialogHeader>
          <Form {...bankForm}>
            <form
              onSubmit={bankForm.handleSubmit(onBankSubmit)}
              className="space-y-4"
             noValidate>
              <FormField
                control={bankForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Code</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="BANK001"
                        {...field}
                        data-testid="input-bank-code"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={bankForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Main Account"
                        {...field}
                        data-testid="input-bank-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={bankForm.control}
                name="bankName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ABC Bank"
                        {...field}
                        data-testid="input-bank-bankname"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={bankForm.control}
                name="accountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Number</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="1234567890"
                        {...field}
                        data-testid="input-bank-accountnumber"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={bankForm.control}
                name="routingCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Routing Code (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ABCD0123456"
                        {...field}
                        value={field.value || ""}
                        data-testid="input-bank-routingcode"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={bankForm.control}
                  name="openingBalance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opening Balance</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          {...field}
                          value={field.value || "0"}
                          data-testid="input-bank-opening-balance"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={bankForm.control}
                  name="openingBalanceSide"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Balance Side</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-bank-balance-side">
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
              <FormField
                control={bankForm.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Active</FormLabel>
                    </div>
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-bank-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                {bankToEdit ? (
                  <div className="flex w-full gap-2 justify-between">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDeleteBankAccount}
                      disabled={deleteBankMutation.isPending}
                      data-testid="button-delete-bank"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {deleteBankMutation.isPending ? "Deleting..." : "Delete"}
                    </Button>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setBankToEdit(null);
                          bankForm.reset();
                        }}
                        data-testid="button-cancel-bank"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={updateBankMutation.isPending}
                        data-testid="button-submit-bank"
                      >
                        {updateBankMutation.isPending
                          ? "Saving..."
                          : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setBankToEdit(null)}
                      data-testid="button-cancel-bank"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createBankMutation.isPending}
                      data-testid="button-submit-bank"
                    >
                      {createBankMutation.isPending
                        ? "Creating..."
                        : "Create Account"}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="view" className="space-y-6">
        <TabsList>
          <TabsTrigger value="view" data-testid="tab-view">
            View Accounts
          </TabsTrigger>
          <TabsTrigger value="alter" data-testid="tab-alter">
            Alter Account
          </TabsTrigger>
          <TabsTrigger value="find" data-testid="tab-find-voucher">
            Find Voucher
          </TabsTrigger>
        </TabsList>

        <TabsContent value="view" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Select Account</CardTitle>
                {selectedAccount && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedAccount(null);
                      updateUrlParams({ accountId: null, accountType: null });
                    }}
                    data-testid="button-change-account"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Change
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedAccount ? (
                <div className="space-y-2">
                  <Label htmlFor="account-search">
                    Search & Select Account
                  </Label>
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="account-search"
                        placeholder="Search by name or type..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => handleListArrowScroll(e, accountListRef)}
                        className="pl-9"
                        disabled={accountsLoading || !selectedCompany}
                        data-testid="input-account-search"
                      />
                    </div>

                    {accountsLoading || !selectedCompany ? (
                      <div className="p-4">
                        <Skeleton className="h-8 w-full" />
                      </div>
                    ) : (
                      <div
                        ref={accountListRef}
                        className="max-h-64 overflow-y-auto border rounded-md"
                        onKeyDown={(e) => handleListArrowScroll(e, accountListRef)}
                      >
                        {filteredAccounts.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No accounts found
                          </div>
                        ) : (
                          filteredAccounts.map((account) => (
                            <div key={account.id}>
                              <div className="flex items-center border-b last:border-b-0">
                                {account.children.length > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleParent(account.id);
                                    }}
                                    className="p-2 hover-elevate"
                                    data-testid={`button-toggle-${account.id}`}
                                  >
                                    {expandedParents.has(account.id) ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() =>
                                    handleAccountChange(account.id)
                                  }
                                  disabled={accountsLoading || !selectedCompany}
                                  className={`flex-1 p-3 text-left hover-elevate ${account.children.length === 0 ? "ml-8" : ""}`}
                                  data-testid={`button-select-account-${account.id}`}
                                >
                                  <div className="flex items-center gap-2 w-full">
                                    <span className="text-sm flex-1">
                                      {account.name}
                                    </span>
                                    {!hideBalances && account.balance !== 0 && (
                                      <span className="ml-auto text-xs tabular-nums text-muted-foreground shrink-0">
                                        {formatAmount(Math.abs(account.balance))}{" "}
                                        <span className={drCrClass(account.balanceSide)}>
                                          {account.balanceSide ?? ""}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                </button>
                              </div>
                              {expandedParents.has(account.id) &&
                                account.children.map((child) => (
                                  <div
                                    key={child.id}
                                    className="border-b last:border-b-0"
                                  >
                                    <button
                                      onClick={() =>
                                        handleAccountChange(child.id)
                                      }
                                      disabled={
                                        accountsLoading || !selectedCompany
                                      }
                                      className="w-full p-3 pl-16 text-left hover-elevate"
                                      data-testid={`button-select-account-${child.id}`}
                                    >
                                      <div className="flex items-center gap-2 w-full">
                                        <span className="text-sm flex-1">
                                          {child.name}
                                        </span>
                                        {!hideBalances && child.balance !== 0 && (
                                          <span className="ml-auto text-xs tabular-nums text-muted-foreground shrink-0">
                                            {formatAmount(Math.abs(child.balance))}{" "}
                                            <span className={drCrClass(child.balanceSide)}>
                                              {child.balanceSide ?? ""}
                                            </span>
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  </div>
                                ))}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Account Name
                        </p>
                        <span
                          className="font-medium"
                          data-testid="text-account-name"
                        >
                          {selectedAccount.name}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Current Balance
                        </p>
                        {(() => {
                          // Broker account: show per-currency breakdown from broker statement
                          if (isBrokerSupplier && brokerStatementData?.currencyLedgers?.length > 0) {
                            return (
                              <div className="flex flex-col gap-0.5" data-testid="text-account-balance">
                                {brokerStatementData.currencyLedgers.map((section: any) => {
                                  const net = parseFloat(section.netBalance || "0");
                                  const side = net > 0 ? "CR" : net < 0 ? "DR" : "";
                                  const isNeg = net > 0;
                                  const fmt2 = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                  return (
                                    <div key={section.currencyCode} className="flex items-center gap-1.5">
                                      {isNeg ? (
                                        <TrendingDown className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                      ) : (
                                        <TrendingUp className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                      )}
                                      <span className="font-mono font-semibold text-sm">
                                        {section.currencyCode} {fmt2(net)} {side}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }

                          // Ledger account with multi-currency data
                          if (isLedgerAccount && ledgerCurrencyBalances && ledgerCurrencyBalances.length > 0) {
                            const openingBalance = parseFloat(String(selectedAccount?.openingBalance ?? "0")) || 0;
                            const openingSide = selectedAccount?.openingBalanceSide ?? "Dr";
                            const signedOb = openingSide === "Dr" ? openingBalance : -openingBalance;
                            const baseCurr = "USD";

                            const rows = ledgerCurrencyBalances.map((row) => {
                              let net = row.totalDebit - row.totalCredit;
                              if (row.currency === baseCurr) net += signedOb;
                              return { currency: row.currency, net };
                            });

                            // If opening balance is in USD but there's no USD transaction row, add it
                            if (signedOb !== 0 && !rows.find((r) => r.currency === baseCurr)) {
                              rows.push({ currency: baseCurr, net: signedOb });
                            }

                            const nonZeroRows = rows.filter((r) => Math.abs(r.net) >= 0.005);

                            if (nonZeroRows.length <= 1) {
                              // Single currency — fall through to default display
                            } else {
                              return (
                                <div className="flex flex-col gap-0.5" data-testid="text-account-balance">
                                  {nonZeroRows.map((row) => {
                                    const side = row.net >= 0 ? "Dr" : "Cr";
                                    const isNeg = row.net < 0;
                                    const fmt2 = (n: number) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                    return (
                                      <div key={row.currency} className="flex items-center gap-1.5">
                                        {isNeg ? (
                                          <TrendingDown className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                        ) : (
                                          <TrendingUp className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                        )}
                                        <span className="font-mono font-semibold text-sm">
                                          {row.currency} {fmt2(row.net)} {side}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            }
                          }

                          // Default: single balance display — always the real
                          // account balance, independent of any period filter.
                          const bal = selectedAccount?.balance ?? 0;
                          const side = selectedAccount?.balanceSide ?? "Dr";
                          const isNegative = side === "Cr";
                          return (
                            <div className="flex items-center gap-2">
                              {isNegative ? (
                                <TrendingDown className="w-4 h-4 text-red-600" />
                              ) : (
                                <TrendingUp className="w-4 h-4 text-green-600" />
                              )}
                              <span
                                className="font-mono font-semibold"
                                data-testid="text-account-balance"
                              >
                                {formatAmount(Math.abs(bal))} {side}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="md:col-span-2 flex justify-end gap-2 flex-wrap">
                        {/* WhatsApp buttons — factory/ERP mode + ledger accounts only */}
                        {(appMode === "factory" || appMode === "erp") && selectedAccount?.type === "ledger" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => sendWaStatementMutation.mutate()}
                              disabled={sendWaStatementMutation.isPending || !waRule?.enabled || !waRule?.whatsappChatId}
                              title={!waRule?.enabled || !waRule?.whatsappChatId ? "Configure WhatsApp first" : "Send statement to WhatsApp now"}
                              data-testid="button-send-whatsapp-statement"
                            >
                              {sendWaStatementMutation.isPending
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                : <Send className="w-4 h-4 mr-2" />}
                              Send to WhatsApp
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={openWaRuleDialog}
                              data-testid="button-whatsapp-settings"
                            >
                              <MessageCircle className="w-4 h-4 mr-2" />
                              WhatsApp
                              {waRule?.enabled && waRule?.whatsappChatId && (
                                <CheckCircle2 className="w-3.5 h-3.5 ml-1.5 text-green-600" />
                              )}
                            </Button>
                          </>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={transactionsLoading || vouchersWithBalance.length === 0}
                              data-testid="button-export-dropdown"
                            >
                              <FileDown className="w-4 h-4 mr-2" />
                              Export
                              <ChevronDown className="w-3 h-3 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">Language</DropdownMenuLabel>
                            {(["en", "fr", "ar"] as const).map((lang) => (
                              <DropdownMenuItem
                                key={lang}
                                onClick={() => setExportLang(lang)}
                                className="flex items-center justify-between"
                                data-testid={`button-lang-${lang}`}
                              >
                                <span>{exportLabels[lang].language}</span>
                                {exportLang === lang && <span className="text-xs text-primary">✓</span>}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleExportStatementToExcel()}
                              data-testid="button-export-excel"
                            >
                              <FileDown className="w-4 h-4 mr-2" />
                              Excel
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleExportStatementToPDF()}
                              disabled={isFactorySupplierAccount}
                              data-testid="button-export-pdf"
                            >
                              <FileDown className="w-4 h-4 mr-2" />
                              PDF
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>

          {selectedAccount && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Statement Period
                    </CardTitle>
                    <PeriodFilter
                      value={periodFilter}
                      onChange={handlePeriodFilterChange}
                      data-testid="period-filter"
                    />
                  </div>
                </CardHeader>
              </Card>

              {isFactorySupplierAccount ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      {isBrokerSupplier ? "Broker Consolidated Statement" : "Factory Supplier"}: {selectedAccount?.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {factoryStatementLoading || (isBrokerSupplier && brokerStatementLoading) ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-10 w-full" />
                        ))}
                      </div>
                    ) : isBrokerSupplier && brokerStatementData ? (
                      /* ── BROKER: show consolidated currency ledgers (same as Suppliers page) ── */
                      <div className="space-y-6">
                        {brokerStatementData.currencyLedgers?.length > 0 ? (
                          brokerStatementData.currencyLedgers.map((section: any) => {
                            const typeLabel: Record<string, string> = {
                              container: "Container", payment: "Payment",
                              fx_out: "FX Out", fx_in: "FX In", commission: "Commission",
                            };
                            const typeColor = (t: string) => {
                              if (t === "payment") return "text-green-600 dark:text-green-400";
                              if (t === "fx_out") return "text-amber-600 dark:text-amber-400";
                              if (t === "fx_in") return "text-blue-600 dark:text-blue-400";
                              if (t === "commission") return "text-destructive";
                              return "";
                            };
                            const fmt = (v: string | number) =>
                              parseFloat(String(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const ccPfx = (cc: string) => cc !== "USD" ? `${cc} ` : "$";
                            return (
                              <div key={section.currencyCode} className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className="text-sm px-3 py-1 font-bold">
                                    {section.currencyCode}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {section.totalContainers} container{section.totalContainers !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <div className="overflow-x-auto rounded-md border">
                                  <Table>
                                    <TableHeader>
                                      <TableRow className="bg-muted/50">
                                        <TableHead className="text-xs h-8">Date</TableHead>
                                        <TableHead className="text-xs h-8">Type</TableHead>
                                        <TableHead className="text-xs h-8">Description</TableHead>
                                        <TableHead className="text-xs h-8 text-right">Amount ({section.currencyCode})</TableHead>
                                        <TableHead className="text-xs h-8 text-right">Commission</TableHead>
                                        <TableHead className="text-xs h-8 text-right">Balance</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {section.rows.map((row: any, idx: number) => (
                                        <TableRow key={`${row.ref}-${idx}`} className="text-xs">
                                          <TableCell className="py-1.5 whitespace-nowrap text-muted-foreground">
                                            {row.date ? formatDisplayDate(new Date(row.date)) : "—"}
                                          </TableCell>
                                          <TableCell className="py-1.5">
                                            <Badge variant={row.type === "payment" ? "secondary" : row.type === "commission" ? "destructive" : "outline"} className="text-xs py-0 font-normal">
                                              {typeLabel[row.type] || row.type}
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="py-1.5 max-w-[220px] truncate font-medium">
                                            {row.description}
                                          </TableCell>
                                          <TableCell className={`py-1.5 text-right tabular-nums font-medium ${typeColor(row.type)}`}>
                                            {row.amount < 0 ? "−" : ""}{ccPfx(section.currencyCode)}{fmt(Math.abs(row.amount))}
                                          </TableCell>
                                          <TableCell className="py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                                            {row.commissionAmount != null && row.commissionAmount > 0
                                              ? `${row.commissionCurrency || section.currencyCode} ${fmt(row.commissionAmount)}`
                                              : "—"}
                                          </TableCell>
                                          <TableCell className={`py-1.5 text-right tabular-nums font-medium text-xs ${row.runningBalance > 0 ? "text-red-600 dark:text-red-400" : row.runningBalance < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                            {ccPfx(section.currencyCode)}{fmt(Math.abs(row.runningBalance))}
                                            <span className="ml-1 opacity-70">{row.runningBalance > 0 ? "CR" : row.runningBalance < 0 ? "DR" : ""}</span>
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                                <div className="flex justify-end">
                                  <div className="text-xs space-y-0.5 text-right min-w-56 pr-1">
                                    <div className="flex justify-between gap-6 text-muted-foreground">
                                      <span>Gross Value</span>
                                      <span className="tabular-nums font-medium text-foreground">{ccPfx(section.currencyCode)}{fmt(section.totalValue)}</span>
                                    </div>
                                    {parseFloat(section.totalCommission) > 0 && (
                                      <div className="flex justify-between gap-6 text-muted-foreground">
                                        <span>Commission</span>
                                        <span className="tabular-nums text-destructive">{ccPfx(section.currencyCode)}{fmt(section.totalCommission)}</span>
                                      </div>
                                    )}
                                    {parseFloat(section.totalOtherCharges || "0") > 0 && (
                                      <div className="flex justify-between gap-6 text-muted-foreground">
                                        <span>Other Charges</span>
                                        <span className="tabular-nums text-purple-600 dark:text-purple-400">{ccPfx(section.currencyCode)}{fmt(section.totalOtherCharges)}</span>
                                      </div>
                                    )}
                                    {parseFloat(section.totalFreight || "0") > 0 && (
                                      <div className="flex justify-between gap-6 text-muted-foreground">
                                        <span>Freight</span>
                                        <span className="tabular-nums text-orange-600 dark:text-orange-400">{ccPfx(section.currencyCode)}{fmt(section.totalFreight)}</span>
                                      </div>
                                    )}
                                    {parseFloat(section.totalPaid) > 0 && (
                                      <div className="flex justify-between gap-6 text-muted-foreground">
                                        <span>Paid</span>
                                        <span className="tabular-nums text-green-600 dark:text-green-400">− {ccPfx(section.currencyCode)}{fmt(section.totalPaid)}</span>
                                      </div>
                                    )}
                                    {parseFloat(section.totalFxOut) > 0 && (
                                      <div className="flex justify-between gap-6 text-muted-foreground">
                                        <span>FX Out</span>
                                        <span className="tabular-nums text-amber-600 dark:text-amber-400">− {ccPfx(section.currencyCode)}{fmt(section.totalFxOut)}</span>
                                      </div>
                                    )}
                                    {parseFloat(section.totalFxIn) > 0 && (
                                      <div className="flex justify-between gap-6 text-muted-foreground">
                                        <span>FX In</span>
                                        <span className="tabular-nums text-blue-600 dark:text-blue-400">+ {ccPfx(section.currencyCode)}{fmt(section.totalFxIn)}</span>
                                      </div>
                                    )}
                                    <div className="flex justify-between gap-6 border-t pt-1">
                                      <span className="font-semibold">Net Balance</span>
                                      <span className={`tabular-nums font-bold ${parseFloat(section.netBalance) > 0 ? "text-red-600 dark:text-red-400" : parseFloat(section.netBalance) < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                        {ccPfx(section.currencyCode)}{fmt(Math.abs(parseFloat(section.netBalance)))}
                                        <span className="ml-1 font-normal opacity-80">{parseFloat(section.netBalance) > 0 ? "CR" : parseFloat(section.netBalance) < 0 ? "DR" : ""}</span>
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">No broker activity found.</p>
                        )}
                      </div>
                    ) : factorySupplierStatement ? (
                      /* ── REGULAR SUPPLIER: show summary + transaction ledger ── */
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="p-3 rounded-md bg-muted/50">
                            <div className="text-xs text-muted-foreground">Containers</div>
                            <div className="text-lg font-bold">{factorySupplierStatement.summary?.totalContainers || 0}</div>
                          </div>
                          <div className="p-3 rounded-md bg-muted/50">
                            <div className="text-xs text-muted-foreground">Total Value</div>
                            <div className="text-lg font-bold tabular-nums">${parseFloat(factorySupplierStatement.summary?.totalValue || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          </div>
                          <div className="p-3 rounded-md bg-muted/50">
                            <div className="text-xs text-muted-foreground">Total Paid</div>
                            <div className="text-lg font-bold tabular-nums">${parseFloat(factorySupplierStatement.summary?.totalPayments || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          </div>
                          <div className="p-3 rounded-md bg-muted/50">
                            <div className="text-xs text-muted-foreground">Net Payable</div>
                            <div className="text-lg font-bold tabular-nums text-primary">${parseFloat(factorySupplierStatement.summary?.netPayable || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                          </div>
                        </div>
                        {(() => {
                          const allLedgerEntries = factorySupplierStatement.ledger || [];
                          const paymentEntries = allLedgerEntries.filter((e: any) => e.type === "payment");
                          const purchaseEntries = allLedgerEntries.filter((e: any) => e.type === "purchase");
                          const allEntries = [...purchaseEntries, ...paymentEntries].sort((a: any, b: any) => {
                            const da = a.date ? new Date(a.date).getTime() : 0;
                            const db2 = b.date ? new Date(b.date).getTime() : 0;
                            return da - db2;
                          });
                          if (allEntries.length === 0) {
                            return <p className="text-sm text-muted-foreground text-center py-4">No activity recorded yet</p>;
                          }
                          let runBal = 0;
                          const rowsWithBal = allEntries.map((e: any) => {
                            const rawNum = parseFloat(String(e.amount || "0").replace(/[^0-9.]/g, "")) || 0;
                            if (e.type === "purchase") runBal += rawNum;
                            else if (e.type === "payment") runBal -= rawNum;
                            return { ...e, runBal };
                          });
                          return (
                            <div>
                              <div className="text-sm font-medium mb-2">Transaction Ledger</div>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Reference</TableHead>
                                    <TableHead className="text-right">Debit</TableHead>
                                    <TableHead className="text-right">Credit</TableHead>
                                    <TableHead className="text-right">Balance</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {rowsWithBal.slice(0, 50).map((e: any) => {
                                    const cleanAmt = String(e.amount || "0").replace(/^[-−+]/, "");
                                    return (
                                      <TableRow key={e.key}>
                                        <TableCell className="text-sm whitespace-nowrap">{e.date ? formatDisplayDate(new Date(e.date)) : "-"}</TableCell>
                                        <TableCell className="text-sm">
                                          <span className={`text-xs font-medium ${e.type === "payment" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                            {e.type === "payment" ? "Payment" : "Purchase"}
                                          </span>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">{e.ref || (e.type === "payment" ? "Payment" : e.detail) || "-"}</TableCell>
                                        <TableCell className="text-right text-sm tabular-nums text-green-600 dark:text-green-400">
                                          {e.type === "payment" ? cleanAmt : ""}
                                        </TableCell>
                                        <TableCell className="text-right text-sm tabular-nums text-red-600 dark:text-red-400">
                                          {e.type === "purchase" ? cleanAmt : ""}
                                        </TableCell>
                                        <TableCell className={`text-right text-sm tabular-nums font-medium ${e.runBal > 0 ? "text-red-600 dark:text-red-400" : e.runBal < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                                          ${Math.abs(e.runBal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{e.runBal > 0 ? " Cr" : e.runBal < 0 ? " Dr" : ""}
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Could not load statement</p>
                    )}
                  </CardContent>
                </Card>
              ) : (
              <Card>
                <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-base">
                    Ledger: {selectedAccount?.name}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedVoucherIds.size > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setShowBulkDeleteConfirm(true)}
                        data-testid="button-delete-selected"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete Selected ({selectedVoucherIds.size})
                      </Button>
                    )}
                    <Button
                      variant={showDeletedVouchers ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setShowDeletedVouchers((v) => !v)}
                      data-testid="button-toggle-deleted-vouchers"
                    >
                      <History className="h-4 w-4 mr-1" />
                      {showDeletedVouchers ? "Hide Deleted" : "Show Deleted"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {transactionsLoading ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : (
                    <>
                    <div ref={printRef} className="print-container">
                      <div className="hidden print:block print-header">
                        <div style={{ textAlign: "center", marginBottom: "16px" }}>
                          <h1 style={{ fontSize: "18px", fontWeight: 700, margin: 0, color: "#111" }}>
                            {selectedCompany?.name}
                          </h1>
                          <h2 style={{ fontSize: "14px", fontWeight: 600, margin: "4px 0 0", color: "#333" }}>
                            Account Statement: {selectedAccount?.name}
                          </h2>
                        </div>
                        <div style={{ borderTop: "1px solid #ccc", borderBottom: "1px solid #ccc", padding: "6px 0", fontSize: "11px", color: "#555" }}>
                          <div>
                            {(periodFilter.fromDate || periodFilter.toDate)
                              ? `Period: ${periodLabel}`
                              : "Period: All Transactions"}
                          </div>
                          <div>Generated: {formatDisplayDate(new Date())}</div>
                        </div>
                      </div>
                      <div className="rounded-md border overflow-x-auto print:border-0 hidden md:block print:!block">
                        <Table>
                          <TableHeader className="sticky top-0 z-30 bg-background">
                            <TableRow className="bg-muted/30">
                              <TableHead className="w-[40px] py-2 print:hidden">
                                <Checkbox
                                  checked={
                                    vouchersWithBalance.length > 0 &&
                                    selectedVoucherIds.size ===
                                      vouchersWithBalance.length
                                  }
                                  onCheckedChange={toggleSelectAll}
                                  data-testid="checkbox-select-all"
                                />
                              </TableHead>
                              <TableHead className="col-date w-[100px] py-2 sticky left-0 bg-muted z-10">
                                Date
                              </TableHead>
                              <TableHead className="col-type w-[100px] py-2">
                                Type
                              </TableHead>
                              <TableHead className="col-particulars py-2">
                                Particulars
                              </TableHead>
                              {appMode === "factory" && (
                                <TableHead className="py-2">
                                  Notes
                                </TableHead>
                              )}
                              {!hideBalances && <TableHead className="col-amount text-right w-[120px] py-2">
                                Debit
                              </TableHead>}
                              {!hideBalances && <TableHead className="col-amount text-right w-[120px] py-2">
                                Credit
                              </TableHead>}
                              {!hideBalances && <TableHead className="col-balance text-right w-[130px] py-2">
                                Balance
                              </TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {/* Opening Balance Row */}
                            <TableRow
                              className="bg-accent/30 border-b-2"
                              data-testid="row-opening-balance"
                            >
                              <TableCell className="py-2 print:hidden"></TableCell>
                              <TableCell
                                className="font-mono text-sm py-2"
                                colSpan={appMode === "factory" ? 4 : 3}
                              >
                                <span className="font-semibold">
                                  Opening Balance
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono py-2">
                                {selectedAccount?.type === "supplier"
                                  ? openingBalance < 0
                                    ? formatAmount(Math.abs(openingBalance))
                                    : "-"
                                  : openingBalance > 0
                                    ? formatAmount(openingBalance)
                                    : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono py-2">
                                {selectedAccount?.type === "supplier"
                                  ? openingBalance > 0
                                    ? formatAmount(openingBalance)
                                    : "-"
                                  : openingBalance < 0
                                    ? formatAmount(Math.abs(openingBalance))
                                    : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold py-2">
                                {formatAmount(Math.abs(openingBalance))}{" "}
                                {selectedAccount?.type === "supplier"
                                  ? openingBalance > 0
                                    ? "Cr"
                                    : "Dr"
                                  : openingBalance >= 0
                                    ? "Dr"
                                    : "Cr"}
                              </TableCell>
                            </TableRow>

                            {/* Voucher Rows */}
                            {vouchersWithBalance.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={appMode === "factory" ? 8 : 7}
                                  className="text-center py-8 text-muted-foreground"
                                >
                                  <Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                  <p>No transactions found for this account</p>
                                  {(periodFilter.fromDate || periodFilter.toDate) && (
                                    <p className="text-sm mt-1">
                                      Try adjusting the date range
                                    </p>
                                  )}
                                </TableCell>
                              </TableRow>
                            ) : (
                              vouchersWithBalance.map((voucher) => (
                                <TableRow
                                  key={voucher.voucherId}
                                  className="hover-elevate"
                                  data-testid={`row-voucher-${voucher.voucherId}`}
                                >
                                  <TableCell className="py-2 print:hidden">
                                    <Checkbox
                                      checked={selectedVoucherIds.has(
                                        voucher.voucherId,
                                      )}
                                      onCheckedChange={() =>
                                        toggleVoucherSelection(
                                          voucher.voucherId,
                                        )
                                      }
                                      data-testid={`checkbox-voucher-${voucher.voucherId}`}
                                    />
                                  </TableCell>
                                  <TableCell className="font-mono text-sm py-2 sticky left-0 bg-background z-10">
                                    {voucher.voucherDate
                                      ? formatDisplayDate(
                                          new Date(voucher.voucherDate),
                                        )
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="py-2">
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {voucher.voucherType}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="py-2">
                                    {appMode === "factory" ? (
                                      <span className="text-sm">
                                        {selectedAccount?.name ?? "-"}
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() =>
                                          handleVoucherClick(voucher)
                                        }
                                        className="flex items-center gap-1 text-primary hover:underline cursor-pointer text-sm text-left"
                                        data-testid={`link-voucher-${voucher.voucherId}`}
                                      >
                                        <span className="truncate max-w-[280px]" dir="ltr">
                                          {voucher.narration || voucher.voucherNumber}
                                        </span>
                                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                      </button>
                                    )}
                                  </TableCell>
                                  {appMode === "factory" && (
                                    <TableCell className="py-2">
                                      <button
                                        onClick={() => handleVoucherClick(voucher)}
                                        className="flex items-center gap-1 text-primary hover:underline cursor-pointer text-sm text-left"
                                        data-testid={`link-voucher-${voucher.voucherId}`}
                                      >
                                        <span className="truncate max-w-[280px]" dir="ltr">
                                          {voucher.voucherDescription || voucher.narration || "-"}
                                        </span>
                                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                      </button>
                                    </TableCell>
                                  )}
                                  {!hideBalances && <TableCell className="text-right font-mono py-2">
                                    {voucher.totalDebit > 0
                                      ? voucher.currency && voucher.currency !== "USD"
                                        ? `${voucher.currency} ${voucher.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : formatAmount(voucher.totalDebit)
                                      : "-"}
                                  </TableCell>}
                                  {!hideBalances && <TableCell className="text-right font-mono py-2">
                                    {voucher.totalCredit > 0
                                      ? voucher.currency && voucher.currency !== "USD"
                                        ? `${voucher.currency} ${voucher.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        : formatAmount(voucher.totalCredit)
                                      : "-"}
                                  </TableCell>}
                                  {!hideBalances && <TableCell className="text-right font-mono font-medium py-2">
                                    {(() => {
                                      const rb = voucher.runningBalance ?? 0;
                                      const rbCurr = voucher.runningBalanceCurrency;
                                      const sideText = selectedAccount?.type === "supplier"
                                        ? rb > 0 ? "Cr" : "Dr"
                                        : rb >= 0 ? "Dr" : "Cr";
                                      if (rbCurr) {
                                        return `${rbCurr} ${Math.abs(rb).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sideText}`;
                                      }
                                      return `${formatAmount(Math.abs(rb))} ${sideText}`;
                                    })()}
                                  </TableCell>}
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Mobile Card View for Ledger */}
                      <div className="md:hidden print:!hidden space-y-2">
                        <Card className="bg-accent/30">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm">Opening Balance</span>
                              <span className="font-mono text-sm font-semibold">
                                {formatAmount(Math.abs(openingBalance))}{" "}
                                {selectedAccount?.type === "supplier"
                                  ? openingBalance > 0 ? "Cr" : "Dr"
                                  : openingBalance >= 0 ? "Dr" : "Cr"}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                        {vouchersWithBalance.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground">
                            <Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
                            <p>No transactions found for this account</p>
                          </div>
                        ) : (
                          vouchersWithBalance.map((voucher) => (
                            <Card
                              key={voucher.voucherId}
                              className="hover-elevate"
                              data-testid={`row-voucher-${voucher.voucherId}`}
                            >
                              <CardContent className="p-3 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Checkbox
                                      checked={selectedVoucherIds.has(voucher.voucherId)}
                                      onCheckedChange={() => toggleVoucherSelection(voucher.voucherId)}
                                      data-testid={`checkbox-voucher-${voucher.voucherId}`}
                                    />
                                    <div className="min-w-0">
                                      {appMode === "factory" ? (
                                        <div className="space-y-0.5">
                                          <span className="text-sm font-medium block truncate">
                                            {selectedAccount?.name ?? "-"}
                                          </span>
                                          <button
                                            onClick={() => handleVoucherClick(voucher)}
                                            className="flex items-center gap-1 text-primary hover:underline cursor-pointer text-xs text-left"
                                            data-testid={`link-voucher-${voucher.voucherId}`}
                                          >
                                            <span className="truncate text-muted-foreground" dir="ltr">
                                              {voucher.voucherDescription || voucher.narration || "-"}
                                            </span>
                                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => handleVoucherClick(voucher)}
                                          className="flex items-center gap-1 text-primary hover:underline cursor-pointer text-sm text-left"
                                          data-testid={`link-voucher-${voucher.voucherId}`}
                                        >
                                          <span className="truncate" dir="ltr">
                                            {voucher.narration || voucher.voucherNumber}
                                          </span>
                                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-xs flex-shrink-0">
                                    {voucher.voucherType}
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span className="font-mono">
                                    {voucher.voucherDate ? formatDisplayDate(new Date(voucher.voucherDate)) : "-"}
                                  </span>
                                </div>
                                {!hideBalances && <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t">
                                  <div>
                                    <span className="text-muted-foreground block">Debit</span>
                                    <span className="font-mono">
                                      {voucher.totalDebit > 0
                                        ? voucher.currency && voucher.currency !== "USD"
                                          ? `${voucher.currency} ${voucher.totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                          : formatAmount(voucher.totalDebit)
                                        : "-"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground block">Credit</span>
                                    <span className="font-mono">
                                      {voucher.totalCredit > 0
                                        ? voucher.currency && voucher.currency !== "USD"
                                          ? `${voucher.currency} ${voucher.totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                          : formatAmount(voucher.totalCredit)
                                        : "-"}
                                    </span>
                                  </div>
                                  <div className="text-right">
                                    <span className="text-muted-foreground block">Balance</span>
                                    <span className="font-mono font-medium">
                                      {(() => {
                                        const rb = voucher.runningBalance ?? 0;
                                        const rbCurr = voucher.runningBalanceCurrency;
                                        const sideText = selectedAccount?.type === "supplier"
                                          ? rb > 0 ? "Cr" : "Dr"
                                          : rb >= 0 ? "Dr" : "Cr";
                                        if (rbCurr) {
                                          return `${rbCurr} ${Math.abs(rb).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sideText}`;
                                        }
                                        return `${formatAmount(Math.abs(rb))} ${sideText}`;
                                      })()}
                                    </span>
                                  </div>
                                </div>}
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>

                      {/* Tally-style Footer Summary */}
                      <div className="mt-4 border rounded-md overflow-hidden hidden md:block print:!block">
                        <Table>
                          <TableBody>
                            <TableRow className="bg-muted/30">
                              <TableCell
                                colSpan={appMode === "factory" ? 4 : 3}
                                className="text-right font-medium py-2"
                              >
                                Opening Balance:
                              </TableCell>
                              <TableCell className="text-right font-mono w-[120px] py-2">
                                {selectedAccount?.type === "supplier"
                                  ? openingBalance < 0
                                    ? formatAmount(Math.abs(openingBalance))
                                    : "-"
                                  : openingBalance > 0
                                    ? formatAmount(openingBalance)
                                    : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono w-[120px] py-2">
                                {selectedAccount?.type === "supplier"
                                  ? openingBalance > 0
                                    ? formatAmount(openingBalance)
                                    : "-"
                                  : openingBalance < 0
                                    ? formatAmount(Math.abs(openingBalance))
                                    : "-"}
                              </TableCell>
                              <TableCell className="w-[130px] py-2"></TableCell>
                            </TableRow>
                            <TableRow className="row-totals">
                              <TableCell
                                colSpan={appMode === "factory" ? 4 : 3}
                                className="text-right font-medium py-2"
                              >
                                Current Total:
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold w-[120px] py-2">
                                {formatAmount(transactionTotals.totalDebit)}
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold w-[120px] py-2">
                                {formatAmount(transactionTotals.totalCredit)}
                              </TableCell>
                              <TableCell className="w-[130px] py-2"></TableCell>
                            </TableRow>
                            <TableRow className="bg-accent/50 border-t-2">
                              <TableCell
                                colSpan={appMode === "factory" ? 4 : 3}
                                className="text-right font-bold py-2"
                              >
                                Current Balance:
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold w-[120px] py-2">
                                {selectedAccount?.type === "supplier"
                                  ? actualBalance < 0
                                    ? formatAmount(Math.abs(actualBalance))
                                    : "-"
                                  : actualBalance > 0
                                    ? formatAmount(actualBalance)
                                    : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold w-[120px] py-2">
                                {selectedAccount?.type === "supplier"
                                  ? actualBalance > 0
                                    ? formatAmount(actualBalance)
                                    : "-"
                                  : actualBalance < 0
                                    ? formatAmount(Math.abs(actualBalance))
                                    : "-"}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold w-[130px] py-2">
                                {formatAmount(Math.abs(actualBalance))}{" "}
                                {selectedAccount?.type === "supplier"
                                  ? actualBalance > 0
                                    ? "Cr"
                                    : "Dr"
                                  : actualBalance >= 0
                                    ? "Dr"
                                    : "Cr"}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                      {/* Mobile Footer Summary */}
                      <div className="mt-4 border rounded-md md:hidden print:!hidden">
                        <div className="p-3 space-y-2 text-sm">
                          <div className="flex justify-between bg-muted/30 p-2 rounded">
                            <span className="font-medium">Opening Balance:</span>
                            <span className="font-mono">
                              {formatAmount(Math.abs(openingBalance))}{" "}
                              {selectedAccount?.type === "supplier"
                                ? openingBalance > 0 ? "Cr" : "Dr"
                                : openingBalance >= 0 ? "Dr" : "Cr"}
                            </span>
                          </div>
                          <div className="flex justify-between p-2">
                            <span className="font-medium">Total Debit:</span>
                            <span className="font-mono font-semibold">{formatAmount(transactionTotals.totalDebit)}</span>
                          </div>
                          <div className="flex justify-between p-2">
                            <span className="font-medium">Total Credit:</span>
                            <span className="font-mono font-semibold">{formatAmount(transactionTotals.totalCredit)}</span>
                          </div>
                          <div className="flex justify-between bg-accent/50 p-2 rounded border-t-2">
                            <span className="font-bold">Current Balance:</span>
                            <span className="font-mono font-bold">
                              {formatAmount(Math.abs(actualBalance))}{" "}
                              {selectedAccount?.type === "supplier"
                                ? actualBalance > 0 ? "Cr" : "Dr"
                                : actualBalance >= 0 ? "Dr" : "Cr"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Deleted vouchers section */}
                    {showDeletedVouchers && (
                      <div className="mt-6 print:hidden">
                        <div className="flex items-center gap-2 mb-3">
                          <History className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                            Deleted Vouchers
                          </span>
                          {deletedVouchers.length > 0 && (
                            <Badge variant="secondary" className="text-xs">
                              {deletedVouchers.length}
                            </Badge>
                          )}
                        </div>
                        {deletedVouchersLoading ? (
                          <div className="space-y-2">
                            {[1, 2, 3].map((i) => (
                              <Skeleton key={i} className="h-10 w-full" />
                            ))}
                          </div>
                        ) : deletedVouchers.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-4 text-center">
                            No deleted vouchers found for this account.
                          </p>
                        ) : (
                          <div className="rounded-md border overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/30">
                                  <TableHead className="py-2">Date</TableHead>
                                  <TableHead className="py-2">Voucher #</TableHead>
                                  <TableHead className="py-2">Type</TableHead>
                                  <TableHead className="py-2">Amount</TableHead>
                                  <TableHead className="py-2">Deleted</TableHead>
                                  <TableHead className="py-2 w-[100px]"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {deletedVouchers.map((v: any) => (
                                  <TableRow key={v.id} className="opacity-70">
                                    <TableCell className="py-2 font-mono text-sm">
                                      {v.voucherDate ? formatDisplayDate(new Date(v.voucherDate)) : "-"}
                                    </TableCell>
                                    <TableCell className="py-2 text-sm">{v.voucherNumber || "-"}</TableCell>
                                    <TableCell className="py-2">
                                      <Badge variant="outline" className="text-xs">{v.voucherType || "-"}</Badge>
                                    </TableCell>
                                    <TableCell className="py-2 font-mono text-sm">
                                      {v.totalAmount != null ? formatAmount(Number(v.totalAmount)) : "-"}
                                    </TableCell>
                                    <TableCell className="py-2 text-xs text-muted-foreground">
                                      {v.deletedAt ? formatDisplayDate(new Date(v.deletedAt)) : "-"}
                                    </TableCell>
                                    <TableCell className="py-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => restoreVoucherMutation.mutate(v.id)}
                                        disabled={restoreVoucherMutation.isPending}
                                        data-testid={`button-restore-voucher-${v.id}`}
                                      >
                                        <RotateCcw className="h-3 w-3 mr-1" />
                                        Restore
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    )}
                    </>
                  )}
                </CardContent>
              </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="alter" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Alter Account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-account-search">
                  Search & Select Account to Edit
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="edit-account-search"
                    placeholder="Search by name or type..."
                    value={editSearchTerm}
                    onChange={(e) => setEditSearchTerm(e.target.value)}
                    onKeyDown={(e) => handleListArrowScroll(e, editAccountListRef)}
                    className="pl-9"
                    disabled={
                      accountsLoading ||
                      ledgerAccountsLoading ||
                      !selectedCompany
                    }
                    data-testid="input-edit-account-search"
                  />
                </div>

                {accountsLoading ||
                ledgerAccountsLoading ||
                !selectedCompany ? (
                  <div className="p-4">
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  <div
                    ref={editAccountListRef}
                    className="max-h-64 overflow-y-auto border rounded-md"
                    onKeyDown={(e) => handleListArrowScroll(e, editAccountListRef)}
                  >
                    {filteredAccountsForEdit.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        No accounts found
                      </div>
                    ) : (
                      filteredAccountsForEdit.map((account) => {
                        const isLedger = account.type === "ledger";
                        const isBank = account.type === "bank";
                        const isSupplier = account.type === "supplier";
                        const isCustomer = account.type === "customer";
                        const isEmployee = account.type === "employee";
                        const isEditable = isLedger || isBank || isSupplier || isCustomer || isEmployee;
                        const isLedgerSelected =
                          accountToEdit?.id === account.accountId && isLedger;
                        const isBankSelected =
                          bankToEdit?.id === account.accountId && isBank;
                        const isSupplierSelected =
                          supplierToEdit?.accountId === account.accountId && isSupplier;
                        const isCustomerSelected =
                          customerToEdit?.accountId === account.accountId && isCustomer;
                        const isEmployeeSelected =
                          employeeToEdit?.accountId === account.accountId && isEmployee;
                        const isSelected = isLedgerSelected || isBankSelected || isSupplierSelected || isCustomerSelected || isEmployeeSelected;

                        const isFactorySupplier = account.type === "factorySupplier";
                        const isFactoryWorker = account.type === "factoryWorker";
                        const isFixedAsset = account.type === "fixedAsset";

                        return (
                          <button
                            key={account.id}
                            type="button"
                            disabled={
                              ledgerAccountsLoading ||
                              bankAccountsLoading ||
                              !selectedCompany
                            }
                            onClick={() => {
                              if (isLedger) {
                                const ledgerAccount = ledgerAccounts.find(
                                  (la) => la.id === account.accountId,
                                );
                                if (ledgerAccount) {
                                  setBankToEdit(null);
                                  setSupplierToEdit(null);
                                  setCustomerToEdit(null);
                                  handleSelectAccountForEdit(ledgerAccount);
                                } else {
                                  toast({
                                    title: "Error",
                                    description: `Ledger account not found.`,
                                    variant: "destructive",
                                  });
                                }
                              } else if (isBank) {
                                const bankAccount = bankAccounts.find(
                                  (ba) => ba.id === account.accountId,
                                );
                                if (bankAccount) {
                                  setAccountToEdit(null);
                                  setSupplierToEdit(null);
                                  setCustomerToEdit(null);
                                  handleSelectBankForEdit(bankAccount);
                                } else {
                                  toast({
                                    title: "Error",
                                    description: `Bank account not found.`,
                                    variant: "destructive",
                                  });
                                }
                              } else if (isSupplier) {
                                setAccountToEdit(null);
                                setBankToEdit(null);
                                setCustomerToEdit(null);
                                setSupplierToEdit(account);
                                editForm.reset({
                                  code: account.code,
                                  name: account.name,
                                  openingBalance: String(account.openingBalance ?? 0),
                                  openingBalanceSide: "Cr",
                                  active: account.active,
                                });
                              } else if (isCustomer) {
                                setAccountToEdit(null);
                                setBankToEdit(null);
                                setSupplierToEdit(null);
                                setEmployeeToEdit(null);
                                setCustomerToEdit(account);
                                editForm.reset({
                                  code: account.code,
                                  name: account.name,
                                  openingBalance: String(account.openingBalance ?? 0),
                                  openingBalanceSide: account.openingBalanceSide ?? "Dr",
                                  active: account.active,
                                });
                              } else if (isEmployee) {
                                setAccountToEdit(null);
                                setBankToEdit(null);
                                setSupplierToEdit(null);
                                setCustomerToEdit(null);
                                setEmployeeToEdit(account);
                                editForm.reset({
                                  code: account.code,
                                  name: account.name,
                                  active: account.active,
                                });
                              } else {
                                toast({
                                  title: "Not Editable",
                                  description:
                                    "Only ledger, bank, supplier, customer, and employee accounts can be edited",
                                });
                              }
                            }}
                            className={`w-full p-3 text-left border-b last:border-b-0 ${
                              isSelected ? "bg-accent" : "hover-elevate"
                            } ${!isEditable ? "opacity-60" : ""}`}
                            data-testid={`button-select-account-edit-${account.id}`}
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-sm flex-1 text-left">{account.name}</span>
                              {(isFactorySupplier || isFactoryWorker || isFixedAsset) && (
                                <span
                                  role="button"
                                  className="ml-auto p-1 rounded text-muted-foreground hover:text-destructive shrink-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isFactorySupplier) {
                                      setPendingDelete(() => () => deleteFactorySupplierMutation.mutate(account.accountId as number));
                                    } else if (isFactoryWorker) {
                                      setPendingDelete(() => () => deleteWorkerMutation.mutate(account.accountId as number));
                                    } else if (isFixedAsset) {
                                      setPendingDelete(() => () => deleteFixedAssetMutation.mutate(account.accountId as number));
                                    }
                                  }}
                                  data-testid={`button-delete-account-inline-${account.accountId}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {(accountToEdit || supplierToEdit || customerToEdit || employeeToEdit) && (
                <Card className="bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      {supplierToEdit ? "Edit Supplier" : customerToEdit ? "Edit Customer" : employeeToEdit ? "Edit Employee" : "Edit Account Details"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...editForm}>
                      <form
                        onSubmit={editForm.handleSubmit(onEditSubmit)}
                        className="space-y-4"
                       noValidate>
                        <FormField
                          control={editForm.control}
                          name="code"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Code</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  readOnly
                                  className="bg-muted"
                                  data-testid="input-edit-code"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Name</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  data-testid="input-edit-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {!supplierToEdit && !customerToEdit && !employeeToEdit && (
                          <>
                            <FormField
                              control={editForm.control}
                              name="accountType"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Account Type</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid="select-edit-type">
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
                            <FormField
                              control={editForm.control}
                              name="subType"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Sub Type (Optional)</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      value={field.value || ""}
                                      placeholder="Leave blank or enter sub type"
                                      data-testid="input-edit-subtype"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </>
                        )}
                        <div className={`grid gap-4 ${supplierToEdit ? "grid-cols-1" : "grid-cols-2"}`}>
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
                                    data-testid="input-edit-balance"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {!supplierToEdit && (
                            <FormField
                              control={editForm.control}
                              name="openingBalanceSide"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Balance Side</FormLabel>
                                  <Select
                                    onValueChange={field.onChange}
                                    value={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid="select-edit-balance-side">
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
                          )}
                        </div>
                        <div className="flex gap-2 justify-between">
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDeleteAccount}
                            disabled={deleteLedgerMutation.isPending || deleteSupplierMutation.isPending || deleteCustomerMutation.isPending || deleteEmployeeMutation.isPending}
                            data-testid="button-delete-account"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {(deleteLedgerMutation.isPending || deleteSupplierMutation.isPending || deleteCustomerMutation.isPending || deleteEmployeeMutation.isPending)
                              ? "Deleting..."
                              : "Delete"}
                          </Button>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setAccountToEdit(null);
                                setSupplierToEdit(null);
                                setCustomerToEdit(null);
                                setEmployeeToEdit(null);
                                editForm.reset();
                              }}
                              data-testid="button-cancel-edit"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={updateLedgerMutation.isPending || updateSupplierMutation.isPending || updateCustomerMutation.isPending || updateEmployeeMutation.isPending}
                              data-testid="button-save-edit"
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              {(updateLedgerMutation.isPending || updateEmployeeMutation.isPending)
                                ? "Saving..."
                                : "Save Changes"}
                            </Button>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}

              {bankToEdit && (
                <Card className="bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Edit Bank Account Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...bankForm}>
                      <form
                        onSubmit={bankForm.handleSubmit(onBankSubmit)}
                        className="space-y-4"
                       noValidate>
                        <FormField
                          control={bankForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Name</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  data-testid="input-edit-bank-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={bankForm.control}
                          name="bankName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bank Name</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  data-testid="input-edit-bank-bankname"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={bankForm.control}
                          name="accountNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Account Number</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  data-testid="input-edit-bank-accountnumber"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={bankForm.control}
                          name="routingCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Routing Code (Optional)</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value={field.value || ""}
                                  data-testid="input-edit-bank-routingcode"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={bankForm.control}
                            name="openingBalance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Opening Balance</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    value={field.value || "0"}
                                    data-testid="input-edit-bank-balance"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={bankForm.control}
                            name="openingBalanceSide"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Balance Side</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  value={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger data-testid="select-edit-bank-balance-side">
                                      <SelectValue placeholder="Dr/Cr" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Dr">
                                      Dr (Debit)
                                    </SelectItem>
                                    <SelectItem value="Cr">
                                      Cr (Credit)
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="flex gap-2 justify-between">
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDeleteBankAccount}
                            disabled={deleteBankMutation.isPending}
                            data-testid="button-delete-bank-account"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {deleteBankMutation.isPending
                              ? "Deleting..."
                              : "Delete"}
                          </Button>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setBankToEdit(null);
                                bankForm.reset();
                              }}
                              data-testid="button-cancel-bank-edit"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={updateBankMutation.isPending}
                              data-testid="button-save-bank-edit"
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              {updateBankMutation.isPending
                                ? "Saving..."
                                : "Save Changes"}
                            </Button>
                          </div>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="find" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Find Voucher</CardTitle>
              <p className="text-sm text-muted-foreground">Search by voucher number, description, or amount to quickly open and edit any transaction</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search by voucher number, description, or amount (e.g. REC-001, duties, 3967)"
                  value={voucherSearchTerm}
                  onChange={(e) => setVoucherSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-voucher-search"
                />
              </div>

              {voucherSearchLoading && (
                <p className="text-sm text-muted-foreground py-4 text-center">Searching…</p>
              )}

              {!voucherSearchLoading && voucherSearchTerm.trim().length > 0 && voucherSearchResults.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">No vouchers found matching &ldquo;{voucherSearchTerm}&rdquo;</p>
              )}

              {voucherSearchResults.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs h-8">Voucher #</TableHead>
                      <TableHead className="text-xs h-8">Date</TableHead>
                      <TableHead className="text-xs h-8">Type</TableHead>
                      <TableHead className="text-xs h-8">Description</TableHead>
                      <TableHead className="text-xs h-8">Location</TableHead>
                      <TableHead className="text-xs h-8 text-right">Amount</TableHead>
                      <TableHead className="text-xs h-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {voucherSearchResults.map((v: any) => {
                      const voucherTypeMap: Record<string, string> = {
                        Payment: "payment",
                        Receipt: "receipt",
                        Journal: "journal",
                        Consumption: "adjustment",
                        Production: "adjustment",
                        Mixed: "adjustment",
                        StockTransfer: "transfer",
                        "Stock Transfer": "transfer",
                        "Credit Note": "credit-note",
                        "Debit Note": "credit-note",
                      };
                      const base = appMode === "factory" ? "/factory" : "";
                      const tabName = voucherTypeMap[v.voucherType];
                      const handleOpen = () => {
                        if (tabName) {
                          navigate(`${base}/vouchers?edit=${v.id}&tab=${tabName}`);
                        } else {
                          navigate(`${base}/vouchers/${v.id}/edit`);
                        }
                      };
                      return (
                        <TableRow
                          key={v.id}
                          className="text-xs cursor-pointer hover-elevate"
                          onClick={handleOpen}
                          data-testid={`row-voucher-${v.id}`}
                        >
                          <TableCell className="py-2 font-mono font-medium">{v.voucherNumber}</TableCell>
                          <TableCell className="py-2 text-muted-foreground whitespace-nowrap">{v.voucherDate}</TableCell>
                          <TableCell className="py-2">{v.voucherType}</TableCell>
                          <TableCell className="py-2 max-w-[200px] truncate text-muted-foreground">{v.description || "-"}</TableCell>
                          <TableCell className="py-2 text-muted-foreground">{v.locationName || "-"}</TableCell>
                          <TableCell className="py-2 text-right font-medium tabular-nums">
                            {parseFloat(v.totalAmount || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {v.currency}
                          </TableCell>
                          <TableCell className="py-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); handleOpen(); }}
                              data-testid={`button-open-voucher-${v.id}`}
                            >
                              <ArrowUpRight className="h-3 w-3 mr-1" />
                              Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Selected Vouchers</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedVoucherIds.size} selected
              voucher(s)? This will also delete all associated entries and
              reverse any inventory movements. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowBulkDeleteConfirm(false)}
              data-testid="button-cancel-bulk-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleteVouchersMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteVouchersMutation.isPending
                ? "Deleting..."
                : "Delete All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onConfirm={() => { pendingDelete?.(); setPendingDelete(null); }}
      />

      {/* ── WhatsApp Auto-Statement Settings Dialog ── */}
      <Dialog open={waRuleDialogOpen} onOpenChange={setWaRuleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              WhatsApp Statement Settings
            </DialogTitle>
            <DialogDescription>
              Automatically send a monthly PDF statement to a WhatsApp group whenever a voucher is saved for{" "}
              <span className="font-medium">{selectedAccount?.name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Enable auto-statement</Label>
              <Switch
                checked={waRuleDraft.enabled}
                onCheckedChange={(v) => setWaRuleDraft((d) => ({ ...d, enabled: v }))}
                data-testid="switch-wa-enabled"
              />
            </div>

            {/* Target chat */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Target WhatsApp group / chat</Label>
              <Input
                placeholder="Search chats..."
                value={waChatSearch}
                onChange={(e) => setWaChatSearch(e.target.value)}
                data-testid="input-wa-chat-search"
              />
              <div className="border rounded-md max-h-44 overflow-y-auto text-sm">
                {waChatsLoading && (
                  <p className="text-muted-foreground text-center py-4">Loading chats…</p>
                )}
                {!waChatsLoading && filteredWaChats.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No chats found</p>
                )}
                {filteredWaChats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => setWaRuleDraft((d) => ({ ...d, whatsappChatId: chat.id }))}
                    className={`w-full text-left px-3 py-2 hover-elevate transition-colors ${
                      waRuleDraft.whatsappChatId === chat.id
                        ? "bg-primary/10 text-primary font-medium"
                        : ""
                    }`}
                    data-testid={`option-wa-chat-${chat.id}`}
                  >
                    <div className="font-medium">{chat.name}</div>
                    <div className="text-xs text-muted-foreground">{chat.type}</div>
                  </button>
                ))}
              </div>
              {waRuleDraft.whatsappChatId && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium">{
                    waChats.find((c) => c.id === waRuleDraft.whatsappChatId)?.name ?? waRuleDraft.whatsappChatId
                  }</span>
                </p>
              )}
            </div>

            {/* Trigger toggles */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Send on voucher type</Label>
              <div className="space-y-2">
                {(
                  [
                    { key: "sendOnPayment", label: "Payment voucher" },
                    { key: "sendOnReceipt", label: "Receipt voucher" },
                    { key: "sendOnJournal", label: "Journal voucher" },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-sm text-muted-foreground">{label}</Label>
                    <Switch
                      checked={waRuleDraft[key]}
                      onCheckedChange={(v) => setWaRuleDraft((d) => ({ ...d, [key]: v }))}
                      data-testid={`switch-${key}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWaRuleDialogOpen(false)} data-testid="button-wa-cancel">
              Cancel
            </Button>
            <Button
              onClick={() => saveWaRuleMutation.mutate(waRuleDraft)}
              disabled={saveWaRuleMutation.isPending}
              data-testid="button-wa-save"
            >
              {saveWaRuleMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
              ) : "Save Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
