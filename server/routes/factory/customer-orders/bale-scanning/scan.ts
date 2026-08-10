/**
 * baleScanningRoutes: OrderBaleScan endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { EXPECTED_CLIENT_RESPONSE_CODES, markExpectedClientResponse } from "../../../../lib/expectedClientResponse";
import { parseId } from "../../../../lib/parseId";
import { db } from "../../../../db";
import { requireAuth } from "../../../../auth";
import { recalculateOrderTotalsForScannedArticle, type ScannedArticleTotalsPatch } from "./incrementalTotals";
import {
  factoryBaleProducts,
  factoryBales,
  customerProformaLines,
  customerOrders,
  customerOrderBales,
} from "@shared/schema";
import { eq, and, or, sql, inArray, ilike } from "drizzle-orm";
import { firstRow } from "../../../../lib/queryResult";

export function registerOrderBaleScanRoutes(app: Express) {
  app.post("/api/factory/customer-orders/:id/bales", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { scanCode, locationId } = req.body;
      if (!scanCode || !locationId) return res.status(400).json({ message: "scanCode and locationId are required" });
      const scannerName: string | null =
        (req.session as any)?.username || (req.session as any)?.name || (req.session as any)?.email || null;

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status))
        return res
          .status(400)
          .json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });

      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales are SOLD once the order reaches PENDING_VERIFICATION — no further scanning allowed.
      // Legacy V2/V3 behavior (PENDING_VERIFICATION scan allowed) is unchanged.
      if (order.proformaIdUsed && order.status === "PENDING_VERIFICATION") {
        return res
          .status(400)
          .json({ message: "Cannot add bales to a V5 order that is already in PENDING_VERIFICATION" });
      }

      // Check if this scan code matches a bale already reserved (status = RESERVED_FOR_ORDER).
      // Only match by unique bale identifiers (referenceNumber, baleCode) — NOT by articleCode or
      // productName, which are shared across many bales and would falsely block scanning the next
      // available bale of the same product type.
      const scanLower = scanCode.toLowerCase();
      const [reservedBale] = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "RESERVED_FOR_ORDER"),
            or(
              sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
              sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`
            )
          )
        );

      if (reservedBale) {
        const [inThisOrder] = await db
          .select()
          .from(customerOrderBales)
          .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, reservedBale.id)));
        if (inThisOrder) {
          return res
            .status(400)
            .json({ message: `${reservedBale.referenceNumber || scanCode} is already loaded in this order` });
        }
        return res
          .status(400)
          .json({ message: `Bale ${reservedBale.referenceNumber || scanCode} is reserved for another loading order` });
      }

      // Also look up product IDs whose current name or articleCode matches the scan code
      const matchingProductsByName = await db
        .select({ id: factoryBaleProducts.id })
        .from(factoryBaleProducts)
        .where(
          and(
            eq(factoryBaleProducts.companyId, companyId),
            or(
              sql`LOWER(${factoryBaleProducts.name}) = ${scanLower}`,
              ilike(factoryBaleProducts.name, `%${scanCode.trim()}%`),
              sql`LOWER(${factoryBaleProducts.articleCode}) = ${scanLower}`,
              ilike(factoryBaleProducts.articleCode, `%${scanCode.trim()}%`)
            )
          )
        );
      const matchingProductIds = matchingProductsByName.map((p) => p.id);

      const nameConditions =
        matchingProductIds.length > 0
          ? or(
              sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
              sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
              sql`LOWER(${factoryBales.articleCode}) = ${scanLower}`,
              sql`LOWER(${factoryBales.productName}) = ${scanLower}`,
              inArray(factoryBales.productId, matchingProductIds)
            )
          : or(
              sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
              sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`,
              sql`LOWER(${factoryBales.articleCode}) = ${scanLower}`,
              sql`LOWER(${factoryBales.productName}) = ${scanLower}`
            );

      // Pick the bale + verify it's not already in this order + (V5) check no
      // other active order has it + insert the join row + flip status — all
      // inside one transaction with SELECT FOR UPDATE so two concurrent scans
      // of the same article cannot both claim the same physical bale.
      // Errors with `httpStatus` and `body` are returned from the transaction
      // and translated back to res.status(...).json(...) below.
      type PickResult =
        | {
            ok: true;
            // Both come straight from the writes below, so they are described by
            // the row that was inserted and by the recalculation's own return
            // type rather than restated here.
            bale: typeof customerOrderBales.$inferSelect;
            line: ScannedArticleTotalsPatch["line"];
            totals: ScannedArticleTotalsPatch["totals"];
          }
        | { ok: false; httpStatus: number; body: any };

      const result: PickResult = await db.transaction(async (tx: any) => {
        const [bale] = await tx
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.status, "IN_STOCK"),
              eq(factoryBales.erpLocationId, parseInt(locationId)),
              nameConditions
            )
          )
          .orderBy(factoryBales.id)
          .limit(1)
          .for("update");

        if (!bale) {
          return {
            ok: false,
            httpStatus: 404,
            body: { message: "Bale not found, not at this location, or not available for sale" },
          };
        }

        const [alreadyAdded] = await tx
          .select()
          .from(customerOrderBales)
          .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, bale.id)));
        if (alreadyAdded) {
          return { ok: false, httpStatus: 400, body: { message: "Bale already added to this order" } };
        }

        // Universal cross-order duplicate check: block if this bale is already in any other
        // active (non-CANCELLED) order. This covers both V5 orders (bales stay IN_STOCK so the
        // RESERVED_FOR_ORDER status check above cannot catch them) and non-V5 mixed scenarios
        // where a V5 order's IN_STOCK bale could otherwise slip through onto a non-V5 order.
        const crossOrderDupCheck = await tx.execute(
          sql`SELECT cob.order_id, co.status, co.invoice_number FROM customer_order_bales cob
              JOIN customer_orders co ON co.id = cob.order_id
              WHERE cob.bale_id = ${bale.id}
                AND co.status != 'CANCELLED'
                AND cob.order_id != ${orderId}
              LIMIT 1`
        );
        const crossOrderDupRow = firstRow(crossOrderDupCheck);
        if (crossOrderDupRow) {
          const orderRef = crossOrderDupRow.invoice_number
            ? `invoice ${crossOrderDupRow.invoice_number}`
            : `loading #${crossOrderDupRow.order_id}`;
          return {
            ok: false,
            httpStatus: 400,
            body: {
              message: `Bale ${bale.referenceNumber || scanCode} is already in ${orderRef} (${crossOrderDupRow.status}). Remove it from that order first.`,
            },
          };
        }

        // Resolve the product record first so its articleCode can be used as a
        // fallback when bale.articleCode is null. Bales pressed before the
        // articleCode column was added (or imported without it) can otherwise
        // bypass the proforma overload check entirely.
        let productForBale = null;
        if (bale.productId) {
          const [p] = await tx.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.id, bale.productId));
          productForBale = p || null;
        }

        // Effective article code: prefer the bale's own field, fall back to the
        // product master's articleCode so the proforma check is consistent.
        const effectiveArticleCode: string = bale.articleCode || productForBale?.articleCode || "";

        let priceUsed = "0";
        if (productForBale?.sellingPrice) priceUsed = productForBale.sellingPrice;

        if (order.proformaIdUsed) {
          const [pl] = await tx
            .select()
            .from(customerProformaLines)
            .where(
              and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed),
                eq(customerProformaLines.articleCode, effectiveArticleCode)
              )
            );
          const proformaLine = pl || null;
          if (proformaLine) {
            const pricingMode = (proformaLine as any).pricingMode ?? "per_bale";
            const perKgVal = (proformaLine as any).pricePerKg;
            if (pricingMode === "per_kg" && perKgVal) {
              const weightKg = parseFloat(String(bale.weightKg || "0"));
              const pkgRate = parseFloat(String(perKgVal));
              priceUsed = !isNaN(weightKg) && !isNaN(pkgRate) ? (weightKg * pkgRate).toFixed(2) : "0";
            } else {
              priceUsed = proformaLine.pricePerBale;
            }
            // Overload check: count existing bales of this article in the order.
            // Use effectiveArticleCode (not bale.articleCode) so bales that were
            // stored without an articleCode are still counted correctly via the
            // product master's code.
            if (!req.body.allowBypassOverload) {
              const [countResult] = await tx
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(customerOrderBales)
                .where(
                  and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.articleCode, effectiveArticleCode))
                );
              const currentCount = countResult?.count || 0;
              if (currentCount >= proformaLine.quantity) {
                return {
                  ok: false,
                  httpStatus: 400,
                  body: {
                    confirmationRequired: true,
                    confirmationType: "overload",
                    overloaded: true,
                    message: `Quantity exceeded (${currentCount}/${proformaLine.quantity}). Scan again to bypass.`,
                  },
                };
              }
            }
          } else if (!req.body.allowBypassProforma) {
            return {
              ok: false,
              httpStatus: 400,
              body: {
                confirmationRequired: true,
                confirmationType: "not_in_proforma",
                notInProforma: true,
                message: "Item loaded not requested. Please scan again to bypass.",
              },
            };
          }
        }

        // Always prefer the canonical product name from factoryBaleProducts
        const resolvedBaleName = productForBale?.name || bale.productName || bale.articleCode || bale.baleCode;

        const [insertedOrderBale] = await tx
          .insert(customerOrderBales)
          .values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parseInt(locationId),
            weight: bale.weightKg,
            articleCode: effectiveArticleCode || bale.articleCode,
            baleName: resolvedBaleName,
            priceUsed,
            scannedBy: scannerName,
          })
          .returning();

        // V5 guard: proformaIdUsed IS NOT NULL
        // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
        if (!order.proformaIdUsed) {
          await tx
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
        }

        const recalculated = await recalculateOrderTotalsForScannedArticle(
          tx,
          orderId,
          effectiveArticleCode || bale.articleCode
        );
        return {
          ok: true,
          bale: insertedOrderBale,
          line: recalculated.line,
          totals: recalculated.totals,
        };
      });

      if (!result.ok) {
        if (result.body?.confirmationType === "overload") {
          markExpectedClientResponse(res, EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_OVERLOAD);
        } else if (result.body?.confirmationType === "not_in_proforma") {
          markExpectedClientResponse(res, EXPECTED_CLIENT_RESPONSE_CODES.BALE_SCAN_NOT_IN_PROFORMA);
        }
        return res.status(result.httpStatus).json(result.body);
      }

      // Phase 3 compact response: the client merges this tiny patch into its
      // already-cached order instead of downloading all historical bales/lines/
      // charges after every scan.
      return res.json({
        compactBaleScan: true,
        orderId,
        order: {
          ...order,
          ...result.totals,
        },
        bale: result.bale,
        line: result.line,
        totals: result.totals,
      });
    } catch (error: unknown) {
      logger.error("Error adding bale to order:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
