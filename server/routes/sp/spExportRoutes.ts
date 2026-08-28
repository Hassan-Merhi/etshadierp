import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql } from "drizzle-orm";
import { generateSpSalesFormExcel } from "../../services/sp-sales-form";
import { generateSpSalesFormExcelV2 } from "../../services/spSalesFormExportV2";
import { requireSpCompany } from "./spHelpers";
import { validateStatementDateRange } from "../../lib/accountStatementExportSafety";

type QueryRecord = Record<string, unknown>;
type QueryResultLike = { rows: QueryRecord[] };

function firstQueryRow(result: QueryResultLike | QueryRecord[]): QueryRecord | undefined {
  return Array.isArray(result) ? result[0] : result.rows[0];
}

function readString(row: QueryRecord | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : "";
}

// ── Sales Form Excel Export (V1 legacy + V2) ─────────────────────────────────

export function registerSpExportRoutes(app: Express) {
  app.get("/api/sp/sales-form/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { fromDate: fromDateRaw, toDate: toDateRaw, locationId: locationIdRaw } = req.query;

      if (typeof fromDateRaw !== "string" || typeof toDateRaw !== "string") {
        return res.status(400).json({ message: "fromDate and toDate must each be a single YYYY-MM-DD value" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }
      const dateRange = validateStatementDateRange(fromDateRaw, toDateRaw);
      if (!dateRange.ok) return res.status(400).json({ message: dateRange.message });

      let locId: number | undefined;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locId = parsedLocationId;
      }
      const fromDate = fromDateRaw;
      const toDate = toDateRaw;

      // Fetch location and company name for the filename
      let locationName = "";
      let companyName = "";
      try {
        const locRows = await db.execute(sql`SELECT name FROM locations WHERE id = ${locId} LIMIT 1`);
        locationName = readString(firstQueryRow(locRows), "name");
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }
      try {
        const coRows = await db.execute(sql`SELECT name FROM companies WHERE id = ${companyId} LIMIT 1`);
        companyName = readString(firstQueryRow(coRows), "name");
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }

      const buffer = await generateSpSalesFormExcel({
        companyId,
        locationId: locId,
        fromDate,
        toDate,
        locationName,
        supplierName: companyName,
      });

      const from = fromDate.slice(5).replace("-", "");
      const to = toDate.slice(5).replace("-", "");
      const safeLoc = locationName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const safeCo = companyName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const filename = `${safeLoc} ${safeCo} sales form ${from}-${to}.xlsx`.replace(/\s+/g, " ").trim();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ── V2: from-scratch ExcelJS export (matches system inventory) ────────────
  app.get("/api/sp/sales-form/export-v2", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const {
        fromDate: fromDateRaw,
        toDate: toDateRaw,
        locationId: locationIdRaw,
        cashAccountId: cashAccountIdRaw,
      } = req.query;

      if (typeof fromDateRaw !== "string" || typeof toDateRaw !== "string") {
        return res.status(400).json({ message: "fromDate and toDate must each be a single YYYY-MM-DD value" });
      }
      if (locationIdRaw !== undefined && typeof locationIdRaw !== "string") {
        return res.status(400).json({ message: "locationId must be a single positive integer" });
      }
      if (cashAccountIdRaw !== undefined && typeof cashAccountIdRaw !== "string") {
        return res.status(400).json({ message: "cashAccountId must be a single positive integer" });
      }
      const dateRange = validateStatementDateRange(fromDateRaw, toDateRaw);
      if (!dateRange.ok) return res.status(400).json({ message: dateRange.message });

      let locId: number | undefined;
      if (locationIdRaw) {
        const parsedLocationId = Number.parseInt(locationIdRaw, 10);
        if (!Number.isSafeInteger(parsedLocationId) || parsedLocationId <= 0) {
          return res.status(400).json({ message: "locationId must be a single positive integer" });
        }
        locId = parsedLocationId;
      }

      let cashId: number | undefined;
      if (cashAccountIdRaw) {
        const parsedCashId = Number.parseInt(cashAccountIdRaw, 10);
        if (!Number.isSafeInteger(parsedCashId) || parsedCashId <= 0) {
          return res.status(400).json({ message: "cashAccountId must be a single positive integer" });
        }
        cashId = parsedCashId;
      }
      const fromDate = fromDateRaw;
      const toDate = toDateRaw;

      // Validate the cash account belongs to this company; ignore silently if not.
      if (cashId) {
        try {
          const r = await db.execute(
            sql`SELECT id FROM accounts WHERE id = ${cashId} AND company_id = ${companyId} LIMIT 1`
          );
          const found = firstQueryRow(r);
          if (!found) {
            logger.warn(
              `[/api/sp/sales-form/export-v2] cashAccountId=${cashId} not found for companyId=${companyId}; ignoring`
            );
            cashId = undefined;
          }
        } catch (e) {
          logger.warn(`[/api/sp/sales-form/export-v2] cashAccountId validation failed:`, { error: e });
          cashId = undefined;
        }
      }

      let locationName = "";
      let companyName = "";
      try {
        if (locId) {
          const r = await db.execute(sql`SELECT name FROM locations WHERE id = ${locId} LIMIT 1`);
          locationName = readString(firstQueryRow(r), "name");
        }
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }
      try {
        const r = await db.execute(sql`SELECT name FROM companies WHERE id = ${companyId} LIMIT 1`);
        companyName = readString(firstQueryRow(r), "name");
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }

      const buffer = await generateSpSalesFormExcelV2({
        companyId,
        locationId: locId,
        fromDate,
        toDate,
        locationName,
        supplierName: companyName,
        cashAccountId: cashId,
      });

      const from = fromDate.slice(5).replace("-", "");
      const to = toDate.slice(5).replace("-", "");
      const safeLoc = locationName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const safeCo = companyName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const filename = `${safeLoc} ${safeCo} system sales form ${from}-${to}.xlsx`.replace(/\s+/g, " ").trim();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: unknown) {
      logger.error("[/api/sp/sales-form/export-v2]", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
