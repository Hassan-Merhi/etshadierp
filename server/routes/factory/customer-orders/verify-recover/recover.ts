/**
 * orderVerifyRecoverRoutes: OrderRecoverBales endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { parseId } from "../../../../lib/parseId";
import { logger } from "../../../../lib/logger";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { recalculateOrderTotals } from "../../_helpers";
import { factoryBales, customerProformaLines, customerOrders, customerOrderBales } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { resultRows } from "../../../../lib/queryResult";

export function registerOrderRecoverBalesRoutes(app: Express) {
  // ── Admin: recover missing customer_order_bales rows from factory_bales ──────
  // This endpoint reconstructs the customer_order_bales link table for orders
  // where bale scans were attempted but the inserts failed (e.g. because the
  // newer columns didn't yet exist in the production DB). It finds factory_bales
  // that are currently SOLD or RESERVED_FOR_ORDER and are NOT already linked to
  // any active customer_order_bales row, then lets an admin link them to this
  // order by providing a list of bale reference numbers.
  // Only Admin / Owner / Developer roles may call this.
  // SQL diagnostic to check state before calling:
  //   SELECT fb.id, fb.reference_number, fb.article_code, fb.status, fb.weight_kg
  //     FROM factory_bales fb
  //    WHERE fb.company_id = <companyId>
  //      AND fb.status IN ('SOLD', 'RESERVED_FOR_ORDER')
  //      AND NOT EXISTS (
  //            SELECT 1 FROM customer_order_bales cob WHERE cob.bale_id = fb.id
  //          )
  //    ORDER BY fb.updated_at DESC;
  app.post("/api/factory/customer-orders/:id/recover-bales", requireAuth, async (req: Request, res: Response) => {
    try {
      const session = req.session;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (!["admin", "owner", "developer"].includes(role)) {
        return res.status(403).json({ message: "Only Admin / Owner can recover bales" });
      }

      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid order id" });

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Allow recovery for any active (non-CANCELLED) order that has 0 linked bales
      if (!["LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({
          message: "Recovery is only available for LOADING, PENDING_VERIFICATION, VERIFIED, or FINALIZED orders",
        });
      }

      const existingBaleCount = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM customer_order_bales WHERE order_id = ${orderId}`
      );
      const existingCount = Number((resultRows(existingBaleCount) ?? [{ count: 0 }])[0]?.count ?? 0);
      if (existingCount > 0) {
        return res.status(400).json({
          message: `Order already has ${existingCount} bale(s) linked. Recovery is only for orders with 0 linked bales.`,
        });
      }

      const { baleReferences }: { baleReferences: string[] } = req.body;
      if (!Array.isArray(baleReferences) || baleReferences.length === 0) {
        return res.status(400).json({ message: "baleReferences array is required and must not be empty" });
      }

      // Look up proforma prices once
      const proformaPriceMap: Record<string, string> = {};
      if (order.proformaIdUsed) {
        const pfLines = await db
          .select()
          .from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
        for (const pl of pfLines) {
          proformaPriceMap[pl.articleCode] = pl.pricePerBale;
        }
      }

      let linked = 0;
      const notFound: string[] = [];

      for (const ref of baleReferences) {
        const refClean = ref.trim();
        if (!refClean) continue;

        // Find the bale — accept SOLD, RESERVED_FOR_ORDER, or even IN_STOCK (admin override)
        const [bale] = await db
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              or(
                sql`LOWER(${factoryBales.referenceNumber}) = ${refClean.toLowerCase()}`,
                sql`LOWER(${factoryBales.baleCode}) = ${refClean.toLowerCase()}`
              )
            )
          )
          .orderBy(factoryBales.id)
          .limit(1);

        if (!bale) {
          notFound.push(refClean);
          continue;
        }

        // Skip if already in ANY customer_order_bales row
        const [dup] = await db
          .select({ id: customerOrderBales.id })
          .from(customerOrderBales)
          .where(eq(customerOrderBales.baleId, bale.id));
        if (dup) {
          notFound.push(`${refClean} (already linked to order)`);
          continue;
        }

        const priceUsed = proformaPriceMap[bale.articleCode || ""] || bale.costPerKg || "0";

        // Get or infer location
        const locationId = bale.erpLocationId ?? null;

        await db.insert(customerOrderBales).values({
          orderId,
          baleId: bale.id,
          baleReference: bale.referenceNumber,
          locationId: locationId ?? 1,
          weight: bale.weightKg,
          articleCode: bale.articleCode,
          baleName: bale.productName || bale.articleCode || bale.baleCode,
          priceUsed,
        });

        // Ensure bale status reflects the order stage
        const targetStatus = ["VERIFIED", "FINALIZED"].includes(order.status) ? "SOLD" : "SOLD";
        if (bale.status !== targetStatus) {
          await db
            .update(factoryBales)
            .set({ status: targetStatus, updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
        }

        linked++;
      }

      await recalculateOrderTotals(db, orderId);

      logger.info(`[recover-bales] orderId=${orderId} linked=${linked} notFound=${notFound.length}`);

      res.json({
        message: `${linked} bale(s) linked successfully`,
        linked,
        notFound,
      });
    } catch (error: unknown) {
      logger.error("Error recovering bales:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ── Auto-recover bales from stock by article code ────────────────────────────
  // Finds factory_bales that match the proforma article codes for this order,
  // are IN_STOCK or SOLD, not already linked to any other active order,
  // and auto-links up to the proforma quantity of each article.
  // Requires Admin / Owner. Order must have a proformaIdUsed and 0 existing bales.
  app.post("/api/factory/customer-orders/:id/auto-recover-bales", requireAuth, async (req: Request, res: Response) => {
    try {
      const session = req.session;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (!["admin", "owner", "developer"].includes(role)) {
        return res.status(403).json({ message: "Only Admin / Owner can auto-recover bales" });
      }

      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid order id" });

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      if (!order.proformaIdUsed) {
        return res.status(400).json({ message: "Auto-recover requires a proforma to be linked on this order" });
      }

      const existingResult = await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM customer_order_bales WHERE order_id = ${orderId}`
      );
      const existingCount = Number((resultRows(existingResult) ?? [{ count: 0 }])[0]?.count ?? 0);
      if (existingCount > 0) {
        return res.status(400).json({
          message: `Order already has ${existingCount} bale(s) linked. Use manual Recover Bales for partial recovery.`,
        });
      }

      const proformaLines = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
      if (proformaLines.length === 0) {
        return res.status(400).json({ message: "No proforma lines found for this order's proforma" });
      }

      // Build set of bale IDs already claimed by other active orders (for this company)
      const claimedResult = await db.execute(
        sql`SELECT cob.bale_id FROM customer_order_bales cob
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.status != 'CANCELLED'
              AND cob.order_id != ${orderId}`
      );
      const claimedIds = new Set<number>(resultRows(claimedResult).map((r) => Number(r.bale_id)));

      const scannerName: string | null = session.username || session.name || session.email || null;
      let totalLinked = 0;
      const summary: { articleCode: string; linked: number; needed: number }[] = [];

      for (const pl of proformaLines) {
        const articleCode = pl.articleCode;
        const needed = pl.quantity || 0;
        if (!articleCode || needed <= 0) continue;

        const candidatesResult = await db.execute(
          sql`SELECT id, reference_number, weight_kg, erp_location_id, product_name, article_code, bale_code
              FROM factory_bales
              WHERE company_id = ${companyId}
                AND article_code = ${articleCode}
                AND status IN ('IN_STOCK', 'SOLD', 'RESERVED_FOR_ORDER')
                AND deleted_at IS NULL
              ORDER BY id
              LIMIT ${needed * 3}`
        );
        const candidates: unknown[] = resultRows(candidatesResult);
        const available = candidates.filter((b) => !claimedIds.has(Number(b.id))).slice(0, needed);

        for (const bale of available) {
          await db.insert(customerOrderBales).values({
            orderId,
            baleId: Number(bale.id),
            baleReference: bale.reference_number,
            locationId: bale.erp_location_id ?? 1,
            weight: bale.weight_kg,
            articleCode,
            baleName: bale.product_name || articleCode,
            priceUsed: pl.pricePerBale,
            scannedBy: scannerName,
          });
          claimedIds.add(Number(bale.id));
          totalLinked++;
        }

        summary.push({ articleCode, linked: available.length, needed });
      }

      await recalculateOrderTotals(db, orderId);

      logger.info(`[auto-recover-bales] orderId=${orderId} totalLinked=${totalLinked}`);
      res.json({ message: `${totalLinked} bale(s) auto-linked from stock`, linked: totalLinked, summary });
    } catch (error: unknown) {
      logger.error("Error auto-recovering bales:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
