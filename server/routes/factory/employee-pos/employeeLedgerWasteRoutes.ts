import { getClientDate } from "../../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { classifyNetPositionAccounts } from "../../../netPositionHelper";
import { buildBrokerStatement } from "../suppliers/supplierBrokerRoutes";
import { adjustInventory } from "../../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
} from "../_helpers";
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
  propertyContracts, propertyMonthlyLedger, propertyPayments,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sqlArray } from "../../../lib/sqlArray";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";


export function registerEmployeeLedgerWasteRoutes(app: Express) {
  app.get("/api/factory/bale-ledger", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Load all relevant data
      const [allBalesRaw, allProducts, allCategories, pendingOrderBaleIdsRaw] = await Promise.all([
        db.execute(sql`
          SELECT
            fb.id,
            fb.product_id AS "productId",
            fb.product_name AS "productName",
            fb.article_code AS "articleCode",
            fb.status,
            fb.reference_number AS "referenceNumber",
            COALESCE(fb.weight_kg, 0)::float AS "weightKg",
            COALESCE(fb.total_cost, 0)::float AS "totalCost",
            fb.waste_dispatch_id AS "wasteDispatchId"
          FROM factory_bales fb
          WHERE fb.company_id = ${companyId}
          AND fb.status IN ('IN_STOCK', 'FINALIZED', 'SOLD', 'DISPATCHED', 'RESERVED_FOR_ORDER')
        `),
        db.select({ id: factoryBaleProducts.id, name: factoryBaleProducts.name, articleCode: factoryBaleProducts.articleCode, categoryId: factoryBaleProducts.categoryId, productionPrice: factoryBaleProducts.productionPrice }).from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId)),
        db.select({ id: factoryCategories.id, name: factoryCategories.name }).from(factoryCategories).where(eq(factoryCategories.companyId, companyId)),
        // Bale IDs linked to orders currently in LOADING / PENDING_VERIFICATION / VERIFIED
        db.execute(sql`
          SELECT DISTINCT cob.bale_id AS "baleId"
          FROM customer_order_bales cob
          INNER JOIN customer_orders co ON co.id = cob.order_id
          WHERE co.company_id = ${companyId}
          AND co.status IN ('LOADING', 'PENDING_VERIFICATION', 'VERIFIED')
        `),
      ]);

      const allBales: any[] = Array.isArray(allBalesRaw) ? allBalesRaw : (allBalesRaw as any).rows || [];
      const pendingOrderBaleIds = new Set<number>(
        (Array.isArray(pendingOrderBaleIdsRaw) ? pendingOrderBaleIdsRaw : (pendingOrderBaleIdsRaw as any).rows || [])
          .map((r: any) => Number(r.baleId))
      );

      // Identify waste categories (garbage or wiper)
      const wasteCategories = new Set<number>(
        allCategories
          .filter((c: any) => {
            const n = (c.name || "").toLowerCase();
            return n.includes("garbage") || n.includes("wiper");
          })
          .map((c: any) => c.id)
      );

      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const categoryMap = new Map(allCategories.map((c: any) => [c.id, c]));

      function isWasteProduct(productId: number | null, articleCode?: string | null): boolean {
        if (articleCode?.startsWith("HMD16")) return true;
        if (!productId) return false;
        const p = productMap.get(productId);
        if (!p) return false;
        return p.categoryId ? wasteCategories.has(p.categoryId) : false;
      }

      function getProductLabel(bale: any): { productName: string; articleCode: string; categoryName: string; productId: number | null } {
        const p = bale.productId ? productMap.get(bale.productId) : null;
        const cat = p?.categoryId ? categoryMap.get(p.categoryId) : null;
        return {
          productName: p?.name || bale.productName || bale.articleCode || "Unknown",
          articleCode: p?.articleCode || bale.articleCode || "—",
          categoryName: cat?.name || "—",
          productId: bale.productId || null,
        };
      }

      // Use production (cost) price per bale from product
      function getSellingPrice(bale: any): number {
        const p = bale.productId ? productMap.get(bale.productId) : null;
        return parseFloat(p?.productionPrice || "0") || 0;
      }

      // Group bales into buckets
      type BaleDetail = { ref: string; weightKg: number; totalCost: number };
      type BucketRow = { productId: number | null; productName: string; articleCode: string; categoryName: string; baleCount: number; totalWeightKg: number; totalCost: number; baleDetails: BaleDetail[] };
      const buckets: { currentStock: Map<string, BucketRow>; wasteStock: Map<string, BucketRow>; sold: Map<string, BucketRow>; wasteDispatched: Map<string, BucketRow>; pendingLoading: Map<string, BucketRow> } = {
        currentStock: new Map(),
        wasteStock: new Map(),
        sold: new Map(),
        wasteDispatched: new Map(),
        pendingLoading: new Map(),
      };

      function addToBucket(bucket: Map<string, BucketRow>, key: string, label: ReturnType<typeof getProductLabel>, bale: any) {
        const existing = bucket.get(key);
        const w = parseFloat(bale.weightKg) || 0;
        const c = getSellingPrice(bale); // selling price replaces cost
        const ref: string = bale.referenceNumber || "";
        const detail: BaleDetail = { ref, weightKg: w, totalCost: c };
        if (existing) {
          existing.baleCount++;
          existing.totalWeightKg += w;
          existing.totalCost += c;
          existing.baleDetails.push(detail);
        } else {
          bucket.set(key, { ...label, baleCount: 1, totalWeightKg: w, totalCost: c, baleDetails: [detail] });
        }
      }

      for (const bale of allBales) {
        const label = getProductLabel(bale);
        const key = `${bale.productId ?? "null"}-${label.productName}`;
        const waste = isWasteProduct(bale.productId, bale.articleCode);

        if (bale.status === "SOLD") {
          if (pendingOrderBaleIds.has(Number(bale.id))) {
            // SOLD but still linked to a PENDING_VERIFICATION or VERIFIED order (not yet shipped/finalized)
            addToBucket(buckets.pendingLoading, key, label, bale);
          } else {
            addToBucket(buckets.sold, key, label, bale);
          }
        } else if (bale.status === "DISPATCHED" && bale.wasteDispatchId) {
          addToBucket(buckets.wasteDispatched, key, label, bale);
        } else if (bale.status === "RESERVED_FOR_ORDER") {
          // Bale is physically reserved/scanned into a loading order
          addToBucket(buckets.pendingLoading, key, label, bale);
        } else if (bale.status === "IN_STOCK" || bale.status === "FINALIZED") {
          if (pendingOrderBaleIds.has(Number(bale.id))) {
            // Bale is linked to a LOADING/PENDING_VERIFICATION/VERIFIED order but not yet reserved
            addToBucket(buckets.pendingLoading, key, label, bale);
          } else if (waste) {
            addToBucket(buckets.wasteStock, key, label, bale);
          } else {
            addToBucket(buckets.currentStock, key, label, bale);
          }
        }
      }

      function bucketToArray(m: Map<string, BucketRow>) {
        return Array.from(m.values()).sort((a, b) => {
          const catCmp = a.categoryName.localeCompare(b.categoryName);
          if (catCmp !== 0) return catCmp;
          return a.productName.localeCompare(b.productName);
        });
      }

      function sumBucket(rows: BucketRow[]) {
        return rows.reduce((acc, r) => ({
          baleCount: acc.baleCount + r.baleCount,
          totalWeightKg: acc.totalWeightKg + r.totalWeightKg,
          totalCost: acc.totalCost + r.totalCost,
        }), { baleCount: 0, totalWeightKg: 0, totalCost: 0 });
      }

      const currentStock = bucketToArray(buckets.currentStock);
      const wasteStock = bucketToArray(buckets.wasteStock);
      const sold = bucketToArray(buckets.sold);
      const wasteDispatched = bucketToArray(buckets.wasteDispatched);
      const pendingLoading = bucketToArray(buckets.pendingLoading);

      res.json({
        currentStock,
        wasteStock,
        sold,
        wasteDispatched,
        pendingLoading,
        totals: {
          currentStock: sumBucket(currentStock),
          wasteStock: sumBucket(wasteStock),
          sold: sumBucket(sold),
          wasteDispatched: sumBucket(wasteDispatched),
          pendingLoading: sumBucket(pendingLoading),
          grand: sumBucket([...currentStock, ...wasteStock, ...sold, ...wasteDispatched, ...pendingLoading]),
        },
      });
    } catch (error: any) {
      console.error("Error fetching bale ledger:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // WASTE DISPATCH ROUTES — factory bale waste disposal
  // ============================================================

  app.get("/api/factory/waste-dispatch/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const search = (req.query.search as string) || "";

      const allCategories = await db.select().from(factoryCategories).where(eq(factoryCategories.companyId, companyId));
      const wasteCategories = allCategories.filter((c: any) => {
        const name = (c.name || "").toLowerCase();
        return name.includes("garbage") || name.includes("wiper");
      });
      const wasteCategoryIds = new Set(wasteCategories.map((c: any) => c.id));

      const allProducts = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const wasteProductIds = new Set(
        allProducts
          .filter((p: any) => {
            if (p.categoryId && wasteCategoryIds.has(p.categoryId)) return true;
            if (p.articleCode?.startsWith("HMD16")) return true;
            return false;
          })
          .map((p: any) => p.id)
      );

      if (wasteProductIds.size === 0) {
        return res.json({ bales: [], categories: wasteCategories });
      }

      const baleRows = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "IN_STOCK"),
            inArray(factoryBales.productId, Array.from(wasteProductIds) as number[])
          )
        )
        .orderBy(desc(factoryBales.id));

      const productMap = new Map(allProducts.map((p: any) => [p.id, p]));
      const categoryMap = new Map(allCategories.map((c: any) => [c.id, c]));

      const locationIds = [...new Set(baleRows.map((b: any) => b.erpLocationId).filter(Boolean))] as number[];
      const locationRows = locationIds.length > 0
        ? await db.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, locationIds))
        : [];
      const locationMap = new Map(locationRows.map((l: any) => [l.id, l.name]));

      const enriched = baleRows.map((b: any) => {
        const product = productMap.get(b.productId as number);
        const cat = product?.categoryId ? categoryMap.get(product.categoryId) : null;
        return {
          id: b.id,
          referenceNumber: b.referenceNumber,
          productName: product?.name || product?.articleCode || b.productName || "Unknown",
          articleCode: b.articleCode || product?.articleCode,
          categoryName: cat?.name || b.category || "—",
          weightKg: parseFloat(b.weightKg as string) || 0,
          costPerKg: parseFloat(b.costPerKg as string) || 0,
          totalCost: parseFloat(b.totalCost as string) || 0,
          status: b.status,
          locationName: b.erpLocationId ? (locationMap.get(b.erpLocationId) || "Unknown") : "No Location",
          locationId: b.erpLocationId,
          finalizedAt: b.finalizedAt,
        };
      });

      const filtered = search
        ? enriched.filter((b: any) => {
            const s = search.toLowerCase();
            return (
              b.referenceNumber?.toLowerCase().includes(s) ||
              b.productName?.toLowerCase().includes(s) ||
              b.articleCode?.toLowerCase().includes(s) ||
              b.categoryName?.toLowerCase().includes(s) ||
              b.locationName?.toLowerCase().includes(s)
            );
          })
        : enriched;

      res.json({ bales: filtered, categories: wasteCategories });
    } catch (error: any) {
      console.error("Error fetching waste bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/waste-dispatch/history", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dispatches = await db
        .select()
        .from(factoryBaleWasteDispatches)
        .where(eq(factoryBaleWasteDispatches.companyId, companyId))
        .orderBy(desc(factoryBaleWasteDispatches.id));

      // Fetch all removed bales for this company that have a waste_dispatch_id set.
      // Using raw SQL to avoid Drizzle array serialization issues with ANY().
      const linkedBalesRaw = await db.execute(sql`
        SELECT
          id,
          reference_number       AS "referenceNumber",
          product_name           AS "productName",
          COALESCE(weight_kg, 0)::float   AS "weightKg",
          COALESCE(total_cost, 0)::float  AS "totalCost",
          waste_dispatch_id      AS "wasteDispatchId"
        FROM factory_bales
        WHERE company_id = ${companyId}
          AND waste_dispatch_id IS NOT NULL
        ORDER BY waste_dispatch_id, id
      `);
      const linkedBales: any[] = Array.isArray(linkedBalesRaw)
        ? linkedBalesRaw
        : (linkedBalesRaw as any).rows || [];

      const balesByDispatch = new Map<number, any[]>();
      for (const bale of linkedBales) {
        const did = Number(bale.wasteDispatchId);
        if (!balesByDispatch.has(did)) balesByDispatch.set(did, []);
        balesByDispatch.get(did)!.push(bale);
      }

      res.json(dispatches.map((d: any) => ({
        ...d,
        bales: balesByDispatch.get(d.id) || [],
      })));
    } catch (error: any) {
      console.error("Error fetching waste dispatch history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/waste-dispatch/submit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { baleIds, dispatchDate, notes } = req.body;
      if (!baleIds || !Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds array is required" });
      }
      if (!dispatchDate) {
        return res.status(400).json({ message: "dispatchDate is required" });
      }

      const userId = (req.session as any).user?.id || null;

      const [lastDispatch] = await db
        .select({ dispatchNumber: factoryBaleWasteDispatches.dispatchNumber })
        .from(factoryBaleWasteDispatches)
        .where(eq(factoryBaleWasteDispatches.companyId, companyId))
        .orderBy(desc(factoryBaleWasteDispatches.id))
        .limit(1);

      let nextNum = 1;
      if (lastDispatch?.dispatchNumber) {
        const parts = lastDispatch.dispatchNumber.split("-");
        const last = parseInt(parts[parts.length - 1] || "0", 10);
        if (!isNaN(last)) nextNum = last + 1;
      }
      const dispatchNumber = `WD-${String(nextNum).padStart(4, "0")}`;

      const result = await db.transaction(async (tx: any) => {
        const balesToDispose = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

        if (balesToDispose.length === 0) throw new Error("No valid bales found");

        for (const bale of balesToDispose) {
          if (bale.status !== "IN_STOCK") {
            throw new Error(`Bale ${bale.referenceNumber} is not available (status: ${bale.status})`);
          }
        }

        let totalWeightKg = 0;
        let totalCostWrittenOff = 0;
        for (const bale of balesToDispose) {
          totalWeightKg += parseFloat(bale.weightKg as string) || 0;
          totalCostWrittenOff += parseFloat(bale.totalCost as string) || 0;
        }

        const [dispatch] = await tx.insert(factoryBaleWasteDispatches).values({
          companyId,
          dispatchNumber,
          dispatchDate,
          notes: notes || null,
          totalBales: balesToDispose.length,
          totalWeightKg: totalWeightKg.toFixed(3),
          totalCostWrittenOff: totalCostWrittenOff.toFixed(2),
          createdBy: userId,
        }).returning();

        const now = new Date();

        const productIds = [...new Set(balesToDispose.map((b: any) => b.productId).filter(Boolean))] as number[];
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
        const productMap = new Map(factoryProducts.map((p: any) => [p.id, p]));
        const stockItemCache = new Map<string, number>();

        for (const bale of balesToDispose) {
          await tx.execute(sql`UPDATE factory_bales SET status = 'DISPATCHED', waste_dispatch_id = ${dispatch.id}, updated_at = ${now} WHERE id = ${bale.id}`);

          const product = productMap.get(bale.productId as number);
          const itemCode = product?.articleCode || product?.code || bale.articleCode || bale.baleCode;
          if (itemCode && bale.erpLocationId) {
            let erpStockItemId = stockItemCache.get(itemCode);
            if (!erpStockItemId) {
              const [existing] = await tx.select({ id: stockItems.id }).from(stockItems)
                .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));
              if (existing) {
                erpStockItemId = existing.id;
                stockItemCache.set(itemCode, erpStockItemId!);
              }
            }
            if (erpStockItemId) {
              await adjustInventory(tx, bale.erpLocationId, erpStockItemId, -1, companyId);
            }
          }
        }

        return { dispatch, totalWeightKg, totalCostWrittenOff, bales: balesToDispose };
      });

      await writeDaybookEntry(db, {
        companyId,
        txDate: dispatchDate,
        txType: "WASTE_DISPOSAL",
        referenceId: result.dispatch.id,
        referenceTable: "factory_bale_waste_dispatches",
        description: `Waste disposal ${dispatchNumber}: ${result.bales.length} bale(s), ${result.totalWeightKg.toFixed(1)} kg written off.${notes ? " " + notes : ""}`,
        amountCurrency: result.totalCostWrittenOff,
        amountUsd: result.totalCostWrittenOff,
        createdBy: userId,
      });

      res.json({
        dispatch: result.dispatch,
        totalBales: result.bales.length,
        totalWeightKg: result.totalWeightKg,
        totalCostWrittenOff: result.totalCostWrittenOff,
        bales: result.bales.map((b: any) => ({
          id: b.id,
          referenceNumber: b.referenceNumber,
          weightKg: parseFloat(b.weightKg as string) || 0,
          totalCost: parseFloat(b.totalCost as string) || 0,
        })),
      });
    } catch (error: any) {
      console.error("Error submitting waste dispatch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ─── Factory POS ────────────────────────────────────────────────────────────

  // GET /api/factory/pos/sales — list factory POS sales
}
