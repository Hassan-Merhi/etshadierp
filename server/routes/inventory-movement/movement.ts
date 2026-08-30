/**
 * inventoryMovementRoutes: InventoryMovementReport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { calculateHistoricalLocationInventory } from "../helpers/inventoryHistoryHelpers";
import { stockItems } from "@shared/schema";

import { MONTH_NAMES_INV, dayBefore, fetchStockMovements } from "./_helpers";

export function registerInventoryMovementReportRoutes(app: Express) {
  // GET /api/inventory/movement — monthly summary
  app.get("/api/inventory/movement", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        stockItemId: stockItemIdRaw,
        locationId: locationIdRaw,
        startDate: startDateRaw,
        endDate: endDateRaw,
      } = req.query;
      if (typeof stockItemIdRaw !== "string") {
        return res.status(400).json({ message: "stockItemId must be a single positive integer" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }
      if (startDateRaw !== undefined && typeof startDateRaw !== "string") {
        return res.status(400).json({ message: "startDate must be a single YYYY-MM-DD value" });
      }
      if (endDateRaw !== undefined && typeof endDateRaw !== "string") {
        return res.status(400).json({ message: "endDate must be a single YYYY-MM-DD value" });
      }

      const stockItemId = Number.parseInt(stockItemIdRaw, 10);
      if (!Number.isSafeInteger(stockItemId) || stockItemId <= 0) {
        return res.status(400).json({ message: "stockItemId must be a single positive integer" });
      }

      let locationId: number | null = null;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locationId = parsedLocationId;
      }

      // When no dates supplied (All Time preset), span from a safe epoch to today.
      const today = new Date().toISOString().slice(0, 10);
      const sd = startDateRaw || "2000-01-01";
      const ed = endDateRaw || today;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      if (!datePattern.test(sd) || !datePattern.test(ed) || sd > ed) {
        return res.status(400).json({ message: "Invalid inventory movement date range" });
      }

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

      // Build list of months in the range. The date format is already validated above,
      // so split the scalar strings instead of using String/Array-ambiguous slice calls.
      const [startYearPart, startMonthPart] = sd.split("-");
      const [endYearPart, endMonthPart] = ed.split("-");
      const startY = Number.parseInt(startYearPart, 10),
        startM = Number.parseInt(startMonthPart, 10);
      const endY = Number.parseInt(endYearPart, 10),
        endM = Number.parseInt(endMonthPart, 10);
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // GET /api/inventory/movement/drill — transaction-level drill for one month
  app.get("/api/inventory/movement/drill", requireAuth, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { stockItemId: stockItemIdRaw, locationId: locationIdRaw, year: yearRaw, month: monthRaw } = req.query;
      if (typeof stockItemIdRaw !== "string" || typeof yearRaw !== "string" || typeof monthRaw !== "string") {
        return res.status(400).json({ message: "stockItemId, year, month must be single integer values" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }

      const stockItemId = Number.parseInt(stockItemIdRaw, 10);
      const year = Number.parseInt(yearRaw, 10);
      const month = Number.parseInt(monthRaw, 10);
      if (!Number.isSafeInteger(stockItemId) || stockItemId <= 0) {
        return res.status(400).json({ message: "stockItemId must be a single positive integer" });
      }
      if (!Number.isSafeInteger(year) || year < 2000 || year > 9999) {
        return res.status(400).json({ message: "year must be a valid four-digit year" });
      }
      if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
        return res.status(400).json({ message: "month must be between 1 and 12" });
      }

      let locationId: number | null = null;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locationId = parsedLocationId;
      }

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

      const transactions = [];
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
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
