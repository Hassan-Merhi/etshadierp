/**
 * orderFinalizeLoadingRoutes: OrderLoading endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { parseId } from "../../../../lib/parseId";
import { dispatchNotification } from "../../../../lib/notificationService";
import { getClientDate } from "../../../../lib/dateUtils";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { writeDaybookEntry } from "../../_helpers";
import { factoryBales, customerOrders, customerOrderBales, customers, factoryDaybookEntries } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function registerOrderLoadingRoutes(app: Express) {
  app.post("/api/factory/customer-orders-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, proformaIdUsed, locationId, orderDate, containerNotes } = req.body;
      if (!customerId) return res.status(400).json({ message: "Customer is required" });
      if (!locationId) return res.status(400).json({ message: "Location is required" });

      const [order] = await db
        .insert(customerOrders)
        .values({
          companyId,
          customerId: parseInt(customerId),
          proformaIdUsed: proformaIdUsed ? parseInt(proformaIdUsed) : null,
          locationId: parseInt(locationId),
          orderDate: orderDate || getClientDate(req),
          status: "LOADING",
          loadingStartedAt: new Date(),
          containerNotes: containerNotes || null,
        })
        .returning();

      const [loadingCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, parseInt(customerId)));
      const loadingToday = orderDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: loadingToday,
        txType: "LOADING_CREATED",
        referenceId: order.id,
        referenceTable: "customer_orders",
        description: `Loading started for customer: ${loadingCustomer?.legalName || customerId}`,
      });

      dispatchNotification({
        eventType: "LOADING_STARTED",
        title: "Loading Started",
        message: `New loading started for ${loadingCustomer?.legalName || "customer"}`,
        entityType: "customer_order",
        entityId: order.id,
        triggeredByUserId: (req.session as any)?.userId ?? null,
        companyId,
      }).catch(() => {});

      res.json(order);
    } catch (error: unknown) {
      logger.error("Error creating loading order:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize-loading", requireAuth, async (req: any, res: any) => {
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
      if (order.status !== "LOADING")
        return res.status(400).json({ message: "Only LOADING orders can be finalized for loading" });

      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (bales.length === 0) return res.status(400).json({ message: "Order has no bales scanned" });

      const [updated] = await db
        .update(customerOrders)
        .set({
          status: "VERIFIED",
          loadingFinalizedAt: new Date(),
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(customerOrders.id, orderId))
        .returning();

      // V5 guard: proformaIdUsed IS NOT NULL
      // Move all linked bales to SOLD when a V5 order reaches VERIFIED.
      // This is idempotent — bales already SOLD are unaffected by the update.
      // Legacy V2/V3 orders keep bales in RESERVED_FOR_ORDER until FINALIZED.
      if (order.proformaIdUsed) {
        for (const b of bales) {
          await db
            .update(factoryBales)
            .set({ status: "SOLD", updatedAt: new Date() })
            .where(eq(factoryBales.id, b.baleId));
        }
      }

      const [lsCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, order.customerId));
      const lsToday = req.body?.txDate || getClientDate(req);
      const lsTotalValue = bales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "LOADING_SUBMITTED",
        referenceId: orderId,
        referenceTable: "customer_orders",
        description: `Loading submitted: ${lsCustomer?.legalName || "Customer"}, ${bales.length} bale${bales.length !== 1 ? "s" : ""} scanned`,
        amountCurrency: lsTotalValue,
        amountUsd: lsTotalValue,
      });
      // Also write ORDER_VERIFIED immediately since we skip the Pending step
      const verifyTotalValue = parseFloat(updated?.grandTotal || "0") || lsTotalValue;
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          )
        );
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "ORDER_VERIFIED",
        referenceId: orderId,
        referenceTable: "customer_orders",
        description: `Order verified for customer: ${lsCustomer?.legalName || "Customer"}`,
        amountCurrency: verifyTotalValue,
        amountUsd: verifyTotalValue,
      });

      const lsMsg = `${bales.length} bale${bales.length !== 1 ? "s" : ""} verified for ${lsCustomer?.legalName || "customer"}`;
      dispatchNotification({
        eventType: "LOADING_FINALIZED",
        title: "Loading Finalized",
        message: lsMsg,
        entityType: "customer_order",
        entityId: orderId,
        triggeredByUserId: (req.session as any)?.userId ?? null,
        companyId,
      }).catch(() => {});

      res.json(updated);
    } catch (error: unknown) {
      logger.error("Error finalizing loading:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
