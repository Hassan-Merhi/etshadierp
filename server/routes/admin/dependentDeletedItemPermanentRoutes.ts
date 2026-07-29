import type { Express, NextFunction, Request, Response } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { requireAuth, requireNonPOS } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { customerOrders, factoryContainers, factoryMixBatches } from "@shared/schema";

const PERMANENT_DELETE_PATH = "/api/deleted-items/:type/:id/permanent";
const HANDLED_TYPES = new Set<string>(["factoryContainer", "factoryMixBatch", "customerOrder"]);

/**
 * Handles permanent deletion for records whose dependent tables are not fully
 * represented by the older Deleted Items route. Register this route before
 * registerDeletedItemsRoutes; unhandled types skip to the legacy route.
 */
export function registerDependentDeletedItemPermanentRoutes(app: Express): void {
  app.delete(
    PERMANENT_DELETE_PATH,
    (req: Request, _res: Response, next: NextFunction) => {
      if (!HANDLED_TYPES.has(req.params.type)) return next("route");
      return next();
    },
    requireAuth,
    requireNonPOS,
    async (req: Request, res: Response) => {
      const { type } = req.params;
      const itemId = Number.parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: "Invalid item ID" });
      }

      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      try {
        const deleted = await db.transaction(async (tx) => {
          if (type === "factoryContainer") {
            const [target] = await tx
              .select({ id: factoryContainers.id })
              .from(factoryContainers)
              .where(
                and(
                  eq(factoryContainers.id, itemId),
                  eq(factoryContainers.companyId, companyId),
                  isNotNull(factoryContainers.deletedAt)
                )
              )
              .limit(1);
            if (!target) return false;

            // July 2026 partial-offload receipts use ON DELETE RESTRICT and were
            // omitted by the legacy route, which made every affected container fail.
            await tx.execute(
              sql`DELETE FROM factory_container_receipts WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );

            // Tracking rows have no FK/cascade in older production schemas.
            await tx.execute(sql`DELETE FROM factory_container_tracking_events WHERE container_id = ${itemId}`);
            await tx.execute(sql`DELETE FROM factory_container_tracking_checks WHERE container_id = ${itemId}`);

            // Clear RESTRICT children before the raw-stock and container rows.
            await tx.execute(
              sql`DELETE FROM factory_waste_entries WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(
              sql`DELETE FROM factory_duty_audit_log WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(
              sql`DELETE FROM factory_fx_allocations WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(
              sql`DELETE FROM factory_container_commissions WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(sql`DELETE FROM factory_mix_batch_sources WHERE container_id = ${itemId}`);
            await tx.execute(
              sql`DELETE FROM factory_raw_stock WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );

            // Explicitly clear CASCADE children too so the route is safe on older
            // databases where those constraints were absent or mis-targeted.
            await tx.execute(
              sql`DELETE FROM factory_offload_additional_charges WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(
              sql`DELETE FROM factory_container_other_charges WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(
              sql`DELETE FROM factory_container_profit_snapshots WHERE container_id = ${itemId} AND company_id = ${companyId}`
            );

            const removed = await tx
              .delete(factoryContainers)
              .where(
                and(
                  eq(factoryContainers.id, itemId),
                  eq(factoryContainers.companyId, companyId),
                  isNotNull(factoryContainers.deletedAt)
                )
              )
              .returning({ id: factoryContainers.id });
            return removed.length === 1;
          }

          if (type === "factoryMixBatch") {
            const [target] = await tx
              .select({ id: factoryMixBatches.id })
              .from(factoryMixBatches)
              .where(
                and(
                  eq(factoryMixBatches.id, itemId),
                  eq(factoryMixBatches.companyId, companyId),
                  isNotNull(factoryMixBatches.deletedAt)
                )
              )
              .limit(1);
            if (!target) return false;

            // Remove the deleted batch's own source rows. Its soft-delete route has
            // already reversed their usedKg consumption.
            await tx.execute(sql`DELETE FROM factory_mix_batch_sources WHERE mix_batch_id = ${itemId}`);

            // Preserve downstream production/history rows while removing references
            // that can restrict the parent delete.
            await tx.execute(sql`
              UPDATE factory_mix_batch_sources
              SET source_batch_id = NULL,
                  source_id = CASE WHEN source_type = 'BATCH' THEN NULL ELSE source_id END
              WHERE source_batch_id = ${itemId}
                 OR (source_type = 'BATCH' AND source_id = ${itemId})
            `);
            await tx.execute(
              sql`DELETE FROM factory_daily_usages WHERE mix_batch_id = ${itemId} AND company_id = ${companyId}`
            );
            await tx.execute(sql`
              UPDATE factory_mix_batches
              SET carry_forward_from_id = NULL
              WHERE carry_forward_from_id = ${itemId} AND company_id = ${companyId}
            `);
            await tx.execute(sql`
              UPDATE factory_pressing_batches
              SET mix_batch_id = NULL
              WHERE mix_batch_id = ${itemId} AND company_id = ${companyId}
            `);
            await tx.execute(sql`
              UPDATE factory_bales
              SET mix_batch_id = NULL
              WHERE mix_batch_id = ${itemId} AND company_id = ${companyId}
            `);
            await tx.execute(sql`
              UPDATE factory_waste_entries
              SET mix_batch_id = NULL
              WHERE mix_batch_id = ${itemId} AND company_id = ${companyId}
            `);

            const removed = await tx
              .delete(factoryMixBatches)
              .where(
                and(
                  eq(factoryMixBatches.id, itemId),
                  eq(factoryMixBatches.companyId, companyId),
                  isNotNull(factoryMixBatches.deletedAt)
                )
              )
              .returning({ id: factoryMixBatches.id });
            return removed.length === 1;
          }

          const [target] = await tx
            .select({ id: customerOrders.id })
            .from(customerOrders)
            .where(
              and(
                eq(customerOrders.id, itemId),
                eq(customerOrders.companyId, companyId),
                isNotNull(customerOrders.deletedAt)
              )
            )
            .limit(1);
          if (!target) return false;

          // Loading sessions and their scans are retained without FK declarations in
          // some schemas, so remove them explicitly in child-first order.
          await tx.execute(
            sql`DELETE FROM factory_invoice_loading_bales WHERE invoice_id = ${itemId} AND company_id = ${companyId}`
          );
          await tx.execute(
            sql`DELETE FROM factory_invoice_loading_sessions WHERE invoice_id = ${itemId} AND company_id = ${companyId}`
          );

          // Shipping rows have an explicit ON DELETE RESTRICT FK to customer_orders.
          await tx.execute(sql`
            DELETE FROM factory_shipping_container_documents
            WHERE scr_id IN (
              SELECT id FROM factory_shipping_container_rows
              WHERE customer_order_id = ${itemId} AND company_id = ${companyId}
            )
          `);
          await tx.execute(sql`
            DELETE FROM factory_shipping_container_rows
            WHERE customer_order_id = ${itemId} AND company_id = ${companyId}
          `);

          // Clear every order-owned auxiliary/history table before the core rows.
          await tx.execute(sql`DELETE FROM customer_order_bale_removals WHERE order_id = ${itemId}`);
          await tx.execute(sql`DELETE FROM customer_order_expected_lines WHERE order_id = ${itemId}`);
          await tx.execute(sql`DELETE FROM customer_order_bales_history WHERE order_id = ${itemId}`);
          await tx.execute(sql`DELETE FROM customer_order_bales WHERE order_id = ${itemId}`);
          await tx.execute(sql`DELETE FROM customer_order_lines WHERE order_id = ${itemId}`);
          await tx.execute(sql`DELETE FROM customer_order_charges WHERE order_id = ${itemId}`);

          const removed = await tx
            .delete(customerOrders)
            .where(
              and(
                eq(customerOrders.id, itemId),
                eq(customerOrders.companyId, companyId),
                isNotNull(customerOrders.deletedAt)
              )
            )
            .returning({ id: customerOrders.id });
          return removed.length === 1;
        });

        if (!deleted) {
          return res.status(404).json({ message: `${type} not found in Deleted Items` });
        }

        return res.json({ message: `${type} permanently deleted` });
      } catch (error: unknown) {
        logger.error("Permanent deleted-item cleanup failed", {
          error,
          type,
          itemId,
          companyId,
        });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
