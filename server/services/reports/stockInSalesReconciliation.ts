import Decimal from "decimal.js";

import { calculateHistoricalLocationInventory } from "../../routes/helpers/inventoryHistoryHelpers";
import type { StockInSalesReportFilters, StockInSalesReportResult } from "./stockInSalesReportService";

export interface StockInSalesReconciliation {
  asOfDate: string;
  expectedClosingQty: number;
  expectedClosingValue: number;
  actualStockQty: number;
  actualStockValue: number;
  differenceQty: number;
  differenceValue: number;
  matches: boolean;
}

const ZERO = new Decimal(0);

function decimal(value: unknown): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  try {
    return new Decimal(String(value));
  } catch {
    return ZERO;
  }
}

function toNumber(value: Decimal, places: number): number {
  return Number(value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toString());
}

function matchesFilters(
  row: {
    stockGroupId?: unknown;
    stockItemCode?: unknown;
    stockItemName?: unknown;
    stockGroupName?: unknown;
    stockGroupCode?: unknown;
  },
  filters: StockInSalesReportFilters
): boolean {
  if (filters.stockGroupIds.length > 0 && !filters.stockGroupIds.includes(Number(row.stockGroupId))) return false;
  if (!filters.search) return true;
  const needle = filters.search.toLocaleLowerCase();
  return [row.stockItemCode, row.stockItemName, row.stockGroupName, row.stockGroupCode]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLocaleLowerCase().includes(needle));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getStockInSalesReconciliation(
  filters: StockInSalesReportFilters,
  result: StockInSalesReportResult
): Promise<StockInSalesReconciliation> {
  const today = todayIso();
  const requestedAsOf = filters.endDate && filters.endDate < today ? filters.endDate : today;
  const balances = await Promise.all(
    filters.locationIds.map((locationId) =>
      calculateHistoricalLocationInventory(locationId, filters.companyId, requestedAsOf)
    )
  );

  let actualQty = ZERO;
  let actualValue = ZERO;
  for (const rows of balances) {
    for (const row of rows) {
      if (!matchesFilters(row, filters)) continue;
      actualQty = actualQty.plus(decimal(row.quantity));
      actualValue = actualValue.plus(decimal(row.totalValue));
    }
  }

  const expectedQty = decimal(result.summary.closingStockQty);
  const expectedValue = decimal(result.summary.closingStockValue);
  const differenceQty = actualQty.minus(expectedQty);
  const differenceValue = actualValue.minus(expectedValue);

  return {
    asOfDate: requestedAsOf,
    expectedClosingQty: toNumber(expectedQty, 3),
    expectedClosingValue: toNumber(expectedValue, 2),
    actualStockQty: toNumber(actualQty, 3),
    actualStockValue: toNumber(actualValue, 2),
    differenceQty: toNumber(differenceQty, 3),
    differenceValue: toNumber(differenceValue, 2),
    matches: differenceQty.abs().lte(0.0005),
  };
}

export function attachStockInSalesReconciliation<T extends StockInSalesReportResult>(
  result: T,
  reconciliation: StockInSalesReconciliation
): T & { reconciliation: StockInSalesReconciliation } {
  return { ...result, reconciliation };
}
