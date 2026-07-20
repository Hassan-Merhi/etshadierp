import { logAudit } from "../helpers/auditHelpers";
import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";

// ---------------------------------------------------------------------------
// Lightweight in-process TTL cache for expensive dashboard KPI endpoint
// ---------------------------------------------------------------------------
const _kpiCache = new Map<string, { data: any; expiresAt: number }>();
function _getKpiCached(key: string): any | null {
  const e = _kpiCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _kpiCache.delete(key);
    return null;
  }
  return e.data;
}
function _setKpiCached(key: string, data: any, ttlMs = 30_000): void {
  _kpiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (_kpiCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _kpiCache) {
      if (v.expiresAt < now) _kpiCache.delete(k);
    }
  }
}
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry,
  getOrFetchFxRateToUsd,
  getOrCreateLedgerAccount,
  isLegacySHA256Hash,
  verifySupervisorPassword,
  getUserHideAllCosts,
  checkFactoryAdmin,
} from "./_helpers";
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
  factoryBaleImportBatches,
  factoryV3LoadBales,
  factoryInvoiceLoadingBales,
} from "@shared/schema";
import { eq, and, or, asc, desc, sql, inArray, ilike, ne, isNull, not, gte, lte, lt, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";

import { registerFactoryMixBatchRoutes } from "./factoryMixBatchRoutes";
import { registerFactoryBaleExportRoutes } from "./factoryBaleExportRoutes";

export function registerFactoryBalesRoutes(app: Express) {
  registerFactoryMixBatchRoutes(app);
  registerFactoryBaleExportRoutes(app);
  app.post("/api/factory/pressing/create-and-print", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, quantity, weightPerBale } = req.body;
      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "productId, quantity, and weightPerBale are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [product] = await tx
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

        if (!product) throw new Error("Product not found");

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId,
            expectedCount: quantity,
            status: "PENDING",
          })
          .returning();

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + quantity })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 200000;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 200000 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `REF${String(nextNumber + i).padStart(6, "0")}`;
          const [bale] = await tx
            .insert(factoryBales)
            .values({
              companyId,
              pressingBatchId: pressingBatch.id,
              productId,
              baleCode: product.code,
              referenceNumber: refNum,
              articleCode: product.articleCode,
              productName: product.name,
              weightKg: String(weightPerBale),
              sellingPrice: String(product.productionPrice || "0"),
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = req.body.txDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_PRESSING",
        referenceId: result.pressingBatchId,
        description: `Pressing batch created: ${result.bales?.length || 0} bales`,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/pressing/create-multi", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required with at least one entry" });
      }

      const result = await db.transaction(async (tx: any) => {
        const totalExpected = items.reduce((sum: number, item: any) => sum + parseInt(item.quantity || item.qty), 0);

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId: items[0].productId,
            expectedCount: totalExpected,
            status: "PENDING",
          })
          .returning();

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + totalExpected })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 200000;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 200000 + totalExpected,
          });
        }

        const bales: any[] = [];
        let baleIndex = 0;

        for (const item of items) {
          const qty = parseInt(item.quantity || item.qty);
          const weight = item.weightPerBale;

          const [product] = await tx
            .select()
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.id, item.productId), eq(factoryBaleProducts.companyId, companyId)));

          if (!product) throw new Error(`Product ID ${item.productId} not found`);

          for (let i = 0; i < qty; i++) {
            const refNum = `REF${String(nextNumber + baleIndex).padStart(6, "0")}`;
            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                pressingBatchId: pressingBatch.id,
                productId: item.productId,
                baleCode: product.code,
                referenceNumber: refNum,
                articleCode: product.articleCode,
                productName: product.name,
                weightKg: String(weight),
                sellingPrice: String(product.productionPrice || "0"),
                status: "PENDING_PRESSING",
              })
              .returning();
            bales.push({ ...bale, _product: product });
            baleIndex++;
          }
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = req.body.txDate || getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_PRESSING",
        referenceId: result.pressingBatchId,
        description: `Multi-product pressing batch: ${result.bales?.length || 0} bales`,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating multi-product pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/create-batch", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, quantity, weightPerBale } = req.body;
      if (!productId || !quantity || !weightPerBale) {
        return res.status(400).json({ message: "productId, quantity, and weightPerBale are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [product] = await tx
          .select()
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

        if (!product) throw new Error("Product not found");

        const [pressingBatch] = await tx
          .insert(factoryPressingBatches)
          .values({
            companyId,
            productId,
            expectedCount: quantity,
            status: "PENDING",
          })
          .returning();

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + quantity })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 200000;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 200000 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `REF${String(nextNumber + i).padStart(6, "0")}`;
          const [bale] = await tx
            .insert(factoryBales)
            .values({
              companyId,
              pressingBatchId: pressingBatch.id,
              productId,
              baleCode: product.code,
              referenceNumber: refNum,
              articleCode: product.articleCode,
              productName: product.name,
              weightKg: String(weightPerBale),
              sellingPrice: String(product.productionPrice || "0"),
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating bale batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 8. Factory Pressing Batches
  // ───────────────────────────────────────────────

  app.get("/api/factory/pressing-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batches = await db
        .select({
          id: factoryPressingBatches.id,
          companyId: factoryPressingBatches.companyId,
          mixBatchId: factoryPressingBatches.mixBatchId,
          productId: factoryPressingBatches.productId,
          expectedCount: factoryPressingBatches.expectedCount,
          status: factoryPressingBatches.status,
          notes: factoryPressingBatches.notes,
          createdBy: factoryPressingBatches.createdBy,
          finalizedAt: factoryPressingBatches.finalizedAt,
          finalizedLocationId: factoryPressingBatches.finalizedLocationId,
          createdAt: factoryPressingBatches.createdAt,
          productName: factoryBaleProducts.name,
          productCode: factoryBaleProducts.code,
          articleCode: factoryBaleProducts.articleCode,
        })
        .from(factoryPressingBatches)
        .leftJoin(factoryBaleProducts, eq(factoryPressingBatches.productId, factoryBaleProducts.id))
        .where(eq(factoryPressingBatches.companyId, companyId))
        .orderBy(desc(factoryPressingBatches.createdAt));

      const enriched = await Promise.all(
        batches.map(async (batch: any) => {
          const balesForBatch = await db
            .select()
            .from(factoryBales)
            .where(eq(factoryBales.pressingBatchId, batch.id))
            .orderBy(factoryBales.referenceNumber);

          const pendingCount = balesForBatch.filter((b: any) => b.status === "PENDING_PRESSING").length;
          const finalizedCount = balesForBatch.filter((b: any) => b.status === "IN_STOCK").length;

          return { ...batch, pendingCount, finalizedCount, bales: balesForBatch };
        })
      );

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching pressing batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/pressing-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const [batch] = await db
        .select()
        .from(factoryPressingBatches)
        .where(and(eq(factoryPressingBatches.id, id), eq(factoryPressingBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Pressing batch not found" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.pressingBatchId, id))
        .orderBy(factoryBales.referenceNumber);

      res.json({ ...batch, bales });
    } catch (error: any) {
      console.error("Error fetching pressing batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 9. Factory Finalize
  // ───────────────────────────────────────────────

  app.post("/api/factory/finalize", requireAuth, async (req: any, res: any) => {
    try {
      if (!checkFactoryAdmin(req, res)) return;
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pressingBatchId, scannedBaleIds, erpLocationId, mixBatchId } = req.body;

      if (!pressingBatchId || !scannedBaleIds || !erpLocationId || !mixBatchId) {
        return res
          .status(400)
          .json({ message: "pressingBatchId, scannedBaleIds, erpLocationId, and mixBatchId are required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const [pressingBatch] = await tx
          .select()
          .from(factoryPressingBatches)
          .where(and(eq(factoryPressingBatches.id, pressingBatchId), eq(factoryPressingBatches.companyId, companyId)));

        if (!pressingBatch) throw new Error("Pressing batch not found");
        if (pressingBatch.status === "FINALIZED") throw new Error("Pressing batch is already fully finalized");

        const [mixBatch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)))
          .for("update");

        if (!mixBatch) throw new Error("Mix batch not found");

        const mixRemaining = parseFloat(mixBatch.totalWeightKg) - parseFloat(mixBatch.usedKg);

        const pendingBales = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.pressingBatchId, pressingBatchId), eq(factoryBales.status, "PENDING_PRESSING")));

        const scannedSet = new Set(scannedBaleIds);
        const pendingBaleIds = new Set(pendingBales.map((b: any) => b.id));
        for (const scannedId of scannedBaleIds) {
          if (!pendingBaleIds.has(scannedId)) {
            throw new Error(`Bale ID ${scannedId} is not a valid pending bale for this pressing batch`);
          }
        }

        const balesToFinalize = pendingBales.filter((b: any) => scannedSet.has(b.id));
        const missingBales = pendingBales.filter((b: any) => !scannedSet.has(b.id));

        let totalWeight = 0;
        for (const bale of balesToFinalize) {
          totalWeight += parseFloat(bale.weightKg);
        }

        if (totalWeight > mixRemaining + 0.001) {
          throw new Error(
            `Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`
          );
        }

        // Derive bale cost from raw stock source prices (not mix batch blended cost).
        // This ensures duty updates after mix batch creation are reflected in bale costs.
        const mixSources = await tx
          .select({
            weightKg: factoryMixBatchSources.weightKg,
            costPerKg: factoryMixBatchSources.costPerKg,
            containerId: factoryMixBatchSources.containerId,
          })
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, mixBatchId));

        let costPerKg: number;
        if (mixSources.length > 0) {
          const sourceContainerIds = mixSources.map((s: any) => s.containerId).filter(Boolean) as number[];
          const rawStockCostMap: Record<number, number> = {};
          if (sourceContainerIds.length > 0) {
            const rawStockRecs = await tx
              .select({ containerId: factoryRawStock.containerId, costPerKg: factoryRawStock.costPerKg })
              .from(factoryRawStock)
              .where(inArray(factoryRawStock.containerId, sourceContainerIds));
            for (const r of rawStockRecs) {
              rawStockCostMap[r.containerId] = parseFloat(r.costPerKg);
            }
          }
          let sourceTotalCost = 0;
          let sourceTotalWeight = 0;
          for (const src of mixSources) {
            const w = parseFloat(src.weightKg);
            const c =
              src.containerId && rawStockCostMap[src.containerId] !== undefined
                ? rawStockCostMap[src.containerId]
                : parseFloat(src.costPerKg);
            sourceTotalCost += w * c;
            sourceTotalWeight += w;
          }
          costPerKg = sourceTotalWeight > 0 ? sourceTotalCost / sourceTotalWeight : parseFloat(mixBatch.costPerKg);
        } else {
          costPerKg = parseFloat(mixBatch.costPerKg);
        }

        const now = new Date();
        const updatedBales: any[] = [];

        for (const bale of balesToFinalize) {
          const weight = parseFloat(bale.weightKg);
          const baleTotalCost = weight * costPerKg;

          const [updated] = await tx
            .update(factoryBales)
            .set({
              status: "IN_STOCK",
              erpLocationId,
              mixBatchId,
              costPerKg: String(costPerKg),
              totalCost: String(baleTotalCost),
              finalizedAt: now,
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id))
            .returning();

          updatedBales.push(updated);
        }

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalWeight}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));

        const isFullyFinalized = missingBales.length === 0;
        await tx
          .update(factoryPressingBatches)
          .set({
            status: isFullyFinalized ? "FINALIZED" : "PARTIALLY_FINALIZED",
            mixBatchId,
            finalizedAt: isFullyFinalized ? now : null,
            finalizedLocationId: erpLocationId,
          })
          .where(eq(factoryPressingBatches.id, pressingBatchId));

        const productIds: number[] = [];
        for (const b of balesToFinalize) {
          if (b.productId && !productIds.includes(b.productId)) productIds.push(b.productId);
        }
        const factoryProducts =
          productIds.length > 0
            ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
            : [];

        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const categoryIdSet = new Set<number>();
        factoryProducts.forEach((p: any) => {
          if (p.categoryId) categoryIdSet.add(p.categoryId);
        });
        const categoryIds = Array.from(categoryIdSet);
        const factoryCats =
          categoryIds.length > 0
            ? await tx.select().from(factoryCategories).where(inArray(factoryCategories.id, categoryIds))
            : [];
        const categoryMap = new Map<number, any>(factoryCats.map((c: any) => [c.id, c]));

        const stockGroupCache = new Map<string, number>();

        const stockItemCache = new Map<string, number>();

        for (const bale of balesToFinalize) {
          const factoryProduct = productMap.get(bale.productId as number);
          if (!factoryProduct) continue;

          const itemCode: string = factoryProduct.articleCode || factoryProduct.code;
          if (!itemCode) continue;

          let stockGroupId: number | null = null;
          if (factoryProduct.categoryId) {
            const cat = categoryMap.get(factoryProduct.categoryId);
            if (cat) {
              const catName = cat.name as string;
              const catId = (cat as any).id as number;
              const cacheKey = String(catId || catName);
              const cached = stockGroupCache.get(cacheKey);
              if (cached) {
                stockGroupId = cached;
              } else {
                const [existingGroup] = await tx
                  .select({ id: stockGroups.id })
                  .from(stockGroups)
                  .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.name, catName)));

                if (existingGroup) {
                  stockGroupId = existingGroup.id;
                } else {
                  // Use the category's own ID for a collision-free code
                  const groupCode = catId
                    ? `FCAT-${catId}`
                    : "F-" +
                      catName
                        .replace(/[^A-Z0-9]/gi, "")
                        .substring(0, 10)
                        .toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .onConflictDoNothing()
                    .returning({ id: stockGroups.id });
                  if (created) {
                    stockGroupId = created.id;
                  } else {
                    const [byCode] = await tx
                      .select({ id: stockGroups.id })
                      .from(stockGroups)
                      .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.code, groupCode)));
                    stockGroupId = byCode?.id;
                  }
                }
                stockGroupCache.set(cacheKey, stockGroupId!);
              }
            }
          }

          let erpStockItemId: number | undefined = stockItemCache.get(itemCode);

          if (!erpStockItemId) {
            const [existing] = await tx
              .select({ id: stockItems.id, stockGroupId: stockItems.stockGroupId })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

            if (existing) {
              erpStockItemId = existing.id;
              if (stockGroupId && !existing.stockGroupId) {
                await tx.update(stockItems).set({ stockGroupId }).where(eq(stockItems.id, existing.id));
              }
            } else {
              const [created] = await tx
                .insert(stockItems)
                .values({
                  companyId,
                  code: itemCode,
                  name: factoryProduct.name as string,
                  uom: "BALE",
                  active: true,
                  ...(stockGroupId ? { stockGroupId } : {}),
                })
                .returning({ id: stockItems.id });
              erpStockItemId = created.id;
            }
            stockItemCache.set(itemCode, erpStockItemId!);
          }

          const weight = parseFloat(bale.weightKg);
          const baleCostPerKg = parseFloat(bale.costPerKg || "0");
          const baleRate = weight * baleCostPerKg;

          await adjustInventory(tx, erpLocationId, erpStockItemId!, 1, companyId, baleRate);
        }

        return {
          updated: updatedBales.length,
          bales: updatedBales,
          missingBales: missingBales.map((b: any) => ({
            id: b.id,
            referenceNumber: b.referenceNumber,
            productName: b.productName,
            articleCode: b.articleCode,
            weightKg: b.weightKg,
          })),
          isFullyFinalized,
        };
      });

      const today = req.body.txDate || getClientDate(req);
      const [finalizeLocation] = await db
        .select({ name: locations.name })
        .from(locations)
        .where(eq(locations.id, erpLocationId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_FINALIZE",
        referenceId: pressingBatchId,
        description: `Finalized ${result.updated} bale${result.updated !== 1 ? "s" : ""} to ${finalizeLocation?.name || `location #${erpLocationId}`}`,
        amountCurrency: 0,
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error finalizing pressing batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Backfill historical bale costs from raw stock source prices
  app.post("/api/factory/bales/backfill-costs", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const balesWithMix = await db
        .select({
          id: factoryBales.id,
          weightKg: factoryBales.weightKg,
          mixBatchId: factoryBales.mixBatchId,
          articleCode: factoryBales.articleCode,
        })
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "IN_STOCK"),
            sql`${factoryBales.mixBatchId} IS NOT NULL`
          )
        );

      if (balesWithMix.length === 0) return res.json({ updated: 0 });

      const uniqueMixIds = [...new Set(balesWithMix.map((b: any) => b.mixBatchId))] as number[];

      const allSources = await db
        .select({
          mixBatchId: factoryMixBatchSources.mixBatchId,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          containerId: factoryMixBatchSources.containerId,
        })
        .from(factoryMixBatchSources)
        .where(inArray(factoryMixBatchSources.mixBatchId, uniqueMixIds));

      const allContainerIds = [...new Set(allSources.map((s: any) => s.containerId).filter(Boolean))] as number[];
      const rawStockCostMap: Record<number, number> = {};
      if (allContainerIds.length > 0) {
        const rawStockRecs = await db
          .select({ containerId: factoryRawStock.containerId, costPerKg: factoryRawStock.costPerKg })
          .from(factoryRawStock)
          .where(inArray(factoryRawStock.containerId, allContainerIds));
        for (const r of rawStockRecs) {
          rawStockCostMap[r.containerId] = parseFloat(r.costPerKg);
        }
      }

      const mixCostMap: Record<number, number> = {};
      for (const mixId of uniqueMixIds) {
        const sources = allSources.filter((s: any) => s.mixBatchId === mixId);
        if (sources.length === 0) continue;
        let totalCost = 0,
          totalWt = 0;
        for (const src of sources) {
          const w = parseFloat(src.weightKg);
          const c =
            src.containerId && rawStockCostMap[src.containerId] !== undefined
              ? rawStockCostMap[src.containerId]
              : parseFloat(src.costPerKg);
          totalCost += w * c;
          totalWt += w;
        }
        if (totalWt > 0) mixCostMap[mixId] = totalCost / totalWt;
      }

      let updated = 0;
      const now = new Date();
      for (const bale of balesWithMix) {
        const isGarbage = bale.articleCode?.startsWith("HMD16");
        if (isGarbage) continue;
        const newCost = bale.mixBatchId ? mixCostMap[bale.mixBatchId] : undefined;
        if (newCost === undefined) continue;
        const newTotal = parseFloat(bale.weightKg) * newCost;
        await db
          .update(factoryBales)
          .set({ costPerKg: String(newCost), totalCost: String(newTotal), updatedAt: now })
          .where(eq(factoryBales.id, bale.id));
        updated++;
      }

      res.json({ updated, message: `Updated cost for ${updated} finalized bales using raw stock prices.` });
    } catch (error: any) {
      console.error("Error backfilling bale costs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 10. Factory Bales queries
  // ───────────────────────────────────────────────

  app.get("/api/factory/bales/export-full.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { date } = req.query;
      if (!date) return res.status(400).json({ message: "date query parameter is required (YYYY-MM-DD)" });

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        sql`${factoryBales.finalizedAt}::date = ${date}`,
      ];

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(factoryBales.id);

      if (bales.length === 0) {
        return res.status(404).json({ message: `No bales found for date ${date}` });
      }

      const locIds = [...new Set(bales.map((b: any) => b.erpLocationId).filter(Boolean))];
      const locs = locIds.length > 0 ? await db.select().from(locations).where(inArray(locations.id, locIds)) : [];
      const locMap = new Map(locs.map((l: any) => [l.id, l]));

      const [fCfgBale] = await db
        .select({ hideAvgCost: factorySettings.hideAvgCost })
        .from(factorySettings)
        .where(eq(factorySettings.companyId, companyId))
        .limit(1);
      const userHideAllCosts = await getUserHideAllCosts(req);
      const showCostBale = !fCfgBale?.hideAvgCost && !userHideAllCosts;

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Bales");

      const baleCols: any[] = [
        { header: "Reference Number", key: "referenceNumber", width: 22 },
        { header: "Article Code", key: "articleCode", width: 20 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Category", key: "category", width: 18 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (showCostBale) {
        baleCols.push({ header: "Cost Per Kg", key: "costPerKg", width: 14 });
        baleCols.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      baleCols.push(
        { header: "Location Code", key: "locationCode", width: 16 },
        { header: "Location ID", key: "locationId", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Mix Batch ID", key: "mixBatchId", width: 14 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Finalized At", key: "finalizedAt", width: 22 }
      );
      sheet.columns = baleCols;

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      });

      for (const bale of bales) {
        const loc = locMap.get(bale.erpLocationId);
        const baleRowData: any = {
          referenceNumber: bale.referenceNumber,
          articleCode: bale.articleCode ?? "",
          productName: bale.productName ?? "",
          category: bale.category ?? "",
          weightKg: parseFloat(bale.weightKg || "0"),
        };
        if (showCostBale) {
          baleRowData.costPerKg = parseFloat(bale.costPerKg || "0");
          baleRowData.totalCost = parseFloat(bale.totalCost || "0");
        }
        baleRowData.locationCode = loc ? `${loc.code} - ${loc.name}` : "";
        baleRowData.locationId = bale.erpLocationId ?? "";
        baleRowData.status = bale.status ?? "IN_STOCK";
        baleRowData.mixBatchId = bale.mixBatchId ?? "";
        baleRowData.baleCode = bale.baleCode ?? "";
        baleRowData.grade = bale.grade ?? "";
        baleRowData.finalizedAt = bale.finalizedAt ? new Date(bale.finalizedAt).toISOString() : "";
        sheet.addRow(baleRowData);
      }

      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bales_export_${date}.xlsx"`);
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      console.error("Error exporting full bales:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/bales/stock-register.xlsx — Full stock register: all bales, all statuses
  app.get("/api/factory/bales/stock-register.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { from, to } = req.query as { from?: string; to?: string };

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        not(inArray(factoryBales.status, ["DELETED", "REMOVED"])),
      ];
      if (from)
        conditions.push(
          sql`COALESCE(${factoryBales.stockEntryDate}, ${factoryBales.createdAt}::date) >= ${from}::date`
        );
      if (to)
        conditions.push(sql`COALESCE(${factoryBales.stockEntryDate}, ${factoryBales.createdAt}::date) <= ${to}::date`);

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(factoryBales.createdAt);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Factory ERP";
      workbook.created = new Date();

      // ── Sheet 1: All Bales ──
      const sheet = workbook.addWorksheet("Stock Register");

      sheet.columns = [
        { header: "Reference Number", key: "referenceNumber", width: 24 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Category", key: "category", width: 18 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (KG)", key: "weightKg", width: 14 },
        { header: "Status", key: "status", width: 18 },
        { header: "Stock Entry Date", key: "stockEntryDate", width: 18 },
        { header: "Created At", key: "createdAt", width: 22 },
        { header: "Pressed At", key: "pressedAt", width: 22 },
        { header: "Finalized At", key: "finalizedAt", width: 22 },
      ];

      // Style header row
      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
      sheet.getRow(1).height = 22;

      // Status → background colour map
      const statusColors: Record<string, string> = {
        IN_STOCK: "FFD1FAE5",
        SOLD: "FFDBEAFE",
        FINALIZED: "FFDBEAFE",
        DISPATCHED: "FFE0E7FF",
        DELETED: "FFFEE2E2",
        REMOVED: "FFFEE2E2",
        PENDING_PRESSING: "FFFFF9C4",
      };

      for (const bale of bales) {
        const row = sheet.addRow({
          referenceNumber: bale.referenceNumber,
          articleCode: bale.articleCode ?? "",
          productName: bale.productName ?? "",
          category: bale.category ?? "",
          baleCode: bale.baleCode ?? "",
          grade: bale.grade ?? "",
          weightKg: parseFloat(bale.weightKg || "0"),
          status: bale.status ?? "",
          stockEntryDate: bale.stockEntryDate ? new Date(bale.stockEntryDate).toLocaleDateString() : "",
          createdAt: bale.createdAt ? new Date(bale.createdAt).toLocaleString() : "",
          pressedAt: bale.pressedAt ? new Date(bale.pressedAt).toLocaleString() : "",
          finalizedAt: bale.finalizedAt ? new Date(bale.finalizedAt).toLocaleString() : "",
        });

        const bgColor = statusColors[bale.status ?? ""] ?? "FFFFFFFF";
        row.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        });
      }

      // Weight column — numeric format
      sheet.getColumn("weightKg").numFmt = "#,##0.000";

      // Auto-filter
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheet.columns.length },
      };

      // ── Sheet 2: Summary by Status ──
      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [
        { header: "Status", key: "status", width: 22 },
        { header: "Bale Count", key: "count", width: 14 },
        { header: "Total Weight (KG)", key: "weight", width: 20 },
      ];
      const sumHeader = summarySheet.getRow(1);
      sumHeader.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
      summarySheet.getRow(1).height = 22;

      const statusGroups = new Map<string, { count: number; weight: number }>();
      for (const b of bales) {
        const s = b.status ?? "UNKNOWN";
        const g = statusGroups.get(s) ?? { count: 0, weight: 0 };
        g.count++;
        g.weight += parseFloat(b.weightKg || "0");
        statusGroups.set(s, g);
      }
      for (const [status, g] of statusGroups) {
        const sumRow = summarySheet.addRow({ status, count: g.count, weight: g.weight });
        const bgColor = statusColors[status] ?? "FFFFFFFF";
        sumRow.eachCell((cell) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        });
      }
      // Totals row
      const totalRow = summarySheet.addRow({
        status: "TOTAL",
        count: bales.length,
        weight: bales.reduce((s, b) => s + parseFloat(b.weightKg || "0"), 0),
      });
      totalRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      });
      summarySheet.getColumn("weight").numFmt = "#,##0.000";

      const dateSuffix = from && to ? `_${from}_to_${to}` : `_all`;
      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="stock_register${dateSuffix}.xlsx"`);
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      console.error("Error exporting stock register:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/reimport", requireAuth, async (req: any, res: any) => {
    const multer = (await import("multer")).default;
    const upload = multer({ storage: multer.memoryStorage() });
    upload.single("file")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: "File upload error" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet(1);
        if (!sheet) return res.status(400).json({ message: "No worksheet found in file" });

        const headers: string[] = [];
        sheet.getRow(1).eachCell((cell, colNumber) => {
          headers[colNumber] = String(cell.value || "")
            .trim()
            .toLowerCase();
        });

        const refIdx = headers.findIndex((h) => h.includes("reference"));
        const articleIdx = headers.findIndex((h) => h.includes("article"));
        const nameIdx = headers.findIndex((h) => h.includes("product name"));
        const catIdx = headers.findIndex((h) => h.includes("category"));
        const weightIdx = headers.findIndex((h) => h.includes("weight"));
        const costPerKgIdx = headers.findIndex((h) => h.includes("cost per kg"));
        const totalCostIdx = headers.findIndex((h) => h.includes("total cost"));
        const locIdIdx = headers.findIndex((h) => h.includes("location id"));
        const statusIdx = headers.findIndex((h) => h.includes("status"));
        const mixBatchIdx = headers.findIndex((h) => h.includes("mix batch"));
        const baleCodeIdx = headers.findIndex((h) => h.includes("bale code"));
        const gradeIdx = headers.findIndex((h) => h.includes("grade"));
        const finalizedIdx = headers.findIndex((h) => h.includes("finalized"));

        if (refIdx < 0 || nameIdx < 0 || weightIdx < 0) {
          return res
            .status(400)
            .json({ message: "Excel must have at least: Reference Number, Product Name, Weight (kg) columns" });
        }

        const rows: any[] = [];
        const fileRefSet = new Set<string>();
        const fileDuplicates: string[] = [];

        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const refNum = String(row.getCell(refIdx + 1).value || "").trim();
          if (!refNum) return;

          if (fileRefSet.has(refNum)) {
            fileDuplicates.push(refNum);
          }
          fileRefSet.add(refNum);

          rows.push({
            referenceNumber: refNum,
            articleCode: articleIdx >= 0 ? String(row.getCell(articleIdx + 1).value || "").trim() : "",
            productName: nameIdx >= 0 ? String(row.getCell(nameIdx + 1).value || "").trim() : "",
            category: catIdx >= 0 ? String(row.getCell(catIdx + 1).value || "").trim() : "",
            weightKg: weightIdx >= 0 ? String(parseFloat(String(row.getCell(weightIdx + 1).value || "0")) || "0") : "0",
            costPerKg:
              costPerKgIdx >= 0 ? String(parseFloat(String(row.getCell(costPerKgIdx + 1).value || "0")) || "0") : "0",
            totalCost:
              totalCostIdx >= 0 ? String(parseFloat(String(row.getCell(totalCostIdx + 1).value || "0")) || "0") : "0",
            erpLocationId: locIdIdx >= 0 ? parseInt(String(row.getCell(locIdIdx + 1).value || "0")) || null : null,
            status: statusIdx >= 0 ? String(row.getCell(statusIdx + 1).value || "IN_STOCK").trim() : "IN_STOCK",
            mixBatchId: mixBatchIdx >= 0 ? parseInt(String(row.getCell(mixBatchIdx + 1).value || "0")) || null : null,
            baleCode: baleCodeIdx >= 0 ? String(row.getCell(baleCodeIdx + 1).value || "").trim() : "",
            grade: gradeIdx >= 0 ? String(row.getCell(gradeIdx + 1).value || "").trim() : "",
            finalizedAt: finalizedIdx >= 0 ? String(row.getCell(finalizedIdx + 1).value || "").trim() : "",
          });
        });

        if (rows.length === 0) {
          return res.status(400).json({ message: "No bale rows found in Excel" });
        }

        if (fileDuplicates.length > 0) {
          return res.status(400).json({
            message: `Duplicate reference numbers within the file: ${fileDuplicates.slice(0, 10).join(", ")}`,
          });
        }

        const result = await db.transaction(async (tx: any) => {
          const existingBarcodes = await tx
            .select({ referenceNumber: factoryBales.referenceNumber })
            .from(factoryBales)
            .where(eq(factoryBales.companyId, companyId));
          const existingRefSet = new Set(existingBarcodes.map((b: any) => b.referenceNumber));

          const duplicates = rows.filter((r) => existingRefSet.has(r.referenceNumber));
          if (duplicates.length > 0) {
            throw new Error(
              `These reference numbers already exist: ${duplicates
                .slice(0, 10)
                .map((d) => d.referenceNumber)
                .join(", ")}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ""}`
            );
          }

          const validLocIds = new Set<number>();
          const allLocs = await tx
            .select({ id: locations.id })
            .from(locations)
            .where(eq(locations.companyId, companyId));
          allLocs.forEach((l: any) => validLocIds.add(l.id));

          const invalidLocRows = rows.filter((r) => r.erpLocationId && !validLocIds.has(r.erpLocationId));
          if (invalidLocRows.length > 0) {
            throw new Error(
              `Invalid location IDs found: ${invalidLocRows
                .map((r) => `${r.referenceNumber} (loc ${r.erpLocationId})`)
                .slice(0, 5)
                .join(", ")}`
            );
          }

          const allProducts = await tx
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          type ImportedBaleProduct = (typeof allProducts)[number];
          const productByName = new Map<string, ImportedBaleProduct>(
            allProducts.map((p: ImportedBaleProduct) => [p.name.toLowerCase(), p] as const)
          );
          const productByArticle = new Map<string | undefined, ImportedBaleProduct>(
            allProducts.map((p: ImportedBaleProduct) => [p.articleCode?.toLowerCase(), p] as const)
          );

          const allCategories = await tx
            .select()
            .from(factoryCategories)
            .where(eq(factoryCategories.companyId, companyId));
          type ImportedBaleCategory = (typeof allCategories)[number];
          const categoryByName = new Map<string | undefined, ImportedBaleCategory>(
            allCategories.map((c: ImportedBaleCategory) => [c.name?.toLowerCase(), c] as const)
          );

          const createdBales: any[] = [];
          let totalWeight = 0;

          for (const row of rows) {
            let product =
              (row.articleCode ? productByArticle.get(row.articleCode.toLowerCase()) : null) ||
              productByName.get(row.productName.toLowerCase());
            if (!product) {
              const autoCode =
                row.articleCode ||
                "IMP-" +
                  row.productName
                    .replace(/[^a-zA-Z0-9]/g, "")
                    .toUpperCase()
                    .substring(0, 20) +
                  "-" +
                  Date.now().toString(36).slice(-4).toUpperCase();
              const categoryObj = row.category ? categoryByName.get(row.category.toLowerCase()) : null;
              const [newProduct] = await tx
                .insert(factoryBaleProducts)
                .values({
                  companyId,
                  code: autoCode,
                  articleCode: row.articleCode || autoCode,
                  name: row.productName,
                  active: true,
                  ...(categoryObj ? { categoryId: categoryObj.id } : {}),
                })
                .returning();
              product = newProduct;
              productByName.set(row.productName.toLowerCase(), product);
              if (row.articleCode) productByArticle.set(row.articleCode.toLowerCase(), product);
            }

            let finalizedAt: Date | null = null;
            if (row.finalizedAt) {
              const parsed = new Date(row.finalizedAt);
              if (!isNaN(parsed.getTime())) finalizedAt = parsed;
            }
            if (!finalizedAt) finalizedAt = new Date();

            const originalStatus = row.status || "IN_STOCK";

            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                productId: product.id,
                erpLocationId: row.erpLocationId,
                baleCode: row.baleCode || product.code,
                referenceNumber: row.referenceNumber,
                articleCode: row.articleCode || product.articleCode,
                productName: row.productName,
                category: row.category || null,
                grade: row.grade || null,
                weightKg: row.weightKg,
                costPerKg: row.costPerKg,
                totalCost: row.totalCost,
                status: originalStatus,
                mixBatchId: row.mixBatchId,
                finalizedAt,
              })
              .returning();

            createdBales.push({ ...bale, _product: product });
            totalWeight += parseFloat(row.weightKg);
          }

          const stockGroupCache = new Map<string, number>();
          const stockItemCache = new Map<string, number>();

          for (const bale of createdBales) {
            if (bale.status === "REMOVED" || bale.status === "DELETED") continue;

            const itemCode: string = bale.articleCode || bale.baleCode;
            if (!itemCode) continue;
            const locId = bale.erpLocationId;
            if (!locId) continue;

            const product = bale._product;
            let stockGroupId: number | null = null;
            if (bale.category) {
              const catName = bale.category as string;
              const catId = (product as any)?.categoryId as number | undefined;
              const cacheKey = catId ? String(catId) : catName;
              const cached = stockGroupCache.get(cacheKey);
              if (cached) {
                stockGroupId = cached;
              } else {
                const [existingGroup] = await tx
                  .select({ id: stockGroups.id })
                  .from(stockGroups)
                  .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.name, catName)));
                if (existingGroup) {
                  stockGroupId = existingGroup.id;
                } else {
                  // Use the category's own ID for a collision-free code
                  const groupCode = catId
                    ? `FCAT-${catId}`
                    : "F-" +
                      catName
                        .replace(/[^A-Z0-9]/gi, "")
                        .substring(0, 10)
                        .toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .onConflictDoNothing()
                    .returning({ id: stockGroups.id });
                  if (created) {
                    stockGroupId = created.id;
                  } else {
                    const [byCode] = await tx
                      .select({ id: stockGroups.id })
                      .from(stockGroups)
                      .where(and(eq(stockGroups.companyId, companyId), eq(stockGroups.code, groupCode)));
                    stockGroupId = byCode?.id;
                  }
                }
                stockGroupCache.set(cacheKey, stockGroupId!);
              }
            }

            let erpStockItemId = stockItemCache.get(itemCode);
            if (!erpStockItemId) {
              const [existing] = await tx
                .select({ id: stockItems.id, stockGroupId: stockItems.stockGroupId })
                .from(stockItems)
                .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

              if (existing) {
                erpStockItemId = existing.id;
                if (stockGroupId && !existing.stockGroupId) {
                  await tx.update(stockItems).set({ stockGroupId }).where(eq(stockItems.id, existing.id));
                }
              } else {
                const [created] = await tx
                  .insert(stockItems)
                  .values({
                    companyId,
                    code: itemCode,
                    name: bale.productName as string,
                    uom: "BALE",
                    active: true,
                    ...(stockGroupId ? { stockGroupId } : {}),
                  })
                  .returning({ id: stockItems.id });
                erpStockItemId = created.id;
              }
              stockItemCache.set(itemCode, erpStockItemId!);
            }

            const costPerKg = parseFloat(bale.costPerKg || "0");
            const weight = parseFloat(bale.weightKg || "0");
            await adjustInventory(tx, locId, erpStockItemId!, 1, companyId, weight * costPerKg);
          }

          return { count: createdBales.length, totalWeight };
        });

        const today = req.body.txDate || getClientDate(req);
        await writeDaybookEntry(db, {
          companyId,
          txDate: today,
          txType: "BALE_REIMPORT",
          description: `Reimported ${result.count} bale(s) with original reference numbers (${result.totalWeight.toFixed(1)} kg)`,
        });

        res.json({ imported: result.count, totalWeight: result.totalWeight });
      } catch (error: any) {
        console.error("Error reimporting bales:", error);
        res.status(400).json({ message: error.message });
      }
    });
  });

  // GET /api/factory/bales/export-names.xlsx — Export all bales for bulk product-name editing
  app.get("/api/factory/bales/export-names.xlsx", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId))
        .orderBy(factoryBales.id);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Bales");

      sheet.columns = [
        { header: "ID (do not edit)", key: "id", width: 18 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Reference Number", key: "referenceNumber", width: 22 },
        { header: "Category", key: "category", width: 16 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Product Name", key: "productName", width: 30 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
      });
      const idHeaderCell = sheet.getCell("A1");
      idHeaderCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6B7280" } };

      for (const bale of bales) {
        const row = sheet.addRow({
          id: bale.id,
          baleCode: bale.baleCode,
          referenceNumber: bale.referenceNumber,
          category: bale.category ?? "",
          grade: bale.grade ?? "",
          productName: bale.productName ?? "",
        });
        const idCell = row.getCell("id");
        idCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        idCell.font = { color: { argb: "FF6B7280" } };
      }

      sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true });

      const xlsBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bale_names_${companyId}.xlsx"`);
      res.setHeader("Content-Length", xlsBuffer.byteLength);
      res.end(xlsBuffer);
    } catch (error: any) {
      console.error("Error exporting bale names:", error);
      if (!res.headersSent) res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/bales/bulk-update-names — Upload Excel and update product_name in bulk
  app.post("/api/factory/bales/bulk-update-names", requireAuth, async (req: any, res: any) => {
    const multer = (await import("multer")).default;
    const upload = multer({ storage: multer.memoryStorage() });
    upload.single("file")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: "File upload error" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      try {
        const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const { read: readXlsx, utils } = await import("xlsx");
        const wb = readXlsx(req.file.buffer, { type: "buffer" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = utils.sheet_to_json(sheet, { defval: "" });

        let updated = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const row of rows) {
          const id = parseInt(row["ID (do not edit)"] ?? row["id"] ?? row["ID"]);
          const productName = String(row["Product Name"] ?? row["productName"] ?? "").trim();

          if (!id || isNaN(id)) {
            skipped++;
            continue;
          }
          if (!productName) {
            skipped++;
            continue;
          }

          const [bale] = await db
            .select()
            .from(factoryBales)
            .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

          if (!bale) {
            errors.push(`Bale ID ${id} not found`);
            skipped++;
            continue;
          }

          if (bale.productId) {
            await db
              .update(factoryBaleProducts)
              .set({ name: productName, updatedAt: new Date() })
              .where(and(eq(factoryBaleProducts.id, bale.productId), eq(factoryBaleProducts.companyId, companyId)));
          }

          await db.update(factoryBales).set({ productName, updatedAt: new Date() }).where(eq(factoryBales.id, id));

          updated++;
        }

        try {
          await logAudit({
            userId: req.session.userId!,
            username: (req.session as any).username || req.session.userId!,
            companyId,
            action: "update",
            tableName: "factory_bales",
            recordId: null,
            recordIdentifier: `bulk-rename: ${updated} bale(s) updated, ${skipped} skipped`,
            changes: null,
          });
        } catch (auditErr) {
          console.error("[bulk-update-names audit] non-fatal:", auditErr);
        }

        res.json({ updated, skipped, errors });
      } catch (error: any) {
        console.error("Error bulk-updating bale names:", error);
        res.status(500).json({ message: error.message });
      }
    });
  });

  app.get("/api/factory/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        status,
        mixBatchId,
        pressingBatchId,
        locationId,
        productId,
        limit: limitQ,
        offset: offsetQ,
        date,
        lite: liteQ,
        page: pageQ,
        search,
      } = req.query;
      const lite = liteQ === "1";

      // Default 100 rows, hard cap 250 — keeps responses under ~200 KB.
      // Use ?page=N for cursor-style pagination; ?limit overrides per-page size (capped at 250).
      const rowLimit = Math.min(Number(limitQ) || 100, 250);
      const page = pageQ !== undefined ? Math.max(1, Number(pageQ) || 1) : null;
      const rowOffset = page !== null ? (page - 1) * rowLimit : Math.max(Number(offsetQ) || 0, 0);

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        // Always exclude deleted/removed bales from the history view
        not(inArray(factoryBales.status, ["DELETED", "REMOVED"])),
      ];

      if (status) conditions.push(eq(factoryBales.status, status as string));
      if (mixBatchId) conditions.push(eq(factoryBales.mixBatchId, parseInt(mixBatchId as string)));
      if (pressingBatchId) conditions.push(eq(factoryBales.pressingBatchId, parseInt(pressingBatchId as string)));
      if (locationId) conditions.push(eq(factoryBales.erpLocationId, parseInt(locationId as string)));
      if (productId) conditions.push(eq(factoryBales.productId, parseInt(productId as string)));

      // Date filter: match against stockEntryDate first (set on all stock-entry/waste-dispatch bales),
      // falling back to the date portion of createdAt for pressing-batch bales.
      if (date && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        conditions.push(sql`COALESCE(${factoryBales.stockEntryDate}, ${factoryBales.createdAt}::date) = ${date}::date`);
      }

      // Server-side text search: bale code, article code, product name, reference number.
      if (search && typeof search === "string" && search.trim()) {
        const q = `%${search.trim()}%`;
        conditions.push(
          sql`(${factoryBales.baleCode} ILIKE ${q} OR ${factoryBales.articleCode} ILIKE ${q} OR ${factoryBales.productName} ILIKE ${q} OR ${factoryBales.referenceNumber} ILIKE ${q})`
        );
      }

      // Run data and count queries in parallel; skip count when not paginating.
      const [bales, countResult] = await Promise.all([
        db
          .select()
          .from(factoryBales)
          .where(and(...conditions))
          .orderBy(desc(factoryBales.createdAt))
          .limit(rowLimit)
          .offset(rowOffset),
        page !== null
          ? db
              .select({ count: sql<string>`COUNT(*)::text` })
              .from(factoryBales)
              .where(and(...conditions))
          : Promise.resolve(null as null),
      ]);

      const productIds: number[] = Array.from(new Set(bales.map((b: any) => b.productId).filter(Boolean)));
      const batchIds: number[] = Array.from(new Set(bales.map((b: any) => b.mixBatchId).filter(Boolean)));

      const products =
        productIds.length > 0
          ? lite
            ? await db
                .select({
                  id: factoryBaleProducts.id,
                  name: factoryBaleProducts.name,
                  articleCode: factoryBaleProducts.articleCode,
                })
                .from(factoryBaleProducts)
                .where(inArray(factoryBaleProducts.id, productIds))
            : await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
      const batches =
        batchIds.length > 0
          ? lite
            ? await db
                .select({
                  id: factoryMixBatches.id,
                  batchCode: factoryMixBatches.batchCode,
                  name: factoryMixBatches.name,
                })
                .from(factoryMixBatches)
                .where(inArray(factoryMixBatches.id, batchIds))
            : await db.select().from(factoryMixBatches).where(inArray(factoryMixBatches.id, batchIds))
          : [];

      const productMap = new Map(products.map((p: any) => [p.id, p]));
      const batchMap = new Map(batches.map((b: any) => [b.id, b]));

      const baleIds = bales.map((b: any) => b.id).filter(Boolean);
      const lastPrintMap = new Map<number, string>();
      // In lite mode skip the print-history lookup; in full mode guard against huge IN-clauses.
      if (!lite && baleIds.length > 0 && baleIds.length <= 500) {
        const printRows = await db
          .select({
            productionBaleId: baleLabelPrints.productionBaleId,
            lastPrintedAt: sql<string>`MAX(${baleLabelPrints.printedAt})::timestamptz`.as("last_printed_at"),
          })
          .from(baleLabelPrints)
          .where(inArray(baleLabelPrints.productionBaleId, baleIds))
          .groupBy(baleLabelPrints.productionBaleId);
        for (const row of printRows) {
          if (row.productionBaleId) lastPrintMap.set(row.productionBaleId, row.lastPrintedAt);
        }
      }

      const results = bales.map((bale: any) => ({
        bale,
        product: bale.productId ? productMap.get(bale.productId) || null : null,
        mixBatch: bale.mixBatchId ? batchMap.get(bale.mixBatchId) || null : null,
        lastPrintedAt: lastPrintMap.get(bale.id) || null,
      }));

      // Paginated response when ?page= is given; legacy array shape for backward-compat callers.
      if (page !== null && countResult) {
        const total = Number((countResult as any[])[0]?.count ?? 0);
        const totalPages = Math.max(1, Math.ceil(total / rowLimit));
        res.set("Cache-Control", "private, max-age=60");
        res.json({ items: results, total, page, limit: rowLimit, totalPages });
      } else {
        res.json(results);
      }
    } catch (error: any) {
      console.error("Error fetching factory bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/bulk-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { ids, status } = req.body;
      if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ message: "ids must be a non-empty array" });
      if (!status || typeof status !== "string") return res.status(400).json({ message: "status is required" });

      const ALLOWED = [
        "PENDING_PRESSING",
        "LABEL_PRINTED",
        "PRESSED",
        "IN_STOCK",
        "RESERVED",
        "RESERVED_FOR_ORDER",
        "SOLD",
        "REPACKED",
        "REMOVED",
        "DELETED",
        "DISPATCHED",
      ];
      if (!ALLOWED.includes(status))
        return res.status(400).json({ message: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });

      const now = new Date();
      const result = await db
        .update(factoryBales)
        .set({ status, updatedAt: now, deletedAt: status === "DELETED" ? now : null })
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, ids.map(Number))))
        .returning({ id: factoryBales.id });

      res.json({ updated: result.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });

      const { status } = req.body;
      if (!status || typeof status !== "string") return res.status(400).json({ message: "status is required" });

      const ALLOWED = [
        "PENDING_PRESSING",
        "LABEL_PRINTED",
        "PRESSED",
        "IN_STOCK",
        "RESERVED",
        "RESERVED_FOR_ORDER",
        "SOLD",
        "REPACKED",
        "REMOVED",
        "DELETED",
        "DISPATCHED",
      ];
      if (!ALLOWED.includes(status))
        return res.status(400).json({ message: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });

      // Guard: prevent resetting a bale to IN_STOCK if it's on a finalized order.
      // The correct flow is to use the "Return to Stock" action which removes it from the order first.
      if (status === "IN_STOCK") {
        const [orderBaleCheck] = await db
          .select({ orderId: customerOrderBales.orderId })
          .from(customerOrderBales)
          .where(eq(customerOrderBales.baleId, id))
          .limit(1);
        if (orderBaleCheck) {
          const [orderCheck] = await db
            .select({ status: customerOrders.status })
            .from(customerOrders)
            .where(eq(customerOrders.id, orderBaleCheck.orderId))
            .limit(1);
          if (orderCheck && ["FINALIZED", "DISPATCHED", "SOLD"].includes(orderCheck.status)) {
            return res.status(409).json({
              message:
                "Cannot set status to IN_STOCK: this bale is on a finalized order. Use the Return to Stock action to remove it from the order first.",
            });
          }
        }
      }

      // Read old status before updating so the audit has a real before/after diff.
      const [baleBeforeStatusChange] = await db
        .select({ status: factoryBales.status, referenceNumber: factoryBales.referenceNumber })
        .from(factoryBales)
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));
      if (!baleBeforeStatusChange) return res.status(404).json({ message: "Bale not found" });

      const now = new Date();
      const [updated] = await db
        .update(factoryBales)
        .set({ status, updatedAt: now, deletedAt: status === "DELETED" ? now : null })
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)))
        .returning({ id: factoryBales.id, status: factoryBales.status });

      if (!updated) return res.status(404).json({ message: "Bale not found" });
      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || req.session.userId!,
        companyId,
        action: "update",
        tableName: "factory_bales",
        recordId: id,
        recordIdentifier: baleBeforeStatusChange.referenceNumber || `Bale #${id}`,
        changes: { status: { old: baleBeforeStatusChange.status, new: status } },
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/bales/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });

      const [updated] = await db
        .update(factoryBales)
        .set({ status: "DELETED", deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)))
        .returning({ id: factoryBales.id });

      if (!updated) return res.status(404).json({ message: "Bale not found" });
      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || req.session.userId!,
        companyId,
        action: "delete",
        tableName: "bales",
        recordId: id,
        recordIdentifier: `Bale #${id}`,
        changes: null,
      });
      res.json({ message: "Bale deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/product-name", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }

      const [bale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

      if (!bale) return res.status(404).json({ message: "Bale not found" });

      if (bale.productId) {
        await db
          .update(factoryBaleProducts)
          .set({ name: name.trim(), updatedAt: new Date() })
          .where(and(eq(factoryBaleProducts.id, bale.productId), eq(factoryBaleProducts.companyId, companyId)));
      }

      await db
        .update(factoryBales)
        .set({ productName: name.trim(), updatedAt: new Date() })
        .where(eq(factoryBales.id, id));

      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || req.session.userId!,
        companyId,
        action: "update",
        tableName: "bales",
        recordId: id,
        recordIdentifier: `Bale #${id}`,
        changes: { productName: { old: bale.productName, new: name.trim() } },
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating bale product name:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/assign-worker", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const { workerId } = req.body;
      if (!workerId) return res.status(400).json({ message: "workerId is required" });
      const [bale] = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));
      if (!bale) return res.status(404).json({ message: "Bale not found" });
      const numericWorkerId = parseInt(workerId);
      const [worker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.id, numericWorkerId))
        .limit(1);
      const [updated] = await db
        .update(factoryBales)
        .set({ finalizedBy: numericWorkerId, workerName: worker?.fullName ?? null, updatedAt: new Date() })
        .where(eq(factoryBales.id, id))
        .returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning worker to bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk assign worker to multiple bales (for stock entry history groups) ──
  app.patch("/api/factory/bales/bulk-assign-worker", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { baleIds, workerId } = req.body;
      if (!Array.isArray(baleIds) || baleIds.length === 0)
        return res.status(400).json({ message: "baleIds array is required" });
      if (!workerId) return res.status(400).json({ message: "workerId is required" });
      const numericIds = baleIds.map(Number).filter((n) => !isNaN(n));
      const numericWorkerId = parseInt(workerId);
      const [worker] = await db
        .select({ fullName: factoryWorkers.fullName })
        .from(factoryWorkers)
        .where(eq(factoryWorkers.id, numericWorkerId))
        .limit(1);
      await db
        .update(factoryBales)
        .set({ finalizedBy: numericWorkerId, workerName: worker?.fullName ?? null, updatedAt: new Date() })
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, numericIds)));
      res.json({ updated: numericIds.length, workerId: numericWorkerId });
    } catch (error: any) {
      console.error("Error bulk-assigning worker:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Correct bale weight (cascades to load bales, invoice bales, order bales) ──
  app.patch("/api/factory/bales/:id/weight", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const rawWeight = parseFloat(req.body.weightKg);
      if (isNaN(rawWeight) || rawWeight <= 0) {
        return res.status(400).json({ message: "weightKg must be a positive number" });
      }
      const newWeightStr = rawWeight.toFixed(3);

      const result = await db.transaction(async (tx: any) => {
        // Fetch bale and verify ownership
        const [bale] = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

        if (!bale) throw new Error("Bale not found");

        const costPerKg = parseFloat(bale.costPerKg || "0");
        const newTotalCost = (rawWeight * costPerKg).toFixed(2);
        const oldWeight = parseFloat(bale.weightKg || "0");

        // 1. Update the bale itself
        const [updatedBale] = await tx
          .update(factoryBales)
          .set({
            weightKg: newWeightStr,
            totalCost: newTotalCost,
            updatedAt: new Date(),
          })
          .where(eq(factoryBales.id, id))
          .returning();

        // 2. Update factory_v3_load_bales (loading order scans)
        const loadBalesResult = await tx
          .update(factoryV3LoadBales)
          .set({ weightKg: newWeightStr })
          .where(eq(factoryV3LoadBales.baleId, id));

        // 3. Update factory_invoice_loading_bales (invoice loading session scans)
        const invoiceBalesResult = await tx
          .update(factoryInvoiceLoadingBales)
          .set({ weightKg: newWeightStr })
          .where(eq(factoryInvoiceLoadingBales.baleId, id));

        // 4. Update customer_order_bales (weight column is "weight", not "weightKg")
        const orderBalesResult = await tx
          .update(customerOrderBales)
          .set({ weight: newWeightStr })
          .where(eq(customerOrderBales.baleId, id));

        return {
          bale: updatedBale,
          oldWeight,
          newWeight: rawWeight,
          updatedLoadBales: loadBalesResult?.rowCount ?? 0,
          updatedInvoiceBales: invoiceBalesResult?.rowCount ?? 0,
          updatedOrderBales: orderBalesResult?.rowCount ?? 0,
        };
      });

      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || req.session.userId!,
        companyId,
        action: "update",
        tableName: "factory_bales",
        recordId: id,
        recordIdentifier: result.bale.referenceNumber || `Bale #${id}`,
        changes: { weightKg: { old: result.oldWeight, new: result.newWeight } },
      });
      res.json({
        success: true,
        baleId: id,
        referenceNumber: result.bale.referenceNumber,
        oldWeight: result.oldWeight,
        newWeight: result.newWeight,
        updatedLoadBales: result.updatedLoadBales,
        updatedInvoiceBales: result.updatedInvoiceBales,
        updatedOrderBales: result.updatedOrderBales,
      });
    } catch (error: any) {
      console.error("Error correcting bale weight:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/:id/repack", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const result = await db.transaction(async (tx: any) => {
        const [originalBale] = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

        if (!originalBale) throw new Error("Bale not found");
        if (originalBale.status === "REPACKED") throw new Error("Bale has already been repacked");
        if (originalBale.status === "SOLD") throw new Error("Cannot repack a sold bale");

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = seqRecord.nextNumber;
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + 1 })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = 200000;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 200001,
          });
        }

        const newRefNum = `REF${String(nextNumber).padStart(6, "0")}`;

        const [newBale] = await tx
          .insert(factoryBales)
          .values({
            companyId: originalBale.companyId,
            mixBatchId: originalBale.mixBatchId,
            productId: originalBale.productId,
            pressingBatchId: originalBale.pressingBatchId,
            erpLocationId: originalBale.erpLocationId,
            baleCode: originalBale.baleCode,
            referenceNumber: newRefNum,
            articleCode: originalBale.articleCode,
            productName: originalBale.productName,
            category: originalBale.category,
            grade: originalBale.grade,
            quantity: originalBale.quantity,
            weightKg: originalBale.weightKg,
            costPerKg: originalBale.costPerKg,
            totalCost: originalBale.totalCost,
            status: "IN_STOCK",
          })
          .returning();

        await tx.update(factoryBales).set({ status: "REPACKED", updatedAt: new Date() }).where(eq(factoryBales.id, id));

        return { originalBale, newBale, newRefNum };
      });

      await logAudit({
        userId: req.session.userId!,
        username: (req.session as any).username || req.session.userId!,
        companyId,
        action: "update",
        tableName: "factory_bales",
        recordId: id,
        recordIdentifier: result.originalBale.referenceNumber || `Bale #${id}`,
        changes: {
          status: { old: result.originalBale.status, new: "REPACKED" },
          newBaleRef: { old: null, new: result.newRefNum },
        },
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error repacking bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Lightweight daily summary — counts and weights by category for a single date.
  // Much faster than the full /api/factory/bales endpoint which returns up to 2000 rows.
  app.get("/api/factory/bales/daily-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { date } = req.query as Record<string, string>;
      if (!date) return res.status(400).json({ message: "date is required (YYYY-MM-DD)" });

      const rows = await db.execute(sql`
        SELECT
          LOWER(TRIM(COALESCE(category, ''))) AS "category",
          COUNT(*)::int                        AS "count",
          ROUND(COALESCE(SUM(CAST(weight_kg AS numeric)), 0), 3)::text AS "totalKg"
        FROM factory_bales
        WHERE company_id = ${companyId}
          AND stock_entry_date::text = ${date}
          AND status NOT IN ('DELETED', 'REMOVED')
        GROUP BY LOWER(TRIM(COALESCE(category, '')))
      `);

      res.json(rows.rows ?? rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/stock-entry-history", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userRole =
        ((req.session as any).currentRole as string) || ((req.session as any).factoryRole as string) || "";
      const isPrivileged = ["Admin", "Owner", "Manager", "Developer"].includes(userRole);

      const { startDate, endDate, workerId, productId, locationId, status, search, includeUnassigned, lite } =
        req.query as Record<string, string>;

      const today = getClientDate(req);
      const effectiveStart = startDate || today;
      const effectiveEnd = endDate || today;

      // Pagination — page ≥ 1, limit 1–250 (default 100)
      const rawPage = parseInt(String(req.query.page ?? ""), 10);
      const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 250);
      const offset = (page - 1) * limit;

      const workerFilter = workerId ? sql`AND fb.finalized_by = ${parseInt(workerId)}` : sql``;
      const productFilter = productId ? sql`AND fb.product_id = ${parseInt(productId)}` : sql``;
      const locationFilter = locationId ? sql`AND fb.erp_location_id = ${parseInt(locationId)}` : sql``;
      const statusFilter = status ? sql`AND fb.status = ${status}` : sql``;
      const searchFilter = search
        ? sql`AND LOWER(fb.reference_number) LIKE ${"%" + search.toLowerCase() + "%"}`
        : sql``;
      const unassignedFilter = includeUnassigned === "false" ? sql`AND fb.finalized_by IS NOT NULL` : sql``;
      // Privileged users can see deleted bales when searching by ref code;
      // otherwise exclude deleted/removed bales (consistent with daily-summary)
      const deletedFilter = isPrivileged && search ? sql`` : sql`AND fb.status NOT IN ('DELETED', 'REMOVED')`;

      // Shared WHERE base reused by both the data query and the COUNT subquery.
      const whereClause = sql`
        WHERE fb.company_id = ${companyId}
          ${deletedFilter}
          AND fb.stock_entry_date IS NOT NULL
          AND fb.stock_entry_date >= ${effectiveStart}
          AND fb.stock_entry_date <= ${effectiveEnd}
          ${workerFilter}
          ${productFilter}
          ${locationFilter}
          ${statusFilter}
          ${searchFilter}
          ${unassignedFilter}`;

      const groupByClause = sql`GROUP BY fb.stock_entry_date, fb.erp_location_id, l.name, fb.finalized_by, fw.full_name, fb.product_id, fbp.name, fbp.article_code`;
      const orderByClause = sql`ORDER BY fb.stock_entry_date DESC, l.name NULLS LAST, fw.full_name NULLS LAST, fbp.name NULLS LAST`;

      const joinClause = sql`
        FROM factory_bales fb
        LEFT JOIN factory_workers fw ON fb.finalized_by = fw.id AND fw.company_id = ${companyId}
        LEFT JOIN factory_bale_products fbp ON fb.product_id = fbp.id AND fbp.company_id = ${companyId}
        LEFT JOIN locations l ON fb.erp_location_id = l.id AND l.company_id = ${companyId}`;

      // COUNT query: counts distinct groups + total bales + total weight across all matching groups.
      // Runs in parallel with the data query.
      const countQuery = sql`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(grp_bale_count), 0) AS total_bales,
          COALESCE(SUM(grp_weight), 0) AS total_weight
        FROM (
          SELECT COUNT(fb.id) AS grp_bale_count, COALESCE(SUM(CAST(fb.weight_kg AS numeric)), 0) AS grp_weight
          ${joinClause}
          ${whereClause}
          ${groupByClause}
        ) AS grp`;

      function buildPaginatedResponse(items: any[], total: number, totalBales = 0, totalWeight = 0) {
        const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
        return {
          items,
          total,
          totalBales,
          totalWeight,
          page,
          limit,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1 && totalPages > 0,
        };
      }

      // Lite mode: omit per-bale JSON_AGG — returns a summary-only payload (~95% smaller).
      // The condensed view uses this for the initial page load; bale details are fetched on demand.
      if (lite === "1") {
        const [liteResult, countResult] = await Promise.all([
          db.execute(sql`
            SELECT
              fb.stock_entry_date::text AS "stockEntryDate",
              fb.erp_location_id AS "erpLocationId",
              COALESCE(l.name, 'Unknown') AS "locationName",
              fb.finalized_by AS "workerId",
              fw.full_name AS "workerName",
              fb.product_id AS "productId",
              fbp.name AS "productName",
              fbp.article_code AS "articleCode",
              COUNT(*)::int AS "baleCount",
              ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3) AS "totalWeight",
              ROUND(AVG(CAST(fb.weight_kg AS numeric)), 3) AS "avgWeight",
              MIN(fb.finalized_at) AS "firstFinalizedAt",
              MAX(fb.finalized_at) AS "lastFinalizedAt"
            ${joinClause}
            ${whereClause}
            ${groupByClause}
            ${orderByClause}
            LIMIT ${limit} OFFSET ${offset}
          `),
          db.execute(countQuery),
        ]);
        const total = parseInt(String((countResult.rows[0] as any)?.total ?? "0"), 10);
        const totalBales = parseInt(String((countResult.rows[0] as any)?.total_bales ?? "0"), 10);
        const totalWeight = parseFloat(String((countResult.rows[0] as any)?.total_weight ?? "0"));
        const items = liteResult.rows.map((r: any) => ({ ...r, bales: [] }));
        return res.json(buildPaginatedResponse(items, total, totalBales, totalWeight));
      }

      const [dataResult, countResult] = await Promise.all([
        db.execute(sql`
          SELECT
            fb.stock_entry_date::text AS "stockEntryDate",
            fb.erp_location_id AS "erpLocationId",
            COALESCE(l.name, 'Unknown') AS "locationName",
            fb.finalized_by AS "workerId",
            fw.full_name AS "workerName",
            fb.product_id AS "productId",
            fbp.name AS "productName",
            fbp.article_code AS "articleCode",
            COUNT(*)::int AS "baleCount",
            ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3) AS "totalWeight",
            ROUND(AVG(CAST(fb.weight_kg AS numeric)), 3) AS "avgWeight",
            MIN(fb.finalized_at) AS "firstFinalizedAt",
            MAX(fb.finalized_at) AS "lastFinalizedAt",
            JSON_AGG(JSON_BUILD_OBJECT(
              'id', fb.id,
              'referenceNumber', fb.reference_number,
              'weightKg', fb.weight_kg,
              'status', fb.status,
              'finalizedAt', fb.finalized_at,
              'stockEntryDate', fb.stock_entry_date::text,
              'locationName', COALESCE(l.name, 'Unknown'),
              'workerName', fw.full_name,
              'productName', fbp.name,
              'articleCode', fbp.article_code
            ) ORDER BY fb.finalized_at ASC) AS "bales"
          ${joinClause}
          ${whereClause}
          ${groupByClause}
          ${orderByClause}
          LIMIT ${limit} OFFSET ${offset}
        `),
        db.execute(countQuery),
      ]);

      const total = parseInt(String((countResult.rows[0] as any)?.total ?? "0"), 10);
      const totalBales = parseInt(String((countResult.rows[0] as any)?.total_bales ?? "0"), 10);
      const totalWeight = parseFloat(String((countResult.rows[0] as any)?.total_weight ?? "0"));
      res.json(buildPaginatedResponse(dataResult.rows, total, totalBales, totalWeight));
    } catch (error: any) {
      console.error("Error fetching stock entry history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Stock Entry History: PDF Export ──────────────────────────────────────
  app.get("/api/factory/bales/stock-entry-history/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const userRole =
        ((req.session as any).currentRole as string) || ((req.session as any).factoryRole as string) || "";
      const isPrivileged = ["Admin", "Owner", "Manager", "Developer"].includes(userRole);

      const { startDate, endDate, workerId, productId, locationId, status, search, includeUnassigned } =
        req.query as Record<string, string>;

      const today = getClientDate(req);
      const effectiveStart = startDate || today;
      const effectiveEnd = endDate || today;

      const workerFilter = workerId ? sql`AND fb.finalized_by = ${parseInt(workerId)}` : sql``;
      const productFilter = productId ? sql`AND fb.product_id = ${parseInt(productId)}` : sql``;
      const locationFilter = locationId ? sql`AND fb.erp_location_id = ${parseInt(locationId)}` : sql``;
      const statusFilter = status ? sql`AND fb.status = ${status}` : sql``;
      const searchFilter = search
        ? sql`AND LOWER(fb.reference_number) LIKE ${"%" + search.toLowerCase() + "%"}`
        : sql``;
      const unassignedFilter = includeUnassigned === "false" ? sql`AND fb.finalized_by IS NOT NULL` : sql``;
      const deletedFilter = isPrivileged && search ? sql`` : sql`AND fb.status NOT IN ('DELETED', 'REMOVED')`;

      const rows = await db.execute(sql`
        SELECT
          fb.stock_entry_date::text AS "stockEntryDate",
          fb.erp_location_id AS "erpLocationId",
          COALESCE(l.name, 'Unknown') AS "locationName",
          fb.finalized_by AS "workerId",
          fw.full_name AS "workerName",
          fb.product_id AS "productId",
          fbp.name AS "productName",
          fbp.article_code AS "articleCode",
          COUNT(*)::int AS "baleCount",
          ROUND(SUM(CAST(fb.weight_kg AS numeric)), 3) AS "totalWeight",
          ROUND(AVG(CAST(fb.weight_kg AS numeric)), 3) AS "avgWeight",
          MIN(fb.finalized_at) AS "firstFinalizedAt",
          MAX(fb.finalized_at) AS "lastFinalizedAt",
          JSON_AGG(JSON_BUILD_OBJECT(
            'id', fb.id,
            'referenceNumber', fb.reference_number,
            'weightKg', fb.weight_kg,
            'status', fb.status,
            'finalizedAt', fb.finalized_at,
            'stockEntryDate', fb.stock_entry_date::text,
            'locationName', COALESCE(l.name, 'Unknown'),
            'workerName', fw.full_name,
            'productName', fbp.name,
            'articleCode', fbp.article_code
          ) ORDER BY fb.finalized_at ASC) AS "bales"
        FROM factory_bales fb
        LEFT JOIN factory_workers fw ON fb.finalized_by = fw.id AND fw.company_id = ${companyId}
        LEFT JOIN factory_bale_products fbp ON fb.product_id = fbp.id AND fbp.company_id = ${companyId}
        LEFT JOIN locations l ON fb.erp_location_id = l.id AND l.company_id = ${companyId}
        WHERE fb.company_id = ${companyId}
          ${deletedFilter}
          AND fb.stock_entry_date IS NOT NULL
          AND fb.stock_entry_date >= ${effectiveStart}
          AND fb.stock_entry_date <= ${effectiveEnd}
          ${workerFilter}
          ${productFilter}
          ${locationFilter}
          ${statusFilter}
          ${searchFilter}
          ${unassignedFilter}
        GROUP BY fb.stock_entry_date, fb.erp_location_id, l.name, fb.finalized_by, fw.full_name, fb.product_id, fbp.name, fbp.article_code
        ORDER BY fb.stock_entry_date DESC, l.name NULLS LAST, fw.full_name NULLS LAST, fbp.name NULLS LAST
      `);

      const groups: any[] = rows.rows;
      const totalBales = groups.reduce((s: number, g: any) => s + (g.baleCount || 0), 0);
      const totalWeight = groups.reduce((s: number, g: any) => s + parseFloat(g.totalWeight || "0"), 0);

      const PDFDocument = (await import("pdfkit")).default;
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="stock-entry-history-${effectiveStart}-to-${effectiveEnd}.pdf"`
      );
      doc.pipe(res);

      const fmtN = (v: any, dec = 3) =>
        parseFloat(v || "0").toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const NAVY = "#1F3864";
      const LIGHT_BLUE = "#EFF3FB";
      const STRIPE = "#F8F8F8";
      const GROUP_BG = "#E8ECF4";
      const pageW = 515; // usable width with 40px margin each side

      // ── Logo above header ────────────────────────────────────────────────
      const sehLogoPath = path.join(process.cwd(), "server", "hmd-logo.png");
      if (fs.existsSync(sehLogoPath)) {
        try {
          doc.image(sehLogoPath, (doc.page.width - 200) / 2, 10, { width: 200 });
        } catch {}
      }

      // ── Header bar ──────────────────────────────────────────────────────
      doc.rect(40, 100, pageW, 44).fill(NAVY);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(13).text("Stock Entry History", 44, 105, { width: 340 });
      doc.font("Helvetica").fontSize(8).text("Factory Bales Report", 44, 120, { width: 300 });
      const generatedStr = `Generated: ${new Date().toLocaleDateString("en-GB")}`;
      doc.fontSize(8).text(generatedStr, 400, 120, { width: 155, align: "right" });

      // ── Sub-header: period & summary ─────────────────────────────────────
      const subY = 154;
      doc.fillColor("#000000").font("Helvetica").fontSize(9);
      doc.text(`Period: ${effectiveStart}  →  ${effectiveEnd}`, 40, subY);
      doc
        .font("Helvetica-Bold")
        .text(
          `${groups.length} groups   |   ${totalBales} bales   |   ${fmtN(totalWeight, 2)} kg total`,
          40,
          subY + 13
        );
      if (search)
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#555555")
          .text(`Search filter: "${search}"`, 40, subY + 26);
      doc.fillColor("#000000");

      // ── Column layout ────────────────────────────────────────────────────
      // Date | Location | Worker | Product | Bales | Total KG | Avg KG
      const colX = [40, 118, 218, 318, 420, 458, 500];
      const colW = [78, 100, 100, 102, 38, 42, 55];
      const colHdr = ["Date", "Location", "Worker", "Product", "Bales", "Total KG", "Avg KG"];
      const colAln: Array<"left" | "right"> = ["left", "left", "left", "left", "right", "right", "right"];

      const tableTop = subY + (search ? 44 : 32);

      // header row
      doc.rect(40, tableTop, pageW, 14).fill(NAVY);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.5);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAln[i] });
      });

      doc.fillColor("#000000");
      let y = tableTop + 16;

      let rowIdx = 0;
      for (const g of groups) {
        // page break check — need room for group row + at least one bale row
        if (y > 780) {
          doc.addPage();
          y = 40;
        }

        // group summary row
        doc.rect(40, y, pageW, 14).fill(GROUP_BG);
        doc.fillColor("#000000").font("Helvetica-Bold").fontSize(7.5);
        doc.text(g.stockEntryDate || "—", colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text(g.locationName || "—", colX[1] + 2, y + 3, { width: colW[1] - 4 });
        doc.text(g.workerName || "Unassigned", colX[2] + 2, y + 3, { width: colW[2] - 4 });
        const prodLabel = [g.productName, g.articleCode ? `(${g.articleCode})` : ""].filter(Boolean).join(" ");
        doc.text(prodLabel || "—", colX[3] + 2, y + 3, { width: colW[3] - 4 });
        doc.text(String(g.baleCount || 0), colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        doc.text(fmtN(g.totalWeight, 3), colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
        doc.text(fmtN(g.avgWeight, 3), colX[6] + 2, y + 3, { width: colW[6] - 4, align: "right" });
        y += 14;

        // bale detail rows
        const bales: any[] = g.bales || [];
        for (let bi = 0; bi < bales.length; bi++) {
          if (y > 790) {
            doc.addPage();
            y = 40;
          }
          const b = bales[bi];
          if (bi % 2 === 1) {
            doc.rect(40, y, pageW, 12).fill(STRIPE);
            doc.fillColor("#000000");
          }

          // indent indicator stripe on left
          doc.rect(40, y, 3, 12).fill("#9CB2D8");

          doc.font("Helvetica").fontSize(7);
          doc.fillColor("#333333");
          // Reference number in mono-style slot (Date col)
          doc.text(b.referenceNumber || "—", colX[0] + 5, y + 3, { width: colW[0] - 7 });
          // Location (same as group, skip repeat)
          doc.text("", colX[1] + 2, y + 3, { width: colW[1] - 4 });
          // Worker (same as group)
          doc.text("", colX[2] + 2, y + 3, { width: colW[2] - 4 });
          // Status
          doc.text(b.status || "—", colX[3] + 2, y + 3, { width: colW[3] - 4 });
          doc.text("1", colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
          doc.text(fmtN(b.weightKg, 3), colX[5] + 2, y + 3, { width: colW[5] - 4, align: "right" });
          doc.fillColor("#000000");
          y += 12;
        }

        rowIdx++;
      }

      // ── Totals footer ─────────────────────────────────────────────────────
      if (y > 770) {
        doc.addPage();
        y = 40;
      }
      y += 4;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 5;
      doc.rect(40, y, pageW, 16).fill(NAVY);
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      doc.text("TOTAL", colX[0] + 2, y + 4, { width: 200 });
      doc.text(String(totalBales), colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      doc.text(fmtN(totalWeight, 3), colX[5] + 2, y + 4, { width: colW[5] - 4, align: "right" });

      doc.end();
    } catch (error: any) {
      console.error("Error exporting stock entry history PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/lookup/:barcode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const barcode = req.params.barcode.toUpperCase();
      const batchId = req.query.batchId ? parseOptionalId(req.query.batchId) : null;
      const excludeIdsStr = req.query.excludeIds as string;
      const excludeIds = excludeIdsStr
        ? excludeIdsStr
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n))
        : [];

      let results: any[] = [];

      const baseConditions: any[] = [
        eq(factoryBales.companyId, companyId),
        or(
          eq(factoryBales.referenceNumber, barcode),
          eq(factoryBales.baleCode, barcode),
          eq(factoryBales.articleCode, barcode)
        ),
      ];
      if (batchId) {
        baseConditions.push(eq(factoryBales.pressingBatchId, batchId));
        baseConditions.push(eq(factoryBales.status, "PENDING_PRESSING"));
      } else {
        // General scan lookup — never surface deleted or removed bales
        baseConditions.push(not(inArray(factoryBales.status, ["DELETED", "REMOVED"])));
      }
      results = await db
        .select()
        .from(factoryBales)
        .where(and(...baseConditions))
        .orderBy(factoryBales.id);

      if (results.length === 0) {
        const labelResults = await db
          .select()
          .from(baleLabelPrints)
          .where(and(eq(baleLabelPrints.companyId, companyId), eq(baleLabelPrints.referenceNumber, barcode)));

        if (labelResults.length > 0 && labelResults[0].productionBaleId) {
          const labelBale = await db
            .select()
            .from(factoryBales)
            .where(eq(factoryBales.id, labelResults[0].productionBaleId));
          if (labelBale.length > 0) {
            if (!batchId || labelBale[0].pressingBatchId === batchId) {
              results = labelBale;
            }
          }
        }
      }

      if (excludeIds.length > 0) {
        results = results.filter((b: any) => !excludeIds.includes(b.id));
      }

      if (results.length === 0) return res.status(404).json({ message: "Bale not found" });
      res.json(results[0]);
    } catch (error: any) {
      console.error("Error looking up bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 11. Factory Production Summary
  // ───────────────────────────────────────────────

  app.get("/api/factory/production-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allBales = await db
        .select({
          status: factoryBales.status,
          weightKg: factoryBales.weightKg,
        })
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId));

      const totalBales = allBales.length;
      let pendingCount = 0;
      let finalizedCount = 0;
      let pendingWeight = 0;
      let finalizedWeight = 0;

      for (const bale of allBales) {
        const weight = parseFloat(bale.weightKg) || 0;
        if (bale.status === "PENDING_PRESSING") {
          pendingCount++;
          pendingWeight += weight;
        } else if (bale.status === "IN_STOCK") {
          finalizedCount++;
          finalizedWeight += weight;
        }
      }

      const mixBatches = await db
        .select({
          totalWeightKg: factoryMixBatches.totalWeightKg,
          usedKg: factoryMixBatches.usedKg,
        })
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId));

      let totalMixWeight = 0;
      let totalMixUsed = 0;
      for (const mb of mixBatches) {
        totalMixWeight += parseFloat(mb.totalWeightKg) || 0;
        totalMixUsed += parseFloat(mb.usedKg) || 0;
      }

      res.json({
        totalBales,
        pendingCount,
        finalizedCount,
        pendingWeight: pendingWeight.toFixed(3),
        finalizedWeight: finalizedWeight.toFixed(3),
        totalWeight: (pendingWeight + finalizedWeight).toFixed(3),
        mixBatchUtilization: {
          totalWeightKg: totalMixWeight.toFixed(3),
          usedKg: totalMixUsed.toFixed(3),
          remainingKg: (totalMixWeight - totalMixUsed).toFixed(3),
          utilizationPercent: totalMixWeight > 0 ? ((totalMixUsed / totalMixWeight) * 100).toFixed(1) : "0.0",
        },
      });
    } catch (error: any) {
      console.error("Error fetching production summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Dashboard KPIs
  // ───────────────────────────────────────────────

  app.get("/api/factory/dashboard-kpis", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const _kpiKey = `factory-kpis:${companyId}:${todayStart.toDateString()}`;
      const _kpiHit = _getKpiCached(_kpiKey);
      if (_kpiHit) return res.json(_kpiHit);

      // Fire all three independent DB queries in parallel
      const [rawStockTotals, todayMixBatches, todayBales] = await Promise.all([
        db
          .select({
            totalReceived: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg}), 0)`,
            totalUsed: sql<string>`COALESCE(SUM(${factoryRawStock.usedKg}), 0)`,
          })
          .from(factoryRawStock)
          .where(eq(factoryRawStock.companyId, companyId)),

        db
          .select({ totalWeightKg: factoryMixBatches.totalWeightKg })
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.createdAt} >= ${todayStart}`)),

        db
          .select({
            id: factoryBales.id,
            baleCode: factoryBales.baleCode,
            productName: factoryBales.productName,
            category: factoryBales.category,
            weightKg: factoryBales.weightKg,
            pressedAt: factoryBales.pressedAt,
            status: factoryBales.status,
          })
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), sql`${factoryBales.pressedAt} >= ${todayStart}`)),
      ]);

      const totalReceived = parseFloat(rawStockTotals[0]?.totalReceived || "0");
      const totalUsed = parseFloat(rawStockTotals[0]?.totalUsed || "0");
      const closingStockKg = totalReceived - totalUsed;

      const kgsUsedToday = todayMixBatches.reduce((sum, mb) => sum + (parseFloat(mb.totalWeightKg as string) || 0), 0);
      const openingStockKg = closingStockKg + kgsUsedToday;

      const balesPressedToday = todayBales.length;
      const totalBaleWeightToday = todayBales.reduce((sum, b) => sum + (parseFloat(b.weightKg as string) || 0), 0);

      const categoryMap: Record<string, { count: number; totalKg: number }> = {};
      for (const bale of todayBales) {
        const name = bale.productName || bale.category || "Unknown";
        if (!categoryMap[name]) categoryMap[name] = { count: 0, totalKg: 0 };
        categoryMap[name].count++;
        categoryMap[name].totalKg += parseFloat(bale.weightKg as string) || 0;
      }
      const categories = Object.entries(categoryMap)
        .map(([name, data]) => ({ name, count: data.count, totalKg: parseFloat(data.totalKg.toFixed(3)) }))
        .sort((a, b) => b.count - a.count);

      const _kpiResult = {
        openingStockKg: openingStockKg.toFixed(3),
        closingStockKg: closingStockKg.toFixed(3),
        balesPressedToday,
        kgsUsedToday: kgsUsedToday.toFixed(3),
        totalBaleWeightToday: totalBaleWeightToday.toFixed(3),
        categories,
        balesDetail: todayBales.map((b: any) => ({ ...b, quantity: 1 })),
      };
      _setKpiCached(_kpiKey, _kpiResult);
      res.json(_kpiResult);
    } catch (error: any) {
      console.error("Error fetching factory dashboard KPIs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Import API Endpoints
  // ───────────────────────────────────────────────

  app.post("/api/factory/import/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { suppliers: supplierList } = req.body;
      if (!Array.isArray(supplierList) || supplierList.length === 0) {
        return res.status(400).json({ message: "No suppliers provided" });
      }

      let imported = 0;
      let updated = 0;
      const errors: string[] = [];

      for (let i = 0; i < supplierList.length; i++) {
        const s = supplierList[i];
        try {
          if (!s.name || !s.name.trim()) {
            errors.push(`Row ${i + 1}: Name is required`);
            continue;
          }

          const [existing] = await db
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, s.name.trim())));

          if (existing) {
            await db
              .update(factorySuppliers)
              .set({
                openingBalance: s.openingBalance || existing.openingBalance,
                contactPerson: s.contactPerson !== undefined ? s.contactPerson : existing.contactPerson,
                phone: s.phone !== undefined ? s.phone : existing.phone,
                email: s.email !== undefined ? s.email : existing.email,
                updatedAt: new Date(),
              })
              .where(eq(factorySuppliers.id, existing.id));
            updated++;
          } else {
            await db.insert(factorySuppliers).values({
              companyId,
              name: s.name.trim(),
              openingBalance: s.openingBalance || "0",
              contactPerson: s.contactPerson || null,
              phone: s.phone || null,
              email: s.email || null,
            });
            imported++;
          }
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, updated, errors });
    } catch (error: any) {
      console.error("Error importing suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      let imported = 0;
      const errors: string[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          if (!item.containerNumber || !item.containerNumber.trim()) {
            errors.push(`Row ${i + 1}: Container number is required`);
            continue;
          }
          if (!item.receivedKg) {
            errors.push(`Row ${i + 1}: Received KG is required`);
            continue;
          }
          if (!item.costPerKg) {
            errors.push(`Row ${i + 1}: Cost per KG is required`);
            continue;
          }

          let supplierId: number | null = null;
          if (item.supplierName && item.supplierName.trim()) {
            const [supplier] = await db
              .select()
              .from(factorySuppliers)
              .where(
                and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, item.supplierName.trim()))
              );
            if (supplier) {
              supplierId = supplier.id;
            }
          }

          let [container] = await db
            .select()
            .from(factoryContainers)
            .where(
              and(
                eq(factoryContainers.companyId, companyId),
                eq(factoryContainers.containerNumber, item.containerNumber.trim())
              )
            );

          if (!container) {
            [container] = await db
              .insert(factoryContainers)
              .values({
                companyId,
                containerNumber: item.containerNumber.trim(),
                supplierId,
                totalKg: item.receivedKg,
                ratePerKg: item.costPerKg,
                arrivalDate: item.arrivalDate || null,
                status: "RECEIVED",
              })
              .returning();
          } else if (supplierId && !container.supplierId) {
            await db.update(factoryContainers).set({ supplierId }).where(eq(factoryContainers.id, container.id));
          }

          await db.insert(factoryRawStock).values({
            companyId,
            containerId: container.id,
            receivedKg: item.receivedKg,
            usedKg: item.usedKg || "0",
            costPerKg: item.costPerKg,
          });
          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json({ imported, errors });
    } catch (error: any) {
      console.error("Error importing raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { bales, fileName } = req.body;
      if (!Array.isArray(bales) || bales.length === 0) {
        return res.status(400).json({ message: "No bales provided" });
      }

      // Create import batch record upfront
      const [batch] = await db
        .insert(factoryBaleImportBatches)
        .values({
          companyId,
          fileName: fileName || "unknown.xlsx",
          baleCount: 0,
          errorCount: 0,
          totalWeightKg: "0",
          importedByUserId: String(req.session?.userId || ""),
          importedByName: req.session?.userName || req.session?.username || null,
        })
        .returning();

      const maxRef = await db
        .select({ maxRef: sql<number>`MAX(CAST(SUBSTRING(reference_number FROM 4) AS INTEGER))` })
        .from(factoryBales)
        .where(eq(factoryBales.companyId, companyId));
      let nextRef = Math.max(Number(maxRef[0]?.maxRef ?? 0) + 1, 200000);

      let imported = 0;
      let totalWeightKg = 0;
      const errors: string[] = [];

      for (let i = 0; i < bales.length; i++) {
        const bale = bales[i];
        try {
          if (!bale.baleCode || !bale.baleCode.trim()) {
            errors.push(`Row ${i + 1}: Bale code is required`);
            continue;
          }
          if (!bale.weightKg) {
            errors.push(`Row ${i + 1}: Weight KG is required`);
            continue;
          }

          const referenceNumber = `REF${nextRef}`;
          nextRef++;

          const status = bale.status || "IN_STOCK";
          const costPerKg = bale.costPerKg || "0";
          const weight = parseFloat(bale.weightKg);
          const cost = parseFloat(costPerKg);
          const totalCost = (weight * cost).toFixed(2);

          await db.insert(factoryBales).values({
            companyId,
            baleCode: bale.baleCode.trim(),
            referenceNumber,
            articleCode: bale.articleCode || null,
            productName: bale.productName || null,
            category: bale.category || null,
            grade: bale.grade || null,
            quantity: 1,
            weightKg: bale.weightKg,
            costPerKg,
            totalCost,
            status,
            finalizedAt: status === "IN_STOCK" ? new Date() : null,
            importBatchId: batch.id,
          });
          imported++;
          totalWeightKg += weight;
          nextRef++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      // Update batch record with final counts
      await db
        .update(factoryBaleImportBatches)
        .set({ baleCount: imported, errorCount: errors.length, totalWeightKg: totalWeightKg.toFixed(3) })
        .where(eq(factoryBaleImportBatches.id, batch.id));

      // Sync the sequence table so future stock entries don't collide with imported refs
      const [existingSeq] = await db
        .select()
        .from(factoryBaleSequences)
        .where(eq(factoryBaleSequences.companyId, companyId));

      if (existingSeq) {
        if (nextRef > existingSeq.nextNumber) {
          await db
            .update(factoryBaleSequences)
            .set({ nextNumber: nextRef })
            .where(eq(factoryBaleSequences.id, existingSeq.id));
        }
      } else {
        await db.insert(factoryBaleSequences).values({
          companyId,
          nextNumber: nextRef,
        });
      }

      res.json({ imported, errors, batchId: batch.id });
    } catch (error: any) {
      console.error("Error importing bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bale Import Batches – list ─────────────────────────────────────────────
  app.get("/api/factory/bale-import-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batches = await db
        .select()
        .from(factoryBaleImportBatches)
        .where(eq(factoryBaleImportBatches.companyId, companyId))
        .orderBy(desc(factoryBaleImportBatches.createdAt));

      res.json(batches);
    } catch (error: any) {
      console.error("Error fetching bale import batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bale Import Batches – bales in a batch ────────────────────────────────
  app.get("/api/factory/bale-import-batches/:id/bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const batchId = parseId(req.params.id);

      if (batchId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(batchId)) return res.status(400).json({ message: "Invalid batch id" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), eq(factoryBales.importBatchId, batchId)))
        .orderBy(asc(factoryBales.referenceNumber));

      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching bales for batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Opening Raw Stock Recalc Helper ────────────────────────────────────────
  // Allocation rule: for each supplierId, sum all factory_mix_batch_sources.weightKg
  // attributed to that supplier, then FIFO-allocate against that supplier's OPENING_BALANCE
  // factory_raw_stock records (ordered by offloadedAt ASC, id ASC).
  // Idempotent: resets usedKg to 0 on all OB records before recalculating.
  // Only OB raw stock (containers with status='OPENING_BALANCE') is touched.
  // Non-OB (container offload) raw stock is never modified.
  async function recalcOpeningStockUsage(
    companyId: number
  ): Promise<{ suppliersProcessed: number; totalAllocatedKg: number; unmatchedKg: number }> {
    const obRawStocks = await db
      .select({
        id: factoryRawStock.id,
        receivedKg: factoryRawStock.receivedKg,
        supplierId: factoryContainers.supplierId,
        offloadedAt: factoryRawStock.offloadedAt,
      })
      .from(factoryRawStock)
      .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
      .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryContainers.status, "OPENING_BALANCE")))
      .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id);

    if (obRawStocks.length === 0) return { suppliersProcessed: 0, totalAllocatedKg: 0, unmatchedKg: 0 };

    const obIds = obRawStocks.map((r: any) => r.id);
    await db.update(factoryRawStock).set({ usedKg: "0" }).where(inArray(factoryRawStock.id, obIds));

    const consumed = await db
      .select({
        supplierId: factoryMixBatchSources.supplierId,
        totalKg: sql<string>`COALESCE(SUM(${factoryMixBatchSources.weightKg}), '0')`,
      })
      .from(factoryMixBatchSources)
      .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
      .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatchSources.supplierId} IS NOT NULL`))
      .groupBy(factoryMixBatchSources.supplierId);

    const consumedBySupplier = new Map<number, number>();
    for (const row of consumed) {
      if (row.supplierId != null) {
        consumedBySupplier.set(row.supplierId, parseFloat(row.totalKg) || 0);
      }
    }

    const obBySupplier = new Map<number, typeof obRawStocks>();
    for (const r of obRawStocks) {
      if (r.supplierId == null) continue;
      if (!obBySupplier.has(r.supplierId)) obBySupplier.set(r.supplierId, []);
      obBySupplier.get(r.supplierId)!.push(r);
    }

    let totalAllocatedKg = 0;
    let unmatchedKg = 0;
    const suppliersProcessed = consumedBySupplier.size;

    for (const [supplierId, totalConsumed] of consumedBySupplier) {
      const records = obBySupplier.get(supplierId) || [];
      let remaining = totalConsumed;

      for (const rec of records) {
        if (remaining <= 0.001) break;
        const cap = parseFloat(rec.receivedKg as string) || 0;
        const deduct = Math.min(remaining, cap);
        await db
          .update(factoryRawStock)
          .set({ usedKg: String(deduct.toFixed(3)) })
          .where(eq(factoryRawStock.id, rec.id));
        remaining -= deduct;
        totalAllocatedKg += deduct;
      }

      if (remaining > 0.001) unmatchedKg += remaining;
    }

    return { suppliersProcessed, totalAllocatedKg, unmatchedKg };
  }

  app.post("/api/factory/raw-stock/recalc-opening", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const stats = await recalcOpeningStockUsage(companyId);
      res.json(stats);
    } catch (error: any) {
      console.error("Error recalculating opening stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import/opening-raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items provided" });
      }

      let imported = 0;
      const errors: string[] = [];

      const existingOBs = await db
        .select({ containerNumber: factoryContainers.containerNumber })
        .from(factoryContainers)
        .where(
          and(eq(factoryContainers.companyId, companyId), sql`${factoryContainers.containerNumber} LIKE ${"OB-%"}`)
        );

      let nextNum = 1;
      for (const c of existingOBs) {
        const parts = c.containerNumber.split("-");
        const num = parseInt(parts[parts.length - 1]) || 0;
        if (num >= nextNum) nextNum = num + 1;
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const supplierStr = String(item.supplier || "").trim();
          const kgVal = parseFloat(item.kg);
          const rateVal = parseFloat(item.costPerKg);
          const currency = String(item.currency || "USD").trim();
          // Never silently default a non-USD row's missing rate to 1 — require it explicitly.
          const fxRate = currency === "USD" ? 1 : parseFloat(item.fxRateToUsd ?? "");
          const openingDate = String(item.openingDate || "").trim();

          if (!supplierStr) {
            errors.push(`Row ${i + 1}: supplier is required`);
            continue;
          }
          if (isNaN(kgVal) || kgVal <= 0) {
            errors.push(`Row ${i + 1}: kg must be > 0`);
            continue;
          }
          if (isNaN(rateVal) || rateVal < 0) {
            errors.push(`Row ${i + 1}: costPerKg must be >= 0`);
            continue;
          }
          if (!currency) {
            errors.push(`Row ${i + 1}: currency is required`);
            continue;
          }
          if (isNaN(fxRate) || fxRate <= 0) {
            errors.push(`Row ${i + 1}: fxRateToUsd must be > 0`);
            continue;
          }
          if (!openingDate) {
            errors.push(`Row ${i + 1}: openingDate is required`);
            continue;
          }

          const [supplier] = await db
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, supplierStr)));

          if (!supplier) {
            errors.push(`Row ${i + 1}: supplier "${supplierStr}" not found`);
            continue;
          }

          const costPerKgUsd = currency === "USD" ? rateVal : rateVal * fxRate;
          const containerNumber = `OB-${String(nextNum).padStart(4, "0")}`;
          nextNum++;

          const [container] = await db
            .insert(factoryContainers)
            .values({
              companyId,
              containerNumber,
              supplierId: supplier.id,
              origin: "Opening Import",
              totalKg: String(kgVal),
              ratePerKg: String(rateVal),
              declaredKg: String(kgVal),
              actualReceivedKg: String(kgVal),
              finalPayableAmount: String(kgVal * rateVal),
              differenceKg: "0",
              currencyCode: currency,
              fxRateToUsd: String(fxRate),
              fxRateConfirmed: true,
              ratePerKgUsd: String(costPerKgUsd),
              finalPayableAmountUsd: String(kgVal * costPerKgUsd),
              notes: String(item.notes || "Opening stock import"),
              status: "OPENING_BALANCE",
            })
            .returning();

          await db.insert(factoryRawStock).values({
            companyId,
            containerId: container.id,
            receivedKg: String(kgVal),
            usedKg: "0",
            costPerKg: String(rateVal),
            costPerKgUsd: String(costPerKgUsd),
          });

          imported++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      let recalcStats = null;
      if (imported > 0) {
        recalcStats = await recalcOpeningStockUsage(companyId);
      }

      res.json({ imported, errors, recalcStats });
    } catch (error: any) {
      console.error("Error importing opening raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/import/template/:type", requireAuth, async (req: any, res: any) => {
    try {
      const type = req.params.type;
      let csv = "";
      let filename = "";

      switch (type) {
        case "suppliers":
          csv = "name,openingBalance,contactPerson,phone,email";
          filename = "factory_suppliers_template.csv";
          break;
        case "raw-stock":
          csv = "containerNumber,supplierName,receivedKg,usedKg,costPerKg,arrivalDate";
          filename = "factory_raw_stock_template.csv";
          break;
        case "bales":
          csv = "baleCode,articleCode,productName,category,grade,weightKg,costPerKg,status";
          filename = "factory_bales_template.csv";
          break;
        case "opening-raw-stock":
          csv = "supplier,kg,costPerKg,currency,fxRateToUsd,openingDate,notes";
          filename = "factory_opening_raw_stock_template.csv";
          break;
        default:
          return res
            .status(400)
            .json({ message: "Invalid template type. Use: suppliers, raw-stock, bales, or opening-raw-stock" });
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      console.error("Error generating template:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // FX Rates CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { currencyCode } = req.query;
      // Only return manually-set rates in the UI list (auto rows are internal cache only)
      const conditions: any[] = [eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.source, "manual")];
      if (currencyCode) conditions.push(eq(factoryFxRates.currencyCode, currencyCode as string));
      const results = await db
        .select()
        .from(factoryFxRates)
        .where(and(...conditions))
        .orderBy(desc(factoryFxRates.effectiveDate));
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/latest/:currencyCode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const today = getClientDate(req);
      try {
        const rate = await getOrFetchFxRateToUsd(companyId, currency, today);
        res.json({ rate, effectiveDate: today });
      } catch (err: any) {
        const [fallback] = await db
          .select()
          .from(factoryFxRates)
          .where(and(eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.currencyCode, currency)))
          .orderBy(desc(factoryFxRates.effectiveDate))
          .limit(1);
        if (fallback) {
          res.json({ rate: fallback.rateToUsd, effectiveDate: fallback.effectiveDate });
        } else {
          res.status(404).json({ message: err.message });
        }
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/:currencyCode/:date", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const dateISO = req.params.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
        return res.status(400).json({ message: "Date must be YYYY-MM-DD format" });
      }
      const rate = await getOrFetchFxRateToUsd(companyId, currency, dateISO);
      res.json({ rate, effectiveDate: dateISO });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const today = getClientDate(req);
      const parsed = insertFactoryFxRateSchema.parse({
        effectiveDate: today,
        ...req.body,
        companyId,
        source: "manual",
      });
      const [rate] = await db.insert(factoryFxRates).values(parsed).returning();
      res.json(rate);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // DELETE by currency code — removes all rows (manual + auto) for that currency
  app.delete("/api/factory/fx-rates/:currency", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currency.toUpperCase();
      await db
        .delete(factoryFxRates)
        .where(and(eq(factoryFxRates.companyId, companyId), eq(factoryFxRates.currencyCode, currency)));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Daybook
  // ───────────────────────────────────────────────
}
