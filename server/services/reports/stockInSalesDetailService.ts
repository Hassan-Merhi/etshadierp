import Decimal from "decimal.js";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

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
import { getStockInSalesReport, type StockInSalesReportMetrics } from "./stockInSalesReportService";

export interface StockInSalesDetailFilters {
  companyId: number; startDate: string; endDate: string; locationIds: number[]; stockGroupIds: number[]; search?: string; stockInPage: number; stockOutPage: number; limit: number; exportAll?: boolean;
}
export interface StockInDetailRow { id: number; activityDate: string; containerId: number; containerNumber: string; offloadId: number; locationId: number; locationName: string; stockItemId: number; stockItemCode: string; stockItemName: string; stockGroupId: number | null; stockGroupName: string; quantity: number; totalValue: number; rate: number }
export interface StockOutDetailRow { id: number; activityDate: string; voucherId: number; voucherNumber: string; voucherType: string; locationId: number | null; locationName: string; stockItemId: number; stockItemCode: string; stockItemName: string; stockGroupId: number | null; stockGroupName: string; quantity: number; totalSales: number; costOfSales: number; profit: number; sellingRate: number; costRate: number }
export interface StockInSalesDetailResult { generatedAt: string; filters: Omit<StockInSalesDetailFilters, "companyId">; summary: StockInSalesReportMetrics; stockIn: { rows: StockInDetailRow[]; page: number; limit: number; total: number; totalPages: number }; stockOut: { rows: StockOutDetailRow[]; page: number; limit: number; total: number; totalPages: number } }

const ZERO = new Decimal(0);
function decimal(value: unknown): Decimal { if (value === null || value === undefined || value === "") return ZERO; try { return new Decimal(String(value)); } catch { return ZERO; } }
function toNumber(value: Decimal, places: number): number { return Number(value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toString()); }
function addItemFilters(conditions: SQL[], filters: StockInSalesDetailFilters, locationCondition: SQL | undefined, extra: SQL[]): void {
  if (locationCondition) conditions.push(locationCondition);
  if (filters.stockGroupIds.length > 0) conditions.push(inArray(stockItems.stockGroupId, filters.stockGroupIds));
  if (!filters.search) return;
  const pattern = `%${filters.search}%`;
  conditions.push(or(ilike(stockItems.code, pattern), ilike(stockItems.name, pattern), ilike(stockGroups.name, pattern), ilike(locations.name, pattern), ...extra)!);
}

async function loadStockIn(filters: StockInSalesDetailFilters): Promise<{ rows: StockInDetailRow[]; total: number }> {
  const activityDate = sql<string>`COALESCE(${containers.offloadDate}, DATE(${containerOffloads.offloadedAt}))`;
  const conditions: SQL[] = [eq(containers.companyId, filters.companyId), eq(stockItems.companyId, filters.companyId), eq(locations.companyId, filters.companyId), eq(containerOffloads.optional, false), sql`${activityDate} >= CAST(${filters.startDate} AS date)`, sql`${activityDate} <= CAST(${filters.endDate} AS date)`];
  addItemFilters(conditions, filters, filters.locationIds.length > 0 ? inArray(containerOffloads.locationId, filters.locationIds) : undefined, filters.search ? [ilike(containers.containerNumber, `%${filters.search}%`)] : []);
  const offset = filters.exportAll ? 0 : (filters.stockInPage - 1) * filters.limit;
  const limit = filters.exportAll ? 100000 : filters.limit;
  const [rows, countRows] = await Promise.all([
    db.select({ id: containerOffloadItems.id, activityDate, containerId: containers.id, containerNumber: containers.containerNumber, offloadId: containerOffloads.id, locationId: locations.id, locationName: locations.name, stockItemId: stockItems.id, stockItemCode: stockItems.code, stockItemName: stockItems.name, stockGroupId: stockGroups.id, stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`, quantity: containerOffloadItems.quantity, totalValue: containerOffloadItems.totalValue }).from(containerOffloadItems).innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id)).innerJoin(containers, eq(containerOffloads.containerId, containers.id)).innerJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id)).innerJoin(locations, eq(containerOffloads.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions)).orderBy(desc(activityDate), desc(containerOffloadItems.id)).limit(limit).offset(offset).execute(),
    db.select({ count: sql<string>`COUNT(*)` }).from(containerOffloadItems).innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id)).innerJoin(containers, eq(containerOffloads.containerId, containers.id)).innerJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id)).innerJoin(locations, eq(containerOffloads.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions)).execute(),
  ]);
  return { rows: rows.map((row) => { const qty = decimal(row.quantity); const totalValue = decimal(row.totalValue); return { ...row, activityDate: String(row.activityDate), stockGroupName: row.stockGroupName ?? "", quantity: toNumber(qty, 3), totalValue: toNumber(totalValue, 2), rate: toNumber(qty.isZero() ? ZERO : totalValue.dividedBy(qty), 6) }; }), total: Number(countRows[0]?.count ?? 0) };
}

async function loadStockOut(filters: StockInSalesDetailFilters): Promise<{ rows: StockOutDetailRow[]; total: number }> {
  const conditions: SQL[] = [eq(vouchers.companyId, filters.companyId), eq(vouchers.voucherType, "Sales"), eq(vouchers.optional, false), isNull(vouchers.deletedAt), eq(stockItems.companyId, filters.companyId), gte(vouchers.voucherDate, filters.startDate), lte(vouchers.voucherDate, filters.endDate)];
  addItemFilters(conditions, filters, filters.locationIds.length > 0 ? inArray(vouchers.locationId, filters.locationIds) : undefined, filters.search ? [ilike(vouchers.voucherNumber, `%${filters.search}%`), ilike(vouchers.locationName, `%${filters.search}%`)] : []);
  const offset = filters.exportAll ? 0 : (filters.stockOutPage - 1) * filters.limit;
  const limit = filters.exportAll ? 100000 : filters.limit;
  const salesQuery = db.select({ id: salesItems.id, activityDate: vouchers.voucherDate, voucherId: vouchers.id, voucherNumber: vouchers.voucherNumber, voucherType: vouchers.voucherType, locationId: vouchers.locationId, locationName: sql<string>`COALESCE(${locations.name}, ${vouchers.locationName}, '')`, stockItemId: stockItems.id, stockItemCode: stockItems.code, stockItemName: stockItems.name, stockGroupId: stockGroups.id, stockGroupName: sql<string>`COALESCE(${stockGroups.name}, '')`, quantity: salesItems.quantity, totalSales: salesItems.totalSales, costOfSales: salesItems.totalCost, profit: salesItems.profit }).from(salesItems).innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id)).innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id)).leftJoin(locations, eq(vouchers.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions));
  const [rows, countRows] = await Promise.all([salesQuery.orderBy(desc(vouchers.voucherDate), desc(salesItems.id)).limit(limit).offset(offset).execute(), db.select({ count: sql<string>`COUNT(*)` }).from(salesItems).innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id)).innerJoin(stockItems, eq(salesItems.stockItemId, stockItems.id)).leftJoin(locations, eq(vouchers.locationId, locations.id)).leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id)).where(and(...conditions)).execute()]);
  return { rows: rows.map((row) => { const qty = decimal(row.quantity); const totalSales = decimal(row.totalSales); const cost = decimal(row.costOfSales); const profit = decimal(row.profit); return { ...row, activityDate: String(row.activityDate), voucherType: row.voucherType ?? "Sales", locationName: row.locationName ?? "", stockGroupName: row.stockGroupName ?? "", quantity: toNumber(qty, 3), totalSales: toNumber(totalSales, 2), costOfSales: toNumber(cost, 2), profit: toNumber(profit, 2), sellingRate: toNumber(qty.isZero() ? ZERO : totalSales.dividedBy(qty), 6), costRate: toNumber(qty.isZero() ? ZERO : cost.dividedBy(qty), 6) }; }), total: Number(countRows[0]?.count ?? 0) };
}

export async function getStockInSalesDetail(filters: StockInSalesDetailFilters): Promise<StockInSalesDetailResult> {
  const [report, stockIn, stockOut] = await Promise.all([
    getStockInSalesReport({ companyId: filters.companyId, startDate: filters.startDate, endDate: filters.endDate, grouping: "daily", profitFilter: "all", locationIds: filters.locationIds, stockGroupIds: filters.stockGroupIds, search: filters.search }),
    loadStockIn(filters), loadStockOut(filters),
  ]);
  return {
    generatedAt: new Date().toISOString(), filters: { startDate: filters.startDate, endDate: filters.endDate, locationIds: filters.locationIds, stockGroupIds: filters.stockGroupIds, search: filters.search, stockInPage: filters.stockInPage, stockOutPage: filters.stockOutPage, limit: filters.limit, exportAll: filters.exportAll }, summary: report.summary,
    stockIn: { rows: stockIn.rows, page: filters.stockInPage, limit: filters.limit, total: stockIn.total, totalPages: Math.max(1, Math.ceil(stockIn.total / filters.limit)) },
    stockOut: { rows: stockOut.rows, page: filters.stockOutPage, limit: filters.limit, total: stockOut.total, totalPages: Math.max(1, Math.ceil(stockOut.total / filters.limit)) },
  };
}
