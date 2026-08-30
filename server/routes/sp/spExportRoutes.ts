import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { companies, ledgerAccounts, locations } from "@shared/schema";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { generateSpSalesFormExcel } from "../../services/sp-sales-form";
import { generateSpSalesFormExcelV2 } from "../../services/spSalesFormExportV2";
import { requireSpCompany } from "./spHelpers";
import { validateStatementDateRange } from "../../lib/accountStatementExportSafety";

// ── Sales Form Excel Export (V1 legacy + V2) ─────────────────────────────────

export function registerSpExportRoutes(app: Express) {
  app.get("/api/sp/sales-form/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { fromDate: fromDateRaw, toDate: toDateRaw, locationId: locationIdRaw } = req.query;

      if (
        typeof fromDateRaw !== "string" ||
        typeof toDateRaw !== "string" ||
        fromDateRaw.length === 0 ||
        toDateRaw.length === 0
      ) {
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

      // Fetch tenant-scoped location and company names for the filename.
      let locationName = "";
      let companyName = "";
      try {
        if (locId) {
          const [locationRow] = await db
            .select({ name: locations.name })
            .from(locations)
            .where(and(eq(locations.id, locId), eq(locations.companyId, companyId)));
          locationName = locationRow?.name ?? "";
        }
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }
      try {
        const [companyRow] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId));
        companyName = companyRow?.name ?? "";
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

      const from = fromDate.substring(5, 7) + fromDate.substring(8, 10);
      const to = toDate.substring(5, 7) + toDate.substring(8, 10);
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

      if (
        typeof fromDateRaw !== "string" ||
        typeof toDateRaw !== "string" ||
        fromDateRaw.length === 0 ||
        toDateRaw.length === 0
      ) {
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
          const [accountRow] = await db
            .select({ id: ledgerAccounts.id })
            .from(ledgerAccounts)
            .where(and(eq(ledgerAccounts.id, cashId), eq(ledgerAccounts.companyId, companyId)));
          if (!accountRow) {
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
          const [locationRow] = await db
            .select({ name: locations.name })
            .from(locations)
            .where(and(eq(locations.id, locId), eq(locations.companyId, companyId)));
          locationName = locationRow?.name ?? "";
        }
      } catch {
        // Failure here is non-fatal and the surrounding flow continues deliberately.
      }
      try {
        const [companyRow] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId));
        companyName = companyRow?.name ?? "";
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

      const from = fromDate.substring(5, 7) + fromDate.substring(8, 10);
      const to = toDate.substring(5, 7) + toDate.substring(8, 10);
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
