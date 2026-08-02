/**
 * supplierBrokerRoutes: SupplierDirectContainer endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId } from "../../../../lib/parseId";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { factoryContainers } from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export function registerSupplierDirectContainerRoutes(app: Express) {
  // ── Direct containers for a broker ────────────────────────────────────────
  // Returns containers whose supplier_id = brokerId (excludes children's containers).
  // Used by the Broker Overview Panel to show unassigned / direct containers.
  app.get("/api/factory/suppliers/:id/direct-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseId(req.params.id);
      if (brokerId === null) return res.status(400).json({ message: "Invalid id" });

      const containers = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          status: factoryContainers.status,
          currencyCode: factoryContainers.currencyCode,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          finalPayableAmount: factoryContainers.finalPayableAmount,
          arrivalDate: factoryContainers.arrivalDate,
          origin: factoryContainers.origin,
        })
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            eq(factoryContainers.supplierId, brokerId),
            isNull(factoryContainers.deletedAt)
          )
        )
        .orderBy(desc(factoryContainers.arrivalDate), desc(factoryContainers.createdAt));

      return res.json(containers);
    } catch (err: unknown) {
      logger.error("Direct containers error:", { error: err });
      return res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ───────────────────────────────────────────────
  // 2. Factory Categories CRUD
  // ───────────────────────────────────────────────
}
