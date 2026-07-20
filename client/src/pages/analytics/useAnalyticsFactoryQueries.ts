import { useQuery } from "@tanstack/react-query";
import { analyticsKeys } from "@/lib/queryKeys";
import { fetchAnalyticsArray, fetchAnalyticsJson } from "./analyticsQueryClient";

interface UseAnalyticsFactoryQueriesProps {
  selectedCompanyId?: number;
  appMode: string;
  factorySalesUrl: string;
  factorySalesByCustomerUrl: string;
  factoryPosSummaryUrl: string;
  factoryContainerSalesUrl: string;
}

export function useAnalyticsFactoryQueries({
  selectedCompanyId,
  appMode,
  factorySalesUrl,
  factorySalesByCustomerUrl,
  factoryPosSummaryUrl,
  factoryContainerSalesUrl,
}: UseAnalyticsFactoryQueriesProps) {
  const factorySalesByCustomerQuery = useQuery<unknown[]>({
    queryKey: analyticsKeys.factorySalesByCustomer(selectedCompanyId, factorySalesUrl),
    queryFn: () =>
      fetchAnalyticsArray<unknown>(factorySalesByCustomerUrl, "Failed to fetch factory sales"),
    enabled: !!selectedCompanyId && appMode === "factory",
  });

  const factoryPosSummaryQuery = useQuery<unknown>({
    queryKey: analyticsKeys.factoryPosSummary(selectedCompanyId, factorySalesUrl),
    queryFn: () =>
      fetchAnalyticsJson<unknown>(factoryPosSummaryUrl, "Failed to fetch factory POS summary"),
    enabled: !!selectedCompanyId && appMode === "factory",
  });

  const factoryContainerSalesQuery = useQuery<unknown>({
    queryKey: analyticsKeys.urlScoped(factoryContainerSalesUrl, selectedCompanyId),
    queryFn: () =>
      fetchAnalyticsJson<unknown>(factoryContainerSalesUrl, "Failed to fetch factory container sales"),
    enabled: appMode === "factory",
  });

  return {
    factorySalesByCustomer: factorySalesByCustomerQuery.data || [],
    loadingFactorySales: factorySalesByCustomerQuery.isLoading,
    factoryPosSummary: factoryPosSummaryQuery.data,
    loadingFactoryPos: factoryPosSummaryQuery.isLoading,
    factoryContainerSales: factoryContainerSalesQuery.data,
    loadingFactoryContainerSales: factoryContainerSalesQuery.isLoading,
  };
}
