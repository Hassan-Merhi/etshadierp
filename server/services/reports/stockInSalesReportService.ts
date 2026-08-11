import Decimal from "decimal.js";
import { and, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { db } from "../../db";
import { calculateHistoricalLocationInventory } from "../../routes/helpers/inventoryHistoryHelpers";
import {
  containers,
  containerOffloads,
  containerOffloadItems,
  creditNoteItems,
  locations,
  salesItems,
  stockAdjustmentItems,
  stockAdjustmentVouchers,
  stockGroups,
  stockItems,
  stockTransferItems,
  stockTransferVouchers,
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
  openingStockQty: number;
  openingStockValue: number;
  stockInQty: number;
  stockInValue: number;
  stockInAvgRate: number;
  stockAdjustmentQty: number;
  stockAdjustmentValue: number;
  totalAvailableQty: number;
  stockOutQty: number;
  stockOutValue: number;
  closingStockQty: number;
  closingStockValue: number;
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
  stockAdjustmentQty?: string | number | null;
  stockAdjustmentValue?: string | number | null;
  stockOutQty?: string | number | null;
  stockOutValue?: string | number | null;
  totalSales?: string | number | null;
  costOfSales?: string | number | null;
  costProfit?: string | number | null;
}

interface MutableMetrics {
  stockInQty: Decimal;
  stockInValue: Decimal;
  stockAdjustmentQty: Decimal;
  stockAdjustmentValue: Decimal;
  stockOutQty: Decimal;
  stockOutValue: Decimal;
  totalSales: Decimal;
  costOfSales: Decimal;
  costProfit: Decimal;
}

interface InventoryBalance {
  quantity: Decimal;
  value: Decimal;
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
    stockAdjustmentQty: ZERO,
    stockAdjustmentValue: ZERO,
    stockOutQty: ZERO,
    stockOutValue: ZERO,
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

function previousDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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

function addTransferItemFilters(conditions: SQL[], filters: StockInSalesReportFilters, searchExtraConditions: SQL[]): void {
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
        ...searchExtraConditions
      )!
    );
  }
}

async function getStockInRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  const activityDate = sql<string>`COALESCE(${containers.offloadDate}, DATE(${containerOffloads.offloadedAt}))`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const conditions: SQL[] = [
    eq(containers.companyId, filters.companyId),
    eq(stockItems.companyId, filters.companyId),
    eq(locations.companyId, filters.companyId),
    eq(containerOffloads.optional, false),
  ];

  if (filters.startDate) conditions.push(sql`${activityDate} >= CAST(${filters.startDate} AS date)`);
  if (filters.endDate) conditions.push(sql`${activityDate} <= CAST(${filters.endDate} AS date)`);

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

async function getTransferInRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  const activityDate = sql<string>`${vouchers.voucherDate}`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const conditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
  ];

  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));
  if (filters.locationIds.length > 0) {
    conditions.push(inArray(stockTransferVouchers.destinationLocationId, filters.locationIds));
  }
  const searchPattern = filters.search ? `%${filters.search}%` : null;
  addTransferItemFilters(conditions, filters, searchPattern ? [ilike(vouchers.voucherNumber, searchPattern)] : []);

  return db
    .select({
      periodKey,
      stockInQty: sql<string>`COALESCE(SUM(${stockTransferItems.quantity}), 0)`,
      stockInValue: sql<string>`COALESCE(SUM(${stockTransferItems.totalAmount}), 0)`,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .innerJoin(stockItems, eq(stockTransferItems.stockItemId, stockItems.id))
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .where(and(...conditions))
    .groupBy(periodKey)
    .execute();
}

async function getAdjustmentRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  const activityDate = sql<string>`${vouchers.voucherDate}`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const conditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
  ];

  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));
  if (filters.locationIds.length > 0) {
    conditions.push(inArray(stockAdjustmentVouchers.locationId, filters.locationIds));
  }
  const searchPattern = filters.search ? `%${filters.search}%` : null;
  addTransferItemFilters(conditions, filters, searchPattern ? [ilike(vouchers.voucherNumber, searchPattern)] : []);

  return db
    .select({
      periodKey,
      stockAdjustmentQty: sql<string>`COALESCE(SUM(${stockAdjustmentItems.quantity}), 0)`,
      stockAdjustmentValue: sql<string>`COALESCE(SUM(${stockAdjustmentItems.quantity} * ${stockAdjustmentItems.rate}), 0)`,
    })
    .from(stockAdjustmentItems)
    .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
    .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
    .innerJoin(stockItems, eq(stockAdjustmentItems.stockItemId, stockItems.id))
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
    searchPattern ? [ilike(vouchers.voucherNumber, searchPattern), ilike(vouchers.locationName, searchPattern)] : []
  );

  return db
    .select({
      periodKey,
      stockOutQty: sql<string>`COALESCE(SUM(${salesItems.quantity}), 0)`,
      stockOutValue: sql<string>`COALESCE(SUM(${salesItems.totalCost}), 0)`,
      totalSales: sql<string>`COALESCE(SUM(${salesItems.totalSales}), 0)`,
      costOfSales: sql<string>`COALESCE(SUM(${salesItems.totalCost}), 0)`,
      costProfit: sql<string>`COALESCE(SUM(${salesItems.profit}), 0)`,
    })
    .from(salesItems)
    .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
    .innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id))
    .leftJoin(locations, and(eq(vouchers.locationId, locations.id), eq(locations.companyId, filters.companyId)))
    .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
    .where(and(...conditions))
    .groupBy(periodKey)
    .execute();
}

async function getTransferOutRows(filters: StockInSalesReportFilters): Promise<AggregateRow[]> {
  const activityDate = sql<string>`${vouchers.voucherDate}`;
  const periodKey = buildPeriodKeyExpression(activityDate, filters.grouping);
  const conditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
  ];

  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));
  if (filters.locationIds.length > 0) {
    conditions.push(inArray(stockTransferItems.sourceLocationId, filters.locationIds));
  }
  const searchPattern = filters.search ? `%${filters.search}%` : null;
  addTransferItemFilters(conditions, filters, searchPattern ? [ilike(vouchers.voucherNumber, searchPattern)] : []);

  return db
    .select({
      periodKey,
      stockOutQty: sql<string>`COALESCE(SUM(${stockTransferItems.quantity}), 0)`,
      stockOutValue: sql<string>`COALESCE(SUM(${stockTransferItems.totalAmount}), 0)`,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .innerJoin(stockItems, eq(stockTransferItems.stockItemId, stockItems.id))
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
      stockOutValue: sql<string>`COALESCE(SUM((${sign}) * ${inventoryValue}), 0)`,
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

function historicalRowMatchesFilters(row: any, filters: StockInSalesReportFilters): boolean {
  if (filters.stockGroupIds.length > 0 && !filters.stockGroupIds.includes(Number(row.stockGroupId))) return false;
  if (!filters.search) return true;
  const needle = filters.search.toLocaleLowerCase();
  return [row.stockItemCode, row.stockItemName, row.stockGroupName, row.stockGroupCode]
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLocaleLowerCase().includes(needle));
}

async function getOpeningBalance(filters: StockInSalesReportFilters, asOfDate: string): Promise<InventoryBalance> {
  const balances = await Promise.all(
    filters.locationIds.map((locationId) => calculateHistoricalLocationInventory(locationId, filters.companyId, asOfDate))
  );

  let quantity = ZERO;
  let value = ZERO;
  for (const locationRows of balances) {
    for (const row of locationRows) {
      if (!historicalRowMatchesFilters(row, filters)) continue;
      quantity = quantity.plus(decimal(row.quantity));
      value = value.plus(decimal(row.totalValue));
    }
  }
  return { quantity, value };
}

function toMetrics(metrics: MutableMetrics, opening: InventoryBalance): StockInSalesReportMetrics {
  const totalAvailableQty = opening.quantity.plus(metrics.stockInQty).plus(metrics.stockAdjustmentQty);
  const closingStockQty = totalAvailableQty.minus(metrics.stockOutQty);
  const closingStockValue = opening.value
    .plus(metrics.stockInValue)
    .plus(metrics.stockAdjustmentValue)
    .minus(metrics.stockOutValue);

  return {
    openingStockQty: toNumber(opening.quantity, 3),
    openingStockValue: toNumber(opening.value, 2),
    stockInQty: toNumber(metrics.stockInQty, 3),
    stockInValue: toNumber(metrics.stockInValue, 2),
    stockInAvgRate: toNumber(divideOrZero(metrics.stockInValue, metrics.stockInQty), 6),
    stockAdjustmentQty: toNumber(metrics.stockAdjustmentQty, 3),
    stockAdjustmentValue: toNumber(metrics.stockAdjustmentValue, 2),
    totalAvailableQty: toNumber(totalAvailableQty, 3),
    stockOutQty: toNumber(metrics.stockOutQty, 3),
    stockOutValue: toNumber(metrics.stockOutValue, 2),
    closingStockQty: toNumber(closingStockQty, 3),
    closingStockValue: toNumber(closingStockValue, 2),
    totalSales: toNumber(metrics.totalSales, 2),
    costOfSales: toNumber(metrics.costOfSales, 2),
    costProfit: toNumber(metrics.costProfit, 2),
    avgProfitPerBale: toNumber(divideOrZero(metrics.costProfit, metrics.stockOutQty), 6),
  };
}

function mutableFromPublicMetrics(metrics: StockInSalesReportMetrics): MutableMetrics {
  return {
    stockInQty: decimal(metrics.stockInQty),
    stockInValue: decimal(metrics.stockInValue),
    stockAdjustmentQty: decimal(metrics.stockAdjustmentQty),
    stockAdjustmentValue: decimal(metrics.stockAdjustmentValue),
    stockOutQty: decimal(metrics.stockOutQty),
    stockOutValue: decimal(metrics.stockOutValue),
    totalSales: decimal(metrics.totalSales),
    costOfSales: decimal(metrics.costOfSales),
    costProfit: decimal(metrics.costProfit),
  };
}

export async function getStockInSalesReport(
  filters: StockInSalesReportFilters
): Promise<StockInSalesReportResult> {
  const [stockInRows, transferInRows, adjustmentRows, salesRows, transferOutRows, noteRows] = await Promise.all([
    getStockInRows(filters),
    getTransferInRows(filters),
    getAdjustmentRows(filters),
    getSalesRows(filters),
    getTransferOutRows(filters),
    getCreditAndDebitNoteRows(filters),
  ]);

  const buckets = new Map<string, MutableMetrics>();
  mergeAggregateRows(buckets, stockInRows, ["stockInQty", "stockInValue"]);
  mergeAggregateRows(buckets, transferInRows, ["stockInQty", "stockInValue"]);
  mergeAggregateRows(buckets, adjustmentRows, ["stockAdjustmentQty", "stockAdjustmentValue"]);
  mergeAggregateRows(buckets, salesRows, ["stockOutQty", "stockOutValue", "totalSales", "costOfSales", "costProfit"]);
  mergeAggregateRows(buckets, transferOutRows, ["stockOutQty", "stockOutValue"]);
  mergeAggregateRows(buckets, noteRows, ["stockOutQty", "stockOutValue", "totalSales", "costOfSales", "costProfit"]);

  const chronologicalBuckets = Array.from(buckets.entries())
    .map(([periodKey, metrics]) => ({ periodKey, metrics, ...getPeriodBounds(periodKey, filters.grouping) }))
    .sort((a, b) => a.periodKey.localeCompare(b.periodKey));

  if (chronologicalBuckets.length === 0) {
    const zeroPublic = toMetrics(emptyMetrics(), { quantity: ZERO, value: ZERO });
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
      summary: zeroPublic,
      rows: [],
      rowCount: 0,
    };
  }

  const openingDate = previousDay(filters.startDate ?? chronologicalBuckets[0].periodStart);
  let runningOpening = await getOpeningBalance(filters, openingDate);

  const chronologicalRows: StockInSalesReportRow[] = chronologicalBuckets.map(({ periodKey, periodStart, periodEnd, metrics }) => {
    const publicMetrics = toMetrics(metrics, runningOpening);
    const row: StockInSalesReportRow = {
      periodKey,
      periodStart,
      periodEnd,
      ...publicMetrics,
    };
    runningOpening = {
      quantity: decimal(publicMetrics.closingStockQty),
      value: decimal(publicMetrics.closingStockValue),
    };
    return row;
  });

  const filteredChronologicalRows = chronologicalRows.filter((row) => {
    if (filters.profitFilter === "positive") return row.costProfit > 0;
    if (filters.profitFilter === "negative") return row.costProfit < 0;
    return true;
  });

  const rows = [...filteredChronologicalRows].sort((a, b) => b.periodKey.localeCompare(a.periodKey));

  let summary: StockInSalesReportMetrics;
  if (filteredChronologicalRows.length === 0) {
    summary = toMetrics(emptyMetrics(), { quantity: ZERO, value: ZERO });
  } else {
    const first = filteredChronologicalRows[0];
    const last = filteredChronologicalRows[filteredChronologicalRows.length - 1];
    const summaryAccumulator = filteredChronologicalRows.reduce<MutableMetrics>((total, row) => {
      const mutable = mutableFromPublicMetrics(row);
      total.stockInQty = total.stockInQty.plus(mutable.stockInQty);
      total.stockInValue = total.stockInValue.plus(mutable.stockInValue);
      total.stockAdjustmentQty = total.stockAdjustmentQty.plus(mutable.stockAdjustmentQty);
      total.stockAdjustmentValue = total.stockAdjustmentValue.plus(mutable.stockAdjustmentValue);
      total.stockOutQty = total.stockOutQty.plus(mutable.stockOutQty);
      total.stockOutValue = total.stockOutValue.plus(mutable.stockOutValue);
      total.totalSales = total.totalSales.plus(mutable.totalSales);
      total.costOfSales = total.costOfSales.plus(mutable.costOfSales);
      total.costProfit = total.costProfit.plus(mutable.costProfit);
      return total;
    }, emptyMetrics());
    summary = toMetrics(summaryAccumulator, {
      quantity: decimal(first.openingStockQty),
      value: decimal(first.openingStockValue),
    });
    summary.closingStockQty = last.closingStockQty;
    summary.closingStockValue = last.closingStockValue;
  }

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
    summary,
    rows,
    rowCount: rows.length,
  };
}
