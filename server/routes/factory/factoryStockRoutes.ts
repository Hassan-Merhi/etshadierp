import { parseId, parseOptionalId } from "../../lib/parseId";
import { getClientDate } from "../../lib/dateUtils";
import { getExportPriceVisibility } from "../../helpers/exportVisibility";
import type { Express } from "express";
import { db } from "../../db";
import { requireAuth } from "../../auth";
import { classifyNetPositionAccounts } from "../../netPositionHelper";
import { adjustInventory } from "../../inventoryHelper";
import {
  writeDaybookEntry, getOrFetchFxRateToUsd, getOrCreateLedgerAccount,
  isLegacySHA256Hash, verifySupervisorPassword,
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

export function registerFactoryStockRoutes(app: Express) {
  app.post("/api/factory/stock-entry", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items, erpLocationId, mixBatchId, entryDate } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required" });
      }
      if (!erpLocationId) {
        return res.status(400).json({ message: "Location is required" });
      }

      // Parse optional backdated entry date; default to today so history is always populated
      let effectiveEntryDate: Date | null = null;
      let effectiveDateStr: string = getClientDate(req);
      if (entryDate && typeof entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        effectiveEntryDate = new Date(entryDate + "T00:00:00.000Z");
        effectiveDateStr = entryDate;
      }

      const result = await db.transaction(async (tx: any) => {
        let mixBatch: any = null;
        if (mixBatchId) {
          const [mb] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");
          if (!mb) throw new Error("Mix batch not found");
          mixBatch = mb;
        }

        const totalExpected = items.reduce((sum: number, item: any) => sum + parseInt(item.quantity || item.qty || "1"), 0);

        const [seqRecord] = await tx
          .select()
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        // Always derive safe floor from actual DB max to handle stale sequences
        const [maxRow] = await tx
          .select({ m: sql<number>`COALESCE(MAX(CAST(REGEXP_REPLACE(reference_number, '[^0-9]', '', 'g') AS BIGINT)), 100875)` })
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), sql`reference_number ~ '^REF[0-9]+'`));
        const dbMax = Math.max((Number(maxRow?.m) || 199999) + 1, 200000);

        let nextNumber: number;
        if (seqRecord) {
          nextNumber = Math.max(seqRecord.nextNumber, dbMax);
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + totalExpected })
            .where(eq(factoryBaleSequences.id, seqRecord.id));
        } else {
          nextNumber = dbMax;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: nextNumber + totalExpected,
          });
        }

        const now = new Date();
        const finalizedAtTs = effectiveEntryDate ?? now;
        const bales: any[] = [];
        let baleIndex = 0;
        let totalWeight = 0;

        const productIds: number[] = [];
        for (const item of items) {
          if (item.productId && !productIds.includes(item.productId)) productIds.push(item.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const categoryIdSet = new Set<number>();
        factoryProducts.forEach((p: any) => { if (p.categoryId) categoryIdSet.add(p.categoryId); });
        const categoryIds = Array.from(categoryIdSet);
        const factoryCats = categoryIds.length > 0
          ? await tx.select().from(factoryCategories).where(inArray(factoryCategories.id, categoryIds))
          : [];
        const categoryMap = new Map<number, any>(factoryCats.map((c: any) => [c.id, c]));

        // Pre-resolve worker names for items that have finalizedBy set
        const workerIdSet = new Set<number>();
        for (const item of items) {
          if (item.finalizedBy) workerIdSet.add(Number(item.finalizedBy));
        }
        const workerNameMap = new Map<number, string>();
        if (workerIdSet.size > 0) {
          const wkRows = await tx.select({ id: factoryWorkers.id, fullName: factoryWorkers.fullName })
            .from(factoryWorkers)
            .where(inArray(factoryWorkers.id, Array.from(workerIdSet)));
          for (const w of wkRows) workerNameMap.set(w.id, w.fullName);
        }

        for (const item of items) {
          const qty = parseInt(item.quantity || item.qty || "1");
          const weight = parseFloat(item.weightPerBale || "25");
          const product = productMap.get(item.productId);
          if (!product) throw new Error(`Product ID ${item.productId} not found`);
          const categoryName: string | null = product.categoryId ? (categoryMap.get(product.categoryId)?.name || null) : null;
          const resolvedWorkerName: string | null = item.finalizedBy ? (workerNameMap.get(Number(item.finalizedBy)) ?? null) : null;

          for (let i = 0; i < qty; i++) {
            const refNum = `REF${String(nextNumber + baleIndex).padStart(6, '0')}`;
            const isGarbage = product.articleCode?.startsWith("HMD16");
            const productionCostPerKg = parseFloat(product.productionPrice || "0");
            const effectiveCostPerKg = isGarbage ? 0 : productionCostPerKg;
            const baleTotalCost = weight * effectiveCostPerKg;

            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                mixBatchId: mixBatchId || null,
                productId: item.productId,
                erpLocationId,
                baleCode: product.code,
                referenceNumber: refNum,
                articleCode: product.articleCode,
                productName: product.name,
                category: categoryName,
                weightKg: String(weight),
                costPerKg: String(effectiveCostPerKg),
                totalCost: String(baleTotalCost),
                status: "IN_STOCK",
                finalizedAt: finalizedAtTs,
                finalizedBy: item.finalizedBy ?? null,
                workerName: resolvedWorkerName,
                stockEntryDate: effectiveDateStr,
              })
              .returning();

            bales.push({ ...bale, _product: product });
            totalWeight += weight;
            baleIndex++;
          }
        }

        if (mixBatch) {
          const mixRemaining = parseFloat(mixBatch.totalWeightKg) - parseFloat(mixBatch.usedKg || "0");
          if (totalWeight > mixRemaining + 0.001) {
            throw new Error(`Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`);
          }

          await tx
            .update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalWeight}`, updatedAt: now })
            .where(eq(factoryMixBatches.id, mixBatchId));
        }

        const stockGroupCache = new Map<string, number>();
        const stockItemCache = new Map<string, number>();

        for (const bale of bales) {
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
                  const groupCode = catId ? `FCAT-${catId}` : "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
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

          const baleWeight = parseFloat(bale.weightKg);
          const baleRate = baleWeight * parseFloat(bale.costPerKg || "0");
          await adjustInventory(tx, erpLocationId, erpStockItemId!, 1, companyId, baleRate);
        }

        return { bales, totalWeight };
      });

      const today = effectiveDateStr || getClientDate(req);
      // Build a meaningful description with product names and reference codes
      const productGroups = new Map<string, string[]>();
      for (const bale of result.bales) {
        const name = (bale as any).productName || (bale as any).articleCode || "Unknown";
        const ref = (bale as any).referenceNumber || (bale as any).baleCode || "";
        if (!productGroups.has(name)) productGroups.set(name, []);
        if (ref) productGroups.get(name)!.push(ref);
      }
      const descParts = Array.from(productGroups.keys());
      const stockEntryDesc = `${result.bales.length} bale${result.bales.length !== 1 ? "s" : ""} - ${descParts.join(" | ")}`;
      const totalBaleValue = result.bales.reduce((sum: number, b: any) => {
        const prodPrice = parseFloat((b._product?.productionPrice) || "0");
        return sum + prodPrice;
      }, 0);
      const baleMetaJson = JSON.stringify({
        bales: result.bales.map((b: any) => ({
          id: b.id,
          ref: b.referenceNumber,
          productName: b.productName || b.articleCode || "Unknown",
          weightKg: b.weightKg,
          status: b.status || "IN_STOCK",
        })),
      });
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_STOCK_ENTRY",
        description: stockEntryDesc,
        amountCurrency: totalBaleValue,
        amountUsd: totalBaleValue,
        metaJson: baleMetaJson,
      });

      res.json({ bales: result.bales, totalWeight: result.totalWeight });
    } catch (error: any) {
      console.error("Error in stock entry:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // BALE IMPORT - Historical bales from Excel
  // ───────────────────────────────────────────────

  app.post("/api/factory/bales/import", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { erpLocationId, bales } = req.body;
      if (!erpLocationId) return res.status(400).json({ message: "Location is required" });
      if (!bales || !Array.isArray(bales) || bales.length === 0) {
        return res.status(400).json({ message: "No bales to import" });
      }

      for (const b of bales) {
        if (!b.itemName || !b.barcode || !b.weight) {
          return res.status(400).json({ message: `Each bale must have itemName, barcode, and weight. Problem row: ${b.itemName || b.barcode || "unknown"}` });
        }
        if (isNaN(parseFloat(b.weight)) || parseFloat(b.weight) <= 0) {
          return res.status(400).json({ message: `Invalid weight for ${b.itemName}: ${b.weight}` });
        }
      }

      const allIntendedRefs: string[] = [];
      const payloadDupes = new Set<string>();
      for (const b of bales) {
        const base = (b.refNumber && b.refNumber.trim()) ? b.refNumber.trim() : b.barcode.trim();
        const qty = parseInt(b.quantity) || 1;
        const refs = qty === 1 ? [base] : Array.from({ length: qty }, (_, i) => `${base}-${i + 1}`);
        for (const ref of refs) {
          if (allIntendedRefs.includes(ref)) payloadDupes.add(ref);
          allIntendedRefs.push(ref);
        }
      }
      if (payloadDupes.size > 0) {
        return res.status(400).json({ message: `Duplicate ref numbers within import file: ${Array.from(payloadDupes).join(", ")}` });
      }

      const result = await db.transaction(async (tx: any) => {
        const existingBarcodes = await tx
          .select({ referenceNumber: factoryBales.referenceNumber })
          .from(factoryBales)
          .where(eq(factoryBales.companyId, companyId));
        const existingRefSet = new Set(existingBarcodes.map((b: any) => b.referenceNumber));

        const conflicting = allIntendedRefs.filter((ref) => existingRefSet.has(ref));
        if (conflicting.length > 0) {
          throw new Error(`Barcodes already exist in system: ${conflicting.slice(0, 10).join(", ")}${conflicting.length > 10 ? ` and ${conflicting.length - 10} more` : ""}`);
        }

        const allProducts = await tx
          .select()
          .from(factoryBaleProducts)
          .where(eq(factoryBaleProducts.companyId, companyId));
        const productByName = new Map(allProducts.map((p: any) => [p.name.toLowerCase(), p]));

        const createdBales: any[] = [];
        let totalWeight = 0;

        for (const b of bales) {
          const itemName = b.itemName.trim();
          const weight = parseFloat(b.weight);
          const qty = parseInt(b.quantity) || 1;
          const barcode = b.barcode.trim();

          let product = productByName.get(itemName.toLowerCase());
          if (!product) {
            const autoPrefix = "HMD00";
            const autoPrefixLen = autoPrefix.length;
            const [autoMaxResult] = await tx
              .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${autoPrefixLen + 1}) AS INTEGER)), 0)` })
              .from(factoryBaleProducts)
              .where(and(
                eq(factoryBaleProducts.companyId, companyId),
                sql`${factoryBaleProducts.articleCode} LIKE ${autoPrefix + '%'}`,
                sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${autoPrefixLen + 1}) ~ '^[0-9]+$'`
              ));
            let autoNextNum = (autoMaxResult?.maxNum || 0) + 1;
            let articleCode = `${autoPrefix}${String(autoNextNum).padStart(3, "0")}`;
            let autoAttempts = 0;
            while (autoAttempts < 100) {
              const [dupCheck] = await tx.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));
              if (!dupCheck) break;
              autoNextNum++;
              articleCode = `${autoPrefix}${String(autoNextNum).padStart(3, "0")}`;
              autoAttempts++;
            }
            const code = articleCode;

            const [newProduct] = await tx.insert(factoryBaleProducts).values({
              companyId,
              code,
              articleCode,
              name: itemName,
              active: true,
            }).returning();
            product = newProduct;
            productByName.set(itemName.toLowerCase(), product);
          }

          for (let i = 0; i < qty; i++) {
            const pressedAt = b.productionDate ? new Date(b.productionDate) : null;
            const refBase = (b.refNumber && b.refNumber.trim()) ? b.refNumber.trim() : barcode;
            const refNum = qty === 1 ? refBase : `${refBase}-${i + 1}`;

            const [bale] = await tx
              .insert(factoryBales)
              .values({
                companyId,
                productId: product.id,
                erpLocationId,
                baleCode: product.code,
                referenceNumber: refNum,
                articleCode: product.articleCode,
                productName: product.name,
                weightKg: String(weight),
                costPerKg: "0",
                totalCost: "0",
                status: "IN_STOCK",
                finalizedAt: new Date(),
                ...(pressedAt && !isNaN(pressedAt.getTime()) ? { pressedAt } : {}),
              })
              .returning();

            createdBales.push(bale);
            totalWeight += weight;
          }
        }

        const stockItemCache = new Map<string, number>();

        for (const bale of createdBales) {
          const product = productByName.get((bale.productName as string).toLowerCase());
          if (!product) continue;
          const itemCode: string = product.articleCode || product.code;
          if (!itemCode) continue;

          let erpStockItemId = stockItemCache.get(itemCode);
          if (!erpStockItemId) {
            const [existing] = await tx
              .select({ id: stockItems.id })
              .from(stockItems)
              .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));

            if (existing) {
              erpStockItemId = existing.id;
            } else {
              const [created] = await tx
                .insert(stockItems)
                .values({ companyId, code: itemCode, name: product.name as string, uom: "BALE", active: true })
                .returning({ id: stockItems.id });
              erpStockItemId = created.id;
            }
            stockItemCache.set(itemCode, erpStockItemId!);
          }

          await adjustInventory(tx, erpLocationId, erpStockItemId!, 1, companyId, 0);
        }

        return { bales: createdBales, totalWeight, count: createdBales.length };
      });

      const today = getClientDate(req);
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_IMPORT",
        description: `Imported ${result.count} historical bale(s) into stock (${result.totalWeight.toFixed(1)} kg)`,
      });

      res.json({ imported: result.count, totalWeight: result.totalWeight, bales: result.bales });
    } catch (error: any) {
      console.error("Error importing bales:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/stock-entry/remove", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { baleIds, supervisorUsername, supervisorPassword, reason } = req.body;

      if (!baleIds || !Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds array is required" });
      }
      if (!supervisorUsername || !supervisorPassword) {
        return res.status(400).json({ message: "Supervisor credentials are required" });
      }

      const [supervisor] = await db
        .select()
        .from(users)
        .where(eq(users.username, supervisorUsername));

      if (!supervisor) {
        return res.status(403).json({ message: "Supervisor not found" });
      }

      const passwordValid = await verifySupervisorPassword(supervisorPassword, supervisor.password);
      if (!passwordValid) {
        return res.status(403).json({ message: "Invalid supervisor password" });
      }

      const [role] = await db
        .select()
        .from(userCompanyRoles)
        .where(and(eq(userCompanyRoles.userId, supervisor.id), eq(userCompanyRoles.companyId, companyId)));

      if (!role || !["Admin", "Owner", "Manager", "Developer"].includes(role.role)) {
        return res.status(403).json({ message: "Supervisor must have Admin, Owner, or Manager role" });
      }

      const result = await db.transaction(async (tx: any) => {
        const balesToRemove = await tx
          .select()
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

        const removedBales: any[] = [];
        const now = new Date();

        const productIds: number[] = [];
        for (const bale of balesToRemove) {
          if (bale.productId && !productIds.includes(bale.productId)) productIds.push(bale.productId);
        }
        const factoryProducts = productIds.length > 0
          ? await tx.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
          : [];
        const productMap = new Map<number, any>(factoryProducts.map((p: any) => [p.id, p]));

        const stockItemCache = new Map<string, number>();

        for (const bale of balesToRemove) {
          const [updated] = await tx
            .update(factoryBales)
            .set({
              status: "DELETED",
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id))
            .returning();

          const factoryProductForBale = productMap.get(bale.productId as number);
          removedBales.push({ ...updated, productName: factoryProductForBale?.name || factoryProductForBale?.articleCode || "Unknown" });

          // Only adjust ERP inventory for bales that were actually counted in stock
          if (bale.status === "IN_STOCK" && bale.erpLocationId) {
            const factoryProduct = productMap.get(bale.productId as number);
            const itemCode = factoryProduct?.articleCode || factoryProduct?.code || bale.articleCode || bale.baleCode;

            if (itemCode) {
              let erpStockItemId = stockItemCache.get(itemCode);
              if (!erpStockItemId) {
                const [existing] = await tx
                  .select({ id: stockItems.id })
                  .from(stockItems)
                  .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));
                if (existing) {
                  erpStockItemId = existing.id;
                  stockItemCache.set(itemCode, erpStockItemId!);
                }
              }

              if (erpStockItemId) {
                await adjustInventory(tx, bale.erpLocationId!, erpStockItemId, -1, companyId);
              }
            }
          }
        }

        return { removed: removedBales };
      });

      const today = getClientDate(req);
      const removalMetaJson = JSON.stringify({
        bales: result.removed.map((b: any) => ({
          id: b.id,
          ref: b.referenceNumber,
          productName: b.productName || "Unknown",
          weightKg: b.weightKg,
          status: "DELETED",
        })),
      });
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_REMOVAL",
        description: `Removed ${result.removed.length} bale(s) from stock. Supervisor: ${supervisorUsername}. Reason: ${reason || "N/A"}`,
        metaJson: removalMetaJson,
      });

      res.json({ removed: result.removed.length, bales: result.removed });
    } catch (error: any) {
      console.error("Error removing bales:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Remove N bales of a specific product from a specific location
  app.post("/api/factory/stock-entry/remove-by-product", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { productId, locationId, qty, supervisorUsername, supervisorPassword, reason } = req.body;

      if (!productId || !locationId || !qty || qty < 1) {
        return res.status(400).json({ message: "productId, locationId, and qty >= 1 are required" });
      }
      if (!supervisorUsername || !supervisorPassword) {
        return res.status(400).json({ message: "Supervisor credentials are required" });
      }

      const [supervisor] = await db
        .select()
        .from(users)
        .where(eq(users.username, supervisorUsername));

      if (!supervisor) return res.status(403).json({ message: "Supervisor not found" });

      const passwordValid = await verifySupervisorPassword(supervisorPassword, supervisor.password);
      if (!passwordValid) return res.status(403).json({ message: "Invalid supervisor password" });

      const [role] = await db
        .select()
        .from(userCompanyRoles)
        .where(and(eq(userCompanyRoles.userId, supervisor.id), eq(userCompanyRoles.companyId, companyId)));

      if (!role || !["Admin", "Owner", "Manager", "Developer"].includes(role.role)) {
        return res.status(403).json({ message: "Supervisor must have Admin, Owner, or Manager role" });
      }

      const result = await db.transaction(async (tx: any) => {
        const balesToRemove = await tx
          .select()
          .from(factoryBales)
          .where(
            and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.productId, productId),
              eq(factoryBales.erpLocationId, locationId),
              eq(factoryBales.status, "IN_STOCK")
            )
          )
          .limit(qty);

        if (balesToRemove.length === 0) {
          throw new Error("No in-stock bales found for this product at this location");
        }

        const removedBales: any[] = [];
        const now = new Date();
        const [factoryProduct] = await tx.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.id, productId));
        const itemCode = factoryProduct?.articleCode || factoryProduct?.code;
        let erpStockItemId: number | undefined;
        if (itemCode) {
          const [existing] = await tx.select({ id: stockItems.id }).from(stockItems)
            .where(and(eq(stockItems.companyId, companyId), eq(stockItems.code, itemCode)));
          if (existing) erpStockItemId = existing.id;
        }

        for (const bale of balesToRemove) {
          const [updated] = await tx.update(factoryBales)
            .set({ status: "DELETED", updatedAt: now })
            .where(eq(factoryBales.id, bale.id))
            .returning();
          removedBales.push({ ...updated, productName: factoryProduct?.name || factoryProduct?.articleCode || "Unknown" });
          if (erpStockItemId) {
            await adjustInventory(tx, bale.erpLocationId!, erpStockItemId, -1, companyId);
          }
        }
        return { removed: removedBales };
      });

      const today = getClientDate(req);
      const baleMetaJson = JSON.stringify({
        bales: result.removed.map((b: any) => ({
          id: b.id,
          ref: b.referenceNumber,
          productName: b.productName || "Unknown",
          weightKg: b.weightKg,
          status: "DELETED",
        })),
      });
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "BALE_REMOVAL",
        description: `Removed ${result.removed.length} bale(s) from stock. Supervisor: ${supervisorUsername}. Reason: ${reason || "N/A"}`,
        metaJson: baleMetaJson,
      });

      res.json({ removed: result.removed.length, bales: result.removed });
    } catch (error: any) {
      console.error("Error removing bales by product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/location-inventory/:locationId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const locationId = parseId(req.params.locationId);

      if (locationId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.erpLocationId, locationId),
            eq(factoryBales.status, "IN_STOCK"),
          )
        );

      // Find which of these IN_STOCK bales are currently scanned into a LOADING order.
      // V5 orders keep bales IN_STOCK during loading (unlike V2/V3 which flip to RESERVED_FOR_ORDER),
      // so we cross-reference customer_order_bales → customer_orders to detect them.
      const baleIds = bales.map((b) => b.id);
      const loadingBaleIds = new Set<number>();
      if (baleIds.length > 0) {
        const loadingRows = await db
          .select({ baleId: customerOrderBales.baleId })
          .from(customerOrderBales)
          .innerJoin(customerOrders, eq(customerOrderBales.orderId, customerOrders.id))
          .where(
            and(
              eq(customerOrders.status, "LOADING"),
              inArray(customerOrderBales.baleId, baleIds),
            )
          );
        for (const r of loadingRows) loadingBaleIds.add(r.baleId);
      }

      // Fetch ALL products for the company so we can also match by articleCode
      // (bales imported historically may have productId=null but articleCode set)
      const allProducts = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));

      const categoryIds = [...new Set(allProducts.map(p => p.categoryId).filter((id): id is number => id != null))];
      const categories = categoryIds.length > 0
        ? await db.select().from(factoryCategories).where(and(eq(factoryCategories.companyId, companyId), inArray(factoryCategories.id, categoryIds)))
        : [];

      const categoryMap = new Map(categories.map(c => [c.id, c.name]));
      // Primary lookup: by product id
      const productById = new Map(allProducts.map(p => [p.id, p]));
      // Fallback lookup: by articleCode (for bales where productId is null/0)
      const productByArticleCode = new Map(
        allProducts.filter(p => p.articleCode).map(p => [p.articleCode!.toLowerCase(), p])
      );

      const getProduct = (bale: typeof bales[number]) => {
        const byId = bale.productId ? productById.get(bale.productId) : undefined;
        if (byId) return byId;
        return bale.articleCode ? productByArticleCode.get(bale.articleCode.toLowerCase()) : undefined;
      };

      const grouped = new Map<string, {
        productId: number;
        articleCode: string;
        productName: string;
        category: string | null;
        categoryId: number | null;
        quantity: number;
        totalWeight: number;
        totalCost: number;
        baleCount: number;
        loadingCount: number;
        sellingPrice: string;
        productionPrice: number;
        referenceNumbers: string[];
      }>();

      for (const b of bales) {
        const product = getProduct(b);
        const groupKey = product ? `p:${product.id}` : `a:${b.articleCode || b.baleCode || "unknown"}`;
        const existing = grouped.get(groupKey);
        const qty = parseFloat(String(b.quantity || "1"));
        const weight = parseFloat(String(b.weightKg || "0"));
        const productionPrice = parseFloat(String((product as any)?.productionPrice || "0"));
        const sellingPrice = String(product?.sellingPrice || "0");
        const categoryName = product?.categoryId ? (categoryMap.get(product.categoryId) || b.category || null) : (b.category || null);
        const categoryId = product?.categoryId || null;
        const refNum: string = (b as any).referenceNumber || "";
        const isLoading = loadingBaleIds.has(b.id);
        if (existing) {
          existing.quantity += qty;
          existing.totalWeight += weight;
          existing.totalCost += productionPrice;
          existing.baleCount += 1;
          if (isLoading) existing.loadingCount += 1;
          if (refNum) existing.referenceNumbers.push(refNum);
        } else {
          grouped.set(groupKey, {
            productId: product?.id || b.productId || 0,
            articleCode: product?.articleCode || b.articleCode || b.baleCode || "",
            productName: product?.name || b.productName || "Unknown",
            category: categoryName,
            categoryId,
            quantity: qty,
            totalWeight: weight,
            totalCost: productionPrice,
            baleCount: 1,
            loadingCount: isLoading ? 1 : 0,
            sellingPrice,
            productionPrice,
            referenceNumbers: refNum ? [refNum] : [],
          });
        }
      }

      const result = Array.from(grouped.values()).sort((a, b) => a.productName.localeCompare(b.productName));
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching factory location inventory:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Returns inventory with pending proforma reservations subtracted
  app.get("/api/factory/location-inventory/:locationId/available", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const locationId = parseId(req.params.locationId);

      if (locationId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      // --- stock (same logic as base endpoint) ---
      const bales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.erpLocationId, locationId),
            eq(factoryBales.status, "IN_STOCK"),
          )
        );

      const allProducts = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const categoryIds = [...new Set(allProducts.map(p => p.categoryId).filter((id): id is number => id != null))];
      const categories = categoryIds.length > 0
        ? await db.select().from(factoryCategories).where(and(eq(factoryCategories.companyId, companyId), inArray(factoryCategories.id, categoryIds)))
        : [];
      const categoryMap = new Map(categories.map(c => [c.id, c.name]));
      const productById = new Map(allProducts.map(p => [p.id, p]));
      const productByArticleCode = new Map(allProducts.filter(p => p.articleCode).map(p => [p.articleCode!.toLowerCase(), p]));
      const getProduct = (bale: typeof bales[number]) => {
        const byId = bale.productId ? productById.get(bale.productId) : undefined;
        if (byId) return byId;
        return bale.articleCode ? productByArticleCode.get(bale.articleCode.toLowerCase()) : undefined;
      };

      const grouped = new Map<string, {
        productId: number; articleCode: string; productName: string;
        category: string | null; categoryId: number | null;
        quantity: number; totalWeight: number; totalCost: number;
        baleCount: number; sellingPrice: string; productionPrice: number;
      }>();

      for (const b of bales) {
        const product = getProduct(b);
        const groupKey = product ? `p:${product.id}` : `a:${b.articleCode || b.baleCode || "unknown"}`;
        const existing = grouped.get(groupKey);
        const qty = parseFloat(String(b.quantity || "1"));
        const weight = parseFloat(String(b.weightKg || "0"));
        const productionPrice = parseFloat(String((product as any)?.productionPrice || "0"));
        const sellingPrice = String(product?.sellingPrice || "0");
        const categoryName = product?.categoryId ? (categoryMap.get(product.categoryId) || b.category || null) : (b.category || null);
        const categoryId = product?.categoryId || null;
        if (existing) {
          existing.quantity += qty; existing.totalWeight += weight;
          existing.totalCost += productionPrice; existing.baleCount += 1;
        } else {
          grouped.set(groupKey, { productId: product?.id || b.productId || 0, articleCode: product?.articleCode || b.articleCode || b.baleCode || "", productName: product?.name || b.productName || "Unknown", category: categoryName, categoryId, quantity: qty, totalWeight: weight, totalCost: productionPrice, baleCount: 1, sellingPrice, productionPrice });
        }
      }

      // Return stock as-is — no reservation subtraction
      const result = Array.from(grouped.values()).map(item => {
        return { ...item, reservedQty: 0, availableQty: item.baleCount, reservations: [] };
      }).sort((a, b) => a.productName.localeCompare(b.productName));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching available factory location inventory:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/location-inventory/:locationId/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const locationId = parseId(req.params.locationId);

      if (locationId === null) return res.status(400).json({ message: "Invalid id" });
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const [fCfg] = await db.select({ hideAvgCost: factorySettings.hideAvgCost, hideSellingPrice: factorySettings.hideSellingPrice }).from(factorySettings).where(eq(factorySettings.companyId, companyId)).limit(1);
      const userVis = await getExportPriceVisibility(req);
      const includeCost = req.query.includeCost !== "0" && !fCfg?.hideAvgCost && !userVis.hideCost;
      const includeSellPrice = req.query.includeSellPrice !== "0" && !fCfg?.hideSellingPrice && !userVis.hideSelling;

      // Only IN_STOCK — exclude FINALIZED and RESERVED
      const allLocationBales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.erpLocationId, locationId),
            eq(factoryBales.status, "IN_STOCK"),
          )
        );

      // Exclude bales already scanned into a LOADING order (V5 orders keep bales IN_STOCK during loading)
      const allLocationBaleIds = allLocationBales.map(b => b.id);
      const loadingBaleIdsExport = new Set<number>();
      if (allLocationBaleIds.length > 0) {
        const loadingRows = await db
          .select({ baleId: customerOrderBales.baleId })
          .from(customerOrderBales)
          .innerJoin(customerOrders, eq(customerOrderBales.orderId, customerOrders.id))
          .where(
            and(
              eq(customerOrders.status, "LOADING"),
              inArray(customerOrderBales.baleId, allLocationBaleIds),
            )
          );
        for (const r of loadingRows) loadingBaleIdsExport.add(r.baleId);
      }
      const bales = allLocationBales.filter(b => !loadingBaleIdsExport.has(b.id));

      const productIds = [...new Set(bales.map(b => b.productId).filter((id): id is number => id != null && id > 0))];
      const products = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
        : [];
      const categoryIds = [...new Set(products.map(p => p.categoryId).filter((id): id is number => id != null))];
      const categories = categoryIds.length > 0
        ? await db.select().from(factoryCategories).where(and(eq(factoryCategories.companyId, companyId), inArray(factoryCategories.id, categoryIds)))
        : [];

      const categoryMap = new Map(categories.map(c => [c.id, c.name]));
      const productCategoryNameMap = new Map(products.map(p => [p.id, categoryMap.get(p.categoryId!) || ""]));
      const productProductionPriceMap = new Map(products.map(p => [p.id, parseFloat((p as any).productionPrice || "0")]));
      const productSellingPriceMap = new Map(products.map(p => [p.id, parseFloat((p as any).sellingPrice || "0")]));

      const isWiperOrGarbage = (catName: string) => {
        const n = catName.toLowerCase();
        return n.includes("wiper") || n.includes("garbage") || n.includes("rag");
      };

      type GroupedRow = { articleCode: string; productName: string; category: string; baleCount: number; totalWeight: number; productionPrice: number; sellingPrice: number };
      const mainGrouped = new Map<number, GroupedRow>();
      const wgGrouped = new Map<number, GroupedRow>();

      for (const b of bales) {
        const pid = b.productId || 0;
        const weight = parseFloat(String(b.weightKg || "0"));
        const catName = productCategoryNameMap.get(pid) || b.category || "";
        const target = isWiperOrGarbage(catName) ? wgGrouped : mainGrouped;
        const existing = target.get(pid);
        if (existing) {
          existing.totalWeight += weight;
          existing.baleCount += 1;
        } else {
          target.set(pid, {
            articleCode: b.articleCode || b.baleCode || "",
            productName: b.productName || "Unknown",
            category: catName,
            totalWeight: weight,
            baleCount: 1,
            productionPrice: productProductionPriceMap.get(pid) || 0,
            sellingPrice: productSellingPriceMap.get(pid) || 0,
          });
        }
      }

      const mainRows = Array.from(mainGrouped.values()).sort((a, b) => a.productName.localeCompare(b.productName));
      const wgRows = Array.from(wgGrouped.values()).sort((a, b) => a.productName.localeCompare(b.productName));
      const sortedBales = [...bales].sort((a, b) => (a.productName || "").localeCompare(b.productName || ""));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Factory System";
      workbook.created = new Date();

      const HEADER_BLUE   = "FF1F4E79";  // dark navy
      const HEADER_PURPLE = "FF4B2D7F";  // dark purple for wiper/garbage sheet
      const HEADER_TEAL   = "FF1D5F6A";  // dark teal for bale detail
      const ROW_ALT       = "FFF5F8FF";  // very light blue alternating
      const ROW_WG_ALT    = "FFFAF5FF";  // very light purple alternating
      const TOTAL_BG      = "FFE8F0FE";
      const NUM_FMT       = "#,##0.00";
      const INT_FMT       = "#,##0";

      const styleHeaderRow = (row: any, argbColor: string) => {
        row.height = 20;
        row.eachCell((cell: any) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argbColor } };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
          cell.border = {
            bottom: { style: "medium", color: { argb: "FFD0D0D0" } },
          };
        });
      };

      const applyDataRow = (row: any, isAlt: boolean, altArgb: string) => {
        if (isAlt) {
          row.eachCell({ includeEmpty: false }, (cell: any) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: altArgb } };
          });
        }
        row.eachCell({ includeEmpty: false }, (cell: any) => {
          cell.alignment = { vertical: "middle" };
        });
      };

      const buildSummarySheet = (
        ws: any,
        rows: GroupedRow[],
        label: string,
        headerColor: string,
        altColor: string,
      ) => {
        const cols: any[] = [
          { header: "Article Code", key: "articleCode", width: 18 },
          { header: "Product Name", key: "productName", width: 38 },
          { header: "Category", key: "category", width: 22 },
          { header: "Bales", key: "baleCount", width: 10 },
          { header: "Wt/Bale (kg)", key: "weightPerBale", width: 14 },
          { header: "Total KG", key: "totalWeight", width: 14 },
        ];
        if (includeCost) {
          cols.push({ header: "Rate (Cost)", key: "productionPrice", width: 14 });
          cols.push({ header: "Total Cost", key: "totalCostValue", width: 16 });
        }
        if (includeSellPrice) {
          cols.push({ header: "Sell Price", key: "sellingPrice", width: 14 });
          cols.push({ header: "Total Sell Value", key: "totalSellValue", width: 16 });
        }
        ws.columns = cols;
        styleHeaderRow(ws.getRow(1), headerColor);

        let totalBales = 0, totalKg = 0, totalCost = 0, totalSell = 0;
        rows.forEach((row, idx) => {
          const wpb = row.baleCount > 0 ? row.totalWeight / row.baleCount : 0;
          const tc = row.productionPrice * row.baleCount;
          const ts = row.sellingPrice * row.baleCount;
          totalBales += row.baleCount;
          totalKg += row.totalWeight;
          totalCost += tc;
          totalSell += ts;

          const rd: any = {
            articleCode: row.articleCode,
            productName: row.productName,
            category: row.category,
            baleCount: row.baleCount,
            weightPerBale: parseFloat(wpb.toFixed(2)),
            totalWeight: parseFloat(row.totalWeight.toFixed(2)),
          };
          if (includeCost) { rd.productionPrice = row.productionPrice; rd.totalCostValue = parseFloat(tc.toFixed(2)); }
          if (includeSellPrice) { rd.sellingPrice = row.sellingPrice; rd.totalSellValue = parseFloat(ts.toFixed(2)); }
          const exRow = ws.addRow(rd);
          applyDataRow(exRow, idx % 2 === 1, altColor);
          // Number formats
          exRow.getCell("baleCount").numFmt = INT_FMT;
          exRow.getCell("weightPerBale").numFmt = NUM_FMT;
          exRow.getCell("totalWeight").numFmt = NUM_FMT;
          if (includeCost) { exRow.getCell("productionPrice").numFmt = NUM_FMT; exRow.getCell("totalCostValue").numFmt = NUM_FMT; }
          if (includeSellPrice) { exRow.getCell("sellingPrice").numFmt = NUM_FMT; exRow.getCell("totalSellValue").numFmt = NUM_FMT; }
        });

        ws.addRow({});
        const td: any = {
          articleCode: "",
          productName: `TOTAL — ${rows.length} ${label}`,
          category: "",
          baleCount: totalBales,
          weightPerBale: "",
          totalWeight: parseFloat(totalKg.toFixed(2)),
        };
        if (includeCost) { td.productionPrice = ""; td.totalCostValue = parseFloat(totalCost.toFixed(2)); }
        if (includeSellPrice) { td.sellingPrice = ""; td.totalSellValue = parseFloat(totalSell.toFixed(2)); }
        const tr = ws.addRow(td);
        tr.font = { bold: true };
        tr.eachCell({ includeEmpty: false }, (cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
        });
        tr.getCell("baleCount").numFmt = INT_FMT;
        tr.getCell("totalWeight").numFmt = NUM_FMT;
        if (includeCost) tr.getCell("totalCostValue").numFmt = NUM_FMT;
        if (includeSellPrice) tr.getCell("totalSellValue").numFmt = NUM_FMT;

        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
        ws.views = [{ state: "frozen", ySplit: 1 }];
      };

      // Sheet 1: Stock Summary (main items only)
      const summarySheet = workbook.addWorksheet("Stock Summary");
      buildSummarySheet(summarySheet, mainRows, "products", HEADER_BLUE, ROW_ALT);

      // Sheet 2: Wipers & Garbage
      const wgSheet = workbook.addWorksheet("Wipers & Garbage");
      buildSummarySheet(wgSheet, wgRows, "items", HEADER_PURPLE, ROW_WG_ALT);

      // Sheet 3: Bale Details (main only — no wipers/garbage)
      const mainBales = sortedBales.filter(b => {
        const pid = b.productId ?? 0;
        const cat = productCategoryNameMap.get(pid) || b.category || "";
        return !isWiperOrGarbage(cat);
      });

      const baleSheet = workbook.addWorksheet("Bale Details");
      const baleCols: any[] = [
        { header: "Bale Ref #", key: "referenceNumber", width: 24 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 38 },
        { header: "Category", key: "category", width: 22 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (includeCost) {
        baleCols.push({ header: "Cost/kg", key: "costPerKg", width: 14 });
        baleCols.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      baleSheet.columns = baleCols;
      styleHeaderRow(baleSheet.getRow(1), HEADER_TEAL);

      mainBales.forEach((b, idx) => {
        const pid = b.productId ?? 0;
        const rd: any = {
          referenceNumber: b.referenceNumber,
          articleCode: b.articleCode || "",
          productName: b.productName || "",
          category: productCategoryNameMap.get(pid) || b.category || "",
          grade: (b as any).grade || "",
          weightKg: parseFloat(String(b.weightKg || "0")),
        };
        if (includeCost) {
          rd.costPerKg = parseFloat(String(b.costPerKg || "0"));
          rd.totalCost = parseFloat(String(b.totalCost || "0"));
        }
        const exRow = baleSheet.addRow(rd);
        applyDataRow(exRow, idx % 2 === 1, ROW_ALT);
        exRow.getCell("weightKg").numFmt = NUM_FMT;
        if (includeCost) { exRow.getCell("costPerKg").numFmt = NUM_FMT; exRow.getCell("totalCost").numFmt = NUM_FMT; }
      });

      baleSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: baleCols.length } };
      baleSheet.views = [{ state: "frozen", ySplit: 1 }];

      // Sheet 4: Garbage & Wiper Bale Details (with reference numbers)
      const HEADER_ORANGE = "FF7B3F00";
      const ROW_WG_DETAIL_ALT = "FFFFF8F0";

      const garbageBales = sortedBales.filter(b => {
        const pid = b.productId ?? 0;
        const cat = productCategoryNameMap.get(pid) || b.category || "";
        return isWiperOrGarbage(cat);
      });

      const garbageDetailSheet = workbook.addWorksheet("Garbage & Wiper Details");
      const garbageBaleCols: any[] = [
        { header: "Bale Ref #", key: "referenceNumber", width: 24 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 38 },
        { header: "Category", key: "category", width: 22 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (includeCost) {
        garbageBaleCols.push({ header: "Cost/kg", key: "costPerKg", width: 14 });
        garbageBaleCols.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      garbageDetailSheet.columns = garbageBaleCols;
      styleHeaderRow(garbageDetailSheet.getRow(1), HEADER_ORANGE);

      let gbTotalKg = 0;
      garbageBales.forEach((b, idx) => {
        const pid = b.productId ?? 0;
        const w = parseFloat(String(b.weightKg || "0"));
        gbTotalKg += w;
        const rd: any = {
          referenceNumber: b.referenceNumber,
          baleCode: b.baleCode || "",
          articleCode: b.articleCode || "",
          productName: b.productName || "",
          category: productCategoryNameMap.get(pid) || b.category || "",
          grade: (b as any).grade || "",
          weightKg: w,
        };
        if (includeCost) {
          rd.costPerKg = parseFloat(String(b.costPerKg || "0"));
          rd.totalCost = parseFloat(String(b.totalCost || "0"));
        }
        const exRow = garbageDetailSheet.addRow(rd);
        applyDataRow(exRow, idx % 2 === 1, ROW_WG_DETAIL_ALT);
        exRow.getCell("weightKg").numFmt = NUM_FMT;
        if (includeCost) { exRow.getCell("costPerKg").numFmt = NUM_FMT; exRow.getCell("totalCost").numFmt = NUM_FMT; }
      });

      // Totals row for garbage sheet
      if (garbageBales.length > 0) {
        garbageDetailSheet.addRow({});
        const gtd: any = {
          referenceNumber: "",
          baleCode: "",
          articleCode: "",
          productName: `TOTAL — ${garbageBales.length} bales`,
          category: "",
          grade: "",
          weightKg: parseFloat(gbTotalKg.toFixed(2)),
        };
        if (includeCost) {
          gtd.costPerKg = "";
          gtd.totalCost = parseFloat(garbageBales.reduce((s, b) => s + parseFloat(String(b.totalCost || "0")), 0).toFixed(2));
        }
        const gtr = garbageDetailSheet.addRow(gtd);
        gtr.font = { bold: true };
        gtr.eachCell({ includeEmpty: false }, (cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
        });
        gtr.getCell("weightKg").numFmt = NUM_FMT;
        if (includeCost) gtr.getCell("totalCost").numFmt = NUM_FMT;
      }

      garbageDetailSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: garbageBaleCols.length } };
      garbageDetailSheet.views = [{ state: "frozen", ySplit: 1 }];

      const dateStr = getClientDate(req);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="inventory_location_${locationId}_${dateStr}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting inventory Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export ALL locations inventory to Excel — summary + bale detail, wipers/garbage on own sheet
  app.get("/api/factory/location-inventory/export/all", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [fCfgAll] = await db.select({ hideAvgCost: factorySettings.hideAvgCost, hideSellingPrice: factorySettings.hideSellingPrice }).from(factorySettings).where(eq(factorySettings.companyId, companyId)).limit(1);
      const userVisAll = await getExportPriceVisibility(req);
      const includeCost = req.query.includeCost !== "0" && !fCfgAll?.hideAvgCost && !userVisAll.hideCost;

      // Only IN_STOCK — exclude FINALIZED and RESERVED
      const allBalesRaw = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "IN_STOCK"),
          )
        )
        .orderBy(factoryBales.erpLocationId, factoryBales.productName);

      // Exclude bales already scanned into a LOADING order (V5 orders keep bales IN_STOCK during loading)
      const allBaleIdsRaw = allBalesRaw.map(b => b.id);
      const loadingBaleIdsAll = new Set<number>();
      if (allBaleIdsRaw.length > 0) {
        const loadingRowsAll = await db
          .select({ baleId: customerOrderBales.baleId })
          .from(customerOrderBales)
          .innerJoin(customerOrders, eq(customerOrderBales.orderId, customerOrders.id))
          .where(
            and(
              eq(customerOrders.status, "LOADING"),
              inArray(customerOrderBales.baleId, allBaleIdsRaw),
            )
          );
        for (const r of loadingRowsAll) loadingBaleIdsAll.add(r.baleId);
      }
      const bales = allBalesRaw.filter(b => !loadingBaleIdsAll.has(b.id));

      // Build lookup maps
      const locationIds = [...new Set(bales.map(b => b.erpLocationId).filter((id): id is number => id != null))];
      const locationRecords = locationIds.length > 0
        ? await db.select().from(locations).where(inArray(locations.id, locationIds))
        : [];
      const locationMap = new Map(locationRecords.map(l => [l.id, l.name]));

      const productIds = [...new Set(bales.map(b => b.productId).filter((id): id is number => id != null && id > 0))];
      const products = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
        : [];
      const categoryIds = [...new Set(products.map(p => p.categoryId).filter((id): id is number => id != null))];
      const categories = categoryIds.length > 0
        ? await db.select().from(factoryCategories).where(and(eq(factoryCategories.companyId, companyId), inArray(factoryCategories.id, categoryIds)))
        : [];

      const categoryMap = new Map(categories.map(c => [c.id, c.name]));
      const productCategoryNameMap = new Map(products.map(p => [p.id, categoryMap.get(p.categoryId!) || ""]));
      const productProductionPriceMap = new Map(products.map(p => [p.id, parseFloat((p as any).productionPrice || "0")]));

      const isWiperOrGarbage = (catName: string) => {
        const n = catName.toLowerCase();
        return n.includes("wiper") || n.includes("garbage") || n.includes("rag");
      };

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Factory System";
      workbook.created = new Date();

      const HEADER_BLUE   = "FF1F4E79";
      const HEADER_PURPLE = "FF4B2D7F";
      const HEADER_TEAL   = "FF1D5F6A";
      const ROW_ALT       = "FFF5F8FF";
      const ROW_WG_ALT    = "FFFAF5FF";
      const TOTAL_BG      = "FFE8F0FE";
      const LOC_SEP       = "FFDCE6F1"; // light blue for location separator rows
      const NUM_FMT       = "#,##0.00";
      const INT_FMT       = "#,##0";

      const styleHeaderRow = (row: any, argbColor: string) => {
        row.height = 20;
        row.eachCell((cell: any) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argbColor } };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = { bottom: { style: "medium", color: { argb: "FFD0D0D0" } } };
        });
      };

      const applyDataRow = (row: any, isAlt: boolean, altArgb: string) => {
        if (isAlt) {
          row.eachCell({ includeEmpty: false }, (cell: any) => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: altArgb } };
          });
        }
        row.eachCell({ includeEmpty: false }, (cell: any) => {
          cell.alignment = { vertical: "middle" };
        });
      };

      // Group bales by locationId + productId, split main vs wiper/garbage
      type GroupedLocRow = { locationName: string; articleCode: string; productName: string; category: string; baleCount: number; totalWeight: number; productionPrice: number };
      const mainGrouped = new Map<string, GroupedLocRow>();
      const wgGrouped   = new Map<string, GroupedLocRow>();

      for (const b of bales) {
        const locId = b.erpLocationId ?? 0;
        const pid   = b.productId ?? 0;
        const key   = `${locId}::${pid}`;
        const weight = parseFloat(String(b.weightKg || "0"));
        const catName = productCategoryNameMap.get(pid) || b.category || "";
        const target  = isWiperOrGarbage(catName) ? wgGrouped : mainGrouped;
        const existing = target.get(key);
        if (existing) {
          existing.totalWeight += weight;
          existing.baleCount   += 1;
        } else {
          target.set(key, {
            locationName: locationMap.get(locId) || `Location #${locId}`,
            articleCode: b.articleCode || "",
            productName: b.productName || "Unknown",
            category: catName,
            totalWeight: weight,
            baleCount: 1,
            productionPrice: productProductionPriceMap.get(pid) || 0,
          });
        }
      }

      const sortRows = (rows: GroupedLocRow[]) =>
        rows.sort((a, b) => a.locationName.localeCompare(b.locationName) || a.productName.localeCompare(b.productName));

      const mainRows = sortRows(Array.from(mainGrouped.values()));
      const wgRows   = sortRows(Array.from(wgGrouped.values()));

      // Helper: build a summary sheet (location-grouped)
      const buildSheet = (ws: any, rows: GroupedLocRow[], label: string, headerColor: string, altColor: string) => {
        const cols: any[] = [
          { header: "Location", key: "locationName", width: 22 },
          { header: "Article Code", key: "articleCode", width: 18 },
          { header: "Product Name", key: "productName", width: 38 },
          { header: "Category", key: "category", width: 22 },
          { header: "Bales", key: "baleCount", width: 10 },
          { header: "Wt/Bale (kg)", key: "weightPerBale", width: 14 },
          { header: "Total KG", key: "totalWeight", width: 14 },
        ];
        if (includeCost) {
          cols.push({ header: "Rate (Cost)", key: "productionPrice", width: 14 });
          cols.push({ header: "Total Cost", key: "totalValue", width: 16 });
        }
        ws.columns = cols;
        styleHeaderRow(ws.getRow(1), headerColor);

        let totalBales = 0, totalKg = 0, totalValue = 0;
        let lastLoc = "";
        let altIdx = 0;

        for (const row of rows) {
          // Location separator row
          if (row.locationName !== lastLoc && lastLoc !== "") {
            const sepRow = ws.addRow({});
            sepRow.height = 6;
            altIdx = 0;
          }
          if (row.locationName !== lastLoc) {
            lastLoc = row.locationName;
          }

          const wpb = row.baleCount > 0 ? row.totalWeight / row.baleCount : 0;
          const tv  = row.productionPrice * row.baleCount;
          totalBales += row.baleCount;
          totalKg    += row.totalWeight;
          totalValue += tv;

          const rd: any = {
            locationName: row.locationName,
            articleCode:  row.articleCode,
            productName:  row.productName,
            category:     row.category,
            baleCount:    row.baleCount,
            weightPerBale: parseFloat(wpb.toFixed(2)),
            totalWeight:  parseFloat(row.totalWeight.toFixed(2)),
          };
          if (includeCost) { rd.productionPrice = row.productionPrice; rd.totalValue = parseFloat(tv.toFixed(2)); }
          const exRow = ws.addRow(rd);
          applyDataRow(exRow, altIdx % 2 === 1, altColor);
          exRow.getCell("baleCount").numFmt    = INT_FMT;
          exRow.getCell("weightPerBale").numFmt = NUM_FMT;
          exRow.getCell("totalWeight").numFmt   = NUM_FMT;
          if (includeCost) { exRow.getCell("productionPrice").numFmt = NUM_FMT; exRow.getCell("totalValue").numFmt = NUM_FMT; }
          altIdx++;
        }

        ws.addRow({});
        const td: any = {
          locationName: "GRAND TOTAL",
          articleCode: "",
          productName: `${rows.length} ${label} across ${locationRecords.length} locations`,
          category: "",
          baleCount: totalBales,
          weightPerBale: "",
          totalWeight: parseFloat(totalKg.toFixed(2)),
        };
        if (includeCost) { td.productionPrice = ""; td.totalValue = parseFloat(totalValue.toFixed(2)); }
        const tr = ws.addRow(td);
        tr.font = { bold: true };
        tr.eachCell({ includeEmpty: false }, (cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG } };
        });
        tr.getCell("baleCount").numFmt   = INT_FMT;
        tr.getCell("totalWeight").numFmt  = NUM_FMT;
        if (includeCost) tr.getCell("totalValue").numFmt = NUM_FMT;

        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
        ws.views = [{ state: "frozen", ySplit: 1 }];
      };

      // Sheet 1: Stock Summary (main items)
      const summarySheet = workbook.addWorksheet("Stock Summary");
      buildSheet(summarySheet, mainRows, "products", HEADER_BLUE, ROW_ALT);

      // Sheet 2: Wipers & Garbage
      const wgSheet = workbook.addWorksheet("Wipers & Garbage");
      buildSheet(wgSheet, wgRows, "items", HEADER_PURPLE, ROW_WG_ALT);

      // Sheet 3: Bale Details (main items only — no wipers/garbage)
      const baleSheet = workbook.addWorksheet("Bale Details");
      const baleCols: any[] = [
        { header: "Location", key: "locationName", width: 22 },
        { header: "Bale Ref #", key: "referenceNumber", width: 24 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 38 },
        { header: "Category", key: "category", width: 22 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (includeCost) {
        baleCols.push({ header: "Cost/kg", key: "costPerKg", width: 14 });
        baleCols.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      baleSheet.columns = baleCols;
      styleHeaderRow(baleSheet.getRow(1), HEADER_TEAL);

      const mainBales = bales.filter(b => {
        const pid = b.productId ?? 0;
        const cat = productCategoryNameMap.get(pid) || b.category || "";
        return !isWiperOrGarbage(cat);
      });

      mainBales.forEach((b, idx) => {
        const locId = b.erpLocationId ?? 0;
        const pid   = b.productId ?? 0;
        const rd: any = {
          locationName: locationMap.get(locId) || `Location #${locId}`,
          referenceNumber: b.referenceNumber,
          articleCode: b.articleCode || "",
          productName: b.productName || "",
          category: productCategoryNameMap.get(pid) || b.category || "",
          grade: (b as any).grade || "",
          weightKg: parseFloat(String(b.weightKg || "0")),
        };
        if (includeCost) {
          rd.costPerKg = parseFloat(String(b.costPerKg || "0"));
          rd.totalCost = parseFloat(String(b.totalCost || "0"));
        }
        const exRow = baleSheet.addRow(rd);
        applyDataRow(exRow, idx % 2 === 1, ROW_ALT);
        exRow.getCell("weightKg").numFmt = NUM_FMT;
        if (includeCost) { exRow.getCell("costPerKg").numFmt = NUM_FMT; exRow.getCell("totalCost").numFmt = NUM_FMT; }
      });

      baleSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: baleCols.length } };
      baleSheet.views = [{ state: "frozen", ySplit: 1 }];

      // Sheet 4: Garbage & Wiper Bale Details (individual ref numbers)
      const HEADER_ORANGE_ALL = "FF7B3F00";
      const ROW_WG_DETAIL_ALT_ALL = "FFFFF8F0";
      const TOTAL_BG_ALL = "FFE8F0FE";

      const garbageBalesAll = bales.filter(b => {
        const pid = b.productId ?? 0;
        const cat = productCategoryNameMap.get(pid) || b.category || "";
        return isWiperOrGarbage(cat);
      });

      const garbageDetailSheetAll = workbook.addWorksheet("Garbage & Wiper Details");
      const garbageBaleColsAll: any[] = [
        { header: "Location", key: "locationName", width: 22 },
        { header: "Bale Ref #", key: "referenceNumber", width: 24 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 38 },
        { header: "Category", key: "category", width: 22 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
      ];
      if (includeCost) {
        garbageBaleColsAll.push({ header: "Cost/kg", key: "costPerKg", width: 14 });
        garbageBaleColsAll.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      garbageDetailSheetAll.columns = garbageBaleColsAll;
      styleHeaderRow(garbageDetailSheetAll.getRow(1), HEADER_ORANGE_ALL);

      let gbTotalKgAll = 0;
      garbageBalesAll.forEach((b, idx) => {
        const locId = b.erpLocationId ?? 0;
        const pid   = b.productId ?? 0;
        const w = parseFloat(String(b.weightKg || "0"));
        gbTotalKgAll += w;
        const rd: any = {
          locationName: locationMap.get(locId) || `Location #${locId}`,
          referenceNumber: b.referenceNumber,
          baleCode: b.baleCode || "",
          articleCode: b.articleCode || "",
          productName: b.productName || "",
          category: productCategoryNameMap.get(pid) || b.category || "",
          grade: (b as any).grade || "",
          weightKg: w,
        };
        if (includeCost) {
          rd.costPerKg = parseFloat(String(b.costPerKg || "0"));
          rd.totalCost = parseFloat(String(b.totalCost || "0"));
        }
        const exRow = garbageDetailSheetAll.addRow(rd);
        applyDataRow(exRow, idx % 2 === 1, ROW_WG_DETAIL_ALT_ALL);
        exRow.getCell("weightKg").numFmt = NUM_FMT;
        if (includeCost) { exRow.getCell("costPerKg").numFmt = NUM_FMT; exRow.getCell("totalCost").numFmt = NUM_FMT; }
      });

      if (garbageBalesAll.length > 0) {
        garbageDetailSheetAll.addRow({});
        const gtd: any = {
          locationName: "GRAND TOTAL",
          referenceNumber: "",
          baleCode: "",
          articleCode: "",
          productName: `${garbageBalesAll.length} garbage/wiper bales`,
          category: "",
          grade: "",
          weightKg: parseFloat(gbTotalKgAll.toFixed(2)),
        };
        if (includeCost) {
          gtd.costPerKg = "";
          gtd.totalCost = parseFloat(garbageBalesAll.reduce((s, b) => s + parseFloat(String(b.totalCost || "0")), 0).toFixed(2));
        }
        const gtr = garbageDetailSheetAll.addRow(gtd);
        gtr.font = { bold: true };
        gtr.eachCell({ includeEmpty: false }, (cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_BG_ALL } };
        });
        gtr.getCell("weightKg").numFmt = NUM_FMT;
        if (includeCost) gtr.getCell("totalCost").numFmt = NUM_FMT;
      }

      garbageDetailSheetAll.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: garbageBaleColsAll.length } };
      garbageDetailSheetAll.views = [{ state: "frozen", ySplit: 1 }];

      const dateStr = getClientDate(req);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="inventory_all_locations_${dateStr}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting all-locations inventory Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/stock-entry/in-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId } = req.query;

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "IN_STOCK"),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, parseInt(locationId as string)));
      }

      const results = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.finalizedAt));

      // Mark bales currently scanned into an active LOADING container order
      const allIds = results.map((b) => b.id);
      const loadingBaleIds = new Set<number>();
      if (allIds.length > 0) {
        const loadingRows = await db
          .select({ baleId: customerOrderBales.baleId })
          .from(customerOrderBales)
          .innerJoin(customerOrders, eq(customerOrderBales.orderId, customerOrders.id))
          .where(and(
            eq(customerOrders.status, "LOADING"),
            inArray(customerOrderBales.baleId, allIds),
          ));
        for (const r of loadingRows) loadingBaleIds.add(r.baleId);
      }

      res.json(results.map((b) => ({ ...b, isInLoadingOrder: loadingBaleIds.has(b.id) })));
    } catch (error: any) {
      console.error("Error fetching in-stock bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/bale-stock-list?articleCode=HMD123&locationId=3
  // Returns array of IN_STOCK bales with referenceNumber, weightKg, etc. for a single articleCode.
  app.get("/api/factory/bale-stock-list", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const articleCode = (req.query.articleCode as string || "").trim();
      if (!articleCode) return res.status(400).json({ message: "articleCode is required" });

      const rawLocationId = req.query.locationId;
      const locationId = rawLocationId ? parseInt(rawLocationId as string) : null;

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "IN_STOCK"),
        isNull(factoryBales.deletedAt),
        eq(factoryBales.articleCode, articleCode),
      ];
      if (locationId && !isNaN(locationId)) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const bales = await db
        .select({
          id: factoryBales.id,
          referenceNumber: factoryBales.referenceNumber,
          baleCode: factoryBales.baleCode,
          weightKg: factoryBales.weightKg,
          stockEntryDate: factoryBales.stockEntryDate,
          finalizedAt: factoryBales.finalizedAt,
          workerName: factoryBales.workerName,
        })
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(factoryBales.referenceNumber);

      // Filter out bales currently locked in an active LOADING order
      const baleIds = bales.map(b => b.id).filter((id): id is number => id != null);
      let loadingBaleIds = new Set<number>();
      if (baleIds.length > 0) {
        const loadingRows = await db
          .select({ baleId: customerOrderBales.baleId })
          .from(customerOrderBales)
          .innerJoin(customerOrders, eq(customerOrderBales.orderId, customerOrders.id))
          .where(and(
            eq(customerOrders.status, "LOADING"),
            inArray(customerOrderBales.baleId, baleIds),
          ));
        loadingBaleIds = new Set(loadingRows.map(r => r.baleId));
      }

      const result = bales.map(b => ({
        ...b,
        lockedInLoading: b.id ? loadingBaleIds.has(b.id) : false,
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching bale stock list:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/bale-stock-count?articleCodes=HMD123,HMD456&locationId=3
  // Returns { HMD123: 4, HMD456: 0, ... } — IN_STOCK bale counts per article code
  // Optional locationId filters to only bales at that ERP location (mirrors location-inventory page).
  app.get("/api/factory/bale-stock-count", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawCodes = (req.query.articleCodes as string) || "";
      const articleCodes = rawCodes.split(",").map((s) => s.trim()).filter(Boolean);
      if (articleCodes.length === 0) return res.json({});

      const rawLocationId = req.query.locationId;
      const locationId = rawLocationId ? parseInt(rawLocationId as string) : null;

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        eq(factoryBales.status, "IN_STOCK"),
        isNull(factoryBales.deletedAt),
        inArray(factoryBales.articleCode, articleCodes),
      ];
      if (locationId && !isNaN(locationId)) {
        conditions.push(eq(factoryBales.erpLocationId, locationId));
      }

      const inStockBales = await db
        .select({ id: factoryBales.id, articleCode: factoryBales.articleCode, quantity: factoryBales.quantity })
        .from(factoryBales)
        .where(and(...conditions));

      // Build initial totals from IN_STOCK bales
      const result: Record<string, number> = {};
      articleCodes.forEach((c) => { result[c] = 0; });
      for (const b of inStockBales) {
        if (b.articleCode) {
          result[b.articleCode] = (result[b.articleCode] || 0) + parseFloat(String(b.quantity || "1"));
        }
      }

      // Subtract bales currently scanned into an active LOADING order
      const baleIds = inStockBales.map((b) => b.id).filter((id): id is number => id != null);
      if (baleIds.length > 0) {
        const loadingRows = await db
          .select({ baleId: customerOrderBales.baleId })
          .from(customerOrderBales)
          .innerJoin(customerOrders, eq(customerOrderBales.orderId, customerOrders.id))
          .where(
            and(
              eq(customerOrders.status, "LOADING"),
              inArray(customerOrderBales.baleId, baleIds),
            )
          );
        const loadingBaleIds = new Set(loadingRows.map((r) => r.baleId));
        for (const b of inStockBales) {
          if (b.id && b.articleCode && loadingBaleIds.has(b.id)) {
            const qty = parseFloat(String(b.quantity || "1"));
            result[b.articleCode] = Math.max(0, (result[b.articleCode] || 0) - qty);
          }
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching bale stock count:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1. Factory Suppliers CRUD
  // ───────────────────────────────────────────────

}
