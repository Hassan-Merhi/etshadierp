import type { Express, Request } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { parseId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import { sql, eq, and, desc, isNull, inArray } from "drizzle-orm";
import {
  customerDispatchBatches,
  customerDispatchBatchSequences,
  customerDispatchTruckRides,
  customerDispatchBaleScans,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerInvoiceSequences,
  customerBalances,
  factoryBales,
  customers,
} from "@shared/schema";

// ── helpers ──────────────────────────────────────────────────────────────────

function getCompanyId(req: any): number | null {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId || null;
}

function getUsername(req: any): string {
  return (req.session as any).username || (req.session as any).user?.username || "unknown";
}

async function isAdmin(req: any, companyId: number): Promise<boolean> {
  try {
    const userId = (req.session as any).userId;
    if (!userId) return false;
    const rows = await db.execute(
      sql`SELECT role FROM user_company_roles WHERE company_id = ${companyId} AND user_id = ${String(userId)} LIMIT 1`
    );
    const row = (rows as any).rows?.[0];
    return row?.role === "Admin";
  } catch {
    return false;
  }
}

// Recalculate and update the batch totals — not needed for batches themselves
// but we do need to update batch status to LOADING when first ride is created
async function ensureBatchStatus(tx: any, batchId: number, companyId: number, status: string) {
  await tx
    .update(customerDispatchBatches)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
}

// ── route registration ────────────────────────────────────────────────────────

export function registerDispatchBatchRoutes(app: Express) {
  // ── GET /api/factory/dispatch-batches ─────────────────────────────────────
  // List all batches for the company with optional filters
  app.get("/api/factory/dispatch-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { status, customerId } = req.query;

      const rows = await db.execute(sql`
        SELECT
          b.id,
          b.batch_number AS "batchNumber",
          b.batch_date AS "batchDate",
          b.status,
          b.currency,
          b.price_mode AS "priceMode",
          b.destination,
          b.notes,
          b.final_order_id AS "finalOrderId",
          b.created_by AS "createdBy",
          b.created_at AS "createdAt",
          b.updated_at AS "updatedAt",
          b.cancelled_at AS "cancelledAt",
          b.customer_id AS "customerId",
          b.proforma_id AS "proformaId",
          c.legal_name AS "customerName",
          p.name AS "proformaName",
          COUNT(DISTINCT tr.id) FILTER (WHERE tr.id IS NOT NULL) AS "rideCount",
          COUNT(DISTINCT sc.id) FILTER (WHERE sc.id IS NOT NULL AND sc.removed_at IS NULL) AS "baleCount",
          COALESCE(SUM(sc.weight_kg) FILTER (WHERE sc.removed_at IS NULL), 0) AS "totalWeightKg",
          COALESCE(SUM(sc.amount) FILTER (WHERE sc.removed_at IS NULL), 0) AS "totalAmount",
          co.invoice_number AS "invoiceNumber"
        FROM customer_dispatch_batches b
        LEFT JOIN customers c ON c.id = b.customer_id
        LEFT JOIN customer_proformas p ON p.id = b.proforma_id
        LEFT JOIN customer_dispatch_truck_rides tr ON tr.batch_id = b.id
        LEFT JOIN customer_dispatch_bale_scans sc ON sc.batch_id = b.id
        LEFT JOIN customer_orders co ON co.id = b.final_order_id
        WHERE b.company_id = ${companyId}
          ${status ? sql`AND b.status = ${status}` : sql``}
          ${customerId ? sql`AND b.customer_id = ${parseInt(customerId as string)}` : sql``}
        GROUP BY b.id, c.legal_name, p.name, co.invoice_number
        ORDER BY b.created_at DESC
      `);

      res.json((rows as any).rows || rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/factory/dispatch-batches ────────────────────────────────────
  // Create a new dispatch batch (optionally linked to a proforma)
  app.post("/api/factory/dispatch-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, proformaId, batchDate, destination, notes, currency, priceMode } = req.body;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });
      if (!batchDate) return res.status(400).json({ message: "batchDate is required" });

      const result = await db.transaction(async (tx: any) => {
        // Validate customer
        const [customer] = await tx
          .select({ id: customers.id, legalName: customers.legalName })
          .from(customers)
          .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
        if (!customer) throw new Error("Customer not found");

        // Validate proforma if supplied
        let proforma: any = null;
        let proformaLines: any[] = [];
        if (proformaId) {
          const [pf] = await tx
            .select()
            .from(customerProformas)
            .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
          if (!pf) throw new Error("Proforma not found");
          if (pf.customerId !== customerId) throw new Error("Proforma belongs to a different customer");
          if (!["ACTIVE", "PARTIALLY_DISPATCHED"].includes(pf.status))
            throw new Error(`Proforma status is ${pf.status} — cannot create dispatch batch`);
          proforma = pf;
          proformaLines = await tx
            .select()
            .from(customerProformaLines)
            .where(eq(customerProformaLines.proformaId, proformaId));
        }

        // Generate batch number
        let seqRows = await tx.execute(
          sql`SELECT next_number FROM customer_dispatch_batch_sequences WHERE company_id = ${companyId} FOR UPDATE`
        );
        let seqRow = (seqRows as any).rows?.[0];
        if (!seqRow) {
          await tx.execute(
            sql`INSERT INTO customer_dispatch_batch_sequences (company_id, next_number) VALUES (${companyId}, 1) ON CONFLICT (company_id) DO NOTHING`
          );
          seqRows = await tx.execute(
            sql`SELECT next_number FROM customer_dispatch_batch_sequences WHERE company_id = ${companyId} FOR UPDATE`
          );
          seqRow = (seqRows as any).rows?.[0];
        }
        const nextNum = seqRow.next_number || seqRow.nextNumber || 1;
        await tx.execute(
          sql`UPDATE customer_dispatch_batch_sequences SET next_number = ${nextNum + 1} WHERE company_id = ${companyId}`
        );
        const batchNumber = `DB-${String(nextNum).padStart(6, "0")}`;

        const [batch] = await tx
          .insert(customerDispatchBatches)
          .values({
            companyId,
            customerId,
            proformaId: proformaId || null,
            batchNumber,
            batchDate,
            status: "DRAFT",
            currency: currency || "USD",
            priceMode: priceMode || "PER_BALE",
            destination: destination || null,
            notes: notes || null,
            createdBy: getUsername(req),
          })
          .returning();

        return {
          batch,
          customerName: customer.legalName,
          proformaName: proforma?.name || null,
          proformaLines,
        };
      });

      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── GET /api/factory/dispatch-batches/:id ─────────────────────────────────
  // Full detail: batch + proforma summary + rides + bale counts
  app.get("/api/factory/dispatch-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      const [batch] = await db
        .select()
        .from(customerDispatchBatches)
        .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
      if (!batch) return res.status(404).json({ message: "Dispatch batch not found" });

      const [customer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, batch.customerId));

      // Proforma + lines
      let proforma: any = null;
      let proformaLines: any[] = [];
      if (batch.proformaId) {
        const [pf] = await db.select().from(customerProformas).where(eq(customerProformas.id, batch.proformaId));
        if (pf) {
          proforma = pf;
          proformaLines = await db
            .select()
            .from(customerProformaLines)
            .where(eq(customerProformaLines.proformaId, batch.proformaId));
        }
      }

      // Truck rides with bale counts
      const rides = await db.execute(sql`
        SELECT
          tr.id,
          tr.ride_number AS "rideNumber",
          tr.truck_plate AS "truckPlate",
          tr.driver_name AS "driverName",
          tr.destination,
          tr.notes,
          tr.status,
          tr.loaded_at AS "loadedAt",
          tr.dispatched_at AS "dispatchedAt",
          tr.reopened_at AS "reopenedAt",
          tr.reopen_reason AS "reopenReason",
          tr.created_by AS "createdBy",
          tr.created_at AS "createdAt",
          COUNT(sc.id) FILTER (WHERE sc.removed_at IS NULL) AS "baleCount",
          COALESCE(SUM(sc.weight_kg) FILTER (WHERE sc.removed_at IS NULL), 0) AS "totalWeightKg",
          COALESCE(SUM(sc.amount) FILTER (WHERE sc.removed_at IS NULL), 0) AS "totalAmount"
        FROM customer_dispatch_truck_rides tr
        LEFT JOIN customer_dispatch_bale_scans sc ON sc.truck_ride_id = tr.id
        WHERE tr.batch_id = ${batchId} AND tr.company_id = ${companyId}
        GROUP BY tr.id
        ORDER BY tr.ride_number ASC
      `);

      // Scanned totals per article (for proforma progress)
      const articleTotals = await db.execute(sql`
        SELECT
          article_code AS "articleCode",
          product_name AS "productName",
          COUNT(*) FILTER (WHERE removed_at IS NULL) AS "scannedQty",
          COALESCE(SUM(weight_kg) FILTER (WHERE removed_at IS NULL), 0) AS "scannedWeightKg",
          COALESCE(SUM(amount) FILTER (WHERE removed_at IS NULL), 0) AS "scannedAmount"
        FROM customer_dispatch_bale_scans
        WHERE batch_id = ${batchId} AND company_id = ${companyId}
        GROUP BY article_code, product_name
      `);

      // Final invoice link
      let finalInvoice: any = null;
      if (batch.finalOrderId) {
        const [inv] = await db
          .select({
            id: customerOrders.id,
            invoiceNumber: customerOrders.invoiceNumber,
            grandTotal: customerOrders.grandTotal,
          })
          .from(customerOrders)
          .where(eq(customerOrders.id, batch.finalOrderId));
        finalInvoice = inv || null;
      }

      res.json({
        batch,
        customerName: customer?.legalName || null,
        proforma,
        proformaLines,
        rides: (rides as any).rows || rides,
        articleTotals: (articleTotals as any).rows || articleTotals,
        finalInvoice,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PATCH /api/factory/dispatch-batches/:id ───────────────────────────────
  // Update batch notes / destination / date (only while not INVOICED)
  app.patch("/api/factory/dispatch-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      const [batch] = await db
        .select()
        .from(customerDispatchBatches)
        .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      if (batch.status === "INVOICED") return res.status(400).json({ message: "Cannot edit an invoiced batch" });
      if (batch.status === "CANCELLED") return res.status(400).json({ message: "Cannot edit a cancelled batch" });

      const { notes, destination, batchDate } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (notes !== undefined) updates.notes = notes;
      if (destination !== undefined) updates.destination = destination;
      if (batchDate !== undefined) updates.batchDate = batchDate;

      const [updated] = await db
        .update(customerDispatchBatches)
        .set(updates)
        .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── DELETE /api/factory/dispatch-batches/:id ──────────────────────────────
  // Cancel a batch (returns bales to IN_STOCK)
  app.delete("/api/factory/dispatch-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      await db.transaction(async (tx: any) => {
        const [batch] = await tx
          .select()
          .from(customerDispatchBatches)
          .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
        if (!batch) throw new Error("Batch not found");
        if (batch.status === "INVOICED") throw new Error("Cannot cancel an invoiced batch");
        if (batch.status === "CANCELLED") throw new Error("Batch already cancelled");

        // Return all reserved bales to IN_STOCK
        const activeBaleIds = await tx.execute(sql`
          SELECT bale_id FROM customer_dispatch_bale_scans
          WHERE batch_id = ${batchId} AND company_id = ${companyId} AND removed_at IS NULL
        `);
        const ids = ((activeBaleIds as any).rows || activeBaleIds).map((r: any) => r.bale_id);
        if (ids.length > 0) {
          await tx.execute(sql`
            UPDATE factory_bales SET status = 'IN_STOCK', updated_at = now()
            WHERE id = ANY(${ids}::int[]) AND status = 'RESERVED_FOR_DISPATCH'
          `);
        }

        // Cancel all rides
        await tx
          .update(customerDispatchTruckRides)
          .set({ status: "CANCELLED", updatedAt: new Date() })
          .where(
            and(eq(customerDispatchTruckRides.batchId, batchId), eq(customerDispatchTruckRides.companyId, companyId))
          );

        // Mark batch cancelled
        await tx
          .update(customerDispatchBatches)
          .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
          .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── POST /api/factory/dispatch-batches/:id/truck-rides ────────────────────
  // Add a new truck ride to a batch
  app.post("/api/factory/dispatch-batches/:id/truck-rides", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      const result = await db.transaction(async (tx: any) => {
        const [batch] = await tx
          .select()
          .from(customerDispatchBatches)
          .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
        if (!batch) throw new Error("Batch not found");
        if (batch.status === "INVOICED") throw new Error("Batch is already invoiced");
        if (batch.status === "CANCELLED") throw new Error("Batch is cancelled");

        // Get next ride number for this batch
        const countRows = await tx.execute(
          sql`SELECT COALESCE(MAX(ride_number), 0) + 1 AS next_num FROM customer_dispatch_truck_rides WHERE batch_id = ${batchId}`
        );
        const nextRideNum = (countRows as any).rows?.[0]?.next_num || 1;

        const { truckPlate, driverName, destination, notes } = req.body;

        const [ride] = await tx
          .insert(customerDispatchTruckRides)
          .values({
            companyId,
            batchId,
            rideNumber: parseInt(String(nextRideNum)),
            truckPlate: truckPlate || null,
            driverName: driverName || null,
            destination: destination || null,
            notes: notes || null,
            status: "DRAFT",
            createdBy: getUsername(req),
          })
          .returning();

        // Advance batch to LOADING if it was DRAFT
        if (batch.status === "DRAFT") {
          await tx
            .update(customerDispatchBatches)
            .set({ status: "LOADING", updatedAt: new Date() })
            .where(eq(customerDispatchBatches.id, batchId));
        }

        return ride;
      });

      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── PATCH /api/factory/dispatch-truck-rides/:id ───────────────────────────
  // Update ride info (plate, driver, notes)
  app.patch("/api/factory/dispatch-truck-rides/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rideId = parseId(req.params.id);
      if (rideId === null) return res.status(400).json({ message: "Invalid id" });

      const [ride] = await db
        .select()
        .from(customerDispatchTruckRides)
        .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)));
      if (!ride) return res.status(404).json({ message: "Ride not found" });
      if (ride.status === "DISPATCHED")
        return res.status(400).json({ message: "Cannot edit a dispatched ride. Reopen it first." });
      if (ride.status === "CANCELLED") return res.status(400).json({ message: "Ride is cancelled" });

      const { truckPlate, driverName, destination, notes } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (truckPlate !== undefined) updates.truckPlate = truckPlate;
      if (driverName !== undefined) updates.driverName = driverName;
      if (destination !== undefined) updates.destination = destination;
      if (notes !== undefined) updates.notes = notes;

      const [updated] = await db
        .update(customerDispatchTruckRides)
        .set(updates)
        .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/factory/dispatch-truck-rides/:id/scan-bale ──────────────────
  // Scan a bale barcode into a truck ride
  app.post("/api/factory/dispatch-truck-rides/:id/scan-bale", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rideId = parseId(req.params.id);
      if (rideId === null) return res.status(400).json({ message: "Invalid id" });

      const { barcode } = req.body;
      if (!barcode) return res.status(400).json({ message: "barcode is required" });

      const result = await db.transaction(async (tx: any) => {
        // 1. Validate ride
        const [ride] = await tx
          .select()
          .from(customerDispatchTruckRides)
          .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)));
        if (!ride) throw new Error("Truck ride not found");
        if (ride.status === "DISPATCHED")
          throw new Error("This truck ride is already dispatched. Reopen it before scanning.");
        if (ride.status === "CANCELLED") throw new Error("This truck ride is cancelled");

        // 2. Load batch (needed for proforma check)
        const [batch] = await tx
          .select()
          .from(customerDispatchBatches)
          .where(and(eq(customerDispatchBatches.id, ride.batchId), eq(customerDispatchBatches.companyId, companyId)));
        if (!batch) throw new Error("Dispatch batch not found");
        if (batch.status === "INVOICED") throw new Error("Batch already invoiced");
        if (batch.status === "CANCELLED") throw new Error("Batch is cancelled");

        // 3. Find bale by reference number
        const baleRows = await tx.execute(sql`
          SELECT id, reference_number AS "referenceNumber", article_code AS "articleCode",
                 product_name AS "productName", weight_kg AS "weightKg",
                 erp_location_id AS "erpLocationId", status
          FROM factory_bales
          WHERE reference_number = ${barcode.trim()} AND company_id = ${companyId}
          LIMIT 1
        `);
        const bale = ((baleRows as any).rows || baleRows)[0];
        if (!bale) throw new Error(`Bale "${barcode}" not found`);

        // 4. Bale must be IN_STOCK
        if (bale.status !== "IN_STOCK")
          throw new Error(`Bale ${barcode} is not available — current status: ${bale.status}`);

        // 5. Cross-batch duplicate check (partial unique index handles DB level too)
        const dupCheck = await tx.execute(sql`
          SELECT s.id, b.batch_number AS "batchNumber"
          FROM customer_dispatch_bale_scans s
          JOIN customer_dispatch_batches b ON b.id = s.batch_id
          WHERE s.company_id = ${companyId} AND s.bale_id = ${bale.id} AND s.removed_at IS NULL
          LIMIT 1
        `);
        const dupRow = ((dupCheck as any).rows || dupCheck)[0];
        if (dupRow) throw new Error(`Bale ${barcode} is already scanned in dispatch batch ${dupRow.batchNumber}`);

        // 6. Cross-order duplicate check (legacy loading system)
        const orderDupCheck = await tx.execute(sql`
          SELECT cob.order_id FROM customer_order_bales cob
          JOIN customer_orders co ON co.id = cob.order_id
          WHERE cob.bale_id = ${bale.id} AND co.status != 'CANCELLED'
          LIMIT 1
        `);
        const orderDupRow = ((orderDupCheck as any).rows || orderDupCheck)[0];
        if (orderDupRow) throw new Error(`Bale ${barcode} is already loaded on invoice order #${orderDupRow.order_id}`);

        // 7. Proforma article check — hard block if batch is linked to a proforma
        let priceUsed = "0";
        let overageWarning = false;
        let proformaQtyForArticle = 0;
        let scannedQtyForArticle = 0;

        if (batch.proformaId) {
          const proformaLines = await tx
            .select()
            .from(customerProformaLines)
            .where(eq(customerProformaLines.proformaId, batch.proformaId));

          const matchingLine = proformaLines.find((l: any) => l.articleCode === bale.articleCode);
          if (!matchingLine) {
            throw new Error(
              `Bale ${barcode} has article code "${bale.articleCode}" which is not in the linked proforma. Scan blocked.`
            );
          }

          priceUsed = String(matchingLine.pricePerBale);
          proformaQtyForArticle = matchingLine.quantity;

          // Check scanned quantity for this article so far in this batch
          const qtyRows = await tx.execute(sql`
            SELECT COUNT(*) AS cnt FROM customer_dispatch_bale_scans
            WHERE batch_id = ${batch.id} AND company_id = ${companyId}
              AND article_code = ${bale.articleCode} AND removed_at IS NULL
          `);
          scannedQtyForArticle = parseInt(((qtyRows as any).rows || qtyRows)[0]?.cnt || "0");
          if (scannedQtyForArticle >= proformaQtyForArticle) {
            overageWarning = true;
          }
        }

        // 8. Calculate amount (priceMode is on the batch, not the bale)
        const amount =
          batch.priceMode === "PER_KG"
            ? (parseFloat(priceUsed) * parseFloat(bale.weightKg || "0")).toFixed(2)
            : priceUsed;

        // 9. Reserve bale
        await tx.execute(sql`
          UPDATE factory_bales SET status = 'RESERVED_FOR_DISPATCH', updated_at = now()
          WHERE id = ${bale.id}
        `);

        // 10. Insert scan record
        const [scan] = await tx
          .insert(customerDispatchBaleScans)
          .values({
            companyId,
            batchId: batch.id,
            truckRideId: rideId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            articleCode: bale.articleCode || null,
            productName: bale.productName || null,
            weightKg: String(bale.weightKg || "0"),
            priceUsed,
            amount: String(amount),
            scannedBy: getUsername(req),
            scannedAt: new Date(),
          })
          .returning();

        // 11. Set ride to LOADING if it was DRAFT, stamp loadedAt
        if (ride.status === "DRAFT") {
          await tx
            .update(customerDispatchTruckRides)
            .set({ status: "LOADING", loadedAt: new Date(), updatedAt: new Date() })
            .where(eq(customerDispatchTruckRides.id, rideId));
        }

        return {
          scan,
          bale: {
            id: bale.id,
            referenceNumber: bale.referenceNumber,
            articleCode: bale.articleCode,
            productName: bale.productName,
            weightKg: bale.weightKg,
          },
          overageWarning,
          proformaQtyForArticle,
          scannedQtyForArticle: scannedQtyForArticle + 1,
          message: overageWarning
            ? `Bale scanned. WARNING: ${bale.articleCode} now exceeds proforma quantity (${proformaQtyForArticle}).`
            : "Bale scanned successfully.",
        };
      });

      res.status(201).json(result);
    } catch (err: any) {
      // Distinguish validation errors (400) from DB/system errors (500)
      const msg = err.message || "";
      const is400 =
        msg.includes("not found") ||
        msg.includes("not available") ||
        msg.includes("already") ||
        msg.includes("not in the linked") ||
        msg.includes("cancelled") ||
        msg.includes("dispatched") ||
        msg.includes("invoiced");
      res.status(is400 ? 400 : 500).json({ message: err.message });
    }
  });

  // ── DELETE /api/factory/dispatch-bale-scans/:id ───────────────────────────
  // Remove a bale scan (soft delete — marks removedAt, returns bale to IN_STOCK)
  app.delete("/api/factory/dispatch-bale-scans/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const scanId = parseId(req.params.id);
      if (scanId === null) return res.status(400).json({ message: "Invalid id" });

      const { reason } = req.body;

      await db.transaction(async (tx: any) => {
        const [scan] = await tx
          .select()
          .from(customerDispatchBaleScans)
          .where(and(eq(customerDispatchBaleScans.id, scanId), eq(customerDispatchBaleScans.companyId, companyId)));
        if (!scan) throw new Error("Scan not found");
        if (scan.removedAt) throw new Error("Scan already removed");

        // Check if ride is dispatched — if so, only admin can remove
        const [ride] = await tx
          .select()
          .from(customerDispatchTruckRides)
          .where(eq(customerDispatchTruckRides.id, scan.truckRideId));
        if (ride?.status === "DISPATCHED") {
          const admin = await isAdmin(req, companyId);
          if (!admin) throw new Error("Only admins can remove bales from a dispatched ride. Reopen the ride first.");
        }

        // Check batch not invoiced
        const [batch] = await tx
          .select()
          .from(customerDispatchBatches)
          .where(eq(customerDispatchBatches.id, scan.batchId));
        if (batch?.status === "INVOICED") throw new Error("Cannot remove bales from an invoiced batch");

        // Soft-delete the scan
        await tx
          .update(customerDispatchBaleScans)
          .set({ removedAt: new Date(), removalReason: reason || null })
          .where(eq(customerDispatchBaleScans.id, scanId));

        // Return bale to IN_STOCK
        await tx.execute(sql`
          UPDATE factory_bales SET status = 'IN_STOCK', updated_at = now()
          WHERE id = ${scan.baleId} AND status = 'RESERVED_FOR_DISPATCH'
        `);
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── POST /api/factory/dispatch-truck-rides/:id/dispatch ───────────────────
  // Mark a truck ride as DISPATCHED — locks bales for this ride
  app.post("/api/factory/dispatch-truck-rides/:id/dispatch", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rideId = parseId(req.params.id);
      if (rideId === null) return res.status(400).json({ message: "Invalid id" });

      const result = await db.transaction(async (tx: any) => {
        const [ride] = await tx
          .select()
          .from(customerDispatchTruckRides)
          .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)));
        if (!ride) throw new Error("Ride not found");
        if (ride.status === "DISPATCHED") throw new Error("Ride already dispatched");
        if (ride.status === "CANCELLED") throw new Error("Ride is cancelled");

        // Must have at least one active bale scan
        const countRows = await tx.execute(sql`
          SELECT COUNT(*) AS cnt FROM customer_dispatch_bale_scans
          WHERE truck_ride_id = ${rideId} AND company_id = ${companyId} AND removed_at IS NULL
        `);
        const cnt = parseInt(((countRows as any).rows || countRows)[0]?.cnt || "0");
        if (cnt === 0) throw new Error("Cannot dispatch a ride with no scanned bales");

        const [updated] = await tx
          .update(customerDispatchTruckRides)
          .set({ status: "DISPATCHED", dispatchedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)))
          .returning();

        return updated;
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── POST /api/factory/dispatch-truck-rides/:id/reopen ────────────────────
  // Admin only: reopen a DISPATCHED ride before invoice generation
  app.post("/api/factory/dispatch-truck-rides/:id/reopen", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const rideId = parseId(req.params.id);
      if (rideId === null) return res.status(400).json({ message: "Invalid id" });

      const admin = await isAdmin(req, companyId);
      if (!admin) return res.status(403).json({ message: "Only admins can reopen a dispatched ride" });

      const { reason } = req.body;
      if (!reason || !reason.trim())
        return res.status(400).json({ message: "reason is required to reopen a dispatched ride" });

      const result = await db.transaction(async (tx: any) => {
        const [ride] = await tx
          .select()
          .from(customerDispatchTruckRides)
          .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)));
        if (!ride) throw new Error("Ride not found");
        if (ride.status !== "DISPATCHED") throw new Error("Only DISPATCHED rides can be reopened");

        // Check batch not invoiced
        const [batch] = await tx
          .select()
          .from(customerDispatchBatches)
          .where(eq(customerDispatchBatches.id, ride.batchId));
        if (batch?.status === "INVOICED") throw new Error("Batch is already invoiced — cannot reopen a ride");

        const [updated] = await tx
          .update(customerDispatchTruckRides)
          .set({
            status: "LOADING",
            reopenedAt: new Date(),
            reopenReason: reason.trim(),
            dispatchedAt: null,
            updatedAt: new Date(),
          })
          .where(and(eq(customerDispatchTruckRides.id, rideId), eq(customerDispatchTruckRides.companyId, companyId)))
          .returning();

        return updated;
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── GET /api/factory/dispatch-batches/:id/invoice-preview ─────────────────
  // Preview the final invoice before generation — proforma-aware
  app.get("/api/factory/dispatch-batches/:id/invoice-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      const [batch] = await db
        .select()
        .from(customerDispatchBatches)
        .where(and(eq(customerDispatchBatches.id, batchId), eq(customerDispatchBatches.companyId, companyId)));
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      if (batch.status === "INVOICED") return res.status(400).json({ message: "Batch already invoiced" });
      if (batch.status === "CANCELLED") return res.status(400).json({ message: "Batch is cancelled" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, batch.customerId));

      // Proforma info
      let proforma: any = null;
      let proformaLines: any[] = [];
      if (batch.proformaId) {
        const rows = await db.select().from(customerProformas).where(eq(customerProformas.id, batch.proformaId));
        proforma = rows[0] || null;
        proformaLines = await db
          .select()
          .from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, batch.proformaId));
      }

      // Check for blocking conditions
      const allRides = await db
        .select()
        .from(customerDispatchTruckRides)
        .where(
          and(eq(customerDispatchTruckRides.batchId, batchId), eq(customerDispatchTruckRides.companyId, companyId))
        );

      const loadingRides = allRides.filter((r: any) => r.status === "LOADING" || r.status === "DRAFT");
      const dispatchedRides = allRides.filter((r: any) => r.status === "DISPATCHED");

      // Scanned bales grouped by article (active scans only)
      const articleSummary = await db.execute(sql`
        SELECT
          sc.article_code AS "articleCode",
          sc.product_name AS "productName",
          COUNT(*) AS "qty",
          COALESCE(SUM(sc.weight_kg), 0) AS "totalWeightKg",
          sc.price_used AS "pricePerBale",
          COALESCE(SUM(sc.amount), 0) AS "totalAmount"
        FROM customer_dispatch_bale_scans sc
        WHERE sc.batch_id = ${batchId} AND sc.company_id = ${companyId} AND sc.removed_at IS NULL
        GROUP BY sc.article_code, sc.product_name, sc.price_used
        ORDER BY sc.article_code
      `);
      const articleRows = (articleSummary as any).rows || articleSummary;

      // Total scans
      const totalRows = await db.execute(sql`
        SELECT
          COUNT(*) AS "totalBales",
          COALESCE(SUM(weight_kg), 0) AS "totalWeightKg",
          COALESCE(SUM(amount), 0) AS "grandTotal"
        FROM customer_dispatch_bale_scans
        WHERE batch_id = ${batchId} AND company_id = ${companyId} AND removed_at IS NULL
      `);
      const totals = ((totalRows as any).rows || totalRows)[0];

      // Mismatch warnings (bales with article codes not in the proforma)
      const mismatchRows = await db.execute(sql`
        SELECT DISTINCT sc.article_code AS "articleCode"
        FROM customer_dispatch_bale_scans sc
        WHERE sc.batch_id = ${batchId} AND sc.company_id = ${companyId} AND sc.removed_at IS NULL
          AND sc.article_code IS NOT NULL
          ${
            batch.proformaId
              ? sql`AND sc.article_code NOT IN (
                SELECT article_code FROM customer_proforma_lines WHERE proforma_id = ${batch.proformaId}
              )`
              : sql`AND 1=0`
          }
      `);
      const mismatches = ((mismatchRows as any).rows || mismatchRows).map((r: any) => r.articleCode);

      // Proforma progress per article
      const proformaProgress = proformaLines.map((pl: any) => {
        const scanned = articleRows.find((a: any) => a.articleCode === pl.articleCode);
        return {
          articleCode: pl.articleCode,
          productName: pl.productName,
          proformaQty: pl.quantity,
          proformaPrice: pl.pricePerBale,
          scannedQty: parseInt(scanned?.qty || "0"),
          remaining: pl.quantity - parseInt(scanned?.qty || "0"),
          totalAmount: scanned?.totalAmount || "0",
        };
      });

      // Ride summary
      const rideSummary = await db.execute(sql`
        SELECT
          tr.id,
          tr.ride_number AS "rideNumber",
          tr.truck_plate AS "truckPlate",
          tr.driver_name AS "driverName",
          tr.status,
          COUNT(sc.id) FILTER (WHERE sc.removed_at IS NULL) AS "baleCount",
          COALESCE(SUM(sc.weight_kg) FILTER (WHERE sc.removed_at IS NULL), 0) AS "totalWeightKg",
          COALESCE(SUM(sc.amount) FILTER (WHERE sc.removed_at IS NULL), 0) AS "totalAmount"
        FROM customer_dispatch_truck_rides tr
        LEFT JOIN customer_dispatch_bale_scans sc ON sc.truck_ride_id = tr.id
        WHERE tr.batch_id = ${batchId} AND tr.company_id = ${companyId}
        GROUP BY tr.id
        ORDER BY tr.ride_number
      `);

      res.json({
        batch,
        customer: { id: customer?.id, legalName: customer?.legalName },
        proforma,
        proformaProgress,
        rides: (rideSummary as any).rows || rideSummary,
        articleLines: articleRows,
        totals,
        loadingRides: loadingRides.length,
        dispatchedRides: dispatchedRides.length,
        totalRides: allRides.length,
        blockers:
          loadingRides.length > 0
            ? [
                `${loadingRides.length} truck ride(s) are still in LOADING status. All rides must be DISPATCHED before generating an invoice.`,
              ]
            : [],
        mismatchedArticles: mismatches,
        canGenerate: parseInt(totals?.totalBales || "0") > 0 && loadingRides.length === 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST /api/factory/dispatch-batches/:id/generate-invoice ───────────────
  // Generate one final invoice from all dispatched truck rides
  app.post("/api/factory/dispatch-batches/:id/generate-invoice", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = getCompanyId(req);
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const batchId = parseId(req.params.id);
      if (batchId === null) return res.status(400).json({ message: "Invalid id" });

      const { invoiceDate } = req.body;

      const result = await db.transaction(async (tx: any) => {
        // 1. Lock and validate batch
        const batchRows = await tx.execute(sql`
          SELECT * FROM customer_dispatch_batches
          WHERE id = ${batchId} AND company_id = ${companyId} FOR UPDATE
        `);
        const batch = ((batchRows as any).rows || batchRows)[0];
        if (!batch) throw new Error("Dispatch batch not found");
        if (batch.status === "INVOICED") throw new Error("Batch already invoiced");
        if (batch.status === "CANCELLED") throw new Error("Batch is cancelled");

        // 2. Check proforma status
        let proforma: any = null;
        let proformaLines: any[] = [];
        if (batch.proforma_id) {
          const pfRows = await tx.execute(
            sql`SELECT * FROM customer_proformas WHERE id = ${batch.proforma_id} FOR UPDATE`
          );
          proforma = ((pfRows as any).rows || pfRows)[0];
          if (!proforma) throw new Error("Linked proforma not found");
          if (proforma.status === "CANCELLED")
            throw new Error("Linked proforma is CANCELLED — cannot generate invoice");
          if (proforma.status === "FULLY_INVOICED")
            throw new Error("Linked proforma is FULLY_INVOICED — cannot generate another invoice");
          const plRows = await tx.execute(
            sql`SELECT * FROM customer_proforma_lines WHERE proforma_id = ${batch.proforma_id}`
          );
          proformaLines = (plRows as any).rows || plRows;
        }

        // 3. Check all rides are DISPATCHED
        const rideRows = await tx.execute(sql`
          SELECT id, status FROM customer_dispatch_truck_rides
          WHERE batch_id = ${batchId} AND company_id = ${companyId}
        `);
        const rides = (rideRows as any).rows || rideRows;
        const loadingRides = rides.filter((r: any) => r.status === "LOADING" || r.status === "DRAFT");
        if (loadingRides.length > 0)
          throw new Error(
            `${loadingRides.length} ride(s) are still in LOADING status. All rides must be DISPATCHED first.`
          );

        // 4. Load all active bale scans
        const scanRows = await tx.execute(sql`
          SELECT * FROM customer_dispatch_bale_scans
          WHERE batch_id = ${batchId} AND company_id = ${companyId} AND removed_at IS NULL
        `);
        const scans = (scanRows as any).rows || scanRows;
        if (scans.length === 0) throw new Error("No scanned bales found in this batch");

        // 5. Assign invoice number
        let seqRows = await tx.execute(sql`
          SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE
        `);
        let seqRow = ((seqRows as any).rows || seqRows)[0];
        if (!seqRow) {
          await tx.execute(
            sql`INSERT INTO customer_invoice_sequences (company_id, next_number) VALUES (${companyId}, 1) ON CONFLICT DO NOTHING`
          );
          seqRows = await tx.execute(
            sql`SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE`
          );
          seqRow = ((seqRows as any).rows || seqRows)[0];
        }
        const invoiceNum = seqRow.next_number || seqRow.nextNumber;
        await tx.execute(
          sql`UPDATE customer_invoice_sequences SET next_number = ${invoiceNum + 1} WHERE company_id = ${companyId}`
        );
        const invoiceNumber = `INV-${String(invoiceNum).padStart(6, "0")}`;

        // 6. Build grouped order lines by articleCode
        const lineMap = new Map<
          string,
          {
            articleCode: string;
            baleName: string;
            qty: number;
            totalWeight: number;
            pricePerBale: number;
            totalPrice: number;
          }
        >();
        for (const scan of scans) {
          const key = scan.article_code || "UNKNOWN";
          const existing = lineMap.get(key);
          const weight = parseFloat(scan.weight_kg || "0");
          const price = parseFloat(scan.price_used || "0");
          if (existing) {
            existing.qty += 1;
            existing.totalWeight += weight;
            existing.totalPrice += parseFloat(scan.amount || "0");
          } else {
            lineMap.set(key, {
              articleCode: key,
              baleName: scan.product_name || key,
              qty: 1,
              totalWeight: weight,
              pricePerBale: price,
              totalPrice: parseFloat(scan.amount || "0"),
            });
          }
        }
        const lines = Array.from(lineMap.values());

        const grandTotal = lines.reduce((sum, l) => sum + l.totalPrice, 0);
        const totalQtyBales = scans.length;
        const orderDate = invoiceDate || batch.batch_date || getClientDate(req as Request);

        // 7. Create customerOrders row (FINALIZED immediately)
        const orderRows = await tx.execute(sql`
          INSERT INTO customer_orders (
            company_id, customer_id, invoice_number, order_date, proforma_id_used,
            status, subtotal_bales, freight_amount, other_charges_total, grand_total,
            total_qty_bales, dispatch_batch_id, created_at, updated_at
          ) VALUES (
            ${companyId}, ${batch.customer_id}, ${invoiceNumber}, ${orderDate},
            ${batch.proforma_id || null},
            'FINALIZED',
            ${grandTotal.toFixed(2)}, '0', '0', ${grandTotal.toFixed(2)},
            ${totalQtyBales},
            ${batchId},
            now(), now()
          ) RETURNING *
        `);
        const order = ((orderRows as any).rows || orderRows)[0];
        const orderId = order.id;

        // 8. Insert customerOrderLines (grouped by article)
        for (const line of lines) {
          const avgWeight = line.totalWeight / line.qty;
          await tx.execute(sql`
            INSERT INTO customer_order_lines (order_id, article_code, bale_name, qty, weight_per_bale, total_weight, price_per_bale, total_price)
            VALUES (${orderId}, ${line.articleCode}, ${line.baleName}, ${line.qty}, ${avgWeight.toFixed(3)}, ${line.totalWeight.toFixed(3)}, ${line.pricePerBale.toFixed(2)}, ${line.totalPrice.toFixed(2)})
          `);
        }

        // 9. Insert customerOrderBales (individual bale rows)
        for (const scan of scans) {
          // Need erpLocationId from factoryBales for the customerOrderBales.location_id column
          const baleRow = await tx.execute(
            sql`SELECT erp_location_id FROM factory_bales WHERE id = ${scan.bale_id} LIMIT 1`
          );
          const baleData = ((baleRow as any).rows || baleRow)[0];
          const locationId = baleData?.erp_location_id;
          if (!locationId)
            throw new Error(`Bale ${scan.bale_reference} has no ERP location set — cannot create invoice line`);

          await tx.execute(sql`
            INSERT INTO customer_order_bales (order_id, bale_id, bale_reference, location_id, weight, article_code, bale_name, price_used, scanned_by)
            VALUES (${orderId}, ${scan.bale_id}, ${scan.bale_reference}, ${locationId}, ${scan.weight_kg}, ${scan.article_code}, ${scan.product_name}, ${scan.price_used}, ${scan.scanned_by})
          `);
        }

        // 10. Mark all scanned bales as SOLD
        const baleIds = scans.map((s: any) => s.bale_id);
        await tx.execute(sql`
          UPDATE factory_bales SET status = 'SOLD', updated_at = now()
          WHERE id = ANY(${baleIds}::int[])
        `);

        // 11. Post to customerBalances (one row = one invoice)
        await tx.execute(sql`
          INSERT INTO customer_balances (company_id, customer_id, transaction_date, transaction_type, reference_type, reference_id, debit_amount, credit_amount, balance, currency, description, created_at)
          VALUES (${companyId}, ${batch.customer_id}, ${orderDate}, 'SALE', 'INVOICE', ${orderId}, ${grandTotal.toFixed(2)}, '0', ${grandTotal.toFixed(2)}, ${batch.currency || "USD"}, ${"Invoice " + invoiceNumber}, now())
        `);

        // 12. Update batch: INVOICED + finalOrderId
        await tx.execute(sql`
          UPDATE customer_dispatch_batches
          SET status = 'INVOICED', final_order_id = ${orderId}, updated_at = now()
          WHERE id = ${batchId}
        `);

        // 13. Mark all rides COMPLETED
        await tx.execute(sql`
          UPDATE customer_dispatch_truck_rides
          SET status = 'COMPLETED', updated_at = now()
          WHERE batch_id = ${batchId} AND company_id = ${companyId}
        `);

        // 14. Update proforma status
        if (proforma && proformaLines.length > 0) {
          // Count total ever-invoiced bales per article across all finalized orders for this proforma
          const invoicedCountsRows = await tx.execute(sql`
            SELECT cob.article_code, COUNT(*) AS cnt
            FROM customer_order_bales cob
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.proforma_id_used = ${proforma.id}
              AND co.status = 'FINALIZED'
              AND co.company_id = ${companyId}
            GROUP BY cob.article_code
          `);
          const invoicedCounts: Record<string, number> = {};
          for (const r of (invoicedCountsRows as any).rows || invoicedCountsRows) {
            invoicedCounts[r.article_code] = parseInt(r.cnt || "0");
          }

          const allFulfilled = proformaLines.every((pl: any) => {
            const invoiced = invoicedCounts[pl.article_code] || 0;
            return invoiced >= pl.quantity;
          });
          const anyFulfilled = proformaLines.some((pl: any) => {
            const invoiced = invoicedCounts[pl.article_code] || 0;
            return invoiced > 0;
          });

          let newProformaStatus = proforma.status;
          let newIsActive = proforma.is_active;
          if (allFulfilled) {
            newProformaStatus = "FULLY_INVOICED";
            newIsActive = false;
          } else if (anyFulfilled) {
            newProformaStatus = "PARTIALLY_DISPATCHED";
          }

          await tx.execute(sql`
            UPDATE customer_proformas
            SET status = ${newProformaStatus}, is_active = ${newIsActive}, updated_at = now()
            WHERE id = ${proforma.id}
          `);
        }

        return {
          orderId,
          invoiceNumber,
          grandTotal: grandTotal.toFixed(2),
          totalBales: totalQtyBales,
          totalLines: lines.length,
        };
      });

      res.status(201).json({ ok: true, ...result });
    } catch (err: any) {
      const msg = err.message || "";
      const is400 =
        msg.includes("not found") ||
        msg.includes("already") ||
        msg.includes("cancelled") ||
        msg.includes("must be DISPATCHED") ||
        msg.includes("No scanned") ||
        msg.includes("LOADING status") ||
        msg.includes("FULLY_INVOICED") ||
        msg.includes("CANCELLED");
      res.status(is400 ? 400 : 500).json({ message: err.message });
    }
  });

  // ── GET /api/factory/bale-search ──────────────────────────────────────────
  // Search bale by reference number — returns status + dispatch/invoice info
  app.get("/api/factory/bale-search", requireAuth, async (req: any, res: any) => {
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
      const bale = ((baleRes as any).rows || baleRes)[0];

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
      const scan = ((scanRes as any).rows || scanRes)[0];

      if (!bale && !scan) {
        return res.status(404).json({ message: `Bale "${q}" not found` });
      }

      let status: string;
      if (scan?.batchStatus === "INVOICED") {
        status = "SOLD";
      } else if (scan) {
        status = "RESERVED_FOR_DISPATCH";
      } else {
        status = bale?.status || "IN_STOCK";
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
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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
      const s = ((summaryRes as any).rows || summaryRes)[0] || {};

      const reservedRes = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM customer_dispatch_bale_scans sc
        JOIN customer_dispatch_batches b ON b.id = sc.batch_id
        WHERE sc.company_id = ${companyId}
          AND sc.removed_at IS NULL
          AND b.status NOT IN ('INVOICED', 'CANCELLED')
      `);
      const reservedRow = ((reservedRes as any).rows || reservedRes)[0];

      const ridesRes = await db.execute(sql`
        SELECT COUNT(*) AS cnt
        FROM customer_dispatch_truck_rides tr
        JOIN customer_dispatch_batches b ON b.id = tr.batch_id
        WHERE tr.company_id = ${companyId}
          AND tr.status = 'DISPATCHED'
          AND b.status NOT IN ('INVOICED', 'CANCELLED')
      `);
      const ridesRow = ((ridesRes as any).rows || ridesRes)[0];

      res.json({
        uninvoicedCount: parseInt(s.uninvoicedCount || "0"),
        dispatchedCount: parseInt(s.dispatchedCount || "0"),
        invoicedCount: parseInt(s.invoicedCount || "0"),
        loadingCount: parseInt(s.loadingCount || "0"),
        reservedBalesCount: parseInt(reservedRow?.cnt || "0"),
        dispatchedRidesNotInvoiced: parseInt(ridesRow?.cnt || "0"),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

      res.json((rows as any).rows || rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
