/**
 * adminRepairRoutes: AdminOrphanedBale endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { db } from "../../../db";
import { requireAuth, requireRole } from "../../../auth";
import {} from "@shared/schema";
import { sql } from "drizzle-orm";
import { resultRows } from "../../../lib/queryResult";

export function registerAdminOrphanedBaleRoutes(app: Express) {
  app.post("/api/admin/fix-orphaned-bales", requireAuth, requireRole("Admin", "Owner"), async (_req, res) => {
    try {
      const result = await db.execute(sql`
        UPDATE factory_bales
        SET status = 'IN_STOCK', updated_at = NOW()
        WHERE status = 'RESERVED_FOR_ORDER'
          AND deleted_at IS NULL
          AND id NOT IN (
            SELECT cob.bale_id
            FROM customer_order_bales cob
            INNER JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.deleted_at IS NULL
              AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
          )
        RETURNING id
      `);
      const fixed = resultRows(result)?.length ?? 0;
      res.json({ fixed, message: fixed > 0 ? `Restored ${fixed} bale(s) to IN_STOCK` : "No orphaned bales found" });
    } catch (error: unknown) {
      logger.error("[BaleOrphanFix] Error:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ── Emergency: force-apply missing voucher column migrations ─────────────
  // Runs ALTER TABLE with no lock timeout so it waits as long as needed.
  // Safe to call multiple times — all statements use IF NOT EXISTS.
}
