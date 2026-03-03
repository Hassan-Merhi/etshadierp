import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Wallet, 
  Package,
  FileText,
  ChevronRight,
  ChevronDown,
  Download,
  RefreshCw,
  BarChart3,
  ShoppingCart,
  Container as ContainerIcon,
  type LucideIcon
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { utils, writeFile, readFile, ExcelJS } from "@/lib/excelHelper";
import { formatNumber } from "@/lib/formatNumber";
import { useAppMode } from "@/contexts/AppModeContext";
import { getApiRequest } from "@/lib/factoryApi";

// Type definitions
interface Account {
  id: string;
  accountId: number;
  type: string;
  code: string;
  name: string;
  accountType?: string;
  subType?: string;
  balance: number;
  balanceSide: string | null;
  active: boolean;
  parentId?: number;
}

interface LocationSales {
  locationId: number;
  locationName: string;
  locationCode: string;
  totalSales: number;
  totalTransactions: number;
}

interface POSTransaction {
  id: number;
  voucherNumber: string;
  voucherDate: string;
  createdAt: string;
  description: string | null;
  totalAmount: number;
  totalQuantity: number;
  itemCount: number;
  items: any[];
}

interface ProfitData {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  netPosition: number;
}

interface FinancialRatiosData {
  ratios: {
    grossProfitMargin: number;
    netProfitMargin: number;
    currentRatio: number;
    debtToEquity: number;
  };
  underlying: {
    totalIncome: number;
    totalExpenses: number;
    totalSales: number;
    totalCost: number;
    grossProfit: number;
    netProfit: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
  };
}

interface StockLocation {
  locationId: number;
  locationName: string;
  quantity: number;
  averageRate: number;
  totalValue: number;
}

interface StockMovementItem {
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  locations: StockLocation[];
  totalQuantity: number;
  totalValue: number;
}

interface StockMovementData {
  items: StockMovementItem[];
  summary: {
    totalItems: number;
    grandTotalQuantity: number;
    grandTotalValue: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    locationId: string | null;
    stockGroupId: string | null;
  };
}

interface Container {
  id: number;
  containerNumber: string;
  supplierName: string;
  status: string;
  importDate: string;
  itemsTotal: string;
  chargesTotal: string;
  grandTotal: string;
}

interface ContainerData {
  containers: Container[];
  summary: {
    totalContainers: number;
    totalItemsTotal: number;
    totalChargesTotal: number;
    totalGrandTotal: number;
  };
  filters: {
    startDate: string | null;
    endDate: string | null;
    supplierId: string | null;
    status: string | null;
  };
}

interface Location {
  id: number;
  code: string;
  name: string;
}

interface StockGroup {
  id: number;
  code: string;
  name: string;
}

interface Supplier {
  id: number;
  code: string;
  name: string;
}

interface OpeningStockGroup {
  id: number;
  code: string;
  name: string;
  opening: {
    quantity: number;
    rate: number;
    value: number;
  };
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
  itemCount: number;
}

interface OpeningStockItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  opening: {
    quantity: number;
    rate: number;
    value: number;
  };
  closing: {
    quantity: number;
    rate: number;
    value: number;
  };
}

interface OpeningStockSummaryData {
  stockGroups: OpeningStockGroup[];
  grandTotal: {
    opening: { quantity: number; value: number };
    closing: { quantity: number; value: number };
  };
  filters: {
    locationId: string | null;
  };
  notes?: {
    opening: string;
    closing: string;
  };
}

interface OpeningStockItemsData {
  items: OpeningStockItem[];
  totals: {
    opening: { quantity: number; value: number };
    closing: { quantity: number; value: number };
  };
}

interface NetProfitAccount {
  id: number;
  code: string;
  name: string;
  debit: number;
  credit: number;
  balance: number;
}

interface NetProfitStatementData {
  netPosition: number;
  leftPane: {
    openingStock: {
      value: number;
    };
    purchaseAccounts: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    directExpenses: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    tradingTotal: number;
    grossProfit: number;
    indirectExpenses: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    netProfit: number;
  };
  rightPane?: {
    salesAccounts: {
      total: number;
    };
    directIncomes: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    closingStock: {
      value: number;
    };
    tradingTotal: number;
    grossProfitBf: number;
    indirectIncomes: {
      total: number;
      accounts: NetProfitAccount[];
      count: number;
    };
    total: number;
  };
}

function formatSmartNumber(num: number | string): string {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  const isWholeNumber = value % 1 === 0;
  if (isWholeNumber) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Analytics() {
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const [, navigate] = useLocation();
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const hideAnalyticsFinancials = (myErpPages?.hiddenErpCostFields ?? []).includes("analytics_financials");
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [detailsPeriod, setDetailsPeriod] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("this_month"));
  const [selectedLocationForDetails, setSelectedLocationForDetails] = useState<number | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set());
  const [ratiosStartDate, setRatiosStartDate] = useState("");
  const [ratiosEndDate, setRatiosEndDate] = useState("");
  
  // Report filters
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportLocationId, setReportLocationId] = useState("all");
  const [reportStockGroupId, setReportStockGroupId] = useState("all");
  const [reportSupplierId, setReportSupplierId] = useState("all");
  const [reportContainerStatus, setReportContainerStatus] = useState("all");
  
  // Opening Stock Summary state
  const [openingStockLocationId, setOpeningStockLocationId] = useState("all");
  const [expandedStockGroups, setExpandedStockGroups] = useState<Set<number>>(new Set());
  const [stockGroupItems, setStockGroupItems] = useState<Map<number, OpeningStockItemsData>>(new Map());
  
  // Net Profit Report state
  const [expandedNetProfitSections, setExpandedNetProfitSections] = useState<Set<string>>(new Set());
  const [plStartDate, setPlStartDate] = useState("");
  const [plEndDate, setPlEndDate] = useState("");
  
  const [activeSection, setActiveSection] = useState("overview");

  const sidebarGroups: { label: string; items: { key: string; label: string; icon: LucideIcon }[] }[] = [
    {
      label: "Financial Summary",
      items: [
        { key: "overview", label: "Overview", icon: BarChart3 },
        { key: "reports", label: "Net Profit (P&L)", icon: DollarSign },
      ],
    },
    {
      label: "Account Balances",
      items: [
        { key: "assets", label: "Assets", icon: Package },
        { key: "liabilities", label: "Liabilities", icon: FileText },
        { key: "cash", label: "Cash", icon: Wallet },
      ],
    },
    {
      label: "Expenses",
      items: [
        { key: "expenses", label: "All Expenses", icon: TrendingDown },
        { key: "direct-expenses", label: "Direct Expenses", icon: DollarSign },
        { key: "indirect-expenses", label: "Indirect Expenses", icon: FileText },
      ],
    },
    {
      label: "Sales & Containers",
      items: [
        { key: "sales", label: "Sales Analytics", icon: ShoppingCart },
        { key: "containers", label: "Container Report", icon: ContainerIcon },
      ],
    },
  ];
  
  // Clear cached items when location filter changes
  const handleOpeningStockLocationChange = (newLocationId: string) => {
    setOpeningStockLocationId(newLocationId);
    setExpandedStockGroups(new Set());
    setStockGroupItems(new Map());
  };

  // Fetch reference data
  const { data: locations = [] } = useQuery<Location[]>({ 
    queryKey: ["/api/locations", selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
    enabled: !!selectedCompany,
  });
  const { data: stockGroups = [] } = useQuery<StockGroup[]>({ 
    queryKey: ["/api/stock-groups", selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock groups");
      return response.json();
    },
    enabled: !!selectedCompany,
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ 
    queryKey: ["/api/suppliers", selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch all accounts
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id],
    enabled: !!selectedCompany,
  });

  // Fetch profit data with period filter
  const { data: profitData, isLoading: profitLoading } = useQuery<ProfitData>({
    queryKey: ["/api/stats/net-profit", selectedCompany?.id, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
      const response = await fetch(`/api/stats/net-profit?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch net profit");
      return await response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch sales data
  const getDateRange = () => {
    const today = new Date();
    let startDate = "";
    let endDate = today.toISOString().split("T")[0];
    if (selectedPeriod === "today") {
      startDate = endDate;
    } else if (selectedPeriod === "month") {
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate = firstDayOfMonth.toISOString().split("T")[0];
    } else if (selectedPeriod === "year") {
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      startDate = firstDayOfYear.toISOString().split("T")[0];
    }
    return selectedPeriod === "all" ? {} : { startDate, endDate };
  };

  const dateRange = getDateRange();
  const { data: salesData = [], isLoading: salesLoading } = useQuery<LocationSales[]>({
    queryKey: ["/api/financial/sales", selectedCompany?.id, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams(dateRange as Record<string, string>);
      const response = await fetch(`/api/financial/sales?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch sales data");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch detail transactions
  const getDetailsDateRange = () => {
    const today = new Date();
    let startDate = "";
    let endDate = today.toISOString().split("T")[0];
    if (detailsPeriod === "today") {
      startDate = endDate;
    } else if (detailsPeriod === "month") {
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      startDate = firstDayOfMonth.toISOString().split("T")[0];
    } else if (detailsPeriod === "year") {
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      startDate = firstDayOfYear.toISOString().split("T")[0];
    }
    return detailsPeriod === "all" ? {} : { startDate, endDate };
  };

  const detailsDateRange = getDetailsDateRange();
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<POSTransaction[]>({
    queryKey: ["/api/financial/sales", selectedLocationForDetails, "transactions", detailsDateRange],
    queryFn: async () => {
      const params = new URLSearchParams(detailsDateRange as Record<string, string>);
      const response = await fetch(
        `/api/financial/sales/${selectedLocationForDetails}/transactions?${params}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to fetch transactions");
      return response.json();
    },
    enabled: !!selectedLocationForDetails,
  });

  // Fetch financial ratios with period filter
  const { data: ratiosData, isLoading: ratiosLoading } = useQuery<FinancialRatiosData>({
    queryKey: ["/api/reports/financial-ratios", selectedCompany?.id, periodFilter.fromDate, periodFilter.toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (periodFilter.fromDate) params.append("startDate", periodFilter.fromDate);
      if (periodFilter.toDate) params.append("endDate", periodFilter.toDate);
      const response = await fetch(`/api/reports/financial-ratios?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch ratios");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch stock movement report
  const buildStockMovementUrl = () => {
    const params = new URLSearchParams();
    if (reportStartDate) params.append("startDate", reportStartDate);
    if (reportEndDate) params.append("endDate", reportEndDate);
    if (reportLocationId && reportLocationId !== "all") params.append("locationId", reportLocationId);
    if (reportStockGroupId && reportStockGroupId !== "all") params.append("stockGroupId", reportStockGroupId);
    return `/api/reports/stock-movement?${params}`;
  };

  const { data: stockMovementData, refetch: refetchStockMovement, isLoading: loadingStock } = useQuery<StockMovementData>({
    queryKey: [buildStockMovementUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock movement");
      return response.json();
    },
    enabled: false, // Manual trigger via Generate button
  });

  // Fetch container report
  const buildContainerUrl = () => {
    const params = new URLSearchParams();
    if (reportStartDate) params.append("startDate", reportStartDate);
    if (reportEndDate) params.append("endDate", reportEndDate);
    if (reportSupplierId && reportSupplierId !== "all") params.append("supplierId", reportSupplierId);
    if (reportContainerStatus && reportContainerStatus !== "all") params.append("status", reportContainerStatus);
    return `/api/reports/containers?${params}`;
  };

  const { data: containerData, refetch: refetchContainers, isLoading: loadingContainers } = useQuery<ContainerData>({
    queryKey: [buildContainerUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch containers");
      return response.json();
    },
    enabled: false, // Manual trigger via Generate button
  });

  // Fetch Opening Stock Summary
  const buildOpeningStockUrl = () => {
    const params = new URLSearchParams();
    if (openingStockLocationId && openingStockLocationId !== "all") {
      params.append("locationId", openingStockLocationId);
    }
    return `/api/reports/opening-stock-summary?${params}`;
  };

  const { data: openingStockData, isLoading: loadingOpeningStock } = useQuery<OpeningStockSummaryData>({
    queryKey: [buildOpeningStockUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch opening stock summary");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Build Net Profit URL with date filters
  const buildNetProfitUrl = () => {
    const params = new URLSearchParams();
    if (plStartDate) {
      params.append("startDate", plStartDate);
    }
    if (plEndDate) {
      params.append("endDate", plEndDate);
    }
    return `/api/reports/net-profit-statement?${params}`;
  };

  // Fetch Net Profit Statement
  const { data: netProfitData, isLoading: loadingNetProfit } = useQuery<NetProfitStatementData>({
    queryKey: ["/api/reports/net-profit-statement", selectedCompany?.id, plStartDate, plEndDate],
    queryFn: async () => {
      const response = await fetch(buildNetProfitUrl(), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch net profit statement");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Toggle Net Profit section expansion
  const toggleNetProfitSection = (section: string) => {
    const newExpanded = new Set(expandedNetProfitSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedNetProfitSections(newExpanded);
  };

  // Toggle stock group expansion and fetch items
  const toggleStockGroup = async (groupId: number) => {
    const newExpanded = new Set(expandedStockGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
      // Fetch items if not already loaded
      if (!stockGroupItems.has(groupId)) {
        try {
          const params = new URLSearchParams();
          if (openingStockLocationId && openingStockLocationId !== "all") {
            params.append("locationId", openingStockLocationId);
          }
          const response = await fetch(
            `/api/reports/opening-stock-summary/${groupId}/items?${params}`,
            { credentials: "include" }
          );
          if (response.ok) {
            const data = await response.json();
            setStockGroupItems(new Map(stockGroupItems).set(groupId, data));
          }
        } catch (error) {
          console.error("Failed to fetch stock group items:", error);
        }
      }
    }
    setExpandedStockGroups(newExpanded);
  };

  // Helper functions
  const toggleAccount = (accountId: number) => {
    const newExpanded = new Set(expandedAccounts);
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId);
    } else {
      newExpanded.add(accountId);
    }
    setExpandedAccounts(newExpanded);
  };

  const groupAccountsByParent = (accountList: Account[]) => {
    const accountIdsInList = new Set(accountList.map(acc => acc.accountId));
    const parentAccounts: Account[] = [];
    const childAccounts: Account[] = [];

    accountList.forEach(acc => {
      if (!acc.parentId || !accountIdsInList.has(acc.parentId)) {
        parentAccounts.push(acc);
      } else {
        childAccounts.push(acc);
      }
    });
    
    const accountMap = new Map<number, Account[]>();
    childAccounts.forEach(child => {
      const parentId = child.parentId!;
      if (!accountMap.has(parentId)) {
        accountMap.set(parentId, []);
      }
      accountMap.get(parentId)!.push(child);
    });

    return { parentAccounts, accountMap };
  };

  const parseBalance = (balance: number | string): number => {
    if (typeof balance === 'string') {
      return parseFloat(balance) || 0;
    }
    return balance || 0;
  };

  const calculateChildrenTotal = (parentAccountId: number, accountMap: Map<number, Account[]>) => {
    const children = accountMap.get(parentAccountId) || [];
    return children.reduce((sum, acc) => sum + parseBalance(acc.balance), 0);
  };

  const calculateTotal = (accountList: Account[]) => {
    // Get all account IDs that are present in this list
    const accountIds = new Set(accountList.map(acc => acc.accountId));
    
    // Get all account IDs that are parents (have children in this list)
    const parentAccountIds = new Set(
      accountList.filter(acc => acc.parentId).map(acc => acc.parentId!)
    );
    
    // For parent accounts that have children in the list, sum their children only (not the parent)
    // For accounts without children, include the account itself
    // For child accounts whose parent is also in the list, skip them (they're counted via their parent's children total)
    let total = 0;
    
    accountList.forEach(acc => {
      const hasChildrenInList = parentAccountIds.has(acc.accountId);
      const isChildOfParentInList = acc.parentId && accountIds.has(acc.parentId);
      
      if (hasChildrenInList) {
        // This is a parent with children - count the children's total (not the parent's balance)
        const children = accountList.filter(child => child.parentId === acc.accountId);
        total += children.reduce((sum, child) => sum + parseBalance(child.balance), 0);
      } else if (!isChildOfParentInList) {
        // This is a standalone account (not a child of something in the list) - count its balance
        total += parseBalance(acc.balance);
      }
      // If it's a child of a parent in the list, don't count it separately (already counted via parent)
    });
    
    return total;
  };

  const calculatePLTotal = (accountList: Account[]) => {
    return accountList.reduce((sum, acc) => {
      const balance = parseBalance(acc.balance);
      const amount = acc.balanceSide === "Cr" ? balance : -balance;
      return sum + amount;
    }, 0);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(Math.abs(value));
  };

  const formatSmartCurrency = (value: number): string => {
    const absValue = Math.abs(value);
    const isWholeNumber = absValue % 1 === 0;
    if (isWholeNumber) {
      return '$' + absValue.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    return '$' + absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Filter accounts - Cash accounts are ledger accounts with accountType="Cash"
  const cashAccounts = accounts.filter(
    (acc) => 
      (acc.type === "ledger" && acc.accountType === "Cash") ||
      (acc.type === "bank" && (
        (acc.name || "").toLowerCase().includes("cash") || 
        (acc.code || "").toLowerCase().includes("cash")
      ))
  );

  const assetAccounts = accounts.filter(
    (acc) =>
      acc.type === "fixedAsset" ||
      (acc.type === "ledger" && acc.accountType === "Asset") ||
      acc.type === "bank"
  );

  // Include all expense accounts in P&L calculations (no exclusions)
  const expenseAccounts = accounts.filter((acc) => {
    if (acc.type !== "ledger") return false;
    
    // Support both correct format (accountType="Expense") and legacy format
    // (accountType="Indirect Expense" or "Direct Expense")
    const isExpenseAccount = 
      acc.accountType === "Expense" || 
      acc.accountType === "Indirect Expense" || 
      acc.accountType === "Direct Expense";
    
    return isExpenseAccount;
  });

  const directExpenseAccounts = expenseAccounts.filter(
    (acc) => acc.subType === "Direct Expense" || acc.accountType === "Direct Expense"
  );

  const indirectExpenseAccounts = expenseAccounts.filter(
    (acc) => acc.subType === "Indirect Expense" || acc.accountType === "Indirect Expense"
  );

  const liabilityAccounts = accounts.filter(
    (acc) => 
      (acc.type === "ledger" && (
        acc.accountType === "Liability" ||
        acc.accountType === "Accounts Payable" ||
        acc.accountType === "Loans" ||
        acc.accountType === "Duty Agent" ||
        acc.accountType === "Transporter Agent"
      ))
  );

  const directIncomeAccounts = accounts.filter(
    (acc) =>
      acc.type === "ledger" &&
      acc.accountType === "Income" &&
      acc.subType === "Direct Income"
  );

  const indirectIncomeAccounts = accounts.filter(
    (acc) =>
      acc.type === "ledger" &&
      acc.accountType === "Income" &&
      acc.subType === "Indirect Income"
  );

  // P&L calculations
  const totalDirectIncome = calculatePLTotal(directIncomeAccounts);
  const totalIndirectIncome = calculatePLTotal(indirectIncomeAccounts);
  const totalIncome = totalDirectIncome + totalIndirectIncome;
  const totalDirectExpense = Math.abs(calculatePLTotal(directExpenseAccounts));
  const totalIndirectExpense = Math.abs(calculatePLTotal(indirectExpenseAccounts));
  const totalExpenses = totalDirectExpense + totalIndirectExpense;
  const netProfit = totalIncome - totalExpenses;

  // Render hierarchical accounts (filters out zero-balance accounts)
  const renderHierarchicalAccounts = (accountList: Account[], showSide: boolean = false) => {
    const { parentAccounts, accountMap } = groupAccountsByParent(accountList);

    return (
      <>
        {parentAccounts.map((parent) => {
          const children = accountMap.get(parent.accountId) || [];
          const hasChildren = children.length > 0;
          const isExpanded = expandedAccounts.has(parent.accountId);
          const childrenTotal = hasChildren ? calculateChildrenTotal(parent.accountId, accountMap) : 0;
          const parentBalance = parseBalance(parent.balance);
          const displayBalance = hasChildren ? childrenTotal : parentBalance;
          
          // Skip accounts with 0 balance (check children total for parent accounts)
          if (displayBalance === 0) return null;
          
          // Filter out children with 0 balance
          const nonZeroChildren = children.filter(child => parseBalance(child.balance) !== 0);

          return (
            <Fragment key={parent.id}>
              <TableRow 
                data-testid={`row-account-${parent.id}`}
                className={hasChildren ? "hover-elevate cursor-pointer font-medium" : ""}
                onClick={() => hasChildren && toggleAccount(parent.accountId)}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {hasChildren && (
                      isExpanded ? 
                        <ChevronDown className="h-4 w-4" /> : 
                        <ChevronRight className="h-4 w-4" />
                    )}
                    <span>{parent.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono font-medium">
                  {formatSmartCurrency(displayBalance)}
                </TableCell>
                {showSide && (
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {parent.balanceSide || "Dr"}
                  </TableCell>
                )}
              </TableRow>
              {hasChildren && isExpanded && nonZeroChildren.map((child) => (
                <TableRow key={child.id} data-testid={`row-account-${child.id}`}>
                  <TableCell className="pl-8 text-muted-foreground">
                    {child.name}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatSmartCurrency(parseBalance(child.balance))}
                  </TableCell>
                  {showSide && (
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {child.balanceSide || "Dr"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </Fragment>
          );
        })}
      </>
    );
  };

  const renderPLAccountTable = (accountList: Account[], showTotal: boolean = true) => {
    if (accountsLoading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }

    if (accountList.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No accounts in this category</p>
        </div>
      );
    }

    const total = calculatePLTotal(accountList);

    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account Name</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountList.map((account) => (
              <TableRow key={account.id}>
                <TableCell>{account.name}</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(account.balance)}
                </TableCell>
              </TableRow>
            ))}
            {showTotal && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(Math.abs(total))}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  const exportRatiosToExcel = () => {
    if (!ratiosData) return;

    const wb = utils.book_new();
    const wsData = [
      ["Financial Ratios Report"],
      [""],
      ["Ratio", "Value"],
      ["Gross Profit Margin", `${formatNumber(ratiosData.ratios.grossProfitMargin)}%`],
      ["Net Profit Margin", `${formatNumber(ratiosData.ratios.netProfitMargin)}%`],
      ["Current Ratio", formatNumber(ratiosData.ratios.currentRatio)],
      ["Debt to Equity", formatNumber(ratiosData.ratios.debtToEquity)],
      [""],
      ["Underlying Data", "Amount"],
      ["Total Income", formatAmount(ratiosData.underlying.totalIncome)],
      ["Total Expenses", formatAmount(ratiosData.underlying.totalExpenses)],
      ["Net Profit", formatAmount(ratiosData.underlying.netProfit)],
      ["Total Assets", formatAmount(ratiosData.underlying.totalAssets)],
      ["Total Liabilities", formatAmount(ratiosData.underlying.totalLiabilities)],
      ["Total Equity", formatAmount(ratiosData.underlying.totalEquity)],
    ];

    const ws = utils.aoa_to_sheet(wsData);
    utils.book_append_sheet(wb, ws, "Financial Ratios");
    writeFile(wb, "financial-ratios.xlsx");

    toast({ title: "Excel Exported", description: "Report downloaded successfully" });
  };

  return (
    <div className="flex h-full">
      <nav className="w-56 shrink-0 border-r bg-muted/30 p-3 space-y-4 overflow-y-auto" data-testid="tabs-analytics">
        {sidebarGroups.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveSection(item.key)}
                    className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors ${isActive ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover-elevate"}`}
                    data-testid={`tab-${item.key}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Comprehensive financial analysis and reporting
            </p>
          </div>
          <PeriodFilter
            value={periodFilter}
            onChange={setPeriodFilter}
            data-testid="analytics-period-filter"
          />
        </div>

        {activeSection === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {!hideAnalyticsFinancials && <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Income</CardTitle>
                <DollarSign className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {profitLoading ? "Loading..." : formatCurrency(profitData?.totalIncome || 0)}
                </div>
              </CardContent>
            </Card>}

            {!hideAnalyticsFinancials && <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {profitLoading ? "Loading..." : formatCurrency(profitData?.totalExpenses || 0)}
                </div>
              </CardContent>
            </Card>}

            {!hideAnalyticsFinancials && <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    (profitData?.netProfit || 0) >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {profitLoading ? "Loading..." : formatCurrency(profitData?.netProfit || 0)}
                </div>
              </CardContent>
            </Card>}
          </div>

          {ratiosData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-6">
                <h3 className="font-medium mb-3">Key Financial Ratios</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Gross Profit Margin</span>
                    <span className="text-sm font-mono font-medium">
                      {formatNumber(ratiosData.ratios.grossProfitMargin)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Net Profit Margin</span>
                    <span className="text-sm font-mono font-medium">
                      {formatNumber(ratiosData.ratios.netProfitMargin)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Current Ratio</span>
                    <span className="text-sm font-mono font-medium">
                      {formatNumber(ratiosData.ratios.currentRatio)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Debt to Equity</span>
                    <span className="text-sm font-mono font-medium">
                      {formatNumber(ratiosData.ratios.debtToEquity)}
                    </span>
                  </div>
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-medium mb-3">Account Balances</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Assets</span>
                    <span className="text-sm font-mono font-medium">
                      {formatSmartCurrency(calculateTotal(assetAccounts))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Liabilities</span>
                    <span className="text-sm font-mono font-medium">
                      {formatSmartCurrency(calculateTotal(liabilityAccounts))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Cash Balance</span>
                    <span className="text-sm font-mono font-medium">
                      {formatSmartCurrency(calculateTotal(cashAccounts))}
                    </span>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
        )}

        {activeSection === "assets" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  Asset Accounts
                </h4>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-xl font-bold font-mono">
                    {formatSmartCurrency(calculateTotal(assetAccounts))}
                  </p>
                </div>
              </div>
              {accountsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : assetAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No asset accounts found
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderHierarchicalAccounts(assetAccounts)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "liabilities" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium flex items-center gap-2">
                  <FileText className="h-5 w-5 text-red-500" />
                  Liability Accounts
                </h4>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-xl font-bold font-mono">
                    {formatSmartCurrency(calculateTotal(liabilityAccounts))}
                  </p>
                </div>
              </div>
              {accountsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : liabilityAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No liability accounts found
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderHierarchicalAccounts(liabilityAccounts)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "cash" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-green-500" />
                  Cash Accounts
                </h4>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total Cash</p>
                  <p className="text-xl font-bold font-mono">
                    {formatSmartCurrency(calculateTotal(cashAccounts))}
                  </p>
                </div>
              </div>
              {accountsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : cashAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No cash accounts found
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Side</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderHierarchicalAccounts(cashAccounts, true)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "expenses" && (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <TrendingDown className="h-5 w-5 text-destructive" />
                    All Expense Accounts
                  </h3>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold font-mono">
                      {formatSmartCurrency(calculateTotal(expenseAccounts))}
                    </p>
                  </div>
                </div>
                {accountsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : expenseAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No expense accounts found
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renderHierarchicalAccounts(expenseAccounts)}
                    </TableBody>
                  </Table>
                )}
              </Card>
        )}

        {activeSection === "direct-expenses" && (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-red-500" />
                    Direct Expense Accounts
                  </h3>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold font-mono">
                      {formatSmartCurrency(calculateTotal(directExpenseAccounts))}
                    </p>
                  </div>
                </div>
                {accountsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : directExpenseAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No direct expense accounts found
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renderHierarchicalAccounts(directExpenseAccounts)}
                    </TableBody>
                  </Table>
                )}
              </Card>
        )}

        {activeSection === "indirect-expenses" && (
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <FileText className="h-5 w-5 text-orange-500" />
                    Indirect Expense Accounts
                  </h3>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold font-mono">
                      {formatSmartCurrency(calculateTotal(indirectExpenseAccounts))}
                    </p>
                  </div>
                </div>
                {accountsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : indirectExpenseAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No indirect expense accounts found
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {renderHierarchicalAccounts(indirectExpenseAccounts)}
                    </TableBody>
                  </Table>
                )}
              </Card>
        )}

        {activeSection === "sales" && (<>
          <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-lg font-medium">Sales by Location</h3>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {salesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : salesData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No sales data available
              </p>
            ) : (
              <>
              <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesData.map((location) => (
                    <TableRow key={location.locationId}>
                      <TableCell className="font-medium">{location.locationName}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatAmount(location.totalSales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {location.totalTransactions}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedLocationForDetails(location.locationId)}
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              <div className="md:hidden space-y-3">
                {salesData.map((location) => (
                  <Card key={location.locationId} className="hover-elevate cursor-pointer" onClick={() => setSelectedLocationForDetails(location.locationId)}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{location.locationName}</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex items-center justify-between mt-2 text-sm">
                        <span className="text-muted-foreground">Sales: <span className="font-mono text-foreground">{formatAmount(location.totalSales)}</span></span>
                        <span className="text-muted-foreground">Txns: <span className="text-foreground">{location.totalTransactions}</span></span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              </>
            )}
          </Card>

          {/* Sales Details Dialog */}
          <Dialog 
            open={selectedLocationForDetails !== null} 
            onOpenChange={(open) => !open && setSelectedLocationForDetails(null)}
          >
            <DialogContent className="max-w-4xl w-[95vw] md:w-auto max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  Sales Details - {salesData.find(l => l.locationId === selectedLocationForDetails)?.locationName}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <Select value={detailsPeriod} onValueChange={setDetailsPeriod}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="year">This Year</SelectItem>
                  </SelectContent>
                </Select>

                {transactionsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : transactions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No transactions found
                  </p>
                ) : (
                  <>
                    <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Voucher</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Items</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((transaction) => (
                          <TableRow key={transaction.id}>
                            <TableCell className="font-mono text-sm">
                              {transaction.voucherNumber}
                            </TableCell>
                            <TableCell>
                              {new Date(transaction.voucherDate).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {transaction.itemCount}
                            </TableCell>
                            <TableCell className="text-right">
                              {transaction.totalQuantity}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(transaction.totalAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {transactions.map((transaction) => (
                        <Card key={transaction.id}>
                          <CardContent className="p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-sm">{transaction.voucherNumber}</span>
                              <span className="text-sm text-muted-foreground">{new Date(transaction.voucherDate).toLocaleDateString()}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Items: {transaction.itemCount} | Qty: {transaction.totalQuantity}</span>
                              <span className="font-mono font-medium">{formatAmount(transaction.totalAmount)}</span>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    <div className="border-t pt-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Transactions:</span>
                        <span className="font-medium">{transactions.length}</span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span className="text-muted-foreground">Total Quantity:</span>
                        <span className="font-medium">
                          {transactions.reduce((sum, t) => sum + t.totalQuantity, 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-2">
                        <span className="text-muted-foreground">Total Amount:</span>
                        <span className="font-mono font-medium">
                          {formatAmount(transactions.reduce((sum, t) => sum + t.totalAmount, 0))}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>)}

        {activeSection === "containers" && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Container Report
              </h3>
              <Button
                size="sm"
                onClick={() => refetchContainers()}
                disabled={loadingContainers}
              >
                {loadingContainers ? "Loading..." : "Generate"}
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <Label htmlFor="container-start-date">Start Date</Label>
                <DatePickerInput
                  value={reportStartDate}
                  onChange={setReportStartDate}
                  placeholder="Start date"
                />
              </div>
              <div>
                <Label htmlFor="container-end-date">End Date</Label>
                <DatePickerInput
                  value={reportEndDate}
                  onChange={setReportEndDate}
                  placeholder="End date"
                />
              </div>
              <div>
                <Label htmlFor="container-supplier">Supplier</Label>
                <Select value={reportSupplierId} onValueChange={setReportSupplierId}>
                  <SelectTrigger id="container-supplier">
                    <SelectValue placeholder="All Suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id.toString()}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="container-status">Status</Label>
                <Select value={reportContainerStatus} onValueChange={setReportContainerStatus}>
                  <SelectTrigger id="container-status">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="OTW">OTW</SelectItem>
                    <SelectItem value="In Transit">In Transit</SelectItem>
                    <SelectItem value="Arrived">Arrived</SelectItem>
                    <SelectItem value="Offloaded">Offloaded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingContainers ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : containerData ? (
              <div className="space-y-4">
                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Container #</TableHead>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Import Date</TableHead>
                        <TableHead className="text-right">Items Total</TableHead>
                        <TableHead className="text-right">Charges Total</TableHead>
                        <TableHead className="text-right">Grand Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {containerData.containers.map((container) => (
                        <TableRow key={container.id}>
                          <TableCell className="font-mono">{container.containerNumber}</TableCell>
                          <TableCell>{container.supplierName}</TableCell>
                          <TableCell>{container.status}</TableCell>
                          <TableCell>{container.importDate}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatAmount(parseFloat(container.itemsTotal))}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatAmount(parseFloat(container.chargesTotal))}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatAmount(parseFloat(container.grandTotal))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableBody className="font-semibold border-t-2">
                      <TableRow>
                        <TableCell colSpan={4}>TOTALS</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAmount(containerData.summary.totalItemsTotal)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAmount(containerData.summary.totalChargesTotal)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAmount(containerData.summary.totalGrandTotal)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden space-y-3">
                  {containerData.containers.map((container) => (
                    <Card key={container.id}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium">{container.containerNumber}</span>
                          <span className="text-sm text-muted-foreground">{container.status}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">{container.supplierName} - {container.importDate}</div>
                        <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t">
                          <div>
                            <span className="text-muted-foreground block">Items</span>
                            <span className="font-mono">{formatAmount(parseFloat(container.itemsTotal))}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Charges</span>
                            <span className="font-mono">{formatAmount(parseFloat(container.chargesTotal))}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-muted-foreground block">Total</span>
                            <span className="font-mono font-semibold">{formatAmount(parseFloat(container.grandTotal))}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <Card className="bg-muted/50">
                    <CardContent className="p-4">
                      <div className="font-bold text-sm mb-2">TOTALS</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground block">Items</span>
                          <span className="font-mono font-semibold">{formatAmount(containerData.summary.totalItemsTotal)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Charges</span>
                          <span className="font-mono font-semibold">{formatAmount(containerData.summary.totalChargesTotal)}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-muted-foreground block">Grand Total</span>
                          <span className="font-mono font-semibold">{formatAmount(containerData.summary.totalGrandTotal)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No data available. Click Generate to load report.
              </div>
            )}
          </Card>
        )}

        {activeSection === "reports" && (
        <div className="space-y-4">
          {/* Net Profit Report - Tally Prime style */}
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Net Profit (P&L Statement)
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="pl-start-date" className="text-sm whitespace-nowrap">From:</Label>
                  <Input
                    id="pl-start-date"
                    type="date"
                    value={plStartDate}
                    onChange={(e) => setPlStartDate(e.target.value)}
                    className="w-36"
                    data-testid="input-pl-start-date"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="pl-end-date" className="text-sm whitespace-nowrap">To:</Label>
                  <Input
                    id="pl-end-date"
                    type="date"
                    value={plEndDate}
                    onChange={(e) => setPlEndDate(e.target.value)}
                    className="w-36"
                    data-testid="input-pl-end-date"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPlStartDate("");
                    setPlEndDate("");
                  }}
                  data-testid="button-pl-clear-dates"
                >
                  Clear
                </Button>
              </div>
            </div>
            
            {/* Show date range info */}
            {(plStartDate || plEndDate) && (
              <div className="text-sm text-muted-foreground mb-4">
                Showing data for: {plStartDate || "Beginning"} to {plEndDate || "Present"}
              </div>
            )}

            {loadingNetProfit ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : netProfitData ? (
              <div className="space-y-6">
                {/* Net Profit Summary — matches Dashboard "Net Profit" */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="border rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Total Income</p>
                    <p className="text-xl font-bold text-green-600 font-mono">
                      {profitLoading ? "..." : formatAmount(profitData?.totalIncome || 0)}
                    </p>
                  </div>
                  <div className="border rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Total Expenses</p>
                    <p className="text-xl font-bold text-red-600 font-mono">
                      {profitLoading ? "..." : formatAmount(profitData?.totalExpenses || 0)}
                    </p>
                  </div>
                  <div className={`border-2 rounded-lg p-4 text-center ${(profitData?.netPosition || 0) >= 0 ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-red-500 bg-red-50 dark:bg-red-950/20'}`}>
                    <p className="text-sm text-muted-foreground mb-1">Net Profit</p>
                    <p className={`text-xl font-bold font-mono ${(profitData?.netPosition || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {profitLoading ? "..." : formatAmount(Math.abs(profitData?.netPosition || 0))}
                      {(profitData?.netPosition || 0) < 0 && ' (Loss)'}
                    </p>
                  </div>
                </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Pane */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 p-3 border-b">
                    <span className="font-semibold">Particulars</span>
                  </div>
                  <div className="divide-y">
                    {/* Opening Stock */}
                    <div 
                      className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                      onClick={() => navigate("/opening-stock")}
                      data-testid="row-opening-stock"
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-4 w-4" />
                        Opening Stock
                      </span>
                      <span className="font-mono">{formatAmount(netProfitData.leftPane.openingStock.value)}</span>
                    </div>

                    {/* Purchase Accounts */}
                    <div>
                      <div 
                        className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                        onClick={() => toggleNetProfitSection("purchaseAccounts")}
                        data-testid="row-purchase-accounts"
                      >
                        <span className="flex items-center gap-2">
                          {expandedNetProfitSections.has("purchaseAccounts") ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          Purchase Accounts
                          {netProfitData.leftPane.purchaseAccounts.count > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({netProfitData.leftPane.purchaseAccounts.count})
                            </span>
                          )}
                        </span>
                        <span className="font-mono">{formatAmount(netProfitData.leftPane.purchaseAccounts.total)}</span>
                      </div>
                      {expandedNetProfitSections.has("purchaseAccounts") && netProfitData.leftPane.purchaseAccounts.accounts.length > 0 && (
                        <div className="bg-muted/30 divide-y">
                          {netProfitData.leftPane.purchaseAccounts.accounts.filter((acc) => Number(acc.debit) !== 0 || Number(acc.credit) !== 0).map((acc) => (
                            <div 
                              key={acc.id} 
                              className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground cursor-pointer hover-elevate"
                              onClick={() => navigate(`/ledger-monthly/${acc.id}`)}
                              data-testid={`row-purchase-account-${acc.id}`}
                            >
                              <span className="flex items-center gap-2">
                                <ChevronRight className="h-3 w-3" />
                                {acc.name}
                              </span>
                              <span className="font-mono">
                                Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Direct Incomes - Moved to Right Pane (Credit side) */}
                    {(netProfitData.rightPane?.directIncomes?.accounts?.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length ?? 0) > 0 && (
                      <div>
                        <div 
                          className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                          onClick={() => toggleNetProfitSection("directIncomes")}
                          data-testid="row-direct-incomes"
                        >
                          <span className="flex items-center gap-2">
                            {expandedNetProfitSections.has("directIncomes") ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            Direct Incomes
                            <span className="text-xs text-muted-foreground">
                              ({netProfitData.rightPane!.directIncomes.accounts.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length})
                            </span>
                          </span>
                          <span className="font-mono">{formatAmount(netProfitData.rightPane!.directIncomes.total)}</span>
                        </div>
                        {expandedNetProfitSections.has("directIncomes") && (
                          <div className="bg-muted/30 divide-y">
                            {netProfitData.rightPane!.directIncomes.accounts.filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0).map((acc) => (
                              <div key={acc.id} className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground">
                                <span>{acc.name}</span>
                                <span className="font-mono">
                                  Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Direct Expenses */}
                    {netProfitData.leftPane.directExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length > 0 && (
                      <div>
                        <div 
                          className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                          onClick={() => toggleNetProfitSection("directExpenses")}
                          data-testid="row-direct-expenses"
                        >
                          <span className="flex items-center gap-2">
                            {expandedNetProfitSections.has("directExpenses") ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            Direct Expenses
                            <span className="text-xs text-muted-foreground">
                              ({netProfitData.leftPane.directExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0).length})
                            </span>
                          </span>
                          <span className="font-mono">{formatAmount(netProfitData.leftPane.directExpenses.total)}</span>
                        </div>
                        {expandedNetProfitSections.has("directExpenses") && (
                          <div className="bg-muted/30 divide-y">
                            {netProfitData.leftPane.directExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0).map((acc) => (
                              <div key={acc.id} className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground">
                                <span>{acc.name}</span>
                                <span className="font-mono">
                                  Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Total */}
                    <div className="flex justify-between items-center p-3 bg-primary/10 font-semibold border-t-2">
                      <span>Total</span>
                      <span className="font-mono">{formatAmount(netProfitData.leftPane.tradingTotal)}</span>
                    </div>

                    {/* Separator */}
                    <div className="h-4 bg-muted/30"></div>

                    {/* Indirect Expenses */}
                    <div>
                      {(() => {
                        const nonZeroIndirectExp = netProfitData.leftPane.indirectExpenses.accounts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
                        return (
                          <>
                            <div 
                              className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                              onClick={() => toggleNetProfitSection("indirectExpenses")}
                              data-testid="row-indirect-expenses"
                            >
                              <span className="flex items-center gap-2">
                                {expandedNetProfitSections.has("indirectExpenses") ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                Indirect Expenses
                                {nonZeroIndirectExp.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    ({nonZeroIndirectExp.length})
                                  </span>
                                )}
                              </span>
                              <span className="font-mono">{formatAmount(netProfitData.leftPane.indirectExpenses.total)}</span>
                            </div>
                            {expandedNetProfitSections.has("indirectExpenses") && nonZeroIndirectExp.length > 0 && (
                              <div className="bg-muted/30 divide-y">
                                {nonZeroIndirectExp.map((acc) => (
                                  <div key={acc.id} className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground">
                                    <span>{acc.name}</span>
                                    <span className="font-mono">
                                      Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Net Profit */}
                    <div className="flex justify-between items-center p-3 bg-primary/20 font-bold">
                      <span>Net Profit</span>
                      <span className={`font-mono ${(profitData?.netPosition ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatAmount(Math.abs(profitData?.netPosition ?? 0))}
                        {(profitData?.netPosition ?? 0) < 0 && ' (Loss)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Pane */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 p-3 border-b">
                    <span className="font-semibold">Particulars</span>
                  </div>
                  <div className="divide-y">
                    {/* Sales Accounts */}
                    <div 
                      className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                      onClick={() => setActiveSection("sales")}
                      data-testid="row-sales-accounts"
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-4 w-4" />
                        Sales Accounts
                      </span>
                      <span className="font-mono">{formatAmount(netProfitData.rightPane?.salesAccounts?.total || 0)}</span>
                    </div>

                    {/* Closing Stock */}
                    <div 
                      className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                      onClick={() => navigate("/closing-stock-summary")}
                      data-testid="row-closing-stock"
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-4 w-4" />
                        Closing Stock
                      </span>
                      <span className="font-mono">{formatAmount(netProfitData.rightPane?.closingStock?.value || 0)}</span>
                    </div>

                    {/* Empty spacer rows to match left pane */}
                    <div className="h-10 bg-muted/10"></div>
                    <div className="h-10 bg-muted/10"></div>

                    {/* Total */}
                    <div className="flex justify-between items-center p-3 bg-primary/10 font-semibold border-t-2">
                      <span>Total</span>
                      <span className="font-mono">{formatAmount(netProfitData.rightPane?.total || 0)}</span>
                    </div>

                    {/* Separator */}
                    <div className="h-4 bg-muted/30"></div>

                    {/* Indirect Incomes */}
                    <div>
                      {(() => {
                        const nonZeroIndirectInc = (netProfitData.rightPane?.indirectIncomes?.accounts || []).filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
                        return (
                          <>
                            <div 
                              className="flex justify-between items-center p-3 cursor-pointer hover-elevate"
                              onClick={() => toggleNetProfitSection("indirectIncomes")}
                              data-testid="row-indirect-incomes"
                            >
                              <span className="flex items-center gap-2">
                                {expandedNetProfitSections.has("indirectIncomes") ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                Indirect Incomes
                                {nonZeroIndirectInc.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    ({nonZeroIndirectInc.length})
                                  </span>
                                )}
                              </span>
                              <span className="font-mono">{formatAmount(netProfitData.rightPane?.indirectIncomes?.total || 0)}</span>
                            </div>
                            {expandedNetProfitSections.has("indirectIncomes") && nonZeroIndirectInc.length > 0 && (
                              <div className="bg-muted/30 divide-y">
                                {nonZeroIndirectInc.map((acc: any) => (
                                  <div 
                                    key={acc.id} 
                                    className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground cursor-pointer hover-elevate"
                                    onClick={() => navigate(`/ledger-monthly/${acc.id}`)}
                                    data-testid={`row-indirect-income-${acc.id}`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <ChevronRight className="h-3 w-3" />
                                      {acc.name}
                                    </span>
                                    <span className="font-mono">
                                      Dr: {formatAmount(acc.debit)} | Cr: {formatAmount(acc.credit)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {/* Net Profit (display only - matches left pane) */}
                    <div className="flex justify-between items-center p-3 bg-primary/20 font-bold">
                      <span>Net Profit</span>
                      <span className={`font-mono ${(profitData?.netPosition ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatAmount(Math.abs(profitData?.netPosition ?? 0))}
                        {(profitData?.netPosition ?? 0) < 0 && ' (Loss)'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No data available.
              </div>
            )}
          </Card>
        </div>
        )}
      </div>
    </div>
  );
}
