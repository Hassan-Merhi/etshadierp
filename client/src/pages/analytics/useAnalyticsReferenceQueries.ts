import { useQuery } from "@tanstack/react-query";
import { analyticsKeys } from "@/lib/queryKeys";
import type { Location, StockGroup, Supplier } from "./analyticsTypes";
import { fetchAnalyticsArray } from "./analyticsQueryClient";

interface UseAnalyticsReferenceQueriesProps {
  selectedCompanyId?: number;
  activeSection: string;
}

export function useAnalyticsReferenceQueries({
  selectedCompanyId,
  activeSection,
}: UseAnalyticsReferenceQueriesProps) {
  const locationsQuery = useQuery<Location[]>({
    queryKey: analyticsKeys.locations(selectedCompanyId),
    queryFn: () => fetchAnalyticsArray<Location>("/api/locations", "Failed to fetch locations"),
    enabled: !!selectedCompanyId,
  });

  const stockGroupsQuery = useQuery<StockGroup[]>({
    queryKey: analyticsKeys.stockGroups(selectedCompanyId),
    queryFn: () => fetchAnalyticsArray<StockGroup>("/api/stock-groups", "Failed to fetch stock groups"),
    enabled: !!selectedCompanyId,
  });

  const suppliersQuery = useQuery<Supplier[]>({
    queryKey: analyticsKeys.suppliers(),
    queryFn: () => fetchAnalyticsArray<Supplier>("/api/suppliers", "Failed to fetch suppliers"),
    enabled: !!selectedCompanyId && activeSection === "containers",
  });

  const userCompaniesQuery = useQuery<{ companyId: number; companyName: string }[]>({
    queryKey: analyticsKeys.userCompanies(),
    queryFn: async () => {
      const response = await fetch("/api/user/companies", { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  return {
    locations: locationsQuery.data || [],
    stockGroups: stockGroupsQuery.data || [],
    suppliers: suppliersQuery.data || [],
    userCompanies: userCompaniesQuery.data || [],
  };
}
