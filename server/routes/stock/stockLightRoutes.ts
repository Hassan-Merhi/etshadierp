import type { Express } from "express";
import { and, asc, eq, isNull } from "drizzle-orm";
import { stockItems } from "@shared/schema";
import { requireAuth } from "../../auth";
import { db } from "../../db";

/**
 * Lightweight stock-item selector endpoint.
 *
 * This route intentionally excludes opening balances, rates, values, prices,
 * timestamps, and other management-only fields. It is safe for dropdowns and
 * identity lookups that only need stable stock-item metadata.
 */
export function registerStockLightRoutes(app: Express) {
  app.get("/api/stock-items/light", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const rows = await db
        .select({
          id: stockItems.id,
          code: stockItems.code,
          name: stockItems.name,
          uom: stockItems.uom,
          active: stockItems.active,
          stockGroupId: stockItems.stockGroupId,
          categoryId: stockItems.categoryId,
          gradeId: stockItems.gradeId,
        })
        .from(stockItems)
        .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
        .orderBy(asc(stockItems.name), asc(stockItems.id));

      return res.json(rows);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });
}
