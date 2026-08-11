/**
 * fiscalTransferRoutes: StockTransferUpdate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { db } from "../../db";
import { storage } from "../../storage";
import { requireAuth } from "../../auth";
import { logger } from "../../lib/logger";
import { vouchers, updateStockTransferSchema } from "@shared/schema";
import { eq } from "drizzle-orm";
import { registerStockAdjustmentWasteRoutes } from "../stockAdjustmentWasteRoutes";

export function registerStockTransferUpdateRoutes(app: Express) {
  // Stock Transfers - PUT endpoint (update)
  app.put("/api/stock-transfers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) {
        return res.status(400).json({ message: "Transfer ID is required" });
      }

      // Validate request body using Zod
      const parseResult = updateStockTransferSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: parseResult.error.issues,
        });
      }

      const { destinationLocationId, notes, items } = parseResult.data;

      // Validate that source !== destination for each item
      const invalidItem = items.find((item) => item.sourceLocationId === destinationLocationId);
      if (invalidItem) {
        return res.status(400).json({ message: "Source and destination locations must be different for each item" });
      }

      // Convert numbers back to strings with fixed precision for storage layer
      const itemsForStorage = items.map((item) => ({
        sourceLocationId: item.sourceLocationId,
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
      }));

      // Update the stock transfer using the storage method
      const updated = await storage.updateStockTransfer(id, destinationLocationId, notes || "", itemsForStorage);

      // Recalculate voucher totalAmount based on updated items
      const newTotalAmount = items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
      await db
        .update(vouchers)
        .set({ totalAmount: newTotalAmount.toFixed(2) })
        .where(eq(vouchers.id, updated.transfer.voucherId));

      res.json(updated);
    } catch (error: unknown) {
      logger.error("[Stock Transfer PUT] Error:", { error: getErrorMessage(error) });

      // Check if this is a legacy transfer validation error (400) vs server error (500)
      if (getErrorMessage(error) && getErrorMessage(error).includes("missing source location data")) {
        return res.status(400).json({ message: getErrorMessage(error) });
      }

      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  registerStockAdjustmentWasteRoutes(app);
}
