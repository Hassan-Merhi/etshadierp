import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { Voucher } from "./types";

interface DaybookFilterState {
  voucherType: string;
  searchQuery: string;
  sortOrder: "asc" | "desc";
  minAmount: string;
  maxAmount: string;
  statusFilter: "all" | "active" | "optional";
}

interface UsePaginatedDaybookVouchersOptions {
  companyId?: number;
  fromDate: string;
  toDate: string;
  filters: DaybookFilterState;
  page: number;
  pageSize: number;
}

export interface PaginatedVoucherResponse {
  data: Voucher[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  summary: {
    total: number;
    active: number;
    optional: number;
    totalAmount: number;
  };
}

export function usePaginatedDaybookVouchers(options: UsePaginatedDaybookVouchersOptions) {
  const debouncedSearch = useDebouncedValue(options.filters.searchQuery, 250);
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams({
      profile: "page",
      page: String(options.page),
      pageSize: String(options.pageSize),
      startDate: options.fromDate,
      endDate: options.toDate,
      sort: options.filters.sortOrder,
    });
    if (options.filters.voucherType !== "all") params.set("type", options.filters.voucherType);
    if (options.filters.statusFilter !== "all") params.set("status", options.filters.statusFilter);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (options.filters.minAmount) params.set("minAmount", options.filters.minAmount);
    if (options.filters.maxAmount) params.set("maxAmount", options.filters.maxAmount);
    return `/api/vouchers?${params.toString()}`;
  }, [
    options.page,
    options.pageSize,
    options.fromDate,
    options.toDate,
    options.filters.voucherType,
    options.filters.statusFilter,
    options.filters.sortOrder,
    options.filters.minAmount,
    options.filters.maxAmount,
    debouncedSearch,
  ]);

  const query = useQuery<PaginatedVoucherResponse>({
    queryKey: ["/api/vouchers", "daybook-page", options.companyId, queryUrl],
    queryFn: async ({ signal }) => {
      const response = await fetch(queryUrl, { credentials: "include", signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: "Failed to load vouchers" }));
        throw new Error(body.message || "Failed to load vouchers");
      }
      return response.json();
    },
    enabled: !!options.companyId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    queryUrl,
    response: query.data,
    vouchers: query.data?.data ?? [],
  };
}
