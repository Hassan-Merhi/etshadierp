/**
 * stockSummaryLocationRoutes: LocationStockTransaction endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { eq, and, or, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import {
  containers,
  containerOffloads,
  purchaseOrders,
  poLineItems,
  vouchers,
  salesItems,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
} from "@shared/schema";

export function registerLocationStockTransactionRoutes(app: Express) {
  // Location transactions for a date range (used by "Show all months" feature)
  app.get("/api/locations/:locationId/stock-items/:stockItemId/transactions", requireAuth, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      const stockItemId = parseInt(req.params.stockItemId);
      const companyId = req.session.currentCompanyId;
      const startDate = (req.query.startDate as string) || "";
      const endDate = (req.query.endDate as string) || "";

      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (!startDate || !endDate) return res.status(400).json({ message: "startDate and endDate are required" });

      const stockItem = await storage.getStockItemById(stockItemId);
      if (!stockItem) return res.status(404).json({ message: "Stock item not found" });

      const location = await storage.getLocationById(locationId);
      if (!location) return res.status(404).json({ message: "Location not found" });

      // ── OPENING BALANCE (all movements strictly before startDate) ──────────
      let priorInQty = 0,
        priorInValue = 0,
        priorOutQty = 0,
        priorOutValue = 0;

      const priorTransfers = await db
        .select({
          quantity: stockTransferItems.quantity,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(stockTransferItems.stockItemId, stockItemId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            sql`${vouchers.voucherDate}::date < ${startDate}::date`,
            or(
              eq(stockTransferItems.sourceLocationId, locationId),
              eq(stockTransferVouchers.destinationLocationId, locationId)
            )
          )
        );
      for (const t of priorTransfers) {
        const q = parseFloat(t.quantity),
          v = parseFloat(t.totalAmount);
        if (t.sourceLocationId === locationId) {
          priorOutQty += q;
          priorOutValue += v;
        }
        if (t.destinationLocationId === locationId) {
          priorInQty += q;
          priorInValue += v;
        }
      }

      const priorAdj = await db
        .select({ quantity: stockAdjustmentItems.quantity, totalAmount: stockAdjustmentItems.totalAmount })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(stockAdjustmentItems.stockItemId, stockItemId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            eq(stockAdjustmentVouchers.locationId, locationId),
            sql`${vouchers.voucherDate}::date < ${startDate}::date`
          )
        );
      for (const a of priorAdj) {
        const q = parseFloat(a.quantity),
          v = parseFloat(a.totalAmount);
        if (q > 0) {
          priorInQty += q;
          priorInValue += v;
        } else {
          priorOutQty += Math.abs(q);
          priorOutValue += Math.abs(v);
        }
      }

      const priorSales = await db
        .select({ quantity: salesItems.quantity, totalCost: salesItems.totalCost })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(
          and(
            eq(salesItems.stockItemId, stockItemId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            eq(vouchers.locationId, locationId),
            sql`${vouchers.voucherDate}::date < ${startDate}::date`
          )
        );
      for (const s of priorSales) {
        priorOutQty += parseFloat(s.quantity);
        priorOutValue += parseFloat(s.totalCost);
      }

      const priorOffloads = await db
        .select({
          quantity: poLineItems.quantity,
          lineTotal: poLineItems.lineTotal,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(
          and(
            eq(poLineItems.stockItemId, stockItemId),
            eq(containers.companyId, companyId),
            eq(containerOffloads.locationId, locationId),
            sql`${containerOffloads.offloadedAt}::date < ${startDate}::date`
          )
        );
      for (const o of priorOffloads) {
        const q = parseFloat(o.quantity);
        priorInQty += q;
        priorInValue += parseFloat(o.lineTotal) + parseFloat(o.additionalCostPerBale) * q;
      }

      const openingQty = priorInQty - priorOutQty;
      const openingValue = priorInValue - priorOutValue;
      const openingRate = openingQty > 0 ? openingValue / openingQty : 0;

      // ── TRANSACTIONS IN DATE RANGE ────────────────────────────────────────
      type TxRaw = {
        date: string;
        particulars: string;
        vchType: string;
        voucherId: number;
        poId?: number;
        inwardQty: number;
        inwardRate: number;
        inwardValue: number;
        outwardQty: number;
        outwardRate: number;
        outwardValue: number;
        isPOS?: boolean;
        posSellingRate?: number;
        posSellingValue?: number;
      };
      const txns: TxRaw[] = [];

      // Stock Transfers
      const rangeTransfers = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherId: vouchers.id,
          quantity: stockTransferItems.quantity,
          rate: stockTransferItems.rate,
          totalAmount: stockTransferItems.totalAmount,
          sourceLocationId: stockTransferItems.sourceLocationId,
          destinationLocationId: stockTransferVouchers.destinationLocationId,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(stockTransferItems.stockItemId, stockItemId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            sql`${vouchers.voucherDate}::date >= ${startDate}::date`,
            sql`${vouchers.voucherDate}::date <= ${endDate}::date`,
            or(
              eq(stockTransferItems.sourceLocationId, locationId),
              eq(stockTransferVouchers.destinationLocationId, locationId)
            )
          )
        )
        .orderBy(vouchers.voucherDate);

      const locIds = new Set<number>();
      for (const t of rangeTransfers) {
        if (t.sourceLocationId) locIds.add(t.sourceLocationId);
        if (t.destinationLocationId) locIds.add(t.destinationLocationId);
      }
      const locMap: Record<number, string> = {};
      for (const lid of Array.from(locIds)) {
        const l = await storage.getLocationById(lid);
        if (l) locMap[lid] = l.name;
      }
      for (const t of rangeTransfers) {
        const q = parseFloat(t.quantity),
          rate = parseFloat(t.rate),
          v = parseFloat(t.totalAmount);
        const srcName = t.sourceLocationId ? locMap[t.sourceLocationId] || "Unknown" : "Unknown";
        const dstName = locMap[t.destinationLocationId] || "Unknown";
        if (t.sourceLocationId === locationId)
          txns.push({
            date: t.voucherDate,
            particulars: `To ${dstName}`,
            vchType: "Stock Transfer",
            voucherId: t.voucherId,
            inwardQty: 0,
            inwardRate: 0,
            inwardValue: 0,
            outwardQty: q,
            outwardRate: rate,
            outwardValue: v,
          });
        if (t.destinationLocationId === locationId)
          txns.push({
            date: t.voucherDate,
            particulars: `From ${srcName}`,
            vchType: "Stock Transfer",
            voucherId: t.voucherId,
            inwardQty: q,
            inwardRate: rate,
            inwardValue: v,
            outwardQty: 0,
            outwardRate: 0,
            outwardValue: 0,
          });
      }

      // Stock Adjustments
      const rangeAdj = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherId: vouchers.id,
          quantity: stockAdjustmentItems.quantity,
          rate: stockAdjustmentItems.rate,
          totalAmount: stockAdjustmentItems.totalAmount,
        })
        .from(stockAdjustmentItems)
        .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
        .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(stockAdjustmentItems.stockItemId, stockItemId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            eq(stockAdjustmentVouchers.locationId, locationId),
            sql`${vouchers.voucherDate}::date >= ${startDate}::date`,
            sql`${vouchers.voucherDate}::date <= ${endDate}::date`
          )
        )
        .orderBy(vouchers.voucherDate);
      for (const a of rangeAdj) {
        const raw = parseFloat(a.quantity),
          val = parseFloat(a.totalAmount);
        const q = Math.abs(raw),
          rate = parseFloat(a.rate),
          v = Math.abs(val);
        const isIn = raw > 0;
        txns.push({
          date: a.voucherDate,
          particulars: isIn ? "Production" : "Consumption",
          vchType: isIn ? "Production" : "Consumption",
          voucherId: a.voucherId,
          inwardQty: isIn ? q : 0,
          inwardRate: isIn ? rate : 0,
          inwardValue: isIn ? val : 0,
          outwardQty: isIn ? 0 : q,
          outwardRate: isIn ? 0 : rate,
          outwardValue: isIn ? 0 : v,
        });
      }

      // Sales
      const rangeSales = await db
        .select({
          voucherDate: vouchers.voucherDate,
          voucherId: vouchers.id,
          quantity: salesItems.quantity,
          sellingPrice: salesItems.sellingPrice,
          totalSales: salesItems.totalSales,
          costPrice: salesItems.costPrice,
          totalCost: salesItems.totalCost,
        })
        .from(salesItems)
        .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
        .where(
          and(
            eq(salesItems.stockItemId, stockItemId),
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(vouchers.optional, false),
            eq(vouchers.locationId, locationId),
            sql`${vouchers.voucherDate}::date >= ${startDate}::date`,
            sql`${vouchers.voucherDate}::date <= ${endDate}::date`
          )
        )
        .orderBy(vouchers.voucherDate);
      for (const s of rangeSales) {
        txns.push({
          date: s.voucherDate,
          particulars: "Cash",
          vchType: "POS",
          voucherId: s.voucherId,
          inwardQty: 0,
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: parseFloat(s.quantity),
          outwardRate: 0,
          outwardValue: 0,
          isPOS: true,
          posSellingRate: parseFloat(s.sellingPrice),
          posSellingValue: parseFloat(s.totalSales),
        });
      }

      // Container Offloads
      const rangeOffloads = await db
        .select({
          offloadedAt: containerOffloads.offloadedAt,
          poId: purchaseOrders.id,
          containerCode: containers.containerNumber,
          poNumber: purchaseOrders.poNumber,
          quantity: poLineItems.quantity,
          rate: poLineItems.rate,
          lineTotal: poLineItems.lineTotal,
          additionalCostPerBale: containerOffloads.additionalCostPerBale,
        })
        .from(containerOffloads)
        .innerJoin(containers, eq(containerOffloads.containerId, containers.id))
        .innerJoin(purchaseOrders, eq(purchaseOrders.containerId, containers.id))
        .innerJoin(poLineItems, eq(poLineItems.poId, purchaseOrders.id))
        .where(
          and(
            eq(poLineItems.stockItemId, stockItemId),
            eq(containers.companyId, companyId),
            eq(containerOffloads.locationId, locationId),
            sql`${containerOffloads.offloadedAt}::date >= ${startDate}::date`,
            sql`${containerOffloads.offloadedAt}::date <= ${endDate}::date`
          )
        )
        .orderBy(containerOffloads.offloadedAt);
      for (const o of rangeOffloads) {
        const q = parseFloat(o.quantity);
        const landedValue = parseFloat(o.lineTotal) + parseFloat(o.additionalCostPerBale) * q;
        const dateStr =
          o.offloadedAt instanceof Date
            ? o.offloadedAt.toISOString().split("T")[0]
            : String(o.offloadedAt).split("T")[0];
        txns.push({
          date: dateStr,
          particulars: `Container: ${o.containerCode} / PO: ${o.poNumber}`,
          vchType: "PO Offload",
          voucherId: 0,
          poId: o.poId,
          inwardQty: q,
          inwardRate: landedValue / q,
          inwardValue: landedValue,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
        });
      }

      // Sort by date (inward before outward on same date)
      txns.sort((a, b) => {
        const d = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (d !== 0) return d;
        if (a.inwardQty > 0 && b.outwardQty > 0) return -1;
        if (a.outwardQty > 0 && b.inwardQty > 0) return 1;
        return 0;
      });

      // Build running balance
      let runQty = openingQty > 0 ? openingQty : 0;
      let runValue = openingQty > 0 ? openingValue : 0;

      type TxOut = TxRaw & {
        closingQty: number;
        closingRate: number;
        closingValue: number;
        isOpeningBalance?: boolean;
      };
      const out: TxOut[] = [];

      if (runQty > 0 || runValue > 0) {
        out.push({
          date: startDate,
          particulars: "Opening Balance",
          vchType: "",
          voucherId: 0,
          inwardQty: runQty,
          inwardRate: openingRate,
          inwardValue: runValue,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
          closingQty: runQty,
          closingRate: openingRate,
          closingValue: runValue,
          isOpeningBalance: true,
        });
      }

      for (const t of txns) {
        const avgRate = runQty > 0 ? runValue / runQty : 0;
        runQty += t.inwardQty - t.outwardQty;
        const outCost = t.outwardQty * avgRate;
        runValue += t.inwardValue - outCost;
        const closingRate = runQty > 0 ? runValue / runQty : 0;
        out.push({
          ...t,
          outwardRate: t.outwardQty > 0 ? avgRate : 0,
          outwardValue: t.outwardQty > 0 ? outCost : 0,
          closingQty: runQty,
          closingRate,
          closingValue: runValue,
        });
      }

      const nonOpening = out.filter((t) => !t.isOpeningBalance);
      const totals = {
        inwardQty: nonOpening.reduce((s, t) => s + t.inwardQty, 0),
        inwardValue: nonOpening.reduce((s, t) => s + t.inwardValue, 0),
        outwardQty: nonOpening.reduce((s, t) => s + t.outwardQty, 0),
        outwardValue: nonOpening.reduce((s, t) => s + t.outwardValue, 0),
        closingQty: runQty,
        closingRate: runQty > 0 ? runValue / runQty : 0,
        closingValue: runValue,
        inwardRate: 0,
        outwardRate: 0,
      };
      totals.inwardRate = totals.inwardQty > 0 ? totals.inwardValue / totals.inwardQty : 0;
      totals.outwardRate = totals.outwardQty > 0 ? totals.outwardValue / totals.outwardQty : 0;

      res.json({ stockItem, location, startDate, endDate, transactions: out, totals });
    } catch (error: unknown) {
      logger.error("Location stock item transactions range error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
