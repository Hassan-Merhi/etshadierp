/**
 * containerOffloadRoutes: ContainerOffloadCreate endpoints.
 *
 * All create/replace offloads now use the canonical atomic lifecycle so the
 * inventory mutation, stock movement evidence, charge vouchers, SP journals,
 * and replacement reversal cannot drift apart.
 */
import type { Express } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { getClientDate } from "../../../lib/dateUtils";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth, requireNonPOS } from "../../../auth";
import { containerOffloadItems, offloadRequestSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { syncSalesItemCostsForStockItems } from "../../../services/syncSalesItemCosts";
import {
  executeContainerOffloadLifecycle,
} from "../../../services/containers/offload-lifecycle/execute";
import { ContainerOffloadLifecycleError } from "../../../services/containers/offload-lifecycle/types";

export function registerContainerOffloadCreateRoutes(app: Express) {
  app.post("/api/containers/:id/offload", requireAuth, requireNonPOS, async (req, res) => {
    const startedAt = Date.now();
    const userId = req.user?.id;
    const companyId = req.session.currentCompanyId;

    logger.info("Container offload started", {
      module: "containers",
      action: "offload",
      userId,
      companyId,
      containerId: req.params.id,
    });

    try {
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });

      const validation = offloadRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Validation failed", errors: validation.error.issues });
      }

      const input = validation.data;
      const result = await executeContainerOffloadLifecycle({
        companyId,
        containerId,
        mode: "create-or-replace",
        locationId: input.locationId,
        offloadDate: input.offloadDate || getClientDate(req),
        duties: input.duties,
        dutiesAccountId: input.dutiesAccountId,
        officeCharges: input.officeCharges,
        officeChargesAccountId: input.officeChargesAccountId,
        officeChargesCashAccountId: input.officeChargesCashAccountId,
        transferCharges: input.transferCharges,
        transportFees: input.transportFees,
        transportAccountId: input.transportAccountId,
        additionalCharges: input.additionalCharges,
        inventoryCostCorrections: input.inventoryCostCorrections,
        agentChargeLines: input.agentChargeLines,
      });

      logger.info("Container offload succeeded", {
        module: "containers",
        action: "offload",
        userId,
        companyId,
        containerId,
        replacedExistingOffload: result.replacedExistingOffload,
        durationMs: Date.now() - startedAt,
      });

      res.json(result.offload);

      Promise.resolve().then(async () => {
        try {
          let stockItemIds = result.stockItemIds;
          if (stockItemIds.length === 0) {
            const offloadItems = await db
              .select({ stockItemId: containerOffloadItems.stockItemId })
              .from(containerOffloadItems)
              .where(eq(containerOffloadItems.offloadId, result.offload.id));
            stockItemIds = [...new Set(offloadItems.map((item) => item.stockItemId))];
          }
          if (stockItemIds.length === 0) return;

          const syncResult = await syncSalesItemCostsForStockItems(companyId, result.locationId, stockItemIds);
          if (syncResult.updatedCount > 0) {
            logger.info("Sales item costs synced after container offload", {
              module: "containers",
              action: "sync-sales-costs",
              containerId,
              locationId: result.locationId,
              stockItemIds,
              updatedSalesItems: syncResult.updatedCount,
            });
          }
        } catch (syncError: unknown) {
          logger.error("Failed to sync sales item costs after offload (non-fatal)", {
            module: "containers",
            action: "sync-sales-costs",
            containerId,
            error: getErrorMessage(syncError),
          });
        }
      });
    } catch (error: unknown) {
      logger.error("Container offload failed", {
        module: "containers",
        action: "offload",
        userId,
        companyId,
        containerId: req.params.id,
        durationMs: Date.now() - startedAt,
        error,
      });
      if (error instanceof ContainerOffloadLifecycleError) {
        return res.status(error.status).json({ message: error.message, code: error.code });
      }
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
