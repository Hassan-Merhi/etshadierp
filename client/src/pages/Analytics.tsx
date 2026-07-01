import { useState, useEffect, useRef, Fragment } from "react";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { useQuery } from "@tanstack/react-query";
import { useDateFormat } from "@/contexts/DateFormatContext";
import { useLocation } from "wouter";
import { useCompany } from "@/contexts/CompanyContext";
import { useCurrencyContext } from "@/contexts/CurrencyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { PeriodFilter, PeriodFilterValue, getDefaultPeriodValue } from "@/components/ui/period-filter";
import { useDateJump } from "@/hooks/use-date-jump";
import { PageHeader } from "@/components/PageHeader";
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
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { utils, writeFile, readFile, ExcelJS } from "@/lib/excelHelper";
import { formatNumber, drCrClass } from "@/lib/formatNumber";
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
  customerId?: number;
}

interface LocationSales {
  locationId: number;
  locationName: string;
  locationCode: string;
  totalSales: number;
  totalTransactions: number;
  totalQuantity: number;
}

interface POSTransaction {
  id: number;
  voucherNumber: string;
  voucherDate: string;
  createdAt: string;
  description: string | null;
  customerName: string | null;
  cashAccountName: string | null;
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

interface ReportContainer {
  id: number;
  containerNumber: string;
  supplierName: string;
  status: string;
  importDate: string | null;
  offloadDate: string | null;
  itemsTotal: string;
  chargesTotal: string;
  grandTotal: string;
  companyId: number;
  companyName: string;
}

interface ContainerData {
  containers: ReportContainer[];
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
  parentId?: number;
}

interface NetProfitStatementData {
  netPosition: number;
  openingBalancesNet?: number | null;
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

function formatSmartNumber(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return "";
  const value = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(value)) return "";
  const isWholeNumber = value % 1 === 0;
  if (isWholeNumber) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [detailsPeriod, setDetailsPeriod] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilterValue>(() => getDefaultPeriodValue("all_time"));
  useDateJump((date) => setPeriodFilter({ fromDate: date, toDate: date, preset: "custom" }));
  const [selectedLocationForDetails, setSelectedLocationForDetails] = useState<number | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<number>>(new Set());

  // Report filters
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportLocationId, setReportLocationId] = useState("all");
  const [reportStockGroupId, setReportStockGroupId] = useState("all");
  const [reportSupplierId, setReportSupplierId] = useState("all");
  const [reportContainerStatus, setReportContainerStatus] = useState("Offloaded");
  const [reportAllCompanies, setReportAllCompanies] = useState("all");
  const [containerPeriodFilter, setContainerPeriodFilter] = useState<PeriodFilterValue>(() =>
    getDefaultPeriodValue("this_month")
  );
  const containerCompanyInitialized = useRef(false);
  useEffect(() => {
    if (!containerCompanyInitialized.current && selectedCompany?.id) {
      setReportAllCompanies(String(selectedCompany.id));
      containerCompanyInitialized.current = true;
    }
  }, [selectedCompany?.id]);

  // Opening Stock Summary state
  const [openingStockLocationId, setOpeningStockLocationId] = useState("all");
  const [expandedStockGroups, setExpandedStockGroups] = useState<Set<number>>(new Set());
  const [stockGroupItems, setStockGroupItems] = useState<Map<number, OpeningStockItemsData>>(new Map());

  // Net Profit Report state
  const [expandedNetProfitSections, setExpandedNetProfitSections] = useState<Set<string>>(new Set());

  // Derive P&L and Balance date filters from the global period filter
  const plStartDate = periodFilter.fromDate;
  const plEndDate = periodFilter.toDate;
  const balStartDate = periodFilter.fromDate;
  const balEndDate = periodFilter.toDate;

  // Factory-specific filters
  const [factoryContainerCustomerId, setFactoryContainerCustomerId] = useState("all");
  const [factoryContainerStartDate, setFactoryContainerStartDate] = useState("");
  const [factoryContainerEndDate, setFactoryContainerEndDate] = useState("");
  const [factoryContainerPaymentStatus, setFactoryContainerPaymentStatus] = useState("all");
  const [expandedCustomerRows, setExpandedCustomerRows] = useState<Set<number>>(new Set());

  const [activeSection, setActiveSection] = useState("assets");
  useEscapeBack(activeSection !== "assets" ? () => setActiveSection("assets") : null);

  const sidebarGroups: { label: string; items: { key: string; label: string; icon: LucideIcon }[] }[] = [
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

  // Fetch reference data — locations and stock groups are shared across sections.
  // staleTime avoids redundant refetches when the user navigates between sections.
  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations", selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
    enabled: !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });
  const { data: stockGroups = [] } = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups", selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock groups");
      return response.json();
    },
    enabled: !!selectedCompany,
    staleTime: 5 * 60 * 1000,
  });
  // Suppliers are only used in the Container Report filter — defer until that section opens.
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const response = await fetch("/api/suppliers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      return response.json();
    },
    enabled: !!selectedCompany && activeSection === "containers",
    staleTime: 5 * 60 * 1000,
  });

  // Fetch all accounts (with optional date filter for balance sections)
  const { data: accounts = [], isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompany?.id, balStartDate, balEndDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (balStartDate) params.append("startDate", balStartDate);
      if (balEndDate) params.append("endDate", balEndDate);
      const url = `/api/accounts/all${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch accounts");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // Fetch sales data
  const getDateRange = () => {
    const today = new Date();
    let startDate = "";
    let endDate = today.toLocaleDateString("en-CA");
    if (selectedPeriod === "today") {
      startDate = endDate;
    } else if (selectedPeriod === "month") {
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      startDate = firstDayOfMonth.toLocaleDateString("en-CA");
      endDate = lastDayOfMonth.toLocaleDateString("en-CA");
    } else if (selectedPeriod === "year") {
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      startDate = firstDayOfYear.toLocaleDateString("en-CA");
    } else if (selectedPeriod === "range") {
      if (!rangeStart || !rangeEnd) return {};
      return { startDate: rangeStart, endDate: rangeEnd };
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
    let endDate = today.toLocaleDateString("en-CA");
    if (detailsPeriod === "today") {
      startDate = endDate;
    } else if (detailsPeriod === "month") {
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      startDate = firstDayOfMonth.toLocaleDateString("en-CA");
      endDate = lastDayOfMonth.toLocaleDateString("en-CA");
    } else if (detailsPeriod === "year") {
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      startDate = firstDayOfYear.toLocaleDateString("en-CA");
    }
    return detailsPeriod === "all" ? {} : { startDate, endDate };
  };

  const detailsDateRange = getDetailsDateRange();
  const { data: transactions = [], isLoading: transactionsLoading } = useQuery<POSTransaction[]>({
    queryKey: ["/api/financial/sales", selectedLocationForDetails, "transactions", detailsDateRange],
    queryFn: async () => {
      const params = new URLSearchParams(detailsDateRange as Record<string, string>);
      const response = await fetch(`/api/financial/sales/${selectedLocationForDetails}/transactions?${params}`, {
        credentials: "include",
      });
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

  const {
    data: stockMovementData,
    refetch: refetchStockMovement,
    isLoading: loadingStock,
  } = useQuery<StockMovementData>({
    queryKey: [buildStockMovementUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock movement");
      return response.json();
    },
    enabled: true,
  });

  // Fetch user's accessible companies for the Container Report company filter
  const { data: userCompanies = [] } = useQuery<{ companyId: number; companyName: string }[]>({
    queryKey: ["/api/user/companies"],
    queryFn: async () => {
      const res = await fetch("/api/user/companies", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch container report
  const buildContainerUrl = () => {
    const params = new URLSearchParams();
    if (containerPeriodFilter.fromDate) params.append("startDate", containerPeriodFilter.fromDate);
    if (containerPeriodFilter.toDate) params.append("endDate", containerPeriodFilter.toDate);
    if (reportSupplierId && reportSupplierId !== "all") params.append("supplierId", reportSupplierId);
    // Status is always set (Offloaded or OTW)
    params.append("status", reportContainerStatus);
    if (reportAllCompanies === "all") {
      params.append("allCompanies", "true");
    } else {
      params.append("specificCompanyId", reportAllCompanies);
    }
    return `/api/reports/containers?${params}`;
  };

  const {
    data: containerData,
    refetch: refetchContainers,
    isLoading: loadingContainers,
  } = useQuery<ContainerData>({
    queryKey: [buildContainerUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch containers");
      return response.json();
    },
    enabled: !!selectedCompany,
  });

  // ── Factory Analytics Queries ───────────────────────────────────────────
  const [factorySalesStartDate, setFactorySalesStartDate] = useState("");
  const [factorySalesEndDate, setFactorySalesEndDate] = useState("");

  const buildFactorySalesUrl = (base: string) => {
    const params = new URLSearchParams();
    if (factorySalesStartDate) params.append("startDate", factorySalesStartDate);
    if (factorySalesEndDate) params.append("endDate", factorySalesEndDate);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const { data: factorySalesByCustomer = [], isLoading: loadingFactorySales } = useQuery<any[]>({
    queryKey: [
      "/api/factory/analytics/sales-by-customer",
      selectedCompany?.id,
      factorySalesStartDate,
      factorySalesEndDate,
    ],
    queryFn: async () => {
      const res = await fetch(buildFactorySalesUrl("/api/factory/analytics/sales-by-customer"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch factory sales");
      return res.json();
    },
    enabled: !!selectedCompany && appMode === "factory",
  });

  const { data: factoryPosSummary, isLoading: loadingFactoryPos } = useQuery<any>({
    queryKey: ["/api/factory/analytics/pos-summary", selectedCompany?.id, factorySalesStartDate, factorySalesEndDate],
    queryFn: async () => {
      const res = await fetch(buildFactorySalesUrl("/api/factory/analytics/pos-summary"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory POS summary");
      return res.json();
    },
    enabled: !!selectedCompany && appMode === "factory",
  });

  const buildFactoryContainerSalesUrl = () => {
    const params = new URLSearchParams();
    if (factoryContainerStartDate) params.append("startDate", factoryContainerStartDate);
    if (factoryContainerEndDate) params.append("endDate", factoryContainerEndDate);
    if (factoryContainerCustomerId && factoryContainerCustomerId !== "all")
      params.append("customerId", factoryContainerCustomerId);
    if (factoryContainerPaymentStatus && factoryContainerPaymentStatus !== "all")
      params.append("paymentStatus", factoryContainerPaymentStatus);
    return `/api/factory/analytics/container-sales-report?${params}`;
  };

  const {
    data: factoryContainerSales,
    refetch: refetchFactoryContainerSales,
    isLoading: loadingFactoryContainerSales,
  } = useQuery<any>({
    queryKey: [buildFactoryContainerSalesUrl(), selectedCompany?.id],
    queryFn: async ({ queryKey }) => {
      const res = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory container sales");
      return res.json();
    },
    enabled: appMode === "factory",
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

  // Fetch Net Profit Statement
  const { data: netProfitData, isLoading: loadingNetProfit } = useQuery<NetProfitStatementData>({
    queryKey: ["/api/reports/net-profit-statement", selectedCompany?.id, plStartDate, plEndDate],
    queryFn: async ({ queryKey }) => {
      const [base, , startDate, endDate] = queryKey as [string, unknown, string, string];
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      const url = `${base}${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
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
          const response = await fetch(`/api/reports/opening-stock-summary/${groupId}/items?${params}`, {
            credentials: "include",
          });
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
    const accountIdsInList = new Set(accountList.map((acc) => acc.accountId));
    const parentAccounts: Account[] = [];
    const childAccounts: Account[] = [];

    accountList.forEach((acc) => {
      if (!acc.parentId || !accountIdsInList.has(acc.parentId)) {
        parentAccounts.push(acc);
      } else {
        childAccounts.push(acc);
      }
    });

    const accountMap = new Map<number, Account[]>();
    childAccounts.forEach((child) => {
      const parentId = child.parentId!;
      if (!accountMap.has(parentId)) {
        accountMap.set(parentId, []);
      }
      accountMap.get(parentId)!.push(child);
    });

    return { parentAccounts, accountMap };
  };

  const parseBalance = (balance: number | string): number => {
    if (typeof balance === "string") {
      return parseFloat(balance) || 0;
    }
    return balance || 0;
  };

  const calculateChildrenTotal = (parentAccountId: number, accountMap: Map<number, Account[]>) => {
    const children = accountMap.get(parentAccountId) || [];
    return children.reduce((sum, acc) => sum + parseBalance(acc.balance), 0);
  };

  // Returns a signed balance: Cr = positive, Dr = negative
  const signedBalance = (acc: Account) =>
    acc.balanceSide === "Cr" ? parseBalance(acc.balance) : -parseBalance(acc.balance);

  const calculateTotal = (accountList: Account[]) => {
    // Get all account IDs that are present in this list
    const accountIds = new Set(accountList.map((acc) => acc.accountId));

    // Get all account IDs that are parents (have children in this list)
    const parentAccountIds = new Set(accountList.filter((acc) => acc.parentId).map((acc) => acc.parentId!));

    // For parent accounts that have children in the list, sum their children only (not the parent)
    // For accounts without children, include the account itself
    // For child accounts whose parent is also in the list, skip them (they're counted via their parent's children total)
    let total = 0;

    accountList.forEach((acc) => {
      const hasChildrenInList = parentAccountIds.has(acc.accountId);
      const isChildOfParentInList = acc.parentId && accountIds.has(acc.parentId);

      if (hasChildrenInList) {
        // This is a parent with children - count the children's total (not the parent's balance)
        const children = accountList.filter((child) => child.parentId === acc.accountId);
        total += children.reduce((sum, child) => sum + signedBalance(child), 0);
      } else if (!isChildOfParentInList) {
        // This is a standalone account (not a child of something in the list) - count its balance
        total += signedBalance(acc);
      }
      // If it's a child of a parent in the list, don't count it separately (already counted via parent)
    });

    return total;
  };

  // Absolute total: sums displayed (absolute) balances with hierarchical deduplication.
  // Used for Cash, Loans/Banks, Assets, Liabilities sections so the footer total
  // always equals the sum of what is shown in each individual row.
  const calculateAbsoluteTotal = (accountList: Account[]) => {
    const accountIds = new Set(accountList.map((acc) => acc.accountId));
    const parentAccountIds = new Set(accountList.filter((acc) => acc.parentId).map((acc) => acc.parentId!));
    let total = 0;
    accountList.forEach((acc) => {
      const hasChildrenInList = parentAccountIds.has(acc.accountId);
      const isChildOfParentInList = acc.parentId && accountIds.has(acc.parentId);
      if (hasChildrenInList) {
        const children = accountList.filter((child) => child.parentId === acc.accountId);
        total += children.reduce((sum, child) => sum + parseBalance(child.balance), 0);
      } else if (!isChildOfParentInList) {
        total += parseBalance(acc.balance);
      }
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
      return "$" + absValue.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }
    return "$" + absValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Filter accounts - Cash accounts are ledger accounts with accountType="Cash"
  // Also include bank-entity accounts whose name/code contains "cash"
  const cashAccounts = accounts.filter(
    (acc) =>
      (acc.type === "ledger" && acc.accountType === "Cash") ||
      (acc.type === "bank" &&
        ((acc.name || "").toLowerCase().includes("cash") || (acc.code || "").toLowerCase().includes("cash")))
  );

  // Ledger accounts typed as "Bank" (e.g. "Roukaya Cash") — shown in Loans/Banks section
  // These are separate from bank-entity accounts (acc.type === "bank")
  const bankTypeLedgerAccounts = accounts.filter((acc) => acc.type === "ledger" && acc.accountType === "Bank");

  const assetAccounts = accounts.filter(
    (acc) => acc.type === "fixedAsset" || (acc.type === "ledger" && acc.accountType === "Asset") || acc.type === "bank"
  );

  // Include all expense accounts in P&L calculations (no exclusions)
  const expenseAccounts = accounts.filter((acc) => {
    if (acc.type !== "ledger") return false;

    // Support both correct format (accountType="Expense") and legacy format
    // (accountType="Indirect Expense" or "Direct Expense")
    const isExpenseAccount =
      acc.accountType === "Expense" || acc.accountType === "Indirect Expense" || acc.accountType === "Direct Expense";

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
      acc.type === "ledger" &&
      (acc.accountType === "Liability" ||
        acc.accountType === "Accounts Payable" ||
        acc.accountType === "Loans" ||
        acc.accountType === "Duty Agent" ||
        acc.accountType === "Transporter Agent")
  );

  const loansBanksAccounts = accounts.filter(
    (acc) =>
      acc.type === "bank" || (acc.type === "ledger" && (acc.accountType === "Loans" || acc.accountType === "Bank"))
  );

  const directIncomeAccounts = accounts.filter(
    (acc) => acc.type === "ledger" && acc.accountType === "Income" && acc.subType === "Direct Income"
  );

  const indirectIncomeAccounts = accounts.filter(
    (acc) => acc.type === "ledger" && acc.accountType === "Income" && acc.subType === "Indirect Income"
  );

  // P&L calculations
  const totalDirectIncome = calculatePLTotal(directIncomeAccounts);
  const totalIndirectIncome = calculatePLTotal(indirectIncomeAccounts);
  const totalIncome = totalDirectIncome + totalIndirectIncome;
  const totalDirectExpense = Math.abs(calculatePLTotal(directExpenseAccounts));
  const totalIndirectExpense = Math.abs(calculatePLTotal(indirectExpenseAccounts));
  const totalExpenses = totalDirectExpense + totalIndirectExpense;

  // Render hierarchical NetProfitAccounts (groups collapse/expand)
  const renderNetProfitAccountsList = (accts: NetProfitAccount[]) => {
    const nonZero = accts.filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
    if (nonZero.length === 0)
      return (
        <TableRow>
          <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
            No transactions in this period
          </TableCell>
        </TableRow>
      );

    // Include group-parent accounts (zero-balance containers) when they have non-zero children
    const nonZeroParentIds = new Set(nonZero.filter((a) => a.parentId).map((a) => a.parentId!));
    const groupParents = accts.filter(
      (a) => nonZeroParentIds.has(a.id) && Number(a.debit) === 0 && Number(a.credit) === 0
    );
    const allVisible = [...nonZero, ...groupParents];

    const acctIds = new Set(allVisible.map((a) => a.id));
    const parents = allVisible.filter((a) => !a.parentId || !acctIds.has(a.parentId));
    const childrenList = allVisible.filter((a) => a.parentId && acctIds.has(a.parentId));
    const childMap = new Map<number, NetProfitAccount[]>();
    childrenList.forEach((c) => {
      if (!childMap.has(c.parentId!)) childMap.set(c.parentId!, []);
      childMap.get(c.parentId!)!.push(c);
    });

    return parents.map((acc) => {
      const kids = childMap.get(acc.id) || [];
      const hasKids = kids.length > 0;
      const isExpanded = expandedAccounts.has(acc.id);
      const displayBalance = hasKids
        ? kids.reduce((s, k) => s + Math.abs(Number(k.balance)), 0)
        : Math.abs(Number(acc.balance));

      return (
        <Fragment key={acc.id}>
          <TableRow
            className="hover-elevate cursor-pointer"
            onClick={() => {
              if (hasKids) toggleAccount(acc.id);
              else goToStatement(acc.id, undefined, "ledger");
            }}
          >
            <TableCell className="text-sm font-medium">
              <div className="flex items-center gap-2">
                {hasKids && (
                  <span className="text-muted-foreground">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                )}
                <span className={hasKids ? "font-semibold" : "hover:underline"}>{acc.name}</span>
              </div>
            </TableCell>
            <TableCell className="text-right font-mono text-sm text-green-600 dark:text-green-400">
              {formatSmartCurrency(displayBalance)}
            </TableCell>
          </TableRow>
          {hasKids &&
            isExpanded &&
            kids.map((child) => (
              <TableRow
                key={child.id}
                className="hover-elevate cursor-pointer"
                onClick={() => goToStatement(child.id, undefined, "ledger")}
              >
                <TableCell className="pl-8 text-sm text-muted-foreground hover:underline">{child.name}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatSmartCurrency(Math.abs(Number(child.balance)))}
                </TableCell>
              </TableRow>
            ))}
        </Fragment>
      );
    });
  };
  const netProfit = totalIncome - totalExpenses;

  const goToStatement = (accountId: number, customerId?: number, accountType?: string) => {
    if (customerId && appMode === "factory") {
      window.open(`/factory/customers/${customerId}`, "_blank");
      return;
    }
    const basePath = appMode === "factory" ? "/factory" : "";
    window.open(`${basePath}/ledger-monthly/${accountId}`, "_blank");
  };

  // Render hierarchical accounts (filters out zero-balance accounts)
  const renderHierarchicalAccounts = (accountList: Account[]) => {
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
          const nonZeroChildren = children.filter((child) => parseBalance(child.balance) !== 0);

          return (
            <Fragment key={parent.id}>
              <TableRow
                data-testid={`row-account-${parent.id}`}
                className={`hover-elevate cursor-pointer font-medium`}
                onClick={() => {
                  if (hasChildren) {
                    toggleAccount(parent.accountId);
                  } else {
                    goToStatement(parent.accountId, parent.customerId, parent.type);
                  }
                }}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {hasChildren ? (
                      <span className="text-muted-foreground">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                    ) : null}
                    <span className={hasChildren ? "" : "hover:underline"}>{parent.name}</span>
                  </div>
                </TableCell>
                <TableCell className={`text-right font-mono font-medium ${drCrClass(parent.balanceSide || "Dr")}`}>
                  {formatSmartCurrency(displayBalance)}
                </TableCell>
              </TableRow>
              {hasChildren &&
                isExpanded &&
                nonZeroChildren.map((child) => (
                  <TableRow
                    key={child.id}
                    data-testid={`row-account-${child.id}`}
                    className="hover-elevate cursor-pointer"
                    onClick={() => goToStatement(child.accountId, child.customerId, child.type)}
                  >
                    <TableCell className="pl-8 text-muted-foreground hover:underline">{child.name}</TableCell>
                    <TableCell className={`text-right font-mono ${drCrClass(child.balanceSide || "Dr")}`}>
                      {formatSmartCurrency(parseBalance(child.balance))}
                    </TableCell>
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
        <EmptyState
          icon={FileText}
          title="No accounts in this category"
          description="Once you add accounts, they will appear here."
        />
      );
    }

    const total = calculatePLTotal(accountList);

    return (
      <div className="rounded-md border table-responsive">
        <Table>
          <TableHeader className="sticky top-0 z-30 bg-background">
            <TableRow>
              <TableHead>Account Name</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accountList.map((account) => (
              <TableRow
                key={account.id}
                className="hover-elevate cursor-pointer"
                onClick={() => goToStatement(account.accountId, account.customerId, account.type)}
              >
                <TableCell className="hover:underline">{account.name}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(account.balance)}</TableCell>
              </TableRow>
            ))}
            {showTotal && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Total</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(Math.abs(total))}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full md:flex-row">
      {/* ── Mobile section selector (shown only on small screens) ── */}
      <div className="md:hidden border-b bg-muted/30 px-3 py-2 shrink-0">
        <Select value={activeSection} onValueChange={setActiveSection}>
          <SelectTrigger className="w-full" data-testid="select-analytics-section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sidebarGroups.map((group) => (
              <Fragment key={group.label}>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </Fragment>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Desktop left nav (hidden on mobile) ── */}
      <nav
        className="hidden md:block w-56 shrink-0 border-r bg-muted/30 p-3 space-y-4 overflow-y-auto"
        data-testid="tabs-analytics"
      >
        {sidebarGroups.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
              {group.label}
            </p>
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

      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <PageHeader title="Analytics" subtitle="Comprehensive financial analysis and reporting" />
          </div>
          {activeSection !== "containers" && (
            <PeriodFilter value={periodFilter} onChange={setPeriodFilter} data-testid="analytics-period-filter" />
          )}
        </div>

        {activeSection === "assets" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Package className="h-4 w-4" />
                  </div>
                  <h4 className="font-semibold text-base">Asset Accounts</h4>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold font-mono tabular-nums">
                    {formatSmartCurrency(calculateAbsoluteTotal(assetAccounts))}
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
                <p className="text-sm text-muted-foreground text-center py-8">No asset accounts found</p>
              ) : (
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderHierarchicalAccounts(assetAccounts)}</TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-bold font-mono">
                          {formatSmartCurrency(calculateAbsoluteTotal(assetAccounts))}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "liabilities" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                    <FileText className="h-4 w-4" />
                  </div>
                  <h4 className="font-semibold text-base">Liability Accounts</h4>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold font-mono tabular-nums">
                    {formatSmartCurrency(calculateAbsoluteTotal(liabilityAccounts))}
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
                <p className="text-sm text-muted-foreground text-center py-8">No liability accounts found</p>
              ) : (
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderHierarchicalAccounts(liabilityAccounts)}</TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-bold font-mono">
                          {formatSmartCurrency(calculateAbsoluteTotal(liabilityAccounts))}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "cash" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-green-500/10 text-green-600 dark:text-green-400">
                    <Wallet className="h-4 w-4" />
                  </div>
                  <h4 className="font-semibold text-base">Cash Accounts</h4>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Cash</p>
                  <p className="text-2xl font-bold font-mono tabular-nums">
                    {formatSmartCurrency(calculateAbsoluteTotal(cashAccounts))}
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
                <p className="text-sm text-muted-foreground text-center py-8">No cash accounts found</p>
              ) : (
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderHierarchicalAccounts(cashAccounts)}</TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total Cash</TableCell>
                        <TableCell className="text-right font-bold font-mono">
                          {formatSmartCurrency(calculateAbsoluteTotal(cashAccounts))}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "loans-banks" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Landmark className="h-4 w-4" />
                  </div>
                  <h4 className="font-semibold text-base">Loans &amp; Bank Accounts</h4>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Total Balance
                  </p>
                  <p className="text-2xl font-bold font-mono tabular-nums">
                    {formatSmartCurrency(calculateAbsoluteTotal(loansBanksAccounts))}
                  </p>
                </div>
              </div>
              {accountsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : loansBanksAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No loan or bank accounts found</p>
              ) : (
                <div className="table-responsive">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Account Name</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderHierarchicalAccounts(loansBanksAccounts)}</TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell className="font-semibold">Total Balance</TableCell>
                        <TableCell className="text-right font-bold font-mono">
                          {formatSmartCurrency(calculateAbsoluteTotal(loansBanksAccounts))}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeSection === "expenses" && (
          <Card className="p-6">
            <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                  <TrendingDown className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-base">All Expense Accounts</h3>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono tabular-nums">
                  {netProfitData
                    ? formatSmartCurrency(
                        (netProfitData.leftPane.directExpenses.total ?? 0) +
                          (netProfitData.leftPane.indirectExpenses.total ?? 0)
                      )
                    : formatSmartCurrency(calculateTotal(expenseAccounts))}
                </p>
              </div>
            </div>
            {loadingNetProfit ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : netProfitData ? (
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {renderNetProfitAccountsList([
                      ...netProfitData.leftPane.directExpenses.accounts,
                      ...netProfitData.leftPane.indirectExpenses.accounts,
                    ])}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-bold font-mono">
                        {formatSmartCurrency(
                          (netProfitData.leftPane.directExpenses.total ?? 0) +
                            (netProfitData.leftPane.indirectExpenses.total ?? 0)
                        )}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            ) : expenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No expense accounts found</p>
            ) : (
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderHierarchicalAccounts(expenseAccounts)}</TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-bold font-mono">
                        {formatSmartCurrency(calculateTotal(expenseAccounts))}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </Card>
        )}

        {activeSection === "direct-expenses" && (
          <Card className="p-6">
            <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
                  <DollarSign className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-base">Direct Expense Accounts</h3>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono tabular-nums">
                  {netProfitData
                    ? formatSmartCurrency(netProfitData.leftPane.directExpenses.total ?? 0)
                    : formatSmartCurrency(calculateTotal(directExpenseAccounts))}
                </p>
              </div>
            </div>
            {loadingNetProfit ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : netProfitData ? (
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderNetProfitAccountsList(netProfitData.leftPane.directExpenses.accounts)}</TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-bold font-mono">
                        {formatSmartCurrency(netProfitData.leftPane.directExpenses.total ?? 0)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            ) : directExpenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No direct expense accounts found</p>
            ) : (
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderHierarchicalAccounts(directExpenseAccounts)}</TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-bold font-mono">
                        {formatSmartCurrency(calculateTotal(directExpenseAccounts))}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </Card>
        )}

        {activeSection === "indirect-expenses" && (
          <Card className="p-6">
            <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400">
                  <FileText className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-base">Indirect Expense Accounts</h3>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
                <p className="text-2xl font-bold font-mono tabular-nums">
                  {netProfitData
                    ? formatSmartCurrency(netProfitData.leftPane.indirectExpenses.total ?? 0)
                    : formatSmartCurrency(calculateTotal(indirectExpenseAccounts))}
                </p>
              </div>
            </div>
            {loadingNetProfit ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : netProfitData ? (
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderNetProfitAccountsList(netProfitData.leftPane.indirectExpenses.accounts)}</TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-bold font-mono">
                        {formatSmartCurrency(netProfitData.leftPane.indirectExpenses.total ?? 0)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            ) : indirectExpenseAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No indirect expense accounts found</p>
            ) : (
              <div className="table-responsive">
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-background">
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderHierarchicalAccounts(indirectExpenseAccounts)}</TableBody>
                </Table>
              </div>
            )}
          </Card>
        )}

        {activeSection === "sales" && (
          <>
            {appMode === "factory" ? (
              <>
                {/* ── Date filter row ─────────────────────────────── */}
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <Label className="text-sm text-muted-foreground shrink-0">Date range:</Label>
                  <DatePickerInput
                    value={factorySalesStartDate}
                    onChange={setFactorySalesStartDate}
                    placeholder="Start date"
                  />
                  <span className="text-muted-foreground text-sm">—</span>
                  <DatePickerInput
                    value={factorySalesEndDate}
                    onChange={setFactorySalesEndDate}
                    placeholder="End date"
                  />
                  {(factorySalesStartDate || factorySalesEndDate) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFactorySalesStartDate("");
                        setFactorySalesEndDate("");
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {/* ── Factory OS – By Customer ─────────────────────── */}
                <Card className="p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-medium">Factory OS — By Customer</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Container sales from the factory system, grouped by customer
                    </p>
                  </div>
                  {loadingFactorySales ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : factorySalesByCustomer.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No factory OS sales data available</p>
                  ) : (
                    <div className="table-responsive">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Containers</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Total Value</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Paid</TableHead>
                            <TableHead className="text-right">Outstanding</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {factorySalesByCustomer.map((row: any) => (
                            <TableRow key={row.customerId ?? "null"}>
                              <TableCell className="font-medium">
                                {row.customerName || `Customer #${row.customerId}`}
                              </TableCell>
                              <TableCell className="text-right hidden sm:table-cell">{row.containers}</TableCell>
                              <TableCell className="text-right font-mono hidden sm:table-cell">
                                {formatAmount(parseFloat(row.totalAmount))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-green-600 dark:text-green-400 hidden sm:table-cell">
                                {formatAmount(parseFloat(row.paidAmount))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                                {formatAmount(parseFloat(row.totalAmount) - parseFloat(row.paidAmount))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        <TableBody className="font-semibold border-t-2">
                          <TableRow>
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right hidden sm:table-cell">
                              {factorySalesByCustomer.reduce((s: number, r: any) => s + Number(r.containers), 0)}
                            </TableCell>
                            <TableCell className="text-right font-mono hidden sm:table-cell">
                              {formatAmount(
                                factorySalesByCustomer.reduce((s: number, r: any) => s + parseFloat(r.totalAmount), 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono hidden sm:table-cell">
                              {formatAmount(
                                factorySalesByCustomer.reduce((s: number, r: any) => s + parseFloat(r.paidAmount), 0)
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(
                                factorySalesByCustomer.reduce(
                                  (s: number, r: any) => s + parseFloat(r.totalAmount) - parseFloat(r.paidAmount),
                                  0
                                )
                              )}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </Card>

                {/* ── Factory POS ──────────────────────────────────── */}
                <Card className="p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-medium">Factory POS</h3>
                    <p className="text-sm text-muted-foreground mt-1">Point-of-sale transactions, by customer</p>
                  </div>
                  {loadingFactoryPos ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : !factoryPosSummary || (factoryPosSummary.byCustomer ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No factory POS sales data available
                    </p>
                  ) : (
                    <div className="table-responsive">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead>Customer</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Transactions</TableHead>
                            <TableHead className="text-right">Total Sales</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Cash Sales</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Credit Sales</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Deposit Collected</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(factoryPosSummary.byCustomer ?? []).map((row: any, idx: number) => (
                            <TableRow key={row.customerId ?? idx}>
                              <TableCell className="font-medium">{row.customerName}</TableCell>
                              <TableCell className="text-right hidden sm:table-cell">{row.sales}</TableCell>
                              <TableCell className="text-right font-mono">
                                {formatAmount(parseFloat(row.totalAmount))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-green-600 dark:text-green-400 hidden sm:table-cell">
                                {formatAmount(parseFloat(row.cashSales))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400 hidden sm:table-cell">
                                {formatAmount(parseFloat(row.creditSales))}
                              </TableCell>
                              <TableCell className="text-right font-mono hidden sm:table-cell">
                                {formatAmount(parseFloat(row.depositAmount))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        {factoryPosSummary.grand && (
                          <TableBody className="font-semibold border-t-2">
                            <TableRow>
                              <TableCell>Total</TableCell>
                              <TableCell className="text-right hidden sm:table-cell">
                                {factoryPosSummary.grand.sales}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatAmount(parseFloat(factoryPosSummary.grand.totalAmount))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-green-600 dark:text-green-400 hidden sm:table-cell">
                                {formatAmount(parseFloat(factoryPosSummary.grand.cashSales))}
                              </TableCell>
                              <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400 hidden sm:table-cell">
                                {formatAmount(parseFloat(factoryPosSummary.grand.creditSales))}
                              </TableCell>
                              <TableCell className="text-right font-mono hidden sm:table-cell">
                                {formatAmount(parseFloat(factoryPosSummary.grand.depositAmount))}
                              </TableCell>
                            </TableRow>
                          </TableBody>
                        )}
                      </Table>
                    </div>
                  )}
                </Card>
              </>
            ) : (
              <Card className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <h3 className="text-lg font-medium">Sales by Location</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedPeriod === "range" && (
                      <>
                        <Input
                          type="date"
                          className="w-auto"
                          value={rangeStart}
                          onChange={(e) => setRangeStart(e.target.value)}
                          data-testid="input-range-start"
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          type="date"
                          className="w-auto"
                          value={rangeEnd}
                          onChange={(e) => setRangeEnd(e.target.value)}
                          data-testid="input-range-end"
                        />
                      </>
                    )}
                    <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                      <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-sales-period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="month">This Month</SelectItem>
                        <SelectItem value="year">This Year</SelectItem>
                        <SelectItem value="range">Custom Range</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {salesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : salesData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No sales data available</p>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead>Location</TableHead>
                            <TableHead className="text-right">Bales Sold</TableHead>
                            <TableHead className="text-right">Total Sales</TableHead>
                            <TableHead className="text-right">Transactions</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[...salesData]
                            .sort((a, b) => (a.locationName ?? "").localeCompare(b.locationName ?? ""))
                            .map((location) => (
                              <TableRow key={location.locationId}>
                                <TableCell className="font-medium">{location.locationName}</TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatNumber(location.totalQuantity ?? 0)}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(location.totalSales)}
                                </TableCell>
                                <TableCell className="text-right">{location.totalTransactions}</TableCell>
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
                        <TableBody className="font-semibold border-t-2 bg-muted/40">
                          <TableRow>
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right font-mono">
                              {formatNumber(salesData.reduce((s, l) => s + (l.totalQuantity ?? 0), 0))}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatAmount(salesData.reduce((s, l) => s + l.totalSales, 0))}
                            </TableCell>
                            <TableCell className="text-right">
                              {salesData.reduce((s, l) => s + l.totalTransactions, 0)}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {[...salesData]
                        .sort((a, b) => (a.locationName ?? "").localeCompare(b.locationName ?? ""))
                        .map((location) => (
                          <Card
                            key={location.locationId}
                            className="hover-elevate cursor-pointer"
                            onClick={() => setSelectedLocationForDetails(location.locationId)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">{location.locationName}</span>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="grid grid-cols-3 mt-2 text-sm gap-2">
                                <span className="text-muted-foreground">
                                  Bales:{" "}
                                  <span className="font-mono text-foreground">
                                    {formatNumber(location.totalQuantity ?? 0)}
                                  </span>
                                </span>
                                <span className="text-muted-foreground">
                                  Sales:{" "}
                                  <span className="font-mono text-foreground">{formatAmount(location.totalSales)}</span>
                                </span>
                                <span className="text-muted-foreground text-right">
                                  Txns: <span className="text-foreground">{location.totalTransactions}</span>
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      {/* Mobile totals card */}
                      <Card className="bg-muted/40">
                        <CardContent className="p-4">
                          <div className="font-semibold mb-2">Total</div>
                          <div className="grid grid-cols-3 text-sm gap-2">
                            <span className="text-muted-foreground">
                              Bales:{" "}
                              <span className="font-mono text-foreground font-semibold">
                                {formatNumber(salesData.reduce((s, l) => s + (l.totalQuantity ?? 0), 0))}
                              </span>
                            </span>
                            <span className="text-muted-foreground">
                              Sales:{" "}
                              <span className="font-mono text-foreground font-semibold">
                                {formatAmount(salesData.reduce((s, l) => s + l.totalSales, 0))}
                              </span>
                            </span>
                            <span className="text-muted-foreground text-right">
                              Txns:{" "}
                              <span className="text-foreground font-semibold">
                                {salesData.reduce((s, l) => s + l.totalTransactions, 0)}
                              </span>
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                )}
              </Card>
            )}

            {/* Sales Details Dialog (ERP only) */}
            {appMode !== "factory" && (
              <Dialog
                open={selectedLocationForDetails !== null}
                onOpenChange={(open) => !open && setSelectedLocationForDetails(null)}
              >
                <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle>
                      Sales Details - {salesData.find((l) => l.locationId === selectedLocationForDetails)?.locationName}
                    </DialogTitle>
                  </DialogHeader>

                  <div className="flex flex-col gap-4 overflow-hidden flex-1 min-h-0">
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
                      <p className="text-sm text-muted-foreground text-center py-8">No transactions found</p>
                    ) : (
                      <>
                        <div className="overflow-y-auto flex-1 min-h-0">
                          <div className="hidden md:block">
                            <Table>
                              <TableHeader className="sticky top-0 z-30 bg-background">
                                <TableRow>
                                  <TableHead>Date</TableHead>
                                  {selectedLocationForDetails === -1 && <TableHead>Customer</TableHead>}
                                  <TableHead>Cash Account</TableHead>
                                  <TableHead className="text-right">Items</TableHead>
                                  <TableHead className="text-right">Quantity</TableHead>
                                  <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transactions.map((transaction) => (
                                  <TableRow key={transaction.id}>
                                    <TableCell>
                                      <button
                                        className="text-left hover:underline text-primary cursor-pointer"
                                        onClick={() => {
                                          const params = new URLSearchParams();
                                          params.set("displayDate", formatDisplayDate(transaction.voucherDate));
                                          params.set("grouping", "daily");
                                          params.set("startDate", transaction.voucherDate);
                                          params.set("endDate", transaction.voucherDate);
                                          if (
                                            selectedLocationForDetails !== null &&
                                            selectedLocationForDetails !== -1
                                          ) {
                                            params.set("locationId", String(selectedLocationForDetails));
                                          }
                                          setSelectedLocationForDetails(null);
                                          window.open(`/sales-report/detail?${params.toString()}`, "_blank");
                                        }}
                                      >
                                        {formatDisplayDate(transaction.voucherDate)}
                                      </button>
                                    </TableCell>
                                    {selectedLocationForDetails === -1 && (
                                      <TableCell className="text-muted-foreground">
                                        {transaction.customerName || "—"}
                                      </TableCell>
                                    )}
                                    <TableCell className="text-muted-foreground text-sm">
                                      {transaction.cashAccountName || "—"}
                                    </TableCell>
                                    <TableCell className="text-right">{transaction.itemCount}</TableCell>
                                    <TableCell className="text-right">{transaction.totalQuantity}</TableCell>
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
                              <Card
                                key={transaction.id}
                                className="hover-elevate cursor-pointer"
                                onClick={() => {
                                  const params = new URLSearchParams();
                                  params.set("displayDate", formatDisplayDate(transaction.voucherDate));
                                  params.set("grouping", "daily");
                                  params.set("startDate", transaction.voucherDate);
                                  params.set("endDate", transaction.voucherDate);
                                  if (selectedLocationForDetails !== null && selectedLocationForDetails !== -1) {
                                    params.set("locationId", String(selectedLocationForDetails));
                                  }
                                  setSelectedLocationForDetails(null);
                                  window.open(`/sales-report/detail?${params.toString()}`, "_blank");
                                }}
                              >
                                <CardContent className="p-3 space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-primary">
                                      {formatDisplayDate(transaction.voucherDate)}
                                    </span>
                                    <span className="font-mono font-medium">
                                      {formatAmount(transaction.totalAmount)}
                                    </span>
                                  </div>
                                  {selectedLocationForDetails === -1 && transaction.customerName && (
                                    <div className="text-sm text-muted-foreground">{transaction.customerName}</div>
                                  )}
                                  {transaction.cashAccountName && (
                                    <div className="text-sm text-muted-foreground">{transaction.cashAccountName}</div>
                                  )}
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                      Items: {transaction.itemCount} | Qty: {transaction.totalQuantity}
                                    </span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </div>

                        <div className="border-t pt-4 shrink-0">
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
            )}
          </>
        )}

        {activeSection === "containers" && appMode === "factory" && (
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="text-lg font-medium flex items-center gap-2">
                <ContainerIcon className="h-5 w-5" />
                Container Report
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <Label>Start Date</Label>
                <DatePickerInput
                  value={factoryContainerStartDate}
                  onChange={setFactoryContainerStartDate}
                  placeholder="Start date"
                />
              </div>
              <div>
                <Label>End Date</Label>
                <DatePickerInput
                  value={factoryContainerEndDate}
                  onChange={setFactoryContainerEndDate}
                  placeholder="End date"
                />
              </div>
              <div>
                <Label>Customer</Label>
                <Select value={factoryContainerCustomerId} onValueChange={setFactoryContainerCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Customers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {factorySalesByCustomer.map((r: any) => (
                      <SelectItem key={r.customerId} value={r.customerId.toString()}>
                        {r.customerName || `Customer #${r.customerId}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Status</Label>
                <Select value={factoryContainerPaymentStatus} onValueChange={setFactoryContainerPaymentStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="PARTIAL">Partial</SelectItem>
                    <SelectItem value="PAID">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingFactoryContainerSales ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : factoryContainerSales ? (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-muted-foreground">Containers</div>
                    <div className="text-xl font-bold">{factoryContainerSales.summary.count}</div>
                  </div>
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-muted-foreground">Total Value</div>
                    <div className="text-xl font-bold font-mono">
                      {formatAmount(factoryContainerSales.summary.total)}
                    </div>
                  </div>
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-muted-foreground">Paid</div>
                    <div className="text-xl font-bold font-mono text-green-600 dark:text-green-400">
                      {formatAmount(factoryContainerSales.summary.paid)}
                    </div>
                  </div>
                  <div className="border rounded-md p-3">
                    <div className="text-xs text-muted-foreground">Outstanding</div>
                    <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">
                      {formatAmount(factoryContainerSales.summary.outstanding)}
                    </div>
                  </div>
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-30 bg-background">
                      <TableRow>
                        <TableHead>Container #</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Sale Date</TableHead>
                        <TableHead>Container Status</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {factoryContainerSales.rows.map((row: any) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono">{row.containerNumber || "-"}</TableCell>
                          <TableCell className="font-medium">{row.customerName || `#${row.customerId}`}</TableCell>
                          <TableCell className="font-mono text-sm">{row.invoiceNumber || "-"}</TableCell>
                          <TableCell>{row.saleDate}</TableCell>
                          <TableCell>
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${row.containerStatus === "OFFLOADED" ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300" : "bg-muted border-muted-foreground/20 text-muted-foreground"}`}
                            >
                              {row.containerStatus || "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full border ${row.paymentStatus === "PAID" ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300" : row.paymentStatus === "PARTIAL" ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300" : "bg-muted border-muted-foreground/20 text-muted-foreground"}`}
                            >
                              {row.paymentStatus}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatAmount(parseFloat(row.totalAmount))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-green-600 dark:text-green-400">
                            {formatAmount(parseFloat(row.paidAmount))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                            {formatAmount(parseFloat(row.totalAmount) - parseFloat(row.paidAmount))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="md:hidden space-y-3">
                  {factoryContainerSales.rows.map((row: any) => (
                    <Card key={row.id}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium">{row.containerNumber || "-"}</span>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${row.paymentStatus === "PAID" ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300" : row.paymentStatus === "PARTIAL" ? "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300" : "bg-muted border-muted-foreground/20 text-muted-foreground"}`}
                          >
                            {row.paymentStatus}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {row.customerName} · {row.saleDate}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t">
                          <div>
                            <span className="text-muted-foreground block">Total</span>
                            <span className="font-mono">{formatAmount(parseFloat(row.totalAmount))}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Paid</span>
                            <span className="font-mono text-green-600 dark:text-green-400">
                              {formatAmount(parseFloat(row.paidAmount))}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-muted-foreground block">Outstanding</span>
                            <span className="font-mono text-amber-600 dark:text-amber-400">
                              {formatAmount(parseFloat(row.totalAmount) - parseFloat(row.paidAmount))}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
                <ContainerIcon className="h-10 w-10 opacity-25" />
                <p className="text-sm font-medium">No data yet</p>
                <p className="text-xs opacity-60">Adjust the filters above to load the report</p>
              </div>
            )}
          </Card>
        )}

        {activeSection === "containers" && appMode !== "factory" && (
          <Card className="p-6">
            <div className="flex items-center justify-between -mx-6 px-6 pb-4 mb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ContainerIcon className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-base">Container Report</h3>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mb-6 items-end">
              <div className="flex flex-col gap-1.5">
                <Label>Period</Label>
                <PeriodFilter
                  value={containerPeriodFilter}
                  onChange={setContainerPeriodFilter}
                  data-testid="container-report-period-filter"
                />
              </div>
              <div className="flex flex-col gap-1.5 min-w-[160px]">
                <Label htmlFor="container-supplier">Supplier</Label>
                <Select value={reportSupplierId} onValueChange={setReportSupplierId}>
                  <SelectTrigger id="container-supplier">
                    <SelectValue placeholder="All Suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id.toString()}>
                        {supplier.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[140px]">
                <Label htmlFor="container-status">Status</Label>
                <Select value={reportContainerStatus} onValueChange={setReportContainerStatus}>
                  <SelectTrigger id="container-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Offloaded">Offloaded</SelectItem>
                    <SelectItem value="OTW">OTW</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[160px]">
                <Label htmlFor="container-company">Company</Label>
                <Select value={reportAllCompanies} onValueChange={setReportAllCompanies}>
                  <SelectTrigger id="container-company">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {userCompanies.map((c: any) => (
                      <SelectItem key={c.companyId} value={String(c.companyId)}>
                        {c.companyName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {loadingContainers ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : containerData ? (
              (() => {
                const isAllCompanies = reportAllCompanies === "all";
                const dateCol = reportContainerStatus === "Offloaded" ? "Offload Date" : "Import Date";
                const getDate = (c: ReportContainer) =>
                  reportContainerStatus === "Offloaded" ? c.offloadDate || "-" : c.importDate || "-";

                // Build company groups when showing all companies
                const companyGroups: {
                  companyId: number;
                  companyName: string;
                  containers: ReportContainer[];
                  total: number;
                }[] = [];
                if (isAllCompanies) {
                  const map = new Map<number, (typeof companyGroups)[0]>();
                  for (const c of containerData.containers) {
                    if (!map.has(c.companyId)) {
                      map.set(c.companyId, {
                        companyId: c.companyId,
                        companyName: c.companyName,
                        containers: [],
                        total: 0,
                      });
                    }
                    const g = map.get(c.companyId)!;
                    g.containers.push(c);
                    g.total += parseFloat(c.grandTotal || "0");
                  }
                  companyGroups.push(
                    ...Array.from(map.values()).sort((a, b) => a.companyName.localeCompare(b.companyName))
                  );
                }

                const colSpanTotal = isAllCompanies ? 6 : 5;

                return (
                  <div className="space-y-4">
                    <div className="hidden md:block overflow-x-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-30 bg-background">
                          <TableRow>
                            <TableHead>Container #</TableHead>
                            <TableHead>Supplier</TableHead>
                            {isAllCompanies && <TableHead>Company</TableHead>}
                            <TableHead>Status</TableHead>
                            <TableHead>{dateCol}</TableHead>
                            <TableHead className="text-right">Grand Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        {isAllCompanies ? (
                          <>
                            {companyGroups.map((group) => (
                              <>
                                {group.containers.map((container) => (
                                  <TableBody key={container.id}>
                                    <TableRow>
                                      <TableCell className="font-mono text-sm">{container.containerNumber}</TableCell>
                                      <TableCell className="text-sm">{container.supplierName}</TableCell>
                                      <TableCell className="text-sm">{container.companyName}</TableCell>
                                      <TableCell className="text-sm">{container.status}</TableCell>
                                      <TableCell className="text-sm">{getDate(container)}</TableCell>
                                      <TableCell className="text-right font-mono text-sm">
                                        {formatAmount(parseFloat(container.grandTotal))}
                                      </TableCell>
                                    </TableRow>
                                  </TableBody>
                                ))}
                                <TableBody key={`subtotal-${group.companyId}`}>
                                  <TableRow className="bg-muted/50 font-semibold">
                                    <TableCell colSpan={colSpanTotal - 1} className="text-sm">
                                      {group.companyName} — {group.containers.length} container
                                      {group.containers.length !== 1 ? "s" : ""}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {formatAmount(group.total)}
                                    </TableCell>
                                  </TableRow>
                                </TableBody>
                              </>
                            ))}
                            <TableBody>
                              <TableRow className="font-bold border-t-2">
                                <TableCell colSpan={colSpanTotal - 1}>
                                  TOTALS ({containerData.summary.totalContainers} containers)
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(containerData.summary.totalGrandTotal)}
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </>
                        ) : (
                          <>
                            <TableBody>
                              {containerData.containers.map((container) => (
                                <TableRow key={container.id}>
                                  <TableCell className="font-mono">{container.containerNumber}</TableCell>
                                  <TableCell>{container.supplierName}</TableCell>
                                  <TableCell>{container.status}</TableCell>
                                  <TableCell>{getDate(container)}</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {formatAmount(parseFloat(container.grandTotal))}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                            <TableBody className="font-semibold border-t-2">
                              <TableRow>
                                <TableCell colSpan={3}>
                                  TOTALS ({containerData.summary.totalContainers} containers)
                                </TableCell>
                                <TableCell></TableCell>
                                <TableCell className="text-right font-mono">
                                  {formatAmount(containerData.summary.totalGrandTotal)}
                                </TableCell>
                              </TableRow>
                            </TableBody>
                          </>
                        )}
                      </Table>
                    </div>
                    <div className="md:hidden space-y-3">
                      {isAllCompanies
                        ? companyGroups.map((group) => (
                            <div key={group.companyId} className="space-y-2">
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
                                {group.companyName}
                              </div>
                              {group.containers.map((container) => (
                                <Card key={container.id}>
                                  <CardContent className="p-4 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono font-medium">{container.containerNumber}</span>
                                      <span className="text-sm text-muted-foreground">{container.status}</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 text-sm">
                                      <span className="text-muted-foreground">
                                        {container.supplierName} · {getDate(container)}
                                      </span>
                                      <span className="font-mono font-semibold">
                                        {formatAmount(parseFloat(container.grandTotal))}
                                      </span>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                              <Card className="bg-muted/40">
                                <CardContent className="p-3 flex items-center justify-between gap-2">
                                  <span className="text-sm font-semibold">
                                    {group.companyName} Total ({group.containers.length})
                                  </span>
                                  <span className="font-mono font-semibold text-sm">{formatAmount(group.total)}</span>
                                </CardContent>
                              </Card>
                            </div>
                          ))
                        : containerData.containers.map((container) => (
                            <Card key={container.id}>
                              <CardContent className="p-4 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono font-medium">{container.containerNumber}</span>
                                  <span className="text-sm text-muted-foreground">{container.status}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-muted-foreground">
                                    {container.supplierName} · {getDate(container)}
                                  </span>
                                  <span className="font-mono font-semibold">
                                    {formatAmount(parseFloat(container.grandTotal))}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                      <Card className="bg-muted/50">
                        <CardContent className="p-4 flex items-center justify-between gap-2">
                          <span className="font-bold text-sm">
                            TOTALS ({containerData.summary.totalContainers} containers)
                          </span>
                          <span className="font-mono font-semibold">
                            {formatAmount(containerData.summary.totalGrandTotal)}
                          </span>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
                <ContainerIcon className="h-10 w-10 opacity-25" />
                <p className="text-sm font-medium">No data yet</p>
                <p className="text-xs opacity-60">Adjust the filters above to load the report</p>
              </div>
            )}
          </Card>
        )}

        {activeSection === "reports" && (
          <div className="space-y-4">
            {/* Net Profit Report - Tally Prime style */}
            <Card className="p-6">
              <div className="mb-4">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Net Profit (P&L Statement)
                </h3>
              </div>

              {loadingNetProfit ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : netProfitData ? (
                <div className="space-y-6">
                  {/* Opening Balances — shown only for All Time view (no date filter) */}
                  {!plStartDate &&
                    !plEndDate &&
                    netProfitData.openingBalancesNet != null &&
                    netProfitData.openingBalancesNet !== 0 && (
                      <div
                        className="flex items-center justify-between px-4 py-3 rounded-lg border bg-muted/30"
                        data-testid="row-opening-balances"
                      >
                        <span className="flex items-center gap-2 font-medium text-sm">
                          <ChevronRight className="h-4 w-4" />
                          Opening Balances (Balance B/F)
                        </span>
                        <span className="font-mono text-sm">{formatAmount(netProfitData.openingBalancesNet)}</span>
                      </div>
                    )}

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
                            <span className="font-mono">
                              {formatAmount(netProfitData.leftPane.purchaseAccounts.total)}
                            </span>
                          </div>
                          {expandedNetProfitSections.has("purchaseAccounts") &&
                            netProfitData.leftPane.purchaseAccounts.accounts.length > 0 && (
                              <div className="bg-muted/30 divide-y">
                                {netProfitData.leftPane.purchaseAccounts.accounts
                                  .filter((acc) => Number(acc.debit) !== 0 || Number(acc.credit) !== 0)
                                  .map((acc) => (
                                    <div
                                      key={acc.id}
                                      className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground cursor-pointer hover-elevate"
                                      onClick={() => window.open(`/ledger-monthly/${acc.id}`, "_blank")}
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
                        {(netProfitData.rightPane?.directIncomes?.accounts?.filter(
                          (a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0
                        ).length ?? 0) > 0 && (
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
                                  (
                                  {
                                    netProfitData.rightPane!.directIncomes.accounts.filter(
                                      (a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0
                                    ).length
                                  }
                                  )
                                </span>
                              </span>
                              <span className="font-mono">
                                {formatAmount(netProfitData.rightPane!.directIncomes.total)}
                              </span>
                            </div>
                            {expandedNetProfitSections.has("directIncomes") && (
                              <div className="bg-muted/30 divide-y">
                                {netProfitData
                                  .rightPane!.directIncomes.accounts.filter(
                                    (a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0
                                  )
                                  .map((acc) => (
                                    <div
                                      key={acc.id}
                                      className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground"
                                    >
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
                        {netProfitData.leftPane.directExpenses.accounts.filter(
                          (a) => Number(a.debit) !== 0 || Number(a.credit) !== 0
                        ).length > 0 && (
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
                                  (
                                  {
                                    netProfitData.leftPane.directExpenses.accounts.filter(
                                      (a) => Number(a.debit) !== 0 || Number(a.credit) !== 0
                                    ).length
                                  }
                                  )
                                </span>
                              </span>
                              <span className="font-mono">
                                {formatAmount(netProfitData.leftPane.directExpenses.total)}
                              </span>
                            </div>
                            {expandedNetProfitSections.has("directExpenses") && (
                              <div className="bg-muted/30 divide-y">
                                {netProfitData.leftPane.directExpenses.accounts
                                  .filter((a) => Number(a.debit) !== 0 || Number(a.credit) !== 0)
                                  .map((acc) => (
                                    <div
                                      key={acc.id}
                                      className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground"
                                    >
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
                            const nonZeroIndirectExp = netProfitData.leftPane.indirectExpenses.accounts.filter(
                              (a) => Number(a.debit) !== 0 || Number(a.credit) !== 0
                            );
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
                                  <span className="font-mono">
                                    {formatAmount(netProfitData.leftPane.indirectExpenses.total)}
                                  </span>
                                </div>
                                {expandedNetProfitSections.has("indirectExpenses") && nonZeroIndirectExp.length > 0 && (
                                  <div className="bg-muted/30 divide-y">
                                    {nonZeroIndirectExp.map((acc) => (
                                      <div
                                        key={acc.id}
                                        className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground"
                                      >
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
                          <span className="font-mono">
                            {formatAmount(netProfitData.rightPane?.salesAccounts?.total || 0)}
                          </span>
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
                            {formatAmount(netProfitData.rightPane?.closingStock?.value || 0)}
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
                            const nonZeroIndirectInc = (
                              netProfitData.rightPane?.indirectIncomes?.accounts || []
                            ).filter((a: any) => Number(a.debit) !== 0 || Number(a.credit) !== 0);
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
                                  <span className="font-mono">
                                    {formatAmount(netProfitData.rightPane?.indirectIncomes?.total || 0)}
                                  </span>
                                </div>
                                {expandedNetProfitSections.has("indirectIncomes") && nonZeroIndirectInc.length > 0 && (
                                  <div className="bg-muted/30 divide-y">
                                    {nonZeroIndirectInc.map((acc: any) => (
                                      <div
                                        key={acc.id}
                                        className="flex justify-between items-center px-6 py-2 text-sm text-muted-foreground cursor-pointer hover-elevate"
                                        onClick={() => window.open(`/ledger-monthly/${acc.id}`, "_blank")}
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
                <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 opacity-25" />
                  <p className="text-sm font-medium">No data available</p>
                  <p className="text-xs opacity-60">Adjust your filters and try again</p>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
