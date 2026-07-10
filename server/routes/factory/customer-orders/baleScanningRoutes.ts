import { trackOneContainerById } from "../../../services/containerTrackingService";
import { parseId, parseOptionalId } from "../../../lib/parseId";
import { dispatchNotification } from "../../../lib/notificationService";
import { getClientDate } from "../../../lib/dateUtils";
import { getExportPriceVisibility } from "../../../helpers/exportVisibility";
import { sendWhatsAppFileToChatIdPos } from "../../../services/whatsappService";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { adjustInventory } from "../../../inventoryHelper";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
  recalculateOrderTotals,
} from "../_helpers";
import {
  factorySuppliers,
  factoryCategories,
  factoryBaleProducts,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryDailyUsages,
  factoryPressingBatches,
  factoryBales,
  factoryBaleSequences,
  factoryContainerCommissions,
  baleLabelPrints,
  stockItems,
  stockGroups,
  users,
  insertFactorySupplierSchema,
  insertFactoryCategorySchema,
  insertFactoryBaleProductSchema,
  insertFactoryContainerSchema,
  insertFactoryRawStockSchema,
  insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema,
  insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema,
  customerProformas,
  customerProformaLines,
  customerOrders,
  customerOrderLines,
  customerOrderBales,
  customerOrderCharges,
  customerInvoiceSequences,
  customerBalances,
  customers,
  insertCustomerSchema,
  ledgerAccounts,
  voucherEntries,
  companies,
  locations,
  userCompanyRoles,
  insertCustomerProformaSchema,
  insertCustomerProformaLineSchema,
  insertCustomerOrderSchema,
  factoryFxRates,
  insertFactoryFxRateSchema,
  factoryDaybookEntries,
  containerDocumentTypes,
  containerDocuments,
  containerFreight,
  containerFreightPayments,
  factoryDaybookEntryEdits,
  containers,
  factoryUserProfiles,
  factoryUserPageAccess,
  insertUserSchema,
  directMessages,
  insertDirectMessageSchema,
  userPresence,
  factoryDutyAuditLog,
  factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges,
  companySettings,
  factorySettings,
  factoryWorkers,
  factoryWorkerCategories,
  insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments,
  factoryPayrolls,
  factoryWorkerDocuments,
  factoryAlerts,
  employees,
  factoryWasteEntries,
  factoryBalePhotos,
  factoryDailyKpiSnapshots,
  factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots,
  factoryContainerProfitSnapshots,
  bankAccounts,
  inventory,
  exchangeRates,
  vouchers,
  suppliers,
  containerSales,
  factorySupplierPayments,
  insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers,
  insertFactorySupplierFxTransferSchema,
  factoryFxAllocations,
  baleRecodeSessions,
  baleRecodeItems,
  factoryWorkerAdvances,
  factoryAdvanceRepayments,
  factoryBaleWasteDispatches,
  factoryPosSales,
  factoryPosSaleItems,
  proformaStockReservations,
  customerOrderBaleRemovals,
  customerOrderExpectedLines,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

export function registerBaleScanningRoutes(app: Express) {
  app.post("/api/factory/customer-orders/:id/bales", requireAuth, async (req: any, res: any) => {
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
      const matchingProductIds = matchingProductsByName.map((p: any) => p.id);

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
      // Errors with `httpStatus` and `body` are thrown to bubble out of the
      // tx, then translated back to res.status(...).json(...) below.
      type PickResult = { ok: true; baleId: number } | { ok: false; httpStatus: number; body: any };

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
        const crossOrderDupRow = (crossOrderDupCheck as any).rows?.[0];
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
        // fallback when bale.articleCode is null.  Bales pressed before the
        // articleCode column was added (or imported without it) can otherwise
        // bypass the proforma overload check entirely.
        let productForBale: any = null;
        if (bale.productId) {
          const [p] = await tx.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.id, bale.productId));
          productForBale = p || null;
        }

        // Effective article code: prefer the bale's own field, fall back to the
        // product master's articleCode so the proforma check is consistent.
        const effectiveArticleCode: string =
          bale.articleCode || productForBale?.articleCode || "";

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
          const proformaLine: any = pl || null;
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
                  and(
                    eq(customerOrderBales.orderId, orderId),
                    eq(customerOrderBales.articleCode, effectiveArticleCode)
                  )
                );
              const currentCount = countResult?.count || 0;
              if (currentCount >= proformaLine.quantity) {
                return {
                  ok: false,
                  httpStatus: 400,
                  body: {
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
                notInProforma: true,
                message: "Item loaded not requested. Please scan again to bypass.",
              },
            };
          }
        }

        // Always prefer the canonical product name from factoryBaleProducts
        const resolvedBaleName = productForBale?.name || bale.productName || bale.articleCode || bale.baleCode;

        await tx.insert(customerOrderBales).values({
          orderId,
          baleId: bale.id,
          baleReference: bale.referenceNumber,
          locationId: parseInt(locationId),
          weight: bale.weightKg,
          articleCode: effectiveArticleCode || bale.articleCode,
          baleName: resolvedBaleName,
          priceUsed,
          scannedBy: scannerName,
        });

        // V5 guard: proformaIdUsed IS NOT NULL
        // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
        if (!order.proformaIdUsed) {
          await tx
            .update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));
        }

        await recalculateOrderTotals(tx, orderId);
        return { ok: true, baleId: bale.id };
      });

      if (!result.ok) return res.status(result.httpStatus).json(result.body);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding bale to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/bales/bulk-import", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { locationId, items, refNumbers: refNumbersRaw } = req.body;
      const hasRefNumbers = Array.isArray(refNumbersRaw) && refNumbersRaw.length > 0;
      const hasItems = Array.isArray(items) && items.length > 0;
      if (!locationId || (!hasItems && !hasRefNumbers)) {
        return res.status(400).json({ message: "locationId and either items or refNumbers are required" });
      }
      const scannerName: string | null =
        (req.session as any)?.username || (req.session as any)?.name || (req.session as any)?.email || null;

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) {
        return res
          .status(400)
          .json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });
      }

      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales are SOLD once the order reaches PENDING_VERIFICATION — no further bulk scanning allowed.
      // Legacy V2/V3 behavior (PENDING_VERIFICATION scan allowed) is unchanged.
      if (order.proformaIdUsed && order.status === "PENDING_VERIFICATION") {
        return res
          .status(400)
          .json({ message: "Cannot add bales to a V5 order that is already in PENDING_VERIFICATION" });
      }

      const parsedLocationId = parseInt(locationId);

      // Get all products for this company for matching
      const allProducts = await db
        .select()
        .from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId));

      // Get bales already in this order
      const existingOrderBales = await db
        .select({ baleId: customerOrderBales.baleId })
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId));
      const alreadyAddedBaleIds = new Set(existingOrderBales.map((b: any) => b.baleId));

      let totalAdded = 0;
      const notFound: Array<{ articleCode: string; requestedQty: number; foundQty: number }> = [];
      const notFoundRefs: string[] = [];

      // ── REF-NUMBER / REF-CODE MODE ──────────────────────────────────────────
      if (hasRefNumbers) {
        const refNumbers = refNumbersRaw as string[];
        for (const rawRef of refNumbers) {
          const refNum = String(rawRef).trim();
          if (!refNum) continue;

          // Per-refNum tx: lock the bale with SELECT FOR UPDATE, then insert
          // the join row + flip status atomically. Two concurrent bulk-imports
          // referencing the same physical bale will block at the lock; only
          // one will see status='IN_STOCK', the other will skip.
          const refResult = await db.transaction(async (tx: any) => {
            // Try referenceNumber first, then fall back to baleCode
            let [bale] = await tx
              .select()
              .from(factoryBales)
              .where(
                and(
                  eq(factoryBales.companyId, companyId),
                  eq(factoryBales.referenceNumber, refNum),
                  eq(factoryBales.status, "IN_STOCK")
                )
              )
              .for("update");

            if (!bale) {
              [bale] = await tx
                .select()
                .from(factoryBales)
                .where(
                  and(
                    eq(factoryBales.companyId, companyId),
                    eq(factoryBales.baleCode, refNum),
                    eq(factoryBales.status, "IN_STOCK")
                  )
                )
                .for("update");
            }

            if (!bale) return { kind: "notFound" as const };
            if (alreadyAddedBaleIds.has(bale.id)) return { kind: "skipDuplicate" as const };

            // Universal cross-order duplicate check: block if this bale is already in any other
            // active (non-CANCELLED) order regardless of V5/non-V5 type.
            const bulkCrossOrderCheck = await tx.execute(
              sql`SELECT cob.order_id FROM customer_order_bales cob
                  JOIN customer_orders co ON co.id = cob.order_id
                  WHERE cob.bale_id = ${bale.id}
                    AND co.status != 'CANCELLED'
                    AND cob.order_id != ${orderId}
                  LIMIT 1`
            );
            const bulkCrossOrderRow = (bulkCrossOrderCheck as any).rows?.[0];
            if (bulkCrossOrderRow) return { kind: "notFound" as const };

            let priceUsed = "0";
            if (order.proformaIdUsed) {
              const [pl] = await tx
                .select()
                .from(customerProformaLines)
                .where(
                  and(
                    eq(customerProformaLines.proformaId, order.proformaIdUsed),
                    eq(customerProformaLines.articleCode, bale.articleCode || "")
                  )
                );
              if (pl) {
                const pMode = (pl as any).pricingMode ?? "per_bale";
                const pkgRate = parseFloat(String((pl as any).pricePerKg ?? "0"));
                if (pMode === "per_kg" && pkgRate > 0) {
                  const baleWt = parseFloat(String(bale.weightKg || "0"));
                  priceUsed = (!isNaN(baleWt) ? baleWt * pkgRate : 0).toFixed(2);
                } else {
                  priceUsed = pl.pricePerBale;
                }
              }
            }
            if (priceUsed === "0" && bale.productId) {
              const product = allProducts.find((p: any) => p.id === bale.productId);
              if (product?.sellingPrice) priceUsed = product.sellingPrice;
            }

            const baleProductForName1 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

            await tx.insert(customerOrderBales).values({
              orderId,
              baleId: bale.id,
              baleReference: bale.referenceNumber,
              locationId: bale.erpLocationId ?? parsedLocationId,
              weight: bale.weightKg,
              articleCode: bale.articleCode,
              baleName: baleProductForName1?.name || bale.productName || bale.articleCode || bale.baleCode,
              priceUsed,
              scannedBy: scannerName,
            });

            // V5 guard: proformaIdUsed IS NOT NULL
            // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
            if (!order.proformaIdUsed) {
              await tx
                .update(factoryBales)
                .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
                .where(eq(factoryBales.id, bale.id));
            }

            return { kind: "added" as const, baleId: bale.id };
          });

          if (refResult.kind === "notFound") {
            notFoundRefs.push(refNum);
            continue;
          }
          if (refResult.kind === "skipDuplicate") continue;
          alreadyAddedBaleIds.add(refResult.baleId);
          totalAdded++;
        }

        await recalculateOrderTotals(db, orderId);
        const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
        return res.json({ added: totalAdded, notFound: [], notFoundRefs, order: updatedOrder, bales: updatedBales });
      }

      // ── V5 cross-order block set (ARTICLE mode) ─────────────────────────────
      // V5 guard: proformaIdUsed IS NOT NULL
      // V5 bales remain IN_STOCK while loaded in other orders. Build a set of bale IDs already
      // claimed by other active (non-CANCELLED) V5 orders so they can be excluded during
      // auto-selection. One query covers all articles. Legacy orders skip this block entirely.
      const v5BlockedBaleIds = new Set<number>();
      if (order.proformaIdUsed) {
        const blockedRows = await db.execute(
          sql`SELECT cob.bale_id FROM customer_order_bales cob
              JOIN customer_orders co ON co.id = cob.order_id
              WHERE co.status != 'CANCELLED'
                AND cob.order_id != ${orderId}`
        );
        for (const row of (blockedRows as any).rows ?? []) {
          v5BlockedBaleIds.add(row.bale_id);
        }
      }

      // ── ARTICLE-CODE MODE (existing) ────────────────────────────────────────
      for (const item of items) {
        const articleCode = String(item.articleCode || "").trim();
        const qty = parseInt(item.qty) || 0;
        if (!articleCode || qty <= 0) continue;

        const codeLower = articleCode.toLowerCase();

        // Find matching product IDs (by articleCode or name)
        const matchingProductIds = allProducts
          .filter(
            (p) =>
              (p.articleCode && p.articleCode.toLowerCase() === codeLower) ||
              (p.name && p.name.toLowerCase() === codeLower)
          )
          .map((p) => p.id);

        // Build bale query conditions
        const matchConditions =
          matchingProductIds.length > 0
            ? or(
                sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`,
                inArray(factoryBales.productId, matchingProductIds)
              )
            : sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`;

        // Per-article tx: lock candidate bales with SELECT FOR UPDATE, filter
        // the locked set in-memory to drop already-claimed/cross-order ones,
        // then insert + status-update inside the same tx. Concurrent imports
        // for the same article will block at the lock and re-evaluate, so
        // they cannot grab the same physical bales.
        const articleResult = await db.transaction(async (tx: any) => {
          // Find available bales, oldest first
          const availableBales = await tx
            .select()
            .from(factoryBales)
            .where(
              and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.status, "IN_STOCK"),
                eq(factoryBales.erpLocationId, parsedLocationId),
                matchConditions
              )
            )
            .orderBy(factoryBales.createdAt)
            .limit(qty * 5)
            .for("update");

          // Filter out bales already in this order, or (V5 only) bales we
          // already know are claimed by another active order from the snapshot
          // taken before this tx. Note: the snapshot can be stale, so for V5
          // we re-verify each candidate inside the tx below before inserting.
          const candidateBales = availableBales.filter(
            (b: any) => !alreadyAddedBaleIds.has(b.id) && !v5BlockedBaleIds.has(b.id)
          );

          const addedIds: number[] = [];
          for (const bale of candidateBales) {
            if (addedIds.length >= qty) break;

            // V5 guard: proformaIdUsed IS NOT NULL
            // The outer v5BlockedBaleIds snapshot can race with concurrent V5
            // imports — re-verify inside the tx that no other active order
            // has linked this bale since we took the snapshot. Without this
            // recheck, two concurrent ARTICLE imports could both claim the
            // same V5 bale (V5 keeps bale IN_STOCK so the FOR UPDATE lock
            // alone does not block the second tx from picking it up).
            if (order.proformaIdUsed) {
              const v5DupCheck = await tx.execute(
                sql`SELECT cob.order_id FROM customer_order_bales cob
                    JOIN customer_orders co ON co.id = cob.order_id
                    WHERE cob.bale_id = ${bale.id}
                      AND co.status != 'CANCELLED'
                      AND cob.order_id != ${orderId}
                    LIMIT 1`
              );
              if ((v5DupCheck as any).rows?.[0]) continue;
            }

            // Determine price
            let priceUsed = "0";
            if (order.proformaIdUsed) {
              const [pl] = await tx
                .select()
                .from(customerProformaLines)
                .where(
                  and(
                    eq(customerProformaLines.proformaId, order.proformaIdUsed),
                    eq(customerProformaLines.articleCode, bale.articleCode || "")
                  )
                );
              if (pl) {
                const pMode = (pl as any).pricingMode ?? "per_bale";
                const pkgRate = parseFloat(String((pl as any).pricePerKg ?? "0"));
                if (pMode === "per_kg" && pkgRate > 0) {
                  const baleWt = parseFloat(String(bale.weightKg || "0"));
                  priceUsed = (!isNaN(baleWt) ? baleWt * pkgRate : 0).toFixed(2);
                } else {
                  priceUsed = pl.pricePerBale;
                }
              }
            }
            if (priceUsed === "0" && bale.productId) {
              const product = allProducts.find((p: any) => p.id === bale.productId);
              if (product?.sellingPrice) priceUsed = product.sellingPrice;
            }

            const baleProductForName2 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

            await tx.insert(customerOrderBales).values({
              orderId,
              baleId: bale.id,
              baleReference: bale.referenceNumber,
              locationId: parsedLocationId,
              weight: bale.weightKg,
              articleCode: bale.articleCode,
              baleName: baleProductForName2?.name || bale.productName || bale.articleCode || bale.baleCode,
              priceUsed,
              scannedBy: scannerName,
            });

            // V5 guard: proformaIdUsed IS NOT NULL
            // V5 bales remain IN_STOCK during loading — only legacy V2/V3 orders set RESERVED_FOR_ORDER.
            if (!order.proformaIdUsed) {
              await tx
                .update(factoryBales)
                .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
                .where(eq(factoryBales.id, bale.id));
            }

            addedIds.push(bale.id);
          }

          return addedIds;
        });

        if (articleResult.length < qty) {
          notFound.push({ articleCode, requestedQty: qty, foundQty: articleResult.length });
        }
        for (const id of articleResult) {
          alreadyAddedBaleIds.add(id);
          totalAdded++;
        }
      }

      await recalculateOrderTotals(db, orderId);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      res.json({ added: totalAdded, notFound, order: updatedOrder, bales: updatedBales });
    } catch (error: any) {
      console.error("Error bulk importing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/bales/:baleId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const baleId = parseId(req.params.baleId);
      if (baleId === null) return res.status(400).json({ message: "Invalid id" });

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status))
        return res.status(400).json({ message: "Can only remove bales from orders that are not yet cancelled" });

      const [orderBale] = await db
        .select()
        .from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      // Fetch full bale details before deleting the join row, so we can log it
      let baleDetails: typeof factoryBales.$inferSelect | undefined;
      if (orderBale) {
        const [found] = await db.select().from(factoryBales).where(eq(factoryBales.id, orderBale.baleId));
        baleDetails = found;
      }

      await db
        .delete(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      if (orderBale && baleDetails) {
        await db
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, orderBale.baleId));

        // Log the removal so it's visible on the loading page
        const userId = req.user?.id ? String(req.user.id) : null;
        const username = req.user?.username || req.user?.email || null;
        await db.insert(customerOrderBaleRemovals).values({
          orderId,
          baleId: orderBale.baleId,
          referenceNumber: baleDetails.referenceNumber,
          articleCode: baleDetails.articleCode || null,
          productName: baleDetails.productName || null,
          weightKg: baleDetails.weightKg,
          removedByUserId: userId,
          removedByUsername: username,
        });
      } else if (orderBale) {
        await db
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, orderBale.baleId));
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing bale from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bales/:id/return-to-stock — remove a bale from its order and return it to stock
  // Works for any order status. For FINALIZED orders: updates customer_balances + daybook. Admin-gated.
  app.post("/api/factory/bales/:id/return-to-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const baleId = parseId(req.params.id);
      if (baleId === null) return res.status(400).json({ message: "Invalid bale id" });

      const userId = req.user?.id ? String(req.user.id) : null;
      const username = req.user?.username || req.user?.email || null;

      // 1. Find the bale
      const [bale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.id, baleId), eq(factoryBales.companyId, companyId)));
      if (!bale) return res.status(404).json({ message: "Bale not found" });
      if (!["RESERVED_FOR_ORDER", "RESERVED", "SOLD"].includes(bale.status)) {
        return res.status(400).json({ message: `Bale is ${bale.status} — it is not allocated to an order` });
      }

      // 2. Find the customer_order_bales row
      const [orderBale] = await db.select().from(customerOrderBales).where(eq(customerOrderBales.baleId, baleId));
      if (!orderBale) {
        // Bale has no order row — just flip it back to IN_STOCK
        await db
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, baleId));
        return res.json({ message: "Bale returned to stock (no order link found)", orderId: null, orderStatus: null });
      }

      const orderId = orderBale.orderId;

      // 3. Fetch order
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Associated order not found" });

      // 4. Guard: cannot remove the LAST bale (order must be cancelled instead)
      const remainingBales = await db
        .select({ id: customerOrderBales.id })
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId));
      if (remainingBales.length <= 1) {
        return res.status(400).json({
          message: "This is the last bale in the order. Cancel the entire order instead of removing individual bales.",
          isLastBale: true,
        });
      }

      await db.transaction(async (tx: any) => {
        // 5. Remove from customer_order_bales
        await tx.delete(customerOrderBales).where(eq(customerOrderBales.id, orderBale.id));

        // 6. Return bale to IN_STOCK
        await tx
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, baleId));

        // 7. Audit log
        await tx.insert(customerOrderBaleRemovals).values({
          orderId,
          baleId,
          referenceNumber: bale.referenceNumber,
          articleCode: bale.articleCode || null,
          productName: bale.productName || null,
          weightKg: bale.weightKg,
          removedByUserId: userId,
          removedByUsername: username,
        });

        // 8. Recalculate order totals (regenerates order lines + grand total)
        await recalculateOrderTotals(tx, orderId);

        // 9. For FINALIZED orders: sync customer_balances + daybook INVOICE entry
        if (order.status === "FINALIZED") {
          const [recalcOrder] = await tx
            .select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders)
            .where(eq(customerOrders.id, orderId));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [ledgerEntry] = await tx
            .select({ id: customerBalances.id })
            .from(customerBalances)
            .where(
              and(
                eq(customerBalances.companyId, companyId),
                eq(customerBalances.referenceType, "INVOICE"),
                eq(customerBalances.referenceId, orderId)
              )
            );
          if (ledgerEntry) {
            await tx
              .update(customerBalances)
              .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
              .where(eq(customerBalances.id, ledgerEntry.id));
          }

          const [daybookEntry] = await tx
            .select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "INVOICE"),
                eq(factoryDaybookEntries.referenceId, orderId)
              )
            );
          if (daybookEntry) {
            await tx
              .update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, daybookEntry.id));
          }
        }

        // 10. For VERIFIED orders: sync ORDER_VERIFIED daybook entry
        if (order.status === "VERIFIED") {
          const [recalcOrder] = await tx
            .select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders)
            .where(eq(customerOrders.id, orderId));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [verifiedEntry] = await tx
            .select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
                eq(factoryDaybookEntries.referenceId, orderId)
              )
            );
          if (verifiedEntry) {
            await tx
              .update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, verifiedEntry.id));
          }
        }
      });

      // Return updated order info for the frontend to display
      const [finalOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      res.json({
        message: "Bale returned to stock",
        orderId,
        orderStatus: finalOrder?.status,
        invoiceNumber: finalOrder?.invoiceNumber,
        newGrandTotal: finalOrder?.grandTotal,
      });
    } catch (error: any) {
      console.error("Error returning bale to stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/bales/:id/order-info — get the order a bale is allocated to (for the confirmation dialog)
  app.get("/api/factory/bales/:id/order-info", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const baleId = parseId(req.params.id);
      if (baleId === null) return res.status(400).json({ message: "Invalid bale id" });

      const [orderBale] = await db.select().from(customerOrderBales).where(eq(customerOrderBales.baleId, baleId));
      if (!orderBale) return res.json(null);

      const [order] = await db
        .select({
          id: customerOrders.id,
          status: customerOrders.status,
          invoiceNumber: customerOrders.invoiceNumber,
          grandTotal: customerOrders.grandTotal,
          customerName: customers.name,
          orderDate: customerOrders.orderDate,
          containerNumber: customerOrders.containerNumber,
          totalQtyBales: customerOrders.totalQtyBales,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customers.id, customerOrders.customerId))
        .where(and(eq(customerOrders.id, orderBale.orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.json(null);

      // Count remaining bales so the frontend can warn if this is the last one
      const baleCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, order.id));
      const remainingCount = Number(baleCount[0]?.count ?? 0);

      res.json({ ...order, totalBalesInOrder: remainingCount });
    } catch (error: any) {
      console.error("Error fetching bale order info:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bales/swap — swap a loaded bale (SOLD/RESERVED) with an IN_STOCK bale by reference number
  // The current bale is returned to stock; the replacement bale takes its place in the order.
  app.post("/api/factory/bales/swap", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { currentBaleRef, replacementBaleRef } = req.body;
      if (!currentBaleRef || !replacementBaleRef) {
        return res.status(400).json({ message: "Both currentBaleRef and replacementBaleRef are required" });
      }
      if (currentBaleRef.trim().toUpperCase() === replacementBaleRef.trim().toUpperCase()) {
        return res.status(400).json({ message: "Replacement bale must be different from the current bale" });
      }

      const userId = req.user?.id ? String(req.user.id) : null;
      const username = req.user?.username || req.user?.email || null;

      // 1. Find current bale
      const [currentBale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), ilike(factoryBales.referenceNumber, currentBaleRef.trim())));
      if (!currentBale) return res.status(404).json({ message: `Bale "${currentBaleRef}" not found` });
      if (!["RESERVED_FOR_ORDER", "RESERVED", "SOLD"].includes(currentBale.status)) {
        return res.status(400).json({
          message: `Bale "${currentBaleRef}" is ${currentBale.status} — it must be loaded in an order to be swapped`,
        });
      }

      // 2. Find replacement bale
      const [replacementBale] = await db
        .select()
        .from(factoryBales)
        .where(
          and(eq(factoryBales.companyId, companyId), ilike(factoryBales.referenceNumber, replacementBaleRef.trim()))
        );
      if (!replacementBale)
        return res.status(404).json({ message: `Replacement bale "${replacementBaleRef}" not found` });
      if (replacementBale.status !== "IN_STOCK") {
        return res.status(400).json({
          message: `Replacement bale "${replacementBaleRef}" is ${replacementBale.status} — it must be IN_STOCK to be used as a replacement`,
        });
      }

      // 3. Find the customerOrderBales row for the current bale
      const [orderBale] = await db
        .select()
        .from(customerOrderBales)
        .where(eq(customerOrderBales.baleId, currentBale.id));
      if (!orderBale) {
        // No order link — just flip current back to stock
        await db
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, currentBale.id));
        return res.status(400).json({ message: "No order link found for the current bale" });
      }

      // 4. Find the order
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderBale.orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Associated order not found" });

      await db.transaction(async (tx: any) => {
        // 5. Update customerOrderBales to point to the replacement bale (keep priceUsed unchanged)
        await tx
          .update(customerOrderBales)
          .set({
            baleId: replacementBale.id,
            baleReference: replacementBale.referenceNumber,
            weight: replacementBale.weightKg,
            articleCode: replacementBale.articleCode || null,
            baleName: replacementBale.productName || null,
          })
          .where(eq(customerOrderBales.id, orderBale.id));

        // 6. Return current bale to IN_STOCK
        await tx
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, currentBale.id));

        // 7. Set replacement bale to the same status as the current bale
        await tx
          .update(factoryBales)
          .set({ status: currentBale.status, updatedAt: new Date() })
          .where(eq(factoryBales.id, replacementBale.id));

        // 8. Audit log
        await tx.insert(customerOrderBaleRemovals).values({
          orderId: order.id,
          baleId: currentBale.id,
          referenceNumber: currentBale.referenceNumber,
          articleCode: currentBale.articleCode || null,
          productName: currentBale.productName || null,
          weightKg: currentBale.weightKg,
          removedByUserId: userId,
          removedByUsername: username
            ? `${username} (swapped → ${replacementBale.referenceNumber})`
            : `swap → ${replacementBale.referenceNumber}`,
        });

        // 9. Recalculate order totals
        await recalculateOrderTotals(tx, order.id);

        // 10. For FINALIZED orders: sync customer_balances + daybook INVOICE entry
        if (order.status === "FINALIZED") {
          const [recalcOrder] = await tx
            .select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders)
            .where(eq(customerOrders.id, order.id));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [ledgerEntry] = await tx
            .select({ id: customerBalances.id })
            .from(customerBalances)
            .where(
              and(
                eq(customerBalances.companyId, companyId),
                eq(customerBalances.referenceType, "INVOICE"),
                eq(customerBalances.referenceId, order.id)
              )
            );
          if (ledgerEntry) {
            await tx
              .update(customerBalances)
              .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
              .where(eq(customerBalances.id, ledgerEntry.id));
          }

          const [daybookEntry] = await tx
            .select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "INVOICE"),
                eq(factoryDaybookEntries.referenceId, order.id)
              )
            );
          if (daybookEntry) {
            await tx
              .update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, daybookEntry.id));
          }
        }

        // 11. For VERIFIED orders: sync ORDER_VERIFIED daybook entry
        if (order.status === "VERIFIED") {
          const [recalcOrder] = await tx
            .select({ grandTotal: customerOrders.grandTotal })
            .from(customerOrders)
            .where(eq(customerOrders.id, order.id));
          const newGrandTotal = parseFloat(recalcOrder?.grandTotal || "0");

          const [verifiedEntry] = await tx
            .select({ id: factoryDaybookEntries.id })
            .from(factoryDaybookEntries)
            .where(
              and(
                eq(factoryDaybookEntries.companyId, companyId),
                eq(factoryDaybookEntries.txType, "ORDER_VERIFIED"),
                eq(factoryDaybookEntries.referenceId, order.id)
              )
            );
          if (verifiedEntry) {
            await tx
              .update(factoryDaybookEntries)
              .set({ amountCurrency: newGrandTotal, amountUsd: newGrandTotal })
              .where(eq(factoryDaybookEntries.id, verifiedEntry.id));
          }
        }
      });

      const [finalOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, order.id));
      res.json({
        message: "Bale swapped successfully",
        orderId: order.id,
        orderStatus: finalOrder?.status,
        invoiceNumber: finalOrder?.invoiceNumber,
        newGrandTotal: finalOrder?.grandTotal,
        replacedRef: currentBale.referenceNumber,
        replacementRef: replacementBale.referenceNumber,
      });
    } catch (error: any) {
      console.error("Error swapping bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/customer-orders/:id/bales/exchange — swap one bale for another on a FINALIZED order
  app.post("/api/factory/customer-orders/:id/bales/exchange", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { orderBaleId, newBaleReference } = req.body;
      if (!orderBaleId || !newBaleReference?.trim()) {
        return res.status(400).json({ message: "orderBaleId and newBaleReference are required" });
      }

      await db.transaction(async (tx: any) => {
        const [order] = await tx
          .select()
          .from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["FINALIZED", "VERIFIED"].includes(order.status)) {
          throw new Error("Bale exchange is only allowed on FINALIZED or VERIFIED orders");
        }

        // Find the customerOrderBales row to replace
        const [oldOrderBale] = await tx
          .select()
          .from(customerOrderBales)
          .where(and(eq(customerOrderBales.id, orderBaleId), eq(customerOrderBales.orderId, orderId)));
        if (!oldOrderBale) throw new Error("Bale not found in this order");

        // Find the new bale in stock — FOR UPDATE prevents a concurrent
        // exchange or sale from grabbing the same physical bale.
        const newRef = newBaleReference.trim();
        const [newBale] = await tx
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.status, "IN_STOCK"),
              or(eq(factoryBales.referenceNumber, newRef), eq(factoryBales.baleCode, newRef))
            )
          )
          .for("update");
        if (!newBale) throw new Error(`Bale "${newRef}" not found in stock or not available`);

        // Resolve product name for new bale
        let newBaleName = newBale.productName || newBale.articleCode || newBale.baleCode || "";
        if (newBale.productId) {
          const [prod] = await tx
            .select({ name: factoryBaleProducts.name })
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.id, newBale.productId));
          if (prod?.name) newBaleName = prod.name;
        }

        // Return old bale to stock
        await tx
          .update(factoryBales)
          .set({ status: "IN_STOCK", updatedAt: new Date() })
          .where(eq(factoryBales.id, oldOrderBale.baleId));

        // Remove old order bale row
        await tx.delete(customerOrderBales).where(eq(customerOrderBales.id, orderBaleId));

        // Insert new order bale row (preserve price from the row being replaced)
        await tx.insert(customerOrderBales).values({
          orderId,
          baleId: newBale.id,
          baleReference: newBale.referenceNumber || newRef,
          locationId: oldOrderBale.locationId,
          weight: newBale.weightKg,
          articleCode: newBale.articleCode || oldOrderBale.articleCode,
          baleName: newBaleName || oldOrderBale.baleName,
          priceUsed: oldOrderBale.priceUsed,
        });

        // Mark new bale as sold (same status as other finalized bales)
        await tx
          .update(factoryBales)
          .set({ status: "SOLD", updatedAt: new Date() })
          .where(eq(factoryBales.id, newBale.id));

        await recalculateOrderTotals(tx, orderId);
      });

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));
      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Exchange bale error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET removal log for a specific order/loading
  app.get("/api/factory/customer-orders/:id/bale-removals", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const orderId = parseId(req.params.id);
      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      const removals = await db
        .select()
        .from(customerOrderBaleRemovals)
        .where(eq(customerOrderBaleRemovals.orderId, orderId))
        .orderBy(desc(customerOrderBaleRemovals.removedAt));
      res.json(removals);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
