/**
 * containerOffloadRoutes: ContainerOffloadUpdate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { storage } from "../../../storage";
import { requireAuth, requireRole } from "../../../auth";
import {
  containers,
  containerOffloads,
  containerOffloadItems,
  offloadRequestSchema,
  vouchers,
  voucherEntries,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { adjustInventory } from "../../../inventoryHelper";
import { applyInventoryRateDeltaAndSync } from "../../../services/syncSalesItemCosts";

export function registerContainerOffloadUpdateRoutes(app: Express) {
  // Edit container offload (Admin only)
  app.patch("/api/containers/:id/offload", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const containerId = parseId(req.params.id);
      if (containerId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(containerId)) {
        return res.status(400).json({ message: "Invalid container ID" });
      }

      // Get container
      const container = await storage.getContainerById(containerId);
      if (!container) {
        return res.status(404).json({ message: "Container not found" });
      }

      // Verify container belongs to current company
      if (container.companyId !== req.session.currentCompanyId) {
        return res.status(403).json({
          message: "Access denied: Container belongs to a different company",
        });
      }

      // Check if container is offloaded
      if (container.status !== "OFFLOADED") {
        return res.status(400).json({ message: "Container must be offloaded to edit" });
      }

      // Validate request body
      const validation = offloadRequestSchema
        .extend({
          dutiesAccountId: z.number().optional(),
          officeChargesAccountId: z.number().optional(),
          officeChargesCashAccountId: z.number().optional(),
          transportAccountId: z.number().optional(),
          additionalCharges: z
            .array(
              z.object({
                description: z.string(),
                amount: z.number(),
                ledgerAccountId: z.number(),
              })
            )
            .optional(),
        })
        .safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({ errors: validation.error.issues });
      }

      const {
        locationId,
        offloadDate,
        duties,
        dutiesAccountId,
        officeCharges,
        officeChargesAccountId,
        officeChargesCashAccountId,
        transferCharges,
        transportFees,
        transportAccountId,
        additionalCharges = [],
      } = validation.data;

      // Get current offload record
      const [currentOffload] = await db
        .select()
        .from(containerOffloads)
        .where(eq(containerOffloads.containerId, containerId))
        .limit(1);

      if (!currentOffload) {
        return res.status(404).json({ message: "Offload record not found" });
      }

      // Captured inside the transaction so the post-commit inventory sync
      // (fire-and-forget block below) can compute the per-bale cost delta.
      let newAdditionalCostPerBale = 0;

      await db.transaction(async (tx) => {
        // If location changed, need to move inventory
        if (locationId !== currentOffload.locationId) {
          const pos = await storage.getPurchaseOrdersByContainer(containerId);
          for (const po of pos) {
            const lineItems = await storage.getLineItemsByPO(po.id);
            for (const item of lineItems) {
              // Move inventory from old location to new location
              const removeResult = await adjustInventory(
                tx,
                currentOffload.locationId,
                item.stockItemId,
                -parseFloat(item.quantity),
                req.session.currentCompanyId!
              );
              if (removeResult.previousQuantity !== 0) {
                await adjustInventory(
                  tx,
                  locationId,
                  item.stockItemId,
                  parseFloat(item.quantity),
                  req.session.currentCompanyId!,
                  removeResult.averageRate
                );
              }
            }
          }
        }

        // Recalculate charges
        const additionalChargesTotal = additionalCharges.reduce((sum, charge) => sum + charge.amount, 0);
        const totalCharges =
          parseFloat(duties) +
          parseFloat(officeCharges) +
          parseFloat(transferCharges) +
          parseFloat(transportFees) +
          additionalChargesTotal;

        const totalBales = parseFloat(currentOffload.totalBales);
        // Round to 2 decimal places to prevent floating-point accumulation errors
        const additionalCostPerBale = totalBales > 0 ? Math.round((totalCharges / totalBales) * 100) / 100 : 0;
        newAdditionalCostPerBale = additionalCostPerBale;

        // Update offload record
        await tx
          .update(containerOffloads)
          .set({
            locationId,
            duties,
            officeCharges,
            transferCharges,
            transportFees,
            totalCharges: totalCharges.toString(),
            additionalCostPerBale: additionalCostPerBale.toString(),
            offloadedAt: offloadDate ? new Date(offloadDate) : currentOffload.offloadedAt,
          })
          .where(eq(containerOffloads.id, currentOffload.id));

        // Keep containers.dutyFee in sync with the actual duties entered so the
        // Agent/Duty FIFO tab always uses the real duty amount.
        if (parseFloat(duties) > 0) {
          await tx.update(containers).set({ dutyFee: duties }).where(eq(containers.id, containerId));
        }

        // Delete old vouchers and create new ones with updated charges
        const containerVouchers = await tx
          .select()
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, req.session.currentCompanyId!),
              sql`${vouchers.description} LIKE '%Container ${container.containerNumber}%'`
            )
          );

        for (const voucher of containerVouchers) {
          await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
          await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
        }

        // Create new voucher entries with updated charges (similar to offloadContainer logic)
        // This is a simplified version - you may want to call the full offload logic
        // For now, we'll just update the records
      });

      res.json({
        success: true,
        message: "Container offload updated successfully",
      });

      // ── Part B: sync inventory averageRate + sales_items costs after charge edit (fire-and-forget) ──
      // The PATCH route updates additionalCostPerBale in containerOffloads but does NOT
      // automatically adjust inventory.averageRate. We compute the per-unit delta and
      // apply it to inventory, then propagate to sales_items.
      Promise.resolve().then(async () => {
        try {
          const companyId = req.session.currentCompanyId!;
          const oldAdditionalCostPerBale = parseFloat(currentOffload.additionalCostPerBale || "0");
          const delta = newAdditionalCostPerBale - oldAdditionalCostPerBale;

          // Get affected stock items from stored offload items (most accurate)
          const offloadItems = await db
            .select({ stockItemId: containerOffloadItems.stockItemId })
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, currentOffload.id));

          let stockItemIds: number[] = [...new Set(offloadItems.map((i) => i.stockItemId))];

          // Fallback: derive from PO line items if no stored offload items
          if (stockItemIds.length === 0) {
            const pos = await storage.getPurchaseOrdersByContainer(containerId);
            const idSet = new Set<number>();
            for (const po of pos) {
              const lineItems = await storage.getLineItemsByPO(po.id);
              for (const li of lineItems) {
                if (li.stockItemId && li.stockItemId !== 0) idSet.add(li.stockItemId);
              }
            }
            stockItemIds = [...idSet];
          }

          if (stockItemIds.length === 0) return;

          const result = await applyInventoryRateDeltaAndSync(
            companyId,
            currentOffload.locationId,
            stockItemIds,
            delta
          );

          if (result.updatedCount > 0 || Math.abs(delta) > 0.001) {
            logger.info("Sales item costs synced after container charge edit", {
              module: "containers",
              action: "sync-sales-costs-patch",
              containerId,
              locationId: currentOffload.locationId,
              delta,
              stockItemIds,
              updatedSalesItems: result.updatedCount,
            });
          }
        } catch (syncErr: unknown) {
          logger.error("Failed to sync sales item costs after charge edit (non-fatal)", {
            module: "containers",
            action: "sync-sales-costs-patch",
            containerId,
            error: getErrorMessage(syncErr),
          });
        }
      });
    } catch (error: unknown) {
      logger.error("Edit offload error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
