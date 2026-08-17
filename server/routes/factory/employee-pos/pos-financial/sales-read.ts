/**
 * employeePosFinancialRoutes: PosSalesRead endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { factoryPosSales, factoryPosSaleItems } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export function registerPosSalesReadRoutes(app: Express) {
  app.get("/api/factory/pos/sales", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const sales = await db
        .select()
        .from(factoryPosSales)
        .where(eq(factoryPosSales.companyId, companyId))
        .orderBy(desc(factoryPosSales.createdAt));
      res.json(sales);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // GET /api/factory/pos/sales/:id — single sale with items
  app.get("/api/factory/pos/sales/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const saleId = parseInt(req.params.id);
      const [sale] = await db
        .select()
        .from(factoryPosSales)
        .where(and(eq(factoryPosSales.id, saleId), eq(factoryPosSales.companyId, companyId)));
      if (!sale) return res.status(404).json({ message: "Sale not found" });
      const items = await db.select().from(factoryPosSaleItems).where(eq(factoryPosSaleItems.saleId, saleId));
      res.json({ ...sale, items });
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
