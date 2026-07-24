import type { Express } from "express";
import { z } from "zod";

import { requireAuth, requireNonPOS } from "../../auth";
import { logger } from "../../lib/logger";
import {
  getStockInSalesReport,
  type StockInSalesGrouping,
  type StockInSalesProfitFilter,
} from "../../services/reports/stockInSalesReportService";

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "Date is invalid");

const idListSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null || value === "") return [];
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(Number);
  }, z.array(z.number().int().positive()).max(100, "Too many filter values"))
  .transform((ids) => Array.from(new Set(ids)));

const reportQuerySchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  grouping: z.enum(["daily", "monthly", "yearly"]).default("daily"),
  profitFilter: z.enum(["all", "positive", "negative"]).default("all"),
  locationIds: idListSchema,
  stockGroupIds: idListSchema,
  search: z.string().trim().max(100, "Search is too long").optional(),
});

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
  if (typeof value === "string") return value;
  return undefined;
}

export function registerStockInSalesReportRoutes(app: Express) {
  app.get("/api/reports/stock-in-sales", requireAuth, requireNonPOS, async (req, res) => {
    const companyId = req.session.currentCompanyId;
    if (!companyId) {
      return res.status(400).json({ message: "No company selected" });
    }

    const parsed = reportQuerySchema.safeParse({
      startDate: firstQueryValue(req.query.startDate),
      endDate: firstQueryValue(req.query.endDate),
      grouping: firstQueryValue(req.query.grouping),
      profitFilter: firstQueryValue(req.query.profitFilter),
      locationIds: req.query.locationIds ?? req.query.locationId,
      stockGroupIds: req.query.stockGroupIds ?? req.query.stockGroupId,
      search: firstQueryValue(req.query.search),
    });

    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid stock in and sales report filters",
        errors: parsed.error.flatten(),
      });
    }

    if (parsed.data.startDate && parsed.data.endDate && parsed.data.startDate > parsed.data.endDate) {
      return res.status(400).json({ message: "Start date cannot be after end date" });
    }

    try {
      const result = await getStockInSalesReport({
        companyId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        grouping: parsed.data.grouping as StockInSalesGrouping,
        profitFilter: parsed.data.profitFilter as StockInSalesProfitFilter,
        locationIds: parsed.data.locationIds,
        stockGroupIds: parsed.data.stockGroupIds,
        search: parsed.data.search || undefined,
      });

      res.setHeader("Cache-Control", "private, no-store");
      return res.json(result);
    } catch (error: any) {
      logger.error("Stock in and sales report error", {
        module: "reports",
        action: "stock-in-sales",
        companyId,
        error,
      });
      return res.status(500).json({
        message: "Failed to generate stock in and sales report",
        details: error?.message || String(error),
      });
    }
  });
}
