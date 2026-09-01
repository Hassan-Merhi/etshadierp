/**
 * factoryDispatchBatchRoutes: DispatchBaleSearch endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { sql } from "drizzle-orm";
import {} from "@shared/schema";

import { getCompanyId } from "./_helpers";
import { resultRows } from "../../../lib/queryResult";

export function registerDispatchBaleSearchRoutes(app: Express) {
  // ── GET /api/factory/bale-search ──────────────────────────────────────────
  // Search bale by reference number — returns status + dispatch/invoice info
  app.get("/api/factory/bale-search", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const q = ((req.query.q as string) || "").trim();
      if (!q) return res.status(400).json({ message: "q parameter is required" });

      // 1. Find bale in factory_bales by reference_number
      const baleRes = await db.execute(sql`
        SELECT id, reference_number AS "referenceNumber", article_code AS "articleCode",
               product_name AS "productName", weight_kg AS "weightKg", status
        FROM factory_bales
        WHERE company_id = ${companyId} AND LOWER(reference_number) = LOWER(${q})
        LIMIT 1
      `);
      const bale = resultRows(baleRes)[0];

      // 2. Find active dispatch scan (removed_at IS NULL)
      const scanRes = await db.execute(sql`
        SELECT
          sc.id                          AS "scanId",
          sc.batch_id                    AS "batchId",
          sc.truck_ride_id               AS "truckRideId",
          sc.bale_reference              AS "baleReference",
          sc.article_code                AS "articleCode",
          sc.product_name                AS "productName",
          sc.weight_kg                   AS "weightKg",
          sc.amount,
          sc.scanned_at                  AS "scannedAt",
          b.batch_number                 AS "batchNumber",
          b.status                       AS "batchStatus",
          b.final_order_id               AS "finalOrderId",
          b.currency,
          b.customer_id                  AS "customerId",
          cu.legal_name                  AS "customerName",
          tr.ride_number                 AS "rideNumber",
          tr.truck_plate                 AS "truckPlate",
          tr.driver_name                 AS "driverName",
          tr.status                      AS "rideStatus",
          pf.name                        AS "proformaName",
          co.invoice_number              AS "invoiceNumber",
          co.id                          AS "orderId"
        FROM customer_dispatch_bale_scans sc
        JOIN customer_dispatch_batches b ON b.id = sc.batch_id AND b.company_id = ${companyId}
        LEFT JOIN customers cu ON cu.id = b.customer_id
        LEFT JOIN customer_dispatch_truck_rides tr ON tr.id = sc.truck_ride_id
        LEFT JOIN customer_proformas pf ON pf.id = b.proforma_id
        LEFT JOIN customer_orders co ON co.id = b.final_order_id
        WHERE sc.company_id = ${companyId}
          AND LOWER(sc.bale_reference) = LOWER(${q})
          AND sc.removed_at IS NULL
        ORDER BY sc.scanned_at DESC
        LIMIT 1
      `);
      const scan = resultRows(scanRes)[0];

      if (!bale && !scan) {
        return res.status(404).json({ message: `Bale "${q}" not found` });
      }

      let status: string;
      if (scan?.batchStatus === "INVOICED") {
        status = "SOLD";
      } else if (scan) {
        status = "RESERVED_FOR_DISPATCH";
      } else {
        status = String(bale?.status || "IN_STOCK");
      }

      res.json({
        bale: bale
          ? {
              referenceNumber: bale.referenceNumber,
              articleCode: bale.articleCode,
              productName: bale.productName,
              weightKg: bale.weightKg,
              status: bale.status,
            }
          : null,
        status,
        dispatch: scan
          ? {
              scanId: scan.scanId,
              batchId: scan.batchId,
              batchNumber: scan.batchNumber,
              batchStatus: scan.batchStatus,
              truckRideId: scan.truckRideId,
              rideNumber: scan.rideNumber,
              truckPlate: scan.truckPlate,
              driverName: scan.driverName,
              rideStatus: scan.rideStatus,
              customerId: scan.customerId,
              customerName: scan.customerName,
              proformaName: scan.proformaName,
              articleCode: scan.articleCode,
              productName: scan.productName,
              weightKg: scan.weightKg,
              amount: scan.amount,
              currency: scan.currency,
              scannedAt: scan.scannedAt,
              invoiceNumber: scan.invoiceNumber,
              orderId: scan.orderId,
            }
          : null,
      });
    } catch (err: unknown) {
      res.status(500).json({ message: getErrorMessage(err) });
    }
  });
}
