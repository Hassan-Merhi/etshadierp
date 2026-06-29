import { KPICard } from "@/components/KPICard";
import { CountryActivityKPI } from "@/components/CountryActivityKPI";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  ArrowDownRight,
  Minus,
  Check,
  ChevronsUpDown,
  Truck,
  Package,
  Scale,
  Layers,
  ChevronRight,
  ChevronDown,
  DollarSign,
  GripVertical,
  ReceiptText,
  BookOpen,
  BarChart2,
  Boxes,
  Factory,
  CheckCircle2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState, useRef, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAppMode, useModePrefix } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";

type ProfitData = {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  forUsTotal: number;
  forUs: { total: number; breakdown: { name: string; value: number }[]; accounts: any[] };
  onUsTotal: number;
  onUs: { total: number; breakdown: { name: string; value: number }[]; accounts: any[] };
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
  balesDetail: {
    id: number;
    baleCode: string;
    productName: string | null;
    category: string | null;
    weightKg: string;
    pressedAt: string | null;
    status: string;
  }[];
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function DashboardKPICard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  stripeClass,
  iconBgClass,
  iconFgClass,
  onClick,
  testId,
}: {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  stripeClass: string;
  iconBgClass: string;
  iconFgClass: string;
  onClick?: () => void;
  testId?: string;
}) {
  const ChangeIcon = changeType === "positive" ? ArrowUpRight : changeType === "negative" ? ArrowDownRight : Minus;
  return (
    <Card
      className={cn("overflow-hidden p-0", onClick && "cursor-pointer hover-elevate active-elevate-2")}
      onClick={onClick}
      data-testid={testId}
    >
      <div className={cn("h-1 w-full", stripeClass)} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight tabular-nums mt-1.5 leading-none">
              {value}
            </div>
            {change && (
              <span
                className={cn(
                  "mt-2 flex items-center gap-0.5 text-xs font-medium",
                  changeType === "positive"
                    ? "text-chart-2"
                    : changeType === "negative"
                      ? "text-destructive"
                      : "text-muted-foreground"
                )}
              >
                <ChangeIcon className="h-3 w-3 shrink-0" />
                {change}
              </span>
            )}
          </div>
          <div
            className={cn("flex h-12 w-12 items-center justify-center rounded-xl shrink-0", iconBgClass, iconFgClass)}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatAmount, formatCashAmount } = useCurrencyContext();
  const appMode = useAppMode();
  const modePrefix = useModePrefix();
  const modeApiRequest = getApiRequest(appMode);
  const [, setLocation] = useLocation();
  const isFactoryMode = appMode === "factory";

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddPayableDialogOpen, setIsAddPayableDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [selectedPayableAccountId, setSelectedPayableAccountId] = useState<number>(0);
  const [payableComboboxOpen, setPayableComboboxOpen] = useState(false);
  const [cashComboboxOpen, setCashComboboxOpen] = useState(false);
  const [balesExpanded, setBalesExpanded] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [importCycleExpanded, setImportCycleExpanded] = useState(false);

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

  const {
    data: importCycleData,
    isError: importCycleIsError,
    isLoading: importCycleIsLoading,
  } = useQuery<ImportCycleBalanceData>({
    queryKey: ["/api/stats/import-cycle-balance", selectedCompany?.id, appMode],
    queryFn: async () => {
      const response = await modeApiRequest("GET", "/api/stats/import-cycle-balance");
      if (!response.ok) throw new Error("Failed to fetch import cycle balance");
      return await response.json();
    },
    enabled: !!selectedCompany,
    retry: 1,
  });

  const { data: factoryKPIs } = useQuery<FactoryDashboardKPIs>({
    queryKey: ["/api/factory/dashboard-kpis", selectedCompany?.id],
    queryFn: async () => {
      const res = await modeApiRequest("GET", "/api/factory/dashboard-kpis");
      if (!res.ok) throw new Error("Failed to fetch factory KPIs");
      return res.json();
    },
    enabled: !!selectedCompany && isFactoryMode,
    refetchInterval: 300000, // 5 min — KPIs don't need sub-minute freshness; was 60 s causing steady background load on Android
  });

  const { data: dashboardCashAccounts = [], error: cashAccountsError } = useQuery<DashboardCashAccount[]>({
    queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    staleTime: 30 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: allAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  const { data: allPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/accounts/all-ledger", selectedCompany?.id],
    queryFn: async () => {
      const response = await modeApiRequest("GET", "/api/accounts/all");
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const allAccounts = await response.json();
      return allAccounts.filter((acc: any) => acc.type && acc.type.toLowerCase() === "ledger");
    },
    enabled: !!selectedCompany,
  });

  const { data: dashboardPayableAccounts = [], error: payableAccountsError } = useQuery<PayableAccount[]>({
    queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    staleTime: 30 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

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
      toast({ title: "Success", description: "Account added to dashboard" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to add account", variant: "destructive" });
    },
  });

  const removeAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/dashboard-cash-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
      });
      toast({ title: "Success", description: "Account removed from dashboard" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to remove account", variant: "destructive" });
    },
  });

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
      toast({ title: "Success", description: "Payable account added to dashboard" });
    },
    onError: (error: any) => {
      if ((error as any)?._handledGlobally) return;
      toast({ title: "Error", description: error.message || "Failed to add payable account", variant: "destructive" });
    },
  });

  const removePayableAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await modeApiRequest("DELETE", `/api/dashboard-payable-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.refetchQueries({
        queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
      });
      toast({ title: "Success", description: "Payable account removed from dashboard" });
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

  const dragCashRef = useRef<number | null>(null);
  const dragPayableRef = useRef<number | null>(null);

  const reorderCashMutation = useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await modeApiRequest("PATCH", "/api/dashboard-cash-accounts/reorder", { orderedIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id] });
    },
  });

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

  const availableCashAccounts = useMemo(
    () =>
      allAccounts
        .filter((acc) => {
          const alreadyAdded = dashboardCashAccounts.some(
            (dca) => dca.accountType === (acc.type || "").toLowerCase() && dca.accountId === acc.accountId
          );
          return !alreadyAdded;
        })
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [allAccounts, dashboardCashAccounts]
  );

  const displayedCashAccounts = dashboardCashAccounts;

  const availablePayableAccounts = useMemo(
    () =>
      allPayableAccounts
        .filter((acc) => {
          const alreadyAdded = dashboardPayableAccounts.some((dpa) => dpa.accountId === acc.accountId);
          return !alreadyAdded;
        })
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [allPayableAccounts, dashboardPayableAccounts]
  );

  const totalAvailable = useMemo(
    () =>
      displayedCashAccounts.reduce(
        (s, d) => s + parseFloat(String(d.account.balance || d.account.currentBalance || 0)),
        0
      ),
    [displayedCashAccounts]
  );
  const totalPayable = useMemo(
    () => dashboardPayableAccounts.reduce((s, a) => s + Math.abs(a.balance), 0),
    [dashboardPayableAccounts]
  );
  const netCashPosition = totalAvailable - totalPayable;

  if (isError) {
    return (
      <div className="space-y-6">
        <div className="text-destructive">Failed to load dashboard data. Please try again.</div>
      </div>
    );
  }

  const importCycleBalance = importCycleData?.netImportCycleBalance ?? null;
  const isImportCycleBalanced = importCycleBalance !== null && Math.abs(importCycleBalance) < 1;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ── Page header ── */}
      <PageHeader
        title={isFactoryMode ? "Factory Dashboard" : "Dashboard"}
        subtitle={isFactoryMode ? "Today's factory floor overview" : "Business performance at a glance"}
        showHomeButton={false}
      />

      {/* ── Greeting banner ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 -mt-2 px-0.5">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{getGreeting()}</span>
          {selectedCompany?.name ? ` · ${selectedCompany.name}` : ""}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* ── Quick Actions dropdown ── */}
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" data-testid="button-quick-actions">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Quick Actions
              <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {!isFactoryMode ? (
              <>
                <DropdownMenuItem
                  onClick={() => setLocation("/vouchers?type=payment")}
                  data-testid="quick-action-payment"
                >
                  <ReceiptText className="h-4 w-4 mr-2" />
                  New Payment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/vouchers?type=receipt")}
                  data-testid="quick-action-receipt"
                >
                  <ArrowDownLeft className="h-4 w-4 mr-2" />
                  New Receipt
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/vouchers?type=journal")}
                  data-testid="quick-action-journal"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  New Journal
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/sales-report")} data-testid="quick-action-reports">
                  <BarChart2 className="h-4 w-4 mr-2" />
                  Sales Report
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/location-inventory")}
                  data-testid="quick-action-inventory"
                >
                  <Boxes className="h-4 w-4 mr-2" />
                  Inventory
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  onClick={() => setLocation("/factory/press-bale")}
                  data-testid="quick-action-press-bale"
                >
                  <Factory className="h-4 w-4 mr-2" />
                  Press Bale
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setLocation("/factory/stock-adjustment")}
                  data-testid="quick-action-stock-adj"
                >
                  <Scale className="h-4 w-4 mr-2" />
                  Stock Adjustment
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setLocation("/factory/location-inventory")}
                  data-testid="quick-action-factory-inventory"
                >
                  <Boxes className="h-4 w-4 mr-2" />
                  Inventory
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* ── Top KPI row ── */}
      <div
        className={cn(
          "grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4",
          !isFactoryMode ? "lg:grid-cols-3" : "lg:grid-cols-2"
        )}
      >
        {!isFactoryMode && (
          <DashboardKPICard
            title="Total Income"
            value={isLoading ? "Loading..." : formatAmount(profitData?.totalIncome || 0)}
            change="All income accounts combined"
            changeType="positive"
            icon={DollarSign}
            stripeClass="bg-gradient-to-r from-chart-2 via-chart-2/60 to-chart-2/20"
            iconBgClass="bg-chart-2/15"
            iconFgClass="text-chart-2"
            onClick={() => setLocation("/sales-report")}
            testId="kpi-total-income"
          />
        )}
        <DashboardKPICard
          title="Net Position"
          value={isLoading ? "Loading..." : formatAmount(profitData?.netPosition || 0)}
          change={profitData?.netPositionLabel || "What we have minus what we owe"}
          changeType={(profitData?.netPosition ?? 0) >= 0 ? "positive" : "negative"}
          icon={TrendingUp}
          stripeClass={
            (profitData?.netPosition ?? 0) >= 0
              ? "bg-gradient-to-r from-chart-2 via-chart-2/60 to-chart-2/20"
              : "bg-gradient-to-r from-destructive via-destructive/60 to-destructive/20"
          }
          iconBgClass={(profitData?.netPosition ?? 0) >= 0 ? "bg-chart-2/15" : "bg-destructive/15"}
          iconFgClass={(profitData?.netPosition ?? 0) >= 0 ? "text-chart-2" : "text-destructive"}
          onClick={() =>
            setLocation(
              modePrefix === ""
                ? "/net-position-details"
                : appMode === "properties"
                  ? "/properties/net-position-details"
                  : `${modePrefix}/net-position`
            )
          }
          testId="kpi-net-position"
        />
        <DashboardKPICard
          title="Import Cycle Balance"
          value={
            importCycleIsError
              ? "Unavailable"
              : importCycleIsLoading
                ? "Loading..."
                : isImportCycleBalanced
                  ? "Balanced"
                  : formatAmount(Math.abs(importCycleBalance!))
          }
          change={
            importCycleIsError
              ? "Could not load cycle data"
              : importCycleIsLoading
                ? ""
                : isImportCycleBalanced
                  ? "All accounts net to zero"
                  : "Should be $0 when balanced"
          }
          changeType={importCycleIsError ? "neutral" : isImportCycleBalanced ? "positive" : "negative"}
          icon={importCycleIsError ? Truck : isImportCycleBalanced ? CheckCircle2 : Truck}
          stripeClass={
            isImportCycleBalanced
              ? "bg-gradient-to-r from-chart-2 via-chart-2/60 to-chart-2/20"
              : importCycleIsError
                ? "bg-muted"
                : "bg-gradient-to-r from-destructive via-destructive/60 to-destructive/20"
          }
          iconBgClass={isImportCycleBalanced ? "bg-chart-2/15" : importCycleIsError ? "bg-muted" : "bg-destructive/15"}
          iconFgClass={
            isImportCycleBalanced ? "text-chart-2" : importCycleIsError ? "text-muted-foreground" : "text-destructive"
          }
          onClick={
            !importCycleIsError && !isImportCycleBalanced && !importCycleIsLoading
              ? () => setImportCycleExpanded((v) => !v)
              : undefined
          }
          testId="kpi-import-cycle-balance"
        />
      </div>

      {/* ── Import Cycle Breakdown (expandable, only when imbalanced) ── */}
      {!isImportCycleBalanced && importCycleData && importCycleExpanded && (
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Import Cycle Breakdown</h3>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setImportCycleExpanded(false)}
              data-testid="button-close-cycle-breakdown"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            {[
              { label: "Supplier Balance", value: importCycleData.components.supplierBalance },
              { label: "Stock on the Way", value: importCycleData.components.stockOtwValue },
              { label: "Duty Agent", value: importCycleData.components.dutyAgentBalance },
              { label: "Transporter Agent", value: importCycleData.components.transporterAgentBalance },
              { label: "Loans", value: importCycleData.components.loansBalance },
              { label: "Cash", value: importCycleData.components.cashBalance },
              { label: "Bank", value: importCycleData.components.bankBalance },
              { label: "Direct Expenses", value: importCycleData.components.directExpenseBalance },
              { label: "Indirect Expenses", value: importCycleData.components.indirectExpenseBalance },
              { label: "Income", value: importCycleData.components.incomeBalance },
              { label: "Stock on Floor", value: importCycleData.components.stockOnFloorValue },
              { label: "COGS", value: importCycleData.components.cogsBalance },
              { label: "Payroll Expense", value: importCycleData.components.payrollExpenseBalance },
              { label: "Salary Advances", value: importCycleData.components.salaryAdvancesBalance },
              { label: "Payroll Liabilities", value: importCycleData.components.payrollLiabilitiesBalance },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-1 border-b last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span
                  className={cn(
                    "font-mono font-medium",
                    value === 0 ? "text-muted-foreground" : value > 0 ? "text-chart-2" : "text-destructive"
                  )}
                >
                  {formatAmount(value)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t flex justify-between font-semibold">
            <span>Net Imbalance</span>
            <span className="font-mono text-destructive">{formatAmount(importCycleData.netImportCycleBalance)}</span>
          </div>
        </Card>
      )}

      {/* ── Country Activity KPI (expandable) ── */}
      {!isFactoryMode && <CountryActivityKPI />}

      {/* ── Main content area: 2-col on XL ── */}
      <div className={cn("grid gap-4 sm:gap-6", !isFactoryMode ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1")}>
        {/* ── Net Position Breakdown ── */}
        <Card className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-semibold pl-3 border-l-[3px] border-primary">Net Position Breakdown</h3>
            <button
              onClick={() =>
                setLocation(
                  modePrefix === ""
                    ? "/net-position-details"
                    : appMode === "properties"
                      ? "/properties/net-position-details"
                      : `${modePrefix}/net-position`
                )
              }
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              data-testid="button-net-position-detail"
            >
              Full Breakdown
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          {!isLoading &&
            profitData &&
            (() => {
              const total = (profitData.forUsTotal ?? 0) + (profitData.onUsTotal ?? 0);
              const assetsPct = total > 0 ? Math.round(((profitData.forUsTotal ?? 0) / total) * 100) : 50;
              return (
                <div className="mb-4">
                  <div className="flex justify-between text-xs font-medium mb-1.5">
                    <span className="text-chart-2">Assets {assetsPct}%</span>
                    <span className="text-destructive">Liabilities {100 - assetsPct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-destructive/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-chart-2 transition-all duration-700"
                      style={{ width: `${assetsPct}%` }}
                    />
                  </div>
                </div>
              );
            })()}

          {isLoading ? (
            <div className="flex items-center justify-center h-[200px]">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : (
            <div
              className={cn("grid gap-3", isFactoryMode ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}
            >
              {/* What We Have */}
              <div className="rounded-md bg-chart-2/5 border border-chart-2/20 p-4">
                <h4 className="text-sm font-semibold text-chart-2 mb-3 flex items-center gap-2">
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                  What We Have
                </h4>
                <div className="space-y-1.5 text-sm">
                  {(profitData?.forUs?.breakdown ?? []).map((item, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="text-muted-foreground truncate">{item.name}</span>
                      <span className="font-mono shrink-0">{formatAmount(item.value)}</span>
                    </div>
                  ))}
                  <div className="border-t border-chart-2/20 pt-2 mt-2 flex justify-between font-semibold">
                    <span>Total Assets</span>
                    <span className="font-mono text-chart-2">{formatAmount(profitData?.forUsTotal ?? 0)}</span>
                  </div>
                </div>
              </div>

              {/* What We Owe */}
              <div className="rounded-md bg-destructive/5 border border-destructive/20 p-4">
                <h4 className="text-sm font-semibold text-destructive mb-3 flex items-center gap-2">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  What We Owe
                </h4>
                <div className="space-y-1.5 text-sm">
                  {(profitData?.onUs?.breakdown ?? []).map((item, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="text-muted-foreground truncate">{item.name}</span>
                      <span className="font-mono shrink-0 text-destructive">{formatAmount(item.value)}</span>
                    </div>
                  ))}
                  <div className="border-t border-destructive/20 pt-2 mt-2 flex justify-between font-semibold">
                    <span>Total Liabilities</span>
                    <span className="font-mono text-destructive">{formatAmount(profitData?.onUsTotal ?? 0)}</span>
                  </div>
                </div>
              </div>

              {/* What We Spent — ERP only */}
              {!isFactoryMode && (
                <div className="rounded-md bg-orange-500/5 border border-orange-500/20 p-4">
                  <h4 className="text-sm font-semibold text-orange-600 dark:text-orange-400 mb-3 flex items-center gap-2">
                    <Wallet className="h-3.5 w-3.5" />
                    What We Spent
                  </h4>
                  <div className="space-y-1.5 text-sm">
                    {(profitData?.expenses?.breakdown ?? []).map((item, idx) => (
                      <div key={idx} className="flex justify-between gap-2">
                        <span className="text-muted-foreground truncate">{item.name}</span>
                        <span className="font-mono shrink-0 text-orange-600 dark:text-orange-400">
                          {formatAmount(item.value)}
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-orange-500/20 pt-2 mt-2 flex justify-between font-semibold">
                      <span>Total Expenses</span>
                      <span className="font-mono text-orange-600 dark:text-orange-400">
                        {formatAmount(profitData?.expensesTotal ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Net Position result */}
              <div
                className={cn(
                  "rounded-md p-4 flex flex-col justify-between",
                  (profitData?.netPosition ?? 0) >= 0
                    ? "bg-chart-2/10 border border-chart-2/30"
                    : "bg-destructive/10 border border-destructive/30"
                )}
              >
                <h4 className="text-sm font-semibold mb-3">Net Position</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Assets</span>
                    <span className="font-mono text-chart-2">{formatAmount(profitData?.forUsTotal ?? 0)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">− Liabilities</span>
                    <span className="font-mono text-destructive">{formatAmount(profitData?.onUsTotal ?? 0)}</span>
                  </div>
                  {!isFactoryMode && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">− Expenses</span>
                      <span className="font-mono text-orange-600 dark:text-orange-400">
                        {formatAmount(profitData?.expensesTotal ?? 0)}
                      </span>
                    </div>
                  )}
                  <div className="border-t pt-3 mt-2 flex justify-between items-baseline">
                    <span className="font-semibold">=</span>
                    <span
                      className={cn(
                        "text-2xl font-bold font-mono",
                        (profitData?.netPosition ?? 0) >= 0 ? "text-chart-2" : "text-destructive"
                      )}
                    >
                      {formatAmount(profitData?.netPosition ?? 0)}
                    </span>
                  </div>
                </div>
                {profitData?.netPositionLabel && (
                  <p
                    className={cn(
                      "text-xs font-medium mt-3 text-center py-1 rounded-sm",
                      (profitData.netPosition ?? 0) >= 0
                        ? "bg-chart-2/20 text-chart-2"
                        : "bg-destructive/20 text-destructive"
                    )}
                  >
                    {profitData.netPositionLabel}
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* ── Available & To Pay — ERP only ── */}
        {!isFactoryMode && (
          <Card className="p-0 overflow-hidden">
            {/* Summary bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-x border-b">
              <div className="p-4 sm:p-5 text-center bg-chart-2/5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-chart-2/70 mb-1">Available</p>
                <p className="text-xl sm:text-2xl font-bold font-mono text-chart-2" data-testid="text-total-available">
                  {formatCashAmount(totalAvailable)}
                </p>
              </div>
              <div className="p-4 sm:p-5 text-center bg-destructive/5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-destructive/70 mb-1">To Pay</p>
                <p
                  className="text-xl sm:text-2xl font-bold font-mono text-destructive"
                  data-testid="text-total-payable"
                >
                  {formatCashAmount(totalPayable)}
                </p>
              </div>
              <div className={cn("p-4 sm:p-5 text-center", netCashPosition >= 0 ? "bg-chart-2/5" : "bg-destructive/5")}>
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wider mb-1",
                    netCashPosition >= 0 ? "text-chart-2/70" : "text-destructive/70"
                  )}
                >
                  Net
                </p>
                <p
                  className={cn(
                    "text-xl sm:text-2xl font-bold font-mono",
                    netCashPosition >= 0 ? "text-chart-2" : "text-destructive"
                  )}
                  data-testid="text-net-position"
                >
                  {formatCashAmount(netCashPosition)}
                </p>
              </div>
            </div>

            {/* Two-col interior on lg */}
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x">
              {/* ─── Available ─── */}
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-chart-2 flex items-center gap-1.5">
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
                  <p className="text-sm text-destructive text-center py-4">Error loading accounts</p>
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
                          <GripVertical className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                          <span className="flex-1 text-sm font-medium truncate">{dca.account.name}</span>
                          <span
                            className="text-sm font-bold font-mono text-chart-2 shrink-0"
                            data-testid={`text-balance-${dca.id}`}
                          >
                            {formatCashAmount(balance)}
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
                    <div className="flex items-center justify-between py-2 px-2 bg-chart-2/10 rounded font-semibold mt-1">
                      <span className="text-sm">Total Available</span>
                      <span className="text-sm font-mono text-chart-2">{formatCashAmount(totalAvailable)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ─── To Pay ─── */}
              <div className="p-4 sm:p-5 border-t lg:border-t-0">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-destructive flex items-center gap-1.5">
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
                  <p className="text-sm text-destructive text-center py-4">Error loading accounts</p>
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
                        <GripVertical className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        <span className="flex-1 text-sm font-medium truncate">{account.name}</span>
                        <span
                          className="text-sm font-bold font-mono text-destructive shrink-0"
                          data-testid={`text-payable-${account.id}`}
                        >
                          {formatCashAmount(Math.abs(account.balance))}
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
                    <div className="flex items-center justify-between py-2 px-2 bg-destructive/10 rounded font-semibold mt-1">
                      <span className="text-sm">Total To Pay</span>
                      <span className="text-sm font-mono text-destructive">{formatCashAmount(totalPayable)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ── Factory Production KPIs ── */}
      {isFactoryMode && (
        <div className="space-y-3 sm:space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Production Today</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
            <KPICard
              title="Bales Pressed Today"
              value={factoryKPIs ? String(factoryKPIs.balesPressedToday) : "Loading..."}
              change={factoryKPIs ? `${parseFloat(factoryKPIs.totalBaleWeightToday).toLocaleString()} kg total` : ""}
              changeType="neutral"
              icon={Package}
              onClick={() => setBalesExpanded((v) => !v)}
              data-testid="kpi-bales-pressed"
            />
            <KPICard
              title="Categories Today"
              value={factoryKPIs ? String(factoryKPIs.categories.length) : "Loading..."}
              change={factoryKPIs ? `${factoryKPIs.balesPressedToday} bales across categories` : ""}
              changeType="neutral"
              icon={Layers}
              onClick={() => setCategoriesExpanded((v) => !v)}
              data-testid="kpi-categories"
            />
          </div>

          {/* Bales detail panel */}
          {balesExpanded && factoryKPIs && (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  Bales Pressed Today
                </h4>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setBalesExpanded(false)}
                  data-testid="button-close-bales"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {factoryKPIs.balesDetail.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No bales pressed today</p>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {factoryKPIs.balesDetail.map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                      <span className="text-muted-foreground font-mono">{b.baleCode}</span>
                      <span className="font-medium flex-1 mx-3 truncate">{b.productName || b.category || "—"}</span>
                      <span className="font-mono">{parseFloat(b.weightKg).toFixed(1)} kg</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Categories detail panel */}
          {categoriesExpanded && factoryKPIs && (
            <Card className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Categories Today
                </h4>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setCategoriesExpanded(false)}
                  data-testid="button-close-categories"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {factoryKPIs.categories.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No categories today</p>
              ) : (
                <div className="space-y-1">
                  {factoryKPIs.categories.map((cat) => (
                    <div
                      key={cat.name}
                      className="flex items-center justify-between text-xs py-1 border-b last:border-0"
                    >
                      <span className="font-medium truncate flex-1 mr-3">{cat.name}</span>
                      <span className="text-muted-foreground mr-3">{cat.count} bales</span>
                      <span className="font-mono">{cat.totalKg.toLocaleString()} kg</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
