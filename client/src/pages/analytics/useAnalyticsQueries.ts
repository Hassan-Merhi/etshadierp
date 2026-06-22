import { useQuery } from "@tanstack/react-query";
import { 
  Location, 
  StockGroup, 
  Supplier, 
  Account, 
  LocationSales, 
  POSTransaction, 
  ContainerData, 
  NetProfitStatementData, 
  StockMovementData, 
  OpeningStockSummaryData 
} from "./analyticsTypes";

interface UseAnalyticsQueriesProps {
  selectedCompanyId?: number;
  activeSection: string;
  balStartDate: string;
  balEndDate: string;
  dateRange: any;
  selectedLocationForDetails: number | null;
  detailsDateRange: any;
  buildContainerUrl: () => string;
  appMode: string;
  buildFactorySalesUrl: (base: string) => string;
  buildFactoryContainerSalesUrl: () => string;
  plStartDate: string;
  plEndDate: string;
  buildStockMovementUrl: () => string;
  openingStockLocationId: string;
}

export function useAnalyticsQueries({
  selectedCompanyId,
  activeSection,
  balStartDate,
  balEndDate,
  dateRange,
  selectedLocationForDetails,
  detailsDateRange,
  buildContainerUrl,
  appMode,
  buildFactorySalesUrl,
  buildFactoryContainerSalesUrl,
  plStartDate,
  plEndDate,
  buildStockMovementUrl,
  openingStockLocationId,
}: UseAnalyticsQueriesProps) {
  const locationsQuery = useQuery<Location[]>({ 
    queryKey: ["/api/locations", selectedCompanyId],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch locations");
      return response.json();
    },
    enabled: !!selectedCompanyId,
  });

  const stockGroupsQuery = useQuery<StockGroup[]>({
    queryKey: ["/api/stock-groups", selectedCompanyId],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock groups");
      return response.json();
    },
    enabled: !!selectedCompanyId,
  });

  const suppliersQuery = useQuery<Supplier[]>({ 
    queryKey: ["/api/suppliers"],
    queryFn: async () => {
      const response = await fetch("/api/suppliers", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      return response.json();
    },
    enabled: !!selectedCompanyId && activeSection === "containers",
  });

  const accountsQuery = useQuery<Account[]>({
    queryKey: ["/api/accounts/all", selectedCompanyId, balStartDate, balEndDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (balStartDate) params.append("startDate", balStartDate);
      if (balEndDate) params.append("endDate", balEndDate);
      const url = `/api/accounts/all${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch accounts");
      return response.json();
    },
    enabled: !!selectedCompanyId,
  });

  const salesDataQuery = useQuery<LocationSales[]>({
    queryKey: ["/api/financial/sales", selectedCompanyId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams(dateRange as Record<string, string>);
      const response = await fetch(`/api/financial/sales?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch sales data");
      return response.json();
    },
    enabled: !!selectedCompanyId,
  });

  const transactionsQuery = useQuery<POSTransaction[]>({
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

  const userCompaniesQuery = useQuery<{ companyId: number; companyName: string }[]>({
    queryKey: ["/api/user/companies"],
    queryFn: async () => {
      const res = await fetch("/api/user/companies", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const containerDataQuery = useQuery<ContainerData>({
    queryKey: [buildContainerUrl(), selectedCompanyId],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch containers");
      return response.json();
    },
    enabled: !!selectedCompanyId,
  });

  const factorySalesByCustomerQuery = useQuery<any[]>({
    queryKey: ["/api/factory/analytics/sales-by-customer", selectedCompanyId, buildFactorySalesUrl("")],
    queryFn: async () => {
      const res = await fetch(buildFactorySalesUrl("/api/factory/analytics/sales-by-customer"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory sales");
      return res.json();
    },
    enabled: !!selectedCompanyId && appMode === "factory",
  });

  const factoryPosSummaryQuery = useQuery<any>({
    queryKey: ["/api/factory/analytics/pos-summary", selectedCompanyId, buildFactorySalesUrl("")],
    queryFn: async () => {
      const res = await fetch(buildFactorySalesUrl("/api/factory/analytics/pos-summary"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory POS summary");
      return res.json();
    },
    enabled: !!selectedCompanyId && appMode === "factory",
  });

  const factoryContainerSalesQuery = useQuery<any>({
    queryKey: [buildFactoryContainerSalesUrl(), selectedCompanyId],
    queryFn: async ({ queryKey }) => {
      const res = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch factory container sales");
      return res.json();
    },
    enabled: appMode === "factory",
  });

  const netProfitDataQuery = useQuery<NetProfitStatementData>({
    queryKey: ["/api/reports/net-profit-statement", selectedCompanyId, plStartDate, plEndDate],
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
    enabled: !!selectedCompanyId,
  });

  const stockMovementDataQuery = useQuery<StockMovementData>({
    queryKey: [buildStockMovementUrl(), selectedCompanyId],
    queryFn: async ({ queryKey }) => {
      const response = await fetch(queryKey[0] as string, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stock movement");
      return response.json();
    },
    enabled: !!selectedCompanyId && activeSection === "stock",
  });

  const openingStockDataQuery = useQuery<OpeningStockSummaryData>({
    queryKey: ["/api/reports/opening-stock-summary", selectedCompanyId, openingStockLocationId],
    queryFn: async ({ queryKey }) => {
      const [, , locationId] = queryKey as [string, unknown, string];
      const url = `/api/reports/opening-stock-summary${locationId !== "all" ? `?locationId=${locationId}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch opening stock summary");
      return response.json();
    },
    enabled: !!selectedCompanyId && activeSection === "opening-stock",
  });

  return {
    locations: locationsQuery.data || [],
    stockGroups: stockGroupsQuery.data || [],
    suppliers: suppliersQuery.data || [],
    accounts: accountsQuery.data || [],
    accountsLoading: accountsQuery.isLoading,
    salesData: salesDataQuery.data || [],
    salesLoading: salesDataQuery.isLoading,
    transactions: transactionsQuery.data || [],
    transactionsLoading: transactionsQuery.isLoading,
    userCompanies: userCompaniesQuery.data || [],
    containerData: containerDataQuery.data,
    loadingContainers: containerDataQuery.isLoading,
    factorySalesByCustomer: factorySalesByCustomerQuery.data || [],
    loadingFactorySales: factorySalesByCustomerQuery.isLoading,
    factoryPosSummary: factoryPosSummaryQuery.data,
    loadingFactoryPos: factoryPosSummaryQuery.isLoading,
    factoryContainerSales: factoryContainerSalesQuery.data,
    loadingFactoryContainerSales: factoryContainerSalesQuery.isLoading,
    netProfitData: netProfitDataQuery.data,
    loadingNetProfit: netProfitDataQuery.isLoading,
    stockMovementData: stockMovementDataQuery.data,
    loadingStock: stockMovementDataQuery.isLoading,
    openingStockData: openingStockDataQuery.data,
    loadingOpeningStock: openingStockDataQuery.isLoading,
  };
}
