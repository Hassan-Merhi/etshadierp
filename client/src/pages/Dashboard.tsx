import { KPICard } from "@/components/KPICard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DollarSign, TrendingUp, Plus, X, Wallet, ArrowUpRight, ArrowDownLeft, Check, ChevronsUpDown, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { useState } from "react";
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

export default function Dashboard() {
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddPayableDialogOpen, setIsAddPayableDialogOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(0);
  const [selectedPayableAccountId, setSelectedPayableAccountId] = useState<number>(0);
  const [payableComboboxOpen, setPayableComboboxOpen] = useState(false);
  const [cashComboboxOpen, setCashComboboxOpen] = useState(false);
  
  // Fetch net profit data
  const { data: profitData, isLoading, isError } = useQuery<ProfitData>({
    queryKey: ["/api/stats/net-profit", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/net-profit", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch net profit");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch import cycle balance data
  const { data: importCycleData } = useQuery<ImportCycleBalanceData>({
    queryKey: ["/api/stats/import-cycle-balance", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/stats/import-cycle-balance", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch import cycle balance");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard cash accounts
  const { data: dashboardCashAccounts = [] } = useQuery<DashboardCashAccount[]>({
    queryKey: ["/api/dashboard-cash-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch all accounts for selection
  const { data: allAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch all payable accounts (ledger accounts with liability/payable type)
  const { data: allPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    queryFn: async () => {
      const response = await fetch("/api/accounts/all", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch accounts");
      const allAccounts = await response.json();
      // Filter to show only payable/liability type accounts
      return allAccounts.filter((acc: any) => 
        acc.type && acc.type.toLowerCase() === "ledger"
      );
    },
    enabled: !!selectedCompany,
  });

  // Fetch dashboard payable accounts (auto-refresh every 30 seconds)
  const { data: dashboardPayableAccounts = [] } = useQuery<PayableAccount[]>({
    queryKey: ["/api/dashboard-payable-accounts", selectedCompany?.id],
    enabled: !!selectedCompany,
    refetchInterval: 30000,
  });

  // Add dashboard cash account mutation
  const addAccountMutation = useMutation({
    mutationFn: async (data: { accountType: string; accountId: number }) => {
      return await apiRequest("POST", "/api/dashboard-cash-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts"] });
      setIsAddDialogOpen(false);
      setSelectedAccountId(0);
      toast({
        title: "Success",
        description: "Account added to dashboard",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add account",
        variant: "destructive",
      });
    },
  });

  // Remove dashboard cash account mutation
  const removeAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/dashboard-cash-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-cash-accounts"] });
      toast({
        title: "Success",
        description: "Account removed from dashboard",
      });
    },
    onError: (error: any) => {
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
      return await apiRequest("POST", "/api/dashboard-payable-accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-payable-accounts"] });
      setIsAddPayableDialogOpen(false);
      setSelectedPayableAccountId(0);
      toast({
        title: "Success",
        description: "Payable account added to dashboard",
      });
    },
    onError: (error: any) => {
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
      return await apiRequest("DELETE", `/api/dashboard-payable-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard-payable-accounts"] });
      toast({
        title: "Success",
        description: "Payable account removed from dashboard",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove payable account",
        variant: "destructive",
      });
    },
  });

  // Get available cash accounts (excluding ones already added)
  const availableCashAccounts = allAccounts.filter(acc => {
    const alreadyAdded = dashboardCashAccounts.some(
      dca => dca.accountType === acc.type.toLowerCase() && dca.accountId === acc.accountId
    );
    return !alreadyAdded;
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Show all added cash accounts (regardless of balance)
  const displayedCashAccounts = dashboardCashAccounts;

  // Get available payable accounts (excluding ones already added)
  const availablePayableAccounts = allPayableAccounts.filter(acc => {
    const alreadyAdded = dashboardPayableAccounts.some(dpa => dpa.accountId === acc.accountId);
    return !alreadyAdded;
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Filter payable accounts with non-zero balance from dashboard payable accounts
  const displayedPayableAccounts = dashboardPayableAccounts.filter(acc => {
    const balance = Math.abs(acc.balance);
    return balance !== 0;
  });

  // Display error message if query fails
  if (isError) {
    return (
      <div className="space-y-6">
        <div className="text-destructive">Failed to load dashboard data. Please try again.</div>
      </div>
    );
  }

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Dashboard" 
        subtitle="Overview of your business performance"
        showHomeButton={false}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPICard
          title="Total Income"
          value={isLoading ? "Loading..." : formatCurrency(profitData?.totalIncome || 0)}
          change="From all income accounts"
          changeType="positive"
          icon={DollarSign}
          data-testid="kpi-total-income"
        />
        <KPICard
          title="Net Position"
          value={isLoading ? "Loading..." : formatCurrency(profitData?.netPosition || 0)}
          change={profitData?.netPositionLabel || "What we have minus what we owe"}
          changeType={(profitData?.netPosition ?? 0) >= 0 ? "positive" : "negative"}
          icon={TrendingUp}
          data-testid="kpi-net-position"
        />
        <KPICard
          title="Import Cycle Balance"
          value={!importCycleData ? "Loading..." : Math.abs(importCycleData.netImportCycleBalance) < 1 ? "$0.00" : formatCurrency(importCycleData.netImportCycleBalance)}
          change="Should be $0 when balanced"
          changeType={Math.abs(importCycleData?.netImportCycleBalance ?? 0) < 1 ? "positive" : "negative"}
          icon={Truck}
          
          data-testid="kpi-import-cycle-balance"
        />
      </div>

      {/* Net Position Breakdown: What We Have vs What We Owe vs Expenses */}
      <Card className="p-6">
        <h3 className="text-lg font-medium mb-4">Net Position Breakdown</h3>
        {isLoading ? (
          <div className="flex items-center justify-center h-[200px]">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
                    <span className="font-mono">{formatCurrency(item.value)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Assets:</span>
                  <span className="font-mono text-green-600">{formatCurrency(profitData?.forUsTotal ?? 0)}</span>
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
                    <span className="font-mono text-red-600">{formatCurrency(item.value)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Liabilities:</span>
                  <span className="font-mono text-red-600">{formatCurrency(profitData?.onUsTotal ?? 0)}</span>
                </div>
              </div>
            </div>
            
            {/* Expenses (what we spent) */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium text-orange-600 mb-3 flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                What We Spent
              </h4>
              <div className="space-y-2 text-sm">
                {(profitData?.expenses?.breakdown ?? []).map((item, idx) => (
                  <div key={idx} className="flex justify-between">
                    <span className="text-muted-foreground">{item.name}:</span>
                    <span className="font-mono text-orange-600">{formatCurrency(item.value)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 mt-2 flex justify-between font-medium">
                  <span>Total Expenses:</span>
                  <span className="font-mono text-orange-600">{formatCurrency(profitData?.expensesTotal ?? 0)}</span>
                </div>
              </div>
            </div>
            
            {/* Net Position Calculation */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <h4 className="font-medium mb-3">Net Position</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assets:</span>
                  <span className="font-mono text-green-600">{formatCurrency(profitData?.forUsTotal ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">- Liabilities:</span>
                  <span className="font-mono text-red-600">{formatCurrency(profitData?.onUsTotal ?? 0)}</span>
                </div>
                <div className="border-t pt-2 mt-2 flex justify-between font-medium text-lg">
                  <span>=</span>
                  <span className={cn(
                    "font-mono",
                    (profitData?.netPosition ?? 0) >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {formatCurrency(profitData?.netPosition ?? 0)}
                  </span>
                </div>
                <div className="text-center mt-2">
                  <span className={cn(
                    "text-xs font-medium px-2 py-1 rounded-full",
                    (profitData?.netPosition ?? 0) >= 0 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  )}>
                    {profitData?.netPositionLabel ?? ""}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Bottom Row: Available Cash, Cash to Pay */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Available Cash */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <ArrowDownLeft className="h-5 w-5 text-green-600" />
              Available
            </h3>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-cash-account">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Cash Account to Dashboard</DialogTitle>
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
                            ? availableCashAccounts.find((acc) => acc.accountId === selectedAccountId)?.name || "Select account..."
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
                        const account = allAccounts.find(a => a.accountId === selectedAccountId);
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
          
          {displayedCashAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No accounts added</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedCashAccounts.map((dca) => {
                const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
                return (
                  <div key={dca.id} className="flex items-center justify-between py-2 px-3 rounded hover-elevate group" data-testid={`cash-account-row-${dca.id}`}>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{dca.account.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono text-green-600" data-testid={`text-balance-${dca.id}`}>
                        {formatCurrency(balance)}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeAccountMutation.mutate(dca.id)}
                      data-testid={`button-remove-cash-account-${dca.id}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {displayedCashAccounts.length > 0 && (
                <div className="border-t pt-2 mt-2 flex items-center justify-between py-2 px-3 bg-green-50 dark:bg-green-950/30 rounded font-bold">
                  <span>Total</span>
                  <span className="text-green-600 font-mono" data-testid="text-total-available">
                    {formatCurrency(
                      displayedCashAccounts.reduce((sum, dca) => {
                        const balance = parseFloat(String(dca.account.balance || dca.account.currentBalance || 0));
                        return sum + balance;
                      }, 0)
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* To Pay (Right) */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-red-600" />
              To Pay
            </h3>
            <Dialog open={isAddPayableDialogOpen} onOpenChange={setIsAddPayableDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-payable-account">
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Payable Account to Dashboard</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Supplier</label>
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
                            ? availablePayableAccounts.find((acc) => acc.accountId === selectedPayableAccountId)?.name || "Select account..."
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
                        addPayableAccountMutation.mutate({
                          accountId: selectedPayableAccountId,
                        });
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
          
          {displayedPayableAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No payable accounts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedPayableAccounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between py-2 px-3 rounded hover-elevate group" data-testid={`payable-account-row-${account.id}`}>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{account.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold font-mono text-red-600" data-testid={`text-payable-${account.id}`}>
                      {formatCurrency(Math.abs(account.balance))}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removePayableAccountMutation.mutate(account.id)}
                    data-testid={`button-remove-payable-account-${account.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {displayedPayableAccounts.length > 0 && (
                <div className="border-t pt-2 mt-2 flex items-center justify-between py-2 px-3 bg-red-50 dark:bg-red-950/30 rounded font-bold">
                  <span>Total</span>
                  <span className="text-red-600 font-mono" data-testid="text-total-payable">
                    {formatCurrency(
                      displayedPayableAccounts.reduce((sum, acc) => sum + Math.abs(acc.balance), 0)
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
