import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
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
  TrendingDown, 
  DollarSign, 
  Wallet, 
  Package,
  FileText,
  ChevronRight,
  ChevronDown,
  Download,
  RefreshCw,
  ShoppingCart,
  Container as ContainerIcon,
  Landmark,
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
  offloadDate: string | null;
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
  const { formatDisplayDate } = useDateFormat();
  const appMode = useAppMode();
  const modeApiRequest = getApiRequest(appMode);
  const { selectedCompany } = useCompany();
  const { toast } = useToast();
  const { formatAmount } = useCurrencyContext();
  const [, navigate] = useLocation();
  const { data: myErpPages } = useQuery<{ hiddenErpCostFields?: string[] }>({ queryKey: ["/api/my-erp-pages"] });
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const [detailsPeriod, setDetailsPeriod] = useState("month");
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
  const [reportAllCompanies, setReportAllCompanies] = useState("current");
  
  // Opening Stock Summary state
  const [openingStockLocationId, setOpeningStockLocationId] = useState("all");
  const [expandedStockGroups, setExpandedStockGroups] = useState<Set<number>>(new Set());
  const [stockGroupItems, setStockGroupItems] = useState<Map<number, OpeningStockItemsData>>(new Map());
  
  // Net Profit Report state
  const [expandedNetProfitSections, setExpandedNetProfitSections] = useState<Set<string>>(new Set());
  const [plStartDate, setPlStartDate] = useState("");
  const [plEndDate, setPlEndDate] = useState("");

  // Factory-specific filters
  const [factoryContainerCustomerId, setFactoryContainerCustomerId] = useState("all");
  const [factoryContainerStartDate, setFactoryContainerStartDate] = useState("");
  const [factoryContainerEndDate, setFactoryContainerEndDate] = useState("");
  const [factoryContainerPaymentStatus, setFactoryContainerPaymentStatus] = useState("all");
  const [expandedCustomerRows, setExpandedCustomerRows] = useState<Set<number>>(new Set());
  
  const [activeSection, setActiveSection] = useState("reports");

  const sidebarGroups: { label: string; items: { key: string; label: string; icon: LucideIcon }[] }[] = [
    {
      label: "Financial Summary",
      items: [
        { key: "reports", label: "Net Profit (P&L)", icon: DollarSign },
      ],
    },
    {
      label: "Account Balances",
      items: [
        { key: "assets", label: "Assets", icon: Package },
        { key: "liabilities", label: "Liabilities", icon: FileText },
        { key: "cash", label: "Cash", icon: Wallet },
        { key: "loans-banks", label: "Loans / Banks", icon: Landmark },
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
    if (reportAllCompanies === "all") params.append("allCompanies", "true");
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

  // ── Factory Analytics Queries ───────────────────────────────────────────
  const { data: factorySalesByCustomer = [], isLoading: loadingFactorySales } = useQuery<any[]>({
    queryKey: ["/api/factory/analytics/sales-by-customer", selectedCompany?.id],
    queryFn: async () => {
      const res = await fetch("/api/factory/analytics/sales-by-customer", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory sales");
      return res.json();
    },
    enabled: !!selectedCompany && appMode === "factory",
  });

  const buildFactoryContainerSalesUrl = () => {
    const params = new URLSearchParams();
    if (factoryContainerStartDate) params.append("startDate", factoryContainerStartDate);
    if (factoryContainerEndDate) params.append("endDate", factoryContainerEndDate);
    if (factoryContainerCustomerId && factoryContainerCustomerId !== "all") params.append("customerId", factoryContainerCustomerId);
    if (factoryContainerPaymentStatus && factoryContainerPaymentStatus !== "all") params.append("paymentStatus", factoryContainerPaymentStatus);
    return `/api/factory/analytics/container-sales-report?${params}`;
  };

  const { data: factoryContainerSales, refetch: refetchFactoryContainerSales, isLoading: loadingFactoryContainerSales } = useQuery<any>({
    queryKey: [buildFactoryContainerSalesUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const res = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory container sales");
      return res.json();
    },
    enabled: appMode === "factory" && false, // Manual trigger
  });

  const { data: factoryStockSummary } = useQuery<any>({
    queryKey: ["/api/factory/analytics/stock-summary", selectedCompany?.id],
    queryFn: async () => {
      const res = await fetch("/api/factory/analytics/stock-summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory stock summary");
      return res.json();
    },
    enabled: !!selectedCompany && appMode === "factory",
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
    const isWhole = Math.abs(value) % 1 === 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: 2,
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

  const loansBanksAccounts = accounts.filter(
    (acc) =>
      acc.type === "bank" ||
      (acc.type === "ledger" && acc.accountType === "Loans")
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Pane */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 p-3 border-b">
                    <span className="font-semibold">Particulars</span>
                  </div>
                  <div className="divide-y">
                    {/* Opening Stock */}
                    <div 
                      className={`flex justify-between items-center p-3 ${appMode !== "factory" ? "cursor-pointer hover-elevate" : ""}`}
                      onClick={() => appMode !== "factory" && navigate("/opening-stock")}
                      data-testid="row-opening-stock"
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-4 w-4" />
                        Opening Stock
                      </span>
                      <span className="font-mono">
                        {appMode === "factory"
                          ? formatAmount(factoryStockSummary?.openingStock ?? 0)
                          : formatAmount(netProfitData.leftPane.openingStock.value)}
                      </span>
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
                      className={`flex justify-between items-center p-3 ${appMode !== "factory" ? "cursor-pointer hover-elevate" : ""}`}
                      onClick={() => appMode !== "factory" && navigate("/closing-stock-summary")}
                      data-testid="row-closing-stock"
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight className="h-4 w-4" />
                        Closing Stock
                      </span>
                      <span className="font-mono">
                        {appMode === "factory"
                          ? formatAmount(factoryStockSummary?.closingStock ?? 0)
                          : formatAmount(netProfitData.rightPane?.closingStock?.value || 0)}
                      </span>
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
