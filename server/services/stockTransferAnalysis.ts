/**
 * server/services/stockTransferAnalysis.ts
 *
 * Deterministic, DB-driven stock-transfer suggestion analysis used by the AI
 * chat assistant. This module never lets an LLM invent quantities — every
 * number returned here comes directly from SQL queries against the same
 * tables the rest of the app already uses (inventory, salesItems/vouchers,
 * stockTransferVouchers/Items). The LLM's only job is to pick which two
 * locations and which time window to analyze; this function does the math.
 *
 * IMPORTANT: this module is READ-ONLY. It never writes to the database and
 * never moves inventory. Creating an actual (optional) stock transfer still
 * goes through the existing /api/stock-transfers endpoint.
 */
import { db } from "../db";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  locations,
  stockItems,
  inventory,
  salesItems,
  vouchers,
  stockTransferVouchers,
  stockTransferItems,
} from "@shared/schema";

export type Aggressiveness = "conservative" | "normal" | "aggressive";

export interface LocationCandidate {
  id: number;
  name: string;
  code: string;
}

export interface LocationMatchResult {
  matched: { id: number; name: string; code: string } | null;
  candidates: LocationCandidate[];
}

export interface StockTransferSuggestionItem {
  stockItemId: number;
  stockItemName: string;
  stockItemCode: string;
  sourceQty: number;
  destinationQty: number;
  sourceSalesQty: number;
  destinationSalesQty: number;
  sourceSalesRate: number; // units/day
  destinationSalesRate: number; // units/day
  otwQty: number | null;
  suggestedQty: number;
  reason: string;
  confidence: number; // 0-1
  previousTransferQty: number;
  previousTransferCount: number;
  lastTransferDate: string | null;
  oldTransferSummary: string;
}

export interface StockTransferSuggestionContext {
  sourceLocationId: number;
  sourceLocationName: string;
  destinationLocationId: number;
  destinationLocationName: string;
  dateFrom: string;
  dateTo: string;
  days: number;
  aggressiveness: Aggressiveness;
  items: StockTransferSuggestionItem[];
  analysisSummary: string;
  otwAvailable: boolean;
  otwSkippedReason: string | null;
  oldTransferSummary: string;
}

/**
 * Fuzzy-match a user-provided location name/code against the company's
 * `locations` table. Never silently picks between multiple plausible
 * matches — callers must check `candidates.length > 1` and ask the user.
 */
export async function matchLocationByName(companyId: number, rawName: string): Promise<LocationMatchResult> {
  const needle = rawName.trim().toLowerCase();
  if (!needle) return { matched: null, candidates: [] };

  const rows = await db
    .select({ id: locations.id, name: locations.name, code: locations.code })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)));

  const exact = rows.filter(
    (r) => r.name.trim().toLowerCase() === needle || r.code.trim().toLowerCase() === needle
  );
  if (exact.length === 1) return { matched: exact[0], candidates: [] };
  if (exact.length > 1) return { matched: null, candidates: exact };

  const partial = rows.filter(
    (r) => r.name.toLowerCase().includes(needle) || needle.includes(r.name.toLowerCase())
  );
  if (partial.length === 1) return { matched: partial[0], candidates: [] };
  if (partial.length > 1) return { matched: null, candidates: partial };

  return { matched: null, candidates: [] };
}

function safetyDays(aggressiveness: Aggressiveness): { destDays: number; sourceProtectionDays: number } {
  switch (aggressiveness) {
    case "conservative":
      return { destDays: 14, sourceProtectionDays: 21 };
    case "aggressive":
      return { destDays: 30, sourceProtectionDays: 7 };
    case "normal":
    default:
      return { destDays: 21, sourceProtectionDays: 14 };
  }
}

/**
 * Build a fully DB-backed stock-transfer suggestion context between two
 * locations. All quantities/rates come from SQL; nothing here is guessed.
 */
export async function buildStockTransferSuggestionContext(
  companyId: number,
  fromLocationId: number,
  toLocationId: number,
  dateFrom: string,
  dateTo: string,
  options?: { aggressiveness?: Aggressiveness; itemLimit?: number }
): Promise<StockTransferSuggestionContext> {
  if (fromLocationId === toLocationId) {
    throw new Error("Source and destination locations must be different");
  }

  const aggressiveness: Aggressiveness = options?.aggressiveness || "normal";
  const { destDays, sourceProtectionDays } = safetyDays(aggressiveness);

  const [sourceLoc, destLoc] = await Promise.all([
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.id, fromLocationId), eq(locations.companyId, companyId)))
      .limit(1),
    db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.id, toLocationId), eq(locations.companyId, companyId)))
      .limit(1),
  ]);
  if (!sourceLoc[0]) throw new Error("Source location not found for this company");
  if (!destLoc[0]) throw new Error("Destination location not found for this company");

  const startOfDay = `${dateFrom} 00:00:00`;
  const endOfDay = `${dateTo} 23:59:59`;
  const days = Math.max(
    1,
    Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  // ── Current inventory at both locations ──────────────────────────────
  const invRows = await db
    .select({
      stockItemId: inventory.stockItemId,
      locationId: inventory.locationId,
      quantity: inventory.quantity,
    })
    .from(inventory)
    .where(
      and(
        eq(inventory.companyId, companyId),
        inArray(inventory.locationId, [fromLocationId, toLocationId])
      )
    );

  // ── Recent sales by item/location (same source pattern used by POS/location sales reports) ──
  const salesRows = await db
    .select({
      stockItemId: salesItems.stockItemId,
      locationId: vouchers.locationId,
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
        inArray(vouchers.locationId, [fromLocationId, toLocationId]),
        gte(vouchers.voucherDate, dateFrom),
        lte(vouchers.voucherDate, dateTo)
      )
    );

  // ── Active stock items for this company (limit to a sane batch) ─────
  const itemLimit = options?.itemLimit ?? 200;
  const items = await db
    .select({ id: stockItems.id, name: stockItems.name, code: stockItems.code })
    .from(stockItems)
    .where(and(eq(stockItems.companyId, companyId), eq(stockItems.active, true), isNull(stockItems.deletedAt)))
    .limit(itemLimit);

  // ── Old transfers between these two exact locations (either direction) ──
  const oldTransferRows = await db
    .select({
      stockItemId: stockTransferItems.stockItemId,
      quantity: stockTransferItems.quantity,
      voucherDate: vouchers.voucherDate,
      sourceLocationId: stockTransferVouchers.sourceLocationId,
      destinationLocationId: stockTransferVouchers.destinationLocationId,
    })
    .from(stockTransferItems)
    .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
    .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
    .where(
      and(
        eq(vouchers.companyId, companyId),
        isNull(vouchers.deletedAt),
        eq(stockTransferVouchers.sourceLocationId, fromLocationId),
        eq(stockTransferVouchers.destinationLocationId, toLocationId)
      )
    )
    .orderBy(desc(vouchers.voucherDate));

  // ── Build lookup maps ─────────────────────────────────────────────────
  const invMap = new Map<string, number>();
  for (const r of invRows) {
    invMap.set(`${r.locationId}:${r.stockItemId}`, parseFloat(r.quantity as any) || 0);
  }
  const salesMap = new Map<string, number>();
  for (const r of salesRows) {
    if (!r.locationId) continue;
    const key = `${r.locationId}:${r.stockItemId}`;
    salesMap.set(key, (salesMap.get(key) || 0) + (parseFloat(r.quantity as any) || 0));
  }
  const oldTransferByItem = new Map<number, { qty: number; count: number; lastDate: string | null }>();
  for (const r of oldTransferRows) {
    const cur = oldTransferByItem.get(r.stockItemId) || { qty: 0, count: 0, lastDate: null };
    cur.qty += parseFloat(r.quantity as any) || 0;
    cur.count += 1;
    if (!cur.lastDate || r.voucherDate > cur.lastDate) cur.lastDate = r.voucherDate;
    oldTransferByItem.set(r.stockItemId, cur);
  }

  // OTW: no reliable per-item, per-destination-location "in transit" data
  // source exists in this codebase today (containers/PO line items are not
  // tied to a destination location). Do not fake it.
  const otwAvailable = false;
  const otwSkippedReason = "OTW not available from current data source.";

  const suggestions: StockTransferSuggestionItem[] = [];

  for (const item of items) {
    const sourceQty = invMap.get(`${fromLocationId}:${item.id}`) || 0;
    const destQty = invMap.get(`${toLocationId}:${item.id}`) || 0;
    const sourceSalesQty = salesMap.get(`${fromLocationId}:${item.id}`) || 0;
    const destSalesQty = salesMap.get(`${toLocationId}:${item.id}`) || 0;

    const sourceRate = sourceSalesQty / days;
    const destRate = destSalesQty / days;

    if (sourceQty <= 0) continue;

    const sourceSafetyStock = Math.max(sourceRate * sourceProtectionDays, sourceSalesQty > 0 ? 1 : 0);
    const sourceSurplus = sourceQty - sourceSafetyStock;
    if (sourceSurplus <= 0) continue;

    const destTargetStock = destRate * destDays;
    const otwQty: number | null = otwAvailable ? 0 : null;
    const destNeed = destTargetStock - (destQty + (otwQty || 0));

    const destDemandHigher = destRate > sourceRate;
    const destStockoutRisk = destRate > 0 && destQty / Math.max(destRate, 0.0001) < destDays;

    if (!destDemandHigher && !destStockoutRisk) continue;
    if (destNeed <= 0) continue;

    let suggestedQty = Math.floor(Math.min(sourceSurplus, destNeed));
    if (suggestedQty <= 0) continue;
    if (suggestedQty > sourceQty) suggestedQty = Math.floor(sourceQty);
    if (suggestedQty <= 0) continue;

    const oldTransfer = oldTransferByItem.get(item.id);
    let confidence = 0.55;
    let oldTransferSummary = "No previous transfers found between these locations for this item.";
    if (oldTransfer) {
      oldTransferSummary = `Transferred ${oldTransfer.count} time(s) before, ${oldTransfer.qty.toFixed(0)} total units, last on ${oldTransfer.lastDate}.`;
      if (destSalesQty > 0) {
        confidence += 0.2;
        oldTransferSummary += " Destination sold this item well after previous transfers.";
      } else {
        confidence -= 0.15;
        oldTransferSummary += " Destination sales stayed low after previous transfers.";
      }
    }
    confidence = Math.max(0.1, Math.min(0.95, confidence));

    const reasonParts: string[] = [];
    if (destDemandHigher) {
      reasonParts.push(
        `${item.name} sells faster in ${destLoc[0].name} (${destRate.toFixed(2)}/day) than in ${sourceLoc[0].name} (${sourceRate.toFixed(2)}/day)`
      );
    }
    if (destStockoutRisk) {
      reasonParts.push(`${destLoc[0].name} stock (${destQty}) covers less than ${destDays} days of sales`);
    }
    reasonParts.push(`${sourceLoc[0].name} has surplus of ${sourceSurplus.toFixed(0)} above its safety stock`);
    if (oldTransfer) reasonParts.push(oldTransferSummary);

    suggestions.push({
      stockItemId: item.id,
      stockItemName: item.name,
      stockItemCode: item.code,
      sourceQty,
      destinationQty: destQty,
      sourceSalesQty,
      destinationSalesQty: destSalesQty,
      sourceSalesRate: Math.round(sourceRate * 100) / 100,
      destinationSalesRate: Math.round(destRate * 100) / 100,
      otwQty,
      suggestedQty,
      reason: reasonParts.join("; "),
      confidence: Math.round(confidence * 100) / 100,
      previousTransferQty: oldTransfer?.qty || 0,
      previousTransferCount: oldTransfer?.count || 0,
      lastTransferDate: oldTransfer?.lastDate || null,
      oldTransferSummary,
    });
  }

  suggestions.sort((a, b) => b.confidence - a.confidence || b.suggestedQty - a.suggestedQty);

  const oldTransferTotalCount = oldTransferRows.length;
  const oldTransferSummaryOverall =
    oldTransferTotalCount > 0
      ? `${oldTransferTotalCount} previous transfer line(s) found from ${sourceLoc[0].name} to ${destLoc[0].name}.`
      : `No previous transfers found from ${sourceLoc[0].name} to ${destLoc[0].name}.`;

  const analysisSummary =
    suggestions.length > 0
      ? `Analyzed ${items.length} active item(s) over ${dateFrom} to ${dateTo} (${days} day(s), ${aggressiveness} mode). Found ${suggestions.length} item(s) worth transferring from ${sourceLoc[0].name} to ${destLoc[0].name}. ${oldTransferSummaryOverall} ${otwSkippedReason}`
      : `Analyzed ${items.length} active item(s) over ${dateFrom} to ${dateTo} (${days} day(s), ${aggressiveness} mode). No items currently qualify for transfer from ${sourceLoc[0].name} to ${destLoc[0].name} (no surplus, or destination demand does not justify a move). ${oldTransferSummaryOverall}`;

  return {
    sourceLocationId: fromLocationId,
    sourceLocationName: sourceLoc[0].name,
    destinationLocationId: toLocationId,
    destinationLocationName: destLoc[0].name,
    dateFrom,
    dateTo,
    days,
    aggressiveness,
    items: suggestions,
    analysisSummary,
    otwAvailable,
    otwSkippedReason,
    oldTransferSummary: oldTransferSummaryOverall,
  };
}
