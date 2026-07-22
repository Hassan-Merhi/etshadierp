/**
 * Factory FX-rate CRUD routes.
 *
 * Manual foreign-exchange rate management for factory companies (list,
 * latest, by-date lookup, create, delete). Extracted verbatim from
 * factoryBalesRoutes.ts as a sub-registrar, matching the pattern already
 * used for mix-batch and bale-export routes; behaviour is unchanged.
 */
import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { getClientDate } from "../../lib/dateUtils";
import { getOrFetchFxRateToUsd } from "./_helpers";
import { factoryFxRates, insertFactoryFxRateSchema } from "@shared/schema";

export function registerFactoryFxRatesRoutes(app: Express) {
  app.get("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { currencyCode } = req.query;
      // Only return manually-set rates in the UI list (auto rows are internal cache only)
      const conditions: any[] = [eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.source, "manual")];
      if (currencyCode) conditions.push(eq(factoryFxRates.currencyCode, currencyCode as string));
      const results = await db
        .select()
        .from(factoryFxRates)
        .where(and(...conditions))
        .orderBy(desc(factoryFxRates.effectiveDate));
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/latest/:currencyCode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const today = getClientDate(req);
      try {
        const rate = await getOrFetchFxRateToUsd(companyId, currency, today);
        res.json({ rate, effectiveDate: today });
      } catch (err: any) {
        const [fallback] = await db
          .select()
          .from(factoryFxRates)
          .where(and(eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.currencyCode, currency)))
          .orderBy(desc(factoryFxRates.effectiveDate))
          .limit(1);
        if (fallback) {
          res.json({ rate: fallback.rateToUsd, effectiveDate: fallback.effectiveDate });
        } else {
          res.status(404).json({ message: err.message });
        }
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/:currencyCode/:date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const dateISO = req.params.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        return res.status(400).json({ message: "Date must be YYYY-MM-DD format" });
      }
      const rate = await getOrFetchFxRateToUsd(companyId, currency, dateISO);
      res.json({ rate, effectiveDate: dateISO });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const today = getClientDate(req);
      const parsed = insertFactoryFxRateSchema.parse({
        effectiveDate: today,
        ...req.body,
        companyId,
        source: "manual",
      });
      const [rate] = await db.insert(factoryFxRates).values(parsed).returning();
      res.json(rate);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // DELETE by currency code — removes all rows (manual + auto) for that currency
  app.delete("/api/factory/fx-rates/:currency", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currency.toUpperCase();
      await db
        .delete(factoryFxRates)
        .where(and(eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.currencyCode, currency)));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
