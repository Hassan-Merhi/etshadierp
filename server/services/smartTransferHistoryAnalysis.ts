import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  inventory,
  locations,
  salesItems,
  stockItems,
  stockTransferItems,
  stockTransferVouchers,
  vouchers,
} from "@shared/schema";
import {
  calculateDaysToSellThrough,
  calculateSellThroughPercentage,
  calendarDaysInclusive,
  classifyTransferPerformance,
  performanceLabel,
  roundNumber,
  type TransferPerformanceClassification,
} from "./smartTransferPerformance";

export interface HistoricalTransferLine {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  sourceLocationId: number;
  sourceLocationName: string;
  quantity: number;
}

export interface HistoricalTransferOrder {
  transferId: number;
  voucherId: number;
  voucherNumber: string;
  voucherDate: string;
  sourceLocationIds: number[];
  sourceLocationNames: string[];
  destinationLocationId: number;
  destinationLocationName: string;
  totalQuantity: number;
  items: HistoricalTransferLine[];
}

export interface HistoricalTransferItemPerformance {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  historicalSourceLocationIds: number[];
  historicalSourceLocationNames: string[];
  olderTransferQty: number;
  newerTransferQty: number;
  totalTransferredQty: number;
  salesAfterOlderTransfer: number;
  salesAfterNewerTransfer: number;
  totalSalesSinceOlderTransfer: number;
  olderSellThroughPercentage: number;
  newerSellThroughPercentage: number;
  overallSellThroughPercentage: number;
  averageSalesPerDay: number;
  latestSalesPerDay: number;
  currentDestinationQty: number;
  estimatedDaysOfStockRemaining: number | null;
  daysToSellOlderTransfer: number | null;
  daysToSellNewerTransfer: number | null;
  classification: TransferPerformanceClassification;
  classificationLabel: string;
  explanation: string;
}

export interface SmartTransferHistoryResult {
  companyId: number;
  destinationLocationId: number;
  destinationLocationName: string;
  selectedSourceLocationIds: number[];
  selectedSourceLocationNames: string[];
  asOfDate: string;
  newerTransfer: HistoricalTransferOrder | null;
  olderTransfer: HistoricalTransferOrder | null;
  items: HistoricalTransferItemPerformance[];
  summary: string;
}

export interface SmartTransferHistoryOptions {
  asOfDate?: string;
}

function parseQuantity(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniquePositiveIds(ids: number[]): number[] {
  return Array.from(new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
}

function assertIsoDate(value: string, fieldName: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    throw new Error(`${fieldName} must be a valid date in YYYY-MM-DD format`);
  }
}

function sumItemQuantity(order: HistoricalTransferOrder | null, stockItemId: number): number {
  if (!order) return 0;
  return order.items
    .filter((item) => item.stockItemId === stockItemId)
    .reduce((sum, item) => sum + item.quantity, 0);
}

function buildExplanation(
  classification: TransferPerformanceClassification,
  totalTransferredQty: number,
  totalSales: number,
  currentDestinationQty: number,
  latestSalesPerDay: number,
  estimatedDaysRemaining: number | null
): string {
  const soldText = `${roundNumber(totalSales, 0)} sold after ${roundNumber(totalTransferredQty, 0)} transferred in the last two qualifying orders`;
  switch (classification) {
    case "strong_seller":
      return `${soldText}; demand is strong and current destination stock is ${roundNumber(currentDestinationQty, 0)}.`;
    case "good_seller":
      return `${soldText}; the item has good repeat demand at the destination.`;
    case "normal_seller":
      return `${soldText}; sales are steady and should be balanced against current destination stock.`;
    case "slow_seller":
      return `${soldText}; recent sales are slow (${roundNumber(latestSalesPerDay, 2)}/day).`;
    case "overstocked":
      return `${soldText}; destination still holds ${roundNumber(currentDestinationQty, 0)}${
        estimatedDaysRemaining === null ? "" : `, about ${roundNumber(estimatedDaysRemaining, 0)} days of stock`
      }.`;
    case "no_recent_sales":
    default:
      return `No qualifying destination sales were found after the recent transfer order(s).`;
  }
}

/**
 * Read-only historical analyzer used by the smart multi-source transfer generator.
 *
 * It deliberately selects the last two TRANSFER VOUCHERS, not the last two item
 * rows. A voucher can contain lines from any number of source locations because
 * the source is resolved from stock_transfer_items.source_location_id first,
 * with the legacy voucher-level source used only as a fallback.
 */
export async function analyzeLastTwoMultiSourceTransfers(
  companyId: number,
  sourceLocationIds: number[],
  destinationLocationId: number,
  options: SmartTransferHistoryOptions = {}
): Promise<SmartTransferHistoryResult> {
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error("A valid company is required");
  if (!Number.isInteger(destinationLocationId) || destinationLocationId <= 0) {
    throw new Error("A valid destination location is required");
  }

  const uniqueSourceIds = uniquePositiveIds(sourceLocationIds).filter((id) => id !== destinationLocationId);
  if (uniqueSourceIds.length === 0) throw new Error("At least one source location different from the destination is required");

  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
  assertIsoDate(asOfDate, "asOfDate");

  const requestedLocationIds = [...uniqueSourceIds, destinationLocationId];
  const locationRows = await db
    .select({ id: locations.id, name: locations.name, code: locations.code })
    .from(locations)
    .where(
      and(
        eq(locations.companyId, companyId),
        inArray(locations.id, requestedLocationIds),
        isNull(locations.deletedAt)
      )
    );

  const locationNameById = new Map(locationRows.map((location) => [location.id, location.name]));
  const destinationLocationName = locationNameById.get(destinationLocationId);
  if (!destinationLocationName) throw new Error("Destination location was not found in the current company");

  const missingSources = uniqueSourceIds.filter((id) => !locationNameById.has(id));
  if (missingSources.length > 0) {
    throw new Error(`Source location(s) not found in the current company: ${missingSources.join(", ")}`);
  }

  const resolvedSourceLocationId = sql<number>`COALESCE(${stockTransferItems.sourceLocationId}, ${stockTransferVouchers.sourceLocationId})`;

  const headerRows = await db
    .select({
      transferId: stockTransferVouchers.id,
      voucherId: vouchers.id,
      voucherNumber: vouchers.voucherNumber,
      voucherDate: vouchers.voucherDate,
      voucherCreatedAt: vouchers.createdAt,
      destinationLocationId: stockTransferVouchers.destinationLocationId,
    })
    .from(stockTransferVouchers)
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .innerJoin(stockTransferItems, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        eq(vouchers.voucherType, "Stock Transfer"),
        eq(vouchers.optional, false),
        isNull(vouchers.deletedAt),
        eq(stockTransferVouchers.inventoryApplied, true),
        eq(stockTransferVouchers.destinationLocationId, destinationLocationId),
        inArray(resolvedSourceLocationId, uniqueSourceIds),
        lte(vouchers.voucherDate, asOfDate)
      )
    )
    .groupBy(
      stockTransferVouchers.id,
      vouchers.id,
      vouchers.voucherNumber,
      vouchers.voucherDate,
      vouchers.createdAt,
      stockTransferVouchers.destinationLocationId
    )
    .orderBy(desc(vouchers.voucherDate), desc(vouchers.createdAt), desc(vouchers.id))
    .limit(2);

  if (headerRows.length === 0) {
    return {
      companyId,
      destinationLocationId,
      destinationLocationName,
      selectedSourceLocationIds: uniqueSourceIds,
      selectedSourceLocationNames: uniqueSourceIds.map((id) => locationNameById.get(id)!),
      asOfDate,
      newerTransfer: null,
      olderTransfer: null,
      items: [],
      summary: `No completed stock transfer orders were found to ${destinationLocationName} from the selected source locations.`,
    };
  }

  const transferIds = headerRows.map((row) => row.transferId);
  const transferLineRows = await db
    .select({
      transferId: stockTransferItems.transferId,
      stockItemId: stockTransferItems.stockItemId,
      stockItemName: stockItems.name,
      stockItemCode: stockItems.code,
      sourceLocationId: resolvedSourceLocationId,
      quantity: stockTransferItems.quantity,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(stockItems, eq(stockTransferItems.stockItemId, stockItems.id))
    .where(and(inArray(stockTransferItems.transferId, transferIds), inArray(resolvedSourceLocationId, uniqueSourceIds)));

  const linesByTransferId = new Map<number, HistoricalTransferLine[]>();
  for (const row of transferLineRows) {
    const sourceLocationId = Number(row.sourceLocationId);
    const list = linesByTransferId.get(row.transferId) ?? [];
    list.push({
      stockItemId: row.stockItemId,
      stockItemName: row.stockItemName,
      stockItemCode: row.stockItemCode,
      sourceLocationId,
      sourceLocationName: locationNameById.get(sourceLocationId) ?? `Location #${sourceLocationId}`,
      quantity: parseQuantity(row.quantity),
    });
    linesByTransferId.set(row.transferId, list);
  }

  const orders: HistoricalTransferOrder[] = headerRows.map((header) => {
    const items = linesByTransferId.get(header.transferId) ?? [];
    const orderSourceLocationIds = Array.from(new Set(items.map((item) => item.sourceLocationId)));
    return {
      transferId: header.transferId,
      voucherId: header.voucherId,
      voucherNumber: header.voucherNumber,
      voucherDate: header.voucherDate,
      sourceLocationIds: orderSourceLocationIds,
      sourceLocationNames: orderSourceLocationIds.map((id) => locationNameById.get(id) ?? `Location #${id}`),
      destinationLocationId: header.destinationLocationId,
      destinationLocationName,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      items,
    };
  });

  const newerTransfer = orders[0] ?? null;
  const olderTransfer = orders[1] ?? null;
  const allLines = orders.flatMap((order) => order.items);
  const stockItemIds = Array.from(new Set(allLines.map((line) => line.stockItemId)));
  const earliestTransferDate = olderTransfer?.voucherDate ?? newerTransfer!.voucherDate;

  const [saleRows, destinationInventoryRows] = await Promise.all([
    db
      .select({
        stockItemId: salesItems.stockItemId,
        voucherDate: vouchers.voucherDate,
        quantity: salesItems.quantity,
      })
      .from(salesItems)
      .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          eq(vouchers.voucherType, "Sales"),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
          eq(vouchers.locationId, destinationLocationId),
          inArray(salesItems.stockItemId, stockItemIds),
          gte(vouchers.voucherDate, earliestTransferDate),
          lte(vouchers.voucherDate, asOfDate)
        )
      )
      .orderBy(vouchers.voucherDate),
    db
      .select({ stockItemId: inventory.stockItemId, quantity: inventory.quantity })
      .from(inventory)
      .where(
        and(
          eq(inventory.companyId, companyId),
          eq(inventory.locationId, destinationLocationId),
          inArray(inventory.stockItemId, stockItemIds)
        )
      ),
  ]);

  const salesByItem = new Map<number, Array<{ voucherDate: string; quantity: number }>>();
  for (const sale of saleRows) {
    const list = salesByItem.get(sale.stockItemId) ?? [];
    list.push({ voucherDate: sale.voucherDate, quantity: parseQuantity(sale.quantity) });
    salesByItem.set(sale.stockItemId, list);
  }

  const destinationQtyByItem = new Map<number, number>();
  for (const row of destinationInventoryRows) {
    destinationQtyByItem.set(row.stockItemId, parseQuantity(row.quantity));
  }

  const itemIdentity = new Map<number, { name: string; code: string }>();
  for (const line of allLines) {
    itemIdentity.set(line.stockItemId, { name: line.stockItemName, code: line.stockItemCode });
  }

  const latestWindowDays = calendarDaysInclusive(newerTransfer!.voucherDate, asOfDate);
  const fullWindowDays = calendarDaysInclusive(earliestTransferDate, asOfDate);
  const itemPerformance: HistoricalTransferItemPerformance[] = [];

  for (const stockItemId of stockItemIds) {
    const identity = itemIdentity.get(stockItemId)!;
    const itemSales = salesByItem.get(stockItemId) ?? [];
    const olderTransferQty = sumItemQuantity(olderTransfer, stockItemId);
    const newerTransferQty = sumItemQuantity(newerTransfer, stockItemId);

    const olderWindowSales = olderTransfer
      ? itemSales.filter((sale) => sale.voucherDate >= olderTransfer.voucherDate && sale.voucherDate < newerTransfer!.voucherDate)
      : [];
    const newerWindowSales = itemSales.filter(
      (sale) => sale.voucherDate >= newerTransfer!.voucherDate && sale.voucherDate <= asOfDate
    );

    const salesAfterOlderTransfer = olderWindowSales.reduce((sum, sale) => sum + sale.quantity, 0);
    const salesAfterNewerTransfer = newerWindowSales.reduce((sum, sale) => sum + sale.quantity, 0);
    const totalTransferredQty = olderTransferQty + newerTransferQty;
    const totalSalesSinceOlderTransfer = salesAfterOlderTransfer + salesAfterNewerTransfer;
    const currentDestinationQty = destinationQtyByItem.get(stockItemId) ?? 0;
    const latestSalesPerDay = salesAfterNewerTransfer / Math.max(1, latestWindowDays);
    const averageSalesPerDay = totalSalesSinceOlderTransfer / Math.max(1, fullWindowDays);
    const rateForCoverage = latestSalesPerDay > 0 ? latestSalesPerDay : averageSalesPerDay;
    const estimatedDaysOfStockRemaining = rateForCoverage > 0 ? currentDestinationQty / rateForCoverage : null;

    const classification = classifyTransferPerformance({
      olderTransferQty,
      newerTransferQty,
      salesAfterOlderTransfer,
      salesAfterNewerTransfer,
      currentDestinationQty,
      latestWindowDays,
    });

    const historicalSourceLocationIds = Array.from(
      new Set(allLines.filter((line) => line.stockItemId === stockItemId).map((line) => line.sourceLocationId))
    );

    itemPerformance.push({
      stockItemId,
      stockItemName: identity.name,
      stockItemCode: identity.code,
      historicalSourceLocationIds,
      historicalSourceLocationNames: historicalSourceLocationIds.map(
        (id) => locationNameById.get(id) ?? `Location #${id}`
      ),
      olderTransferQty: roundNumber(olderTransferQty, 3),
      newerTransferQty: roundNumber(newerTransferQty, 3),
      totalTransferredQty: roundNumber(totalTransferredQty, 3),
      salesAfterOlderTransfer: roundNumber(salesAfterOlderTransfer, 3),
      salesAfterNewerTransfer: roundNumber(salesAfterNewerTransfer, 3),
      totalSalesSinceOlderTransfer: roundNumber(totalSalesSinceOlderTransfer, 3),
      olderSellThroughPercentage: calculateSellThroughPercentage(salesAfterOlderTransfer, olderTransferQty),
      newerSellThroughPercentage: calculateSellThroughPercentage(salesAfterNewerTransfer, newerTransferQty),
      overallSellThroughPercentage: calculateSellThroughPercentage(totalSalesSinceOlderTransfer, totalTransferredQty),
      averageSalesPerDay: roundNumber(averageSalesPerDay, 3),
      latestSalesPerDay: roundNumber(latestSalesPerDay, 3),
      currentDestinationQty: roundNumber(currentDestinationQty, 3),
      estimatedDaysOfStockRemaining:
        estimatedDaysOfStockRemaining === null ? null : roundNumber(estimatedDaysOfStockRemaining, 1),
      daysToSellOlderTransfer: olderTransfer
        ? calculateDaysToSellThrough(olderWindowSales, olderTransferQty, olderTransfer.voucherDate)
        : null,
      daysToSellNewerTransfer: calculateDaysToSellThrough(
        newerWindowSales,
        newerTransferQty,
        newerTransfer!.voucherDate
      ),
      classification,
      classificationLabel: performanceLabel(classification),
      explanation: buildExplanation(
        classification,
        totalTransferredQty,
        totalSalesSinceOlderTransfer,
        currentDestinationQty,
        latestSalesPerDay,
        estimatedDaysOfStockRemaining
      ),
    });
  }

  const priority: Record<TransferPerformanceClassification, number> = {
    strong_seller: 0,
    good_seller: 1,
    normal_seller: 2,
    slow_seller: 3,
    overstocked: 4,
    no_recent_sales: 5,
  };
  itemPerformance.sort(
    (a, b) =>
      priority[a.classification] - priority[b.classification] ||
      b.latestSalesPerDay - a.latestSalesPerDay ||
      b.overallSellThroughPercentage - a.overallSellThroughPercentage ||
      a.stockItemName.localeCompare(b.stockItemName)
  );

  return {
    companyId,
    destinationLocationId,
    destinationLocationName,
    selectedSourceLocationIds: uniqueSourceIds,
    selectedSourceLocationNames: uniqueSourceIds.map((id) => locationNameById.get(id)!),
    asOfDate,
    newerTransfer,
    olderTransfer,
    items: itemPerformance,
    summary: `Analyzed ${orders.length} completed transfer order(s) to ${destinationLocationName} from ${uniqueSourceIds.length} selected source location(s). ${itemPerformance.length} transferred item(s) were compared against destination sales through ${asOfDate}.`,
  };
}
