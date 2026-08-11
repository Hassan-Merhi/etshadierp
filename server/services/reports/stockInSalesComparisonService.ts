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
import type { StockInSalesGrouping, StockInSalesReportMetrics, StockInSalesReportRow } from "./stockInSalesReportService";
import { getStockInSalesReport } from "./stockInSalesReportService";

export interface StockInSalesComparisonSideFilters { locationId: number; stockGroupIds: number[] }
export interface StockInSalesComparisonFilters { companyId: number; startDate?: string; endDate?: string; grouping: StockInSalesGrouping; search?: string; sideA: StockInSalesComparisonSideFilters; sideB: StockInSalesComparisonSideFilters }
export interface StockInSalesComparisonSet { sideA: StockInSalesReportMetrics; sideB: StockInSalesReportMetrics; difference: StockInSalesReportMetrics }
export interface StockInSalesComparisonRow extends StockInSalesComparisonSet { periodKey: string; periodStart: string; periodEnd: string }
export interface StockInSalesItemComparisonRow extends StockInSalesComparisonSet { stockItemId: number; stockItemCode: string; stockItemName: string; stockGroupId: number | null; stockGroupName: string }
export interface StockInSalesComparisonResult { generatedAt: string; filters: Omit<StockInSalesComparisonFilters, "companyId">; summary: StockInSalesComparisonSet; rows: StockInSalesComparisonRow[]; rowCount: number; itemRows: StockInSalesItemComparisonRow[]; itemRowCount: number }

interface ItemAggregateRow { stockItemId: number; stockItemCode: string; stockItemName: string; stockGroupId: number | null; stockGroupName: string | null; stockInQty?: string | number | null; stockInValue?: string | number | null; stockOutQty?: string | number | null; totalSales?: string | number | null; costOfSales?: string | number | null; costProfit?: string | number | null }
interface MutableItemMetrics { stockItemId: number; stockItemCode: string; stockItemName: string; stockGroupId: number | null; stockGroupName: string; stockInQty: Decimal; stockInValue: Decimal; stockOutQty: Decimal; totalSales: Decimal; costOfSales: Decimal; costProfit: Decimal }

const ZERO = new Decimal(0);
const EMPTY_METRICS: StockInSalesReportMetrics = {
  openingStockQty: 0, openingStockValue: 0, stockInQty: 0, stockInValue: 0, stockInAvgRate: 0,
  stockAdjustmentQty: 0, stockAdjustmentValue: 0, totalAvailableQty: 0, stockOutQty: 0, stockOutValue: 0,
  closingStockQty: 0, closingStockValue: 0, totalSales: 0, costOfSales: 0, costProfit: 0, avgProfitPerBale: 0,
};

function decimal(value: unknown): Decimal { if (value === null || value === undefined || value === "") return ZERO; try { return new Decimal(String(value)); } catch { return ZERO; } }
function toNumber(value: Decimal, decimalPlaces: number): number { return Number(value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP).toString()); }
function divideOrZero(numerator: Decimal, denominator: Decimal): Decimal { return denominator.isZero() ? ZERO : numerator.dividedBy(denominator); }

function subtractMetrics(sideA: StockInSalesReportMetrics, sideB: StockInSalesReportMetrics): StockInSalesReportMetrics {
  return {
    openingStockQty: sideA.openingStockQty - sideB.openingStockQty,
    openingStockValue: sideA.openingStockValue - sideB.openingStockValue,
    stockInQty: sideA.stockInQty - sideB.stockInQty,
    stockInValue: sideA.stockInValue - sideB.stockInValue,
    stockInAvgRate: sideA.stockInAvgRate - sideB.stockInAvgRate,
    stockAdjustmentQty: sideA.stockAdjustmentQty - sideB.stockAdjustmentQty,
    stockAdjustmentValue: sideA.stockAdjustmentValue - sideB.stockAdjustmentValue,
    totalAvailableQty: sideA.totalAvailableQty - sideB.totalAvailableQty,
    stockOutQty: sideA.stockOutQty - sideB.stockOutQty,
    stockOutValue: sideA.stockOutValue - sideB.stockOutValue,
    closingStockQty: sideA.closingStockQty - sideB.closingStockQty,
    closingStockValue: sideA.closingStockValue - sideB.closingStockValue,
    totalSales: sideA.totalSales - sideB.totalSales,
    costOfSales: sideA.costOfSales - sideB.costOfSales,
    costProfit: sideA.costProfit - sideB.costProfit,
    avgProfitPerBale: sideA.avgProfitPerBale - sideB.avgProfitPerBale,
  };
}

function indexRows(rows: StockInSalesReportRow[]): Map<string, StockInSalesReportRow> { return new Map(rows.map((row) => [row.periodKey, row])); }

function addItemFilters(conditions: SQL[], filters: StockInSalesComparisonFilters, side: StockInSalesComparisonSideFilters, locationCondition: SQL, extraSearchConditions: SQL[]): void {
  conditions.push(locationCondition);
  if (side.stockGroupIds.length > 0) conditions.push(inArray(stockItems.stockGroupId, side.stockGroupIds));
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(or(ilike(stockItems.code, pattern), ilike(stockItems.name, pattern), ilike(stockGroups.name, pattern), ilike(locations.name, pattern), ...extraSearchConditions)!);
  }
}

async function loadStockInItemRows(filters: StockInSalesComparisonFilters, side: StockInSalesComparisonSideFilters): Promise<ItemAggregateRow[]> {
  const activityDate = sql<string>`COALESCE(${containers.offloadDate}, DATE(${containerOffloads.offloadedAt}))`;
  const conditions: SQL[] = [eq(containers.companyId, filters.companyId), eq(stockItems.companyId, filters.companyId), eq(locations.companyId, filters.companyId), eq(containerOffloads.optional, false)];
  if (filters.startDate) conditions.push(sql`${activityDate} >= CAST(${filters.startDate} AS date)`);
  if (filters.endDate) conditions.push(sql`${activityDate} <= CAST(${filters.endDate} AS date)`);
  addItemFilters(conditions, filters, side, eq(containerOffloads.locationId, side.locationId), filters.search ? [ilike(containers.containerNumber, `%${filters.search}%`)] : []);
  return db.select({ stockItemId: stockItems.id, stockItemCode: stockItems.code, stockItemName: stockItems.name, stockGroupId: stockGroups.id, stockGroupName: stockGroups.name, stockInQty: sql<string>`COALESCE(SUM(${containerOffloadItems.quantity}), 0)`, stockInValue: sql<string>`COALESCE(SUM(${containerOffloadItems.totalValue}), 0)` }).from(containerOffloadItems).innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id)).innerJoin(containers, eq(containerOffloads.containerId, containers.id)).innerJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id)).innerJoin(locations, eq(containerOffloads.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions)).groupBy(stockItems.id, stockItems.code, stockItems.name, stockGroups.id, stockGroups.name).execute();
}

async function loadSalesItemRows(filters: StockInSalesComparisonFilters, side: StockInSalesComparisonSideFilters): Promise<ItemAggregateRow[]> {
  const conditions: SQL[] = [eq(vouchers.companyId, filters.companyId), eq(vouchers.voucherType, "Sales"), eq(vouchers.optional, false), isNull(vouchers.deletedAt), eq(stockItems.companyId, filters.companyId)];
  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));
  addItemFilters(conditions, filters, side, eq(vouchers.locationId, side.locationId), filters.search ? [ilike(vouchers.voucherNumber, `%${filters.search}%`), ilike(vouchers.locationName, `%${filters.search}%`)] : []);
  return db.select({ stockItemId: stockItems.id, stockItemCode: stockItems.code, stockItemName: stockItems.name, stockGroupId: stockGroups.id, stockGroupName: stockGroups.name, stockOutQty: sql<string>`COALESCE(SUM(${salesItems.quantity}), 0)`, totalSales: sql<string>`COALESCE(SUM(${salesItems.totalSales}), 0)`, costOfSales: sql<string>`COALESCE(SUM(${salesItems.totalCost}), 0)`, costProfit: sql<string>`COALESCE(SUM(${salesItems.profit}), 0)` }).from(salesItems).innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id)).innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id)).leftJoin(locations, eq(vouchers.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions)).groupBy(stockItems.id, stockItems.code, stockItems.name, stockGroups.id, stockGroups.name).execute();
}

async function loadNoteItemRows(filters: StockInSalesComparisonFilters, side: StockInSalesComparisonSideFilters): Promise<ItemAggregateRow[]> {
  const sign = sql<number>`CASE WHEN ${vouchers.voucherType} = 'Credit Note' THEN -1 ELSE 1 END`;
  const inventoryValue = sql<number>`(${creditNoteItems.quantity} * ${creditNoteItems.inventoryCost})`;
  const noteProfit = sql<number>`(${creditNoteItems.totalValue} - ${inventoryValue})`;
  const conditions: SQL[] = [eq(vouchers.companyId, filters.companyId), inArray(vouchers.voucherType, ["Credit Note", "Debit Note"]), eq(vouchers.optional, false), isNull(vouchers.deletedAt), eq(stockItems.companyId, filters.companyId)];
  if (filters.startDate) conditions.push(gte(vouchers.voucherDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(vouchers.voucherDate, filters.endDate));
  addItemFilters(conditions, filters, side, eq(creditNoteItems.locationId, side.locationId), filters.search ? [ilike(vouchers.voucherNumber, `%${filters.search}%`)] : []);
  return db.select({ stockItemId: stockItems.id, stockItemCode: stockItems.code, stockItemName: stockItems.name, stockGroupId: stockGroups.id, stockGroupName: stockGroups.name, stockOutQty: sql<string>`COALESCE(SUM((${sign}) * ${creditNoteItems.quantity}), 0)`, totalSales: sql<string>`COALESCE(SUM((${sign}) * ${creditNoteItems.totalValue}), 0)`, costOfSales: sql<string>`COALESCE(SUM((${sign}) * ${inventoryValue}), 0)`, costProfit: sql<string>`COALESCE(SUM((${sign}) * ${noteProfit}), 0)` }).from(creditNoteItems).innerJoin(vouchers, eq(creditNoteItems.voucherId, vouchers.id)).innerJoin(stockItems, eq(creditNoteItems.stockItemId, stockItems.id)).leftJoin(locations, eq(creditNoteItems.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions)).groupBy(stockItems.id, stockItems.code, stockItems.name, stockGroups.id, stockGroups.name).execute();
}

function mergeItemRows(target: Map<number, MutableItemMetrics>, rows: ItemAggregateRow[]): void {
  for (const row of rows) {
    const current = target.get(row.stockItemId) ?? { stockItemId: row.stockItemId, stockItemCode: row.stockItemCode, stockItemName: row.stockItemName, stockGroupId: row.stockGroupId, stockGroupName: row.stockGroupName ?? "", stockInQty: ZERO, stockInValue: ZERO, stockOutQty: ZERO, totalSales: ZERO, costOfSales: ZERO, costProfit: ZERO };
    current.stockInQty = current.stockInQty.plus(decimal(row.stockInQty)); current.stockInValue = current.stockInValue.plus(decimal(row.stockInValue)); current.stockOutQty = current.stockOutQty.plus(decimal(row.stockOutQty)); current.totalSales = current.totalSales.plus(decimal(row.totalSales)); current.costOfSales = current.costOfSales.plus(decimal(row.costOfSales)); current.costProfit = current.costProfit.plus(decimal(row.costProfit)); target.set(row.stockItemId, current);
  }
}

function itemMetrics(value?: MutableItemMetrics): StockInSalesReportMetrics {
  if (!value) return { ...EMPTY_METRICS };
  const stockInQty = value.stockInQty; const stockOutQty = value.stockOutQty;
  return { ...EMPTY_METRICS, stockInQty: toNumber(stockInQty, 3), stockInValue: toNumber(value.stockInValue, 2), stockInAvgRate: toNumber(divideOrZero(value.stockInValue, stockInQty), 6), stockOutQty: toNumber(stockOutQty, 3), totalSales: toNumber(value.totalSales, 2), costOfSales: toNumber(value.costOfSales, 2), costProfit: toNumber(value.costProfit, 2), avgProfitPerBale: toNumber(divideOrZero(value.costProfit, stockOutQty), 6) };
}

async function loadItemMetrics(filters: StockInSalesComparisonFilters, side: StockInSalesComparisonSideFilters): Promise<Map<number, MutableItemMetrics>> {
  const [stockInRows, salesRows, noteRows] = await Promise.all([loadStockInItemRows(filters, side), loadSalesItemRows(filters, side), loadNoteItemRows(filters, side)]);
  const target = new Map<number, MutableItemMetrics>(); mergeItemRows(target, stockInRows); mergeItemRows(target, salesRows); mergeItemRows(target, noteRows); return target;
}

export async function getStockInSalesComparison(filters: StockInSalesComparisonFilters): Promise<StockInSalesComparisonResult> {
  const common = { companyId: filters.companyId, startDate: filters.startDate, endDate: filters.endDate, grouping: filters.grouping, profitFilter: "all" as const, search: filters.search };
  const [sideAReport, sideBReport, sideAItems, sideBItems] = await Promise.all([
    getStockInSalesReport({ ...common, locationIds: [filters.sideA.locationId], stockGroupIds: filters.sideA.stockGroupIds }),
    getStockInSalesReport({ ...common, locationIds: [filters.sideB.locationId], stockGroupIds: filters.sideB.stockGroupIds }),
    loadItemMetrics(filters, filters.sideA), loadItemMetrics(filters, filters.sideB),
  ]);
  const sideARows = indexRows(sideAReport.rows); const sideBRows = indexRows(sideBReport.rows);
  const periodKeys = Array.from(new Set([...sideARows.keys(), ...sideBRows.keys()])).sort((a, b) => b.localeCompare(a));
  const rows: StockInSalesComparisonRow[] = periodKeys.map((periodKey) => {
    const a = sideARows.get(periodKey); const b = sideBRows.get(periodKey); const sideA = a ?? EMPTY_METRICS; const sideB = b ?? EMPTY_METRICS;
    return { periodKey, periodStart: a?.periodStart ?? b?.periodStart ?? periodKey, periodEnd: a?.periodEnd ?? b?.periodEnd ?? periodKey, sideA, sideB, difference: subtractMetrics(sideA, sideB) };
  });
  const itemIds = Array.from(new Set([...sideAItems.keys(), ...sideBItems.keys()])).sort((a, b) => a - b);
  const itemRows = itemIds.map((stockItemId): StockInSalesItemComparisonRow => {
    const aRaw = sideAItems.get(stockItemId); const bRaw = sideBItems.get(stockItemId); const identity = aRaw ?? bRaw!; const sideA = itemMetrics(aRaw); const sideB = itemMetrics(bRaw);
    return { stockItemId, stockItemCode: identity.stockItemCode, stockItemName: identity.stockItemName, stockGroupId: identity.stockGroupId, stockGroupName: identity.stockGroupName, sideA, sideB, difference: subtractMetrics(sideA, sideB) };
  });
  return { generatedAt: new Date().toISOString(), filters: { startDate: filters.startDate, endDate: filters.endDate, grouping: filters.grouping, search: filters.search, sideA: filters.sideA, sideB: filters.sideB }, summary: { sideA: sideAReport.summary, sideB: sideBReport.summary, difference: subtractMetrics(sideAReport.summary, sideBReport.summary) }, rows, rowCount: rows.length, itemRows, itemRowCount: itemRows.length };
}
