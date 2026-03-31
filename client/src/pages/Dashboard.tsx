import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useCurrencyContext, type Currency } from "@/contexts/CurrencyContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Package,
  Scale,
  Layers,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  DollarSign,
  GripVertical,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";

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
    assets: {
      total: number;
      breakdown: { name: string; value: number }[];
    };
    liabilities: {
      total: number;
      breakdown: { name: string; value: number }[];
    };
    expenses: {
      total: number;
      breakdown: { name: string; value: number }[];
    };
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

type FactoryDashboardKPIs = {
  openingStockKg: string;
  closingStockKg: string;
  balesPressedToday: number;
  kgsUsedToday: string;
  totalBaleWeightToday: string;
  categories: { name: string; count: number; totalKg: number }[];
  balesDetail: { id: number; baleCode: string; productName: string | null; category: string | null; weightKg: string; pressedAt: string | null; status: string }[];
};

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const [, setLocation] = useLocation();
  const isFactoryMode = appMode === "factory";

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddPayableDialogOpen, setIsAddPayableDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [selectedPayableAccountId, setSelectedPayableAccountId] =
    useState<number>(0);
  const [payableComboboxOpen, setPayableComboboxOpen] = useState(false);
  const [cashComboboxOpen, setCashComboboxOpen] = useState(false);
  const [balesExpanded, setBalesExpanded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);

  // Fetch net profit data
  const {
    data: profitData,
    isLoading,
    isError,
  } = useQuery<ProfitData>({
    queryKey: ["/api/stats/net-profit", selectedCompany?.id],
    queryFn: async () => {
      const response = await modeApiRequest("GET", "/api/stats/net-profit");
      if (!response.ok) throw new Error("Failed to fetch net profit");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch import cycle balance data
  const { data: importCycleData } = useQuery<ImportCycleBalanceData>({
    queryKey: ["/api/stats/import-cycle-balance", selectedCompany?.id, appMode],
    queryFn: async () => {
      const response = await modeApiRequest("GET", "/api/stats/import-cycle-balance");
      if (!response.ok) throw new Error("Failed to fetch import cycle balance");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch factory dashboard KPIs (only in factory mode)
  const { data: factoryKPIs } = useQuery<FactoryDashboardKPIs>({
    queryKey: ["/api/factory/dashboard-kpis", selectedCompany?.id],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/dashboard-kpis");
      if (!res.ok) throw new Error("Failed to fetch factory KPIs");
      return res.json();
    },
    enabled: !!selectedCompany && isFactoryMode,
    refetchInterval: 60000,
  });

  // Fetch dashboard cash accounts
  const { data: dashboardCashAccounts = [], error: cashAccountsError } = useQuery<DashboardCashAccount[]>(
    {
      queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
      enabled: !!selectedCompany,
      staleTime: 30 * 1000,
    },
  );

  // Fetch all accounts for selection
  const { data: allAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch all payable accounts (ledger accounts with liability/payable type)
  const { data: allPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/accounts/all-ledger", selectedCompany?.id],
    queryFn: async () => {
      const response = await modeApiRequest("GET", "/api/accounts/all");
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const allAccounts = await response.json();
      // Filter to show only payable/liability type accounts
      return allAccounts.filter(
        (acc: any) => acc.type && acc.type.toLowerCase() === "ledger",
      );
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard payable accounts (auto-refresh every 30 seconds)
  const { data: dashboardPayableAccounts = [], error: payableAccountsError } = useQuery<PayableAccount[]>({
    queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    staleTime: 30 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Add dashboard cash account mutation
  const addAccountMutation = useMutation({
    mutationFn: async (data: { accountType: string; accountId: number }) => {
      return await modeApiRequest("POST", "/api/dashboard-cash-accounts", data);
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
      });
      setIsAddDialogOpen(false);
      setSelectedAccountId(0);
      toast({
        title: "Success",
        description: "Account added to dashboard",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to add account",
        variant: "destructive",
      });
    },
  });

  // ✅ FIXED: Remove dashboard cash account mutation (removed duplicate onSuccess)
  const removeAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/dashboard-cash-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
      });
      toast({
        title: "Success",
        description: "Account removed from dashboard",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to remove account",
        variant: "destructive",
      });
    },
  });

  // Add dashboard payable account mutation
  const addPayableAccountMutation = useMutation({
    mutationFn: async (data: { accountId: number }) => {
      return await modeApiRequest("POST", "/api/dashboard-payable-accounts", data);
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
      });
      setIsAddPayableDialogOpen(false);
      setSelectedPayableAccountId(0);
      toast({
        title: "Success",
        description: "Payable account added to dashboard",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({
        title: "Error",
        description: error.message || "Failed to add payable account",
        variant: "destructive",
      });
    },
  });

  // Remove dashboard payable account mutation
  const removePayableAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest(
        "DELETE",
        `/api/dashboard-payable-accounts/${id}`,
      );
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
      });
      toast({
        title: "Success",
        description: "Payable account removed from dashboard",
      });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
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
      await modeApiRequest("PATCH", "/api/dashboard-cash-accounts/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id] });
    },
  });

  // Reorder payable accounts mutation
  const reorderPayableMutation = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await modeApiRequest("PATCH", "/api/dashboard-payable-accounts/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id] });
    },
  });

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
        (dca) =>
          dca.accountType === (acc.type || "").toLowerCase() &&
          dca.accountId === acc.accountId,
      );
      return !alreadyAdded;
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Show all added cash accounts (regardless of balance)
  const displayedCashAccounts = dashboardCashAccounts;

  // Get available payable accounts (excluding ones already added)
  const availablePayableAccounts = allPayableAccounts
    .filter((acc) => {
      const alreadyAdded = dashboardPayableAccounts.some(
        (dpa) => dpa.accountId === acc.accountId,
      );
      return !alreadyAdded;
    })
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // Display error message if query fails
  if (isError) {
    return (
      <div className="space-y-6">
        <div className="text-destructive">
          Failed to load dashboard data. Please try again.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <PageHeader
          title="Dashboard"
          subtitle="Overview of your business performance"
          showHomeButton={false}
        />
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${!isFactoryMode ? "lg:grid-cols-3" : ""} gap-3 sm:gap-4`}>
        {!isFactoryMode && (
          <KPICard
            title="Total Income"
            value={
              isLoading
                ? "Loading..."
                : formatAmount(profitData?.totalIncome || 0)
            }
            change="From all income accounts"
            changeType="positive"
            icon={DollarSign}
            data-testid="kpi-total-income"
          />
        )}
        <KPICard
          title="Net Position"
          value={
            isLoading
              ? "Loading..."
              : formatAmount(profitData?.netPosition || 0)
          }
          change={
            profitData?.netPositionLabel || "What we have minus what we owe"
          }
          changeType={
            (profitData?.netPosition ?? 0) >= 0 ? "positive" : "negative"
          }
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
          changeType={
            Math.abs(importCycleData?.netImportCycleBalance ?? 0) < 1
              ? "positive"
              : "negative"
          }
          icon={Truck}
          data-testid="kpi-import-cycle-balance"
        />
      </div>

      {/* Net Position Breakdown: What We Have vs What We Owe vs Expenses */}
      <Card className="p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Net Position Breakdown</h3>
          {isFactoryMode && (
            <Button size="icon" variant="outline" onClick={() => setLocation(isFactoryMode ? "/factory/net-profit-details" : "/net-profit-details")} data-testid="button-net-position-detail">
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {/* What We Have (Assets) - Full Breakdown */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-green-600 mb-3 flex items-center gap-2">
                <ArrowDownLeft className="h-4 w-4" />
                What We Have
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.forUsBreakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono">
                      {formatAmount(item.value)}
                    </span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Assets:</span>
                  <span className="font-mono text-green-600">
                    {formatAmount(profitData?.forUsTotal ?? 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* What We Owe (Liabilities) - Full Breakdown */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-red-600 mb-3 flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4" />
                What We Owe
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.onUsBreakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono text-red-600">
                      {formatAmount(item.value)}
                    </span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Liabilities:</span>
                  <span className="font-mono text-red-600">
                    {formatAmount(profitData?.onUsTotal ?? 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Expenses */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-orange-600 mb-3 flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                What We Spent
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.expenses?.breakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono text-orange-600">
                      {formatAmount(item.value)}
                    </span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Expenses:</span>
                  <span className="font-mono text-orange-600">
                    {formatAmount(profitData?.expensesTotal ?? 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Net Position Calculation */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <h4 className="font-medium mb-3">Net Position</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assets:</span>
                  <span className="font-mono text-green-600">
                    {formatAmount(profitData?.forUsTotal ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">- Liabilities:</span>
                  <span className="font-mono text-red-600">
                    {formatAmount(profitData?.onUsTotal ?? 0)}
                  </span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between font-medium text-lg">
                  <span>=</span>
                  <span
                    className={cn(
                      "font-mono",
                      (profitData?.netPosition ?? 0) >= 0
                        ? "text-green-600"
                        : "text-red-600",
                    )}
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
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
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

      {/* Combined Available & To Pay — ERP only */}
      {!isFactoryMode && (
        <Card className="p-0 overflow-hidden">
          {/* KPI summary bar */}
          <div className="grid grid-cols-3 divide-x border-b">
            <div className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Available</p>
              <p className="text-xl font-bold font-mono text-green-600" data-testid="text-total-available">
                {formatAmount(displayedCashAccounts.reduce((s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)), 0))}
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
                const avail = displayedCashAccounts.reduce((s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)), 0);
                const pay = dashboardPayableAccounts.reduce((s, a) => s + Math.abs(a.balance), 0);
                const net = avail - pay;
                return (
                  <p className={`text-xl font-bold font-mono ${net >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-net-position">
                    {formatAmount(net)}
                  </p>
                );
              })()}
            </div>
          </div>

          <div className="p-4 sm:p-6 space-y-4">
            {/* ─── Available section ─── */}
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
                            <Button variant="outline" role="combobox" aria-expanded={cashComboboxOpen} className="w-full justify-between" data-testid="select-account">
                              {selectedAccountId > 0 ? availableCashAccounts.find((acc) => acc.accountId === selectedAccountId)?.name || "Select account..." : "Search accounts..."}
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
                                    <CommandItem key={account.id} value={account.name} onSelect={() => { setSelectedAccountId(account.accountId); setCashComboboxOpen(false); }}>
                                      <Check className={cn("mr-2 h-4 w-4", selectedAccountId === account.accountId ? "opacity-100" : "opacity-0")} />
                                      {account.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Button onClick={() => { if (selectedAccountId > 0) { const account = allAccounts.find((a) => a.accountId === selectedAccountId); addAccountMutation.mutate({ accountType: account?.type.toLowerCase() || "ledger", accountId: selectedAccountId }); } }} disabled={selectedAccountId === 0 || addAccountMutation.isPending} className="w-full" data-testid="button-save-cash-account">
                        {addAccountMutation.isPending ? "Adding..." : "Add Account"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {cashAccountsError ? (
                <p className="text-sm text-destructive text-center py-4">Error loading accounts: {(cashAccountsError as any)?.message || "Unknown error"}</p>
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
                        onDragStart={() => { dragCashRef.current = dca.id; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleCashDrop(dca.id)}
                        className="flex items-center gap-2 py-2 px-2 rounded hover-elevate group cursor-grab active:cursor-grabbing"
                        data-testid={`cash-account-row-${dca.id}`}
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                        <span className="flex-1 text-sm font-medium truncate">{dca.account.name}</span>
                        <span className="text-sm font-bold font-mono text-green-600" data-testid={`text-balance-${dca.id}`}>{formatAmount(balance)}</span>
                        <Button size="icon" variant="ghost" className="ml-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => removeAccountMutation.mutate(dca.id)} data-testid={`button-remove-cash-account-${dca.id}`}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between py-2 px-2 bg-green-50 dark:bg-green-950/30 rounded font-bold mt-1">
                    <span className="text-sm">Total Available</span>
                    <span className="text-sm font-mono text-green-600">{formatAmount(displayedCashAccounts.reduce((s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)), 0))}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t" />

            {/* ─── To Pay section ─── */}
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
                            <Button variant="outline" role="combobox" aria-expanded={payableComboboxOpen} className="w-full justify-between" data-testid="select-payable-account">
                              {selectedPayableAccountId > 0 ? availablePayableAccounts.find((acc) => acc.accountId === selectedPayableAccountId)?.name || "Select account..." : "Search accounts..."}
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
                                    <CommandItem key={account.accountId} value={account.name} onSelect={() => { setSelectedPayableAccountId(account.accountId); setPayableComboboxOpen(false); }}>
                                      <Check className={cn("mr-2 h-4 w-4", selectedPayableAccountId === account.accountId ? "opacity-100" : "opacity-0")} />
                                      {account.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Button onClick={() => { if (selectedPayableAccountId > 0) { addPayableAccountMutation.mutate({ accountId: selectedPayableAccountId }); } }} disabled={selectedPayableAccountId === 0 || addPayableAccountMutation.isPending} className="w-full" data-testid="button-save-payable-account">
                        {addPayableAccountMutation.isPending ? "Adding..." : "Add Account"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {payableAccountsError ? (
                <p className="text-sm text-destructive text-center py-4">Error loading accounts: {(payableAccountsError as any)?.message || "Unknown error"}</p>
              ) : dashboardPayableAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No accounts added yet</p>
              ) : (
                <div className="space-y-1">
                  {dashboardPayableAccounts.map((account) => (
                    <div
                      key={account.id}
                      draggable
                      onDragStart={() => { dragPayableRef.current = account.id; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handlePayableDrop(account.id)}
                      className="flex items-center gap-2 py-2 px-2 rounded hover-elevate group cursor-grab active:cursor-grabbing"
                      data-testid={`payable-account-row-${account.id}`}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      <span className="flex-1 text-sm font-medium truncate">{account.name}</span>
                      <span className="text-sm font-bold font-mono text-red-600" data-testid={`text-payable-${account.id}`}>{formatAmount(Math.abs(account.balance))}</span>
                      <Button size="icon" variant="ghost" className="ml-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={() => removePayableAccountMutation.mutate(account.id)} data-testid={`button-remove-payable-account-${account.id}`}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-2 px-2 bg-red-50 dark:bg-red-950/30 rounded font-bold mt-1">
                    <span className="text-sm">Total To Pay</span>
                    <span className="text-sm font-mono text-red-600">{formatAmount(dashboardPayableAccounts.reduce((s, a) => s + Math.abs(a.balance), 0))}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}


      {/* Factory Production KPIs */}
      {isFactoryMode && (
        <div className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <KPICard
              title="Opening Stock"
              value={factoryKPIs ? `${parseFloat(factoryKPIs.openingStockKg).toLocaleString()} kg` : "Loading..."}
              change="Raw stock at start of today"
              changeType="positive"
              icon={Package}
              data-testid="kpi-opening-stock"
            />
            <KPICard
              title="Closing Stock"
              value={factoryKPIs ? `${parseFloat(factoryKPIs.closingStockKg).toLocaleString()} kg` : "Loading..."}
              change="Current remaining raw stock"
              changeType={factoryKPIs && parseFloat(factoryKPIs.closingStockKg) > 0 ? "positive" : "negative"}
              icon={Scale}
              data-testid="kpi-closing-stock"
            />

            {/* Bales Pressed Today - expandable */}
            <Card className="p-4 cursor-pointer hover-elevate" onClick={() => setBalesExpanded(!balesExpanded)} data-testid="kpi-bales-pressed">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" />
                  <span className="text-sm font-medium">Bales Pressed Today</span>
                </div>
                {balesExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="mt-2">
                <p className="text-2xl font-bold font-mono">{factoryKPIs?.balesPressedToday ?? "—"}</p>
                <p className="text-sm text-muted-foreground mt-1">{factoryKPIs ? `${parseFloat(factoryKPIs.totalBaleWeightToday).toLocaleString()} kg total` : "Loading..."}</p>
              </div>
              {balesExpanded && factoryKPIs && factoryKPIs.balesDetail.length > 0 && (
                <div className="mt-3 border-t pt-3 space-y-1 max-h-48 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  {factoryKPIs.balesDetail.map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-mono">{b.baleCode}</span>
                      <span className="font-medium">{b.productName || b.category || "—"}</span>
                      <span className="font-mono">{parseFloat(b.weightKg).toFixed(1)} kg</span>
                    </div>
                  ))}
                </div>
              )}
              {balesExpanded && factoryKPIs && factoryKPIs.balesDetail.length === 0 && (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground text-center">No bales pressed today</p>
              )}
            </Card>

            {/* Categories - expandable */}
            <Card className="p-4 cursor-pointer hover-elevate" onClick={() => setCategoriesExpanded(!categoriesExpanded)} data-testid="kpi-categories">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Layers className="h-4 w-4" />
                  <span className="text-sm font-medium">Categories Today</span>
                </div>
                {categoriesExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
              <div className="mt-2">
                <p className="text-2xl font-bold font-mono">{factoryKPIs ? factoryKPIs.categories.length : "—"}</p>
                <p className="text-sm text-muted-foreground mt-1">{factoryKPIs ? `${factoryKPIs.balesPressedToday} bales across all categories` : "Loading..."}</p>
              </div>
              {categoriesExpanded && factoryKPIs && factoryKPIs.categories.length > 0 && (
                <div className="mt-3 border-t pt-3 space-y-1 max-h-48 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  {factoryKPIs.categories.map((cat) => (
                    <div key={cat.name} className="flex items-center justify-between text-xs">
                      <span className="font-medium truncate flex-1 mr-2">{cat.name}</span>
                      <span className="text-muted-foreground">{cat.count} bales</span>
                      <span className="font-mono ml-2">{cat.totalKg.toLocaleString()} kg</span>
                    </div>
                  ))}
                </div>
              )}
              {categoriesExpanded && factoryKPIs && factoryKPIs.categories.length === 0 && (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground text-center">No categories today</p>
              )}
            </Card>
          </div>
        </div>
      )}

    </div>
  );
}
