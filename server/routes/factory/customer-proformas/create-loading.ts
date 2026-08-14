/**
 * factoryCustomerProformaRoutes: FactoryCustomerProformaLoading endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { parseId } from "../../../lib/parseId";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { getClientDate } from "../../../lib/dateUtils";
import { syncProformaReservations } from "../_stockReservationHelper";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { writeDaybookEntry, recalculateOrderTotals } from "../_helpers";
import {
  factoryBaleProducts,
  factoryBales,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderBales,
  customers,
} from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { resultRows } from "../../../lib/queryResult";

export function registerFactoryCustomerProformaLoadingRoutes(app: Express) {
  // Create a pending loading from a proforma — auto-adds matching bales from stock
  app.post("/api/factory/customer-proformas/:id/create-loading", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const proformaId = parseId(req.params.id);

      if (proformaId === null) return res.status(400).json({ message: "Invalid id" });
      const { locationId, orderDate } = req.body;
      if (!locationId) return res.status(400).json({ message: "locationId is required" });

      // Fetch the proforma
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });
      if (!proforma.isActive)
        return res.status(400).json({ message: "Proforma is inactive — cannot create a loading from it" });

      // Fetch proforma lines
      const lines = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaId));
      if (lines.length === 0)
        return res.status(400).json({ message: "Proforma has no lines — add article codes first" });

      // ── Phase 4: compute how many bales are already in active/completed loadings for this proforma ──
      // alreadyLoaded = bales in any non-cancelled order tied to this proforma
      // (LOADING, PENDING_VERIFICATION, VERIFIED, FINALIZED) — FINALIZED bales are no longer IN_STOCK
      // so they won't be grabbed, but counting them ensures we don't exceed the proforma's total qty.
      const alreadyLoadedRaw = await db.execute(
        sql`SELECT fb.article_code as "articleCode", COUNT(*)::int as loaded
            FROM customer_order_bales cob
            JOIN factory_bales fb ON fb.id = cob.bale_id
            JOIN customer_orders co ON co.id = cob.order_id
            WHERE co.company_id = ${companyId}
              AND co.proforma_id_used = ${proformaId}
              AND co.deleted_at IS NULL
              AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED', 'FINALIZED')
            GROUP BY fb.article_code`
      );
      logger.info(`[create-loading] proformaId=${proformaId} companyId=${companyId}`);
      const alreadyLoadedMap = new Map<string, number>(
        (resultRows(alreadyLoadedRaw) || (alreadyLoadedRaw as unknown as any[])).map((r: any) => [
          r.articleCode,
          Number(r.loaded),
        ])
      );

      // ── Validate: check if there is any remaining reservation capacity ──
      const articleIssues: string[] = [];
      for (const line of lines) {
        if (!line.articleCode) continue;
        const lineQty = Number(line.quantity) || 0;
        const alreadyLoaded = alreadyLoadedMap.get(line.articleCode) || 0;
        const remaining = Math.max(0, lineQty - alreadyLoaded);
        logger.info(
          `[create-loading] line articleCode=${line.articleCode} lineId=${line.id} qty=${lineQty} alreadyLoaded=${alreadyLoaded} remaining=${remaining}`
        );
        if (remaining === 0) {
          articleIssues.push(`${line.articleCode}: proforma quantity (${lineQty}) already fully loaded`);
        }
      }
      // If ALL lines are exhausted, block creation
      const linesWithCapacity = lines.filter((l) => {
        if (!l.articleCode) return false;
        const lineQty = Number(l.quantity) || 0;
        const alreadyLoaded = alreadyLoadedMap.get(l.articleCode) || 0;
        return Math.max(0, lineQty - alreadyLoaded) > 0;
      });
      if (linesWithCapacity.length === 0) {
        return res.status(400).json({
          message:
            "All proforma lines are already fully loaded into active loading orders. No remaining reservation capacity.",
          details: articleIssues,
        });
      }

      // Pre-fetch product names for all article codes in this proforma
      const proformaArticleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const proformaProductNameMap = new Map<string, string>();
      if (proformaArticleCodes.length > 0) {
        const proformaProducts = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(
            and(
              eq(factoryBaleProducts.companyId, companyId),
              inArray(factoryBaleProducts.articleCode, proformaArticleCodes)
            )
          );
        for (const p of proformaProducts) {
          if (p.articleCode) proformaProductNameMap.set(p.articleCode, p.name);
        }
      }

      // Create the LOADING order
      const [order] = await db
        .insert(customerOrders)
        .values({
          companyId,
          customerId: proforma.customerId,
          proformaIdUsed: proformaId,
          locationId: parseInt(locationId),
          orderDate: orderDate || getClientDate(req),
          status: "LOADING",
          loadingStartedAt: new Date(),
        })
        .returning();

      let totalBalesAdded = 0;
      const insufficientStock: string[] = [];

      for (const line of lines) {
        if (!line.articleCode) continue;
        const lineQty = Number(line.quantity) || 0;
        if (lineQty <= 0) continue;

        // ── Phase 4 core: only take up to remainingToLoad, not the full proforma qty ──
        const alreadyLoaded = alreadyLoadedMap.get(line.articleCode) || 0;
        const remainingToLoad = Math.max(0, lineQty - alreadyLoaded);
        if (remainingToLoad === 0) continue; // fully loaded — skip silently

        // Find available IN_STOCK bales at this location for this article code
        const available = await db
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.status, "IN_STOCK"),
              eq(factoryBales.erpLocationId, parseInt(locationId)),
              eq(factoryBales.articleCode, line.articleCode)
            )
          )
          .orderBy(factoryBales.id)
          .limit(remainingToLoad); // ← only up to the remaining reserved quantity

        if (available.length === 0) {
          insufficientStock.push(`${line.articleCode}: 0 eligible bales in stock (need ${remainingToLoad})`);
          continue;
        }

        for (const bale of available) {
          const resolvedBaleName =
            proformaProductNameMap.get(bale.articleCode || "") || bale.productName || bale.articleCode || bale.baleCode;
          const linePricingMode = line.pricingMode ?? "per_bale";
          const linePerKg = parseFloat(String(line.pricePerKg ?? "0"));
          let resolvedPriceUsed: string;
          if (linePricingMode === "per_kg" && linePerKg > 0) {
            const baleWt = parseFloat(String(bale.weightKg || "0"));
            resolvedPriceUsed = (!isNaN(baleWt) ? baleWt * linePerKg : 0).toFixed(2);
          } else {
            resolvedPriceUsed = String(line.pricePerBale ?? "0");
          }
          await db.insert(customerOrderBales).values({
            orderId: order.id,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parseInt(locationId),
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: resolvedBaleName,
            priceUsed: resolvedPriceUsed,
          });
          // Transition bale: IN_STOCK → RESERVED_FOR_ORDER (physically in a loading order now)
          await db
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
          totalBalesAdded++;
        }
      }

      await recalculateOrderTotals(db, order.id);

      // Sync reservations — loading consumed some of the reservation, update the table
      // reservedQty per article = max(0, lineQty - totalLoaded across ALL active orders for this proforma)
      await syncProformaReservations(db, companyId, proformaId);

      const [loadingCustomer] = await db
        .select({ legalName: customers.legalName })
        .from(customers)
        .where(eq(customers.id, proforma.customerId));
      const insufficientNote = insufficientStock.length > 0 ? ` (${insufficientStock.join(", ")})` : "";
      await writeDaybookEntry(db, {
        companyId,
        txDate: orderDate || getClientDate(req),
        txType: "LOADING_CREATED",
        referenceId: order.id,
        referenceTable: "customer_orders",
        description: `Loading created from proforma "${proforma.name}" for ${loadingCustomer?.legalName || "customer"} — ${totalBalesAdded} bale(s) added${insufficientNote}`,
      });

      res.json({
        order,
        balesAdded: totalBalesAdded,
        ...(insufficientStock.length > 0 ? { warnings: insufficientStock } : {}),
      });
    } catch (error: unknown) {
      logger.error("Error creating loading from proforma:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
