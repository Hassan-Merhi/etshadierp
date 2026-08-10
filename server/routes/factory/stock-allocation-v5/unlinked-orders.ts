/**
 * factoryStockAllocationV5Routes: V5UnlinkedLoadingOrder endpoints.
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

export function registerV5UnlinkedLoadingOrderRoutes(app: Express) {
  // ── GET /api/factory/v5/unlinked-loading-orders ───────────────────────────
  // Returns LOADING customer_orders that have proforma_id_used IS NULL.
  // Used by the "Link Existing Container" UI in Stock Allocation V5.
  // Read-only — does not modify any data.
  app.get("/api/factory/v5/unlinked-loading-orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const raw = await db.execute(
        sql`SELECT
              co.id,
              co.container_number  AS "containerNumber",
              co.status,
              co.customer_id       AS "customerId",
              co.created_at        AS "createdAt",
              c.legal_name         AS "customerName",
              COUNT(cob.id)::int   AS "loadedBaleCount"
            FROM customer_orders co
            LEFT JOIN customers c ON c.id = co.customer_id
            LEFT JOIN customer_order_bales cob ON cob.order_id = co.id
            WHERE co.company_id      = ${companyId}
              AND co.status          = 'LOADING'
              AND co.proforma_id_used IS NULL
            GROUP BY co.id, co.container_number, co.status, co.customer_id, co.created_at, c.legal_name
            ORDER BY co.created_at DESC`
      );

      const orders = raw.rows.map((r) => ({
        id: Number(r.id),
        containerNumber: r.containerNumber ?? `Order #${r.id}`,
        status: r.status,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName ?? "Unknown",
        createdAt: r.createdAt,
        loadedBaleCount: Number(r.loadedBaleCount ?? 0),
      }));

      res.json({ orders });
    } catch (err: unknown) {
      logger.error("[V5] unlinked-loading-orders error:", { error: err });
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
