import Decimal from "decimal.js";
import { and, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../db";
import {
  containers,
  containerOffloads,
  containerOffloadItems,
  creditNoteItems,
  locations,
  salesItems,
  stockGroups,
  stockItems,
  vouchers,
} from "@shared/schema";

export type StockInSalesGrouping = "daily" | "monthly" | "yearly";
export type StockInSalesProfitFilter = "all" | "positive" | "negative";

export interface StockInSalesReportFilters {
  companyId: number;
  startDate?: string;
  endDate?: string;
  grouping: StockInSalesGrouping;
  profitFilter: StockInSalesProfitFilter;
  locationIds: number[];
  stockGroupIds: number[];
  search?: string;
}

export interface StockInSalesReportMetrics {
  stockInQty: number;
  stockInValue: number;
  stockInAvgRate: number;
  stockOutQty: number;
  totalSales: number;
  costOfSales: number;
  costProfit: number;
  avgProfitPerBale: number;
}

export interface StockInSalesReportRow extends StockInSalesReportMetrics {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

export interface StockInSalesReportResult {
  generatedAt: string;
  filters: Omit<StockInSalesReportFilters, "companyId">;
  summary: StockInSalesReportMetrics;
  rows: StockInSalesReportRow[];
  rowCount: number;
}

interface AggregateRow {
  periodKey: string;
  stockInQty?: string | number | null;
  stockInValue?: string | number | null;
  stockOutQty?: string | number | null;
  totalSales?: string | number | null;
  costOfSales?: string | number | null;
  costProfit?: string | number | null;
}

interface MutableMetrics {
  stockInQty: Decimal;
  stockInValue: Decimal;
  stockOutQty: Decimal;
  totalSales: Decimal;
  costOfSales: Decimal;
  costProfit: Decimal;
}

const ZERO = new Decimal(0);

function decimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return ZERO;
  try {
    return new Decimal(value);
  } catch {
    return ZERO;
  }
}

function toNumber(value: Decimal, decimalPlaces: number): number {
  return Number(value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP).toString());
}

function divideOrZero(numerator: Decimal, denominator: Decimal): Decimal {
  return denominator.isZero() ? ZERO : numerator.dividedBy(denominator);
}

function emptyMetrics(): MutableMetrics {
  return {
    stockInQty: ZERO,
    stockInValue: ZERO,
    stockOutQty: ZERO,
    totalSales: ZERO,
    costOfSales: ZERO,
    costProfit: ZERO,
  };
}

function buildPeriodKeyExpression(dateExpression: SQL, grouping: StockInSalesGrouping): SQL<string> {
  if (grouping === "monthly") {
    return sql<string>`TO_CHAR(${dateExpression}, 'YYYY-MM')`;
  }
  if (grouping === "yearly") {
    return sql<string>`TO_CHAR(${dateExpression}, 'YYYY')`;
  }
  return sql<string>`TO_CHAR(${dateExpression}, 'YYYY-MM-DD')`;
}

function getPeriodBounds(periodKey: string, grouping: StockInSalesGrouping): { periodStart: string; periodEnd: string } {
  if (grouping === "yearly") {
    return {
      periodStart: `${periodKey}-01-01`,
      periodEnd: `${periodKey}-12-31`,
    };
  }

  if (grouping === "monthly") {
    const [year, month] = periodKey.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      periodStart: `${periodKey}-01`,
      periodEnd: `${periodKey}-${String(lastDay).padStart(2, "0")}`,
    };
  }

  return { periodStart: periodKey, periodEnd: periodKey };
}

function addCommonItemFilters(
  conditions: SQL[],
  filters: StockInSalesReportFilters,
  locationCondition: SQL | undefined,
  searchExtraConditions: SQL[]
): void {
  if (locationCondition) conditions.push(locationCondition);
  if (filters.stockGroupIds.length > 0) {
    conditions.push(inArray(stockItems.stockGroupId, filters.stockGroupIds));
  }
  if (filters.search) {
    const searchPattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(stockItems.code, searchPattern),
        ilike(stockItems.name, searchPattern),
        ilike(stockGroups.name, searchPattern),
        ilike(locations.name, searchPattern),
        ...searchExtraConditions
      )!
    );
  }
}

async function getStockInRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  // The selected business offload date is stored on containers.offloadDate.
  // Fall back to containerOffloads.offloadedAt for legacy rows that predate it.
  const activityDate = sql<string>`COALESCE(${containers.offloadDate}, DATE(${containerOffloads.offloadedAt}))`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const conditions: SQL[] = [
    eq(containers.companyId, filters.companyId),
    eq(stockItems.companyId, filters.companyId),
    eq(locations.companyId, filters.companyId),
    eq(containerOffloads.optional, false),
  ];

  if (filters.startDate) {
    conditions.push(sql`${activityDate} >= CAST(${filters.startDate} AS date)`);
  }
  if (filters.endDate) {
    conditions.push(sql`${activityDate} <= CAST(${filters.endDate} AS date)`);
  }

  const searchPattern = filters.search ? `%${filters.search}%` : null;
  addCommonItemFilters(
    conditions,
    filters,
    filters.locationIds.length > 0 ? inArray(containerOffloads.locationId, filters.locationIds) : undefined,
    searchPattern ? [ilike(containers.containerNumber, searchPattern)] : []
  );

  return db
    .select({
      periodKey,
      stockInQty: sql<string>`COALESCE(SUM(${containerOffloadItems.quantity}), 0)`,
      stockInValue: sql<string>`COALESCE(SUM(${containerOffloadItems.totalValue}), 0)`,
    })
    .from(containerOffloadItems)
    .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
    .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
    .innerJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id))
    .innerJoin(locations, eq(containerOffloads.locationId, locations.id))
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .where(and(...conditions))
    .groupBy(periodKey)
    .execute();
}

async function getSalesRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  const activityDate = sql<string>`${vouchers.voucherDate}`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const conditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    eq(vouchers.voucherType, "Sales"),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
  ];

  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));

  const searchPattern = filters.search ? `%${filters.search}%` : null;
  addCommonItemFilters(
    conditions,
    filters,
    filters.locationIds.length > 0 ? inArray(vouchers.locationId, filters.locationIds) : undefined,
    searchPattern
      ? [ilike(vouchers.voucherNumber, searchPattern), ilike(vouchers.locationName, searchPattern)]
      : []
  );

  return db
    .select({
      periodKey,
      stockOutQty: sql<string>`COALESCE(SUM(${salesItems.quantity}), 0)`,
      totalSales: sql<string>`COALESCE(SUM(${salesItems.totalSales}), 0)`,
      costOfSales: sql<string>`COALESCE(SUM(${salesItems.totalCost}), 0)`,
      costProfit: sql<string>`COALESCE(SUM(${salesItems.profit}), 0)`,
    })
    .from(salesItems)
    .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
    .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
    .leftJoin(
      locations,
      and(eq(vouchers.locationId, locations.id), eq(locations.companyId, filters.companyId))
    )
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .where(and(...conditions))
    .groupBy(periodKey)
    .execute();
}

async function getCreditAndDebitNoteRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  const activityDate = sql<string>`${vouchers.voucherDate}`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const sign = sql<number>`CASE WHEN ${vouchers.voucherType} = 'Credit Note' THEN -1 ELSE 1 END`;
  const inventoryValue = sql<number>`(${creditNoteItems.quantity} * ${creditNoteItems.inventoryCost})`;
  const noteProfit = sql<number>`(${creditNoteItems.totalValue} - ${inventoryValue})`;
  const conditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    inArray(vouchers.voucherType, ["Credit Note", "Debit Note"]),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
    eq(locations.companyId, filters.companyId),
  ];

  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));

  const searchPattern = filters.search ? `%${filters.search}%` : null;
  addCommonItemFilters(
    conditions,
    filters,
    filters.locationIds.length > 0 ? inArray(creditNoteItems.locationId, filters.locationIds) : undefined,
    searchPattern ? [ilike(vouchers.voucherNumber, searchPattern)] : []
  );

  return db
    .select({
      periodKey,
      stockOutQty: sql<string>`COALESCE(SUM((${sign}) * ${creditNoteItems.quantity}), 0)`,
      totalSales: sql<string>`COALESCE(SUM((${sign}) * ${creditNoteItems.totalValue}), 0)`,
      costOfSales: sql<string>`COALESCE(SUM((${sign}) * ${inventoryValue}), 0)`,
      costProfit: sql<string>`COALESCE(SUM((${sign}) * ${noteProfit}), 0)`,
    })
    .from(creditNoteItems)
    .innerJoin(vouchers, eq(creditNoteItems.voucherId, vouchers.id))
    .innerJoin(stockItems, eq(creditNoteItems.stockItemId, stockItems.id))
    .innerJoin(locations, eq(creditNoteItems.locationId, locations.id))
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .where(and(...conditions))
    .groupBy(periodKey)
    .execute();
}

function mergeAggregateRows(
  buckets: Map<string, MutableMetrics>,
  rows: AggregateRow[],
  fields: Array<keyof MutableMetrics>
): void {
  for (const row of rows) {
    if (!row.periodKey) continue;
    const bucket = buckets.get(row.periodKey) ?? emptyMetrics();
    for (const field of fields) {
      bucket[field] = bucket[field].plus(decimal(row[field]));
    }
    buckets.set(row.periodKey, bucket);
  }
}

function toMetrics(metrics: MutableMetrics): StockInSalesReportMetrics {
  return {
    stockInQty: toNumber(metrics.stockInQty, 3),
    stockInValue: toNumber(metrics.stockInValue, 2),
    stockInAvgRate: toNumber(divideOrZero(metrics.stockInValue, metrics.stockInQty), 6),
    stockOutQty: toNumber(metrics.stockOutQty, 3),
    totalSales: toNumber(metrics.totalSales, 2),
    costOfSales: toNumber(metrics.costOfSales, 2),
    costProfit: toNumber(metrics.costProfit, 2),
    avgProfitPerBale: toNumber(divideOrZero(metrics.costProfit, metrics.stockOutQty), 6),
  };
}

export async function getStockInSalesReport(
  filters: StockInSalesReportFilters
): Promise<StockInSalesReportResult> {
  const [stockInRows, salesRows, noteRows] = await Promise.all([
    getStockInRows(filters),
    getSalesRows(filters),
    getCreditAndDebitNoteRows(filters),
  ]);

  const buckets = new Map<string, MutableMetrics>();
  mergeAggregateRows(buckets, stockInRows, ["stockInQty", "stockInValue"]);
  mergeAggregateRows(buckets, salesRows, ["stockOutQty", "totalSales", "costOfSales", "costProfit"]);
  mergeAggregateRows(buckets, noteRows, ["stockOutQty", "totalSales", "costOfSales", "costProfit"]);

  const rows = Array.from(buckets.entries())
    .map(([periodKey, metrics]): StockInSalesReportRow => {
      const bounds = getPeriodBounds(periodKey, filters.grouping);
      return {
        periodKey,
        ...bounds,
        ...toMetrics(metrics),
      };
    })
    .filter((row) => {
      if (filters.profitFilter === "positive") return row.costProfit > 0;
      if (filters.profitFilter === "negative") return row.costProfit < 0;
      return true;
    })
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));

  const summaryAccumulator = rows.reduce<MutableMetrics>((total, row) => {
    total.stockInQty = total.stockInQty.plus(row.stockInQty);
    total.stockInValue = total.stockInValue.plus(row.stockInValue);
    total.stockOutQty = total.stockOutQty.plus(row.stockOutQty);
    total.totalSales = total.totalSales.plus(row.totalSales);
    total.costOfSales = total.costOfSales.plus(row.costOfSales);
    total.costProfit = total.costProfit.plus(row.costProfit);
    return total;
  }, emptyMetrics());

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      startDate: filters.startDate,
      endDate: filters.endDate,
      grouping: filters.grouping,
      profitFilter: filters.profitFilter,
      locationIds: filters.locationIds,
      stockGroupIds: filters.stockGroupIds,
      search: filters.search,
    },
    summary: toMetrics(summaryAccumulator),
    rows,
    rowCount: rows.length,
  };
}
