import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { and, asc, eq, isNull } from "drizzle-orm";
import { stockItems } from "@shared/schema";
import { requireAuth } from "../../auth";
import { db } from "../../db";

/**
 * Lightweight stock-item selector endpoint.
 *
 * The default contract stays backwards compatible for selectors that need
 * group/category/grade/activity metadata. Phase 4 adds profile=identity for the
 * high-frequency voucher and lookup callers that only need id/code/name/uom.
 */
export function registerStockLightRoutes(app: Express) {
  app.get("/api/stock-items/light", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.session.currentCompanyId || req.session.factoryCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const profile = String(req.query.profile || "light").toLowerCase();
      if (profile === "identity") {
        const rows = await db
          .select({
            id: stockItems.id,
            code: stockItems.code,
            name: stockItems.name,
            uom: stockItems.uom,
          })
          .from(stockItems)
          .where(and(eq(stockItems.companyId, companyId), isNull(stockItems.deletedAt)))
          .orderBy(asc(stockItems.name), asc(stockItems.id));

        res.set("X-ERP-Payload-Profile", "stock-items-identity-v1");
        return res.json(rows);
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

      res.set("X-ERP-Payload-Profile", "stock-items-light-v1");
      return res.json(rows);
    } catch (error: unknown) {
      logger.error("[stock-items/light] Failed to load lightweight stock items", {
        companyId: req.session?.currentCompanyId || req.session?.factoryCompanyId || null,
        error: getErrorMessage(error) || String(error),
      });
      return res.status(500).json({ message: "Failed to load stock items" });
    }
  });
}
