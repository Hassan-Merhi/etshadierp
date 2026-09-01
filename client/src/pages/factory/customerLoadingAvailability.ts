import type { V5Row } from "./factorystockallocationv5/types";

const CUSTOMER_LOADING_ROUTE = "/factory/customer-loading";
const STOCK_ALLOCATION_ENDPOINT = "/api/factory/v5/stock-allocation";
const CUSTOMER_LOADING_ALLOCATION_ENDPOINT = `${STOCK_ALLOCATION_ENDPOINT}?view=availability`;

interface CustomerLoadingAvailabilityProduct {
  code: string;
  articleCode: string | null;
}

interface AvailableStockFilterOptions {
  showZeroStock: boolean;
  showNegativeStock: boolean;
}

declare global {
  interface Window {
    __erpCustomerLoadingAvailabilityFetchInstalled?: boolean;
  }
}

/**
 * Customer Loading only consumes articleCode + freeToPromise from the V5
 * allocation response. Rewrite only its exact GET so the browser receives the
 * compact server projection instead of the full nested proforma/container
 * model. Other allocation consumers keep the canonical response unchanged.
 */
export function rewriteCustomerLoadingAllocationRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  pathname: string
): RequestInfo | URL {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (
    pathname !== CUSTOMER_LOADING_ROUTE ||
    method !== "GET" ||
    typeof input !== "string" ||
    input !== STOCK_ALLOCATION_ENDPOINT
  ) {
    return input;
  }
  return CUSTOMER_LOADING_ALLOCATION_ENDPOINT;
}

if (typeof window !== "undefined" && !window.__erpCustomerLoadingAvailabilityFetchInstalled) {
  window.__erpCustomerLoadingAvailabilityFetchInstalled = true;
  const previousFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    previousFetch(
      rewriteCustomerLoadingAllocationRequest(input, init, window.location.pathname),
      init
    )) as typeof window.fetch;
}

export function normalizeCustomerLoadingArticleCode(value: string): string {
  return value.trim().toUpperCase();
}

export function buildAvailableStockMap(rows: Array<Pick<V5Row, "articleCode" | "freeToPromise">>): Map<string, number> {
  const availableStockByCode = new Map<string, number>();
  for (const row of rows) {
    availableStockByCode.set(normalizeCustomerLoadingArticleCode(row.articleCode), row.freeToPromise);
  }
  return availableStockByCode;
}

export function resolveAvailableStock(
  product: CustomerLoadingAvailabilityProduct,
  availableStockByCode: ReadonlyMap<string, number>
): number | null {
  const articleCode = product.articleCode || product.code;
  return availableStockByCode.get(normalizeCustomerLoadingArticleCode(articleCode)) ?? null;
}

export function shouldIncludeAvailableStock(
  availableStock: number | null,
  options: AvailableStockFilterOptions
): boolean {
  if (availableStock === null) return true;
  if (!options.showNegativeStock && availableStock < 0) return false;
  if (!options.showZeroStock && availableStock === 0) return false;
  return true;
}
