/**
 * rawStockBalanceRoutesLegacy: RawStockUnlinkedBale endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { factoryBales } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export function registerRawStockUnlinkedBaleRoutes(app: Express) {
  // Get all bales with no mix batch link (unlinked / not yet sourced from raw stock)
  app.get("/api/factory/bales/unlinked", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const bales = await db
        .select({
          id: factoryBales.id,
          baleCode: factoryBales.baleCode,
          referenceNumber: factoryBales.referenceNumber,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
          pressedAt: factoryBales.pressedAt,
        })
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            sql`${factoryBales.mixBatchId} IS NULL`,
            eq(factoryBales.status, "IN_STOCK")
          )
        )
        .orderBy(desc(factoryBales.pressedAt));

      res.json(bales);
    } catch (error: unknown) {
      logger.error("Error fetching unlinked bales:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
