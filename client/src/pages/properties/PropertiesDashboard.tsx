import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/PageHeader";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  TrendingUp,
  Plus,
  X,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Check,
  ChevronsUpDown,
  Truck,
  DollarSign,
  GripVertical,
  Eye,
  EyeOff,
  RotateCcw,
  Equal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

type ProfitData = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  forUsTotal: number;
  forUsBreakdown: { name: string; value: number }[];
  onUsTotal: number;
  onUsBreakdown: { name: string; value: number }[];
  expensesTotal: number;
  expenses: {
    total: number;
    breakdown: { name: string; value: number }[];
  };
  ownersCapital: number;
  netWorth: number;
  netPosition: number;
  netPositionLabel: string;
  netPositionBreakdown: {
    assets: { total: number; breakdown: { name: string; value: number }[] };
    liabilities: { total: number; breakdown: { name: string; value: number }[] };
    expenses: { total: number; breakdown: { name: string; value: number }[] };
    netPosition: number;
  };
};

type ImportCycleBalanceData = {
  netImportCycleBalance: number;
  components: {
    supplierBalance: number;
    stockOtwValue: number;
    dutyAgentBalance: number;
    transporterAgentBalance: number;
    loansBalance: number;
    cashBalance: number;
    bankBalance: number;
    directExpenseBalance: number;
    indirectExpenseBalance: number;
    incomeBalance: number;
    stockOnFloorValue: number;
    cogsBalance: number;
    payrollExpenseBalance: number;
    salaryAdvancesBalance: number;
    payrollLiabilitiesBalance: number;
  };
};

type DashboardCashAccount = {
  id: number;
  accountType: string;
  accountId: number;
  displayOrder: number;
  account: {
    id: number;
    code: string;
    name: string;
    balance?: number;
    currentBalance?: number;
    openingBalance?: string;
    type: string;
  };
};

type Account = {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  balance: number;
};

type PayableAccount = {
  id: number;
  accountId: number;
  code: string;
  name: string;
  balance: number;
};

const PROPS_CUSTOM_NET_HIDDEN_KEY = "props_custom_net_hidden";

function loadPropsCustomViewHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(PROPS_CUSTOM_NET_HIDDEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function savePropsCustomViewHidden(keys: Set<string>) {
  localStorage.setItem(PROPS_CUSTOM_NET_HIDDEN_KEY, JSON.stringify(Array.from(keys)));
}

interface PropsCustomAccount {
  key: string;
  name: string;
  value: number;
  side: "have" | "owe" | "spent";
}

function CustomNetPositionView({ data }: { data: ProfitData }) {
  const { formatAmount } = useCurrencyContext();
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => loadPropsCustomViewHidden());

  const allAccounts = useMemo<PropsCustomAccount[]>(() => {
    const have = (data.forUsBreakdown ?? []).map((a) => ({
      key: `have:${a.name}`,
      name: a.name,
      value: a.value,
      side: "have" as const,
    }));
    const owe = (data.onUsBreakdown ?? []).map((a) => ({
      key: `owe:${a.name}`,
      name: a.name,
      value: a.value,
      side: "owe" as const,
    }));
    const spent = (data.expenses?.breakdown ?? []).map((a) => ({
      key: `spent:${a.name}`,
      name: a.name,
      value: a.value,
      side: "spent" as const,
    }));
    return [...have, ...owe, ...spent];
  }, [data.forUsBreakdown, data.onUsBreakdown, data.expenses]);

  const toggle = useCallback((key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      savePropsCustomViewHidden(next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    const empty = new Set<string>();
    setHiddenKeys(empty);
    savePropsCustomViewHidden(empty);
  }, []);

  const visibleHaveTotal = useMemo(
    () => allAccounts.filter((a) => a.side === "have" && !hiddenKeys.has(a.key)).reduce((s, a) => s + a.value, 0),
    [allAccounts, hiddenKeys]
  );
  const visibleOweTotal = useMemo(
    () => allAccounts.filter((a) => a.side === "owe" && !hiddenKeys.has(a.key)).reduce((s, a) => s + a.value, 0),
    [allAccounts, hiddenKeys]
  );
  const visibleSpentTotal = useMemo(
    () => allAccounts.filter((a) => a.side === "spent" && !hiddenKeys.has(a.key)).reduce((s, a) => s + a.value, 0),
    [allAccounts, hiddenKeys]
  );
  const customNet = visibleHaveTotal - visibleOweTotal - visibleSpentTotal;
  const netPositive = customNet >= 0;
  const hiddenCount = hiddenKeys.size;
  const visibleCount = allAccounts.filter((a) => !hiddenKeys.has(a.key)).length;

  const sideLabel = (side: PropsCustomAccount["side"]) => {
    if (side === "have") return "Have";
    if (side === "owe") return "Owe";
    return "Spent";
  };

  const sideBadgeClass = (side: PropsCustomAccount["side"]) => {
    if (side === "have") return "text-green-700 dark:text-green-400 border-green-600/30";
    if (side === "owe") return "text-red-600 dark:text-red-400 border-red-500/30";
    return "text-orange-600 dark:text-orange-400 border-orange-500/30";
  };

  const sideValueClass = (side: PropsCustomAccount["side"]) => {
    if (side === "have") return "text-green-600 dark:text-green-400";
    if (side === "owe") return "text-red-600 dark:text-red-400";
    return "text-orange-600 dark:text-orange-400";
  };

  return (
    <Card data-testid="card-props-custom-net-position">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Equal className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Custom Net Position View</CardTitle>
            <Badge variant="outline" className="text-xs">
              View only
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {hiddenCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {hiddenCount} account{hiddenCount !== 1 ? "s" : ""} hidden
              </span>
            )}
            {hiddenCount > 0 && (
              <Button variant="ghost" size="sm" onClick={resetAll} data-testid="button-props-custom-view-reset">
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Show all
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Same accounts as the Net Position breakdown above. Hide any account to adjust the subtotal shown here — the
          actual figures above are never affected.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-6 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Custom Net</p>
            <p
              className={`text-2xl font-bold font-mono ${netPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
              data-testid="text-props-custom-net-position"
            >
              {customNet < 0 ? "-" : ""}
              {formatAmount(Math.abs(customNet))}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Have</p>
            <p className="font-mono font-semibold text-green-600 dark:text-green-400">
              {formatAmount(visibleHaveTotal)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Owe</p>
            <p className="font-mono font-semibold text-red-600 dark:text-red-400">{formatAmount(visibleOweTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Spent</p>
            <p className="font-mono font-semibold text-orange-600 dark:text-orange-400">
              {formatAmount(visibleSpentTotal)}
            </p>
          </div>
          {hiddenCount > 0 && (
            <Badge variant="secondary" className="text-xs ml-auto">
              {hiddenCount} excluded
            </Badge>
          )}
        </div>

        {allAccounts.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No accounts to display.</p>
        ) : (
          <div className="divide-y divide-border">
            {allAccounts.map((acc) => {
              const hidden = hiddenKeys.has(acc.key);
              return (
                <div
                  key={acc.key}
                  className={`flex items-center gap-3 px-4 py-2.5 ${hidden ? "opacity-40" : ""}`}
                  data-testid={`row-props-custom-view-${acc.key}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-[9px] px-1 h-4 shrink-0 ${sideBadgeClass(acc.side)}`}>
                        {sideLabel(acc.side)}
                      </Badge>
                      <p className="text-sm font-medium truncate">{acc.name}</p>
                    </div>
                  </div>
                  <span className={`font-mono text-sm font-semibold shrink-0 ${sideValueClass(acc.side)}`}>
                    {formatAmount(acc.value)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggle(acc.key)}
                    data-testid={`button-props-custom-view-toggle-${acc.key}`}
                    title={hidden ? "Include in custom total" : "Exclude from custom total"}
                  >
                    {hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-border px-4 py-3 flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Custom Net Position</span>
            {hiddenCount > 0 && (
              <span className="text-xs text-muted-foreground">
                ({visibleCount} of {allAccounts.length} accounts)
              </span>
            )}
          </div>
          <span
            className={`font-mono text-base font-bold ${netPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
            data-testid="text-props-custom-net-footer"
          >
            {customNet < 0 ? "-" : ""}
            {formatAmount(Math.abs(customNet))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PropertiesDashboard() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddPayableDialogOpen, setIsAddPayableDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [selectedPayableAccountId, setSelectedPayableAccountId] = useState<number>(0);
  const [payableComboboxOpen, setPayableComboboxOpen] = useState(false);
  const [cashComboboxOpen, setCashComboboxOpen] = useState(false);

  // Fetch net profit data
  const {
    data: profitData,
    isLoading,
    isError,
  } = useQuery<ProfitData>({
    queryKey: ["/api/stats/net-profit", selectedCompany?.id],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/stats/net-profit");
      if (!response.ok) throw new Error("Failed to fetch net profit");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch import cycle balance data
  const { data: importCycleData } = useQuery<ImportCycleBalanceData>({
    queryKey: ["/api/stats/import-cycle-balance", selectedCompany?.id],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/stats/import-cycle-balance");
      if (!response.ok) throw new Error("Failed to fetch import cycle balance");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard cash accounts
  const { data: dashboardCashAccounts = [], error: cashAccountsError } = useQuery<DashboardCashAccount[]>({
    queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    staleTime: 30 * 1000,
  });

  // Fetch all accounts for selection
  const { data: allAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch all payable accounts (ledger accounts)
  const { data: allPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/accounts/all-ledger", selectedCompany?.id],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/accounts/all");
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const accounts = await response.json();
      return accounts.filter((acc: any) => acc.type && acc.type.toLowerCase() === "ledger");
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard payable accounts
  const { data: dashboardPayableAccounts = [], error: payableAccountsError } = useQuery<PayableAccount[]>({
    queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    staleTime: 30 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Add dashboard cash account mutation
  const addAccountMutation = useMutation({
    mutationFn: async (data: { accountType: string; accountId: number }) => {
      return await apiRequest("POST", "/api/dashboard-cash-accounts", data);
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id] });
      setIsAddDialogOpen(false);
      setSelectedAccountId(0);
      toast({ title: "Success", description: "Account added to dashboard" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to add account", variant: "destructive" });
    },
  });

  // Remove dashboard cash account mutation
  const removeAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/dashboard-cash-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id] });
      toast({ title: "Success", description: "Account removed from dashboard" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to remove account", variant: "destructive" });
    },
  });

  // Add dashboard payable account mutation
  const addPayableAccountMutation = useMutation({
    mutationFn: async (data: { accountId: number }) => {
      return await apiRequest("POST", "/api/dashboard-payable-accounts", data);
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id] });
      setIsAddPayableDialogOpen(false);
      setSelectedPayableAccountId(0);
      toast({ title: "Success", description: "Payable account added to dashboard" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to add payable account", variant: "destructive" });
    },
  });

  // Remove dashboard payable account mutation
  const removePayableAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/dashboard-payable-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id] });
      toast({ title: "Success", description: "Payable account removed from dashboard" });
    },
    onError: (error: any) => {
      if (error?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to remove payable account",
        variant: "destructive",
      });
    },
  });

  // Drag refs for reordering
  const dragCashRef = useRef<number | null>(null);
  const dragPayableRef = useRef<number | null>(null);

  // Reorder cash accounts mutation
  const reorderCashMutation = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await apiRequest("PATCH", "/api/dashboard-cash-accounts/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id] });
    },
  });

  // Reorder payable accounts mutation
  const reorderPayableMutation = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await apiRequest("PATCH", "/api/dashboard-payable-accounts/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id] });
    },
  });

  const displayedCashAccounts = dashboardCashAccounts;

  const handleCashDrop = (targetId: number) => {
    const fromId = dragCashRef.current;
    if (fromId === null || fromId === targetId) return;
    const ids = displayedCashAccounts.map((d) => d.id);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, fromId);
    queryClient.setQueryData(
      ["/api/dashboard-cash-accounts", selectedCompany?.id],
      (old: DashboardCashAccount[] | undefined) => {
        if (!old) return old;
        const lookup = Object.fromEntries(old.map((a) => [a.id, a]));
        return reordered.map((id) => lookup[id]).filter(Boolean);
      }
    );
    reorderCashMutation.mutate(reordered);
    dragCashRef.current = null;
  };

  const handlePayableDrop = (targetId: number) => {
    const fromId = dragPayableRef.current;
    if (fromId === null || fromId === targetId) return;
    const paIds = dashboardPayableAccounts.map((d) => d.id);
    const fromIdx = paIds.indexOf(fromId);
    const toIdx = paIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...paIds];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, fromId);
    queryClient.setQueryData(
      ["/api/dashboard-payable-accounts", selectedCompany?.id],
      (old: PayableAccount[] | undefined) => {
        if (!old) return old;
        const lookup = Object.fromEntries(old.map((a) => [a.id, a]));
        return reordered.map((id) => lookup[id]).filter(Boolean);
      }
    );
    reorderPayableMutation.mutate(reordered);
    dragPayableRef.current = null;
  };

  // Get available cash accounts (excluding ones already added)
  const availableCashAccounts = allAccounts
    .filter((acc) => {
      const alreadyAdded = dashboardCashAccounts.some(
        (dca) => dca.accountType === (acc.type || "").toLowerCase() && dca.accountId === acc.accountId
      );
      return !alreadyAdded;
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Get available payable accounts (excluding ones already added)
  const availablePayableAccounts = allPayableAccounts
    .filter((acc) => {
      const alreadyAdded = dashboardPayableAccounts.some((dpa) => dpa.accountId === acc.accountId);
      return !alreadyAdded;
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="text-destructive">Failed to load dashboard data. Please try again.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <PageHeader title="Dashboard" subtitle="Overview of your properties performance" showHomeButton={false} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <KPICard
          title="Total Income"
          value={isLoading ? "Loading..." : formatAmount(profitData?.totalIncome || 0)}
          change="From all income accounts"
          changeType="positive"
          icon={DollarSign}
          data-testid="kpi-total-income"
        />
        <KPICard
          title="Net Position"
          value={isLoading ? "Loading..." : formatAmount(profitData?.netPosition || 0)}
          change={profitData?.netPositionLabel || "What we have minus what we owe"}
          changeType={(profitData?.netPosition ?? 0) >= 0 ? "positive" : "negative"}
          icon={TrendingUp}
          data-testid="kpi-net-position"
        />
        <KPICard
          title="Import Cycle Balance"
          value={
            !importCycleData
              ? "Loading..."
              : Math.abs(importCycleData.netImportCycleBalance) < 1
                ? formatAmount(0)
                : formatAmount(importCycleData.netImportCycleBalance)
          }
          change="Should be $0 when balanced"
          changeType={Math.abs(importCycleData?.netImportCycleBalance ?? 0) < 1 ? "positive" : "negative"}
          icon={Truck}
          data-testid="kpi-import-cycle-balance"
        />
      </div>

      {/* Net Position Breakdown */}
      <Card className="p-4 sm:p-6">
        <div className="mb-4">
          <h3 className="text-lg font-medium">Net Position Breakdown</h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {/* What We Have (Assets) */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-green-600 mb-3 flex items-center gap-2">
                <ArrowDownLeft className="h-4 w-4" />
                What We Have
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.forUsBreakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono">{formatAmount(item.value)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Assets:</span>
                  <span className="font-mono text-green-600">{formatAmount(profitData?.forUsTotal ?? 0)}</span>
                </div>
              </div>
            </div>

            {/* What We Owe (Liabilities) */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-red-600 mb-3 flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4" />
                What We Owe
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.onUsBreakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono text-red-600">{formatAmount(item.value)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Liabilities:</span>
                  <span className="font-mono text-red-600">{formatAmount(profitData?.onUsTotal ?? 0)}</span>
                </div>
              </div>
            </div>

            {/* What We Spent (Expenses) */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-orange-600 mb-3 flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                What We Spent
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.expenses?.breakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono text-orange-600">{formatAmount(item.value)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Expenses:</span>
                  <span className="font-mono text-orange-600">{formatAmount(profitData?.expensesTotal ?? 0)}</span>
                </div>
              </div>
            </div>

            {/* Net Position Calculation */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <h4 className="font-medium mb-3">Net Position</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assets:</span>
                  <span className="font-mono text-green-600">{formatAmount(profitData?.forUsTotal ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">- Liabilities:</span>
                  <span className="font-mono text-red-600">{formatAmount(profitData?.onUsTotal ?? 0)}</span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between font-medium text-lg">
                  <span>=</span>
                  <span
                    className={cn("font-mono", (profitData?.netPosition ?? 0) >= 0 ? "text-green-600" : "text-red-600")}
                  >
                    {formatAmount(profitData?.netPosition ?? 0)}
                  </span>
                </div>
                <div className="text-center mt-2">
                  <span
                    className={cn(
                      "text-xs font-medium px-2 py-1 rounded-full",
                      (profitData?.netPosition ?? 0) >= 0
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    )}
                  >
                    {profitData?.netPositionLabel ?? ""}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Custom Net Position View */}
      {profitData && <CustomNetPositionView data={profitData} />}

      {/* Liquidity Management — Available & To Pay */}
      <Card className="p-0 overflow-hidden">
        {/* KPI summary bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-x border-b">
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Available</p>
            <p className="text-xl font-bold font-mono text-green-600" data-testid="text-total-available">
              {formatAmount(
                displayedCashAccounts.reduce(
                  (s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)),
                  0
                )
              )}
            </p>
          </div>
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">To Pay</p>
            <p className="text-xl font-bold font-mono text-red-600" data-testid="text-total-payable">
              {formatAmount(dashboardPayableAccounts.reduce((s, a) => s + Math.abs(a.balance), 0))}
            </p>
          </div>
          <div className="p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Net</p>
            {(() => {
              const avail = displayedCashAccounts.reduce(
                (s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)),
                0
              );
              const pay = dashboardPayableAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
              const net = avail - pay;
              return (
                <p
                  className={`text-xl font-bold font-mono ${net >= 0 ? "text-green-600" : "text-red-600"}`}
                  data-testid="text-net-position"
                >
                  {formatAmount(net)}
                </p>
              );
            })()}
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {/* Available section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-green-600 flex items-center gap-1.5">
                <ArrowDownLeft className="h-4 w-4" />
                Available
              </h3>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-add-cash-account">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Account to Available</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Account</label>
                      <Popover open={cashComboboxOpen} onOpenChange={setCashComboboxOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={cashComboboxOpen}
                            className="w-full justify-between"
                            data-testid="select-account"
                          >
                            {selectedAccountId > 0
                              ? availableCashAccounts.find((acc) => acc.accountId === selectedAccountId)?.name ||
                                "Select account..."
                              : "Search accounts..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search accounts..." />
                            <CommandList>
                              <CommandEmpty>No account found.</CommandEmpty>
                              <CommandGroup>
                                {availableCashAccounts.map((account) => (
                                  <CommandItem
                                    key={account.id}
                                    value={account.name}
                                    onSelect={() => {
                                      setSelectedAccountId(account.accountId);
                                      setCashComboboxOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        selectedAccountId === account.accountId ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {account.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button
                      onClick={() => {
                        if (selectedAccountId > 0) {
                          const account = allAccounts.find((a) => a.accountId === selectedAccountId);
                          addAccountMutation.mutate({
                            accountType: account?.type.toLowerCase() || "ledger",
                            accountId: selectedAccountId,
                          });
                        }
                      }}
                      disabled={selectedAccountId === 0 || addAccountMutation.isPending}
                      className="w-full"
                      data-testid="button-save-cash-account"
                    >
                      {addAccountMutation.isPending ? "Adding..." : "Add Account"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {cashAccountsError ? (
              <p className="text-sm text-destructive text-center py-4">
                Error loading accounts: {(cashAccountsError as any)?.message || "Unknown error"}
              </p>
            ) : displayedCashAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No accounts added yet</p>
            ) : (
              <div className="space-y-1">
                {displayedCashAccounts.map((dca) => {
                  const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
                  return (
                    <div
                      key={dca.id}
                      draggable
                      onDragStart={() => {
                        dragCashRef.current = dca.id;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleCashDrop(dca.id)}
                      className="flex items-center gap-2 py-2 px-2 rounded hover-elevate group cursor-grab active:cursor-grabbing"
                      data-testid={`cash-account-row-${dca.id}`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span className="flex-1 text-sm font-medium truncate">{dca.account.name}</span>
                      <span
                        className="text-sm font-bold font-mono text-green-600"
                        data-testid={`text-balance-${dca.id}`}
                      >
                        {formatAmount(balance)}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={() => removeAccountMutation.mutate(dca.id)}
                        data-testid={`button-remove-cash-account-${dca.id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between py-2 px-2 bg-green-50 dark:bg-green-950/30 rounded font-bold mt-1">
                  <span className="text-sm">Total Available</span>
                  <span className="text-sm font-mono text-green-600">
                    {formatAmount(
                      displayedCashAccounts.reduce(
                        (s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)),
                        0
                      )
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* To Pay section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                <ArrowUpRight className="h-4 w-4" />
                To Pay
              </h3>
              <Dialog open={isAddPayableDialogOpen} onOpenChange={setIsAddPayableDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="button-add-payable-account">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Account to To Pay</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Account</label>
                      <Popover open={payableComboboxOpen} onOpenChange={setPayableComboboxOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={payableComboboxOpen}
                            className="w-full justify-between"
                            data-testid="select-payable-account"
                          >
                            {selectedPayableAccountId > 0
                              ? availablePayableAccounts.find((acc) => acc.accountId === selectedPayableAccountId)
                                  ?.name || "Select account..."
                              : "Search accounts..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search accounts..." />
                            <CommandList>
                              <CommandEmpty>No account found.</CommandEmpty>
                              <CommandGroup>
                                {availablePayableAccounts.map((account) => (
                                  <CommandItem
                                    key={account.accountId}
                                    value={account.name}
                                    onSelect={() => {
                                      setSelectedPayableAccountId(account.accountId);
                                      setPayableComboboxOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        selectedPayableAccountId === account.accountId ? "opacity-100" : "opacity-0"
                                      )}
                                    />
                                    {account.name}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button
                      onClick={() => {
                        if (selectedPayableAccountId > 0) {
                          addPayableAccountMutation.mutate({ accountId: selectedPayableAccountId });
                        }
                      }}
                      disabled={selectedPayableAccountId === 0 || addPayableAccountMutation.isPending}
                      className="w-full"
                      data-testid="button-save-payable-account"
                    >
                      {addPayableAccountMutation.isPending ? "Adding..." : "Add Account"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {payableAccountsError ? (
              <p className="text-sm text-destructive text-center py-4">
                Error loading accounts: {(payableAccountsError as any)?.message || "Unknown error"}
              </p>
            ) : dashboardPayableAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No accounts added yet</p>
            ) : (
              <div className="space-y-1">
                {dashboardPayableAccounts.map((account) => (
                  <div
                    key={account.id}
                    draggable
                    onDragStart={() => {
                      dragPayableRef.current = account.id;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handlePayableDrop(account.id)}
                    className="flex items-center gap-2 py-2 px-2 rounded hover-elevate group cursor-grab active:cursor-grabbing"
                    data-testid={`payable-account-row-${account.id}`}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    <span className="flex-1 text-sm font-medium truncate">{account.name}</span>
                    <span
                      className="text-sm font-bold font-mono text-red-600"
                      data-testid={`text-payable-${account.id}`}
                    >
                      {formatAmount(Math.abs(account.balance))}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={() => removePayableAccountMutation.mutate(account.id)}
                      data-testid={`button-remove-payable-account-${account.id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between py-2 px-2 bg-red-50 dark:bg-red-950/30 rounded font-bold mt-1">
                  <span className="text-sm">Total To Pay</span>
                  <span className="text-sm font-mono text-red-600">
                    {formatAmount(dashboardPayableAccounts.reduce((s, a) => s + Math.abs(a.balance), 0))}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
