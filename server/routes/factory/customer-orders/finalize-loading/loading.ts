/**
 * orderFinalizeLoadingRoutes: OrderLoading endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { parseId } from "../../../../lib/parseId";
import { dispatchNotification } from "../../../../lib/notificationService";
import { getClientDate } from "../../../../lib/dateUtils";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { writeDaybookEntry } from "../../_helpers";
import { factoryBales, customerOrders, customerOrderBales, customers, factoryDaybookEntries } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export function registerOrderLoadingRoutes(app: Express) {
  app.post("/api/factory/customer-orders-loading", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
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
        triggeredByUserId: req.session?.userId ?? null,
        companyId,
      }).catch(() => {});

      res.json(order);
    } catch (error: unknown) {
      logger.error("Error creating loading order:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize-loading", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid id" });

      const finalized = await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (order.status !== "LOADING") throw new Error("Only LOADING orders can be finalized for loading");

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        if (bales.length === 0) throw new Error("Order has no bales scanned");

        const now = new Date();
        const [updated] = await tx
          .update(customerOrders)
          .set({
            status: "VERIFIED",
            loadingFinalizedAt: now,
            verifiedAt: now,
            updatedAt: now,
          })
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)))
          .returning();

        // V5 guard: proformaIdUsed IS NOT NULL.
        // The previous implementation issued one UPDATE per scanned bale, so a
        // 700-bale loading generated ~700 database calls. Set the exact same SOLD
        // state in one company-scoped statement instead.
        if (order.proformaIdUsed) {
          const baleIds = [
            ...new Set(bales.map((b) => Number(b.baleId)).filter((id: number) => Number.isSafeInteger(id) && id > 0)),
          ];
          if (baleIds.length > 0) {
            await tx
              .update(factoryBales)
              .set({ status: "SOLD", updatedAt: now })
              .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));
          }
        }

        const [loadingCustomer] = await tx
          .select({ legalName: customers.legalName })
          .from(customers)
          .where(eq(customers.id, order.customerId));
        const txDate = req.body?.txDate || getClientDate(req);
        const totalValue = bales.reduce((sum: number, b: any) => sum + parseFloat(b.priceUsed || "0"), 0);

        await writeDaybookEntry(tx, {
          companyId,
          txDate,
          txType: "LOADING_SUBMITTED",
          referenceId: orderId,
          referenceTable: "customer_orders",
          description: `Loading submitted: ${loadingCustomer?.legalName || "Customer"}, ${bales.length} bale${bales.length !== 1 ? "s" : ""} scanned`,
          amountCurrency: totalValue,
          amountUsd: totalValue,
        });

        // Also write ORDER_VERIFIED immediately since we skip the Pending step.
        const verifyTotalValue = parseFloat(updated?.grandTotal || "0") || totalValue;
        await tx
          .delete(factoryDaybookEntries)
          .where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
              eq(factoryDaybookEntries.referenceId, orderId)
            )
          );
        await writeDaybookEntry(tx, {
          companyId,
          txDate,
          txType: "ORDER_VERIFIED",
          referenceId: orderId,
          referenceTable: "customer_orders",
          description: `Order verified for customer: ${loadingCustomer?.legalName || "Customer"}`,
          amountCurrency: verifyTotalValue,
          amountUsd: verifyTotalValue,
        });

        return {
          updated,
          customerName: loadingCustomer?.legalName || "customer",
          baleCount: bales.length,
        };
      });

      const lsMsg = `${finalized.baleCount} bale${finalized.baleCount !== 1 ? "s" : ""} verified for ${finalized.customerName}`;
      dispatchNotification({
        eventType: "LOADING_FINALIZED",
        title: "Loading Finalized",
        message: lsMsg,
        entityType: "customer_order",
        entityId: orderId,
        triggeredByUserId: req.session?.userId ?? null,
        companyId,
      }).catch(() => {});

      res.json(finalized.updated);
    } catch (error: unknown) {
      logger.error("Error finalizing loading:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
