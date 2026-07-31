/**
 * baleScanningRoutes: OrderBaleExchange endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { parseId } from "../../../../lib/parseId";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { recalculateOrderTotals } from "../../_helpers";
import {
  factoryBaleProducts,
  factoryBales,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerOrderBaleRemovals,
} from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";

export function registerOrderBaleExchangeRoutes(app: Express) {
  // POST /api/factory/customer-orders/:id/bales/exchange — swap one bale for another on a FINALIZED order
  app.post("/api/factory/customer-orders/:id/bales/exchange", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { orderBaleId, newBaleReference } = req.body;
      if (!orderBaleId || !newBaleReference?.trim()) {
        return res.status(400).json({ message: "orderBaleId and newBaleReference are required" });
      }

      await db.transaction(async (tx: any) => {
        const [order] = await tx
          .select()
          .from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["FINALIZED", "VERIFIED"].includes(order.status)) {
          throw new Error("Bale exchange is only allowed on FINALIZED or VERIFIED orders");
        }

        // Find the customerOrderBales row to replace
        const [oldOrderBale] = await tx
          .select()
          .from(customerOrderBales)
          .where(and(eq(customerOrderBales.id, orderBaleId), eq(customerOrderBales.orderId, orderId)));
        if (!oldOrderBale) throw new Error("Bale not found in this order");

        // Find the new bale in stock — FOR UPDATE prevents a concurrent
        // exchange or sale from grabbing the same physical bale.
        const newRef = newBaleReference.trim();
        const [newBale] = await tx
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.status, "IN_STOCK"),
              or(eq(factoryBales.referenceNumber, newRef), eq(factoryBales.baleCode, newRef))
            )
          )
          .for("update");
        if (!newBale) throw new Error(`Bale "${newRef}" not found in stock or not available`);

        // Resolve product name for new bale
        let newBaleName = newBale.productName || newBale.articleCode || newBale.baleCode || "";
        if (newBale.productId) {
          const [prod] = await tx
            .select({ name: factoryBaleProducts.name })
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.id, newBale.productId));
          if (prod?.name) newBaleName = prod.name;
        }

        // Return old bale to stock
        await tx
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, oldOrderBale.baleId));

        // Remove old order bale row
        await tx.delete(customerOrderBales).where(eq(customerOrderBales.id, orderBaleId));

        // Insert new order bale row (preserve price from the row being replaced)
        await tx.insert(customerOrderBales).values({
          orderId,
          baleId: newBale.id,
          baleReference: newBale.referenceNumber || newRef,
          locationId: oldOrderBale.locationId,
          weight: newBale.weightKg,
          articleCode: newBale.articleCode || oldOrderBale.articleCode,
          baleName: newBaleName || oldOrderBale.baleName,
          priceUsed: oldOrderBale.priceUsed,
        });

        // Mark new bale as sold (same status as other finalized bales)
        await tx
          .update(factoryBales)
          .set({ status: "SOLD", updatedAt: new Date() })
          .where(eq(factoryBales.id, newBale.id));

        await recalculateOrderTotals(tx, orderId);
      });

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));
      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: unknown) {
      logger.error("Exchange bale error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // GET removal log for a specific order/loading
  app.get("/api/factory/customer-orders/:id/bale-removals", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      const removals = await db
        .select()
        .from(customerOrderBaleRemovals)
        .where(eq(customerOrderBaleRemovals.orderId, orderId))
        .orderBy(desc(customerOrderBaleRemovals.removedAt));
      res.json(removals);
    } catch (error: unknown) {
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
