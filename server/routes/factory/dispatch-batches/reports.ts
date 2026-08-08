/**
 * factoryDispatchBatchRoutes: DispatchReport endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { parseId } from "../../../lib/parseId";
import { sql } from "drizzle-orm";
import { getCompanyId } from "./_helpers";
import { firstRow, resultRows } from "../../../lib/queryResult";

export function registerDispatchReportRoutes(app: Express) {
  // ── GET /api/factory/dispatch-reports/summary ──────────────────────────────
  // Summary counts for the dispatch reports dashboard
  app.get("/api/factory/dispatch-reports/summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const summaryRes = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('INVOICED', 'CANCELLED'))           AS "uninvoicedCount",
          COUNT(*) FILTER (WHERE status = 'DISPATCHED')                             AS "dispatchedCount",
          COUNT(*) FILTER (WHERE status = 'INVOICED')                               AS "invoicedCount",
          COUNT(*) FILTER (WHERE status = 'LOADING')                                AS "loadingCount"
        FROM customer_dispatch_batches
        WHERE company_id = ${companyId}
      `);
      const s = firstRow<{
        uninvoicedCount: string | null;
        dispatchedCount: string | null;
        invoicedCount: string | null;
        loadingCount: string | null;
      }>(summaryRes);

      const reservedRes = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM customer_dispatch_bale_scans sc
        JOIN customer_dispatch_batches b ON b.id = sc.batch_id
        WHERE sc.company_id = ${companyId}
          AND sc.removed_at IS NULL
          AND b.status NOT IN ('INVOICED', 'CANCELLED')
      `);
      const reservedRow = firstRow<{ cnt: string | null }>(reservedRes);

      const ridesRes = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM customer_dispatch_truck_rides tr
        JOIN customer_dispatch_batches b ON b.id = tr.batch_id
        WHERE tr.company_id = ${companyId}
          AND tr.status = 'DISPATCHED'
          AND b.status NOT IN ('INVOICED', 'CANCELLED')
      `);
      const ridesRow = firstRow<{ cnt: string | null }>(ridesRes);

      res.json({
        uninvoicedCount: parseInt(s?.uninvoicedCount || "0"),
        dispatchedCount: parseInt(s?.dispatchedCount || "0"),
        invoicedCount: parseInt(s?.invoicedCount || "0"),
        loadingCount: parseInt(s?.loadingCount || "0"),
        reservedBalesCount: parseInt(reservedRow?.cnt || "0"),
        dispatchedRidesNotInvoiced: parseInt(ridesRow?.cnt || "0"),
      });
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });

  // ── GET /api/factory/dispatch-batches/:id/audit ───────────────────────────
  // Full scan history for a batch including removed scans
  app.get("/api/factory/dispatch-batches/:id/audit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      const rows = await db.execute(sql`
        SELECT
          sc.id,
          sc.truck_ride_id AS "truckRideId",
          tr.ride_number AS "rideNumber",
          sc.bale_id AS "baleId",
          sc.bale_reference AS "baleReference",
          sc.article_code AS "articleCode",
          sc.product_name AS "productName",
          sc.weight_kg AS "weightKg",
          sc.price_used AS "priceUsed",
          sc.amount,
          sc.scanned_by AS "scannedBy",
          sc.scanned_at AS "scannedAt",
          sc.removed_at AS "removedAt",
          sc.removal_reason AS "removalReason"
        FROM customer_dispatch_bale_scans sc
        LEFT JOIN customer_dispatch_truck_rides tr ON tr.id = sc.truck_ride_id
        WHERE sc.batch_id = ${batchId} AND sc.company_id = ${companyId}
        ORDER BY sc.scanned_at DESC
      `);

      res.json(resultRows(rows));
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
