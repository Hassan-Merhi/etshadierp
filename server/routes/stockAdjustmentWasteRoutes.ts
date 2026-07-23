/**
 * Stock-adjustment & waste-dispatch routes.
 *
 * Stock-adjustment listing/create/update and waste-dispatch CRUD. Extracted
 * from fiscalTransferRoutes.ts as a sub-registrar; behaviour is unchanged.
 */
import type { Express } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { requireAuth, requireNonPOS } from "../auth";
import { logger } from "../lib/logger";
import {
  locations,
  stockItems,
  vouchers,
  wasteDispatches,
  wasteDispatchItems,
  updateStockAdjustmentSchema,
} from "@shared/schema";

export function registerStockAdjustmentWasteRoutes(app: Express) {
  // Stock Adjustments - GET endpoint
  app.get("/api/stock-adjustments", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const voucherId = req.query.voucherId ? parseInt(req.query.voucherId as string) : null;

      if (!voucherId) {
        return res.status(400).json({ message: "voucherId query parameter is required" });
      }

      const adjustment = await storage.getStockAdjustmentByVoucherId(voucherId);
      res.json(adjustment);
    } catch (error: any) {
      console.error("[Stock Adjustment GET] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Adjustments - POST endpoint
  app.post("/api/stock-adjustments", requireAuth, requireNonPOS, async (req, res) => {
    const _t = Date.now();
    const _uid = req.session.userId;
    const _cid = req.session.currentCompanyId;
    try {
      const { voucherId, locationId, adjustmentType, notes, items } = req.body;

      // Validate required fields
      if (!voucherId) {
        return res.status(400).json({ message: "Voucher ID is required" });
      }
      if (!locationId) {
        return res.status(400).json({ message: "Location is required" });
      }
      if (!adjustmentType) {
        return res.status(400).json({ message: "Adjustment type is required" });
      }
      if (adjustmentType !== "Production" && adjustmentType !== "Consumption" && adjustmentType !== "Mixed") {
        return res.status(400).json({
          message: "Adjustment type must be 'Production', 'Consumption', or 'Mixed'",
        });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Items are required" });
      }

      // Validate that location exists
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }

      // Validate that voucher exists
      const voucher = await storage.getVoucherById(voucherId);
      if (!voucher) {
        return res.status(404).json({ message: "Voucher not found" });
      }

      // Validate items
      for (const item of items) {
        if (!item.stockItemId) {
          return res.status(400).json({ message: "Stock item ID is required for all items" });
        }
        if (!item.quantity || parseFloat(item.quantity) === 0) {
          return res.status(400).json({ message: "Quantity cannot be zero for any items" });
        }
        // Note: Negative quantities are allowed for consumption items
        if (!item.rate || parseFloat(item.rate) < 0) {
          return res.status(400).json({ message: "Rate must be non-negative for all items" });
        }
      }

      logger.info("stock adjustment create started", { module: "stockAdjustment", action: "create", userId: _uid, companyId: _cid, adjustmentType, itemCount: items.length });

      const adjustment = await storage.createStockAdjustment(voucherId, locationId, adjustmentType, notes || "", items);

      logger.info("stock adjustment create succeeded", { module: "stockAdjustment", action: "create", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, adjustmentId: adjustment.adjustment.id });
      res.status(201).json(adjustment);
    } catch (error: any) {
      logger.error("stock adjustment create failed", { module: "stockAdjustment", action: "create", userId: _uid, companyId: _cid, durationMs: Date.now() - _t, error });
      res.status(500).json({ message: error.message });
    }
  });

  // Stock Adjustments - PUT endpoint (update)
  app.put("/api/stock-adjustments/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) {
        return res.status(400).json({ message: "Adjustment ID is required" });
      }

      // Validate request body using Zod
      const parseResult = updateStockAdjustmentSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          message: "Invalid request data",
          errors: parseResult.error.issues,
        });
      }

      const { locationId, adjustmentType, notes, items } = parseResult.data;

      // Convert numbers back to strings with fixed precision for storage layer
      const itemsForStorage = items.map((item) => ({
        stockItemId: item.stockItemId,
        quantity: item.quantity.toFixed(3),
        rate: item.rate.toFixed(2),
      }));

      // Update the stock adjustment using the storage method
      const updated = await storage.updateStockAdjustment(id, locationId, adjustmentType, notes || "", itemsForStorage);

      // Recalculate voucher totalAmount based on updated items
      // For Mixed: net = production (positive qty) - consumption (negative qty)
      // For Production/Consumption only: use absolute value sum
      const { adjustmentType: updatedAdjType } = parseResult.data;
      const newTotalAmount =
        updatedAdjType === "Mixed"
          ? items.reduce((sum, item) => sum + item.quantity * item.rate, 0)
          : items.reduce((sum, item) => sum + Math.abs(item.quantity) * item.rate, 0);
      await db
        .update(vouchers)
        .set({ totalAmount: newTotalAmount.toFixed(2) })
        .where(eq(vouchers.id, updated.adjustment.voucherId));

      res.json(updated);
    } catch (error: any) {
      console.error("[Stock Adjustment PUT] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // ===== WASTE DISPATCHES =====

  app.get("/api/waste-dispatches", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dispatches = await db
        .select({
          id: wasteDispatches.id,
          companyId: wasteDispatches.companyId,
          locationId: wasteDispatches.locationId,
          voucherId: wasteDispatches.voucherId,
          dispatchNumber: wasteDispatches.dispatchNumber,
          dispatchDate: wasteDispatches.dispatchDate,
          notes: wasteDispatches.notes,
          totalAmount: wasteDispatches.totalAmount,
          createdAt: wasteDispatches.createdAt,
          locationName: locations.name,
        })
        .from(wasteDispatches)
        .leftJoin(locations, eq(locations.id, wasteDispatches.locationId))
        .where(eq(wasteDispatches.companyId, companyId))
        .orderBy(desc(wasteDispatches.createdAt));

      res.json(dispatches);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/waste-dispatches/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [dispatch] = await db
        .select({
          id: wasteDispatches.id,
          companyId: wasteDispatches.companyId,
          locationId: wasteDispatches.locationId,
          voucherId: wasteDispatches.voucherId,
          dispatchNumber: wasteDispatches.dispatchNumber,
          dispatchDate: wasteDispatches.dispatchDate,
          notes: wasteDispatches.notes,
          totalAmount: wasteDispatches.totalAmount,
          createdAt: wasteDispatches.createdAt,
          locationName: locations.name,
        })
        .from(wasteDispatches)
        .leftJoin(locations, eq(locations.id, wasteDispatches.locationId))
        .where(and(eq(wasteDispatches.id, id), eq(wasteDispatches.companyId, companyId)));

      if (!dispatch) return res.status(404).json({ message: "Dispatch not found" });

      const items = await db
        .select({
          id: wasteDispatchItems.id,
          stockItemId: wasteDispatchItems.stockItemId,
          quantity: wasteDispatchItems.quantity,
          rate: wasteDispatchItems.rate,
          totalAmount: wasteDispatchItems.totalAmount,
          stockItemName: stockItems.name,
          stockItemUnit: stockItems.uom,
        })
        .from(wasteDispatchItems)
        .leftJoin(stockItems, eq(stockItems.id, wasteDispatchItems.stockItemId))
        .where(eq(wasteDispatchItems.dispatchId, id));

      res.json({ ...dispatch, items });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/waste-dispatches", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId, dispatchDate, notes, items } = req.body;

      if (!locationId || !dispatchDate || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "locationId, dispatchDate, and items are required" });
      }

      // Validate items
      for (const item of items) {
        if (!item.stockItemId || !item.quantity || parseFloat(item.quantity) <= 0) {
          return res.status(400).json({ message: "Each item must have stockItemId and positive quantity" });
        }
      }

      // Generate dispatch number: WD-{YEAR}-{padded seq}
      const year = new Date(dispatchDate).getFullYear();
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(wasteDispatches)
        .where(eq(wasteDispatches.companyId, companyId));
      const seq = (count || 0) + 1;
      const dispatchNumber = `WD-${year}-${String(seq).padStart(4, "0")}`;

      // Get location name for voucher description
      const [location] = await db.select().from(locations).where(eq(locations.id, locationId));
      if (!location) return res.status(400).json({ message: "Location not found" });

      // Calculate total (will be updated after createStockAdjustment to use actual rates)
      const itemsForAdj = items.map((item: any) => ({
        stockItemId: parseInt(item.stockItemId),
        quantity: (-Math.abs(parseFloat(item.quantity))).toFixed(3), // negative = consumption
        rate: "0", // rate will be determined from inventory by createStockAdjustment
      }));

      // Create voucher with type "Consumption"
      const voucher = await storage.createVoucher({
        companyId,
        voucherType: "Consumption",
        voucherNumber: dispatchNumber,
        voucherDate: dispatchDate,
        description: `Waste dispatch from ${location.name}`,
        totalAmount: "0",
        currency: "USD",
        sourceModule: "ERP",
        optional: false,
        locationId,
      });

      // Create stock adjustment (uses WASTE_EXPENSE account instead of CONSUMPTION_EXPENSE)
      const adjResult = await storage.createStockAdjustment(
        voucher.id,
        locationId,
        "Consumption",
        notes || "",
        itemsForAdj,
        { code: "WASTE_EXPENSE", name: "Waste Expense" }
      );

      // Calculate total from actual rates used
      const totalAmount = adjResult.items.reduce((sum: number, item: any) => sum + parseFloat(item.totalAmount), 0);

      // Update voucher with actual total
      await db
        .update(vouchers)
        .set({ totalAmount: totalAmount.toFixed(2) })
        .where(eq(vouchers.id, voucher.id));

      // Create waste dispatch record
      const [dispatch] = await db
        .insert(wasteDispatches)
        .values({
          companyId,
          locationId,
          voucherId: voucher.id,
          dispatchNumber,
          dispatchDate,
          notes: notes || null,
          totalAmount: totalAmount.toFixed(2),
        })
        .returning();

      // Create waste dispatch items
      for (let i = 0; i < adjResult.items.length; i++) {
        const adjItem = adjResult.items[i];
        await db.insert(wasteDispatchItems).values({
          dispatchId: dispatch.id,
          stockItemId: adjItem.stockItemId,
          quantity: Math.abs(parseFloat(adjItem.quantity)).toFixed(3),
          rate: adjItem.rate,
          totalAmount: adjItem.totalAmount,
        });
      }

      res.json({ ...dispatch, voucherNumber: dispatchNumber });
    } catch (error: any) {
      console.error("[Waste Dispatch POST] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/waste-dispatches/:id", requireAuth, requireNonPOS, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [dispatch] = await db
        .select()
        .from(wasteDispatches)
        .where(and(eq(wasteDispatches.id, id), eq(wasteDispatches.companyId, companyId)));

      if (!dispatch) return res.status(404).json({ message: "Dispatch not found" });

      // Delete voucher (reverses inventory changes automatically via deleteVoucher logic)
      if (dispatch.voucherId) {
        await storage.deleteVoucher(dispatch.voucherId);
      }

      // Delete waste dispatch items and dispatch record
      await db.delete(wasteDispatchItems).where(eq(wasteDispatchItems.dispatchId, id));
      await db.delete(wasteDispatches).where(eq(wasteDispatches.id, id));

      res.json({ message: "Waste dispatch deleted and inventory reversed" });
    } catch (error: any) {
      console.error("[Waste Dispatch DELETE] Error:", error.message);
      res.status(500).json({ message: error.message });
    }
  });
}
