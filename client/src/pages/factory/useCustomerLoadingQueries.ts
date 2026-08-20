import { useQuery } from "@tanstack/react-query";
import type { V5Data } from "./factorystockallocationv5/types";
import {
  readJson,
  type CustomerLoadingProduct,
  type CustomerLoadingResponse,
  type CustomerOption,
  type HistoryResponse,
} from "./customerLoadingPageModel";

export function useCustomerLoadingQueries(customerId: string, historyProduct: CustomerLoadingProduct | null) {
  const customersQuery = useQuery<CustomerOption[]>({
    queryKey: ["/api/factory/customers", "customer-loading-picker"],
    queryFn: () => readJson<CustomerOption[]>("/api/factory/customers"),
    staleTime: 60_000,
  });
  const loadingQuery = useQuery<CustomerLoadingResponse>({
    queryKey: ["/api/factory/customer-loading/products", customerId],
    queryFn: () =>
      readJson<CustomerLoadingResponse>(
        `/api/factory/customer-loading/products?customerId=${encodeURIComponent(customerId)}`
      ),
    enabled: Boolean(customerId),
    staleTime: 30_000,
  });
  const stockAllocationQuery = useQuery<V5Data>({
    queryKey: ["/api/factory/v5/stock-allocation", "customer-loading"],
    queryFn: () => readJson<V5Data>("/api/factory/v5/stock-allocation"),
    enabled: Boolean(customerId),
    retry: 1,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const historyQuery = useQuery<HistoryResponse>({
    queryKey: ["/api/factory/customer-loading/history", customerId, historyProduct?.id],
    queryFn: () =>
      readJson<HistoryResponse>(
        `/api/factory/customer-loading/history?customerId=${encodeURIComponent(customerId)}&productId=${historyProduct!.id}`
      ),
    enabled: Boolean(customerId && historyProduct),
    staleTime: 30_000,
  });

  return { customersQuery, loadingQuery, stockAllocationQuery, historyQuery };
}
