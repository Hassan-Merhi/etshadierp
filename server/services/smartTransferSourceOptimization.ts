import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  inventory,
  salesItems,
  stockTransferItems,
  stockTransferVouchers,
  vouchers,
} from "@shared/schema";
import {
  buildSmartTransferForecastPreview,
  type SmartTransferForecastPreviewLine,
  type SmartTransferForecastPreviewResult,
} from "./smartTransferForecasting";
import type { SmartTransferPreviewOptions, SmartTransferSourceTotal } from "./smartTransferAllocation";
import { roundNumber } from "./smartTransferPerformance";

export interface SmartTransferSourceOptimizationFields {
  sourceForecastDailyRate: number;
  sourceReserveDays: number;
  sourceDynamicReserveQty: number;
  sourcePendingCommitmentQty: number;
  sourceCoverageDaysAfterCommitments: number | null;
  sourceHistoricalRouteCount: number;
  sourceHistoricalRouteQty: number;
  sourceCanCoverWholeItem: boolean;
  sourceSelectionScore: number;
  sourceRank: number;
  sourceSelectionReason: string;
}

export type SmartTransferSourceOptimizedLine =
  SmartTransferForecastPreviewLine & SmartTransferSourceOptimizationFields;

export interface SmartTransferSourceOptimizedResult
  extends Omit<SmartTransferForecastPreviewResult, "lines"> {
  sourceOptimizationVersion: 2;
  lines: SmartTransferSourceOptimizedLine[];
}

interface SourceSalesMetrics {
  sales7: number;
  sales30: number;
  sales90: number;
  rate7: number;
  rate30: number;
  rate90: number;
  forecastRate: number;
}

interface SourceCandidate {
  stockItemId: number;
  sourceLocationId: number;
  sourceLocationName: string;
  currentStock: number;
  averageRate: number;
  sales: SourceSalesMetrics;
  reserveDays: number;
  dynamicReserveQty: number;
  pendingCommitmentQty: number;
  availableQty: number;
  coverageDaysAfterCommitments: number | null;
  historicalRouteCount: number;
  historicalRouteQty: number;
  canCoverWholeItem: boolean;
  selectionScore: number;
  rank: number;
  selectionReason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseQuantity(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function wholeNonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isoDaysAgo(asOfDate: string, daysAgo: number): string {
  const date = new Date(`${asOfDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - Math.max(0, daysAgo));
  return date.toISOString().slice(0, 10);
}

function salesMetrics(
  rows: Array<{ date: string; quantity: number }>,
  sevenDayStart: string,
  thirtyDayStart: string
): SourceSalesMetrics {
  const sales7 = rows
    .filter((row) => row.date >= sevenDayStart)
    .reduce((sum, row) => sum + row.quantity, 0);
  const sales30 = rows
    .filter((row) => row.date >= thirtyDayStart)
    .reduce((sum, row) => sum + row.quantity, 0);
  const sales90 = rows.reduce((sum, row) => sum + row.quantity, 0);
  const rate7 = sales7 / 7;
  const rate30 = sales30 / 30;
  const rate90 = sales90 / 90;

  let weight7 = 0.45;
  let weight30 = 0.35;
  let weight90 = 0.2;
  if (sales7 < 3) {
    weight7 = 0.25;
    weight30 = 0.45;
    weight90 = 0.3;
  }
  if (sales30 < 5) {
    weight7 = 0.15;
    weight30 = 0.35;
    weight90 = 0.5;
  }

  return {
    sales7: roundNumber(sales7, 3),
    sales30: roundNumber(sales30, 3),
    sales90: roundNumber(sales90, 3),
    rate7: roundNumber(rate7, 3),
    rate30: roundNumber(rate30, 3),
    rate90: roundNumber(rate90, 3),
    forecastRate: roundNumber(Math.max(0, rate7 * weight7 + rate30 * weight30 + rate90 * weight90), 3),
  };
}

function dynamicReserveDays(fCanCoverWholeItem: boolean;
  sourceSelectionScore: number;
  sourceRank: number;
  sourceSelectionReason: string;
}

export type SmartTransferSourceOptimizedLine = SmartTransferForecastPreviewLine &
  SmartTransferSourceOptimizationFields;

export interface SmartTransferSourceOptimizedResult
  extends Omit<SmartTransferForecastPreviewResult, "lines"> {
  sourceOptimizationVersion: 2;
  lines: SmartTransferSourceOptimizedLine[];
}

interface SourceSalesMetrics {
  sales7: number;
  sales30: number;
  sales90: number;
  rate7: number;
  rate30: number;
  rate90: number;
  forecastRate: number;
}

interface SourceOptimizationState {
  sourceLocationId: number;
  sourceLocationName: string;
  currentStock: number;
  averageRate: number;
  sales: SourceSalesMetrics;
  reserveDays: number;
  dynamicReserveQty: number;
  pendingCommitmentQty: number;
  availableQty: number;
  coverageDaysAfterCommitments: number | null;
  historicalRouteCount: number;
  historicalRouteQty: number;
  canCoverWholeItem: boolean;
  selectionScore: number;
  rank: number;
  selectionReason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseQuantity(value: unknownstockScore = Math.round(clamp(availableShare, 0, 1) * 35);
  if (input.coverageDaysAfterCommitments !== null) {
    if (input.coverageDaysAfterCommitments >= 90) overstockScore = Math.max(overstockScore, 35);
    else if (input.coverageDaysAfterCommitments >= 60) overstockScore = Math.max(overstockScore, 30);
    else if (input.coverageDaysAfterCommitments >= 30) overstockScore = Math.max(overstockScore, 22);
    else if (input.coverageDaysAfterCommitments < 14) overstockScore = Math.min(overstockScore, 8);
  } else if (input.availableQty > 0) {
    overstockScore = Math.max(overstockScore, 28);
  }

  let localDemandProtection = 20;
  if (input.forecastRate >= 1) localDemandProtection = 4;
  else if (input.forecastRate >= 0.5) localDemandProtection = 8;
  else if (input.forecastRate >= 0.2) localDemandProtection = 12;
  else if (input.forecastRate > 0) localDemandProtection = 16;

  const if (sales30 < 5) {
    weight7 = 0.15;
    weight30 = 0.35;
    weight90 = 0.5;
  }

  let forecastRate = rate7 * weight7 + rate30 * weight30 + rate90 * weight90;
  const prior23Rate = Math.max(0, sales30 - sales7) / 23;
  if (prior23Rate > 0.01) {
    const trendRatio = rate7 / prior23Rate;
    if (trendRatio >= 1.25) forecastRate *= 1.08;
    if (trendRatio <= 0.75) forecastRate *= 0.92;
  }

  return {
    sales7: roundNumber(sales7, 3),
    sales30: roundNumber(sales30, 3),
    sales90: roundNumber(sales90, 3),
    rate7: roundNumber(rate7, 3),
    rate30: roundNumber(rate30, 3),
    rate90: roundNumber(rate90, 3),
    forecastRate: roundNumber(Math.max(0, forecastRate), 3),
  };
}

function calculateReserveDays(
  sales: SourceSalesMetrics,
  targetCoverageDays: number
): number {
  if (sales.forecastRate <= 0.02 && sales.sales90 < 2) return 0;
  if (sales.forecastRate >= 1 || sales.sales7 >= 7) {
    return Math.min(30, Math.max(14, Math.min(targetCoverageDays, 21)));
  }
  if (sales.forecastRate >= 0.25 || sales.sales30 >= 5) {
    return Math.min(21, Math.max(10, Math.ceil(targetCoverageDays * 0.67)));
  }
  return 7;
}

function calculateDynamicReserve(
  currentStock: number,
  sales: SourceSalesMetrics,
  reserveDays: number
): number {
  if (currentStock <= 0 || reserveDays <= 0) return 0;
  const baseReserve = Math.ceil(sales.forecastRate * reserveDays);
  const accelerationBuffer = Math.ceil(Math.max(0, sales.rate7 - sales.rate30) * 7);
  const minimumFloor = sales.sales90 > 0 ? 1 : 0;
  return Math.min(currentStock, Math.max(minimumFloor, baseReserve + accelerationBuffer));
}

function sourceSelectionScore(
  state: Omit<SourceOptimizationState, "selectionScore" | "rank" | "selectionReason">,
  itemQuantity: number
): number {
  const availableRatio = state.currentStock > 0 ? state.availableQty / state.currentStock : 0;
  let overstockScore = 0;
  if (availableRatio >= 0.6) overstockScore = 35;
  else if (availableRatio >= 0.4) overstockScore = 28;
  else if (availableRatio >= 0.25) overstockScore = 20;
  else if (availableRatio > 0) overstockScore = 10;

  let localProtectionScore = 0;
  if (state.sales.forecastRate <= 0.02) localProtectionScore = 20;
  else if (state.coverageDaysAfterCommitments === null) localProtectionScore = 18;
  else if (state.coverageDaysAfterCommitments >= 60) localProtectionScore = 20;
  else if (state.coverageDaysAfterCommitments >= 30) localProtectionScore = 15;
  else if (state.coverageDaysAfterCommitments >= 21) localProtectionScore = 10;
  else if (state.coverageDaysAfterCommitments >= 14) localProtectionScore = 5;

  const routeScore = clamp(
    state.historicalRouteCount * 4 + Math.round(Math.log1p(state.historicalRouteQty) * 2),
    0,
    20
  );
Preview(
  companyId: number,
  sourceLocationIds: number[],
  destinationLocationId: number,
  targetQuantity: number,
  options: SmartTransferPreviewOptions = {}
): Promise<SmartTransferSourceOptimizedResult> {
  const base = await buildSmartTransferForecastPreview(
    companyId,
    sourceLocationIds,
    destinationLocationId,
    targetQuantity,
    options
  );

  if (base.lines.length === 0) {
    return {
      ...base,
      sourceOptimizationVersion: 2,
      lines: [],
      summary: `${base.summary} Phase 2 had no source allocations to optimize.`,
    };
  }

  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
  const sevenDayStart = isoDaysAgo(asOfDate, 6);
  const thirtyDayStart = isoDaysAgo(asOfDate, 29);
  const ninetyDayStart = isoDaysAgo(asOfDate, 89);
  const routeStart = isoDaysAgo(asOfDate, 179);
  const selectedSourceIds = base.sourceLocationIds;
  const stockItemIds = Array.from(new Set(base.lines.map((line) => line.stockItemId)));
  const sourceNameById = new Map(
    base.sourceLocationIds.map((id, index) => [id, base.sourceLocationNames[index] ?? `Location #${id}`])
  );
  const resolvedSourceLocationId = sql<number>`COALESCE(${stockTransferItems.sourceLocationId}, ${stockTransferVouchers.sourceLocationId})`;

  const [sourceInventoryRows, sourceSalesRows, pendingRows, routeRows] = await Promise.all([
    db
      .select({
        stockItemId: inventory.stockItemId,
        locationId: inventory.locationId,
        quantity: inventory.quantity,
        averageRate: inventory.averageRate,
      })
      .from(inventory)
      .where(
        and(
          eq(inventory.companyId, companyId),
          inArray(inventory.stockItemId, stockItemIds),
          inArray(inventory.locationId, selectedSourceIds)
        )
      ),
    db
      .select({
        stockItemId: salesItems.stockItemId,
        locationId: vouchers.locationId,
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
          inArray(vouchers.locationId, selectedSourceIds),
          inArray(salesItems.stockItemId, stockItemIds),
          gte(vouchers.voucherDate, ninetyDayStart),
          lte(vouchers.voucherDate, asOfDate)
        )
      ),
    db
      .select({
        stockItemId: stockTransferItems.stockItemId,
        sourceLocationId: resolvedSourceLocationId,
        quantity: stockTransferItems.quantity,
      })
      .from(stockTransferItems)
      .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
      .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          inArray(vouchers.voucherType, ["Stock Transfer", "StockTransfer"]),
          isNull(vouchers.deletedAt),
          eq(stockTransferVouchers.inventoryApplied, false),
          inArray(stockTransferItems.stockItemId, stockItemIds),
          inArray(resolvedSourceLocationId, selectedSourceIds)
        )
      ),
    db
      .select({
        stockItemId: stockTransferItems.stockItemId,
        sourceLocationId: resolvedSourceLocationId,
        quantity: stockTransferItems.quantity,
        transferId: stockTransferVouchers.id,
      })
      .from(stockTransferItems)
      .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
      .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          inArray(vouchers.voucherType, ["Stock Transfer", "StockTransfer"]),
          eq(vouchers.optional, false),
          isNull(vouchers.deletedAt),
          eq(stockTransferVouchers.inventoryApplied, true),
          eq(stockTransferVouchers.destinationLocationId, destinationLocationId),
          inArray(stockTransferItems.stockItemId, stockItemIds),
          inArray(resolvedSourceLocationId, selectedSourceIds),
          gte(vouchers.voucherDate, routeStart),
          lte(vouchers.voucherDate, asOfDate)
        )
      ),
  ]);

  const salesBySourceItem = new Map<string, Array<{ date: string; quantity: number }>>();
  for (const row of sourceSalesRows) {
    if (!row.locationId) continue;
    const key = `${row.stockItemId}:${row.locationId}`;
    const list = salesBySourceItem.get(key) ?? [];
    list.push({ date: row.voucherDate, quantity: parseQuantity(row.quantity) });
    salesBySourceItem.set(key, list);
  }

  const pendingBySourceItem = new Map<string, number>();
  for (const row of pendingRows) {
    const sourceLocationId = Number(row.sourceLocationId);
    if (!Number.isInteger(sourceLocationId)) continue;
    const key = `${row.stockItemId}:${sourceLocationId}`;
    pendingBySourceItem.set(key, (pendingBySourceItem.get(key) ?? 0) + parseQuantity(row.quantity));
  }

  const routeBySourceItem = new Map<string, { transferIds: Set<number>; quantity: number }>();
  for (const row of routeRows) {
    const sourceLocationId = Number(row.sourceLocationId);
    if (!Number.isInteger(sourceLocationId)) continue;
    const key = `${row.stockItemId}:${sourceLocationId}`;
    const current = routeBySourceItem.get(key) ?? { transferIds: new Set<number>(), quantity: 0 };
    current.transferIds.add(row.transferId);
    current.quantity += parseQuantity(row.quantity);
    routeBySourceItem.set(key, current);
  }

  const itemTotalById = new Map<number, number>();
  const representativeById = new Map<number, SmartTransferForecastPreviewLine>();
  for (const line of base.lines) {
    itemTotalById.set(line.stockItemId, (itemTotalById.get(line.stockItemId) ?? 0) + line.suggestedQuantity);
    if (!representativeById.has(line.stockItemId)) representativeById.set(line.stockItemId, line);
  }

  const sourceCandidatesByItem = new Map<number, SourceCandidate[]>();
  for (const row of sourceInventoryRows) {
    const itemTotal = itemTotalById.get(row.stockItemId) ?? 0;
    if (itemTotal <= 0) continue;
    const sourceLocationId = row.locationId;
    const key = `${row.stockItemId}:${sourceLocationId}`;
    const currentStock = wholeNonNegative(parseQuantity(row.quantity));
    if (currentStock <= 0) continue;
    const metrics = salesMetrics(salesBySourceItem.get(key) ?? [], sevenDayStart, thirtyDayStart);
    const reserveDays = dynamicReserveDays(metrics.forecastRate, base.targetCoverageDays);
    const reserveQty = dynamicReserveQty(metrics, reserveDays);
    const pendingCommitmentQty = wholeNonNegative(pendingBySourceItem.get(key) ?? 0);
    const stockAfterCommitments = Math.max(0, currentStock - pendingCommitmentQty);
    const availableQty = Math.max(0, stockAfterCommitments - reserveQty);
    if (availableQty <= 0) continue;
    const route = routeBySourceItem.get(key);
    const coverageDaysAfterCommitments = metrics.forecastRate > 0
      ? stockAfterCommitments / metrics.forecastRate
      : null;
    const canCoverWholeItem = availableQty >= itemTotal;
    const selectionScore = sourceSelectionScore({
      currentStock,
      availableQty,
      pendingCommitmentQty,
      forecastRate: metrics.forecastRate,
      coverageDaysAfterCommitments,
      historicalRouteCount: route?.transferIds.size ?? 0,
      historicalRouteQty: route?.quantity ?? 0,
      itemTotal,
    });
    const sourceWithoutReason = {
      stockItemId: row.stockItemId,
      sourceLocationId,
      sourceLocationName: sourceNameById.get(sourceLocationId) ?? `Location #${sourceLocationId}`,
      currentStock,
      averageRate: roundNumber(parseQuantity(row.averageRate), 2),
      sales: metrics,
      reserveDays,
      dynamicReserveQty: reserveQty,
      pendingCommitmentQty,
      availableQty,
      coverageDaysAfterCommitments:
        coverageDaysAfterCommitments === null ? null : roundNumber(coverageDaysAfterCommitments, 1),
      historicalRouteCount: route?.transferIds.size ?? 0,
      historicalRouteQty: roundNumber(route?.quantity ?? 0, 3),
      canCoverWholeItem,
      selectionScore,
    };
    const list = sourceCandidatesByItem.get(row.stockItemId) ?? [];
    list.push({
      ...sourceWithoutReason,
      rank: 0,
      selectionReason: buildSourceReason(sourceWithoutReason),
    });
    sourceCandidatesByItem.set(row.stockItemId, list);
  }

  const lines: SmartTransferSourceOptimizedLine[] = [];
  let avoidedSplits = 0;
  let pendingCommitmentTotal = 0;

  for (const [stockItemId, itemTotal] of itemTotalById.entries()) {
    const representative = representativeById.get(stockItemId);
    if (!representative) continue;
    const sources = (sourceCandidatesByItem.get(stockItemId) ?? [])
      .sort(
        (a, b) =>
          b.selectionScore - a.selectionScore ||
          Number(b.canCoverWholeItem) - Number(a.canCoverWholeItem) ||
          b.availableQty - a.availableQty ||
          a.sourceLocationName.localeCompare(b.sourceLocationName)
      )
      .map((source, index) => ({ ...source, rank: index + 1 }));

    if (sources.length === 0) continue;
    const previousSplitCount = base.lines.filter((line) => line.stockItemId === stockItemId).length;
    const allocations = allocateWithMinimumSplits(sources, itemTotal);
    if (previousSplitCount > allocations.size) avoidedSplits += previousSplitCount - allocations.size;

    for (const source of sources) {
      const suggestedQuantity = allocations.get(source.sourceLocationId) ?? 0;
      if (suggestedQuantity <= 0) continue;
      pendingCommitmentTotal += source.pendingCommitmentQty;
      lines.push({
        ...representative,
        sourceLocationId: source.sourceLocationId,
        sourceLocationName: source.sourceLocationName,
        availableAtSource: source.availableQty,
        sourceCurrentStock: source.currentStock,
        sourceReserveQty: source.dynamicReserveQty + source.pendingCommitmentQty,
        sourceAverageRate: source.averageRate,
        suggestedQuantity,
        itemSuggestedTotal: itemTotal,
        reason: `${representative.reason} Phase 2 source choice: ${source.selectionReason}`,
        sourceForecastDailyRate: source.sales.forecastRate,
        sourceReserveDays: source.reserveDays,
        sourceDynamicReserveQty: source.dynamicReserveQty,
        sourcePendingCommitmentQty: source.pendingCommitmentQty,
        sourceCoverageDaysAfterCommitments: source.coverageDaysAfterCommitments,
        sourceHistoricalRouteCount: source.historicalRouteCount,
        sourceHistoricalRouteQty: source.historicalRouteQty,
        sourceCanCoverWholeItem: source.canCoverWholeItem,
        sourceSelectionScore: source.selectionScore,
        sourceRank: source.rank,
        sourceSelectionReason: source.selectionReason,
      });
    }
  }

  lines.sort(
    (a, b) =>
      b.itemScore - a.itemScore ||
      b.sourceSelectionScore - a.sourceSelectionScore ||
      a.stockItemName.localeCompare(b.stockItemName) ||
      a.sourceRank - b.sourceRank
  );

  const achievedQuantity = lines.reduce((sum, line) => sum + line.suggestedQuantity, 0);
  const shortfallQuantity = Math.max(0, base.targetQuantity - achievedQuantity);
  const totalsMap = new Map<number, SmartTransferSourceTotal>();
  for (const line of lines) {
    const current = totalsMap.get(line.sourceLocationId) ?? {
      sourceLocationId: line.sourceLocationId,
      sourceLocationName: line.sourceLocationName,
      suggestedQuantity: 0,
      lineCount: 0,
    };
    current.suggestedQuantity += line.suggestedQuantity;
    current.lineCount += 1;
    totalsMap.set(line.sourceLocationId, current);
  }
  const totalsBySource = Array.from(totalsMap.values()).sort(
    (a, b) => b.suggestedQuantity - a.suggestedQuantity || a.sourceLocationName.localeCompare(b.sourceLocationName)
  );

  const warnings = base.warnings.filter((warning) => !/source stock after reserve was insufficient/i.test(warning));
  if (shortfallQuantity > 0) {
    warnings.push(
      `Phase 2 is short by ${shortfallQuantity} whole unit(s) after dynamic local reserves and unposted transfer commitments were protected.`
    );
  }
  if (pendingCommitmentTotal > 0) {
    warnings.push(
      `Unposted transfer commitments were deducted before source allocation; selected lines referenced ${pendingCommitmentTotal} committed unit(s) across their source/item balances.`
    );
  }
  if (avoidedSplits > 0) {
    warnings.push(`Phase 2 removed ${avoidedSplits} unnecessary source split(s) by preferring sources that could fulfill whole item quantities.`);
  }

  return {
    ...base,
    sourceOptimizationVersion: 2,
    achievedQuantity,
    shortfallQuantity,
    shortfall: shortfallQuantity > 0,
    lines,
    totalsBySource,
    warnings,
    summary: `Phase 2 optimized ${achievedQuantity} of ${base.targetQuantity} unit(s) using dynamic source reserves, pending commitments, overstock, route history and minimum-split source selection.`,
  };
}
