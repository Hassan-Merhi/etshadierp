/**
 * Inventory movement, reconciliation & import routes.
 *
 * Monthly stock-movement summary + drill-down, inventory reconciliation, the
 * per-location "vouchers today" feed, and the cost-price / inventory import
 * endpoints. Extracted from inventoryRoutes.ts as a sub-registrar; the
 * movement-only MONTH_NAMES_INV constant and the dayBefore / fetchStockMovements
 * closures move with it. Behaviour is unchanged.
 */
import type { Express } from "express";
import { eq, and, or, desc, isNull, isNotNull, gte, lte, lt } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireRole, checkPOSLocation } from "../auth";
import { calculateHistoricalLocationInventory } from "./helpers/inventoryHistoryHelpers";
import {
  inventory,
  stockItems,
  stockItemCodeAliases,
  purchaseOrders,
  poLineItems,
  vouchers,
  salesItems,
  stockTransferVouchers,
  stockTransferItems,
  stockAdjustmentVouchers,
  stockAdjustmentItems,
  creditNoteItems,
} from "@shared/schema";

export function registerInventoryMovementRoutes(app: Express) {
  const MONTH_NAMES_INV = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Returns the calendar day immediately before the given YYYY-MM-DD date string.
  function dayBefore(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  interface StockMovementTx {
    date: string;
    particulars: string;
    vchType: string;
    voucherId: number | null;
    poId: number | null;
    inwardQty: number;
    inwardRate: number;
    inwardValue: number;
    outwardQty: number;
    outwardRate: number;
    outwardValue: number;
    isPOS: boolean;
    posSellingRate: number;
    posSellingValue: number;
  }

  async function fetchStockMovements(
    companyId: number,
    stockItemId: number,
    locationId: number | null,
    fromDate: string | null,
    toDate: string | null,
    toDateExclusive = false
  ): Promise<StockMovementTx[]> {
    const results: StockMovementTx[] = [];

    const dateConds = (dateCol: any): any[] => {
      const parts: any[] = [];
      if (fromDate) parts.push(gte(dateCol, fromDate));
      if (toDate) parts.push(toDateExclusive ? lt(dateCol, toDate) : lte(dateCol, toDate));
      return parts;
    };

    // 1. Sales (outward)
    const salesRows = await db
      .select({
        date: vouchers.voucherDate,
        voucherNumber: vouchers.voucherNumber,
        voucherType: vouchers.voucherType,
        voucherId: vouchers.id,
        qty: salesItems.quantity,
        costPrice: salesItems.costPrice,
        totalCost: salesItems.totalCost,
        sellingPrice: salesItems.sellingPrice,
        totalSales: salesItems.totalSales,
      })
      .from(salesItems)
      .innerJoin(vouchers, eq(salesItems.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(salesItems.stockItemId, stockItemId),
          ...(locationId !== null ? [eq(vouchers.locationId, locationId)] : []),
          ...dateConds(vouchers.voucherDate)
        )
      );

    for (const r of salesRows) {
      const qty = parseFloat(r.qty || "0");
      const value = parseFloat(r.totalCost || "0");
      const vt = r.voucherType || "Sales";
      results.push({
        date: r.date,
        particulars: r.voucherNumber,
        vchType: vt,
        voucherId: r.voucherId,
        poId: null,
        inwardQty: 0,
        inwardRate: 0,
        inwardValue: 0,
        outwardQty: qty,
        outwardRate: qty > 0 ? value / qty : 0,
        outwardValue: value,
        isPOS: vt.toLowerCase().includes("pos"),
        posSellingRate: parseFloat(r.sellingPrice || "0"),
        posSellingValue: parseFloat(r.totalSales || "0"),
      });
    }

    // 2. Credit Notes (inward = returns)
    const cnRows = await db
      .select({
        date: vouchers.voucherDate,
        voucherNumber: vouchers.voucherNumber,
        voucherType: vouchers.voucherType,
        voucherId: vouchers.id,
        qty: creditNoteItems.quantity,
        totalValue: creditNoteItems.totalValue,
        inventoryCost: creditNoteItems.inventoryCost,
      })
      .from(creditNoteItems)
      .innerJoin(vouchers, eq(creditNoteItems.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(creditNoteItems.stockItemId, stockItemId),
          ...(locationId !== null ? [eq(creditNoteItems.locationId, locationId)] : []),
          ...dateConds(vouchers.voucherDate)
        )
      );

    for (const r of cnRows) {
      const qty = parseFloat(r.qty || "0");
      const value = parseFloat(r.totalValue || "0");
      results.push({
        date: r.date,
        particulars: r.voucherNumber,
        vchType: r.voucherType || "Credit Note",
        voucherId: r.voucherId,
        poId: null,
        inwardQty: qty,
        inwardRate: qty > 0 ? value / qty : 0,
        inwardValue: value,
        outwardQty: 0,
        outwardRate: 0,
        outwardValue: 0,
        isPOS: false,
        posSellingRate: 0,
        posSellingValue: 0,
      });
    }

    // 3. Stock Adjustments (positive qty = inward, negative = outward)
    const adjRows = await db
      .select({
        date: vouchers.voucherDate,
        voucherNumber: vouchers.voucherNumber,
        voucherType: vouchers.voucherType,
        voucherId: vouchers.id,
        adjustmentType: stockAdjustmentVouchers.adjustmentType,
        qty: stockAdjustmentItems.quantity,
        rate: stockAdjustmentItems.rate,
      })
      .from(stockAdjustmentItems)
      .innerJoin(stockAdjustmentVouchers, eq(stockAdjustmentItems.adjustmentId, stockAdjustmentVouchers.id))
      .innerJoin(vouchers, eq(stockAdjustmentVouchers.voucherId, vouchers.id))
      .where(
        and(
          eq(vouchers.companyId, companyId),
          isNull(vouchers.deletedAt),
          eq(stockAdjustmentItems.stockItemId, stockItemId),
          ...(locationId !== null ? [eq(stockAdjustmentVouchers.locationId, locationId)] : []),
          ...dateConds(vouchers.voucherDate)
        )
      );

    for (const r of adjRows) {
      const qty = parseFloat(r.qty || "0");
      const rate = parseFloat(r.rate || "0");
      if (qty > 0) {
        results.push({
          date: r.date,
          particulars: r.voucherNumber,
          vchType: r.voucherType || r.adjustmentType || "Production",
          voucherId: r.voucherId,
          poId: null,
          inwardQty: qty,
          inwardRate: rate,
          inwardValue: qty * rate,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
          isPOS: false,
          posSellingRate: 0,
          posSellingValue: 0,
        });
      } else if (qty < 0) {
        const absQty = Math.abs(qty);
        results.push({
          date: r.date,
          particulars: r.voucherNumber,
          vchType: r.voucherType || r.adjustmentType || "Consumption",
          voucherId: r.voucherId,
          poId: null,
          inwardQty: 0,
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: absQty,
          outwardRate: rate,
          outwardValue: absQty * rate,
          isPOS: false,
          posSellingRate: 0,
          posSellingValue: 0,
        });
      }
    }

    // 4. Stock Transfers (only when a specific location is requested)
    if (locationId !== null) {
      const tfRows = await db
        .select({
          date: vouchers.voucherDate,
          voucherNumber: vouchers.voucherNumber,
          voucherType: vouchers.voucherType,
          voucherId: vouchers.id,
          sourceLocId: stockTransferItems.sourceLocationId,
          destLocId: stockTransferVouchers.destinationLocationId,
          qty: stockTransferItems.quantity,
          rate: stockTransferItems.rate,
          totalAmount: stockTransferItems.totalAmount,
        })
        .from(stockTransferItems)
        .innerJoin(stockTransferVouchers, eq(stockTransferItems.transferId, stockTransferVouchers.id))
        .innerJoin(vouchers, eq(stockTransferVouchers.voucherId, vouchers.id))
        .where(
          and(
            eq(vouchers.companyId, companyId),
            isNull(vouchers.deletedAt),
            eq(stockTransferItems.stockItemId, stockItemId),
            or(
              eq(stockTransferItems.sourceLocationId, locationId),
              eq(stockTransferVouchers.destinationLocationId, locationId)
            ),
            ...dateConds(vouchers.voucherDate)
          )
        );

      for (const r of tfRows) {
        const qty = parseFloat(r.qty || "0");
        const rate = parseFloat(r.rate || "0");
        const amount = parseFloat(r.totalAmount || "0");
        if (r.sourceLocId === locationId) {
          results.push({
            date: r.date,
            particulars: r.voucherNumber,
            vchType: "Stock Transfer Out",
            voucherId: r.voucherId,
            poId: null,
            inwardQty: 0,
            inwardRate: 0,
            inwardValue: 0,
            outwardQty: qty,
            outwardRate: rate,
            outwardValue: amount,
            isPOS: false,
            posSellingRate: 0,
            posSellingValue: 0,
          });
        } else {
          results.push({
            date: r.date,
            particulars: r.voucherNumber,
            vchType: "Stock Transfer In",
            voucherId: r.voucherId,
            poId: null,
            inwardQty: qty,
            inwardRate: rate,
            inwardValue: amount,
            outwardQty: 0,
            outwardRate: 0,
            outwardValue: 0,
            isPOS: false,
            posSellingRate: 0,
            posSellingValue: 0,
          });
        }
      }
    }

    // 5. PO Line Items (inward = container imports)
    const poRows = await db
      .select({
        date: vouchers.voucherDate,
        voucherNumber: vouchers.voucherNumber,
        voucherType: vouchers.voucherType,
        voucherId: vouchers.id,
        poId: purchaseOrders.id,
        qty: poLineItems.quantity,
        rate: poLineItems.rate,
        lineTotal: poLineItems.lineTotal,
      })
      .from(poLineItems)
      .innerJoin(purchaseOrders, eq(poLineItems.poId, purchaseOrders.id))
      .innerJoin(vouchers, eq(purchaseOrders.voucherId, vouchers.id))
      .where(
        and(
          eq(purchaseOrders.companyId, companyId),
          isNull(vouchers.deletedAt),
          isNotNull(purchaseOrders.voucherId),
          eq(poLineItems.stockItemId, stockItemId),
          ...(locationId !== null ? [eq(vouchers.locationId, locationId)] : []),
          ...dateConds(vouchers.voucherDate)
        )
      );

    for (const r of poRows) {
      const qty = parseFloat(r.qty || "0");
      const rate = parseFloat(r.rate || "0");
      const lineTotal = parseFloat(r.lineTotal || "0");
      results.push({
        date: r.date,
        particulars: r.voucherNumber,
        vchType: r.voucherType || "Purchase Import",
        voucherId: r.voucherId,
        poId: r.poId,
        inwardQty: qty,
        inwardRate: rate,
        inwardValue: lineTotal,
        outwardQty: 0,
        outwardRate: 0,
        outwardValue: 0,
        isPOS: false,
        posSellingRate: 0,
        posSellingValue: 0,
      });
    }

    return results;
  }

  // GET /api/inventory/movement — monthly summary
  app.get("/api/inventory/movement", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { stockItemId: siStr, locationId: locStr, startDate, endDate } = req.query;
      if (!siStr) return res.status(400).json({ message: "stockItemId required" });

      const stockItemId = parseInt(siStr as string);
      const locationId = locStr ? parseInt(locStr as string) : null;
      const sd = (startDate as string) || null;
      const ed = (endDate as string) || null;

      if (!sd || !ed)
        return res.json({
          months: [],
          grandTotal: { inwardQty: 0, inwardValue: 0, outwardQty: 0, outwardValue: 0, closingQty: 0, closingValue: 0 },
        });

      // Opening balance for the period.
      // NOTE: stockItems.openingQty/openingRate are COMPANY-WIDE master fields, not
      // location-specific — adding them to location-filtered prior movements produces
      // wrong (sometimes negative) results when a locationId is given. When a location
      // is specified, derive the true opening balance for that item+location by
      // reconstructing the historical balance backward from current live inventory
      // (same approach used by Location Inventory "as of" reports), anchored to the
      // day before the period start.
      let baseQty = 0;
      let baseRate = 0;
      if (locationId !== null) {
        const historical = await calculateHistoricalLocationInventory(locationId, companyId, dayBefore(sd));
        const row = historical.find((r) => r.stockItemId === stockItemId);
        baseQty = row ? parseFloat(row.quantity) || 0 : 0;
        baseRate = row ? parseFloat(row.averageRate) || 0 : 0;
      } else {
        const [item] = await db
          .select({ openingQty: stockItems.openingQty, openingRate: stockItems.openingRate })
          .from(stockItems)
          .where(eq(stockItems.id, stockItemId));
        baseQty = parseFloat(item?.openingQty ?? "0");
        baseRate = parseFloat(item?.openingRate ?? "0");
      }

      const priorMovements =
        locationId !== null ? [] : await fetchStockMovements(companyId, stockItemId, locationId, null, sd, true);
      const periodMovements = await fetchStockMovements(companyId, stockItemId, locationId, sd, ed);

      let runQty = baseQty + priorMovements.reduce((s, m) => s + m.inwardQty - m.outwardQty, 0);
      let runValue = baseQty * baseRate + priorMovements.reduce((s, m) => s + m.inwardValue - m.outwardValue, 0);

      periodMovements.sort((a, b) => a.date.localeCompare(b.date));

      // Build list of months in the range
      const startY = parseInt(sd.slice(0, 4)),
        startM = parseInt(sd.slice(5, 7));
      const endY = parseInt(ed.slice(0, 4)),
        endM = parseInt(ed.slice(5, 7));
      const months: { year: number; month: number; monthName: string }[] = [];
      let y = startY,
        m = startM;
      while (y < endY || (y === endY && m <= endM)) {
        months.push({ year: y, month: m, monthName: MONTH_NAMES_INV[m - 1] });
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }

      const monthlySummary = months.map(({ year, month, monthName }) => {
        const mStart = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const mEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        const mTx = periodMovements.filter((t) => t.date >= mStart && t.date <= mEnd);
        const inQty = mTx.reduce((s, t) => s + t.inwardQty, 0);
        const inVal = mTx.reduce((s, t) => s + t.inwardValue, 0);
        const outQty = mTx.reduce((s, t) => s + t.outwardQty, 0);
        const outVal = mTx.reduce((s, t) => s + t.outwardValue, 0);
        const oQty = runQty,
          oVal = runValue;
        const cQty = oQty + inQty - outQty;
        const cVal = oVal + inVal - outVal;
        runQty = cQty;
        runValue = cVal;
        return {
          year,
          month,
          monthName,
          openingQty: oQty,
          openingRate: oQty !== 0 ? oVal / oQty : 0,
          openingValue: oVal,
          inwardQty: inQty,
          inwardRate: inQty > 0 ? inVal / inQty : 0,
          inwardValue: inVal,
          outwardQty: outQty,
          outwardRate: outQty > 0 ? outVal / outQty : 0,
          outwardValue: outVal,
          closingQty: cQty,
          closingRate: cQty !== 0 ? cVal / cQty : 0,
          closingValue: cVal,
        };
      });

      const gt = {
        inwardQty: monthlySummary.reduce((s, m) => s + m.inwardQty, 0),
        inwardValue: monthlySummary.reduce((s, m) => s + m.inwardValue, 0),
        outwardQty: monthlySummary.reduce((s, m) => s + m.outwardQty, 0),
        outwardValue: monthlySummary.reduce((s, m) => s + m.outwardValue, 0),
        closingQty: runQty,
        closingValue: runValue,
      };

      res.json({ months: monthlySummary, grandTotal: gt });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/inventory/movement/drill — transaction-level drill for one month
  app.get("/api/inventory/movement/drill", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { stockItemId: siStr, locationId: locStr, year: yearStr, month: monthStr } = req.query;
      if (!siStr || !yearStr || !monthStr)
        return res.status(400).json({ message: "stockItemId, year, month required" });

      const stockItemId = parseInt(siStr as string);
      const locationId = locStr ? parseInt(locStr as string) : null;
      const year = parseInt(yearStr as string);
      const month = parseInt(monthStr as string);

      const mStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const mEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      // See /api/inventory/movement above for why this can't simply add the
      // company-wide stockItems.openingQty to location-filtered prior movements.
      let baseQty = 0;
      let baseRate = 0;
      if (locationId !== null) {
        const historical = await calculateHistoricalLocationInventory(locationId, companyId, dayBefore(mStart));
        const row = historical.find((r) => r.stockItemId === stockItemId);
        baseQty = row ? parseFloat(row.quantity) || 0 : 0;
        baseRate = row ? parseFloat(row.averageRate) || 0 : 0;
      } else {
        const [item] = await db
          .select({ openingQty: stockItems.openingQty, openingRate: stockItems.openingRate })
          .from(stockItems)
          .where(eq(stockItems.id, stockItemId));
        baseQty = parseFloat(item?.openingQty ?? "0");
        baseRate = parseFloat(item?.openingRate ?? "0");
      }

      const [priorMovements, monthMovements] = await Promise.all([
        locationId !== null
          ? Promise.resolve([])
          : fetchStockMovements(companyId, stockItemId, locationId, null, mStart, true),
        fetchStockMovements(companyId, stockItemId, locationId, mStart, mEnd),
      ]);

      let runQty = baseQty + priorMovements.reduce((s, m) => s + m.inwardQty - m.outwardQty, 0);
      let runValue = baseQty * baseRate + priorMovements.reduce((s, m) => s + m.inwardValue - m.outwardValue, 0);

      monthMovements.sort((a, b) => a.date.localeCompare(b.date) || a.vchType.localeCompare(b.vchType));

      const transactions: any[] = [];
      if (runQty !== 0 || runValue !== 0) {
        transactions.push({
          date: mStart,
          particulars: "Opening Balance",
          vchType: "",
          voucherId: null,
          poId: null,
          inwardQty: 0,
          inwardRate: 0,
          inwardValue: 0,
          outwardQty: 0,
          outwardRate: 0,
          outwardValue: 0,
          closingQty: runQty,
          closingRate: runQty !== 0 ? runValue / runQty : 0,
          closingValue: runValue,
          isOpeningBalance: true,
          isPOS: false,
          posSellingRate: 0,
          posSellingValue: 0,
        });
      }

      let totInQty = 0,
        totInVal = 0,
        totOutQty = 0,
        totOutVal = 0;
      for (const m of monthMovements) {
        runQty += m.inwardQty - m.outwardQty;
        runValue += m.inwardValue - m.outwardValue;
        totInQty += m.inwardQty;
        totInVal += m.inwardValue;
        totOutQty += m.outwardQty;
        totOutVal += m.outwardValue;
        transactions.push({
          ...m,
          closingQty: runQty,
          closingRate: runQty !== 0 ? runValue / runQty : 0,
          closingValue: runValue,
          isOpeningBalance: false,
        });
      }

      const totals = {
        inwardQty: totInQty,
        inwardRate: totInQty > 0 ? totInVal / totInQty : 0,
        inwardValue: totInVal,
        outwardQty: totOutQty,
        outwardRate: totOutQty > 0 ? totOutVal / totOutQty : 0,
        outwardValue: totOutVal,
      };

      res.json({ transactions, totals });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/inventory/reconcile", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId!;
      const issues: any[] = [];

      const allInventory = await db.select().from(inventory).where(eq(inventory.companyId, companyId));

      for (const inv of allInventory) {
        const qty = parseFloat(inv.quantity || "0");
        const rate = parseFloat(inv.averageRate || "0");
        const totalValue = parseFloat(inv.totalValue || "0");
        const expectedValue = qty * rate;

        if (qty < 0) {
          issues.push({
            type: "negative_inventory",
            severity: "info",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            message: `Negative inventory: ${qty} units`,
          });
        }

        if (qty > 0 && Math.abs(totalValue - expectedValue) > 0.02) {
          issues.push({
            type: "value_mismatch",
            severity: "error",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            averageRate: rate,
            totalValue,
            expectedValue: parseFloat(expectedValue.toFixed(2)),
            difference: parseFloat((totalValue - expectedValue).toFixed(2)),
            message: `Value mismatch: stored=${totalValue}, expected=${expectedValue.toFixed(2)}`,
          });
        }

        if (rate < 0) {
          issues.push({
            type: "negative_rate",
            severity: "error",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            averageRate: rate,
            message: `Negative average rate: ${rate}`,
          });
        }

        if (qty === 0 && totalValue !== 0) {
          issues.push({
            type: "zero_qty_nonzero_value",
            severity: "warning",
            stockItemId: inv.stockItemId,
            locationId: inv.locationId,
            quantity: qty,
            totalValue,
            message: `Zero quantity but non-zero total value: ${totalValue}`,
          });
        }
      }

      const locationIds = Array.from(new Set(allInventory.map((i) => i.locationId)));
      const stockItemIds = Array.from(new Set(allInventory.map((i) => i.stockItemId)));

      const duplicateCheck = new Map<string, number>();
      for (const inv of allInventory) {
        const key = `${inv.locationId}-${inv.stockItemId}`;
        duplicateCheck.set(key, (duplicateCheck.get(key) || 0) + 1);
      }
      for (const [key, count] of Array.from(duplicateCheck.entries())) {
        if (count > 1) {
          const [locId, itemId] = key.split("-").map(Number);
          issues.push({
            type: "duplicate_inventory",
            severity: "critical",
            stockItemId: itemId,
            locationId: locId,
            duplicateCount: count,
            message: `${count} duplicate inventory records found`,
          });
        }
      }

      const summary = {
        totalRecords: allInventory.length,
        totalLocations: locationIds.length,
        totalStockItems: stockItemIds.length,
        issueCount: issues.length,
        criticalIssues: issues.filter((i) => i.severity === "critical").length,
        errorIssues: issues.filter((i) => i.severity === "error").length,
        warningIssues: issues.filter((i) => i.severity === "warning").length,
        infoIssues: issues.filter((i) => i.severity === "info").length,
        totalInventoryValue: allInventory.reduce((sum, inv) => sum + parseFloat(inv.totalValue || "0"), 0).toFixed(2),
      };

      res.json({ summary, issues });
    } catch (error: any) {
      console.error("Inventory reconciliation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get today vouchers for a location (for POS dashboard)
  app.get("/api/locations/:locationId/vouchers/today", requireAuth, checkPOSLocation, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Verify location belongs to current company
      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get today date range
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

      // Get vouchers created today at this location
      const todayVouchers = await db
        .select()
        .from(vouchers)
        .where(
          and(
            eq(vouchers.locationId, locationId),
            gte(vouchers.createdAt, startOfDay),
            lt(vouchers.createdAt, endOfDay),
            isNull(vouchers.deletedAt)
          )
        )
        .orderBy(desc(vouchers.createdAt));

      res.json(todayVouchers);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update cost prices by barcode for a location
  app.post("/api/locations/:locationId/import-cost-prices", requireAuth, checkPOSLocation, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Location belongs to a different company",
        });
      }

      const { updates } = req.body;
      if (!Array.isArray(updates)) {
        return res.status(400).json({ message: "Updates must be an array" });
      }

      const result = await storage.updateCostPricesByBarcode(locationId, req.session.currentCompanyId, updates);
      res.json(result);
    } catch (error: any) {
      console.error("Error updating cost prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk import inventory for a location
  app.post("/api/locations/:locationId/import-inventory", requireAuth, checkPOSLocation, async (req, res) => {
    try {
      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) {
        return res.status(400).json({ message: "Invalid location ID" });
      }

      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      // Validate location exists and belongs to current company
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      if (location.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Location belongs to a different company",
        });
      }

      const { items } = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "Items must be an array" });
      }

      // Get all stock items and stock groups for code matching
      const allStockItems = await storage.getAllStockItems(req.session.currentCompanyId);
      const allStockGroups = await storage.getAllStockGroups(req.session.currentCompanyId);

      const results = {
        created: [] as any[],
        updated: [] as any[],
        skipped: [] as any[],
        errors: [] as any[],
      };

      // Per-session barcode registry: once a barcode resolves to an item it
      // ALWAYS resolves to that same item for the rest of this import run.
      // This prevents the same barcode from ever mapping to more than one product.
      const barcodeItemMap = new Map<string, any>();

      for (const item of items) {
        try {
          const barcodeKey = item.Item_barcode.trim().toLowerCase();

          // 1. Check session-local registry first (fastest, no DB hit)
          let stockItem: any = barcodeItemMap.get(barcodeKey) ?? null;

          // 2. If not seen this session, look up in DB (code field OR alias)
          if (!stockItem) {
            stockItem =
              (await storage.getStockItemByCodeOrAlias(item.Item_barcode, req.session.currentCompanyId)) ?? null;
            if (stockItem) barcodeItemMap.set(barcodeKey, stockItem);
          }

          // If stock item doesn't exist, create it
          if (!stockItem) {
            // ── Name-match check: if an existing item's NAME equals the
            //    uploaded barcode string, register the barcode as an alias
            //    and reuse that item instead of creating a duplicate. ─────
            const nameMatch = allStockItems.find((si) => si.name.trim().toLowerCase() === barcodeKey);

            if (nameMatch) {
              // Guard: only register alias if the barcode isn't already the
              // primary code of a *different* item (belt-and-suspenders check)
              const alreadyACode = allStockItems.find(
                (si) => si.id !== nameMatch.id && si.code.trim().toLowerCase() === barcodeKey
              );
              if (!alreadyACode) {
                await db
                  .insert(stockItemCodeAliases)
                  .values({
                    stockItemId: nameMatch.id,
                    aliasCode: item.Item_barcode.trim(),
                    companyId: req.session.currentCompanyId!,
                  })
                  .onConflictDoNothing();
              }
              stockItem = alreadyACode ?? nameMatch;
              barcodeItemMap.set(barcodeKey, stockItem);
            } else {
              // Auto-detect stock group from item code prefix (first 2-3 uppercase letters)
              let stockGroupId: number | null = null;

              // Normalize and try to extract prefix from Item_barcode
              const normalizedCode = item.Item_barcode.trim().toUpperCase();

              // Try 3-letter prefix first, then 2-letter (e.g., "UN259" -> "UN", "GCC123" -> "GCC")
              const prefixes = [];
              if (normalizedCode.length >= 3) prefixes.push(normalizedCode.substring(0, 3));
              if (normalizedCode.length >= 2) prefixes.push(normalizedCode.substring(0, 2));

              for (const prefix of prefixes) {
                const stockGroup = allStockGroups.find((sg) => sg.code.toUpperCase() === prefix);
                if (stockGroup) {
                  stockGroupId = stockGroup.id;
                  break; // Found a match, stop searching
                }
              }

              // Fall back to stockGroupCode column if provided and prefix didn't match
              if (!stockGroupId && item.stockGroupCode) {
                const stockGroup = allStockGroups.find(
                  (sg) => (sg.code || "").toLowerCase() === (item.stockGroupCode || "").toLowerCase()
                );
                if (stockGroup) {
                  stockGroupId = stockGroup.id;
                }
              }

              // Require valid stock group - reject if none found
              if (!stockGroupId) {
                results.errors.push({
                  code: item.Item_barcode,
                  reason: `No matching stock group found for code prefix. Please create stock item "${item.Item_barcode}" manually with a valid stock group first.`,
                });
                continue;
              }

              // Create the stock item
              const newStockItem = await storage.createStockItem({
                companyId: req.session.currentCompanyId,
                code: item.Item_barcode,
                name: item.Item_barcode, // Use Item_barcode as name if not provided
                uom: "PCS", // Default unit
                stockGroupId: stockGroupId,
                active: true,
              });

              stockItem = newStockItem;
              allStockItems.push(newStockItem); // Add to cache for subsequent rows
              barcodeItemMap.set(barcodeKey, newStockItem); // lock barcode in session registry
            } // end else (no name match → create new)
          }

          const quantity = parseFloat(item.quantity || "0");
          const rate = parseFloat(item.rate || "0");
          const value = parseFloat(item.value || (quantity * rate).toString());

          // Check if inventory already exists for this item at this location
          const existingInventory = await storage.getLocationInventory(req.session.currentCompanyId!, locationId);
          const existing = existingInventory.find((inv) => inv.stockItemId === stockItem.id);

          if (existing) {
            // Update existing inventory - add to existing quantities
            const newQuantity = parseFloat(existing.quantity) + quantity;
            const newTotalValue = parseFloat(existing.totalValue) + value;
            const newAverageRate = newQuantity > 0 ? newTotalValue / newQuantity : 0;

            await storage.updateInventory(
              locationId,
              stockItem.id,
              newQuantity.toString(),
              newAverageRate.toString(),
              newTotalValue.toString()
            );

            results.updated.push({
              code: item.Item_barcode,
              itemName: stockItem.name,
              addedQuantity: quantity,
              newQuantity: newQuantity,
            });
          } else {
            // Create new inventory record
            await storage.updateInventory(
              locationId,
              stockItem.id,
              quantity.toString(),
              rate.toString(),
              value.toString()
            );

            results.created.push({
              code: item.Item_barcode,
              itemName: stockItem.name,
              quantity: quantity,
            });
          }
        } catch (error: any) {
          results.errors.push({
            code: item.code,
            error: error.message,
          });
        }
      }

      res.json({
        message: `Import completed: ${results.created.length} created, ${results.updated.length} updated, ${results.skipped.length} skipped, ${results.errors.length} errors`,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

}
