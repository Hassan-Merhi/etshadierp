/**
 * factoryStockAllocationV5Routes: V5CancelledContainer endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import {} from "@shared/schema";
import { sql } from "drizzle-orm";
import { recalculateOrderTotals } from "../_helpers";
import { resultRows } from "../../../lib/queryResult";

export function registerV5CancelledContainerRoutes(app: Express) {
  // ── GET /api/factory/v5/recently-cancelled-containers ────────────────────
  // Returns V5 containers (proforma_id_used IS NOT NULL) that were cancelled
  // within the last 30 days. Used by the "Restore Cancelled Container" UI.
  // Read-only — does not modify any data.
  app.get("/api/factory/v5/recently-cancelled-containers", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const raw = await db.execute(
        sql`SELECT
              co.id,
              co.container_number      AS "containerNumber",
              co.status,
              co.customer_id           AS "customerId",
              co.updated_at            AS "cancelledAt",
              co.loading_started_at    AS "loadingStartedAt",
              co.proforma_id_used      AS "proformaId",
              c.legal_name             AS "customerName",
              cp.name                  AS "proformaName"
            FROM customer_orders co
            LEFT JOIN customers c    ON c.id  = co.customer_id
            LEFT JOIN customer_proformas cp ON cp.id = co.proforma_id_used
            WHERE co.company_id          = ${companyId}
              AND co.status              = 'CANCELLED'
              AND co.proforma_id_used    IS NOT NULL
              AND co.updated_at          >= NOW() - INTERVAL '30 days'
            ORDER BY co.updated_at DESC
            LIMIT 50`
      );

      const orders = resultRows(raw).map((r: any) => ({
        id: Number(r.id),
        containerNumber: r.containerNumber ?? `Order #${r.id}`,
        status: r.status,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName ?? "Unknown",
        cancelledAt: r.cancelledAt,
        wasLoading: !!r.loadingStartedAt,
        proformaId: r.proformaId ? Number(r.proformaId) : null,
        proformaName: r.proformaName ?? null,
      }));

      res.json({ orders });
    } catch (err: unknown) {
      logger.error("[V5] recently-cancelled-containers error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ── POST /api/factory/v5/containers/:id/restore ──────────────────────────
  // Restores a cancelled V5 container back to its previous status.
  // If it had loadingStartedAt set → restore to LOADING.
  // If it had no loadingStartedAt → restore to DRAFT.
  // Note: bale links that were deleted during cancellation are NOT restored
  // (bales are back in stock and can be re-scanned).
  app.post("/api/factory/v5/containers/:id/restore", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (!orderId || isNaN(orderId)) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db
        .execute(
          sql`SELECT id, status, proforma_id_used, loading_started_at
            FROM customer_orders
            WHERE id = ${orderId} AND company_id = ${companyId}`
        )
        .then((r: any) =>
          (r.rows ?? (r as any[])).map((row: any) => ({
            id: Number(row.id),
            status: row.status,
            proformaIdUsed: row.proforma_id_used,
            loadingStartedAt: row.loading_started_at,
          }))
        );

      if (!order) return res.status(404).json({ message: "Container not found" });
      if (order.status !== "CANCELLED")
        return res.status(400).json({ message: "Only CANCELLED containers can be restored" });
      if (!order.proformaIdUsed)
        return res.status(400).json({ message: "Only V5 containers (linked to a proforma) can be restored here" });

      const restoreStatus = order.loadingStartedAt ? "LOADING" : "DRAFT";

      await db.execute(
        sql`UPDATE customer_orders
            SET status = ${restoreStatus}, updated_at = NOW()
            WHERE id = ${orderId} AND company_id = ${companyId}`
      );

      // Remove the ORDER_CANCELLED daybook entry so financials are clean
      await db.execute(
        sql`DELETE FROM factory_daybook_entries
            WHERE company_id = ${companyId}
              AND tx_type = 'ORDER_CANCELLED'
              AND reference_id = ${orderId}`
      );

      // Restore the exact bale links that were archived when the order was cancelled.
      // If history rows exist (i.e. the order was cancelled after this feature landed),
      // copy them back into customer_order_bales so the scanner sees the original references.
      // For older orders cancelled before this feature, history is empty and the totals
      // are simply reset to 0 — those orders need Auto-Recover or manual recovery.
      const historyResult = await db.execute(
        sql`SELECT COUNT(*)::int AS cnt FROM customer_order_bales_history WHERE order_id = ${orderId}`
      );
      const historyCount = Number(resultRows(historyResult)[0]?.cnt ?? 0);

      if (historyCount > 0) {
        await db.execute(
          sql`INSERT INTO customer_order_bales
                (order_id, bale_id, bale_reference, location_id, weight,
                 article_code, bale_name, price_used, scanned_by)
              SELECT order_id, bale_id, bale_reference, location_id, weight,
                     article_code, bale_name, price_used, scanned_by
              FROM customer_order_bales_history
              WHERE order_id = ${orderId}`
        );
        await db.execute(sql`DELETE FROM customer_order_bales_history WHERE order_id = ${orderId}`);
      }

      // Rebuild order_lines and sync total_qty_bales from the live bale count.
      await recalculateOrderTotals(db, orderId);

      res.json({ id: orderId, restoredTo: restoreStatus, balasRestored: historyCount });
    } catch (err: unknown) {
      logger.error("[V5] restore-container error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
