import type { V5Row } from "./factorystockallocationv5/types";

interface CustomerLoadingAvailabilityProduct {
  code: string;
  articleCode: string | null;
}

interface AvailableStockFilterOptions {
  showZeroStock: boolean;
  showNegativeStock: boolean;
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
