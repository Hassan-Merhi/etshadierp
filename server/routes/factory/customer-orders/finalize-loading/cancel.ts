/**
 * orderFinalizeLoadingRoutes: OrderCancel endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { parseId } from "../../../../lib/parseId";
import { getClientDate } from "../../../../lib/dateUtils";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { writeDaybookEntry, recalculateOrderTotals } from "../../_helpers";
import { logAudit } from "../../../helpers/auditHelpers";
import { factoryBales, customerOrders, customerOrderBales, customers, factoryDaybookEntries } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export function registerOrderCancelRoutes(app: Express) {
  app.post("/api/factory/customer-orders/:id/cancel", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // ── V5 guard: proformaIdUsed IS NOT NULL ────────────────────────────────
      // V5 containers have their own cancellation rules separate from legacy orders.
      if (order.proformaIdUsed) {
        // PENDING_VERIFICATION / VERIFIED / FINALIZED — hard block, no reversal yet
        if (["PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
          return res.status(400).json({
            message:
              "V5 containers at or beyond PENDING_VERIFICATION cannot be cancelled. Contact admin for a reversal workflow.",
          });
        }

        // LOADING — any authenticated user can cancel; bale links are cleaned up
        if (order.status === "LOADING") {
          const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

          // Archive bale links before deleting so the exact references survive and
          // can be restored verbatim when the order is un-cancelled.
          if (orderBales.length > 0) {
            await db.execute(
              sql`INSERT INTO customer_order_bales_history
                    (original_id, order_id, bale_id, bale_reference, location_id,
                     weight, article_code, bale_name, price_used, scanned_by)
                  SELECT id, order_id, bale_id, bale_reference, location_id,
                         weight, article_code, bale_name, price_used, scanned_by
                  FROM customer_order_bales
                  WHERE order_id = ${orderId}`
            );
          }

          for (const ob of orderBales) {
            await db
              .update(factoryBales)
              .set({ status: "IN_STOCK", updatedAt: new Date() })
              .where(eq(factoryBales.id, ob.baleId));
          }
          await db.delete(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

          // Reset order totals to zero now that all bale links are gone.
          // Without this call total_qty_bales would stay stale if the order is later restored.
          await recalculateOrderTotals(db, orderId);

          const [updated] = await db
            .update(customerOrders)
            .set({ status: "CANCELLED", updatedAt: new Date() })
            .where(eq(customerOrders.id, orderId))
            .returning();

          const [cancelCustomer] = await db
            .select({ legalName: customers.legalName })
            .from(customers)
            .where(eq(customers.id, order.customerId));
          const cancelToday = req.body.txDate || getClientDate(req);
          await db
            .delete(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
                eq(factoryDaybookEntries.referenceId, orderId)
              )
            );
          const cancelledBy = req.session?.username || "user";
          await writeDaybookEntry(db, {
            companyId,
            txDate: cancelToday,
            txType: "ORDER_CANCELLED",
            referenceId: orderId,
            description: `V5 container cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale link${orderBales.length !== 1 ? "s" : ""} removed. Cancelled by: ${cancelledBy}.`,
          });
          try {
            await logAudit({
              userId: req.session.userId!,
              username: req.session.username || req.session.userId!,
              companyId,
              action: "update",
              tableName: "factory_customer_orders",
              recordId: orderId,
              recordIdentifier:
                (
                  order as unknown as {
                    id: number;
                    companyId: number;
                    customerId: number;
                    invoiceNumber: string | null;
                    orderDate: string;
                    proformaIdUsed: number | null;
                    status: string;
                    subtotalBales: string;
                    freightAmount: string;
                    otherChargesTotal: string;
                    grandTotal: string;
                    totalQtyBales: number;
                    containerNumber: string | null;
                    shippingCompany: string | null;
                    containerNotes: string | null;
                    destination: string | null;
                    verifiedByUserId: number | null;
                    verifiedAt: Date | null;
                    loadingStartedAt: Date | null;
                    loadingFinalizedAt: Date | null;
                    finalizedAt: Date | null;
                    locationId: number | null;
                    dispatchBatchId: number | null;
                    isHidden: boolean;
                    deletedAt: Date | null;
                    createdAt: Date;
                    updatedAt: Date;
                  } & { orderNumber: string | null | undefined }
                ).orderNumber || `Order #${orderId}`,
              changes: { status: { old: order.status, new: "CANCELLED" } },
            });
          } catch (auditErr) {
            logger.error("[order cancel V5 audit] non-fatal:", { error: auditErr });
          }
          return res.json(updated);
        }

        // V5 DRAFT — no supervisor required; fall through to shared DRAFT path below
      }

      // ── Non-V5 path (fully unchanged) and V5 DRAFT (no supervisor) ──────────
      if (!["DRAFT", "LOADING"].includes(order.status)) {
        return res.status(400).json({ message: "Only DRAFT or LOADING orders can be cancelled" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      for (const ob of orderBales) {
        await db
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, ob.baleId));
      }

      const [updated] = await db
        .update(customerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      const [cancelCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, order.customerId));
      const cancelToday = req.body.txDate || getClientDate(req);
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          )
        );
      await writeDaybookEntry(db, {
        companyId,
        txDate: cancelToday,
        txType: "ORDER_CANCELLED",
        referenceId: orderId,
        description: `Order cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale${orderBales.length !== 1 ? "s" : ""} released`,
      });

      try {
        await logAudit({
          userId: req.session.userId!,
          username: req.session.username || req.session.userId!,
          companyId,
          action: "update",
          tableName: "factory_customer_orders",
          recordId: orderId,
          recordIdentifier:
            (
              order as unknown as {
                id: number;
                companyId: number;
                customerId: number;
                invoiceNumber: string | null;
                orderDate: string;
                proformaIdUsed: number | null;
                status: string;
                subtotalBales: string;
                freightAmount: string;
                otherChargesTotal: string;
                grandTotal: string;
                totalQtyBales: number;
                containerNumber: string | null;
                shippingCompany: string | null;
                containerNotes: string | null;
                destination: string | null;
                verifiedByUserId: number | null;
                verifiedAt: Date | null;
                loadingStartedAt: Date | null;
                loadingFinalizedAt: Date | null;
                finalizedAt: Date | null;
                locationId: number | null;
                dispatchBatchId: number | null;
                isHidden: boolean;
                deletedAt: Date | null;
                createdAt: Date;
                updatedAt: Date;
              } & { orderNumber: string | null | undefined }
            ).orderNumber || `Order #${orderId}`,
          changes: { status: { old: order.status, new: "CANCELLED" } },
        });
      } catch (auditErr) {
        logger.error("[order cancel audit] non-fatal:", { error: auditErr });
      }

      res.json(updated);
    } catch (error: unknown) {
      logger.error("Error cancelling order:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // Restore a recently-cancelled LOADING order back to LOADING status
  app.post("/api/factory/customer-orders/:id/restore-loading", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "CANCELLED")
        return res.status(400).json({ message: "Only CANCELLED orders can be restored" });
      if (!order.loadingStartedAt) return res.status(400).json({ message: "This order was not a loading order" });

      // Restore bales that belong to this order back to RESERVED_FOR_ORDER.
      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales remain IN_STOCK during loading — skip RESERVED_FOR_ORDER restore for V5 orders.
      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (!order.proformaIdUsed) {
        for (const ob of orderBales) {
          await db
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, ob.baleId), eq(factoryBales.status, "IN_STOCK")));
        }
      }

      const [restored] = await db
        .update(customerOrders)
        .set({ status: "LOADING", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      // Remove the ORDER_CANCELLED daybook entry
      await db
        .delete(factoryDaybookEntries)
        .where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            eq(factoryDaybookEntries.txType, "ORDER_CANCELLED"),
            eq(factoryDaybookEntries.referenceId, orderId)
          )
        );

      try {
        await logAudit({
          userId: req.session.userId!,
          username: req.session.username || req.session.userId!,
          companyId,
          action: "update",
          tableName: "factory_customer_orders",
          recordId: orderId,
          recordIdentifier:
            (
              order as unknown as {
                id: number;
                companyId: number;
                customerId: number;
                invoiceNumber: string | null;
                orderDate: string;
                proformaIdUsed: number | null;
                status: string;
                subtotalBales: string;
                freightAmount: string;
                otherChargesTotal: string;
                grandTotal: string;
                totalQtyBales: number;
                containerNumber: string | null;
                shippingCompany: string | null;
                containerNotes: string | null;
                destination: string | null;
                verifiedByUserId: number | null;
                verifiedAt: Date | null;
                loadingStartedAt: Date | null;
                loadingFinalizedAt: Date | null;
                finalizedAt: Date | null;
                locationId: number | null;
                dispatchBatchId: number | null;
                isHidden: boolean;
                deletedAt: Date | null;
                createdAt: Date;
                updatedAt: Date;
              } & { orderNumber: string | null | undefined }
            ).orderNumber || `Order #${orderId}`,
          changes: { status: { old: "CANCELLED", new: "LOADING" } },
        });
      } catch (auditErr) {
        logger.error("[order restore-loading audit] non-fatal:", { error: auditErr });
      }

      res.json(restored);
    } catch (error: unknown) {
      logger.error("Error restoring loading order:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ───────────────────────────────────────────────
  // CONTAINER LOADING WORKFLOW
  // ───────────────────────────────────────────────
}
