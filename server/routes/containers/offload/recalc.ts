/**
 * containerOffloadRoutes: ContainerOffloadRecalc endpoints.
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
import { containers, containerOffloads, containerOffloadItems, vouchers, voucherEntries } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { reverseInventoryByExactValue } from "../../../inventoryHelper";

export function registerContainerOffloadRecalcRoutes(app: Express) {
  // Reverse container offload — ERP only (Admin, Owner, or Manager)
  // SP companies that offloaded via the ERP route are also permitted here.
  app.post(
    "/api/containers/:id/reverse-offload",
    requireAuth,
    requireRole("Admin", "Owner", "Manager"),
    async (req, res) => {
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
          return res.status(400).json({ message: "Container is not offloaded" });
        }

        // Get offload record (may not exist for old offloads)
        const [offloadRecord] = await db
          .select()
          .from(containerOffloads)
          .where(eq(containerOffloads.containerId, containerId))
          .limit(1);

        // If no offload record exists, just change status back and return
        if (!offloadRecord) {
          await db.update(containers).set({ status: "OTW" }).where(eq(containers.id, containerId));

          return res.json({
            message: "Container status reversed to OTW (no offload record to clean up)",
          });
        }

        await db.transaction(async (tx) => {
          // Try to get stored offload items first (new approach - exact values)
          const storedOffloadItems = await tx
            .select()
            .from(containerOffloadItems)
            .where(eq(containerOffloadItems.offloadId, offloadRecord.id));

          // Use stored offload items if available (lossless reversal)
          if (storedOffloadItems.length > 0) {
            for (const offloadItem of storedOffloadItems) {
              await reverseInventoryByExactValue(
                tx,
                offloadRecord.locationId,
                offloadItem.stockItemId,
                parseFloat(offloadItem.quantity),
                parseFloat(offloadItem.totalValue)
              );
            }

            // Delete stored offload items
            await tx.delete(containerOffloadItems).where(eq(containerOffloadItems.offloadId, offloadRecord.id));
          } else {
            // Fallback for old offloads without stored items (legacy approach)
            const pos = await storage.getPurchaseOrdersByContainer(containerId);
            const allLineItems = [];
            for (const po of pos) {
              const items = await storage.getLineItemsByPO(po.id);
              allLineItems.push(...items);
            }

            const additionalCostPerBale = parseFloat(offloadRecord.additionalCostPerBale || "0");
            const itemsMap = new Map<
              number,
              {
                stockItemId: number;
                totalQuantity: number;
                weightedRateSum: number;
              }
            >();

            for (const item of allLineItems) {
              const stockItemId = item.stockItemId;
              if (!stockItemId || stockItemId === 0) continue;

              const quantity = parseFloat(item.quantity);
              const rate = parseFloat(item.rate);

              if (itemsMap.has(stockItemId)) {
                const existing = itemsMap.get(stockItemId)!;
                existing.totalQuantity += quantity;
                existing.weightedRateSum += rate * quantity;
              } else {
                itemsMap.set(stockItemId, {
                  stockItemId,
                  totalQuantity: quantity,
                  weightedRateSum: rate * quantity,
                });
              }
            }

            for (const [stockItemId, data] of Array.from(itemsMap)) {
              const estimatedValue = data.weightedRateSum + data.totalQuantity * additionalCostPerBale;
              await reverseInventoryByExactValue(
                tx,
                offloadRecord.locationId,
                stockItemId,
                data.totalQuantity,
                estimatedValue
              );
            }
          }

          // Delete OFFLOAD-related vouchers only (DUTY-, OFFICE-, TRANS-, CHG- prefixes)
          // DO NOT delete PO vouchers that track supplier balances
          const containerVouchers = await tx
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, req.session.currentCompanyId!),
                sql`(
                  (
                    LOWER(${vouchers.description}) LIKE LOWER(${"%container " + (container.containerNumber || "") + "%"})
                    AND (
                      ${vouchers.voucherNumber} LIKE 'DUTY-%' OR
                      ${vouchers.voucherNumber} LIKE 'OFFICE-%' OR
                      ${vouchers.voucherNumber} LIKE 'TRANS-%' OR
                      ${vouchers.voucherNumber} LIKE 'CHG-%' OR
                      ${vouchers.voucherNumber} LIKE 'XFER-%'
                    )
                  )
                  OR ${vouchers.voucherNumber} LIKE ${"SP-OTW-REV-ERP-" + containerId + "-%"}
                  OR ${vouchers.voucherNumber} LIKE ${"SP-STOCK-ERP-" + containerId + "-%"}
                  OR ${vouchers.voucherNumber} LIKE ${"SP-AGENT-SETTLE-" + containerId + "-%"}
                )`
              )
            );

          for (const voucher of containerVouchers) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucher.id));
            await tx.delete(vouchers).where(eq(vouchers.id, voucher.id));
          }

          // Also reverse the HADI L'SHI side SP agent journal (companyId=1)
          const hadiSpVouchers = await tx
            .select()
            .from(vouchers)
            .where(
              and(
                eq(vouchers.companyId, 1),
                sql`${vouchers.voucherNumber} LIKE ${"SP-AGENT-ERP-" + containerId + "-%"}`
              )
            );
          for (const v of hadiSpVouchers) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, v.id));
            await tx.delete(vouchers).where(eq(vouchers.id, v.id));
          }

          // Delete the offload record
          await tx.delete(containerOffloads).where(eq(containerOffloads.id, offloadRecord.id));

          // Update container status back to OTW
          // The import cycle balance uses container.status to filter which containers to include
          // When status changes to OTW, the container's grandTotal is counted in Stock OTW
          await tx.update(containers).set({ status: "OTW" }).where(eq(containers.id, containerId));
        });

        res.json({
          success: true,
          message: "Container offload reversed successfully",
        });
      } catch (error: unknown) {
        logger.error("Reverse offload error:", { error: error });
        res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
