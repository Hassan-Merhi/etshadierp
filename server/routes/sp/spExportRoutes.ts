import type { Express } from "express";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { sql } from "drizzle-orm";
import { generateSpSalesFormExcel } from "../../services/spSalesFormExport";
import { generateSpSalesFormExcelV2 } from "../../services/spSalesFormExportV2";
import { requireSpCompany } from "./spHelpers";

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
  app.get("/api/sp/sales-form/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { fromDate, toDate, locationId } = req.query;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: "fromDate and toDate are required (YYYY-MM-DD)" });
      }

      const locId = locationId ? parseInt(locationId as string) : undefined;

      // Fetch location and company name for the filename
      let locationName = "";
      let companyName = "";
      try {
        const locRows = await db.execute(sql`SELECT name FROM locations WHERE id = ${locId} LIMIT 1`);
        locationName = readString(firstQueryRow(locRows), "name");
      } catch {}
      try {
        const coRows = await db.execute(sql`SELECT name FROM companies WHERE id = ${companyId} LIMIT 1`);
        companyName = readString(firstQueryRow(coRows), "name");
      } catch {}

      const buffer = await generateSpSalesFormExcel({
        companyId,
        locationId: locId,
        fromDate: fromDate as string,
        toDate: toDate as string,
        locationName,
        supplierName: companyName,
      });

      const from = (fromDate as string).slice(5).replace("-", "");
      const to = (toDate as string).slice(5).replace("-", "");
      const safeLoc = locationName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const safeCo = companyName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const filename = `${safeLoc} ${safeCo} sales form ${from}-${to}.xlsx`.replace(/\s+/g, " ").trim();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── V2: from-scratch ExcelJS export (matches system inventory) ────────────
  app.get("/api/sp/sales-form/export-v2", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = await requireSpCompany(req, res);
      if (!companyId) return;

      const { fromDate, toDate, locationId, cashAccountId } = req.query;

      if (!fromDate || !toDate) {
        return res.status(400).json({ message: "fromDate and toDate are required (YYYY-MM-DD)" });
      }

      const locId = locationId ? parseInt(locationId as string) : undefined;
      let cashId = cashAccountId ? parseInt(cashAccountId as string) : undefined;

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
      } catch {}
      try {
        const r = await db.execute(sql`SELECT name FROM companies WHERE id = ${companyId} LIMIT 1`);
        companyName = readString(firstQueryRow(r), "name");
      } catch {}

      const buffer = await generateSpSalesFormExcelV2({
        companyId,
        locationId: locId,
        fromDate: fromDate as string,
        toDate: toDate as string,
        locationName,
        supplierName: companyName,
        cashAccountId: cashId,
      });

      const from = (fromDate as string).slice(5).replace("-", "");
      const to = (toDate as string).slice(5).replace("-", "");
      const safeLoc = locationName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const safeCo = companyName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
      const filename = `${safeLoc} ${safeCo} system sales form ${from}-${to}.xlsx`
        .replace(/\s+/g, " ")
        .trim();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      logger.error("[/api/sp/sales-form/export-v2]", { error: error });
      res.status(500).json({ message: error.message });
    }
  });
}
