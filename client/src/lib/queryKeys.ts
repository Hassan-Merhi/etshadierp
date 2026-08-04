import { companyQueryKey } from "./companyQueryScope";
import { canonicalApiUrl, companyDataKey } from "./frontendDataArchitecture";

/**
 * Shared query-key factories for all heavy endpoints.
 *
 * Rules:
 *  - All callers of the same data MUST use exactly the same key so React Query
 *    deduplicates the request and shares the cache.
 *  - The first element of every key MUST be the real URL that the shared
 *    getQueryFn will fetch. Do NOT put a fake discriminator after the URL
 *    while relying on the shared query function.
 *  - Filters are normalised before inclusion: undefined/null/empty values are
 *    dropped, object keys are sorted, primitives are used directly.
 *  - Never place a new object literal directly in a key on every render.
 */

export function normalizeFilters(
  filters: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!filters) return undefined;
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value !== undefined && value !== null && value !== "") clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
}

export const companyKeys = {
  scoped: (url: string, companyId: number | string | null | undefined, ...parts: readonly unknown[]) =>
    companyQueryKey(url, companyId, ...parts),

  url: (requestUrl: string, companyId: number | string | null | undefined, ...identity: readonly unknown[]) =>
    companyDataKey(requestUrl, companyId, ...identity),

  reference: (url: string, companyId: number | string | null | undefined) =>
    companyDataKey(url, companyId),

  accounts: (
    companyId: number | string | null | undefined,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => companyDataKey(canonicalApiUrl("/api/accounts/all", params), companyId),

  vouchers: (
    companyId: number | string | null | undefined,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => companyDataKey(canonicalApiUrl("/api/vouchers", params), companyId),

  dashboardCash: (companyId: number | string | null | undefined) =>
    companyDataKey("/api/dashboard-cash-accounts", companyId),

  dashboardPayables: (companyId: number | string | null | undefined) =>
    companyDataKey("/api/dashboard-payable-accounts", companyId),

  simpleTransfers: (companyId: number | string | null | undefined) =>
    companyDataKey("/api/simple-company-transfers", companyId),

  companyAccounts: (
    activeCompanyId: number | string | null | undefined,
    targetCompanyId: number | string | null | undefined,
  ) => companyDataKey(`/api/company-accounts/${targetCompanyId ?? "no-company"}`, activeCompanyId, targetCompanyId),

  autoTransferConfig: (
    companyId: number | string | null | undefined,
    modulePrefix: string,
  ) => companyDataKey(`${modulePrefix}/auto-transfer-config`, companyId),

  voucherSearch: (companyId: number | string | null | undefined, search: string) =>
    companyDataKey("/api/vouchers/search", companyId, search),
};

export const factoryKeys = {
  bales: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/bales", companyId, normalizeFilters(filters)] as const,
  stockAllocation: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/v5/stock-allocation", companyId, normalizeFilters(filters)] as const,
  daybook: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/daybook", companyId, normalizeFilters(filters)] as const,
  stockEntryHistory: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/bales/stock-entry-history", companyId, normalizeFilters(filters)] as const,
};

export const inventoryKeys = {
  list: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/inventory", companyId, normalizeFilters(filters)] as const,
};

export const stockItemKeys = {
  light: (companyId: number | string | undefined) => ["/api/stock-items/light?all=true", companyId] as const,
  full: (companyId: number | string | undefined) => ["/api/stock-items", companyId] as const,
  page: (
    companyId: number | string | undefined,
    params: Record<string, string | number | boolean | null | undefined>,
  ) => companyDataKey(canonicalApiUrl("/api/stock-items", params), companyId),
};

export const analyticsKeys = {
  locations: (companyId: number | undefined) => ["/api/locations", companyId] as const,
  stockGroups: (companyId: number | undefined) => ["/api/stock-groups", companyId] as const,
  suppliers: () => ["/api/suppliers"] as const,
  accounts: (companyId: number | undefined, startDate: string, endDate: string) =>
    companyKeys.accounts(companyId, { startDate, endDate }),
  financialSales: (companyId: number | undefined, dateRange: Record<string, string>) =>
    ["/api/financial/sales", companyId, normalizeFilters(dateRange)] as const,
  financialTransactions: (locationId: number | null, dateRange: Record<string, string>) =>
    ["/api/financial/sales", locationId, "transactions", normalizeFilters(dateRange)] as const,
  userCompanies: () => ["/api/user/companies"] as const,
  urlScoped: (url: string, companyId?: number) => [url, companyId] as const,
  factorySalesByCustomer: (companyId: number | undefined, url: string) =>
    ["/api/factory/analytics/sales-by-customer", companyId, url] as const,
  factoryPosSummary: (companyId: number | undefined, url: string) =>
    ["/api/factory/analytics/pos-summary", companyId, url] as const,
  netProfitStatement: (companyId: number | undefined, startDate: string, endDate: string) =>
    ["/api/reports/net-profit-statement", companyId, startDate, endDate] as const,
  openingStockSummary: (companyId: number | undefined, locationId: string) =>
    ["/api/reports/opening-stock-summary", companyId, locationId] as const,
};
