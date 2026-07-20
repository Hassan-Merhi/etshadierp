import { useQuery } from "@tanstack/react-query";
import { analyticsKeys } from "@/lib/queryKeys";
import {
  readAccountsResponse,
  readArrayResponse,
  readJsonResponse,
} from "@/lib/apiResponseAdapters";
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
  OpeningStockSummaryData,
} from "./analyticsTypes";

type DateRange = Record<string, string>;

interface UseAnalyticsQueriesProps {
  selectedCompanyId?: number;
  activeSection: string;
  balStartDate: string;
  balEndDate: string;
  dateRange: DateRange;
  selectedLocationForDetails: number | null;
  detailsDateRange: DateRange;
  buildContainerUrl: () => string;
  appMode: string;
  buildFactorySalesUrl: (base: string) => string;
  buildFactoryContainerSalesUrl: () => string;
  plStartDate: string;
  plEndDate: string;
  buildStockMovementUrl: () => string;
  openingStockLocationId: string;
}

async function fetchJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  return readJsonResponse<T>(response, errorMessage);
}

async function fetchArray<T>(url: string, errorMessage: string): Promise<T[]> {
  const response = await fetch(url, { credentials: "include" });
  return readArrayResponse<T>(response, errorMessage);
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
  const containerUrl = buildContainerUrl();
  const factorySalesUrl = buildFactorySalesUrl("");
  const factoryContainerSalesUrl = buildFactoryContainerSalesUrl();
  const stockMovementUrl = buildStockMovementUrl();

  const locationsQuery = useQuery<Location[]>({
    queryKey: analyticsKeys.locations(selectedCompanyId),
    queryFn: () => fetchArray<Location>("/api/locations", "Failed to fetch locations"),
    enabled: !!selectedCompanyId,
  });

  const stockGroupsQuery = useQuery<StockGroup[]>({
    queryKey: analyticsKeys.stockGroups(selectedCompanyId),
    queryFn: () => fetchArray<StockGroup>("/api/stock-groups", "Failed to fetch stock groups"),
    enabled: !!selectedCompanyId,
  });

  const suppliersQuery = useQuery<Supplier[]>({
    queryKey: analyticsKeys.suppliers(),
    queryFn: () => fetchArray<Supplier>("/api/suppliers", "Failed to fetch suppliers"),
    enabled: !!selectedCompanyId && activeSection === "containers",
  });

  const accountsQuery = useQuery<Account[]>({
    queryKey: analyticsKeys.accounts(selectedCompanyId, balStartDate, balEndDate),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (balStartDate) params.append("startDate", balStartDate);
      if (balEndDate) params.append("endDate", balEndDate);
      const url = `/api/accounts/all${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, { credentials: "include" });
      return readAccountsResponse<Account>(response);
    },
    enabled: !!selectedCompanyId,
  });

  const salesDataQuery = useQuery<LocationSales[]>({
    queryKey: analyticsKeys.financialSales(selectedCompanyId, dateRange),
    queryFn: () => {
      const params = new URLSearchParams(dateRange);
      return fetchArray<LocationSales>(`/api/financial/sales?${params}`, "Failed to fetch sales data");
    },
    enabled: !!selectedCompanyId,
  });

  const transactionsQuery = useQuery<POSTransaction[]>({
    queryKey: analyticsKeys.financialTransactions(selectedLocationForDetails, detailsDateRange),
    queryFn: () => {
      const params = new URLSearchParams(detailsDateRange);
      return fetchArray<POSTransaction>(
        `/api/financial/sales/${selectedLocationForDetails}/transactions?${params}`,
        "Failed to fetch transactions",
      );
    },
    enabled: !!selectedLocationForDetails,
  });

  const userCompaniesQuery = useQuery<{ companyId: number; companyName: string }[]>({
    queryKey: analyticsKeys.userCompanies(),
    queryFn: async () => {
      const response = await fetch("/api/user/companies", { credentials: "include" });
      if (!response.ok) return [];
      return readArrayResponse<{ companyId: number; companyName: string }>(response, "Failed to fetch companies");
    },
  });

  const containerDataQuery = useQuery<ContainerData>({
    queryKey: analyticsKeys.urlScoped(containerUrl, selectedCompanyId),
    queryFn: () => fetchJson<ContainerData>(containerUrl, "Failed to fetch containers"),
    enabled: !!selectedCompanyId,
  });

  const factorySalesByCustomerQuery = useQuery<unknown[]>({
    queryKey: analyticsKeys.factorySalesByCustomer(selectedCompanyId, factorySalesUrl),
    queryFn: () =>
      fetchArray<unknown>(
        buildFactorySalesUrl("/api/factory/analytics/sales-by-customer"),
        "Failed to fetch factory sales",
      ),
    enabled: !!selectedCompanyId && appMode === "factory",
  });

  const factoryPosSummaryQuery = useQuery<unknown>({
    queryKey: analyticsKeys.factoryPosSummary(selectedCompanyId, factorySalesUrl),
    queryFn: () =>
      fetchJson<unknown>(
        buildFactorySalesUrl("/api/factory/analytics/pos-summary"),
        "Failed to fetch factory POS summary",
      ),
    enabled: !!selectedCompanyId && appMode === "factory",
  });

  const factoryContainerSalesQuery = useQuery<unknown>({
    queryKey: analyticsKeys.urlScoped(factoryContainerSalesUrl, selectedCompanyId),
    queryFn: () =>
      fetchJson<unknown>(factoryContainerSalesUrl, "Failed to fetch factory container sales"),
    enabled: appMode === "factory",
  });

  const netProfitDataQuery = useQuery<NetProfitStatementData>({
    queryKey: analyticsKeys.netProfitStatement(selectedCompanyId, plStartDate, plEndDate),
    queryFn: () => {
      const params = new URLSearchParams();
      if (plStartDate) params.append("startDate", plStartDate);
      if (plEndDate) params.append("endDate", plEndDate);
      const url = `/api/reports/net-profit-statement${params.toString() ? `?${params.toString()}` : ""}`;
      return fetchJson<NetProfitStatementData>(url, "Failed to fetch net profit statement");
    },
    enabled: !!selectedCompanyId,
  });

  const stockMovementDataQuery = useQuery<StockMovementData>({
    queryKey: analyticsKeys.urlScoped(stockMovementUrl, selectedCompanyId),
    queryFn: () => fetchJson<StockMovementData>(stockMovementUrl, "Failed to fetch stock movement"),
    enabled: !!selectedCompanyId && activeSection === "stock",
  });

  const openingStockDataQuery = useQuery<OpeningStockSummaryData>({
    queryKey: analyticsKeys.openingStockSummary(selectedCompanyId, openingStockLocationId),
    queryFn: () => {
      const url = `/api/reports/opening-stock-summary${
        openingStockLocationId !== "all" ? `?locationId=${openingStockLocationId}` : ""
      }`;
      return fetchJson<OpeningStockSummaryData>(url, "Failed to fetch opening stock summary");
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
