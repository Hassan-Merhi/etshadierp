/**
 * fiscalTransferRoutes: StockTransferCreate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request } from "express";
import { getErrorMessage, getErrorStack } from "../../lib/httpHandlers";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { getClientDate } from "../../lib/dateUtils";
import { logger } from "../../lib/logger";
import { inventory, stockTransferVouchers, stockTransferItems, vouchers, locations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { adjustInventory } from "../../inventoryHelper";
import { sendTransferWhatsApp } from "../../helpers/sendTransferWhatsApp";
import { getActiveCompanyPermissionContext } from "../../services/security/activeCompanyPermissionContext";

async function resolvePosTransferRecipientLocationId(req: Request): Promise<number | null> {
  const context = await getActiveCompanyPermissionContext(req);
  if (context.role !== "POS" || !context.assignedLocationId) {
    return null;
  }
  return context.assignedLocationId;
}

export function registerStockTransferCreateRoutes(app: Express) {
  // Stock Transfers - POST endpoint (supports both creating new and using existing voucher)
  app.post("/api/stock-transfers", requireAuth, async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      logger.info("stock transfer create started", {
        module: "stockTransfer",
        action: "create",
        userId: _uid,
        companyId: _cid,
      });
      const {
        voucherId,
        sourceLocationId,
        destinationLocationId,
        notes,
        items,
        allowNegativeInventory,
        voucherDate,
        optional,
      } = req.body;

      // Log if user confirmed negative inventory override
      if (allowNegativeInventory) {
        logger.info(
          `[AUDIT] User ${req.session.userId} confirmed negative inventory override for stock transfer. Items: ${JSON.stringify(items.map((i: any) => ({ stockItemId: i.stockItemId, quantity: i.quantity, sourceLocationId: i.sourceLocationId })))}`
        );
      }
      const companyId = req.session.currentCompanyId;

      // Branch: Create new transfer from scratch (sourceLocationId provided, no voucherId)
      if (
        !voucherId &&
        (sourceLocationId || (items && items.length > 0 && items.every((i: any) => i.sourceLocationId)))
      ) {
        if (!companyId) {
          return res.status(400).json({ message: "No company selected" });
        }
        if (!destinationLocationId) {
          return res.status(400).json({ message: "Destination location is required" });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
          return res.status(400).json({ message: "Items are required" });
        }
        // Input validation assertions for inventory safety
        for (const item of items) {
          const itemSourceId = item.sourceLocationId || sourceLocationId;
          if (!itemSourceId || isNaN(Number(itemSourceId))) {
            return res
              .status(400)
              .json({ message: `Invalid sourceLocationId for item ${item.stockItemId}: ${itemSourceId}` });
          }
          if (!item.stockItemId || isNaN(Number(item.stockItemId))) {
            return res.status(400).json({ message: `Invalid stockItemId: ${item.stockItemId}` });
          }
          const qty = parseFloat(item.quantity);
          if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
            return res.status(400).json({ message: `Invalid quantity for item ${item.stockItemId}: ${item.quantity}` });
          }
        }
        if (isNaN(Number(destinationLocationId))) {
          return res.status(400).json({ message: `Invalid destinationLocationId: ${destinationLocationId}` });
        }

        // Compute multi-source detection
        const uniqueSourceIds = new Set(items.map((i: any) => i.sourceLocationId || sourceLocationId).filter(Boolean));
        const resolvedHeaderSourceId = uniqueSourceIds.size === 1 ? Array.from(uniqueSourceIds)[0] : null;

        // Validate source/dest not the same (only for single-source mode)
        if (resolvedHeaderSourceId && resolvedHeaderSourceId === destinationLocationId) {
          return res.status(400).json({ message: "Source and destination must be different" });
        }

        // Validate destination location exists
        const destLocation = await storage.getLocationById(destinationLocationId);
        if (!destLocation) {
          return res.status(404).json({ message: "Destination location not found" });
        }

        // Validate each item has a valid source location
        for (const item of items) {
          const itemSourceId = item.sourceLocationId || sourceLocationId;
          if (!itemSourceId) {
            return res.status(400).json({ message: "Each item must have a source location" });
          }
          if (itemSourceId === destinationLocationId) {
            return res
              .status(400)
              .json({ message: `Item ${item.stockItemId}: Source and destination cannot be the same` });
          }
        }
        // Create Stock Transfer voucher, items, and update inventory atomically
        const voucherNumber = `ST-${Date.now()}`;
        const effectiveDate = voucherDate || getClientDate(req);

        const txResult = await db.transaction(async (tx) => {
          const [newVoucher] = await tx
            .insert(vouchers)
            .values({
              companyId,
              voucherType: "Stock Transfer",
              voucherNumber,
              voucherDate: effectiveDate,
              description: notes || null,
              totalAmount: "0",
              optional: optional === true,
            })
            .returning();

          const [transfer] = await tx
            .insert(stockTransferVouchers)
            .values({
              voucherId: newVoucher.id,
              sourceLocationId: resolvedHeaderSourceId,
              destinationLocationId,
              notes: notes || null,
              inventoryApplied: optional !== true,
            })
            .returning();

          let totalAmount = 0;
          const transferItems = [];

          for (const item of items) {
            const quantity = parseFloat(item.quantity);

            const [sourceInv] = await tx
              .select({ averageRate: inventory.averageRate, quantity: inventory.quantity })
              .from(inventory)
              .where(
                and(
                  eq(inventory.locationId, item.sourceLocationId || sourceLocationId),
                  eq(inventory.stockItemId, item.stockItemId)
                )
              )
              .limit(1);

            const rate = parseFloat(sourceInv?.averageRate || "0");
            const totalItemAmount = quantity * rate;
            totalAmount += totalItemAmount;

            const [insertedItem] = await tx
              .insert(stockTransferItems)
              .values({
                transferId: transfer.id,
                stockItemId: item.stockItemId,
                sourceLocationId: item.sourceLocationId || sourceLocationId,
                quantity: quantity.toString(),
                rate: rate.toFixed(2),
                totalAmount: totalItemAmount.toFixed(2),
              })
              .returning();

            transferItems.push(insertedItem);

            // Only update inventory for non-optional (confirmed) transfers
            if (!optional) {
              // Deduct from source location (transfer out = negative delta)
              await adjustInventory(
                tx,
                item.sourceLocationId || sourceLocationId,
                item.stockItemId,
                -quantity,
                companyId!
              );

              // Add to destination location (transfer in = positive delta with rate)
              await adjustInventory(tx, destinationLocationId, item.stockItemId, quantity, companyId!, rate);
            }
          }

          await tx
            .update(vouchers)
            .set({ totalAmount: totalAmount.toFixed(2) })
            .where(eq(vouchers.id, newVoucher.id));

          return { transfer, transferItems, newVoucher };
        });

        res.status(201).json({
          transfer: txResult.transfer,
          items: txResult.transferItems,
          voucher: txResult.newVoucher,
        });

        // Fire-and-forget: POS notifications go to the group configured for
        // the POS user's assigned location, not the transfer destination.
        if (req.user?.role === "POS")
          setImmediate(async () => {
            try {
              const recipientLocationId = await resolvePosTransferRecipientLocationId(req);
              if (!recipientLocationId) {
                logger.warn("[TransferWA] POS user has no active assigned location; skipping notification", {
                  userId: req.session.userId,
                  companyId: req.session.currentCompanyId,
                });
                return;
              }
              const waSourceId = txResult.transfer.sourceLocationId;
              let sourceName = "Multiple Sources";
              if (waSourceId) {
                const [srcLoc] = await db
                  .select({ name: locations.name })
                  .from(locations)
                  .where(eq(locations.id, waSourceId));
                if (srcLoc?.name) sourceName = srcLoc.name;
              }
              await sendTransferWhatsApp({
                destinationLocationId,
                recipientLocationId,
                sourceLocationName: sourceName,
                destLocationName: destLocation.name,
                items: txResult.transferItems.map((i) => ({
                  stockItemId: i.stockItemId,
                  quantity: parseFloat(i.quantity),
                })),
                voucherNumber: txResult.newVoucher.voucherNumber,
                voucherDate: txResult.newVoucher.voucherDate,
              });
            } catch (e: unknown) {
              logger.error("[TransferWA] Failed to send:", { error: getErrorMessage(e) });
            }
          });
        return;
      }

      // Original flow: Use existing voucher (voucherId required)
      if (!voucherId) {
        return res.status(400).json({ message: "Either voucherId or sourceLocationId is required" });
      }
      if (!destinationLocationId) {
        return res.status(400).json({ message: "Destination location is required" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items are required" });
      }

      // Validate that destination location exists
      const destLocation = await storage.getLocationById(destinationLocationId);
      if (!destLocation) {
        return res.status(404).json({ message: "Destination location not found" });
      }

      // Validate that voucher exists
      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Validate items and their source locations
      for (const item of items) {
        if (!item.sourceLocationId) {
          return res.status(400).json({ message: "Source location is required for all items" });
        }
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) <= 0) {
          return res.status(400).json({ message: "Quantity must be positive for all items" });
        }
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }

        // Validate that source and destination are different for each item
        if (item.sourceLocationId === destinationLocationId) {
          return res.status(400).json({
            message: "Source and destination locations must be different for each item",
          });
        }

        // Validate that source location exists
        const sourceLocation = await storage.getLocationById(item.sourceLocationId);
        if (!sourceLocation) {
          return res.status(404).json({
            message: `Source location with ID ${item.sourceLocationId} not found`,
          });
        }
      }

      logger.info("[Stock Transfer] Creating transfer:", {
        voucherId,
        destinationLocationId,
        itemCount: items.length,
      });

      // Auto-fill rate from inventory for items with no rate (e.g. POS users who don't see cost)
      const itemsWithRate = await Promise.all(
        items.map(async (item: any) => {
          if (!item.rate || parseFloat(item.rate) === 0) {
            const [invRow] = await db
              .select({ averageRate: inventory.averageRate })
              .from(inventory)
              .where(and(eq(inventory.locationId, item.sourceLocationId), eq(inventory.stockItemId, item.stockItemId)))
              .limit(1);
            const resolvedRate = parseFloat(invRow?.averageRate ?? "0");
            return { ...item, rate: resolvedRate.toFixed(2) };
          }
          return item;
        })
      );

      const transfer = await storage.createStockTransfer(voucherId, destinationLocationId, notes || "", itemsWithRate);

      // Update voucher totalAmount based on actual rates (important for POS transfers where rate starts at 0)
      const actualTotal = itemsWithRate.reduce((sum: number, item: any) => {
        return sum + parseFloat(item.quantity) * parseFloat(item.rate);
      }, 0);
      if (actualTotal > 0) {
        await db
          .update(vouchers)
          .set({ totalAmount: actualTotal.toFixed(2) })
          .where(eq(vouchers.id, voucherId));
      }

      logger.info("[Stock Transfer] Transfer created successfully:", {
        transferId: transfer.transfer.id,
        itemsCount: transfer.items.length,
      });
      logger.info("stock transfer create succeeded", {
        module: "stockTransfer",
        action: "create",
        userId: _uid,
        companyId: _cid,
        durationMs: Date.now() - _t,
      });
      res.status(201).json(transfer);

      // Fire-and-forget: POS notifications go to the group configured for the
      // POS user's assigned location, not the transfer destination.
      if (req.user?.role === "POS")
        setImmediate(async () => {
          try {
            const recipientLocationId = await resolvePosTransferRecipientLocationId(req);
            if (!recipientLocationId) {
              logger.warn("[TransferWA] POS user has no active assigned location; skipping notification", {
                userId: req.session.userId,
                companyId: req.session.currentCompanyId,
              });
              return;
            }
            const uniqueSrcIds = [
              ...new Set(itemsWithRate.map((i: any) => Number(i.sourceLocationId)).filter(Boolean)),
            ];
            let sourceName = "Multiple Sources";
            if (uniqueSrcIds.length === 1) {
              const [srcLoc] = await db
                .select({ name: locations.name })
                .from(locations)
                .where(eq(locations.id, uniqueSrcIds[0]));
              if (srcLoc?.name) sourceName = srcLoc.name;
            }
            await sendTransferWhatsApp({
              destinationLocationId,
              recipientLocationId,
              sourceLocationName: sourceName,
              destLocationName: destLocation.name,
              items: transfer.items.map((i: any) => ({
                stockItemId: i.stockItemId,
                quantity: parseFloat(i.quantity),
              })),
              voucherNumber: voucher.voucherNumber,
              voucherDate: voucher.voucherDate,
            });
          } catch (e: unknown) {
            logger.error("[TransferWA] Failed to send (original-flow):", { error: getErrorMessage(e) });
          }
        });
    } catch (error: unknown) {
      logger.error("stock transfer create failed", {
        module: "stockTransfer",
        action: "create",
        userId: _uid,
        companyId: _cid,
        durationMs: Date.now() - _t,
        error,
      });
      logger.error("[Stock Transfer] Error creating transfer:", {
        error: getErrorMessage(error),
        stack: getErrorStack(error),
      });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
