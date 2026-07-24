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
import {
  getStockInSalesReport,
  type StockInSalesReportMetrics,
} from "./stockInSalesReportService";

export interface StockInSalesDetailFilters {
  companyId: number;
  startDate: string;
  endDate: string;
  locationIds: number[];
  stockGroupIds: number[];
  search?: string;
  stockInPage: number;
  stockOutPage: number;
  limit: number;
  exportAll?: boolean;
}

export interface StockInDetailRow {
  id: number;
  activityDate: string;
  containerId: number;
  containerNumber: string;
  offloadId: number;
  locationId: number;
  locationName: string;
  stockGroupId: number | null;
  stockGroupName: string;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: number;
  avgRate: number;
  totalValue: number;
}

export interface StockOutDetailRow {
  id: number;
  sourceType: "Sale" | "Credit Note" | "Debit Note";
  activityDate: string;
  voucherId: number;
  voucherNumber: string;
  isCreditSale: boolean | null;
  locationId: number | null;
  locationName: string;
  stockGroupId: number | null;
  stockGroupName: string;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: number;
  sellingRate: number;
  unitCost: number;
  totalSales: number;
  totalCost: number;
  costProfit: number;
  avgProfitPerBale: number;
}

interface PaginationResult<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  truncated: boolean;
}

export interface StockInSalesDetailResult {
  generatedAt: string;
  period: { startDate: string; endDate: string };
  filters: Omit<
    StockInSalesDetailFilters,
    "companyId" | "stockInPage" | "stockOutPage" | "limit" | "exportAll"
  >;
  summary: StockInSalesReportMetrics;
  stockIn: PaginationResult<StockInDetailRow>;
  stockOut: PaginationResult<StockOutDetailRow>;
}

const EXPORT_LIMIT = 20_000;
const ZERO = new Decimal(0);

function toNumber(value: unknown, decimals: number): number {
  try {
    return Number(new Decimal(value === null || value === undefined || value === "" ? 0 : String(value))
      .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
      .toString());
  } catch {
    return 0;
  }
}

function divideOrZero(numerator: unknown, denominator: unknown): number {
  try {
    const den = new Decimal(denominator === null || denominator === undefined ? 0 : String(denominator));
    if (den.isZero()) return 0;
    return Number(
      new Decimal(numerator === null || numerator === undefined ? 0 : String(numerator))
        .dividedBy(den)
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toString()
    );
  } catch {
    return 0;
  }
}

function addItemFilters(
  conditions: SQL[],
  filters: StockInSalesDetailFilters,
  locationCondition: SQL | undefined,
  extraSearchConditions: SQL[]
): void {
  if (locationCondition) conditions.push(locationCondition);
  if (filters.stockGroupIds.length > 0) {
    conditions.push(inArray(stockItems.stockGroupId, filters.stockGroupIds));
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(stockItems.code, pattern),
        ilike(stockItems.name, pattern),
        ilike(stockGroups.name, pattern),
        ilike(locations.name, pattern),
        ...extraSearchConditions
      )!
    );
  }
}

async function loadStockIn(
  filters: StockInSalesDetailFilters
): Promise<PaginationResult<StockInDetailRow>> {
  const activityDate = sql<string>`COALESCE(${containers.offloadDate}, DATE(${containerOffloads.offloadedAt}))`;
  const conditions: SQL[] = [
    eq(containers.companyId, filters.companyId),
    eq(stockItems.companyId, filters.companyId),
    eq(locations.companyId, filters.companyId),
    eq(containerOffloads.optional, false),
    sql`${activityDate} >= CAST(${filters.startDate} AS date)`,
    sql`${activityDate} <= CAST(${filters.endDate} AS date)`,
  ];

  addItemFilters(
    conditions,
    filters,
    filters.locationIds.length > 0 ? inArray(containerOffloads.locationId, filters.locationIds) : undefined,
    filters.search ? [ilike(containers.containerNumber, `%${filters.search}%`)] : []
  );

  const where = and(...conditions);
  const requestedLimit = filters.exportAll ? EXPORT_LIMIT : filters.limit;
  const requestedPage = filters.exportAll ? 1 : filters.stockInPage;
  const offset = (requestedPage - 1) * requestedLimit;

  const [countResult, rawRows] = await Promise.all([
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(containerOffloadItems)
      .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
      .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
      .innerJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id))
      .innerJoin(locations, eq(containerOffloads.locationId, locations.id))
      .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
      .where(where),
    db
      .select({
        id: containerOffloadItems.id,
        activityDate,
        containerId: containers.id,
        containerNumber: containers.containerNumber,
        offloadId: containerOffloads.id,
        locationId: locations.id,
        locationName: locations.name,
        stockGroupId: stockGroups.id,
        stockGroupName: stockGroups.name,
        stockItemId: stockItems.id,
        stockItemCode: stockItems.code,
        stockItemName: stockItems.name,
        quantity: containerOffloadItems.quantity,
        totalValue: containerOffloadItems.totalValue,
      })
      .from(containerOffloadItems)
      .innerJoin(containerOffloads, eq(containerOffloadItems.offloadId, containerOffloads.id))
      .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
      .innerJoin(stockItems, eq(containerOffloadItems.stockItemId, stockItems.id))
      .innerJoin(locations, eq(containerOffloads.locationId, locations.id))
      .leftJoin(stockGroups, eq(stockItems.stockGroupId, stockGroups.id))
      .where(where)
      .orderBy(desc(activityDate), desc(containers.containerNumber), desc(containerOffloadItems.id))
      .limit(requestedLimit)
      .offset(offset),
  ]);

  const total = Number(countResult[0]?.total || 0);
  const rows: StockInDetailRow[] = rawRows.map((row) => {
    const quantity = toNumber(row.quantity, 3);
    const totalValue = toNumber(row.totalValue, 2);
    return {
      id: row.id,
      activityDate: String(row.activityDate),
      containerId: row.containerId,
      containerNumber: row.containerNumber,
      offloadId: row.offloadId,
      locationId: row.locationId,
      locationName: row.locationName,
      stockGroupId: row.stockGroupId,
      stockGroupName: row.stockGroupName || "Unassigned",
      stockItemId: row.stockItemId,
      stockItemCode: row.stockItemCode,
      stockItemName: row.stockItemName,
      quantity,
      avgRate: divideOrZero(totalValue, quantity),
      totalValue,
    };
  });

  return {
    rows,
    total,
    page: requestedPage,
    limit: requestedLimit,
    totalPages: Math.max(1, Math.ceil(total / requestedLimit)),
    truncated: filters.exportAll ? total > rows.length : false,
  };
}

interface RawStockOutRow {
  id: number;
  sourceType: string;
  activityDate: string;
  voucherId: number;
  voucherNumber: string;
  isCreditSale: boolean | null;
  locationId: number | null;
  locationName: string | null;
  stockGroupId: number | null;
  stockGroupName: string | null;
  stockItemId: number;
  stockItemCode: string;
  stockItemName: string;
  quantity: string | number;
  sellingRate: string | number;
  unitCost: string | number;
  totalSales: string | number;
  totalCost: string | number;
  costProfit: string | number;
}

function buildStockOutUnion(filters: StockInSalesDetailFilters): SQL {
  const salesConditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    eq(vouchers.voucherType, "Sales"),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
    gte(vouchers.voucherDate, filters.startDate),
    lte(vouchers.voucherDate, filters.endDate),
  ];
  addItemFilters(
    salesConditions,
    filters,
    filters.locationIds.length > 0 ? inArray(vouchers.locationId, filters.locationIds) : undefined,
    filters.search
      ? [ilike(vouchers.voucherNumber, `%${filters.search}%`), ilike(vouchers.locationName, `%${filters.search}%`)]
      : []
  );

  const noteConditions: SQL[] = [
    eq(vouchers.companyId, filters.companyId),
    inArray(vouchers.voucherType, ["Credit Note", "Debit Note"]),
    eq(vouchers.optional, false),
    isNull(vouchers.deletedAt),
    eq(stockItems.companyId, filters.companyId),
    eq(locations.companyId, filters.companyId),
    gte(vouchers.voucherDate, filters.startDate),
    lte(vouchers.voucherDate, filters.endDate),
  ];
  addItemFilters(
    noteConditions,
    filters,
    filters.locationIds.length > 0 ? inArray(creditNoteItems.locationId, filters.locationIds) : undefined,
    filters.search ? [ilike(vouchers.voucherNumber, `%${filters.search}%`)] : []
  );

  return sql`
    SELECT
      ${salesItems.id} AS "id",
      'Sale'::text AS "sourceType",
      ${vouchers.voucherDate}::text AS "activityDate",
      ${vouchers.id} AS "voucherId",
      ${vouchers.voucherNumber} AS "voucherNumber",
      ${vouchers.isCreditSale} AS "isCreditSale",
      ${vouchers.locationId} AS "locationId",
      COALESCE(${locations.name}, ${vouchers.locationName}, 'Unassigned') AS "locationName",
      ${stockGroups.id} AS "stockGroupId",
      COALESCE(${stockGroups.name}, 'Unassigned') AS "stockGroupName",
      ${stockItems.id} AS "stockItemId",
      ${stockItems.code} AS "stockItemCode",
      ${stockItems.name} AS "stockItemName",
      ${salesItems.quantity} AS "quantity",
      ${salesItems.sellingPrice} AS "sellingRate",
      ${salesItems.costPrice} AS "unitCost",
      ${salesItems.totalSales} AS "totalSales",
      ${salesItems.totalCost} AS "totalCost",
      ${salesItems.profit} AS "costProfit"
    FROM ${salesItems}
    INNER JOIN ${vouchers} ON ${salesItems.voucherId} = ${vouchers.id}
    INNER JOIN ${stockItems} ON ${salesItems.stockItemId} = ${stockItems.id}
    LEFT JOIN ${locations}
      ON ${vouchers.locationId} = ${locations.id}
      AND ${locations.companyId} = ${filters.companyId}
    LEFT JOIN ${stockGroups} ON ${stockItems.stockGroupId} = ${stockGroups.id}
    WHERE ${and(...salesConditions)}

    UNION ALL

    SELECT
      ${creditNoteItems.id} AS "id",
      ${vouchers.voucherType}::text AS "sourceType",
      ${vouchers.voucherDate}::text AS "activityDate",
      ${vouchers.id} AS "voucherId",
      ${vouchers.voucherNumber} AS "voucherNumber",
      NULL::boolean AS "isCreditSale",
      ${creditNoteItems.locationId} AS "locationId",
      COALESCE(${locations.name}, 'Unassigned') AS "locationName",
      ${stockGroups.id} AS "stockGroupId",
      COALESCE(${stockGroups.name}, 'Unassigned') AS "stockGroupName",
      ${stockItems.id} AS "stockItemId",
      ${stockItems.code} AS "stockItemCode",
      ${stockItems.name} AS "stockItemName",
      (CASE WHEN ${vouchers.voucherType} = 'Credit Note' THEN -1 ELSE 1 END * ${creditNoteItems.quantity}) AS "quantity",
      ${creditNoteItems.rate} AS "sellingRate",
      ${creditNoteItems.inventoryCost} AS "unitCost",
      (CASE WHEN ${vouchers.voucherType} = 'Credit Note' THEN -1 ELSE 1 END * ${creditNoteItems.totalValue}) AS "totalSales",
      (CASE WHEN ${vouchers.voucherType} = 'Credit Note' THEN -1 ELSE 1 END * (${creditNoteItems.quantity} * ${creditNoteItems.inventoryCost})) AS "totalCost",
      (CASE WHEN ${vouchers.voucherType} = 'Credit Note' THEN -1 ELSE 1 END * (${creditNoteItems.totalValue} - (${creditNoteItems.quantity} * ${creditNoteItems.inventoryCost}))) AS "costProfit"
    FROM ${creditNoteItems}
    INNER JOIN ${vouchers} ON ${creditNoteItems.voucherId} = ${vouchers.id}
    INNER JOIN ${stockItems} ON ${creditNoteItems.stockItemId} = ${stockItems.id}
    INNER JOIN ${locations} ON ${creditNoteItems.locationId} = ${locations.id}
    LEFT JOIN ${stockGroups} ON ${stockItems.stockGroupId} = ${stockGroups.id}
    WHERE ${and(...noteConditions)}
  `;
}

async function loadStockOut(
  filters: StockInSalesDetailFilters
): Promise<PaginationResult<StockOutDetailRow>> {
  const union = buildStockOutUnion(filters);
  const requestedLimit = filters.exportAll ? EXPORT_LIMIT : filters.limit;
  const requestedPage = filters.exportAll ? 1 : filters.stockOutPage;
  const offset = (requestedPage - 1) * requestedLimit;

  const [countResult, dataResult] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS total FROM (${union}) AS report_rows`),
    db.execute(sql`
      SELECT *
      FROM (${union}) AS report_rows
      ORDER BY "activityDate" DESC, "voucherNumber" DESC, "id" DESC
      LIMIT ${requestedLimit}
      OFFSET ${offset}
    `),
  ]);

  const total = Number((countResult.rows?.[0] as any)?.total || 0);
  const rawRows = (dataResult.rows || []) as unknown as RawStockOutRow[];
  const rows: StockOutDetailRow[] = rawRows.map((row) => {
    const quantity = toNumber(row.quantity, 3);
    const costProfit = toNumber(row.costProfit, 2);
    const sourceType =
      row.sourceType === "Credit Note" || row.sourceType === "Debit Note" ? row.sourceType : "Sale";
    return {
      id: Number(row.id),
      sourceType,
      activityDate: String(row.activityDate),
      voucherId: Number(row.voucherId),
      voucherNumber: String(row.voucherNumber),
      isCreditSale: row.isCreditSale,
      locationId: row.locationId === null ? null : Number(row.locationId),
      locationName: row.locationName || "Unassigned",
      stockGroupId: row.stockGroupId === null ? null : Number(row.stockGroupId),
      stockGroupName: row.stockGroupName || "Unassigned",
      stockItemId: Number(row.stockItemId),
      stockItemCode: String(row.stockItemCode),
      stockItemName: String(row.stockItemName),
      quantity,
      sellingRate: toNumber(row.sellingRate, 6),
      unitCost: toNumber(row.unitCost, 6),
      totalSales: toNumber(row.totalSales, 2),
      totalCost: toNumber(row.totalCost, 2),
      costProfit,
      avgProfitPerBale: divideOrZero(costProfit, quantity),
    };
  });

  return {
    rows,
    total,
    page: requestedPage,
    limit: requestedLimit,
    totalPages: Math.max(1, Math.ceil(total / requestedLimit)),
    truncated: filters.exportAll ? total > rows.length : false,
  };
}

export async function getStockInSalesDetail(
  filters: StockInSalesDetailFilters
): Promise<StockInSalesDetailResult> {
  const [summaryReport, stockIn, stockOut] = await Promise.all([
    getStockInSalesReport({
      companyId: filters.companyId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      grouping: "daily",
      profitFilter: "all",
      locationIds: filters.locationIds,
      stockGroupIds: filters.stockGroupIds,
      search: filters.search,
    }),
    loadStockIn(filters),
    loadStockOut(filters),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    period: { startDate: filters.startDate, endDate: filters.endDate },
    filters: {
      startDate: filters.startDate,
      endDate: filters.endDate,
      locationIds: filters.locationIds,
      stockGroupIds: filters.stockGroupIds,
      search: filters.search,
    },
    summary: summaryReport.summary,
    stockIn,
    stockOut,
  };
}
