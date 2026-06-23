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

export function registerOrderPricingRoutes(app: Express) {
  app.post("/api/factory/customer-orders/:id/reprice", requireAuth, async (req: any, res: any) => {
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
      if (!["DRAFT", "LOADING", "PENDING_VERIFICATION", "VERIFIED", "FINALIZED"].includes(order.status)) {
        return res.status(400).json({ message: "Cannot reprice a cancelled order" });
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales to reprice" });

      // "Apply Current Prices" = use the CURRENT catalogue selling price as primary source.
      // Proforma price is only a fallback if no catalogue price is found for that article.

      // 1. Collect all unique article codes and bale IDs from this order
      const articleCodes = [...new Set(orderBales.map((b) => b.articleCode).filter(Boolean) as string[])];
      const baleIds = [...new Set(orderBales.map((b) => b.baleId).filter(Boolean))];

      // 2a. Bulk-fetch current selling prices by article code (primary path)
      const cataloguePriceMap = new Map<string, string>(); // lowerArticleCode → sellingPrice
      if (articleCodes.length > 0) {
        const catalogueRows = await db
          .select({ articleCode: factoryBaleProducts.articleCode, sellingPrice: factoryBaleProducts.sellingPrice })
          .from(factoryBaleProducts)
          .where(
            and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes))
          );
        for (const r of catalogueRows) {
          if (r.articleCode && r.sellingPrice != null) {
            cataloguePriceMap.set(r.articleCode.toLowerCase().trim(), r.sellingPrice);
          }
        }
      }

      // 2b. Fallback: also pull prices via factoryBales.productId chain
      //     This covers cases where the article code in the bale doesn't match the catalogue entry.
      const baleIdPriceMap = new Map<number, string>(); // baleId → sellingPrice
      if (baleIds.length > 0) {
        const chainRows = await db
          .select({ baleId: factoryBales.id, sellingPrice: factoryBaleProducts.sellingPrice })
          .from(factoryBales)
          .innerJoin(factoryBaleProducts, eq(factoryBaleProducts.id, factoryBales.productId))
          .where(inArray(factoryBales.id, baleIds));
        for (const r of chainRows) {
          if (r.baleId && r.sellingPrice != null) {
            baleIdPriceMap.set(r.baleId, r.sellingPrice);
          }
        }
      }

      // 3. Proforma prices as fallback for articles not in catalogue
      const proformaMap = new Map<string, string>();
      if (order.proformaIdUsed) {
        const proformaLines = await db
          .select()
          .from(customerProformaLines)
          .where(eq(customerProformaLines.proformaId, order.proformaIdUsed));
        for (const pl of proformaLines) {
          if (pl.articleCode) proformaMap.set(pl.articleCode.toLowerCase(), pl.pricePerBale);
        }
      }

      let updated = 0;
      for (const bale of orderBales) {
        const codeKey = bale.articleCode?.toLowerCase().trim();
        // Priority 1: catalogue price by article code
        // Priority 2: catalogue price via bale→product chain (baleId lookup)
        // Priority 3: proforma price
        const rawPrice =
          codeKey && cataloguePriceMap.has(codeKey)
            ? cataloguePriceMap.get(codeKey)!
            : bale.baleId && baleIdPriceMap.has(bale.baleId)
              ? baleIdPriceMap.get(bale.baleId)!
              : codeKey && proformaMap.has(codeKey)
                ? proformaMap.get(codeKey)!
                : null;

        if (rawPrice === null) continue;

        // Normalise to 2-decimal string to avoid "40" vs "40.00" false-positives
        const newPriceNum = parseFloat(rawPrice);
        const curPriceNum = parseFloat(bale.priceUsed || "0");

        // Skip if catalogue price is 0 (not yet set) or if already identical
        if (newPriceNum <= 0) continue;
        if (Math.abs(newPriceNum - curPriceNum) < 0.001) continue;

        await db
          .update(customerOrderBales)
          .set({ priceUsed: newPriceNum.toFixed(2) })
          .where(eq(customerOrderBales.id, bale.id));
        updated++;
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Sync the customerBalances ledger entry so the customer's balance reflects the new grand total.
      // The entry is inserted at finalization time; repricing must keep it in sync.
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(
          and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          )
        );
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
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      res.json({
        ...updatedOrder,
        bales: updatedBales,
        lines: updatedLines,
        charges: updatedCharges,
        repriced: updated,
      });
    } catch (error: any) {
      console.error("Error repricing order:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Apply PRODUCTION prices to all bales in this order
  app.post("/api/factory/customer-orders/:id/reprice-production", requireAuth, async (req: any, res: any) => {
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
      if (order.status === "CANCELLED") return res.status(400).json({ message: "Cannot reprice a cancelled order" });

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales to reprice" });

      // Collect unique article codes and bale IDs
      const articleCodes = [...new Set(orderBales.map((b) => b.articleCode).filter(Boolean) as string[])];
      const baleIds = [...new Set(orderBales.map((b) => b.baleId).filter(Boolean))];

      // Lookup production prices by article code
      const catalogueProdMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const catRows = await db
          .select({
            articleCode: factoryBaleProducts.articleCode,
            productionPrice: factoryBaleProducts.productionPrice,
          })
          .from(factoryBaleProducts)
          .where(
            and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes))
          );
        for (const r of catRows) {
          if (r.articleCode && r.productionPrice != null) {
            catalogueProdMap.set(r.articleCode.toLowerCase().trim(), r.productionPrice);
          }
        }
      }

      // Fallback: via baleId → product chain
      const baleIdProdMap = new Map<number, string>();
      if (baleIds.length > 0) {
        const chainRows = await db
          .select({ baleId: factoryBales.id, productionPrice: factoryBaleProducts.productionPrice })
          .from(factoryBales)
          .innerJoin(factoryBaleProducts, eq(factoryBaleProducts.id, factoryBales.productId))
          .where(inArray(factoryBales.id, baleIds));
        for (const r of chainRows) {
          if (r.baleId && r.productionPrice != null) {
            baleIdProdMap.set(r.baleId, r.productionPrice);
          }
        }
      }

      let updated = 0;
      for (const bale of orderBales) {
        const codeKey = bale.articleCode?.toLowerCase().trim();
        const rawPrice =
          codeKey && catalogueProdMap.has(codeKey)
            ? catalogueProdMap.get(codeKey)!
            : bale.baleId && baleIdProdMap.has(bale.baleId)
              ? baleIdProdMap.get(bale.baleId)!
              : null;

        if (rawPrice === null) continue;
        const newPriceNum = parseFloat(rawPrice);
        if (newPriceNum <= 0) continue;
        const curPriceNum = parseFloat(bale.priceUsed || "0");
        if (Math.abs(newPriceNum - curPriceNum) < 0.001) continue;

        await db
          .update(customerOrderBales)
          .set({ priceUsed: newPriceNum.toFixed(2) })
          .where(eq(customerOrderBales.id, bale.id));
        updated++;
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Keep ledger in sync if already finalized
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(
          and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          )
        );
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      res.json({
        ...updatedOrder,
        bales: updatedBales,
        lines: updatedLines,
        charges: updatedCharges,
        repriced: updated,
      });
    } catch (error: any) {
      console.error("Error repricing order with production prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Apply a specific proforma's prices to all bales in an order (by articleCode match)
  app.post("/api/factory/customer-orders/:id/apply-proforma-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { proformaId } = req.body;
      if (!proformaId) return res.status(400).json({ message: "proformaId is required" });

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status === "CANCELLED") return res.status(400).json({ message: "Cannot reprice a cancelled order" });

      // Validate proforma belongs to this company
      const [proforma] = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.id, proformaId), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const proformaLines = await db
        .select()
        .from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, proformaId));

      if (proformaLines.length === 0) return res.status(400).json({ message: "Selected proforma has no price lines" });

      // Build articleCode → price map from proforma
      const priceMap = new Map<string, string>();
      for (const pl of proformaLines) {
        if (pl.articleCode && pl.pricePerBale != null) {
          priceMap.set(pl.articleCode.toLowerCase().trim(), pl.pricePerBale);
        }
      }

      const orderBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      if (orderBales.length === 0) return res.status(400).json({ message: "Order has no bales" });

      let updated = 0;
      for (const bale of orderBales) {
        const key = bale.articleCode?.toLowerCase().trim();
        if (!key) continue;
        const newPrice = priceMap.get(key);
        if (!newPrice) continue;
        const newPriceNum = parseFloat(newPrice);
        if (newPriceNum <= 0) continue;
        const curPriceNum = parseFloat(bale.priceUsed || "0");
        if (Math.abs(newPriceNum - curPriceNum) < 0.001) continue;

        await db
          .update(customerOrderBales)
          .set({ priceUsed: newPriceNum.toFixed(2) })
          .where(eq(customerOrderBales.id, bale.id));
        updated++;
      }

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      // Keep customer balance ledger entry in sync if already finalized entry exists
      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(
          and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          )
        );
      if (existingLedgerEntry) {
        await db
          .update(customerBalances)
          .set({ debitAmount: String(newGrandTotal), balance: String(newGrandTotal) })
          .where(eq(customerBalances.id, existingLedgerEntry.id));
      }

      const updatedBales = await db.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));
      const updatedLines = await db.select().from(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));
      const updatedCharges = await db
        .select()
        .from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      res.json({
        ...updatedOrder,
        bales: updatedBales,
        lines: updatedLines,
        charges: updatedCharges,
        repriced: updated,
      });
    } catch (error: any) {
      console.error("Error applying proforma prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/customer-orders/:id/bales/reprice-article", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseId(req.params.id);

      if (orderId === null) return res.status(400).json({ message: "Invalid id" });
      const { articleCode, pricePerBale } = req.body;

      if (!articleCode || pricePerBale === undefined || pricePerBale === null) {
        return res.status(400).json({ message: "articleCode and pricePerBale are required" });
      }

      const price = parseFloat(pricePerBale);
      if (isNaN(price) || price < 0) {
        return res.status(400).json({ message: "Invalid price value" });
      }

      const [order] = await db
        .select()
        .from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      await db
        .update(customerOrderBales)
        .set({ priceUsed: String(price) })
        .where(and(eq(customerOrderBales.orderId, orderId), eq(customerOrderBales.articleCode, articleCode)));

      await recalculateOrderTotals(db, orderId);

      const [updatedOrder] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId));

      const newGrandTotal = parseFloat(updatedOrder.grandTotal || "0");
      const [existingLedgerEntry] = await db
        .select({ id: customerBalances.id })
        .from(customerBalances)
        .where(
          and(
            eq(customerBalances.companyId, companyId),
            eq(customerBalances.referenceType, "INVOICE"),
            eq(customerBalances.referenceId, orderId)
          )
        );
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

  app.post("/api/factory/repair-perkg-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Find all LOADING / PENDING_VERIFICATION orders that have a proforma
      const ordersToScan = await db
        .select({ id: customerOrders.id, proformaIdUsed: customerOrders.proformaIdUsed })
        .from(customerOrders)
        .where(
          and(
            eq(customerOrders.companyId, companyId),
            sql`${customerOrders.status} IN ('LOADING', 'PENDING_VERIFICATION')`,
            sql`${customerOrders.proformaIdUsed} IS NOT NULL`
          )
        );

      let ordersScanned = 0;
      let balesRepaired = 0;
      const changedOrderIds: number[] = [];
      const errors: string[] = [];

      for (const order of ordersToScan) {
        ordersScanned++;
        try {
          // Fetch all proforma lines for this order's proforma that use per_kg
          const proformaPerKgLines = await db
            .select({
              articleCode: customerProformaLines.articleCode,
              pricingMode: customerProformaLines.pricingMode,
              pricePerKg: customerProformaLines.pricePerKg,
            })
            .from(customerProformaLines)
            .where(
              and(
                eq(customerProformaLines.proformaId, order.proformaIdUsed!),
                sql`${customerProformaLines.pricingMode} = 'per_kg'`,
                sql`${customerProformaLines.pricePerKg} IS NOT NULL AND ${customerProformaLines.pricePerKg}::numeric > 0`
              )
            );

          if (proformaPerKgLines.length === 0) continue;

          const perKgMap = new Map<string, number>();
          for (const pl of proformaPerKgLines) {
            if (pl.articleCode && pl.pricePerKg) {
              perKgMap.set(pl.articleCode.toLowerCase(), parseFloat(String(pl.pricePerKg)));
            }
          }

          // Find all bales in this order that match a per_kg article and have priceUsed = 0
          const bales = await db
            .select({
              id: customerOrderBales.id,
              articleCode: customerOrderBales.articleCode,
              weight: customerOrderBales.weight,
              priceUsed: customerOrderBales.priceUsed,
            })
            .from(customerOrderBales)
            .where(eq(customerOrderBales.orderId, order.id));

          let orderChanged = false;
          for (const bale of bales) {
            const key = (bale.articleCode || "").toLowerCase();
            const pkgRate = perKgMap.get(key);
            if (!pkgRate) continue;
            const currentPrice = parseFloat(String(bale.priceUsed || "0"));
            if (currentPrice !== 0) continue; // already repaired — skip (idempotent)
            const weightKg = parseFloat(String(bale.weight || "0"));
            const newPrice = (weightKg * pkgRate).toFixed(2);
            await db.update(customerOrderBales).set({ priceUsed: newPrice }).where(eq(customerOrderBales.id, bale.id));
            balesRepaired++;
            orderChanged = true;
          }

          if (orderChanged) {
            await recalculateOrderTotals(db, order.id);
            changedOrderIds.push(order.id);
          }
        } catch (err: any) {
          errors.push(`Order ${order.id}: ${err.message}`);
        }
      }

      res.json({ ordersScanned, balesRepaired, changedOrderIds, errors });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENT TYPES ───────
}
