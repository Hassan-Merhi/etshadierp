import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword, recalculateOrderTotals,
} from "./_helpers";
import {
  factorySuppliers, factoryCategories, factoryBaleProducts,
  factoryContainers, factoryRawStock, factoryMixBatches,
  factoryMixBatchSources, factoryDailyUsages, factoryPressingBatches,
  factoryBales, factoryBaleSequences, factoryContainerCommissions,
  baleLabelPrints, stockItems, stockGroups, users,
  insertFactorySupplierSchema, insertFactoryCategorySchema,
  insertFactoryBaleProductSchema, insertFactoryContainerSchema,
  insertFactoryRawStockSchema, insertFactoryMixBatchSchema,
  insertFactoryMixBatchSourceSchema, insertFactoryPressingBatchSchema,
  insertFactoryBaleSchema, customerProformas, customerProformaLines,
  customerOrders, customerOrderLines, customerOrderBales,
  customerOrderCharges, customerInvoiceSequences, customerBalances,
  customers, insertCustomerSchema, ledgerAccounts, voucherEntries,
  companies, locations, userCompanyRoles, insertCustomerProformaSchema,
  insertCustomerProformaLineSchema, insertCustomerOrderSchema,
  factoryFxRates, insertFactoryFxRateSchema, factoryDaybookEntries,
  containerDocumentTypes, containerDocuments, containerFreight,
  containerFreightPayments, factoryDaybookEntryEdits,
  containers, factoryUserProfiles, factoryUserPageAccess,
  insertUserSchema, directMessages, insertDirectMessageSchema,
  userPresence, factoryDutyAuditLog, factoryOffloadAdditionalCharges,
  factoryContainerOtherCharges, companySettings, factorySettings,
  factoryWorkers, factoryWorkerCategories, insertFactoryWorkerCategorySchema,
  factoryRawMaterialAdjustments, factoryPayrolls, factoryWorkerDocuments,
  factoryAlerts, employees, factoryWasteEntries, factoryBalePhotos,
  factoryDailyKpiSnapshots, factorySupplierScoreSnapshots,
  factoryBaleCostSnapshots, factoryContainerProfitSnapshots,
  bankAccounts, inventory, exchangeRates, vouchers, suppliers,
  containerSales, factorySupplierPayments, insertFactorySupplierPaymentSchema,
  factorySupplierFxTransfers, insertFactorySupplierFxTransferSchema,
  factoryFxAllocations, baleRecodeSessions, baleRecodeItems,
  factoryWorkerAdvances, factoryAdvanceRepayments, factoryBaleWasteDispatches,
  factoryPosSales, factoryPosSaleItems, proformaStockReservations,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerFactoryCustomerOrderRoutes(app: Express) {
  app.get("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(customerOrders.companyId, companyId)];
      if (req.query.customerId) conditions.push(eq(customerOrders.customerId, parseInt(req.query.customerId)));
      if (req.query.status) conditions.push(eq(customerOrders.status, req.query.status));
      if (req.query.proformaId) conditions.push(eq(customerOrders.proformaIdUsed, parseInt(req.query.proformaId)));

      const orders = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          proformaName: customerProformas.name,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          totalWeightKg: sql<string>`COALESCE((SELECT SUM(cob.weight) FROM customer_order_bales cob WHERE cob.order_id = ${customerOrders.id}), 0)`,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          locationId: customerOrders.locationId,
          loadingStartedAt: customerOrders.loadingStartedAt,
          loadingFinalizedAt: customerOrders.loadingFinalizedAt,
          verifiedAt: customerOrders.verifiedAt,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .leftJoin(customerProformas, eq(customerOrders.proformaIdUsed, customerProformas.id))
        .where(and(...conditions))
        .orderBy(desc(customerOrders.createdAt));

      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching customer orders:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [order] = await db
        .select({
          id: customerOrders.id,
          companyId: customerOrders.companyId,
          customerId: customerOrders.customerId,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          proformaIdUsed: customerOrders.proformaIdUsed,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          containerNumber: customerOrders.containerNumber,
          shippingCompany: customerOrders.shippingCompany,
          containerNotes: customerOrders.containerNotes,
          verifiedByUserId: customerOrders.verifiedByUserId,
          verifiedAt: customerOrders.verifiedAt,
          loadingStartedAt: customerOrders.loadingStartedAt,
          loadingFinalizedAt: customerOrders.loadingFinalizedAt,
          locationId: customerOrders.locationId,
          createdAt: customerOrders.createdAt,
          updatedAt: customerOrders.updatedAt,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, id));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, id));

      res.json({ ...order, lines, bales, charges });
    } catch (error: any) {
      console.error("Error fetching customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/profitability", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [order] = await db
        .select({ id: customerOrders.id, status: customerOrders.status, invoiceNumber: customerOrders.invoiceNumber, customerName: customers.legalName })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, id), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, id));
      const articleCodes = lines.map((l: any) => l.articleCode).filter(Boolean);

      const products = articleCodes.length > 0
        ? await db.select({
            articleCode: factoryBaleProducts.articleCode,
            productionPrice: factoryBaleProducts.productionPrice,
            name: factoryBaleProducts.name,
          }).from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes)))
        : [];

      const productMap: Record<string, { productionPrice: string | null; name: string }> = {};
      for (const p of products) {
        if (p.articleCode) productMap[p.articleCode] = { productionPrice: p.productionPrice, name: p.name };
      }

      let totalSelling = 0;
      let totalCost = 0;
      let totalCostKnown = true;

      const profitLines = lines.map((line: any) => {
        const qty = Number(line.qty || 0);
        const selling = parseFloat(line.totalPrice || "0");
        const product = line.articleCode ? productMap[line.articleCode] : null;
        const hasCost = product !== null && product.productionPrice !== null;
        const costPerBale = hasCost ? parseFloat(product!.productionPrice!) : 0;
        const cost = hasCost ? costPerBale * qty : 0;
        const profit = hasCost ? selling - cost : null;
        const profitPctOnCost = hasCost && cost !== 0 ? ((selling - cost) / cost) * 100 : null;
        const marginPct = hasCost && selling !== 0 ? ((selling - cost) / selling) * 100 : null;

        totalSelling += selling;
        if (hasCost) {
          totalCost += cost;
        } else {
          totalCostKnown = false;
        }

        return {
          articleCode: line.articleCode,
          baleName: line.baleName,
          qty,
          selling,
          costPerBale,
          cost,
          profit,
          profitPctOnCost,
          marginPct,
          missingCost: !hasCost,
          pricePerBale: parseFloat(line.pricePerBale || "0"),
        };
      });

      const totalProfit = totalCostKnown ? totalSelling - totalCost : null;
      const totalProfitPctOnCost = totalCostKnown && totalCost !== 0 ? ((totalSelling - totalCost) / totalCost) * 100 : null;
      const totalMarginPct = totalCostKnown && totalSelling !== 0 ? ((totalSelling - totalCost) / totalSelling) * 100 : null;

      res.json({
        orderId: id,
        invoiceNumber: order.invoiceNumber,
        customerName: order.customerName,
        lines: profitLines,
        totalSelling,
        totalCost: totalCostKnown ? totalCost : null,
        totalProfit,
        totalProfitPctOnCost,
        totalMarginPct,
        partialCostData: !totalCostKnown,
      });
    } catch (error: any) {
      console.error("Error fetching order profitability:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerOrderSchema.parse({ ...req.body, companyId, status: "DRAFT" });
      const [order] = await db.insert(customerOrders).values(parsed).returning();
      res.json(order);
    } catch (error: any) {
      console.error("Error creating customer order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { scanCode, locationId } = req.body;
      if (!scanCode || !locationId) return res.status(400).json({ message: "scanCode and locationId are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) return res.status(400).json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });

      // Check if this scan code matches a bale already reserved (status = RESERVED_FOR_ORDER).
      // Only match by unique bale identifiers (referenceNumber, baleCode) — NOT by articleCode or
      // productName, which are shared across many bales and would falsely block scanning the next
      // available bale of the same product type.
      const scanLower = scanCode.toLowerCase();
      const [reservedBale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "RESERVED_FOR_ORDER"),
          or(
            sql`LOWER(${factoryBales.referenceNumber}) = ${scanLower}`,
            sql`LOWER(${factoryBales.baleCode}) = ${scanLower}`
          )
        ));

      if (reservedBale) {
        const [inThisOrder] = await db.select().from(customerOrderBales)
          .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, reservedBale.id)));
        if (inThisOrder) {
          return res.status(400).json({ message: `${reservedBale.referenceNumber || scanCode} is already loaded in this order` });
        }
        return res.status(400).json({ message: `Bale ${reservedBale.referenceNumber || scanCode} is reserved for another loading order` });
      }

      // Also look up product IDs whose current name or articleCode matches the scan code
      const matchingProductsByName = await db
        .select({ id: factoryBaleProducts.id })
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          or(
            sql`LOWER(${factoryBaleProducts.name}) = ${scanLower}`,
            ilike(factoryBaleProducts.name, `%${scanCode.trim()}%`),
            sql`LOWER(${factoryBaleProducts.articleCode}) = ${scanLower}`,
            ilike(factoryBaleProducts.articleCode, `%${scanCode.trim()}%`)
          )
        ));
      const matchingProductIds = matchingProductsByName.map((p: any) => p.id);

      const nameConditions = matchingProductIds.length > 0
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

      const [bale] = await db.select().from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK")),
          eq(factoryBales.erpLocationId, parseInt(locationId)),
          nameConditions
        ))
        .orderBy(factoryBales.id)
        .limit(1);

      if (!bale) return res.status(404).json({ message: "Bale not found, not at this location, or not available for sale" });

      const [alreadyAdded] = await db.select().from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.baleId, bale.id)));
      if (alreadyAdded) return res.status(400).json({ message: "Bale already added to this order" });

      let priceUsed = "0";
      let proformaLine: any = null;
      if (order.proformaIdUsed) {
        const [pl] = await db.select().from(customerProformaLines)
          .where(and(
            eq(customerProformaLines.proformaId, order.proformaIdUsed),
            eq(customerProformaLines.articleCode, bale.articleCode || "")
          ));
        proformaLine = pl || null;
        if (proformaLine) {
          priceUsed = proformaLine.pricePerBale;
          // Overload check: count existing bales of this article in the order
          if (!req.body.allowBypassOverload) {
            const [countResult] = await db
              .select({ count: sql<number>`COUNT(*)::int` })
              .from(customerOrderBales)
              .where(and(
                eq(customerOrderBales.orderId, orderId),
                eq(customerOrderBales.articleCode, bale.articleCode || "")
              ));
            const currentCount = countResult?.count || 0;
            if (currentCount >= proformaLine.quantity) {
              return res.status(400).json({
                overloaded: true,
                message: `Quantity exceeded (${currentCount}/${proformaLine.quantity}). Scan again to bypass.`,
              });
            }
          }
        } else if (!req.body.allowBypassProforma) {
          return res.status(400).json({
            notInProforma: true,
            message: "Item loaded not requested. Please scan again to bypass.",
          });
        }
      }

      let productForBale: any = null;
      if (bale.productId) {
        const [p] = await db.select().from(factoryBaleProducts)
          .where(eq(factoryBaleProducts.id, bale.productId));
        productForBale = p || null;
        if (productForBale && priceUsed === "0" && productForBale.sellingPrice) {
          priceUsed = productForBale.sellingPrice;
        }
      }

      // Always prefer the canonical product name from factoryBaleProducts
      const resolvedBaleName = productForBale?.name || bale.productName || bale.articleCode || bale.baleCode;

      await db.insert(customerOrderBales).values({
        orderId,
        baleId: bale.id,
        baleReference: bale.referenceNumber,
        locationId: parseInt(locationId),
        weight: bale.weightKg,
        articleCode: bale.articleCode,
        baleName: resolvedBaleName,
        priceUsed,
      });

      await db.update(factoryBales).set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() }).where(eq(factoryBales.id, bale.id));

      await recalculateOrderTotals(db, orderId);

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

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

      const orderId = parseInt(req.params.id);
      const { locationId, items, refNumbers: refNumbersRaw } = req.body;
      const hasRefNumbers = Array.isArray(refNumbersRaw) && refNumbersRaw.length > 0;
      const hasItems = Array.isArray(items) && items.length > 0;
      if (!locationId || (!hasItems && !hasRefNumbers)) {
        return res.status(400).json({ message: "locationId and either items or refNumbers are required" });
      }

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) {
        return res.status(400).json({ message: "Can only add bales to DRAFT, LOADING, or PENDING_VERIFICATION orders" });
      }

      const parsedLocationId = parseInt(locationId);

      // Get all products for this company for matching
      const allProducts = await db.select().from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId));

      // Get bales already in this order
      const existingOrderBales = await db.select({ baleId: customerOrderBales.baleId })
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

          // Try referenceNumber first, then fall back to baleCode
          let [bale] = await db.select().from(factoryBales)
            .where(and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.referenceNumber, refNum),
              or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK"))
            ));

          if (!bale) {
            [bale] = await db.select().from(factoryBales)
              .where(and(
                eq(factoryBales.companyId, companyId),
                eq(factoryBales.baleCode, refNum),
                or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK"))
              ));
          }

          if (!bale) { notFoundRefs.push(refNum); continue; }
          if (alreadyAddedBaleIds.has(bale.id)) continue;

          let priceUsed = "0";
          if (order.proformaIdUsed) {
            const [pl] = await db.select().from(customerProformaLines)
              .where(and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed),
                eq(customerProformaLines.articleCode, bale.articleCode || "")
              ));
            if (pl) priceUsed = pl.pricePerBale;
          }
          if (priceUsed === "0" && bale.productId) {
            const product = allProducts.find((p: any) => p.id === bale.productId);
            if (product?.sellingPrice) priceUsed = product.sellingPrice;
          }

          const baleProductForName1 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

          await db.insert(customerOrderBales).values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: bale.erpLocationId ?? parsedLocationId,
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: baleProductForName1?.name || bale.productName || bale.articleCode || bale.baleCode,
            priceUsed,
          });

          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));

          alreadyAddedBaleIds.add(bale.id);
          totalAdded++;
        }

        await recalculateOrderTotals(db, orderId);
        const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
        return res.json({ added: totalAdded, notFound: [], notFoundRefs, order: updatedOrder, bales: updatedBales });
      }

      // ── ARTICLE-CODE MODE (existing) ────────────────────────────────────────
      for (const item of items) {
        const articleCode = String(item.articleCode || "").trim();
        const qty = parseInt(item.qty) || 0;
        if (!articleCode || qty <= 0) continue;

        const codeLower = articleCode.toLowerCase();

        // Find matching product IDs (by articleCode or name)
        const matchingProductIds = allProducts
          .filter(p =>
            (p.articleCode && p.articleCode.toLowerCase() === codeLower) ||
            (p.name && p.name.toLowerCase() === codeLower)
          )
          .map(p => p.id);

        // Build bale query conditions
        const matchConditions = matchingProductIds.length > 0
          ? or(
              sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`,
              inArray(factoryBales.productId, matchingProductIds)
            )
          : sql`LOWER(${factoryBales.articleCode}) = ${codeLower}`;

        // Find available bales, oldest first
        const availableBales = await db.select().from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK")),
            eq(factoryBales.erpLocationId, parsedLocationId),
            matchConditions
          ))
          .orderBy(factoryBales.createdAt)
          .limit(qty * 5);

        // Filter out bales already in this order or reserved for another order
        const candidateBales = availableBales.filter((b: any) => !alreadyAddedBaleIds.has(b.id));
        const balesToAdd = candidateBales.slice(0, qty);

        if (balesToAdd.length < qty) {
          notFound.push({ articleCode, requestedQty: qty, foundQty: balesToAdd.length });
        }

        for (const bale of balesToAdd) {
          // Determine price
          let priceUsed = "0";
          if (order.proformaIdUsed) {
            const [pl] = await db.select().from(customerProformaLines)
              .where(and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed),
                eq(customerProformaLines.articleCode, bale.articleCode || "")
              ));
            if (pl) priceUsed = pl.pricePerBale;
          }
          if (priceUsed === "0" && bale.productId) {
            const product = allProducts.find((p: any) => p.id === bale.productId);
            if (product?.sellingPrice) priceUsed = product.sellingPrice;
          }

          const baleProductForName2 = bale.productId ? allProducts.find((p: any) => p.id === bale.productId) : null;

          await db.insert(customerOrderBales).values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parsedLocationId,
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: baleProductForName2?.name || bale.productName || bale.articleCode || bale.baleCode,
            priceUsed,
          });

          await db.update(factoryBales)
            .set({ status: "RESERVED_FOR_ORDER", updatedAt: new Date() })
            .where(eq(factoryBales.id, bale.id));

          alreadyAddedBaleIds.add(bale.id);
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

      const orderId = parseInt(req.params.id);
      const baleId = parseInt(req.params.baleId);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION"].includes(order.status)) return res.status(400).json({ message: "Can only remove bales from DRAFT, LOADING, or PENDING_VERIFICATION orders" });

      const [orderBale] = await db.select().from(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      await db.delete(customerOrderBales)
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.id, baleId)));

      if (orderBale) {
        await db.update(factoryBales).set({ status: "FINALIZED", updatedAt: new Date() }).where(eq(factoryBales.id, orderBale.baleId));
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing bale from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { name, amount, chargeType, ledgerAccountId } = req.body;
      if (!name || !amount) return res.status(400).json({ message: "name and amount are required" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.insert(customerOrderCharges).values({
        orderId,
        name,
        amount: String(amount),
        chargeType: chargeType || "OTHER",
        ledgerAccountId: ledgerAccountId ? parseInt(ledgerAccountId) : null,
      });

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Sync customerBalances ledger entry if the order is already finalized
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [existingLedgerEntry] = await db.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          ));
        if (existingLedgerEntry) {
          await db.update(customerBalances)
            .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
            .where(eq(customerBalances.id, existingLedgerEntry.id));
        }
      }

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error adding charge to order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id/charges/:chargeId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const chargeId = parseInt(req.params.chargeId);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.delete(customerOrderCharges)
        .where(and(eq(customerOrderCharges.orderId, orderId), eq(customerOrderCharges.id, chargeId)));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Sync customerBalances ledger entry if the order is already finalized
      if (updatedOrder.status === "FINALIZED") {
        const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
        const [existingLedgerEntry] = await db.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          ));
        if (existingLedgerEntry) {
          await db.update(customerBalances)
            .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
            .where(eq(customerBalances.id, existingLedgerEntry.id));
        }
      }

      res.json({ ...updatedOrder, charges: updatedCharges });
    } catch (error: any) {
      console.error("Error removing charge from order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-orders/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");

        if (order.status === "FINALIZED") {
          throw new Error("Cannot delete a finalized invoice. Cancel it first if needed.");
        }

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx.update(factoryBales).set({ status: "FINALIZED", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await tx.delete(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        await tx.delete(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
        await tx.delete(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
        await tx.delete(customerOrders).where(eq(customerOrders.id, orderId));
      });

      res.json({ success: true, message: "Invoice deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting customer order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      const result = await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (!["DRAFT", "VERIFIED"].includes(order.status)) throw new Error("Only DRAFT or VERIFIED orders can be finalized");

        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        if (bales.length === 0) throw new Error("Order has no bales");

        for (const b of bales) {
          const [factoryBale] = await tx.select().from(factoryBales)
            .where(and(eq(factoryBales.id, b.baleId), or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "RESERVED_FOR_ORDER")), eq(factoryBales.erpLocationId, b.locationId)));
          if (!factoryBale) throw new Error(`Bale ${b.baleReference} is no longer available`);
        }

        let seqRows = await tx.execute(sql`SELECT * FROM customer_invoice_sequences WHERE company_id = ${companyId} FOR UPDATE`);
        let seqRow = seqRows.rows?.[0] || seqRows[0];
        if (!seqRow) {
          [seqRow] = await tx.insert(customerInvoiceSequences).values({ companyId, nextNumber: 1 }).returning();
        }
        const invoiceNum = seqRow.nextNumber || seqRow.next_number;
        await tx.update(customerInvoiceSequences).set({ nextNumber: invoiceNum + 1 }).where(eq(customerInvoiceSequences.companyId, companyId));
        const invoiceNumber = `INV-${String(invoiceNum).padStart(6, '0')}`;

        for (const b of bales) {
          await tx.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
        }

        await recalculateOrderTotals(tx, orderId);

        const [recalcOrder] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId));

        await tx.update(customerOrders).set({
          invoiceNumber,
          status: "FINALIZED",
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        const grandTotal = parseFloat(recalcOrder.grandTotal || "0");
        const today = getClientDate(req);

        await tx.insert(customerBalances).values({
          companyId,
          customerId: order.customerId,
          transactionDate: today,
          transactionType: "SALE",
          debitAmount: String(grandTotal),
          creditAmount: "0",
          balance: String(grandTotal),
          referenceType: "INVOICE",
          referenceId: order.id,
          description: `Invoice ${invoiceNumber}`,
          currency: "USD",
        });

        // Create journal entries for charges that have a ledgerAccountId
        const chargesForJournal = await tx.select().from(customerOrderCharges)
          .where(and(eq(customerOrderCharges.orderId, orderId), sql`${customerOrderCharges.ledgerAccountId} IS NOT NULL`));

        if (chargesForJournal.length > 0) {
          const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId));
          if (customer?.ledgerAccountId) {
            for (const charge of chargesForJournal) {
              const chargeAmount = parseFloat(charge.amount || "0");
              if (chargeAmount <= 0) continue;
              // Create a voucher for each charge
              const chargeVoucherNumber = `CHARGE-${invoiceNumber}-${charge.id}-${Date.now()}`;
              const [chargeVoucher] = await tx.insert(vouchers).values({
                companyId,
                voucherType: "Journal",
                voucherNumber: chargeVoucherNumber,
                voucherDate: today,
                description: `${charge.name} - ${invoiceNumber}`,
                totalAmount: String(chargeAmount),
                sourceModule: "FACTORY",
              }).returning();
              // Dr Customer Account (charge billed to customer)
              await tx.insert(voucherEntries).values({
                voucherId: chargeVoucher.id,
                ledgerAccountId: customer.ledgerAccountId,
                customerId: order.customerId,
                debitAmount: String(chargeAmount),
                creditAmount: "0",
                narration: `${charge.name} billed to customer - ${invoiceNumber}`,
              });
              // Cr Charge Account (freight/other charges income account)
              await tx.insert(voucherEntries).values({
                voucherId: chargeVoucher.id,
                ledgerAccountId: charge.ledgerAccountId!,
                debitAmount: "0",
                creditAmount: String(chargeAmount),
                narration: `${charge.name} - ${invoiceNumber}`,
              });
            }
          }
        }

        const [finalOrder] = await tx
          .select({
            id: customerOrders.id,
            companyId: customerOrders.companyId,
            customerId: customerOrders.customerId,
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            proformaIdUsed: customerOrders.proformaIdUsed,
            status: customerOrders.status,
            subtotalBales: customerOrders.subtotalBales,
            freightAmount: customerOrders.freightAmount,
            otherChargesTotal: customerOrders.otherChargesTotal,
            grandTotal: customerOrders.grandTotal,
            totalQtyBales: customerOrders.totalQtyBales,
            createdAt: customerOrders.createdAt,
            updatedAt: customerOrders.updatedAt,
            customerName: customers.legalName,
          })
          .from(customerOrders)
          .leftJoin(customers, eq(customerOrders.customerId, customers.id))
          .where(eq(customerOrders.id, orderId));

        const finalLines = await tx.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
        const finalBales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const finalCharges = await tx.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

        return { ...finalOrder, lines: finalLines, bales: finalBales, charges: finalCharges };
      });

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "INVOICE",
        referenceId: result.orderId || orderId,
        referenceTable: "customer_orders",
        description: `Invoice ${result.invoiceNumber} – ${result.customerName || "Customer"}`,
        amountCurrency: parseFloat(result.grandTotal || "0"),
        amountUsd: parseFloat(result.grandTotal || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/finalize-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.json({ baleCount: 0, bales: [] });

      const baleIds = orderBales.map((b: any) => b.baleId);
      const baleRows = await db.select({
        id: factoryBales.id,
        referenceNumber: factoryBales.referenceNumber,
        productName: factoryBales.productName,
        weightKg: factoryBales.weightKg,
        status: factoryBales.status,
        erpLocationId: factoryBales.erpLocationId,
      }).from(factoryBales).where(inArray(factoryBales.id, baleIds));

      const locIds = [...new Set(baleRows.map((b: any) => b.erpLocationId).filter(Boolean))];
      const locationRecords = locIds.length > 0
        ? await db.select().from(locations).where(inArray(locations.id, locIds as number[]))
        : [];
      const locationMap = new Map(locationRecords.map((l: any) => [l.id, l.name]));

      const availableBales = baleRows.filter((b: any) =>
        ["IN_STOCK", "FINALIZED", "RESERVED_FOR_ORDER"].includes(b.status)
      );

      res.json({
        baleCount: availableBales.length,
        totalBalesInOrder: orderBales.length,
        bales: availableBales.map((b: any) => ({
          id: b.id,
          baleReference: b.referenceNumber,
          productName: b.productName,
          weightKg: parseFloat(b.weightKg || "0"),
          locationName: locationMap.get(b.erpLocationId) || "Unknown",
          status: b.status,
        })),
      });
    } catch (error: any) {
      console.error("Error fetching finalize preview:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/reprice", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Cannot reprice a cancelled order" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales to reprice" });

      let proformaLines: any[] = [];
      if (order.proformaIdUsed) {
        proformaLines = await db.select().from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
      }

      const proformaMap = new Map<string, string>();
      for (const pl of proformaLines) {
        if (pl.articleCode) proformaMap.set(pl.articleCode.toLowerCase(), pl.pricePerBale);
      }

      let updated = 0;
      for (const bale of orderBales) {
        let newPrice: string | null = null;

        if (bale.articleCode && proformaMap.has(bale.articleCode.toLowerCase())) {
          newPrice = proformaMap.get(bale.articleCode.toLowerCase())!;
        }

        if (!newPrice) {
          const [factoryBale] = await db.select({ productId: factoryBales.productId })
            .from(factoryBales)
            .where(eq(factoryBales.id, bale.baleId));
          if (factoryBale?.productId) {
            const [product] = await db.select({ sellingPrice: factoryBaleProducts.sellingPrice })
              .from(factoryBaleProducts)
              .where(eq(factoryBaleProducts.id, factoryBale.productId));
            if (product?.sellingPrice) newPrice = product.sellingPrice;
          }
        }

        if (newPrice !== null) {
          await db.update(customerOrderBales)
            .set({ priceUsed: newPrice })
            .where(eq(customerOrderBales.id, bale.id));
          updated++;
        }
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Sync the customerBalances ledger entry so the customer's balance reflects the new grand total.
      // The entry is inserted at finalization time; repricing must keep it in sync.
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({
            debitAmount: String(newGrandTotal),
            balance: String(newGrandTotal),
          })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      res.json({ ...updatedOrder, bales: updatedBales, lines: updatedLines, charges: updatedCharges, repriced: updated });
    } catch (error: any) {
      console.error("Error repricing order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/bales/reprice-article", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { articleCode, pricePerBale } = req.body;

      if (!articleCode || pricePerBale === undefined || pricePerBale === null) {
        return res.status(400).json({ message: "articleCode and pricePerBale are required" });
      }

      const price = parseFloat(pricePerBale);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ message: "Invalid price value" });
      }

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db.update(customerOrderBales)
        .set({ priceUsed: String(price) })
        .where(and(
          eq(customerOrderBales.orderId, orderId),
          eq(customerOrderBales.articleCode, articleCode)
        ));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.referenceId, orderId)
        ));
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Error repricing article:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/force-sync-bale-status", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const role = (session.currentRole || session.role || "").toLowerCase();
      if (role !== "admin" && role !== "owner") {
        return res.status(403).json({ message: "Only admin/owner can force-sync bale statuses" });
      }

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Order must be VERIFIED or FINALIZED to force-sync bale statuses" });
      }
      if (!order.invoiceNumber) {
        return res.status(400).json({ message: "Order must have an invoice number (previously finalized) to use force-sync" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales" });

      let updated = 0;
      for (const b of orderBales) {
        const [existing] = await db.select({ status: factoryBales.status }).from(factoryBales).where(eq(factoryBales.id, b.baleId));
        if (existing && existing.status !== "SOLD") {
          await db.update(factoryBales).set({ status: "SOLD", updatedAt: new Date() }).where(eq(factoryBales.id, b.baleId));
          updated++;
        }
      }

      res.json({ message: `${updated} bale(s) marked as SOLD`, updated, total: orderBales.length });
    } catch (error: any) {
      console.error("Error force-syncing bale status:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Export a single customer order to Excel with full bale detail
  app.get("/api/factory/customer-orders/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const baleLinks = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];

      const productIds = [...new Set(baleRows.map((b: any) => b.productId).filter((id: any) => id != null))];
      const productRecords: any[] = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds as number[]))
        : [];
      const productMap = new Map<number, any>(productRecords.map((p: any) => [p.id, p]));
      const balePriceMap = new Map<number, number>(baleLinks.map((l: any) => [l.baleId, parseFloat(l.priceUsed || "0")]));

      // Group bales by product article code
      interface ProductGroup {
        articleCode: string;
        productName: string;
        qty: number;
        wtPerBale: number;
        totalWt: number;
        pricePerBale: number;
        total: number;
      }
      const grouped = new Map<string, ProductGroup>();
      for (const bale of baleRows) {
        const product = productMap.get(bale.productId);
        const articleCode = product?.articleCode || bale.articleCode || "UNKNOWN";
        const productName = product?.name || bale.productName || articleCode;
        const wtPerBale = parseFloat(product?.weightPerBaleKg || bale.weightKg || "0");
        const price = balePriceMap.get(bale.id) || 0;
        if (!grouped.has(articleCode)) {
          grouped.set(articleCode, { articleCode, productName, qty: 0, wtPerBale, totalWt: 0, pricePerBale: price, total: 0 });
        }
        const g = grouped.get(articleCode)!;
        g.qty += 1;
        g.totalWt += parseFloat(bale.weightKg || wtPerBale.toString());
        g.total += price;
      }

      const lines = Array.from(grouped.values()).sort((a, b) => a.articleCode.localeCompare(b.articleCode));

      // Currency
      const baseCurrency = (company as any)?.baseCurrency || "USD";
      const currencySymbolMap: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", CFA: "CFA", XOF: "CFA", XAF: "CFA" };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? baseCurrency;
      const fmtMoney = (n: number) => `${currSym}${n % 1 === 0 ? n.toLocaleString() : n.toFixed(2)}`;
      const fmtNum = (n: number) => n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Commercial Invoice");
      const COL = 8;

      sheet.columns = [
        { key: "c1", width: 6 },
        { key: "c2", width: 16 },
        { key: "c3", width: 30 },
        { key: "c4", width: 8 },
        { key: "c5", width: 11 },
        { key: "c6", width: 13 },
        { key: "c7", width: 13 },
        { key: "c8", width: 14 },
      ];

      const DARK_BLUE = "FF1F3864";
      const LIGHT_GRAY = "FFF5F5F5";
      const WHITE = "FFFFFFFF";
      const GOLD = "FFD4AF37";

      const merge = (r: number, c1: number, c2: number) => sheet.mergeCells(r, c1, r, c2);
      const setFill = (cell: any, argb: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }; };
      const setBorder = (row: any) => {
        row.eachCell((cell: any) => {
          cell.border = {
            top: { style: "thin", color: { argb: "FFDDDDDD" } },
            bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
            left: { style: "thin", color: { argb: "FFDDDDDD" } },
            right: { style: "thin", color: { argb: "FFDDDDDD" } },
          };
        });
      };

      // ── Logo row ──
      const logoRow = sheet.addRow([]);
      logoRow.height = 80;
      try {
        const logoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(logoPath)) {
          const logoBuf = fs.readFileSync(logoPath);
          const logoId = workbook.addImage({ buffer: logoBuf as Buffer, extension: "jpeg" });
          sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 80 } });
        }
      } catch {}

      // ── Company name ──
      const r1 = sheet.addRow(["HMD INTERNATIONAL GROUP"]);
      r1.height = 22;
      r1.getCell(1).font = { bold: true, size: 14, color: { argb: DARK_BLUE } };
      r1.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r1.number, 1, COL);

      // ── "Commercial Invoice" title ──
      const r2 = sheet.addRow(["Commercial Invoice"]);
      r2.height = 20;
      r2.getCell(1).font = { bold: true, size: 13, color: { argb: DARK_BLUE } };
      r2.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      merge(r2.number, 1, COL);
      sheet.addRow([]);

      // ── Invoice details (right-aligned block) ──
      const invoiceNum = order.invoiceNumber || `INV-${String(orderId).padStart(6, "0")}`;
      const orderDateFmt = order.orderDate
        ? new Date(order.orderDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
        : "-";

      const details = [
        ["Invoice No.", invoiceNum],
        ["Customer", customer?.legalName || "-"],
        ["Date", orderDateFmt],
        ["Container", order.containerNumber || "-"],
      ];
      for (const [label, value] of details) {
        const dr = sheet.addRow(["", "", "", "", "", label, "", value]);
        dr.getCell(6).font = { bold: true, size: 10 };
        dr.getCell(6).alignment = { horizontal: "right" };
        dr.getCell(8).font = { size: 10 };
        dr.getCell(8).alignment = { horizontal: "left" };
        merge(dr.number, 6, 7);
      }
      sheet.addRow([]);

      // ── Table header ──
      const hdrRow = sheet.addRow(["#", "Article Code", "Product", "Qty", "Wt/Bale", "Total Wt", "Price/Bale", "Total"]);
      hdrRow.height = 18;
      hdrRow.eachCell((cell: any) => {
        cell.font = { bold: true, color: { argb: WHITE }, size: 10 };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { top: { style: "thin", color: { argb: WHITE } }, bottom: { style: "thin", color: { argb: WHITE } }, left: { style: "thin", color: { argb: WHITE } }, right: { style: "thin", color: { argb: WHITE } } };
      });

      // ── Data rows ──
      let totalQty = 0, totalWtAll = 0, totalAll = 0;
      lines.forEach((g, idx) => {
        totalQty += g.qty;
        totalWtAll += g.totalWt;
        totalAll += g.total;
        const dr = sheet.addRow([
          idx + 1,
          g.articleCode,
          g.productName,
          g.qty,
          fmtNum(g.wtPerBale),
          fmtNum(g.totalWt),
          fmtMoney(g.pricePerBale),
          fmtMoney(g.total),
        ]);
        dr.height = 15;
        if (idx % 2 === 1) {
          dr.eachCell((cell: any) => setFill(cell, LIGHT_GRAY));
        }
        dr.getCell(1).alignment = { horizontal: "center" };
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(6).alignment = { horizontal: "right" };
        dr.getCell(7).alignment = { horizontal: "right" };
        dr.getCell(8).alignment = { horizontal: "right" };
        setBorder(dr);
      });

      // ── Totals row ──
      const totRow = sheet.addRow(["", "", "Totals", totalQty, "", fmtNum(totalWtAll), "", fmtMoney(totalAll)]);
      totRow.height = 16;
      totRow.eachCell((cell: any) => {
        cell.font = { bold: true, size: 10, color: { argb: WHITE } };
        setFill(cell, DARK_BLUE);
        cell.alignment = { horizontal: "right" };
      });
      totRow.getCell(3).alignment = { horizontal: "center" };
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(6).alignment = { horizontal: "right" };
      totRow.getCell(8).alignment = { horizontal: "right" };

      sheet.addRow([]);

      // ── Financial summary block ──
      const subtotal = parseFloat(order.subtotalBales || "0");
      const freight = parseFloat(order.freightAmount || "0");
      const clearance = parseFloat(order.otherChargesTotal || "0");
      const grandTotal = parseFloat(order.grandTotal || "0");

      const summaryData = [
        ["Subtotal (Bales)", subtotal],
        ["Freight", freight],
        ["Clearance", clearance],
        ["Grand Total", grandTotal],
      ];

      // Header row for summary
      const sumHdr = sheet.addRow(["", "", "", "", "", "", "Name", "Amount"]);
      sumHdr.getCell(7).font = { bold: true, color: { argb: WHITE }, size: 10 };
      sumHdr.getCell(8).font = { bold: true, color: { argb: WHITE }, size: 10 };
      setFill(sumHdr.getCell(7), DARK_BLUE);
      setFill(sumHdr.getCell(8), DARK_BLUE);
      sumHdr.getCell(7).alignment = { horizontal: "center" };
      sumHdr.getCell(8).alignment = { horizontal: "center" };

      summaryData.forEach(([label, amount], idx) => {
        const sr = sheet.addRow(["", "", "", "", "", "", label as string, fmtMoney(amount as number)]);
        const isGrandTotal = idx === summaryData.length - 1;
        const bg = isGrandTotal ? DARK_BLUE : (idx % 2 === 0 ? WHITE : LIGHT_GRAY);
        const fg = isGrandTotal ? WHITE : "FF000000";
        setFill(sr.getCell(7), bg);
        setFill(sr.getCell(8), bg);
        sr.getCell(7).font = { bold: isGrandTotal, size: 10, color: { argb: fg } };
        sr.getCell(8).font = { bold: isGrandTotal, size: 10, color: { argb: fg } };
        sr.getCell(7).alignment = { horizontal: "left" };
        sr.getCell(8).alignment = { horizontal: "right" };
        sr.getCell(7).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
        sr.getCell(8).border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
      });

      const dateStr = getClientDate(req);
      const fileName = `invoice_${invoiceNum.replace(/[^a-zA-Z0-9]/g, "_")}_${dateStr}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting order to Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/unfinalize", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);

      await db.transaction(async (tx: any) => {
        const [order] = await tx.select().from(customerOrders)
          .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
        if (!order) throw new Error("Order not found");
        if (order.status !== "FINALIZED") throw new Error("Only FINALIZED orders can be reverted to Draft");

        // Block if any payment has been recorded against this invoice
        const payments = await tx.select({ id: customerBalances.id })
          .from(customerBalances)
          .where(and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceId, orderId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.transactionType, "PAYMENT"),
          ));
        if (payments.length > 0) {
          throw new Error("Cannot revert: this invoice has payments recorded against it. Reverse the payments first.");
        }

        // Delete the SALE balance entry for this invoice
        await tx.delete(customerBalances).where(and(
          eq(customerBalances.companyId, companyId),
          eq(customerBalances.referenceId, orderId),
          eq(customerBalances.referenceType, "INVOICE"),
          eq(customerBalances.transactionType, "SALE"),
        ));

        // Delete charge journal vouchers created during finalization (sourceModule FACTORY, description contains invoice number)
        if (order.invoiceNumber) {
          const chargeVouchers = await tx.select({ id: vouchers.id })
            .from(vouchers)
            .where(and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              sql`${vouchers.description} LIKE ${"CHARGE-" + order.invoiceNumber + "-%"}`,
            ));
          for (const cv of chargeVouchers) {
            await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, cv.id));
            await tx.delete(vouchers).where(eq(vouchers.id, cv.id));
          }
        }

        // Revert bales from SOLD → FINALIZED
        const bales = await tx.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        for (const b of bales) {
          await tx.update(factoryBales)
            .set({ status: "FINALIZED", updatedAt: new Date() })
            .where(and(eq(factoryBales.id, b.baleId), eq(factoryBales.status, "SOLD")));
        }

        // Reset order to PENDING_VERIFICATION, clear invoice number
        await tx.update(customerOrders).set({
          status: "PENDING_VERIFICATION",
          invoiceNumber: null,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId));

        // Daybook entry
        const [unfCustomer] = await tx.select({ legalName: customers.legalName })
          .from(customers).where(eq(customers.id, order.customerId));
        const unfToday = getClientDate(req);
        await writeDaybookEntry(tx, {
          companyId,
          txDate: unfToday,
          txType: "INVOICE_REVERTED",
          referenceId: orderId,
          description: `Invoice ${order.invoiceNumber} reverted to Draft – ${unfCustomer?.legalName || "Customer"}`,
        });
      });

      res.json({ message: "Invoice reverted to Draft successfully" });
    } catch (error: any) {
      console.error("Error unfinalizing order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/cancel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (!["DRAFT", "LOADING"].includes(order.status)) return res.status(400).json({ message: "Only DRAFT or LOADING orders can be cancelled" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      for (const ob of orderBales) {
        await db.update(factoryBales).set({ status: "FINALIZED", updatedAt: new Date() }).where(eq(factoryBales.id, ob.baleId));
      }

      const [updated] = await db.update(customerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(customerOrders.id, orderId))
        .returning();

      const [cancelCustomer] = await db.select({ legalName: customers.legalName })
        .from(customers).where(eq(customers.id, order.customerId));
      const cancelToday = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: cancelToday,
        txType: "ORDER_CANCELLED",
        referenceId: orderId,
        description: `Order cancelled: ${cancelCustomer?.legalName || "Customer"}, ${orderBales.length} bale${orderBales.length !== 1 ? "s" : ""} released`,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CONTAINER LOADING WORKFLOW
  // ───────────────────────────────────────────────

  app.post("/api/factory/customer-orders-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, proformaIdUsed, locationId, orderDate } = req.body;
      if (!customerId) return res.status(400).json({ message: "Customer is required" });
      if (!locationId) return res.status(400).json({ message: "Location is required" });

      const [order] = await db.insert(customerOrders).values({
        companyId,
        customerId: parseInt(customerId),
        proformaIdUsed: proformaIdUsed ? parseInt(proformaIdUsed) : null,
        locationId: parseInt(locationId),
        orderDate: orderDate || getClientDate(req),
        status: "LOADING",
        loadingStartedAt: new Date(),
      }).returning();

      const [loadingCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, parseInt(customerId)));
      const loadingToday = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: loadingToday,
        txType: "LOADING_CREATED",
        referenceId: order.id,
        description: `Loading started for customer: ${loadingCustomer?.legalName || customerId}`,
      });

      res.json(order);
    } catch (error: any) {
      console.error("Error creating loading order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/finalize-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "LOADING") return res.status(400).json({ message: "Only LOADING orders can be finalized for loading" });

      const bales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (bales.length === 0) return res.status(400).json({ message: "Order has no bales scanned" });

      const [updated] = await db.update(customerOrders).set({
        status: "PENDING_VERIFICATION",
        loadingFinalizedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(customerOrders.id, orderId)).returning();

      const [lsCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, order.customerId));
      const lsToday = getClientDate(req);
      const lsTotalValue = bales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
      await writeDaybookEntry(db, {
        companyId,
        txDate: lsToday,
        txType: "LOADING_SUBMITTED",
        referenceId: orderId,
        description: `Loading submitted for verification: ${lsCustomer?.legalName || "Customer"}, ${bales.length} bale${bales.length !== 1 ? "s" : ""} scanned`,
        amountCurrency: lsTotalValue,
        amountUsd: lsTotalValue,
      });

      res.json(updated);
    } catch (error: any) {
      console.error("Error finalizing loading:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-orders/:id/verification-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

      const loadedByArticle: Record<string, { articleCode: string; productName: string; qty: number; totalWeight: number; totalPrice: number }> = {};
      for (const b of orderBales) {
        const code = b.articleCode || "UNKNOWN";
        if (!loadedByArticle[code]) {
          loadedByArticle[code] = { articleCode: code, productName: b.baleName || code, qty: 0, totalWeight: 0, totalPrice: 0 };
        }
        loadedByArticle[code].qty += 1;
        loadedByArticle[code].totalWeight += parseFloat(b.weight);
        loadedByArticle[code].totalPrice += parseFloat(b.priceUsed);
      }

      let proformaLines: any[] = [];
      const proformaByArticle: Record<string, { articleCode: string; productName: string; expectedQty: number; pricePerBale: string }> = {};

      if (order.proformaIdUsed) {
        proformaLines = await db.select().from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));

        for (const pl of proformaLines) {
          proformaByArticle[pl.articleCode] = {
            articleCode: pl.articleCode,
            productName: pl.productName,
            expectedQty: pl.quantity,
            pricePerBale: pl.pricePerBale,
          };
        }
      }

      const allArticles = new Set([...Object.keys(loadedByArticle), ...Object.keys(proformaByArticle)]);
      const comparison: any[] = [];

      for (const code of allArticles) {
        const loaded = loadedByArticle[code] || null;
        const proforma = proformaByArticle[code] || null;
        const loadedQty = loaded?.qty || 0;
        const expectedQty = proforma?.expectedQty || 0;

        let status: string;
        if (!proforma && loadedQty > 0) {
          status = "LOADED_NOT_IN_PROFORMA";
        } else if (proforma && loadedQty === 0) {
          status = "MISSING_FROM_LOADED";
        } else if (expectedQty > 0 && loadedQty < expectedQty) {
          status = "UNDER_LOADED";
        } else if (expectedQty > 0 && loadedQty > expectedQty) {
          status = "OVER_LOADED";
        } else {
          status = "MATCH";
        }

        comparison.push({
          articleCode: code,
          productName: loaded?.productName || proforma?.productName || code,
          loadedQty,
          expectedQty,
          diff: loadedQty - expectedQty,
          totalWeight: loaded?.totalWeight || 0,
          totalPrice: loaded?.totalPrice || 0,
          pricePerBale: proforma?.pricePerBale || "0",
          inProforma: !!proforma,
          status,
        });
      }

      res.json({
        order,
        loadedItems: Object.values(loadedByArticle),
        proformaLines: Object.values(proformaByArticle),
        comparison,
        totalLoadedBales: orderBales.length,
        totalLoadedWeight: orderBales.reduce((s: number, b: any) => s + parseFloat(b.weight), 0),
      });
    } catch (error: any) {
      console.error("Error fetching verification summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/verify", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { approved, notes } = req.body;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "PENDING_VERIFICATION") return res.status(400).json({ message: "Only PENDING_VERIFICATION orders can be verified" });

      if (approved) {
        const [updated] = await db.update(customerOrders).set({
          status: "VERIFIED",
          verifiedAt: new Date(),
          containerNotes: notes || order.containerNotes,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId)).returning();
        const [verifyCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, order.customerId));
        const verifyBales = await db.select({ priceUsed: customerOrderBales.priceUsed }).from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
        const verifyTotalValue = verifyBales.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || "0"), 0);
        const verifyToday = getClientDate(req);
        await writeDaybookEntry(db, {
          companyId,
          txDate: verifyToday,
          txType: "ORDER_VERIFIED",
          referenceId: orderId,
          description: `Order verified for customer: ${verifyCustomer?.legalName || "Customer"}${notes ? ` – ${notes}` : ""}`,
          amountCurrency: verifyTotalValue,
          amountUsd: verifyTotalValue,
        });
        res.json(updated);
      } else {
        const [updated] = await db.update(customerOrders).set({
          containerNotes: notes || order.containerNotes,
          updatedAt: new Date(),
        }).where(eq(customerOrders.id, orderId)).returning();
        res.json(updated);
      }
    } catch (error: any) {
      console.error("Error verifying order:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/return-to-loading", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "PENDING_VERIFICATION") return res.status(400).json({ message: "Only PENDING_VERIFICATION orders can be returned to loading" });

      const [updated] = await db.update(customerOrders).set({
        status: "LOADING",
        loadingFinalizedAt: null,
        updatedAt: new Date(),
      }).where(eq(customerOrders.id, orderId)).returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error returning order to loading:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-orders/:id/assign-container", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const { containerNumber, shippingCompany, containerNotes } = req.body;

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const updateData: any = { updatedAt: new Date() };
      if (containerNumber !== undefined) updateData.containerNumber = containerNumber;
      if (shippingCompany !== undefined) updateData.shippingCompany = shippingCompany;
      if (containerNotes !== undefined) updateData.containerNotes = containerNotes;

      const [updated] = await db.update(customerOrders).set(updateData)
        .where(eq(customerOrders.id, orderId)).returning();

      if (shippingCompany && order.customerId) {
        await db.update(customers).set({
          defaultShippingCompany: shippingCompany,
        }).where(eq(customers.id, order.customerId)).catch(() => {});
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // BALE SCAN LOOKUP
  // ───────────────────────────────────────────────

  app.get("/api/factory/bale-lookup", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const code = req.query.code as string;
      const locationId = req.query.locationId ? parseInt(req.query.locationId as string) : null;
      if (!code) return res.status(400).json({ message: "code is required" });

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "FINALIZED"),
        or(
          eq(factoryBales.referenceNumber, code),
          eq(factoryBales.baleCode, code),
          eq(factoryBales.articleCode, code)
        ),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const results = await db.select().from(factoryBales).where(and(...conditions));

      if (results.length === 0) return res.status(404).json({ message: "No available bale found with that code at this location" });

      res.json(results);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (Excel/CSV)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Build article-code → product name map from factoryBaleProducts so the export
      // always shows the canonical product name regardless of what was stored in baleName
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const productNameMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const products = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            inArray(factoryBaleProducts.articleCode, articleCodes)
          ));
        for (const p of products) {
          if (p.articleCode) productNameMap.set(p.articleCode, p.name);
        }
      }

      const sortedLines = lines.sort((a: any, b: any) => {
        const nameA = productNameMap.get(a.articleCode) || a.baleName || "";
        const nameB = productNameMap.get(b.articleCode) || b.baleName || "";
        return nameA.localeCompare(nameB);
      });

      const csvFmtNum = (val: any): string => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "");
      };
      const csvFmtMoney = (val: any): string => `$${csvFmtNum(val)}`;

      let csv = `Company: ${company?.name || ""}\n`;
      csv += `Invoice: ${order.invoiceNumber || "DRAFT"}\n`;
      csv += `Customer: ${order.customerName} (${order.customerCode})\n`;
      csv += `Date: ${order.orderDate}\n\n`;
      csv += `#,Article Code,Product Name,Qty,Weight/Bale,Total Weight,Price/Bale,Total Price\n`;

      sortedLines.forEach((line: any, idx: number) => {
        const productName = productNameMap.get(line.articleCode) || line.baleName || "";
        csv += `${idx + 1},${line.articleCode},${productName.replace(/,/g, " ")},${csvFmtNum(line.qty)},${csvFmtNum(line.weightPerBale)},${csvFmtNum(line.totalWeight)},${csvFmtMoney(line.pricePerBale)},${csvFmtMoney(line.totalPrice)}\n`;
      });

      csv += `\nCharges\n`;
      csv += `Name,Type,Amount\n`;
      for (const charge of charges) {
        csv += `${(charge.name || "").replace(/,/g, " ")},${charge.chargeType},${csvFmtMoney(charge.amount)}\n`;
      }

      csv += `\nSummary\n`;
      csv += `Subtotal Bales,${csvFmtMoney(order.subtotalBales)}\n`;
      csv += `Freight,${csvFmtMoney(order.freightAmount)}\n`;
      csv += `Other Charges,${csvFmtMoney(order.otherChargesTotal)}\n`;
      csv += `Grand Total,${csvFmtMoney(order.grandTotal)}\n`;
      csv += `Total Qty Bales,${csvFmtNum(order.totalQtyBales)}\n`;

      const filename = `invoice_${order.invoiceNumber || orderId}.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Error exporting order to CSV:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // PENDING LOADING — BALE-LEVEL EXCEL EXPORT
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/pending-export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
      const customerName = customer?.legalName || `order_${orderId}`;

      const baleLinks = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId))
        .orderBy(customerOrderBales.id);

      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];
      const baleMap = new Map<number, any>(baleRows.map((b: any) => [b.id, b]));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Loading");

      const NUM_COLS_LOADING = 6;
      sheet.columns = [
        { key: "seq", width: 6 },
        { key: "refCode", width: 20 },
        { key: "articleCode", width: 16 },
        { key: "name", width: 32 },
        { key: "weight", width: 14 },
        { key: "totalWeight", width: 18 },
      ];

      // Logo header rows
      try {
        const ldLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
        if (fs.existsSync(ldLogoPath)) {
          const ldId = workbook.addImage({ buffer: fs.readFileSync(ldLogoPath) as Buffer, extension: "jpeg" });
          const ldRow = sheet.addRow([]); ldRow.height = 90;
          sheet.addImage(ldId, { tl: { col: 2.4, row: 0 }, ext: { width: 300, height: 90 } });
        }
      } catch {}
      const ldTitle = sheet.addRow([`Loading List — ${customerName}`]);
      ldTitle.getCell(1).font = { bold: true, size: 13 };
      ldTitle.getCell(1).alignment = { horizontal: "center" };
      sheet.mergeCells(ldTitle.number, 1, ldTitle.number, NUM_COLS_LOADING);
      sheet.addRow([]);

      const ldHdr = sheet.addRow(["#", "Ref Code", "Article Code", "Name", "Weight (kg)", "Total Weight (kg)"]);
      ldHdr.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      });

      let runningTotal = 0;
      for (let i = 0; i < baleLinks.length; i++) {
        const link = baleLinks[i];
        const bale = baleMap.get(link.baleId);
        const weight = parseFloat(link.weight || bale?.weightKg || "0");
        runningTotal += weight;
        const row = sheet.addRow({
          seq: i + 1,
          refCode: link.baleReference || bale?.referenceNumber || bale?.baleCode || "",
          articleCode: link.articleCode || bale?.articleCode || "",
          name: link.baleName || bale?.productName || "",
          weight: Math.round(weight * 100) / 100,
          totalWeight: Math.round(runningTotal * 100) / 100,
        });
        row.getCell("weight").numFmt = "#,##0.00";
        row.getCell("totalWeight").numFmt = "#,##0.00";
      }

      const totalRow = sheet.addRow({
        seq: "",
        refCode: "",
        articleCode: "",
        name: "TOTAL",
        weight: Math.round(runningTotal * 100) / 100,
        totalWeight: Math.round(runningTotal * 100) / 100,
      });
      totalRow.font = { bold: true };
      totalRow.getCell("weight").numFmt = "#,##0.00";
      totalRow.getCell("totalWeight").numFmt = "#,##0.00";

      const safeName = customerName.replace(/[^a-zA-Z0-9_\-]/g, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="loading_${orderId}_${safeName}.xlsx"`);
      const buffer = await workbook.xlsx.writeBuffer();
      res.send(buffer);
    } catch (error: any) {
      console.error("Error exporting pending loading:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // INVOICE EXPORT (PDF as HTML)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [order] = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          status: customerOrders.status,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          grandTotal: customerOrders.grandTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          containerNumber: customerOrders.containerNumber,
          customerName: customers.legalName,
          customerCode: customers.code,
        })
        .from(customerOrders)
        .leftJoin(customers, eq(customerOrders.customerId, customers.id))
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));

      if (!order) return res.status(404).json({ message: "Order not found" });

      const lines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const charges = await db.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));

      // Build nameMap for invoice HTML export
      const invArticleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      const invNameMap = new Map<string, string>();
      if (invArticleCodes.length > 0) {
        const invProds = await db
          .select({ articleCode: factoryBaleProducts.articleCode, name: factoryBaleProducts.name })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, invArticleCodes)));
        for (const p of invProds) { if (p.articleCode) invNameMap.set(p.articleCode, p.name); }
      }
      const sortedLines = lines.sort((a: any, b: any) => {
        const na = invNameMap.get(a.articleCode) || a.baleName || "";
        const nb = invNameMap.get(b.articleCode) || b.baleName || "";
        return na.localeCompare(nb);
      });

      // Read logo for embedding in HTML
      const invLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      let invLogoDataUri = "";
      try {
        if (fs.existsSync(invLogoPath)) {
          const logoB64 = fs.readFileSync(invLogoPath).toString("base64");
          invLogoDataUri = `data:image/jpeg;base64,${logoB64}`;
        }
      } catch {}

      const fmtNum = (val: any): string => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0
          ? n.toLocaleString("en-US")
          : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      };
      const fmtMoney = (val: any): string => `$${fmtNum(val)}`;

      let linesHtml = "";
      sortedLines.forEach((line: any, idx: number) => {
        linesHtml += `<tr>
          <td>${idx + 1}</td>
          <td>${line.articleCode}</td>
          <td>${invNameMap.get(line.articleCode) || line.baleName || ""}</td>
          <td>${fmtNum(line.qty)}</td>
          <td>${fmtNum(line.weightPerBale)}</td>
          <td>${fmtNum(line.totalWeight)}</td>
          <td>${fmtMoney(line.pricePerBale)}</td>
          <td>${fmtMoney(line.totalPrice)}</td>
        </tr>`;
      });

      let chargesHtml = "";
      for (const charge of charges) {
        chargesHtml += `<tr><td>${charge.name}</td><td>${charge.chargeType}</td><td>${fmtMoney(charge.amount)}</td></tr>`;
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${order.invoiceNumber || "DRAFT"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; }

  /* ── Top header bar ── */
  .top-bar { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%); color: #fff; padding: 18px 32px; display: flex; align-items: center; gap: 20px; }
  .top-bar-logo { height: 70px; width: auto; flex-shrink: 0; filter: brightness(0) invert(1); }
  .top-bar-text h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 4px; }
  .top-bar-text .subtitle { font-size: 11px; color: #a8c0e8; letter-spacing: 1px; text-transform: uppercase; }

  /* ── Invoice meta strip ── */
  .meta-strip { display: flex; gap: 0; border-bottom: 3px solid #e94560; }
  .meta-box { flex: 1; padding: 10px 16px; border-right: 1px solid #e8edf5; background: #f7f9fc; }
  .meta-box:last-child { border-right: none; }
  .meta-box .label { font-size: 9px; font-weight: 700; color: #7a8ba0; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 3px; }
  .meta-box .value { font-size: 13px; font-weight: 600; color: #1a1a2e; }

  /* ── Section heading ── */
  .section-heading { background: #e94560; color: #fff; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 5px 16px; margin: 0; }

  /* ── Lines table ── */
  .lines-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .lines-table col.col-num     { width: 32px; }
  .lines-table col.col-article { width: 90px; }
  .lines-table col.col-product { width: 130px; }
  .lines-table col.col-qty     { width: 42px; }
  .lines-table col.col-wt-bale { width: 72px; }
  .lines-table col.col-total-wt{ width: 78px; }
  .lines-table col.col-price   { width: 72px; }
  .lines-table col.col-total   { width: 78px; }
  .lines-table thead tr { background: #16213e; color: #fff; }
  .lines-table thead th { padding: 7px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; border: none; white-space: nowrap; text-align: center; }
  .lines-table tbody td { padding: 5px 8px; font-size: 11px; border-bottom: 1px solid #eaeff5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
  .lines-table tbody tr:nth-child(even) { background: #f4f7fb; }
  .lines-table tbody tr:hover { background: #e8f0fe; }
  .lines-table tfoot td { padding: 6px 8px; font-size: 11px; font-weight: 600; background: #eef2f9; border-top: 2px solid #16213e; text-align: center; }

  /* ── Charges table ── */
  .charges-table { width: 60%; border-collapse: collapse; margin: 0 0 0 0; }
  .charges-table thead tr { background: #0f3460; color: #fff; }
  .charges-table thead th { padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; border: none; text-align: center; }
  .charges-table tbody td { padding: 5px 10px; font-size: 11px; border-bottom: 1px solid #eaeff5; text-align: center; }
  .charges-table tbody tr:nth-child(even) { background: #f4f7fb; }

  /* ── Totals box ── */
  .totals-wrap { display: flex; justify-content: flex-end; padding: 16px 0; }
  .totals-table { width: 280px; border-collapse: collapse; }
  .totals-table td { padding: 5px 12px; font-size: 12px; border-bottom: 1px solid #eaeff5; }
  .totals-table td:last-child { text-align: right; font-weight: 600; }
  .totals-table tr.grand { background: #e94560; color: #fff; }
  .totals-table tr.grand td { font-size: 14px; font-weight: 700; border: none; padding: 8px 12px; }

  .content { padding: 0 0 24px; }

  @page { size: A4; margin: 0; }
  @media print {
    html, body { margin: 0; padding: 0; width: 210mm; }
    body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .top-bar { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .meta-strip { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .section-heading { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .lines-table thead tr { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .lines-table tbody tr:nth-child(even) { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .lines-table tbody tr:hover { background: transparent !important; }
    .totals-table tr.grand { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .charges-table thead tr { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style></head><body>

<div class="top-bar">
  ${invLogoDataUri ? `<img class="top-bar-logo" src="${invLogoDataUri}" alt="HMD International Group" />` : ""}
  <div class="top-bar-text">
    <h1>HMD INTERNATIONAL GROUP</h1>
    <div class="subtitle">Commercial Invoice</div>
  </div>
</div>

<div class="meta-strip">
  <div class="meta-box">
    <div class="label">Invoice No.</div>
    <div class="value">${order.invoiceNumber || "DRAFT"}</div>
  </div>
  <div class="meta-box">
    <div class="label">Customer</div>
    <div class="value">${order.customerName || "-"}</div>
  </div>
  <div class="meta-box">
    <div class="label">Date</div>
    <div class="value">${order.orderDate}</div>
  </div>
  ${order.containerNumber ? `<div class="meta-box"><div class="label">Container</div><div class="value">${order.containerNumber}</div></div>` : ""}
</div>

<div class="content">
  <div class="section-heading">Order Lines</div>
  <table class="lines-table">
    <colgroup>
      <col class="col-num"><col class="col-article"><col class="col-product">
      <col class="col-qty"><col class="col-wt-bale"><col class="col-total-wt">
      <col class="col-price"><col class="col-total">
    </colgroup>
    <thead><tr>
      <th>#</th>
      <th>Article Code</th>
      <th>Product</th>
      <th>Qty</th>
      <th>Wt/Bale</th>
      <th>Total Wt</th>
      <th>Price/Bale</th>
      <th>Total</th>
    </tr></thead>
    <tbody>${linesHtml}</tbody>
    <tfoot><tr>
      <td colspan="3" style="color:#555">Totals</td>
      <td>${fmtNum(order.totalQtyBales)}</td>
      <td></td>
      <td></td>
      <td></td>
      <td>${fmtMoney(order.grandTotal)}</td>
    </tr></tfoot>
  </table>

  ${charges.length > 0 ? `
  <div class="section-heading" style="margin-top:16px">Charges</div>
  <table class="charges-table">
    <thead><tr><th>Name</th><th>Type</th><th>Amount</th></tr></thead>
    <tbody>${chargesHtml}</tbody>
  </table>` : ""}

  <div class="totals-wrap">
    <table class="totals-table">
      <tr><td>Subtotal (Bales)</td><td>${fmtMoney(order.subtotalBales)}</td></tr>
      <tr><td>Freight</td><td>${fmtMoney(order.freightAmount)}</td></tr>
      <tr><td>Other Charges</td><td>${fmtMoney(order.otherChargesTotal)}</td></tr>
      <tr><td>Total Qty Bales</td><td>${fmtNum(order.totalQtyBales)}</td></tr>
      <tr class="grand"><td>Grand Total</td><td>${fmtMoney(order.grandTotal)}</td></tr>
    </table>
  </div>
</div>

</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      console.error("Error exporting order to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENT TYPES ───────

}
