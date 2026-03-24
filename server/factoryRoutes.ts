import type { Express } from "express";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, or, desc, sql, inArray, ilike, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import CryptoJS from "crypto-js";
import multer from "multer";
import path from "path";
import fs from "fs";
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
} from "@shared/schema";
import { adjustInventory } from "./inventoryHelper";

export function registerFactoryRoutes(app: Express, requireAuth: any, db: any) {

  async function writeDaybookEntry(dbOrTx: any, opts: {
    companyId: number;
    txDate: string;
    txType: string;
    referenceId?: number;
    referenceTable?: string;
    description: string;
    metaJson?: string;
    currencyCode?: string;
    amountCurrency?: number;
    fxRateToUsd?: number;
    amountUsd?: number;
    createdBy?: number;
  }) {
    const currency = opts.currencyCode || "USD";
    const fxRate = opts.fxRateToUsd || 1;
    const amtCurrency = opts.amountCurrency || 0;
    const amtUsd = opts.amountUsd !== undefined ? opts.amountUsd : (currency === "USD" ? amtCurrency : amtCurrency * fxRate);
    await dbOrTx.insert(factoryDaybookEntries).values({
      companyId: opts.companyId,
      txDate: opts.txDate,
      txType: opts.txType,
      referenceId: opts.referenceId || null,
      referenceTable: opts.referenceTable || null,
      description: opts.description,
      metaJson: opts.metaJson || null,
      currencyCode: currency,
      amountCurrency: String(amtCurrency),
      fxRateToUsd: String(fxRate),
      amountUsd: String(amtUsd),
      createdBy: opts.createdBy || null,
    });
  }

  async function getOrFetchFxRateToUsd(companyId: number, currencyCode: string, dateISO: string): Promise<string> {
    if (currencyCode === "USD") return "1";

    const [existing] = await db
      .select()
      .from(factoryFxRates)
      .where(and(
        eq(factoryFxRates.companyId, companyId),
        eq(factoryFxRates.currencyCode, currencyCode.toUpperCase()),
        eq(factoryFxRates.effectiveDate, dateISO)
      ))
      .limit(1);

    if (existing) return existing.rateToUsd;

    try {
      const response = await fetch(`https://api.frankfurter.app/${dateISO}?from=${currencyCode.toUpperCase()}&to=USD`);
      if (!response.ok) throw new Error(`FX API returned ${response.status}`);
      const data = await response.json();
      const rate = data?.rates?.USD;
      if (!rate || isNaN(rate)) throw new Error("Invalid rate from FX API");

      const rateStr = String(rate);
      await db.insert(factoryFxRates).values({
        companyId,
        currencyCode: currencyCode.toUpperCase(),
        rateToUsd: rateStr,
        effectiveDate: dateISO,
      });

      return rateStr;
    } catch (err: any) {
      const [fallback] = await db
        .select()
        .from(factoryFxRates)
        .where(and(
          eq(factoryFxRates.companyId, companyId),
          eq(factoryFxRates.currencyCode, currencyCode.toUpperCase())
        ))
        .orderBy(desc(factoryFxRates.effectiveDate))
        .limit(1);

      if (fallback) return fallback.rateToUsd;
      throw new Error(`No FX rate available for ${dateISO}/${currencyCode}. External API error: ${err.message}`);
    }
  }

  async function getOrCreateLedgerAccount(
    companyId: number,
    code: string,
    name: string,
    accountType: string = "EXPENSE"
  ): Promise<number> {
    const safeCode = code.slice(0, 50);
    const [existing] = await db
      .select({ id: ledgerAccounts.id })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, safeCode)))
      .limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(ledgerAccounts).values({
      companyId,
      code: safeCode,
      name,
      accountType,
      active: true,
      isHidden: false,
    }).returning({ id: ledgerAccounts.id });
    return created.id;
  }

  function isLegacySHA256Hash(hash: string): boolean {
    return /^[a-f0-9]{64}$/i.test(hash);
  }

  async function verifySupervisorPassword(password: string, hash: string): Promise<boolean> {
    if (isLegacySHA256Hash(hash)) {
      return CryptoJS.SHA256(password).toString().toLowerCase() === hash.toLowerCase();
    }
    return bcrypt.compare(password, hash);
  }

  // ───────────────────────────────────────────────
  // STOCK ENTRY - Direct to stock (replaces pressing/finalize)
  // ───────────────────────────────────────────────

  app.post("/api/factory/stock-entry", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
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
      let effectiveDateStr: string = new Date().toISOString().split("T")[0];
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
        const dbMax = (Number(maxRow?.m) || 100875) + 1;

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

        for (const item of items) {
          const qty = parseInt(item.quantity || item.qty || "1");
          const weight = parseFloat(item.weightPerBale || "25");
          const product = productMap.get(item.productId);
          if (!product) throw new Error(`Product ID ${item.productId} not found`);
          const categoryName: string | null = product.categoryId ? (categoryMap.get(product.categoryId)?.name || null) : null;

          for (let i = 0; i < qty; i++) {
            const refNum = `REF${String(nextNumber + baleIndex).padStart(5, '0')}`;
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
              const cached = stockGroupCache.get(catName);
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
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
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

      const today = effectiveDateStr || new Date().toISOString().split('T')[0];
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
        return sum + parseFloat(b.costPerKg || "0");
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
      const companyId = (req.session as any).currentCompanyId;
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
        const barcode = b.barcode.trim();
        const qty = parseInt(b.quantity) || 1;
        const refs = qty === 1 ? [barcode] : Array.from({ length: qty }, (_, i) => `${barcode}-${i + 1}`);
        for (const ref of refs) {
          if (allIntendedRefs.includes(ref)) payloadDupes.add(ref);
          allIntendedRefs.push(ref);
        }
      }
      if (payloadDupes.size > 0) {
        return res.status(400).json({ message: `Duplicate barcodes within import file: ${Array.from(payloadDupes).join(", ")}` });
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
            const refNum = qty === 1 ? barcode : `${barcode}-${i + 1}`;

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

      const today = new Date().toISOString().split("T")[0];
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
      const companyId = (req.session as any).currentCompanyId;
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

      if (!role || !["Admin", "Owner", "Manager"].includes(role.role)) {
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
          if (bale.status !== "IN_STOCK" && bale.status !== "FINALIZED") {
            throw new Error(`Bale ${bale.referenceNumber} is not in stock (status: ${bale.status})`);
          }

          if (!bale.erpLocationId) {
            throw new Error(`Bale ${bale.referenceNumber} has no location assigned`);
          }

          const [updated] = await tx
            .update(factoryBales)
            .set({
              status: "REMOVED",
              updatedAt: now,
            })
            .where(eq(factoryBales.id, bale.id))
            .returning();

          const factoryProductForBale = productMap.get(bale.productId as number);
          removedBales.push({ ...updated, productName: factoryProductForBale?.name || factoryProductForBale?.articleCode || "Unknown" });

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

        return { removed: removedBales };
      });

      const today = new Date().toISOString().split('T')[0];
      const removalMetaJson = JSON.stringify({
        bales: result.removed.map((b: any) => ({
          id: b.id,
          ref: b.referenceNumber,
          productName: b.productName || "Unknown",
          weightKg: b.weightKg,
          status: "REMOVED",
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
      const companyId = (req.session as any).currentCompanyId;
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

      if (!role || !["Admin", "Owner", "Manager"].includes(role.role)) {
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
              or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED"))
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
            .set({ status: "REMOVED", updatedAt: now })
            .where(eq(factoryBales.id, bale.id))
            .returning();
          removedBales.push({ ...updated, productName: factoryProduct?.name || factoryProduct?.articleCode || "Unknown" });
          if (erpStockItemId) {
            await adjustInventory(tx, bale.erpLocationId!, erpStockItemId, -1, companyId);
          }
        }
        return { removed: removedBales };
      });

      const today = new Date().toISOString().split('T')[0];
      const baleMetaJson = JSON.stringify({
        bales: result.removed.map((b: any) => ({
          id: b.id,
          ref: b.referenceNumber,
          productName: b.productName || "Unknown",
          weightKg: b.weightKg,
          status: "REMOVED",
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const bales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.erpLocationId, locationId),
            or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED")),
          )
        );

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
        sellingPrice: string;
        productionPrice: number;
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
          existing.quantity += qty;
          existing.totalWeight += weight;
          existing.totalCost += productionPrice;
          existing.baleCount += 1;
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
            sellingPrice,
            productionPrice,
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

  app.get("/api/factory/location-inventory/:locationId/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const locationId = parseInt(req.params.locationId);
      if (isNaN(locationId)) return res.status(400).json({ message: "Invalid location ID" });

      const includeCost = req.query.includeCost !== "0";

      const bales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.erpLocationId, locationId),
            or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED")),
          )
        );

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

      const grouped = new Map<number, { articleCode: string; productName: string; category: string; baleCount: number; totalWeight: number; productionPrice: number }>();

      for (const b of bales) {
        const pid = b.productId || 0;
        const existing = grouped.get(pid);
        const weight = parseFloat(String(b.weightKg || "0"));
        const productionPrice = productProductionPriceMap.get(pid) || 0;
        if (existing) {
          existing.totalWeight += weight;
          existing.baleCount += 1;
        } else {
          grouped.set(pid, {
            articleCode: b.articleCode || b.baleCode || "",
            productName: b.productName || "Unknown",
            category: productCategoryNameMap.get(pid) || b.category || "",
            totalWeight: weight,
            baleCount: 1,
            productionPrice,
          });
        }
      }

      const rows = Array.from(grouped.values()).sort((a, b) => a.productName.localeCompare(b.productName));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      // Sheet 1: Bale Details — one row per bale with reference number (opens first)
      const baleSheet = workbook.addWorksheet("Bale Details");
      const baleColumns: any[] = [
        { header: "Bale Ref #", key: "referenceNumber", width: 22 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 35 },
        { header: "Category", key: "category", width: 20 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
        { header: "Status", key: "status", width: 14 },
      ];
      if (includeCost) {
        baleColumns.push({ header: "Cost/kg", key: "costPerKg", width: 14 });
        baleColumns.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      baleSheet.columns = baleColumns;
      const baleHeaderRow = baleSheet.getRow(1);
      baleHeaderRow.font = { bold: true };
      baleHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E4FF" } };

      const sortedBales = [...bales].sort((a, b) => (a.productName || "").localeCompare(b.productName || ""));
      for (const b of sortedBales) {
        const baleRowData: any = {
          referenceNumber: b.referenceNumber,
          articleCode: b.articleCode || "",
          productName: b.productName || "",
          category: productCategoryNameMap.get(b.productId ?? 0) || b.category || "",
          grade: (b as any).grade || "",
          weightKg: parseFloat(String(b.weightKg || "0")),
          status: b.status,
        };
        if (includeCost) {
          baleRowData.costPerKg = parseFloat(String(b.costPerKg || "0"));
          baleRowData.totalCost = parseFloat(String(b.totalCost || "0"));
        }
        baleSheet.addRow(baleRowData);
      }

      // Sheet 2: Inventory Summary — grouped by product
      const sheet = workbook.addWorksheet("Inventory Summary");
      const columns: any[] = [
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 35 },
        { header: "Category", key: "category", width: 20 },
        { header: "Bales", key: "baleCount", width: 10 },
        { header: "Wt/Bale (kg)", key: "weightPerBale", width: 14 },
        { header: "Total KG", key: "totalWeight", width: 14 },
      ];
      if (includeCost) {
        columns.push({ header: "Avg Rate (Cost)", key: "productionPrice", width: 16 });
        columns.push({ header: "Total Value", key: "totalValue", width: 16 });
      }
      sheet.columns = columns;

      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

      let totalBales = 0;
      let totalKg = 0;
      let totalValue = 0;

      for (const row of rows) {
        const weightPerBale = row.baleCount > 0 ? row.totalWeight / row.baleCount : 0;
        const rowTotalValue = row.productionPrice * row.baleCount;
        totalBales += row.baleCount;
        totalKg += row.totalWeight;
        totalValue += rowTotalValue;

        const rowData: any = {
          articleCode: row.articleCode,
          productName: row.productName,
          category: row.category,
          baleCount: row.baleCount,
          weightPerBale: parseFloat(weightPerBale.toFixed(2)),
          totalWeight: parseFloat(row.totalWeight.toFixed(2)),
        };
        if (includeCost) {
          rowData.productionPrice = row.productionPrice;
          rowData.totalValue = parseFloat(rowTotalValue.toFixed(2));
        }
        sheet.addRow(rowData);
      }

      sheet.addRow({});
      const totalRowData: any = {
        articleCode: "",
        productName: `TOTAL (${rows.length} products)`,
        category: "",
        baleCount: totalBales,
        weightPerBale: "",
        totalWeight: parseFloat(totalKg.toFixed(2)),
      };
      if (includeCost) {
        totalRowData.productionPrice = "";
        totalRowData.totalValue = parseFloat(totalValue.toFixed(2));
      }
      const tr = sheet.addRow(totalRowData);
      tr.font = { bold: true };

      const dateStr = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="inventory_location_${locationId}_${dateStr}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting inventory Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export ALL locations inventory to Excel — summary + full bale detail with ref numbers
  app.get("/api/factory/location-inventory/export/all", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const includeCost = req.query.includeCost !== "0";

      // Fetch all in-stock / finalized bales
      const bales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED")),
          )
        )
        .orderBy(factoryBales.erpLocationId, factoryBales.productName);

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

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      // Group bales by locationId + productId (needed for summary sheet)
      const grouped = new Map<string, { locationName: string; articleCode: string; productName: string; category: string; baleCount: number; totalWeight: number; productionPrice: number }>();
      for (const b of bales) {
        const locId = b.erpLocationId ?? 0;
        const pid = b.productId ?? 0;
        const key = `${locId}::${pid}`;
        const weight = parseFloat(String(b.weightKg || "0"));
        const productionPrice = productProductionPriceMap.get(pid) || 0;
        const existing = grouped.get(key);
        if (existing) {
          existing.totalWeight += weight;
          existing.baleCount += 1;
        } else {
          grouped.set(key, {
            locationName: locationMap.get(locId) || `Location #${locId}`,
            articleCode: b.articleCode || "",
            productName: b.productName || "Unknown",
            category: productCategoryNameMap.get(pid) || b.category || "",
            totalWeight: weight,
            baleCount: 1,
            productionPrice,
          });
        }
      }

      const summaryRows = Array.from(grouped.values()).sort((a, b) =>
        a.locationName.localeCompare(b.locationName) || a.productName.localeCompare(b.productName)
      );

      // Sheet 1: Bale Details — one row per bale with ref # (opens first in Excel)
      const baleSheet = workbook.addWorksheet("Bale Details");
      const baleColumns: any[] = [
        { header: "Location", key: "locationName", width: 22 },
        { header: "Bale Ref #", key: "referenceNumber", width: 22 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 35 },
        { header: "Category", key: "category", width: 20 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
        { header: "Status", key: "status", width: 14 },
      ];
      if (includeCost) {
        baleColumns.push({ header: "Cost/kg", key: "costPerKg", width: 14 });
        baleColumns.push({ header: "Total Cost", key: "totalCost", width: 14 });
      }
      baleSheet.columns = baleColumns;
      const baleHeaderRow = baleSheet.getRow(1);
      baleHeaderRow.font = { bold: true };
      baleHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E4FF" } };

      for (const b of bales) {
        const locId = b.erpLocationId ?? 0;
        const pid = b.productId ?? 0;
        const baleRowData: any = {
          locationName: locationMap.get(locId) || `Location #${locId}`,
          referenceNumber: b.referenceNumber,
          articleCode: b.articleCode || "",
          productName: b.productName || "",
          category: productCategoryNameMap.get(pid) || b.category || "",
          grade: (b as any).grade || "",
          weightKg: parseFloat(String(b.weightKg || "0")),
          status: b.status,
        };
        if (includeCost) {
          baleRowData.costPerKg = parseFloat(String(b.costPerKg || "0"));
          baleRowData.totalCost = parseFloat(String(b.totalCost || "0"));
        }
        baleSheet.addRow(baleRowData);
      }

      // Sheet 2: Summary grouped by Location → Product
      const summarySheet = workbook.addWorksheet("Summary");
      const summaryColumns: any[] = [
        { header: "Location", key: "locationName", width: 22 },
        { header: "Article Code", key: "articleCode", width: 18 },
        { header: "Product Name", key: "productName", width: 35 },
        { header: "Category", key: "category", width: 20 },
        { header: "Bales", key: "baleCount", width: 10 },
        { header: "Wt/Bale (kg)", key: "weightPerBale", width: 14 },
        { header: "Total KG", key: "totalWeight", width: 14 },
      ];
      if (includeCost) {
        summaryColumns.push({ header: "Avg Rate (Cost)", key: "productionPrice", width: 16 });
        summaryColumns.push({ header: "Total Value", key: "totalValue", width: 16 });
      }
      summarySheet.columns = summaryColumns;
      const summaryHeader = summarySheet.getRow(1);
      summaryHeader.font = { bold: true };
      summaryHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

      let totalBales = 0, totalKg = 0, totalValue = 0;
      let lastLocation = "";
      for (const row of summaryRows) {
        if (row.locationName !== lastLocation && lastLocation !== "") {
          summarySheet.addRow({});
        }
        lastLocation = row.locationName;

        const weightPerBale = row.baleCount > 0 ? row.totalWeight / row.baleCount : 0;
        const rowTotalValue = row.productionPrice * row.baleCount;
        totalBales += row.baleCount;
        totalKg += row.totalWeight;
        totalValue += rowTotalValue;

        const rowData: any = {
          locationName: row.locationName,
          articleCode: row.articleCode,
          productName: row.productName,
          category: row.category,
          baleCount: row.baleCount,
          weightPerBale: parseFloat(weightPerBale.toFixed(2)),
          totalWeight: parseFloat(row.totalWeight.toFixed(2)),
        };
        if (includeCost) {
          rowData.productionPrice = row.productionPrice;
          rowData.totalValue = parseFloat(rowTotalValue.toFixed(2));
        }
        summarySheet.addRow(rowData);
      }

      summarySheet.addRow({});
      const totalsData: any = {
        locationName: "GRAND TOTAL",
        articleCode: "",
        productName: `${summaryRows.length} products across ${locationRecords.length} locations`,
        category: "",
        baleCount: totalBales,
        weightPerBale: "",
        totalWeight: parseFloat(totalKg.toFixed(2)),
      };
      if (includeCost) {
        totalsData.productionPrice = "";
        totalsData.totalValue = parseFloat(totalValue.toFixed(2));
      }
      const totalRow = summarySheet.addRow(totalsData);
      totalRow.font = { bold: true };

      const dateStr = new Date().toISOString().split("T")[0];
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { locationId } = req.query;

      const conditions: any[] = [
        eq(factoryBales.companyId, companyId),
        or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED")),
      ];

      if (locationId) {
        conditions.push(eq(factoryBales.erpLocationId, parseInt(locationId as string)));
      }

      const results = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.finalizedAt));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching in-stock bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1. Factory Suppliers CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory suppliers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/suppliers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierSchema.parse({ ...req.body, companyId });
      const [supplier] = await db.insert(factorySuppliers).values(parsed).returning();
      res.json(supplier);
    } catch (error: any) {
      console.error("Error creating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factorySuppliers)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory supplier:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/suppliers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factorySuppliers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Supplier not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Overwrite a factory supplier's opening balance
  app.patch("/api/factory/suppliers/:id/opening-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid supplier id" });

      const { openingBalance } = req.body;
      if (openingBalance === undefined || openingBalance === null || openingBalance === "") {
        return res.status(400).json({ message: "openingBalance is required" });
      }
      const val = parseFloat(openingBalance);
      if (isNaN(val) || val < 0) {
        return res.status(400).json({ message: "openingBalance must be a non-negative number" });
      }

      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .limit(1);

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const [updated] = await db
        .update(factorySuppliers)
        .set({ openingBalance: String(val) })
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating supplier opening balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Hard-delete a factory supplier — cascades through all related records
  app.delete("/api/factory/suppliers/:id/permanent", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)));

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      // 1. Collect container IDs belonging to this supplier
      const supplierContainers = await db
        .select({ id: factoryContainers.id })
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, id)));
      const containerIds = supplierContainers.map((c) => c.id);

      // 2. Cascade-delete container-level dependents (only when containers exist)
      if (containerIds.length > 0) {
        await db.delete(factoryFxAllocations).where(inArray(factoryFxAllocations.containerId, containerIds));
        await db.delete(factoryOffloadAdditionalCharges).where(inArray(factoryOffloadAdditionalCharges.containerId, containerIds));
        await db.delete(factoryContainerCommissions).where(inArray(factoryContainerCommissions.containerId, containerIds));
        await db.delete(factoryMixBatchSources).where(inArray(factoryMixBatchSources.containerId, containerIds));
        await db.delete(factoryRawStock).where(inArray(factoryRawStock.containerId, containerIds));
        await db.delete(factoryContainers).where(inArray(factoryContainers.id, containerIds));
      }

      // 3. Delete supplier-level financial records
      await db.delete(factorySupplierFxTransfers).where(
        and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          or(eq(factorySupplierFxTransfers.fromSupplierId, id), eq(factorySupplierFxTransfers.toSupplierId, id))
        )
      );
      await db.delete(factorySupplierPayments).where(
        and(eq(factorySupplierPayments.companyId, companyId), eq(factorySupplierPayments.supplierId, id))
      );
      await db.delete(factorySupplierScoreSnapshots).where(
        and(eq(factorySupplierScoreSnapshots.companyId, companyId), eq(factorySupplierScoreSnapshots.supplierId, id))
      );

      // 4. Finally delete the supplier itself
      await db
        .delete(factorySuppliers)
        .where(and(eq(factorySuppliers.id, id), eq(factorySuppliers.companyId, companyId)));

      res.json({ message: "Supplier permanently deleted" });
    } catch (error: any) {
      console.error("Error permanently deleting factory supplier:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1c. Factory Supplier Payments
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = req.query.supplierId ? parseInt(req.query.supplierId as string) : null;

      // Also fetch all sub-accounts of the supplier to include their payments
      let supplierIds: number[] = supplierId ? [supplierId] : [];
      if (supplierId) {
        const children = await db
          .select({ id: factorySuppliers.id })
          .from(factorySuppliers)
          .where(and(eq(factorySuppliers.companyId, companyId), eq((factorySuppliers as any).parentId, supplierId)));
        children.forEach((c: any) => supplierIds.push(c.id));
      }

      let query = db
        .select()
        .from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId))
        .orderBy(desc(factorySupplierPayments.date));

      if (supplierIds.length > 0) {
        query = query.where(and(
          eq(factorySupplierPayments.companyId, companyId),
          inArray(factorySupplierPayments.supplierId, supplierIds)
        ));
      }

      const payments = await query;
      res.json(payments);
    } catch (error: any) {
      console.error("Error fetching supplier payments:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/supplier-payments", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierPaymentSchema.parse({ ...req.body, companyId });

      const created = await db.transaction(async (tx: any) => {
        const [payment] = await tx.insert(factorySupplierPayments).values(parsed).returning();

        // Double-entry Payment voucher: DR Supplier Payable / CR Bank or Cash
        const payAmt = parseFloat(payment.amount);
        const payAmtStr = payAmt.toFixed(2);
        const payVoucherNum = `FACTORY-PAY-${payment.id}-${Date.now()}`;

        const [payVoucher] = await tx.insert(vouchers).values({
          companyId,
          voucherType: "Payment",
          voucherNumber: payVoucherNum,
          voucherDate: payment.date,
          description: `Supplier payment – see factory payment #${payment.id}`,
          totalAmount: payAmtStr,
          currency: payment.currencyCode || "USD",
          exchangeRate: String(parseFloat(payment.fxRateToUsd as string || "1")),
          sourceModule: "FACTORY",
        }).returning();

        // DR: Factory Supplier (debit reduces the liability we owe them)
        await tx.insert(voucherEntries).values({
          voucherId: payVoucher.id,
          factorySupplierId: payment.supplierId,
          debitAmount: payAmtStr,
          creditAmount: "0",
          narration: `Payment to supplier – factory payment #${payment.id}`,
        });

        // CR: Bank/Cash ledger account (or auto-created "Factory Cash Payments" if not specified)
        const crAccountId = payment.paidFromAccountId
          ? payment.paidFromAccountId
          : await getOrCreateLedgerAccount(companyId, "FACTORY_CASH_PAYMENTS", "Factory Cash Payments", "ASSET");

        await tx.insert(voucherEntries).values({
          voucherId: payVoucher.id,
          ledgerAccountId: crAccountId,
          debitAmount: "0",
          creditAmount: payAmtStr,
          narration: `Bank/cash outflow – factory payment #${payment.id}`,
        });

        return payment;
      });

      const [spSupplier] = await db.select({ name: factorySuppliers.name })
        .from(factorySuppliers).where(eq(factorySuppliers.id, created.supplierId));
      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_PAYMENT",
        referenceId: created.id,
        description: `Supplier payment: ${spSupplier?.name || "Unknown"} – ${parseFloat(created.amount).toFixed(2)} ${created.currencyCode}`,
        amountCurrency: parseFloat(created.amount),
        amountUsd: parseFloat(created.amountUsd),
        currencyCode: created.currencyCode,
      });
      res.json(created);
    } catch (error: any) {
      console.error("Error creating supplier payment:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/supplier-payments/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const [payment] = await db.select().from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      const [spDelSupplier] = payment
        ? await db.select({ name: factorySuppliers.name }).from(factorySuppliers).where(eq(factorySuppliers.id, payment.supplierId))
        : [null];

      await db.transaction(async (tx: any) => {
        // Soft-delete the auto-generated Payment voucher for this payment
        const payVoucherPattern = `FACTORY-PAY-${id}-%`;
        const [linkedVoucher] = await tx.select({ id: vouchers.id })
          .from(vouchers)
          .where(and(eq(vouchers.companyId, companyId), sql`${vouchers.voucherNumber} LIKE ${payVoucherPattern}`))
          .limit(1);
        if (linkedVoucher) {
          await tx.update(vouchers)
            .set({ deletedAt: new Date() })
            .where(eq(vouchers.id, linkedVoucher.id));
        }
        await tx.delete(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.id, id), eq(factorySupplierPayments.companyId, companyId)));
      });

      if (payment) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: new Date().toISOString().split("T")[0],
          txType: "SUPPLIER_PAYMENT_DELETE",
          description: `Supplier payment deleted: ${spDelSupplier?.name || "Unknown"} – ${parseFloat(payment.amount).toFixed(2)} ${payment.currencyCode} (dated ${payment.date})`,
        });
      }
      res.json({ message: "Payment deleted" });
    } catch (error: any) {
      console.error("Error deleting supplier payment:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1a-ii. Factory Supplier FX Transfers
  // ───────────────────────────────────────────────

  app.get("/api/factory/supplier-fx-transfers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const transfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId))
        .orderBy(desc(factorySupplierFxTransfers.date));
      res.json(transfers);
    } catch (error: any) {
      console.error("Error fetching FX transfers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/supplier-fx-transfers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactorySupplierFxTransferSchema.parse({ ...req.body, companyId });

      // Validate both suppliers exist and belong to this company
      const [fromSupplier] = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name, parentId: factorySuppliers.parentId })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.fromSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!fromSupplier) return res.status(404).json({ message: "From-supplier not found" });

      const [toSupplier] = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, parsed.toSupplierId), eq(factorySuppliers.companyId, companyId)));
      if (!toSupplier) return res.status(404).json({ message: "To-supplier not found" });

      // ── Balance validation (Phase 3) ─────────────────────────────────────────
      const currCode = parsed.fromCurrencyCode;
      const fromSupId = parsed.fromSupplierId;
      const sourceType = (parsed as any).sourceType || "supplier";

      // 1. Containers for this supplier in this currency
      const contRows = await db
        .select({
          finalPayableAmount: factoryContainers.finalPayableAmount,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          freight: factoryContainers.freight,
          id: factoryContainers.id,
        })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.supplierId, fromSupId),
          eq(factoryContainers.currencyCode, currCode)
        ));

      const containerIds = contRows.map((c: any) => c.id);
      const totalValue = contRows.reduce((s: number, c: any) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const freight = parseFloat(c.freight || "0");
        return s + (kg * rate + freight);
      }, 0);

      // 2. Commissions from factoryContainerCommissions for these containers
      let totalCommission = 0;
      if (containerIds.length > 0) {
        const commRows = await db
          .select({ commissionTotal: factoryContainerCommissions.commissionTotal })
          .from(factoryContainerCommissions)
          .where(and(
            eq(factoryContainerCommissions.companyId, companyId),
            inArray(factoryContainerCommissions.containerId, containerIds)
          ));
        totalCommission = commRows.reduce((s: number, cm: any) => s + parseFloat(cm.commissionTotal || "0"), 0);
      }

      // 3. Payments in this currency
      const payRows = await db
        .select({ amount: factorySupplierPayments.amount })
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          eq(factorySupplierPayments.supplierId, fromSupId),
          eq(factorySupplierPayments.currencyCode, currCode)
        ));
      const totalPaid = payRows.reduce((s: number, p: any) => s + parseFloat(p.amount || "0"), 0);

      // 4. Existing FX transfers out for this supplier + currency
      const fxRows = await db
        .select({ fromAmount: factorySupplierFxTransfers.fromAmount, sourceType: factorySupplierFxTransfers.sourceType })
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          eq(factorySupplierFxTransfers.fromSupplierId, fromSupId),
          eq(factorySupplierFxTransfers.fromCurrencyCode, currCode)
        ));

      // FX deducted from supplier bucket (source = supplier or both)
      const fxSupplierOut = fxRows
        .filter((t: any) => !t.sourceType || t.sourceType === "supplier" || t.sourceType === "both")
        .reduce((s: number, t: any) => s + parseFloat(t.fromAmount || "0"), 0);
      // FX deducted from commission bucket (source = commission or both)
      const fxCommOut = fxRows
        .filter((t: any) => t.sourceType === "commission" || t.sourceType === "both")
        .reduce((s: number, t: any) => s + parseFloat(t.fromAmount || "0"), 0);

      const supplierAvail = totalValue - totalCommission - totalPaid - fxSupplierOut;
      const commAvail = totalCommission - fxCommOut;

      let available: number;
      if (sourceType === "commission") {
        available = commAvail;
      } else if (sourceType === "both") {
        available = supplierAvail + commAvail;
      } else {
        available = supplierAvail; // "supplier" (default)
      }

      const requested = parseFloat(parsed.fromAmount as string);
      if (requested > available + 0.01) {
        return res.status(422).json({
          message: `Amount exceeds available ${sourceType} balance. Available: ${currCode} ${available.toFixed(2)}, Requested: ${currCode} ${requested.toFixed(2)}`,
        });
      }
      // ─────────────────────────────────────────────────────────────────────────

      const [created] = await db.insert(factorySupplierFxTransfers).values(parsed).returning();

      // ── Phase 1: Oldest-first allocation persistence ──────────────────────────
      // Allocate this FX transfer against containers ordered by creation date
      try {
        const allContainers = await db
          .select({ id: factoryContainers.id, finalPayableAmount: factoryContainers.finalPayableAmount, actualReceivedKg: factoryContainers.actualReceivedKg, totalKg: factoryContainers.totalKg, ratePerKg: factoryContainers.ratePerKg, freight: factoryContainers.freight })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, fromSupId), eq(factoryContainers.currencyCode, currCode)))
          .orderBy(factoryContainers.createdAt); // oldest first

        const cIds = allContainers.map((c: any) => c.id);
        const prevAllocs = cIds.length > 0
          ? await db.select({ containerId: factoryFxAllocations.containerId, allocatedAmount: factoryFxAllocations.allocatedAmount })
              .from(factoryFxAllocations)
              .where(and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, cIds)))
          : [];

        const allocatedPerContainer: Record<number, number> = {};
        for (const a of prevAllocs) allocatedPerContainer[a.containerId] = (allocatedPerContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

        let rem = parseFloat(created.fromAmount);
        const rows: any[] = [];
        for (const c of allContainers) {
          if (rem <= 0.001) break;
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const val = kg * rate + freight;
          const used = allocatedPerContainer[c.id] || 0;
          const avail = Math.max(0, val - used);
          if (avail <= 0.001) continue;
          const toAlloc = Math.min(rem, avail);
          rows.push({ companyId, fxTransferId: created.id, containerId: c.id, sourceType: created.sourceType || "supplier", allocatedAmount: toAlloc.toFixed(4), currencyCode: currCode });
          rem -= toAlloc;
        }
        if (rows.length > 0) await db.insert(factoryFxAllocations).values(rows);
      } catch (allocErr) {
        console.error("FX allocation error (non-fatal):", allocErr);
      }
      // ─────────────────────────────────────────────────────────────────────────

      await writeDaybookEntry(db, {
        companyId,
        txDate: created.date,
        txType: "SUPPLIER_FX_TRANSFER",
        referenceId: created.id,
        description: `FX Transfer: ${fromSupplier.name} ${created.fromCurrencyCode} ${parseFloat(created.fromAmount).toFixed(2)} → ${toSupplier.name} USD ${parseFloat(created.toAmountUsd).toFixed(2)}`,
        amountCurrency: parseFloat(created.fromAmount),
        amountUsd: parseFloat(created.toAmountUsd),
        currencyCode: created.fromCurrencyCode,
      });

      res.json(created);
    } catch (error: any) {
      console.error("Error creating FX transfer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/supplier-fx-transfers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const [transfer] = await db.select().from(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));
      if (!transfer) return res.status(404).json({ message: "Transfer not found" });

      // Cascade-delete allocation rows before removing the transfer
      await db.delete(factoryFxAllocations)
        .where(and(eq(factoryFxAllocations.fxTransferId, id), eq(factoryFxAllocations.companyId, companyId)));

      await db.delete(factorySupplierFxTransfers)
        .where(and(eq(factorySupplierFxTransfers.id, id), eq(factorySupplierFxTransfers.companyId, companyId)));

      await writeDaybookEntry(db, {
        companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "SUPPLIER_FX_TRANSFER_DELETE",
        description: `FX Transfer deleted: ${transfer.fromCurrencyCode} ${parseFloat(transfer.fromAmount).toFixed(2)} → USD ${parseFloat(transfer.toAmountUsd).toFixed(2)} (dated ${transfer.date})`,
      });

      res.json({ message: "FX transfer deleted" });
    } catch (error: any) {
      console.error("Error deleting FX transfer:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Bulk FX Settlement for Broker ────────────────────────────────────────
  // POST /api/factory/suppliers/:brokerId/bulk-fx-settlement
  // Distributes a total foreign-currency amount across all linked suppliers of
  // a broker, creating individual FX transfer records for each, capped at each
  // supplier's outstanding balance.
  app.post("/api/factory/suppliers/:brokerId/bulk-fx-settlement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseInt(req.params.brokerId);
      if (isNaN(brokerId)) return res.status(400).json({ message: "Invalid broker ID" });

      const { fromCurrencyCode, totalAmount, fxRateToUsd, date, notes, order = "oldest", dryRun = false } = req.body;
      if (!fromCurrencyCode || !totalAmount || !fxRateToUsd)
        return res.status(400).json({ message: "fromCurrencyCode, totalAmount, and fxRateToUsd are required" });

      const total = parseFloat(totalAmount);
      const fxRate = parseFloat(fxRateToUsd);
      if (total <= 0 || fxRate <= 0)
        return res.status(400).json({ message: "Amount and rate must be greater than zero" });

      // Verify broker exists
      const [broker] = await db.select().from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
      if (!broker) return res.status(404).json({ message: "Broker not found" });

      // Get all active linked suppliers
      const linkedSuppliers = await db.select().from(factorySuppliers)
        .where(and(
          eq(factorySuppliers.parentId, brokerId),
          eq(factorySuppliers.companyId, companyId),
          eq(factorySuppliers.isActive, true)
        ));
      if (linkedSuppliers.length === 0)
        return res.status(400).json({ message: "No active linked suppliers found for this broker" });

      const linkedIds = linkedSuppliers.map((s: any) => s.id);

      // Get all containers for linked suppliers in the given currency
      const allContainers = await db.select({
        id: factoryContainers.id,
        supplierId: factoryContainers.supplierId,
        totalKg: factoryContainers.totalKg,
        actualReceivedKg: factoryContainers.actualReceivedKg,
        ratePerKg: factoryContainers.ratePerKg,
        freight: factoryContainers.freight,
        createdAt: factoryContainers.createdAt,
        arrivalDate: factoryContainers.arrivalDate,
      })
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          inArray(factoryContainers.supplierId, linkedIds),
          eq(factoryContainers.currencyCode, fromCurrencyCode)
        ))
        .orderBy(order === "newest" ? desc(factoryContainers.createdAt) : factoryContainers.createdAt);

      // Get payments in this currency for linked suppliers
      const allPayments = await db.select({
        supplierId: factorySupplierPayments.supplierId,
        amount: factorySupplierPayments.amount,
      })
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          inArray(factorySupplierPayments.supplierId, linkedIds),
          eq(factorySupplierPayments.currencyCode, fromCurrencyCode)
        ));

      // Get existing FX transfers out for linked suppliers in this currency
      const allFxOut = await db.select({
        fromSupplierId: factorySupplierFxTransfers.fromSupplierId,
        fromAmount: factorySupplierFxTransfers.fromAmount,
      })
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          inArray(factorySupplierFxTransfers.fromSupplierId, linkedIds),
          eq(factorySupplierFxTransfers.fromCurrencyCode, fromCurrencyCode)
        ));

      // Aggregate payment and FX-out totals per supplier
      const paymentsBySupplier: Record<number, number> = {};
      for (const p of allPayments)
        paymentsBySupplier[p.supplierId] = (paymentsBySupplier[p.supplierId] || 0) + parseFloat(p.amount || "0");

      const fxOutBySupplier: Record<number, number> = {};
      for (const f of allFxOut)
        fxOutBySupplier[f.fromSupplierId] = (fxOutBySupplier[f.fromSupplierId] || 0) + parseFloat(f.fromAmount || "0");

      // Previous container-level allocations (to avoid over-allocating)
      const allContainerIds = allContainers.map((c: any) => c.id);
      const prevAllocs = allContainerIds.length > 0
        ? await db.select({
          containerId: factoryFxAllocations.containerId,
          allocatedAmount: factoryFxAllocations.allocatedAmount,
        })
          .from(factoryFxAllocations)
          .where(and(
            eq(factoryFxAllocations.companyId, companyId),
            inArray(factoryFxAllocations.containerId, allContainerIds)
          ))
        : [];

      const prevAllocByContainer: Record<number, number> = {};
      for (const a of prevAllocs)
        prevAllocByContainer[a.containerId] = (prevAllocByContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");

      // Build per-supplier data: available balance + their containers
      const supplierData: Array<{ supplierId: number; name: string; available: number; containers: any[] }> = [];
      for (const sup of linkedSuppliers) {
        const supContainers = allContainers.filter((c: any) => c.supplierId === sup.id);
        const totalValue = supContainers.reduce((s: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          return s + (kg * rate + freight);
        }, 0);
        const paid = paymentsBySupplier[sup.id] || 0;
        const fxOut = fxOutBySupplier[sup.id] || 0;
        const available = Math.max(0, totalValue - paid - fxOut);
        if (available > 0.001 && supContainers.length > 0) {
          supplierData.push({ supplierId: sup.id, name: sup.name, available, containers: supContainers });
        }
      }

      if (supplierData.length === 0)
        return res.status(400).json({ message: `No linked suppliers have an outstanding balance in ${fromCurrencyCode}` });

      // Sort suppliers by their oldest (or newest) container date
      supplierData.sort((a, b) => {
        const dateOf = (sd: typeof a) => sd.containers.reduce((best: string | null, c: any) => {
          const d = c.arrivalDate || c.createdAt;
          if (!best) return d;
          return order === "newest"
            ? (new Date(d) > new Date(best) ? d : best)
            : (new Date(d) < new Date(best) ? d : best);
        }, null);
        const da = dateOf(a), db2 = dateOf(b);
        if (!da) return 1; if (!db2) return -1;
        return order === "newest"
          ? new Date(db2).getTime() - new Date(da).getTime()
          : new Date(da).getTime() - new Date(db2).getTime();
      });

      // Greedy allocation: fill each supplier before moving to the next
      let rem = total;
      const allocations: Array<{ supplierId: number; name: string; allocated: number; toAmountUsd: number; containers: any[] }> = [];
      for (const sd of supplierData) {
        if (rem <= 0.001) break;
        const toAllocate = Math.min(rem, sd.available);
        if (toAllocate < 0.001) continue;
        allocations.push({ supplierId: sd.supplierId, name: sd.name, allocated: toAllocate, toAmountUsd: toAllocate * fxRate, containers: sd.containers });
        rem -= toAllocate;
      }

      if (allocations.length === 0)
        return res.status(400).json({ message: "Could not allocate any amount" });

      // Dry-run: return preview without saving
      if (dryRun) {
        const totalAllocated = allocations.reduce((s, a) => s + a.allocated, 0);
        const totalUsd = allocations.reduce((s, a) => s + a.toAmountUsd, 0);
        return res.json({
          dryRun: true,
          totalRequested: total.toFixed(4),
          totalAllocated: totalAllocated.toFixed(4),
          remaining: (total - totalAllocated).toFixed(4),
          totalUsd: totalUsd.toFixed(4),
          transfers: allocations.map(a => ({
            supplierId: a.supplierId,
            supplierName: a.name,
            allocated: a.allocated.toFixed(4),
            toAmountUsd: a.toAmountUsd.toFixed(4),
          })),
        });
      }

      // Create FX transfers and allocation rows in a transaction
      const settlementDate = date || new Date().toISOString().split("T")[0];
      const results = await db.transaction(async (tx: any) => {
        const created: any[] = [];
        for (const alloc of allocations) {
          const [fxTransfer] = await tx.insert(factorySupplierFxTransfers).values({
            companyId,
            fromSupplierId: alloc.supplierId,
            toSupplierId: brokerId,
            fromCurrencyCode,
            fromAmount: alloc.allocated.toFixed(4),
            fxRateToUsd: fxRate.toString(),
            toAmountUsd: alloc.toAmountUsd.toFixed(4),
            date: settlementDate,
            notes: notes || null,
            sourceType: "supplier",
          }).returning();

          // Container-level allocations (oldest-first within each supplier)
          const sortedCont = [...alloc.containers].sort((a, b) =>
            order === "newest"
              ? new Date(b.arrivalDate || b.createdAt).getTime() - new Date(a.arrivalDate || a.createdAt).getTime()
              : new Date(a.arrivalDate || a.createdAt).getTime() - new Date(b.arrivalDate || b.createdAt).getTime()
          );
          let allocRem = alloc.allocated;
          const allocRows: any[] = [];
          for (const c of sortedCont) {
            if (allocRem <= 0.001) break;
            const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
            const rate = parseFloat(c.ratePerKg || "0");
            const freight = parseFloat(c.freight || "0");
            const val = kg * rate + freight;
            const used = prevAllocByContainer[c.id] || 0;
            const avail = Math.max(0, val - used);
            if (avail <= 0.001) continue;
            const toAlloc2 = Math.min(allocRem, avail);
            allocRows.push({ companyId, fxTransferId: fxTransfer.id, containerId: c.id, sourceType: "supplier", allocatedAmount: toAlloc2.toFixed(4), currencyCode: fromCurrencyCode });
            allocRem -= toAlloc2;
          }
          if (allocRows.length > 0) await tx.insert(factoryFxAllocations).values(allocRows);

          created.push({ id: fxTransfer.id, supplierId: alloc.supplierId, supplierName: alloc.name, allocated: alloc.allocated.toFixed(4), toAmountUsd: alloc.toAmountUsd.toFixed(4) });
        }
        return created;
      });

      res.json({
        success: true,
        totalRequested: total.toFixed(4),
        totalAllocated: (total - rem).toFixed(4),
        remaining: rem.toFixed(4),
        transfers: results,
      });
    } catch (error: any) {
      console.error("Bulk FX settlement error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 1b. Factory Suppliers - Balances & Statement
  // ───────────────────────────────────────────────

  // Get outstanding balance for a single factory supplier (used by voucher payment balance display)
  // Uses the SAME logic as computeStats in with-balances (including freight, FX transfers,
  // voucher-based payments, and broker aggregation across linked suppliers).
  app.get("/api/factory/suppliers/:id/balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const supplierId = parseInt(req.params.id);
      if (isNaN(supplierId)) return res.status(400).json({ message: "Invalid supplier ID" });

      // Load the supplier + any children (for broker aggregation)
      const allSuppliers = await db.select().from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));
      const supplier = allSuppliers.find((s: any) => s.id === supplierId);
      if (!supplier) return res.status(404).json({ message: "Supplier not found" });
      const children = allSuppliers.filter((s: any) => (s as any).parentId === supplierId);
      const supplierIds = [supplierId, ...children.map((c: any) => c.id)];

      // Load all containers, payments, and FX transfers for the relevant supplier IDs
      const allContainers = await db.select().from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const allPayments = await db.select().from(factorySupplierPayments)
        .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, supplierIds)));

      // Voucher-based payments (ERP vouchers that debit a factory supplier account).
      // Exclude FACTORY-PAY-* vouchers — those are auto-generated from factorySupplierPayments
      // and already counted in allPayments to avoid double-counting.
      const voucherPaidBySupplier: Record<number, number> = {};
      const voucherPaymentRows = await db
        .select({
          factorySupplierId: voucherEntries.factorySupplierId,
          debitAmount: voucherEntries.debitAmount,
          currency: vouchers.currency,
          exchangeRate: vouchers.exchangeRate,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(
          inArray(voucherEntries.factorySupplierId, supplierIds),
          sql`${voucherEntries.debitAmount}::numeric > 0`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
        ));
      for (const row of voucherPaymentRows as any[]) {
        const sid = row.factorySupplierId;
        if (!sid) continue;
        const amt = parseFloat(row.debitAmount || "0");
        const fx = parseFloat(row.exchangeRate || "1") || 1;
        const curr = row.currency || "USD";
        const usdAmt = curr === "USD" ? amt : amt / fx;
        voucherPaidBySupplier[sid] = (voucherPaidBySupplier[sid] || 0) + usdAmt;
      }

      // computeBalance: IDENTICAL formula to computeStats in the with-balances endpoint.
      // Includes freight, commission, and voucher-based payments; excludes FX transfers
      // from the USD total (FX transfers are per-currency conversions, not USD settlements).
      const computeBalance = (sid: number, openingBal: number) => {
        const supplierContainers = allContainers.filter((c: any) => c.supplierId === sid);
        const containerValue = supplierContainers.reduce((sum: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const fx = parseFloat(c.fxRateToUsd || "1");
          return sum + (kg * rate + freight) * fx;
        }, 0);
        const commissionContainers = allContainers.filter((c: any) =>
          c.commissionSupplierId === sid && c.supplierId !== sid && parseFloat(c.commissionAmount || "0") > 0
        );
        const commissionValue = commissionContainers.reduce((sum: number, c: any) => {
          const commAmt = parseFloat(c.commissionAmount || "0");
          const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
          const commFx = parseFloat(c.fxRateToUsd || "1");
          return sum + (commCurr === "USD" ? commAmt : commAmt * commFx);
        }, 0);
        const supplierPayments = allPayments.filter((p: any) => p.supplierId === sid);
        const totalPaid = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);
        const voucherPaid = voucherPaidBySupplier[sid] || 0;
        return openingBal + containerValue + commissionValue - totalPaid - voucherPaid;
      };

      // Aggregate: broker's own balance + all children
      const suppliersToAggregate = [{ id: supplierId, openingBalance: supplier.openingBalance }, ...children.map((c: any) => ({ id: c.id, openingBalance: c.openingBalance }))];
      const outstandingUsd = suppliersToAggregate.reduce((sum: number, s: any) => {
        return sum + computeBalance(s.id, parseFloat(s.openingBalance || "0"));
      }, 0);

      res.json({ balance: outstandingUsd, outstandingUsd });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/with-balances", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliersList = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId))
        .orderBy(factorySuppliers.name);

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(eq(factoryContainers.companyId, companyId));

      const allPayments = await db
        .select()
        .from(factorySupplierPayments)
        .where(eq(factorySupplierPayments.companyId, companyId));

      const allFxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(eq(factorySupplierFxTransfers.companyId, companyId));

      // Voucher-based payments: debit entries on voucherEntries where factorySupplierId is set.
      // Exclude FACTORY-PAY-* vouchers — those are auto-generated from factorySupplierPayments
      // and are already counted in allPayments (would double-count otherwise).
      const allSupplierIds = (suppliersList as any[]).map((s: any) => s.id);
      const voucherPaidBySupplier: Record<number, number> = {};
      const voucherPaidBySupplierCurrency: Record<number, Record<string, number>> = {};
      if (allSupplierIds.length > 0) {
        const voucherPaymentRows = await db
          .select({
            factorySupplierId: voucherEntries.factorySupplierId,
            debitAmount: voucherEntries.debitAmount,
            currency: vouchers.currency,
            exchangeRate: vouchers.exchangeRate,
          })
          .from(voucherEntries)
          .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
          .where(and(
            inArray(voucherEntries.factorySupplierId, allSupplierIds),
            sql`${voucherEntries.debitAmount}::numeric > 0`,
            sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
          ));
        for (const row of voucherPaymentRows as any[]) {
          const suppId = row.factorySupplierId;
          if (!suppId) continue;
          const amt = parseFloat(row.debitAmount || "0");
          const fx = parseFloat(row.exchangeRate || "1") || 1;
          const curr = row.currency || "USD";
          const usdAmt = curr === "USD" ? amt : amt / fx;
          voucherPaidBySupplier[suppId] = (voucherPaidBySupplier[suppId] || 0) + usdAmt;
          if (!voucherPaidBySupplierCurrency[suppId]) voucherPaidBySupplierCurrency[suppId] = {};
          voucherPaidBySupplierCurrency[suppId][curr] = (voucherPaidBySupplierCurrency[suppId][curr] || 0) + amt;
        }
      }

      // Helper to compute stats for a single supplier record
      const computeStats = (s: any) => {
        const supplierContainers = containers.filter((c: any) => c.supplierId === s.id);
        const totalContainers = supplierContainers.length;
        const totalKg = supplierContainers.reduce((sum: number, c: any) => {
          return sum + (parseFloat(c.actualReceivedKg || c.totalKg || "0"));
        }, 0);
        // Sum container value including freight (agreed supplier charge) in USD.
        const containerValue = supplierContainers.reduce((sum: number, c: any) => {
          const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat(c.freight || "0");
          const fx = parseFloat(c.fxRateToUsd || "1");
          return sum + ((kg * rate + freight) * fx);
        }, 0);
        // Commission owed to this supplier from containers where they are the commission/broker supplier
        // Exclude containers where this supplier is also the main purchase supplier (avoid double-counting)
        const commissionContainers = containers.filter((c: any) =>
          c.commissionSupplierId === s.id && c.supplierId !== s.id && parseFloat(c.commissionAmount || "0") > 0
        );
        const commissionValue = commissionContainers.reduce((sum: number, c: any) => {
          const commAmt = parseFloat(c.commissionAmount || "0");
          const commCurr = c.commissionCurrencyCode || c.currencyCode || "USD";
          const commFx = parseFloat(c.fxRateToUsd || "1");
          return sum + (commCurr === "USD" ? commAmt : commAmt * commFx);
        }, 0);
        const pendingContainers = supplierContainers.filter((c: any) => c.status === "PENDING" || c.status === "IN_TRANSIT").length;
        const receivedContainers = supplierContainers.filter((c: any) => c.status === "RECEIVED" || c.status === "PARTIALLY_RECEIVED" || c.status === "OFFLOADED").length;
        const lastContainerDate = supplierContainers.length > 0
          ? supplierContainers.reduce((latest: string | null, c: any) => {
              const d = c.arrivalDate || c.createdAt;
              if (!latest) return d;
              return new Date(d) > new Date(latest) ? d : latest;
            }, null)
          : null;
        const supplierPayments = allPayments.filter((p: any) => p.supplierId === s.id);
        const totalPaid = supplierPayments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0);
        // Include voucher-based payments (payment vouchers) in the balance
        const voucherPaidUsd = voucherPaidBySupplier[s.id] || 0;
        const balance = parseFloat(s.openingBalance || "0") + containerValue + commissionValue - totalPaid - voucherPaidUsd;

        // Per-currency balances (original currency, not converted).
        // Use kg * ratePerKg + freight (exclude offload charges which are our cost, not supplier's).
        const byCurrency: Record<string, number> = {};
        for (const c of supplierContainers) {
          const cc = c.currencyCode || "USD";
          const val = parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0");
          byCurrency[cc] = (byCurrency[cc] || 0) + val;
        }
        // Add commission amounts (in their own currency) for containers where this supplier is the broker
        for (const c of commissionContainers) {
          const cc = c.commissionCurrencyCode || c.currencyCode || "USD";
          const commAmt = parseFloat(c.commissionAmount || "0");
          byCurrency[cc] = (byCurrency[cc] || 0) + commAmt;
        }
        // Subtract regular payments by currency
        for (const p of supplierPayments) {
          const cc = p.currencyCode || "USD";
          byCurrency[cc] = (byCurrency[cc] || 0) - parseFloat(p.amount || "0");
        }
        // Subtract voucher-based payments by currency
        const voucherCurrMap = voucherPaidBySupplierCurrency[s.id] || {};
        for (const [cc, amt] of Object.entries(voucherCurrMap)) {
          byCurrency[cc] = (byCurrency[cc] || 0) - amt;
        }
        // FX transfers: sub-supplier loses fromCurrency, parent supplier gains USD
        for (const t of allFxTransfers) {
          if (t.fromSupplierId === s.id) {
            const cc = t.fromCurrencyCode || "USD";
            byCurrency[cc] = (byCurrency[cc] || 0) - parseFloat(t.fromAmount || "0");
          }
          if (t.toSupplierId === s.id) {
            byCurrency["USD"] = (byCurrency["USD"] || 0) + parseFloat(t.toAmountUsd || "0");
          }
        }
        const currencyBalances = Object.entries(byCurrency)
          .map(([currencyCode, bal]) => ({ currencyCode, balance: bal }))
          .filter(({ balance: bal }) => Math.abs(bal) > 0.001)
          .sort((a, b) => (a.currencyCode === "USD" ? 1 : -1)); // non-USD first

        // Due containers: offloaded >30 days ago and supplier still has a positive balance
        const now = new Date();
        const dueContainers = balance > 0.01 ? supplierContainers
          .filter((c: any) => {
            if (!c.offloadDate) return false;
            const offloadMs = new Date(c.offloadDate).getTime();
            return (now.getTime() - offloadMs) >= 30 * 24 * 60 * 60 * 1000;
          })
          .map((c: any) => ({
            id: c.id,
            containerNumber: c.containerNumber,
            offloadDate: c.offloadDate,
            currencyCode: c.currencyCode || "USD",
            value: (parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0")).toFixed(2),
            daysPastDue: Math.floor((now.getTime() - new Date(c.offloadDate).getTime()) / (24 * 60 * 60 * 1000)) - 30,
          })) : [];

        // Approx FX rate: weighted average rate across non-USD containers (for UI display)
        const fxContainers = supplierContainers.filter((c: any) => (c.currencyCode || "USD") !== "USD" && parseFloat(c.fxRateToUsd || "0") > 0);
        const fxWeightedSum = fxContainers.reduce((s: number, c: any) => {
          const val = parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0");
          return s + val * parseFloat(c.fxRateToUsd || "1");
        }, 0);
        const fxWeightBase = fxContainers.reduce((s: number, c: any) => {
          return s + (parseFloat(c.actualReceivedKg || c.totalKg || "0") * parseFloat(c.ratePerKg || "0") + parseFloat(c.freight || "0"));
        }, 0);
        const approxFxRate = fxWeightBase > 0 ? fxWeightedSum / fxWeightBase : 0;

        return { totalContainers, totalKg, containerValue, commissionValue, pendingContainers, receivedContainers, lastContainerDate, totalPaid, balance, currencyBalances, dueContainers, approxFxRate };
      };

      // First pass: compute each supplier's own stats
      const statsById: Record<number, ReturnType<typeof computeStats>> = {};
      for (const s of suppliersList as any[]) {
        statsById[s.id] = computeStats(s);
      }

      // Second pass: for parent suppliers, roll up children's stats
      const suppliersWithBalances = (suppliersList as any[]).map((s: any) => {
        const own = statsById[s.id];
        const children = (suppliersList as any[]).filter((c: any) => c.parentId === s.id);

        if (children.length === 0) {
          // Leaf supplier — use own stats
          return {
            ...s,
            totalContainers: own.totalContainers,
            totalKg: own.totalKg.toFixed(3),
            totalValue: own.balance.toFixed(2),
            totalPaid: own.totalPaid.toFixed(2),
            totalCommissionUsd: own.commissionValue.toFixed(2),
            approxFxRate: own.approxFxRate > 0 ? own.approxFxRate.toFixed(4) : null,
            pendingContainers: own.pendingContainers,
            receivedContainers: own.receivedContainers,
            lastContainerDate: own.lastContainerDate,
            currencyBalances: own.currencyBalances,
            dueContainers: own.dueContainers,
            dueContainersCount: own.dueContainers.length,
          };
        }

        // Parent supplier — aggregate own + children stats
        const childStats = children.map((c: any) => statsById[c.id]);
        const aggContainers = own.totalContainers + childStats.reduce((n: number, cs: any) => n + cs.totalContainers, 0);
        const aggKg = own.totalKg + childStats.reduce((n: number, cs: any) => n + cs.totalKg, 0);
        const aggBalance = own.balance + childStats.reduce((n: number, cs: any) => n + cs.balance, 0);
        const aggPaid = own.totalPaid + childStats.reduce((n: number, cs: any) => n + cs.totalPaid, 0);
        const aggPending = own.pendingContainers + childStats.reduce((n: number, cs: any) => n + cs.pendingContainers, 0);
        const aggReceived = own.receivedContainers + childStats.reduce((n: number, cs: any) => n + cs.receivedContainers, 0);
        const allDates = [own.lastContainerDate, ...childStats.map((cs: any) => cs.lastContainerDate)].filter(Boolean);
        const aggLastDate = allDates.length > 0 ? allDates.reduce((latest: string, d: string) => new Date(d) > new Date(latest) ? d : latest) : null;
        const aggDueContainers = [...own.dueContainers, ...childStats.flatMap((cs: any) => cs.dueContainers)];
        // Aggregate commission across own + all children
        const aggCommission = own.commissionValue + childStats.reduce((n: number, cs: any) => n + cs.commissionValue, 0);
        // Weighted average FX rate across own + children (weight by container value)
        const allStats = [own, ...childStats];
        const totalFxWeightedSum = allStats.reduce((s: number, cs: any) => {
          const base = cs.approxFxRate > 0 ? (cs.containerValue > 0 ? cs.containerValue : 0) : 0;
          return s + (cs.approxFxRate * base);
        }, 0);
        const totalFxWeightBase = allStats.reduce((s: number, cs: any) => s + (cs.approxFxRate > 0 ? cs.containerValue : 0), 0);
        const aggApproxFxRate = totalFxWeightBase > 0 ? totalFxWeightedSum / totalFxWeightBase : 0;

        // Aggregate currency balances across own + children
        const aggCurrencyMap: Record<string, number> = {};
        for (const cb of own.currencyBalances) {
          aggCurrencyMap[cb.currencyCode] = (aggCurrencyMap[cb.currencyCode] || 0) + cb.balance;
        }
        for (const cs of childStats) {
          for (const cb of cs.currencyBalances) {
            aggCurrencyMap[cb.currencyCode] = (aggCurrencyMap[cb.currencyCode] || 0) + cb.balance;
          }
        }
        const aggCurrencyBalances = Object.entries(aggCurrencyMap)
          .map(([currencyCode, bal]) => ({ currencyCode, balance: bal }))
          .filter(({ balance: bal }) => Math.abs(bal) > 0.001)
          .sort((a, b) => (a.currencyCode === "USD" ? 1 : -1));

        return {
          ...s,
          totalContainers: aggContainers,
          totalKg: aggKg.toFixed(3),
          totalValue: aggBalance.toFixed(2),
          totalPaid: aggPaid.toFixed(2),
          totalCommissionUsd: aggCommission.toFixed(2),
          approxFxRate: aggApproxFxRate > 0 ? aggApproxFxRate.toFixed(4) : null,
          pendingContainers: aggPending,
          receivedContainers: aggReceived,
          lastContainerDate: aggLastDate,
          currencyBalances: aggCurrencyBalances,
          dueContainers: aggDueContainers,
          dueContainersCount: aggDueContainers.length,
        };
      });

      res.json(suppliersWithBalances.sort((a: any, b: any) => a.name.localeCompare(b.name)));
    } catch (error: any) {
      console.error("Error fetching factory suppliers with balances:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/suppliers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const supplierId = parseInt(req.params.id);

      const [supplier] = await db
        .select()
        .from(factorySuppliers)
        .where(and(eq(factorySuppliers.id, supplierId), eq(factorySuppliers.companyId, companyId)));

      if (!supplier) return res.status(404).json({ message: "Supplier not found" });

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq(factoryContainers.supplierId, supplierId)
        ))
        .orderBy(desc(factoryContainers.createdAt));

      // Containers where this supplier earns commission as a broker (commissionSupplierId = supplierId)
      const brokerContainerRows = await db
        .select({
          id: factoryContainers.id,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          arrivalDate: factoryContainers.arrivalDate,
          createdAt: factoryContainers.createdAt,
          status: factoryContainers.status,
          commissionAmount: factoryContainers.commissionAmount,
          commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
          origin: factoryContainers.origin,
          supplierName: factorySuppliers.name,
        })
        .from(factoryContainers)
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(
          eq(factoryContainers.companyId, companyId),
          eq((factoryContainers as any).commissionSupplierId, supplierId),
          sql`${factoryContainers.supplierId} != ${supplierId}`
        ))
        .orderBy(desc(factoryContainers.createdAt));
      const brokerContainers = (brokerContainerRows as any[]).filter((c: any) => parseFloat(c.commissionAmount || "0") > 0);
      const totalBrokerCommission = brokerContainers.reduce((sum: number, c: any) => sum + parseFloat(c.commissionAmount || "0"), 0);

      const commissions = await db
        .select()
        .from(factoryContainerCommissions)
        .where(eq(factoryContainerCommissions.companyId, companyId));

      // OB commissions — raw stock entries with commission data for this supplier
      const obRawStockWithCommission = containers.length > 0
        ? await db
            .select()
            .from(factoryRawStock)
            .where(and(
              eq(factoryRawStock.companyId, companyId),
              inArray(factoryRawStock.containerId, containers.map((c: any) => c.id))
            ))
        : [];

      const statement = containers.map((c: any) => {
        const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
        const rate = parseFloat(c.ratePerKg || "0");
        const freight = parseFloat(c.freight || "0");
        // Supplier payable = kg × rate + freight (freight is an agreed charge to the supplier).
        const value = kg * rate + freight;
        const containerCommissions = commissions.filter((cm: any) => cm.containerId === c.id);
        const totalCommission = containerCommissions.reduce((sum: number, cm: any) => sum + parseFloat(cm.commissionTotal || "0"), 0);

        return {
          id: c.id,
          containerNumber: c.containerNumber,
          date: c.arrivalDate || c.createdAt,
          origin: c.origin,
          status: c.status,
          currencyCode: c.currencyCode || "USD",
          fxRateToUsd: c.fxRateToUsd || "1",
          declaredKg: c.declaredKg,
          actualReceivedKg: c.actualReceivedKg,
          totalKg: c.totalKg,
          ratePerKg: c.ratePerKg,
          differenceKg: c.differenceKg,
          freight: freight.toFixed(2),
          value: value.toFixed(2),
          finalPayableAmount: c.finalPayableAmount,
          commissionAmount: c.commissionAmount || "0",
          commissionCurrencyCode: c.commissionCurrencyCode || "USD",
          commissionSupplierId: (c as any).commissionSupplierId || null,
          commissionNotes: (c as any).commissionNotes || null,
          commissions: containerCommissions,
          totalCommission: totalCommission.toFixed(2),
          notes: c.notes,
        };
      });

      const totalValue = statement.reduce((sum: number, s: any) => sum + parseFloat(s.value), 0);
      const totalKg = statement.reduce((sum: number, s: any) => sum + parseFloat(s.actualReceivedKg || s.totalKg || "0"), 0);
      const totalCommissions = statement.reduce((sum: number, s: any) => sum + parseFloat(s.totalCommission), 0);
      const totalDirectCommissions = statement.reduce((sum: number, s: any) => sum + parseFloat(s.commissionAmount || "0"), 0);

      // Fetch payments for this supplier (needed for per-currency net payable calculation)
      const payments = await db
        .select()
        .from(factorySupplierPayments)
        .where(and(
          eq(factorySupplierPayments.companyId, companyId),
          eq(factorySupplierPayments.supplierId, supplierId)
        ))
        .orderBy(desc(factorySupplierPayments.date));

      // Also fetch voucher-based payments (manually created Payment vouchers — exclude
      // auto-generated FACTORY-PAY-* vouchers which are already reflected in the payments array)
      const voucherPaymentRows = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          voucherDate: vouchers.voucherDate,
          description: vouchers.description,
          voucherType: vouchers.voucherType,
          voucherNumber: vouchers.voucherNumber,
          currency: vouchers.currency,
          exchangeRate: vouchers.exchangeRate,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(and(
          eq(voucherEntries.factorySupplierId, supplierId),
          sql`${voucherEntries.debitAmount}::numeric > 0`,
          sql`${vouchers.voucherNumber} NOT LIKE 'FACTORY-PAY-%'`
        ))
        .orderBy(desc(vouchers.voucherDate));

      // Convert voucher payments to USD for total calculation
      const voucherPaymentsTotal = (voucherPaymentRows as any[]).reduce((sum: number, p: any) => {
        const amt = parseFloat(p.debitAmount || "0");
        const fx = parseFloat(p.exchangeRate || "1") || 1;
        const currency = p.currency || "USD";
        const usdAmt = currency === "USD" ? amt : amt / fx;
        return sum + usdAmt;
      }, 0);

      const totalPayments = payments.reduce((sum: number, p: any) => sum + parseFloat(p.amountUsd || "0"), 0) + voucherPaymentsTotal;

      // Group by currency for multi-currency statement
      const byCurrency: Record<string, { containers: any[]; totalKg: number; totalValue: number; totalCommission: number; totalDirectCommission: number }> = {};
      for (const s of statement) {
        const cc = s.currencyCode;
        if (!byCurrency[cc]) byCurrency[cc] = { containers: [], totalKg: 0, totalValue: 0, totalCommission: 0, totalDirectCommission: 0 };
        byCurrency[cc].containers.push(s);
        byCurrency[cc].totalKg += parseFloat(s.actualReceivedKg || s.totalKg || "0");
        byCurrency[cc].totalValue += parseFloat(s.value);
        byCurrency[cc].totalCommission += parseFloat(s.totalCommission);
        byCurrency[cc].totalDirectCommission += parseFloat(s.commissionAmount || "0");
      }

      // Fetch FX transfers involving this supplier (as source or destination)
      const fxTransfers = await db
        .select()
        .from(factorySupplierFxTransfers)
        .where(and(
          eq(factorySupplierFxTransfers.companyId, companyId),
          sql`(${factorySupplierFxTransfers.fromSupplierId} = ${supplierId} OR ${factorySupplierFxTransfers.toSupplierId} = ${supplierId})`
        ))
        .orderBy(desc(factorySupplierFxTransfers.date));

      // Phase 3: Enrich FX transfers with counterparty supplier names for bilateral visibility
      const fxSupplierIds = [...new Set((fxTransfers as any[]).flatMap((t: any) => [t.fromSupplierId, t.toSupplierId]).filter(Boolean))];
      const fxSupplierNames: Record<number, string> = {};
      if (fxSupplierIds.length > 0) {
        const fxSups = await db.select({ id: factorySuppliers.id, name: factorySuppliers.name })
          .from(factorySuppliers).where(inArray(factorySuppliers.id, fxSupplierIds));
        for (const s of fxSups) fxSupplierNames[s.id] = s.name;
      }
      // Enrich incoming FX transfers with the container numbers they cover (cross-reference)
      const incomingFxIds = (fxTransfers as any[]).filter((t: any) => t.toSupplierId === supplierId).map((t: any) => t.id);
      const fxContainerRefsMap: Record<number, Array<{ containerNumber: string; allocatedAmount: string }>> = {};
      if (incomingFxIds.length > 0) {
        const fxAllocs = await db
          .select({
            fxTransferId: factoryFxAllocations.fxTransferId,
            containerId: factoryFxAllocations.containerId,
            allocatedAmount: factoryFxAllocations.allocatedAmount,
            containerNumber: factoryContainers.containerNumber,
          })
          .from(factoryFxAllocations)
          .innerJoin(factoryContainers, eq(factoryFxAllocations.containerId, factoryContainers.id))
          .where(inArray(factoryFxAllocations.fxTransferId, incomingFxIds));
        for (const a of fxAllocs) {
          if (!fxContainerRefsMap[a.fxTransferId]) fxContainerRefsMap[a.fxTransferId] = [];
          fxContainerRefsMap[a.fxTransferId].push({ containerNumber: a.containerNumber, allocatedAmount: String(a.allocatedAmount) });
        }
      }

      const enrichedFxTransfers = (fxTransfers as any[]).map((t: any) => ({
        ...t,
        fromSupplierName: fxSupplierNames[t.fromSupplierId] || "",
        toSupplierName: fxSupplierNames[t.toSupplierId] || "",
        containerRefs: fxContainerRefsMap[t.id] || [],
      }));

      // Build per-currency payment totals (using original currency amounts, not USD)
      const paidByCurrency: Record<string, number> = {};
      // Phase 2: Track commission reductions from FX settlements (source = commission or both)
      const fxCommOut: Record<string, number> = {};
      const fxBothOut: Record<string, number> = {};
      for (const p of (payments as any[])) {
        const cc = p.currencyCode || "USD";
        paidByCurrency[cc] = (paidByCurrency[cc] || 0) + parseFloat(p.amount || "0");
      }
      // FX transfers out of this supplier reduce its original currency balance
      for (const t of enrichedFxTransfers) {
        if (t.fromSupplierId === supplierId) {
          const cc = t.fromCurrencyCode || "USD";
          paidByCurrency[cc] = (paidByCurrency[cc] || 0) + parseFloat(t.fromAmount || "0");
          if (t.sourceType === "commission") {
            fxCommOut[cc] = (fxCommOut[cc] || 0) + parseFloat(t.fromAmount || "0");
          } else if (t.sourceType === "both") {
            fxBothOut[cc] = (fxBothOut[cc] || 0) + parseFloat(t.fromAmount || "0");
          }
        }
        // FX transfers into this supplier (parent) add to its USD bucket
        if (t.toSupplierId === supplierId) {
          paidByCurrency["USD"] = (paidByCurrency["USD"] || 0) - parseFloat(t.toAmountUsd || "0");
        }
      }

      const currencyGroups = Object.entries(byCurrency).map(([cc, data]) => {
        const paid = paidByCurrency[cc] || 0;
        const netPayable = data.totalValue - data.totalCommission - paid;
        // Phase 2: commission remaining = totalCommission minus what was settled via FX
        // "both" is treated as commission-first (capped at totalCommission), then supplier
        const commFxReduction = Math.min(data.totalCommission, (fxCommOut[cc] || 0) + (fxBothOut[cc] || 0));
        const remainingCommission = Math.max(0, data.totalCommission - commFxReduction);
        return {
          currencyCode: cc,
          containers: data.containers,
          totalKg: data.totalKg.toFixed(3),
          totalValue: data.totalValue.toFixed(2),
          totalCommission: data.totalCommission.toFixed(2),
          remainingCommission: remainingCommission.toFixed(2),
          totalDirectCommission: data.totalDirectCommission.toFixed(2),
          totalPaid: paid.toFixed(2),
          netPayable: netPayable.toFixed(2),
          totalOwed: (data.totalValue + data.totalDirectCommission).toFixed(2),
        };
      }).filter(g => parseFloat(g.netPayable) > 0.005);

      // Build OB commissions list
      const containerMap: Record<number, any> = {};
      for (const c of containers) containerMap[c.id] = c;
      // Fetch commission supplier names for the statement
      const commSupplierIds = (obRawStockWithCommission as any[])
        .map((r: any) => r.commissionSupplierId)
        .filter(Boolean);
      const commSupplierMap: Record<number, string> = {};
      if (commSupplierIds.length > 0) {
        const commSuppliers = await db
          .select({ id: factorySuppliers.id, name: factorySuppliers.name })
          .from(factorySuppliers)
          .where(sql`${factorySuppliers.id} = ANY(${commSupplierIds})`);
        for (const s of commSuppliers) commSupplierMap[s.id] = s.name;
      }
      const obCommissions = (obRawStockWithCommission as any[])
        .filter((r: any) => r.commissionAmount && parseFloat(r.commissionAmount) > 0)
        .map((r: any) => ({
          rawStockId: r.id,
          containerId: r.containerId,
          containerNumber: containerMap[r.containerId]?.containerNumber || "",
          date: containerMap[r.containerId]?.createdAt || r.createdAt,
          personName: r.commissionSupplierId ? (commSupplierMap[r.commissionSupplierId] || r.commissionPersonName || "") : (r.commissionPersonName || ""),
          commissionSupplierId: r.commissionSupplierId || null,
          amount: r.commissionAmount,
          currencyCode: r.commissionCurrencyCode || "USD",
          fxRateToUsd: r.commissionFxRateToUsd || "1",
          amountUsd: r.commissionAmountUsd || r.commissionAmount,
        }));
      const totalObCommissions = obCommissions.reduce((sum: number, c: any) => sum + parseFloat(c.amountUsd || "0"), 0);

      // Phase 2: Broker statement — aggregate linked suppliers if this is a broker
      const linkedSuppliers = await db
        .select({ id: factorySuppliers.id, name: factorySuppliers.name })
        .from(factorySuppliers)
        .where(and(
          eq(factorySuppliers.parentId, supplierId),
          eq(factorySuppliers.companyId, companyId)
        ));

      const linkedSupplierGroups: any[] = [];
      for (const linked of linkedSuppliers) {
        const linkedContainers = await db
          .select()
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.supplierId, linked.id)))
          .orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt);

        const linkedPayments = await db
          .select()
          .from(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.companyId, companyId), eq(factorySupplierPayments.supplierId, linked.id)));

        const linkedFxTransfers = await db
          .select()
          .from(factorySupplierFxTransfers)
          .where(and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            sql`(${factorySupplierFxTransfers.fromSupplierId} = ${linked.id} OR ${factorySupplierFxTransfers.toSupplierId} = ${linked.id})`
          ));

        const linkedByCurrency: Record<string, { containers: any[]; totalValue: number; totalCommission: number }> = {};
        for (const c of linkedContainers) {
          const kg = parseFloat((c as any).actualReceivedKg || c.totalKg || "0");
          const rate = parseFloat(c.ratePerKg || "0");
          const freight = parseFloat((c as any).freight || "0");
          // Supplier payable = kg × rate + freight (freight is an agreed charge to the supplier).
          const value = kg * rate + freight;
          const cComms = commissions.filter((cm: any) => cm.containerId === c.id);
          const totalComm = cComms.reduce((s: number, cm: any) => s + parseFloat(cm.commissionTotal || "0"), 0);
          const cc = c.currencyCode || "USD";
          if (!linkedByCurrency[cc]) linkedByCurrency[cc] = { containers: [], totalValue: 0, totalCommission: 0 };
          linkedByCurrency[cc].containers.push({
            id: c.id,
            containerNumber: c.containerNumber,
            date: (c as any).arrivalDate || c.createdAt,
            freight: freight.toFixed(2),
            value: value.toFixed(2),
            currencyCode: cc,
            fxRateToUsd: c.fxRateToUsd || "1",
            status: c.status,
            commissionAmount: c.commissionAmount || "0",
            commissionCurrencyCode: c.commissionCurrencyCode || "USD",
            commissionSupplierId: (c as any).commissionSupplierId || null,
            commissionNotes: (c as any).commissionNotes || null,
            notes: c.notes,
          });
          linkedByCurrency[cc].totalValue += value;
          linkedByCurrency[cc].totalCommission += totalComm;
        }

        const linkedPaidByCurrency: Record<string, number> = {};
        for (const p of (linkedPayments as any[])) {
          const cc = p.currencyCode || "USD";
          linkedPaidByCurrency[cc] = (linkedPaidByCurrency[cc] || 0) + parseFloat(p.amount || "0");
        }
        for (const t of (linkedFxTransfers as any[])) {
          if (t.fromSupplierId === linked.id) {
            const cc = t.fromCurrencyCode || "USD";
            linkedPaidByCurrency[cc] = (linkedPaidByCurrency[cc] || 0) + parseFloat(t.fromAmount || "0");
          }
        }

        const linkedCurrencyGroups = Object.entries(linkedByCurrency).map(([cc, data]) => {
          const paid = linkedPaidByCurrency[cc] || 0;
          const netPayable = data.totalValue - data.totalCommission - paid;
          return {
            currencyCode: cc,
            containers: data.containers,
            totalValue: data.totalValue.toFixed(2),
            totalCommission: data.totalCommission.toFixed(2),
            totalPaid: paid.toFixed(2),
            netPayable: netPayable.toFixed(2),
            containerCount: data.containers.length,
            lastActivity: linkedContainers.length > 0
              ? ((linkedContainers[linkedContainers.length - 1] as any).arrivalDate || linkedContainers[linkedContainers.length - 1].createdAt)
              : null,
          };
        });

        linkedSupplierGroups.push({
          supplierId: linked.id,
          supplierName: linked.name,
          containerCount: linkedContainers.length,
          currencyGroups: linkedCurrencyGroups,
          lastActivity: linkedContainers.length > 0
            ? ((linkedContainers[linkedContainers.length - 1] as any).arrivalDate || linkedContainers[linkedContainers.length - 1].createdAt)
            : null,
        });
      }

      // ── Phase 1: Fetch per-container FX allocations ──────────────────────────
      const containerIds = containers.map((c: any) => c.id);
      const allocationsByContainer: Record<number, number> = {};
      if (containerIds.length > 0) {
        const allocs = await db
          .select({ containerId: factoryFxAllocations.containerId, allocatedAmount: factoryFxAllocations.allocatedAmount })
          .from(factoryFxAllocations)
          .where(and(eq(factoryFxAllocations.companyId, companyId), inArray(factoryFxAllocations.containerId, containerIds)));
        for (const a of allocs) {
          allocationsByContainer[a.containerId] = (allocationsByContainer[a.containerId] || 0) + parseFloat(a.allocatedAmount || "0");
        }
      }
      // Enrich each statement row with allocatedAmount + remainingAmount
      const enrichedStatement = statement.map((s: any) => {
        const val = parseFloat(s.value || "0");
        const comm = parseFloat(s.totalCommission || "0");
        const netVal = val - comm;
        const allocAmt = allocationsByContainer[s.id] || 0;
        return { ...s, allocatedAmount: allocAmt.toFixed(2), remainingAmount: Math.max(0, netVal - allocAmt).toFixed(2) };
      });
      // ── Phase 5: Build pre-sorted unified ledger ─────────────────────────────
      const fmtAmt = (amt: string, cc: string, neg: boolean) => {
        const prefix = cc !== "USD" ? `${cc} ` : "$";
        const sign = neg ? "-" : "+";
        return `${sign}${prefix}${parseFloat(amt || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };
      const ledger: any[] = [
        ...enrichedStatement.map((s: any) => ({
          key: `c-${s.id}`,
          date: s.date,
          type: "purchase",
          ref: s.containerNumber,
          detail: `${s.origin || ""} · ${parseFloat(s.actualReceivedKg || s.totalKg || "0").toFixed(0)} kg`,
          amount: fmtAmt(s.value, s.currencyCode, false),
          amountIsNeg: false,
          notes: s.notes,
          allocatedAmount: s.allocatedAmount,
          remainingAmount: s.remainingAmount,
        })),
        ...(payments as any[]).map((p: any) => ({
          key: `p-${p.id}`,
          date: p.date,
          type: "payment",
          ref: null,
          detail: p.method || "Payment",
          amount: fmtAmt(p.amount, p.currencyCode || "USD", true),
          amountIsNeg: true,
          notes: p.notes,
        })),
        ...(voucherPaymentRows as any[]).map((p: any) => ({
          key: `vp-${p.id}`,
          date: p.voucherDate,
          type: "payment",
          ref: p.voucherNumber || null,
          detail: p.description || `${p.voucherType || "Payment"} voucher`,
          amount: fmtAmt(p.debitAmount, p.currency || "USD", true),
          amountIsNeg: true,
          notes: null,
        })),
        ...enrichedFxTransfers.map((t: any) => {
          const isOut = t.fromSupplierId === supplierId;
          const cc = isOut ? (t.fromCurrencyCode || "USD") : "USD";
          const amt = isOut ? t.fromAmount : t.toAmountUsd;
          const counterparty = isOut ? (t.toSupplierName || "Broker") : (t.fromSupplierName || "Linked");
          return {
            key: `fx-${t.id}`,
            date: t.date,
            type: "fx",
            ref: isOut ? `FX → ${counterparty}` : `FX ← ${counterparty}`,
            detail: isOut ? `${t.fromCurrencyCode} ${parseFloat(t.fromAmount || "0").toFixed(2)} → $${parseFloat(t.toAmountUsd || "0").toFixed(2)}${t.sourceType ? ` · ${t.sourceType}` : ""}` : `+$${parseFloat(t.toAmountUsd || "0").toFixed(2)} received`,
            amount: fmtAmt(amt, cc, isOut),
            amountIsNeg: isOut,
            notes: t.notes,
          };
        }),
        ...obCommissions.map((oc: any) => ({
          key: `oc-${oc.rawStockId}`,
          date: oc.date,
          type: "commission",
          ref: oc.containerNumber,
          detail: oc.personName || "",
          amount: fmtAmt(oc.amount, oc.currencyCode, true),
          amountIsNeg: true,
          notes: null,
        })),
      ].sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db2 = b.date ? new Date(b.date).getTime() : 0;
        return db2 - da;
      });
      // ─────────────────────────────────────────────────────────────────────────

      res.json({
        supplier,
        statement: enrichedStatement,
        currencyGroups,
        obCommissions,
        payments,
        fxTransfers: enrichedFxTransfers,
        linkedSupplierGroups,
        brokerContainers,
        ledger,
        summary: {
          totalContainers: statement.length,
          totalKg: totalKg.toFixed(3),
          totalValue: totalValue.toFixed(2),
          totalCommissions: totalCommissions.toFixed(2),
          totalDirectCommissions: totalDirectCommissions.toFixed(2),
          totalObCommissions: totalObCommissions.toFixed(2),
          totalPayments: totalPayments.toFixed(2),
          totalBrokerCommission: totalBrokerCommission.toFixed(2),
          netPayable: (totalValue - totalCommissions - totalPayments).toFixed(2),
          totalOwed: (totalValue + totalDirectCommissions).toFixed(2),
        },
      });
    } catch (error: any) {
      console.error("Error fetching supplier statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Broker Consolidated Statement  (aggregates broker + all linked suppliers)
  // GET /api/factory/suppliers/:id/broker-statement[/export?format=excel]
  // ─────────────────────────────────────────────────────────────────────────
  async function buildBrokerStatement(brokerId: number, companyId: number) {
    // Fetch broker
    const [broker] = await db.select().from(factorySuppliers)
      .where(and(eq(factorySuppliers.id, brokerId), eq(factorySuppliers.companyId, companyId)));
    if (!broker) return null;

    // Linked suppliers
    const linkedRaw = await db.select().from(factorySuppliers)
      .where(and(eq(factorySuppliers.parentId, brokerId), eq(factorySuppliers.companyId, companyId)));

    const allSuppliers = [broker, ...linkedRaw];
    const allSupplierIds = allSuppliers.map((s: any) => s.id);
    const supplierNameMap: Record<number, string> = {};
    for (const s of allSuppliers) supplierNameMap[(s as any).id] = (s as any).name;

    // Containers
    const allContainers = allSupplierIds.length > 0
      ? await db.select().from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), inArray(factoryContainers.supplierId, allSupplierIds)))
          .orderBy(factoryContainers.arrivalDate, factoryContainers.createdAt)
      : [];

    // Payments (direct)
    const allPayments = allSupplierIds.length > 0
      ? await db.select().from(factorySupplierPayments)
          .where(and(eq(factorySupplierPayments.companyId, companyId), inArray(factorySupplierPayments.supplierId, allSupplierIds)))
          .orderBy(factorySupplierPayments.date)
      : [];

    // FX transfers (involving any of the suppliers)
    const allFx = allSupplierIds.length > 0
      ? await db.select().from(factorySupplierFxTransfers)
          .where(and(
            eq(factorySupplierFxTransfers.companyId, companyId),
            sql`(${factorySupplierFxTransfers.fromSupplierId} = ANY(${sql.raw(`ARRAY[${allSupplierIds.join(",")}]`)}) OR ${factorySupplierFxTransfers.toSupplierId} = ANY(${sql.raw(`ARRAY[${allSupplierIds.join(",")}]`)}))`
          ))
          .orderBy(factorySupplierFxTransfers.date)
      : [];

    type LedgerRow = {
      date: string | null;
      type: "container" | "payment" | "fx_out" | "fx_in" | "commission";
      description: string;
      ref: string;
      amount: number;
      commissionAmount: number | null;
      commissionCurrency: string | null;
    };

    const ledgerByCurrency: Record<string, LedgerRow[]> = {};
    const addRow = (cc: string, row: LedgerRow) => {
      if (!ledgerByCurrency[cc]) ledgerByCurrency[cc] = [];
      ledgerByCurrency[cc].push(row);
    };

    // Container rows
    for (const c of allContainers as any[]) {
      const supplierName = supplierNameMap[c.supplierId] || "Unknown";
      const cc = c.currencyCode || "USD";
      const kg = parseFloat(c.actualReceivedKg || c.totalKg || "0");
      const rate = parseFloat(c.ratePerKg || "0");
      const freight = parseFloat(c.freight || "0");
      const mainAmt = kg * rate + freight;
      const commAmt = parseFloat(c.commissionAmount || "0");
      const commCc = c.commissionCurrencyCode || "USD";
      const dateVal = c.arrivalDate ? String(c.arrivalDate) : c.createdAt ? new Date(c.createdAt).toISOString().split("T")[0] : null;

      addRow(cc, {
        date: dateVal,
        type: "container",
        description: freight > 0
          ? `${c.containerNumber} - ${supplierName} (incl. freight ${cc !== "USD" ? cc + " " : "$"}${freight.toFixed(2)})`
          : `${c.containerNumber} - ${supplierName}`,
        ref: c.containerNumber,
        amount: mainAmt,
        commissionAmount: commAmt > 0 && commCc === cc ? commAmt : null,
        commissionCurrency: commAmt > 0 && commCc === cc ? commCc : null,
      });

      // Commission row in different currency section
      if (commAmt > 0 && commCc !== cc) {
        addRow(commCc, {
          date: dateVal,
          type: "commission",
          description: `Commission — ${c.containerNumber} - ${supplierName}`,
          ref: c.containerNumber,
          amount: commAmt,
          commissionAmount: null,
          commissionCurrency: commCc,
        });
      }
    }

    // Payment rows
    for (const p of allPayments as any[]) {
      const supplierName = supplierNameMap[p.supplierId] || "Unknown";
      const cc = p.currencyCode || "USD";
      addRow(cc, {
        date: p.date ? String(p.date) : null,
        type: "payment",
        description: `Payment — ${supplierName}`,
        ref: p.notes || "Payment",
        amount: -parseFloat(p.amount || "0"),
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // FX transfer rows — deduplicate by id to avoid counting same transfer twice
    const seenFxIds = new Set<number>();
    for (const t of allFx as any[]) {
      if (seenFxIds.has(t.id)) continue;
      seenFxIds.add(t.id);
      const fromCc = t.fromCurrencyCode || "USD";
      const fromAmt = parseFloat(t.fromAmount || "0");
      const toUsd = parseFloat(t.toAmountUsd || "0");
      const rate = fromAmt > 0 ? (toUsd / fromAmt).toFixed(4) : "1";
      const dateVal = t.date ? String(t.date) : null;

      // Source currency: FX Out (negative — reduces balance in that currency)
      addRow(fromCc, {
        date: dateVal,
        type: "fx_out",
        description: `FX ${fromCc}→USD @ ${rate}`,
        ref: `FX-${t.id}`,
        amount: -fromAmt,
        commissionAmount: null,
        commissionCurrency: null,
      });

      // USD: FX In (positive — adds to USD balance)
      addRow("USD", {
        date: dateVal,
        type: "fx_in",
        description: `FX In from ${fromCc} @ ${rate}`,
        ref: `FX-${t.id}`,
        amount: toUsd,
        commissionAmount: null,
        commissionCurrency: null,
      });
    }

    // Sort rows by date within each section
    for (const cc of Object.keys(ledgerByCurrency)) {
      ledgerByCurrency[cc].sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db2 = b.date ? new Date(b.date).getTime() : 0;
        return da - db2;
      });
    }

    // Build ledgers with running balance
    const fmtN = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const currencyLedgers = Object.entries(ledgerByCurrency).map(([cc, rows]) => {
      let runBal = 0;
      const rowsWithBal = rows.map((row) => {
        runBal += row.amount;
        if (row.commissionAmount) runBal += row.commissionAmount;
        return { ...row, runningBalance: runBal };
      });
      const containerRows = rows.filter(r => r.type === "container");
      const totalContainers = containerRows.length;
      const totalValue = containerRows.reduce((s, r) => s + r.amount, 0);
      const totalCommission = containerRows.reduce((s, r) => s + (r.commissionAmount || 0), 0)
        + rows.filter(r => r.type === "commission").reduce((s, r) => s + r.amount, 0);
      const totalPaid = Math.abs(rows.filter(r => r.type === "payment").reduce((s, r) => s + r.amount, 0));
      const totalFxOut = Math.abs(rows.filter(r => r.type === "fx_out").reduce((s, r) => s + r.amount, 0));
      const totalFxIn = rows.filter(r => r.type === "fx_in").reduce((s, r) => s + r.amount, 0);
      return {
        currencyCode: cc,
        rows: rowsWithBal,
        totalContainers,
        totalValue: totalValue.toFixed(2),
        totalCommission: totalCommission.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        totalFxOut: totalFxOut.toFixed(2),
        totalFxIn: totalFxIn.toFixed(2),
        netBalance: runBal.toFixed(2),
      };
    }).sort((a, b) => (a.currencyCode === "USD" ? 1 : b.currencyCode === "USD" ? -1 : a.currencyCode.localeCompare(b.currencyCode)));

    return { supplier: broker, linkedSuppliers: linkedRaw, currencyLedgers };
  }

  app.get("/api/factory/suppliers/:id/broker-statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseInt(req.params.id);
      const data = await buildBrokerStatement(brokerId, companyId);
      if (!data) return res.status(404).json({ message: "Supplier not found" });
      return res.json(data);
    } catch (err: any) {
      console.error("Broker statement error:", err);
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/factory/suppliers/:id/broker-statement/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const brokerId = parseInt(req.params.id);
      const data = await buildBrokerStatement(brokerId, companyId);
      if (!data) return res.status(404).json({ message: "Supplier not found" });

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "ERP System";
      wb.created = new Date();

      const typeLabel: Record<string, string> = {
        container: "Container", payment: "Payment",
        fx_out: "FX Out", fx_in: "FX In", commission: "Commission",
      };
      const rowTypeFill: Record<string, string> = {
        container: "FFFAFAFA", payment: "FFE8F5E9", fx_out: "FFFFF8E1", fx_in: "FFE3F2FD", commission: "FFFFF3E0",
      };

      for (const section of data.currencyLedgers) {
        const ws = wb.addWorksheet(section.currencyCode);
        ws.properties.defaultRowHeight = 15;

        // Title row
        const titleRow = ws.addRow([`Broker Statement — ${(data.supplier as any).name} — ${section.currencyCode}`]);
        titleRow.font = { bold: true, size: 13 };
        ws.mergeCells(`A${titleRow.number}:G${titleRow.number}`);
        ws.addRow([]);

        // Column headers
        const hdrRow = ws.addRow(["Date", "Type", "Description", "Amount", "Commission", "Comm. Currency", "Running Balance"]);
        hdrRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
        hdrRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        hdrRow.alignment = { horizontal: "left" };
        ["D", "E", "G"].forEach(col => {
          const cell = hdrRow.getCell(col);
          cell.alignment = { horizontal: "right" };
        });

        ws.columns = [
          { key: "date", width: 14 },
          { key: "type", width: 14 },
          { key: "description", width: 40 },
          { key: "amount", width: 18 },
          { key: "commission", width: 16 },
          { key: "commCcy", width: 14 },
          { key: "runBal", width: 18 },
        ];

        for (const row of section.rows) {
          const dr = ws.addRow([
            row.date || "",
            typeLabel[row.type] || row.type,
            row.description,
            parseFloat((row.amount as any).toFixed(2)),
            row.commissionAmount != null ? parseFloat((row.commissionAmount as any).toFixed(2)) : "",
            row.commissionCurrency || "",
            parseFloat((row.runningBalance as any).toFixed(2)),
          ]);
          dr.getCell("D").numFmt = "#,##0.00";
          dr.getCell("E").numFmt = "#,##0.00";
          dr.getCell("G").numFmt = "#,##0.00";
          dr.getCell("D").alignment = { horizontal: "right" };
          dr.getCell("E").alignment = { horizontal: "right" };
          dr.getCell("G").alignment = { horizontal: "right" };
          const fillArgb = rowTypeFill[row.type] || "FFFFFFFF";
          dr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        }

        // Spacer
        ws.addRow([]);

        // Totals
        const totalsLabel = ws.addRow(["SECTION TOTALS"]);
        totalsLabel.font = { bold: true };
        const totalsData = ws.addRow([
          "", "",
          `Containers: ${section.totalContainers}  |  Paid: ${section.totalPaid}  |  FX Out: ${section.totalFxOut}`,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          "",
          parseFloat(section.netBalance),
        ]);
        totalsData.font = { bold: true };
        totalsData.getCell("D").numFmt = "#,##0.00";
        totalsData.getCell("E").numFmt = "#,##0.00";
        totalsData.getCell("G").numFmt = "#,##0.00";
        ["D", "E", "G"].forEach(col => { totalsData.getCell(col).alignment = { horizontal: "right" }; });
        totalsData.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFD8DC" } };
      }

      // Summary sheet
      const sumWs = wb.addWorksheet("Summary");
      sumWs.addRow([`Broker Consolidated Statement — ${(data.supplier as any).name}`]).font = { bold: true, size: 13 };
      sumWs.addRow([`Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]).font = { italic: true };
      sumWs.addRow([]);
      const sumHdr = sumWs.addRow(["Currency", "Containers", "Gross Value", "Commission", "FX Out", "FX In", "Paid", "Net Balance"]);
      sumHdr.font = { bold: true, color: { argb: "FFFFFFFF" } };
      sumHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
      for (const section of data.currencyLedgers) {
        const dr = sumWs.addRow([
          section.currencyCode,
          section.totalContainers,
          parseFloat(section.totalValue),
          parseFloat(section.totalCommission),
          parseFloat(section.totalFxOut),
          parseFloat(section.totalFxIn),
          parseFloat(section.totalPaid),
          parseFloat(section.netBalance),
        ]);
        // Colour FX Out red, FX In green for clarity
        ["C", "D", "E", "F", "G", "H"].forEach(col => {
          dr.getCell(col).numFmt = "#,##0.00";
          dr.getCell(col).alignment = { horizontal: "right" };
        });
        const fxOutVal = parseFloat(section.totalFxOut);
        const fxInVal  = parseFloat(section.totalFxIn);
        if (fxOutVal > 0) {
          dr.getCell("E").font = { color: { argb: "FFCC0000" } };
        }
        if (fxInVal > 0) {
          dr.getCell("F").font = { color: { argb: "FF006600" } };
        }
        // Bold the Net Balance
        dr.getCell("H").font = { bold: true };
      }
      sumWs.columns = [
        { width: 12 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 18 }
      ];

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="broker-statement-${(data.supplier as any).name?.replace(/\s+/g, "-") || brokerId}-${new Date().toISOString().split("T")[0]}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err: any) {
      console.error("Broker statement export error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ───────────────────────────────────────────────
  // 2. Factory Categories CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryCategories)
        .where(eq(factoryCategories.companyId, companyId))
        .orderBy(factoryCategories.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory categories:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/categories", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryCategorySchema.parse({ ...req.body, companyId });
      const [category] = await db.insert(factoryCategories).values(parsed).returning();
      res.json(category);
    } catch (error: any) {
      console.error("Error creating factory category:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryCategories)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factoryCategories.id, id), eq(factoryCategories.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory category:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/categories/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryCategories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(factoryCategories.id, id), eq(factoryCategories.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory category:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 3. Factory Bale Products CRUD + Import
  // ───────────────────────────────────────────────

  app.get("/api/factory/bale-products", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryBaleProducts)
        .where(eq(factoryBaleProducts.companyId, companyId))
        .orderBy(factoryBaleProducts.name);

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory bale products:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-products/generate-code", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const grade = req.query.grade as string;
      const gradeToPrefix: Record<string, string> = {
        "CREAM": "HMD10",
        "#1": "HMD11",
        "#2": "HMD12",
        "#3": "HMD13",
        "#4": "HMD14",
        "Garbage": "HMD16",
      };

      if (!grade || !gradeToPrefix[grade]) {
        return res.status(400).json({ message: "Valid grade is required (CREAM, #1, #2, #3, #4, Garbage)" });
      }

      const prefix = gradeToPrefix[grade];
      const prefixLen = prefix.length;
      const [maxResult] = await db
        .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) AS INTEGER)), 0)` })
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          sql`${factoryBaleProducts.articleCode} LIKE ${prefix + '%'}`,
          sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) ~ '^[0-9]+$'`
        ));

      let nextNum = (maxResult?.maxNum || 0) + 1;
      let candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
      let attempts = 0;
      while (attempts < 100) {
        const candidateCodeClean = candidateCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
        const [dupArticle] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, candidateCode)));
        const [dupCode] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, candidateCodeClean)));
        if (!dupArticle && !dupCode) break;
        nextNum++;
        candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
        attempts++;
      }

      res.json({ articleCode: candidateCode });
    } catch (error: any) {
      console.error("Error generating article code:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [product] = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)));

      if (!product) return res.status(404).json({ message: "Product not found" });
      res.json(product);
    } catch (error: any) {
      console.error("Error fetching factory bale product:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-product-detail/:productId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const productId = parseInt(req.params.productId);
      if (!productId) return res.status(400).json({ message: "Invalid product ID" });

      const [product] = await db.select().from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));
      if (!product) return res.status(404).json({ message: "Product not found" });

      const articleCode = product.articleCode;

      // 1. Pressed/Printed: bales grouped by entry date
      const allBales = await db.select({
        createdAt: factoryBales.createdAt,
        pressedAt: factoryBales.pressedAt,
        weightKg: factoryBales.weightKg,
        totalCost: factoryBales.totalCost,
        status: factoryBales.status,
      }).from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          inArray(factoryBales.status, ['IN_STOCK', 'FINALIZED', 'SOLD', 'REMOVED'])
        ))
        .orderBy(factoryBales.createdAt);

      const pressedMap = new Map<string, { date: string; qty: number; totalWeight: number; totalCost: number }>();
      for (const bale of allBales) {
        const dateKey = ((bale.pressedAt || bale.createdAt) as Date).toISOString().split('T')[0];
        const existing = pressedMap.get(dateKey) || { date: dateKey, qty: 0, totalWeight: 0, totalCost: 0 };
        existing.qty += 1;
        existing.totalWeight += parseFloat(bale.weightKg as any) || 0;
        existing.totalCost += parseFloat(bale.totalCost as any) || 0;
        pressedMap.set(dateKey, existing);
      }
      const pressed = Array.from(pressedMap.values()).sort((a, b) => b.date.localeCompare(a.date));

      // 2. Sales: finalized orders for this article code
      const sales: any[] = [];
      // 3. Loaded/OTW: loading-status orders for this article code
      const loaded: any[] = [];

      if (articleCode) {
        const orderBalesForProduct = await db.select({
          orderId: customerOrderBales.orderId,
          weight: customerOrderBales.weight,
          priceUsed: customerOrderBales.priceUsed,
        }).from(customerOrderBales)
          .where(eq(customerOrderBales.articleCode, articleCode));

        if (orderBalesForProduct.length > 0) {
          const orderIds = [...new Set(orderBalesForProduct.map((b: any) => b.orderId))];

          const allRelevantOrders = await db.select({
            id: customerOrders.id,
            invoiceNumber: customerOrders.invoiceNumber,
            orderDate: customerOrders.orderDate,
            customerId: customerOrders.customerId,
            status: customerOrders.status,
            containerNumber: customerOrders.containerNumber,
          }).from(customerOrders)
            .where(and(
              eq(customerOrders.companyId, companyId),
              inArray(customerOrders.id, orderIds)
            ));

          for (const order of allRelevantOrders) {
            const balesInOrder = orderBalesForProduct.filter((b: any) => b.orderId === order.id);
            const qty = balesInOrder.length;
            const total = balesInOrder.reduce((s: number, b: any) => s + parseFloat(b.priceUsed || '0'), 0);
            const pricePerBale = qty > 0 ? total / qty : 0;

            const [customer] = await db.select({ name: customers.name }).from(customers)
              .where(eq(customers.id, order.customerId));

            const entry = {
              orderId: order.id,
              invoiceNumber: order.invoiceNumber || `Order #${order.id}`,
              orderDate: order.orderDate,
              containerNumber: order.containerNumber,
              customerName: customer?.name || 'Unknown',
              qty,
              pricePerBale: pricePerBale.toFixed(2),
              total: total.toFixed(2),
              status: order.status,
            };

            if (order.status === 'FINALIZED') {
              sales.push(entry);
            } else if (['LOADING', 'PENDING_VERIFICATION', 'VERIFIED'].includes(order.status)) {
              loaded.push(entry);
            }
          }

          sales.sort((a: any, b: any) => b.orderDate.localeCompare(a.orderDate));
          loaded.sort((a: any, b: any) => b.orderDate.localeCompare(a.orderDate));
        }
      }

      // Current stock: IN_STOCK + FINALIZED bales grouped by location
      const inStockBales = await db.select({
        id: factoryBales.id,
        weightKg: factoryBales.weightKg,
        erpLocationId: factoryBales.erpLocationId,
      }).from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          inArray(factoryBales.status, ['IN_STOCK', 'FINALIZED'])
        ));

      const locStockMap = new Map<number, { locationId: number; locationName: string; qty: number; totalWeight: number }>();
      for (const bale of inStockBales) {
        const locId = bale.erpLocationId ?? 0;
        const existing = locStockMap.get(locId) ?? { locationId: locId, locationName: 'Unknown', qty: 0, totalWeight: 0 };
        existing.qty += 1;
        existing.totalWeight += parseFloat(bale.weightKg as any) || 0;
        locStockMap.set(locId, existing);
      }
      const locIds = [...locStockMap.keys()].filter(id => id > 0);
      if (locIds.length > 0) {
        const locRecords = await db.select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, locIds));
        for (const loc of locRecords) {
          const entry = locStockMap.get(loc.id);
          if (entry) entry.locationName = loc.name;
        }
      }
      const currentStock = {
        totalQty: inStockBales.length,
        totalWeight: inStockBales.reduce((s, b) => s + (parseFloat(b.weightKg as any) || 0), 0),
        locations: Array.from(locStockMap.values()).sort((a, b) => b.qty - a.qty),
      };

      return res.json({ product, pressed, sales, loaded, currentStock });
    } catch (error: any) {
      console.error("Error fetching bale product detail:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      let code = req.body.code;
      let articleCode = req.body.articleCode;
      const grade = req.body.grade;

      const gradeToPrefix: Record<string, string> = {
        "CREAM": "HMD10",
        "#1": "HMD11",
        "#2": "HMD12",
        "#3": "HMD13",
        "#4": "HMD14",
        "Garbage": "HMD16",
      };

      if (!articleCode && grade && gradeToPrefix[grade]) {
        const prefix = gradeToPrefix[grade];
        const prefixLen = prefix.length;
        const [maxResult] = await db
          .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) AS INTEGER)), 0)` })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            sql`${factoryBaleProducts.articleCode} LIKE ${prefix + '%'}`,
            sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) ~ '^[0-9]+$'`
          ));
        let nextNum = (maxResult?.maxNum || 0) + 1;
        let candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
        let attempts = 0;
        while (attempts < 100) {
          const candidateCodeClean = candidateCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
          const [dupArticle] = await db
            .select({ id: factoryBaleProducts.id })
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, candidateCode)));
          const [dupCode] = await db
            .select({ id: factoryBaleProducts.id })
            .from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, candidateCodeClean)));
          if (!dupArticle && !dupCode) break;
          nextNum++;
          candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
          attempts++;
        }
        articleCode = candidateCode;
      } else if (!articleCode) {
        const noGradePrefix = "HMD00";
        const noGradePrefixLen = noGradePrefix.length;
        const [noGradeMax] = await db
          .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${noGradePrefixLen + 1}) AS INTEGER)), 0)` })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            sql`${factoryBaleProducts.articleCode} LIKE ${noGradePrefix + '%'}`,
            sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${noGradePrefixLen + 1}) ~ '^[0-9]+$'`
          ));
        let noGradeNext = (noGradeMax?.maxNum || 0) + 1;
        articleCode = `${noGradePrefix}${String(noGradeNext).padStart(3, "0")}`;
        let noGradeAttempts = 0;
        while (noGradeAttempts < 100) {
          const [dupCheck] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
            .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));
          if (!dupCheck) break;
          noGradeNext++;
          articleCode = `${noGradePrefix}${String(noGradeNext).padStart(3, "0")}`;
          noGradeAttempts++;
        }
      }

      if (articleCode) {
        // Helper: check both articleCode AND code uniqueness within the company
        const codeClean = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
        const [existingArticle] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));
        const [existingCode] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, codeClean)));

        if (existingArticle || existingCode) {
          // Either articleCode or code is already taken — try to regenerate from the grade prefix
          const knownPrefixes = ["HMD10", "HMD11", "HMD12", "HMD13", "HMD14", "HMD16"];
          const matchedPrefix = knownPrefixes.find(p => articleCode.startsWith(p) && /^\d+$/.test(articleCode.slice(p.length)));
          if (matchedPrefix) {
            const prefix = matchedPrefix;
            const prefixLen = prefix.length;
            const [maxResult] = await db
              .select({ maxNum: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) AS INTEGER)), 0)` })
              .from(factoryBaleProducts)
              .where(and(
                eq(factoryBaleProducts.companyId, companyId),
                sql`${factoryBaleProducts.articleCode} LIKE ${prefix + '%'}`,
                sql`SUBSTRING(${factoryBaleProducts.articleCode} FROM ${prefixLen + 1}) ~ '^[0-9]+$'`
              ));
            let nextNum = (maxResult?.maxNum || 0) + 1;
            let candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
            let attempts = 0;
            while (attempts < 200) {
              const candidateCodeClean = candidateCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
              const [dupA] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, candidateCode)));
              const [dupC] = await db.select({ id: factoryBaleProducts.id }).from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, candidateCodeClean)));
              if (!dupA && !dupC) break;
              nextNum++;
              candidateCode = `${prefix}${String(nextNum).padStart(3, "0")}`;
              attempts++;
            }
            articleCode = candidateCode;
            code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
          } else {
            return res.status(400).json({ message: "A product with this article code already exists" });
          }
        } else {
          // Both are free — use the cleaned code
          code = codeClean;
        }
      }

      // Try insert; if code/articleCode constraint fires (race condition),
      // keep incrementing the numeric suffix until we find a free slot.
      let product: any;
      const knownPrefixesRetry = ["HMD10", "HMD11", "HMD12", "HMD13", "HMD14", "HMD16", "HMD00"];
      const retryPrefix = knownPrefixesRetry.find(p => articleCode.startsWith(p) && /^\d+$/.test(articleCode.slice(p.length)));
      let retryAttempts = 0;
      while (true) {
        try {
          const parsed = insertFactoryBaleProductSchema.parse({ ...req.body, companyId, code, articleCode });
          [product] = await db.insert(factoryBaleProducts).values(parsed).returning();
          break;
        } catch (insertErr: any) {
          const msg: string = insertErr?.message || "";
          const isCodeDup = msg.includes("unique") && (msg.includes("company_code") || msg.includes("article_code") || msg.includes("_code"));
          if (!isCodeDup || !retryPrefix || retryAttempts >= 100) throw insertErr;
          retryAttempts++;
          const currentNum = parseInt(articleCode.slice(retryPrefix.length)) || 0;
          const nextCandidate = `${retryPrefix}${String(currentNum + 1).padStart(3, "0")}`;
          articleCode = nextCandidate;
          code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);
        }
      }
      res.json(product);
    } catch (error: any) {
      console.error("Error creating factory bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryBaleProducts)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Product not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/:id/cascade-update", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const { name, weightPerBaleKg, articleCode, description, categoryId, productionPrice, sellingPrice } = req.body;

      const [existing] = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)));

      if (!existing) return res.status(404).json({ message: "Product not found" });

      // If article code is being changed, verify it isn't already taken by another product
      if (articleCode !== undefined && articleCode !== existing.articleCode) {
        const [conflict] = await db
          .select({ id: factoryBaleProducts.id })
          .from(factoryBaleProducts)
          .where(and(
            eq(factoryBaleProducts.companyId, companyId),
            eq(factoryBaleProducts.articleCode, articleCode),
            sql`${factoryBaleProducts.id} != ${id}`
          ));
        if (conflict) {
          return res.status(400).json({ message: `Article code "${articleCode}" is already used by another product` });
        }
      }

      const productUpdate: any = { updatedAt: new Date() };
      if (name !== undefined) productUpdate.name = name;
      if (weightPerBaleKg !== undefined) productUpdate.weightPerBaleKg = weightPerBaleKg;
      if (articleCode !== undefined) productUpdate.articleCode = articleCode;
      if (description !== undefined) productUpdate.description = description;
      if (categoryId !== undefined) productUpdate.categoryId = categoryId;
      if (productionPrice !== undefined && productionPrice !== "") productUpdate.productionPrice = String(parseFloat(productionPrice) || 0);
      if (sellingPrice !== undefined && sellingPrice !== "") productUpdate.sellingPrice = String(parseFloat(sellingPrice) || 0);

      const [updatedProduct] = await db
        .update(factoryBaleProducts)
        .set(productUpdate)
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      const baleUpdate: any = {};
      if (name !== undefined && name !== existing.name) baleUpdate.productName = name;
      if (weightPerBaleKg !== undefined && weightPerBaleKg !== existing.weightPerBaleKg) baleUpdate.weightKg = weightPerBaleKg;
      if (articleCode !== undefined && articleCode !== existing.articleCode) baleUpdate.articleCode = articleCode;

      let balesUpdated = 0;
      if (Object.keys(baleUpdate).length > 0) {
        baleUpdate.updatedAt = new Date();
        const result = await db
          .update(factoryBales)
          .set(baleUpdate)
          .where(and(eq(factoryBales.productId, id), eq(factoryBales.companyId, companyId)));
        balesUpdated = result.rowCount ?? 0;
      }

      res.json({ product: updatedProduct, balesUpdated });
    } catch (error: any) {
      console.error("Error cascade updating bale product:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-product-history/:productId/:locationId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const productId = parseInt(req.params.productId);
      const locationId = parseInt(req.params.locationId);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();

      const [product] = await db
        .select({
          id: factoryBaleProducts.id,
          name: factoryBaleProducts.name,
          articleCode: factoryBaleProducts.articleCode,
          weightPerBaleKg: factoryBaleProducts.weightPerBaleKg,
        })
        .from(factoryBaleProducts)
        .where(and(eq(factoryBaleProducts.id, productId), eq(factoryBaleProducts.companyId, companyId)));

      if (!product) return res.status(404).json({ message: "Product not found" });

      const [location] = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)));

      if (!location) return res.status(404).json({ message: "Location not found" });

      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);

      const rows = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${factoryBales.createdAt})`.as("month"),
          baleCount: sql<number>`COUNT(*)::int`.as("bale_count"),
          totalWeight: sql<number>`COALESCE(SUM(${factoryBales.weightKg}::numeric), 0)`.as("total_weight"),
          totalCost: sql<number>`COALESCE(SUM(${factoryBales.totalCost}::numeric), 0)`.as("total_cost"),
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          eq(factoryBales.erpLocationId, locationId),
          sql`${factoryBales.createdAt} >= ${startDate}`,
          sql`${factoryBales.createdAt} < ${endDate}`,
        ))
        .groupBy(sql`EXTRACT(MONTH FROM ${factoryBales.createdAt})`)
        .orderBy(sql`EXTRACT(MONTH FROM ${factoryBales.createdAt})`);

      const monthlyData = rows.map((r: any) => ({
        month: Number(r.month),
        monthName: monthNames[Number(r.month) - 1],
        baleCount: Number(r.baleCount),
        totalWeight: Number(r.totalWeight),
        totalCost: Number(r.totalCost),
      }));

      const grandTotal = monthlyData.reduce(
        (acc: { baleCount: number; totalWeight: number; totalCost: number }, m: { baleCount: number; totalWeight: number; totalCost: number }) => ({
          baleCount: acc.baleCount + m.baleCount,
          totalWeight: acc.totalWeight + m.totalWeight,
          totalCost: acc.totalCost + m.totalCost,
        }),
        { baleCount: 0, totalWeight: 0, totalCost: 0 }
      );

      res.json({ product, location, year, monthlyData, grandTotal });
    } catch (error: any) {
      console.error("Error fetching bale product history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bale-product-history/:productId/:locationId/:year/:month", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const productId = parseInt(req.params.productId);
      const locationId = parseInt(req.params.locationId);
      const year = parseInt(req.params.year);
      const month = parseInt(req.params.month);

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);

      const bales = await db
        .select({
          id: factoryBales.id,
          baleCode: factoryBales.baleCode,
          referenceNumber: factoryBales.referenceNumber,
          weightKg: factoryBales.weightKg,
          costPerKg: factoryBales.costPerKg,
          totalCost: factoryBales.totalCost,
          status: factoryBales.status,
          createdAt: factoryBales.createdAt,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.productId, productId),
          eq(factoryBales.erpLocationId, locationId),
          sql`${factoryBales.createdAt} >= ${startDate}`,
          sql`${factoryBales.createdAt} < ${endDate}`,
        ))
        .orderBy(desc(factoryBales.createdAt));

      res.json({ bales });
    } catch (error: any) {
      console.error("Error fetching monthly bale details:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/bale-products/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [updated] = await db
        .update(factoryBaleProducts)
        .set({ active: false, updatedAt: new Date() })
        .where(and(eq(factoryBaleProducts.id, id), eq(factoryBaleProducts.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Product not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error deleting factory bale product:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/bulk-rename-preview", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { codePrefix, find, replace } = req.body;
      if (!codePrefix || find === undefined || find === "" || replace === undefined) {
        return res.status(400).json({ message: "codePrefix, find (non-empty), and replace are required" });
      }

      const products = await db
        .select()
        .from(factoryBaleProducts)
        .where(and(
          eq(factoryBaleProducts.companyId, companyId),
          or(
            ilike(factoryBaleProducts.code, `${codePrefix}%`),
            ilike(factoryBaleProducts.articleCode, `${codePrefix}%`)
          )
        ))
        .orderBy(factoryBaleProducts.name);

      const matches = products
        .filter((p) => p.name.includes(find))
        .map((p) => ({
          id: p.id,
          code: p.articleCode,
          currentName: p.name,
          newName: p.name.replaceAll(find, replace),
        }));

      res.json({ total: products.length, matches });
    } catch (error: any) {
      console.error("Error previewing bulk rename:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/bulk-rename-apply", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "No items to rename" });
      }

      let updated = 0;
      for (const item of items) {
        const [result] = await db
          .update(factoryBaleProducts)
          .set({ name: item.newName, updatedAt: new Date() })
          .where(and(eq(factoryBaleProducts.id, item.id), eq(factoryBaleProducts.companyId, companyId)))
          .returning();
        if (result) updated++;
      }

      res.json({ updated });
    } catch (error: any) {
      console.error("Error applying bulk rename:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bale-products/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const { read: readExcel, utils: { sheet_to_json: sheetToJson } } = await import("xlsx");
          const workbook = readExcel(req.file.buffer, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = sheetToJson(workbook.Sheets[sheetName]);

          let created = 0;
          let updated = 0;
          let categoriesCreated = 0;
          let pricesUpdated = 0;
          let skippedNoArticleCode = 0;

          // Detect column names from the first row for feedback
          const firstRow = rows[0] || {};
          const detectedArticleCodeCol = Object.keys(firstRow).find(k => ["articlecode", "article_code", "article code", "barcode"].includes(k.toLowerCase())) || null;
          const detectedProductionPriceCol = Object.keys(firstRow).find(k => ["production price", "productionprice", "production_price", "cost price", "costprice", "cost_price"].includes(k.toLowerCase())) || null;
          const detectedSellingPriceCol = Object.keys(firstRow).find(k => ["selling price", "sellingprice", "selling_price"].includes(k.toLowerCase())) || null;

          const categoryCache = new Map<string, number>();
          const existingCategories = await db
            .select()
            .from(factoryCategories)
            .where(eq(factoryCategories.companyId, companyId));
          for (const cat of existingCategories) {
            categoryCache.set(cat.name.toLowerCase(), cat.id);
          }

          for (const row of rows) {
            const articleCode = String(row.articleCode || row.article_code || row.ArticleCode || row["Article Code"] || "").trim();
            if (!articleCode) { skippedNoArticleCode++; continue; }

            const name = String(row.name || row.Name || row.productName || row["Product Name"] || articleCode).trim();
            const description = String(row.description || row.Description || "").trim() || null;
            const weightPerBaleKg = row.weightPerBaleKg || row.weight_per_bale_kg || row.WeightPerBaleKg || row["Weight Per Bale"] || row.weight || null;
            const categoryName = String(row.category || row.Category || row.categoryName || "").trim();

            const rawSellingPrice = row["selling price"] ?? row["sellingPrice"] ?? row["selling_price"] ?? row["Selling Price"] ?? row["SELLING PRICE"] ?? null;
            const sellingPrice = rawSellingPrice !== null && rawSellingPrice !== "" ? String(parseFloat(String(rawSellingPrice)) || 0) : null;

            const rawProductionPrice = row["production price"] ?? row["productionPrice"] ?? row["production_price"] ?? row["Production Price"] ?? row["PRODUCTION PRICE"] ?? row["cost price"] ?? row["costPrice"] ?? row["cost_price"] ?? row["Cost Price"] ?? null;
            const productionPrice = rawProductionPrice !== null && rawProductionPrice !== "" ? String(parseFloat(String(rawProductionPrice)) || 0) : null;

            let categoryId: number | null = null;
            if (categoryName) {
              const cachedId = categoryCache.get(categoryName.toLowerCase());
              if (cachedId) {
                categoryId = cachedId;
              } else {
                const [newCat] = await db
                  .insert(factoryCategories)
                  .values({ companyId, name: categoryName })
                  .returning();
                categoryId = newCat.id;
                categoryCache.set(categoryName.toLowerCase(), newCat.id);
                categoriesCreated++;
              }
            }

            const code = articleCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 50);

            let [existing] = await db
              .select()
              .from(factoryBaleProducts)
              .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.articleCode, articleCode)));

            if (!existing) {
              [existing] = await db
                .select()
                .from(factoryBaleProducts)
                .where(and(eq(factoryBaleProducts.companyId, companyId), eq(factoryBaleProducts.code, code)));
            }

            const hasPriceData = (productionPrice !== null && parseFloat(productionPrice) > 0) || (sellingPrice !== null && parseFloat(sellingPrice) > 0);

            if (existing) {
              await db
                .update(factoryBaleProducts)
                .set({
                  name,
                  description,
                  weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : existing.weightPerBaleKg,
                  categoryId: categoryId || existing.categoryId,
                  ...(sellingPrice !== null ? { sellingPrice } : {}),
                  ...(productionPrice !== null ? { productionPrice } : {}),
                  updatedAt: new Date(),
                })
                .where(eq(factoryBaleProducts.id, existing.id));
              await db
                .update(factoryBales)
                .set({ productName: name, updatedAt: new Date() })
                .where(eq(factoryBales.productId, existing.id));
              updated++;
              if (hasPriceData) pricesUpdated++;
            } else {
              await db.insert(factoryBaleProducts).values({
                companyId,
                code,
                articleCode,
                name,
                description,
                weightPerBaleKg: weightPerBaleKg ? String(weightPerBaleKg) : null,
                categoryId,
                ...(sellingPrice !== null ? { sellingPrice } : {}),
                ...(productionPrice !== null ? { productionPrice } : {}),
              });
              created++;
              if (hasPriceData) pricesUpdated++;
            }
          }

          res.json({
            created,
            updated,
            categoriesCreated,
            pricesUpdated,
            skippedNoArticleCode,
            detectedColumns: {
              articleCode: detectedArticleCodeCol,
              productionPrice: detectedProductionPriceCol,
              sellingPrice: detectedSellingPriceCol,
            },
          });
        } catch (innerError: any) {
          console.error("Error processing Excel import:", innerError);
          res.status(500).json({ message: innerError.message });
        }
      });
    } catch (error: any) {
      console.error("Error in Excel import:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/validate-import", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const XLSX = await import("xlsx");
          const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

          const getVal = (row: any, ...keys: string[]): any => {
            const rowKeys = Object.keys(row);
            for (const k of keys) {
              const found = rowKeys.find(rk => rk.trim().toLowerCase() === k.toLowerCase());
              if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") return row[found];
            }
            return undefined;
          };

          const allProducts = await db
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          const productByArticle = new Map<string, any>();
          for (const p of allProducts) {
            if (p.articleCode) productByArticle.set(p.articleCode.trim().toUpperCase(), p);
          }

          const validRows: { rowIndex: number; articleCode: string; productName: string; productId: number; quantity: number; weight: number; productionDate: string }[] = [];
          const skippedRows: { rowIndex: number; articleCode: string; reason: string }[] = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawCode = getVal(row, "ITEM BARCODE", "Item Barcode", "itemBarcode", "articleCode", "article_code", "ArticleCode", "Article Code", "barcode", "Barcode", "ITEM NAME", "Item Name");
            const articleCode = rawCode ? String(rawCode).trim().toUpperCase() : "";
            if (!articleCode) { skippedRows.push({ rowIndex: i + 2, articleCode: "", reason: "Empty article code" }); continue; }

            const product = productByArticle.get(articleCode);
            if (!product) {
              skippedRows.push({ rowIndex: i + 2, articleCode, reason: "Article code not found in products" });
              continue;
            }

            const rawQty = parseInt(String(getVal(row, "QUANTITY", "Quantity", "quantity", "qty", "Qty") ?? "1"));
            if (isNaN(rawQty) || rawQty <= 0) {
              skippedRows.push({ rowIndex: i + 2, articleCode, reason: "Invalid quantity (must be > 0)" });
              continue;
            }
            const weight = parseFloat(String(product.weightPerBaleKg || "25"));

            let prodDate: Date | null = null;
            const rawDate = getVal(row, "PRODUCTION DATE", "Production Date", "productionDate", "production_date", "date", "Date");
            if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
              prodDate = rawDate;
            } else if (rawDate) {
              const dateStr = String(rawDate).trim();
              const parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) {
                prodDate = parsed;
              }
            }
            if (!prodDate) {
              skippedRows.push({ rowIndex: i + 2, articleCode, reason: "No valid production date" });
              continue;
            }

            validRows.push({
              rowIndex: i + 2,
              articleCode,
              productName: product.name,
              productId: product.id,
              quantity: rawQty,
              weight,
              productionDate: prodDate.toISOString().split("T")[0],
            });
          }

          const totalBales = validRows.reduce((sum, r) => sum + r.quantity, 0);
          const totalWeight = validRows.reduce((sum, r) => sum + r.quantity * r.weight, 0);

          return res.json({
            totalRows: rows.length,
            validRows,
            skippedRows,
            totalBales,
            totalWeight,
            totalProducts: allProducts.length,
          });
        } catch (innerErr: any) {
          console.error("Validate import error:", innerErr);
          return res.status(500).json({ message: innerErr.message || "Validation failed" });
        }
      });
    } catch (outerErr: any) {
      console.error("Validate import outer error:", outerErr);
      res.status(500).json({ message: outerErr.message || "Validation failed" });
    }
  });

  app.post("/api/factory/bales/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage() });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });

          const companyId = (req.session as any).currentCompanyId;
          if (!companyId) return res.status(400).json({ message: "No company selected" });

          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const locationId = req.body.locationId ? parseInt(req.body.locationId) : null;

          const XLSX = await import("xlsx");
          const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
          const sheetName = workbook.SheetNames[0];
          const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

          const getVal = (row: any, ...keys: string[]): any => {
            const rowKeys = Object.keys(row);
            for (const k of keys) {
              const found = rowKeys.find(rk => rk.trim().toLowerCase() === k.toLowerCase());
              if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") return row[found];
            }
            return undefined;
          };

          const allProducts = await db
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          const productByArticle = new Map<string, any>();
          for (const p of allProducts) {
            if (p.articleCode) productByArticle.set(p.articleCode.trim().toUpperCase(), p);
          }

          let totalBalesCreated = 0;
          let skippedRows = 0;
          const skippedDetails: string[] = [];

          const rowGroups: { product: any; qty: number; weight: number; prodDate: Date }[] = [];
          let totalBalesNeeded = 0;

          console.log("Bale import: processing", rows.length, "rows. First row keys:", rows.length > 0 ? Object.keys(rows[0]) : "none");

          for (const row of rows) {
            const rawCode = getVal(row, "ITEM BARCODE", "Item Barcode", "itemBarcode", "articleCode", "article_code", "ArticleCode", "Article Code", "barcode", "Barcode");
            const articleCode = rawCode ? String(rawCode).trim().toUpperCase() : "";
            if (!articleCode) { skippedRows++; skippedDetails.push("Row with empty article code"); continue; }

            const product = productByArticle.get(articleCode);
            if (!product) {
              skippedRows++;
              skippedDetails.push(`Article code "${articleCode}" not found in products`);
              continue;
            }

            const rawQty = parseInt(String(getVal(row, "QUANTITY", "Quantity", "quantity", "qty", "Qty") ?? "1"));
            if (isNaN(rawQty) || rawQty <= 0) {
              skippedRows++;
              skippedDetails.push(`Article "${articleCode}" has invalid quantity`);
              continue;
            }
            const qty = rawQty;
            const weight = parseFloat(String(product.weightPerBaleKg || "25"));

            let prodDate: Date | null = null;
            const rawDate = getVal(row, "PRODUCTION DATE", "Production Date", "productionDate", "production_date", "date", "Date");
            if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
              prodDate = rawDate;
            } else if (rawDate) {
              const dateStr = String(rawDate).trim();
              const parsed = new Date(dateStr);
              if (!isNaN(parsed.getTime())) {
                prodDate = parsed;
              }
            }
            if (!prodDate) {
              skippedRows++;
              skippedDetails.push(`Article "${articleCode}" has no valid production date`);
              continue;
            }

            rowGroups.push({ product, qty, weight, prodDate });
            totalBalesNeeded += qty;
          }

          if (rowGroups.length === 0) {
            return res.json({ totalBalesCreated: 0, skippedRows, skippedDetails: skippedDetails.slice(0, 20) });
          }

          await db.transaction(async (tx) => {
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
                .set({ nextNumber: nextNumber + totalBalesNeeded })
                .where(eq(factoryBaleSequences.id, seqRecord.id));
            } else {
              nextNumber = 100876;
              await tx.insert(factoryBaleSequences).values({
                companyId,
                nextNumber: 100876 + totalBalesNeeded,
              });
            }

            let baleIndex = 0;
            for (const group of rowGroups) {
              for (let i = 0; i < group.qty; i++) {
                const refNum = `REF${String(nextNumber + baleIndex).padStart(5, '0')}`;
                await tx
                  .insert(factoryBales)
                  .values({
                    companyId,
                    mixBatchId: null,
                    productId: group.product.id,
                    erpLocationId: locationId,
                    baleCode: group.product.code,
                    referenceNumber: refNum,
                    articleCode: group.product.articleCode,
                    productName: group.product.name,
                    weightKg: String(group.weight),
                    costPerKg: "0",
                    totalCost: "0",
                    status: "IN_STOCK",
                    finalizedAt: group.prodDate,
                    createdAt: group.prodDate,
                  });
                baleIndex++;
              }
              totalBalesCreated += group.qty;
            }
          });

          if (totalBalesCreated > 0) {
            const excelImportToday = new Date().toISOString().split("T")[0];
            await writeDaybookEntry(db, {
              companyId,
              txDate: excelImportToday,
              txType: "BALE_IMPORT",
              description: `Bale Excel import: ${totalBalesCreated} bale${totalBalesCreated !== 1 ? "s" : ""} created${skippedRows > 0 ? ` (${skippedRows} rows skipped)` : ""}`,
            });
          }
          res.json({ totalBalesCreated, skippedRows, skippedDetails: skippedDetails.slice(0, 20) });
        } catch (innerError: any) {
          console.error("Error processing bale Excel import:", innerError);
          res.status(500).json({ message: innerError.message });
        }
      });
    } catch (error: any) {
      console.error("Error in bale Excel import:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 4. Factory Containers CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryContainers.id,
          companyId: factoryContainers.companyId,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          origin: factoryContainers.origin,
          totalKg: factoryContainers.totalKg,
          ratePerKg: factoryContainers.ratePerKg,
          currencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          fxRateToUsdImport: factoryContainers.fxRateToUsdImport,
          fxRateToUsdOffload: factoryContainers.fxRateToUsdOffload,
          fxRateSource: factoryContainers.fxRateSource,
          fxRateDateImport: factoryContainers.fxRateDateImport,
          fxRateDateOffload: factoryContainers.fxRateDateOffload,
          ratePerKgUsd: factoryContainers.ratePerKgUsd,
          finalPayableAmountUsd: factoryContainers.finalPayableAmountUsd,
          declaredKg: factoryContainers.declaredKg,
          actualReceivedKg: factoryContainers.actualReceivedKg,
          finalPayableAmount: factoryContainers.finalPayableAmount,
          differenceKg: factoryContainers.differenceKg,
          arrivalDate: factoryContainers.arrivalDate,
          notes: factoryContainers.notes,
          status: factoryContainers.status,
          freight: factoryContainers.freight,
          freightCurrencyCode: factoryContainers.freightCurrencyCode,
          freightAccountId: factoryContainers.freightAccountId,
          otherCharges: factoryContainers.otherCharges,
          otherChargesAccountId: factoryContainers.otherChargesAccountId,
          commissionAmount: factoryContainers.commissionAmount,
          commissionCurrencyCode: factoryContainers.commissionCurrencyCode,
          commissionAccountId: factoryContainers.commissionAccountId,
          commissionSupplierId: factoryContainers.commissionSupplierId,
          commissionNotes: factoryContainers.commissionNotes,
          createdAt: factoryContainers.createdAt,
          updatedAt: factoryContainers.updatedAt,
          supplierName: factorySuppliers.name,
          additionalChargesSum: sql<string>`COALESCE((
            SELECT SUM(
              CASE
                WHEN COALESCE(foac.currency_code, 'USD') = COALESCE(${factoryContainers.currencyCode}, 'USD')
                  THEN foac.amount::numeric
                WHEN COALESCE(foac.currency_code, 'USD') = 'USD'
                  THEN foac.amount::numeric / NULLIF(COALESCE(${factoryContainers.fxRateToUsd}, '1')::numeric, 0)
                ELSE foac.amount::numeric * COALESCE(foac.fx_rate_to_usd, '1')::numeric
                     / NULLIF(COALESCE(${factoryContainers.fxRateToUsd}, '1')::numeric, 0)
              END
            )
            FROM factory_offload_additional_charges foac
            WHERE foac.container_id = ${factoryContainers.id}
            AND foac.company_id = ${factoryContainers.companyId}
          ), 0)`,
          preRegisteredChargesSum: sql<string>`COALESCE((
            SELECT SUM(fcoc.amount::numeric)
            FROM factory_container_other_charges fcoc
            WHERE fcoc.container_id = ${factoryContainers.id}
            AND fcoc.company_id = ${factoryContainers.companyId}
          ), 0)`,
          preRegisteredChargesCount: sql<number>`COALESCE((
            SELECT COUNT(*)
            FROM factory_container_other_charges fcoc
            WHERE fcoc.container_id = ${factoryContainers.id}
            AND fcoc.company_id = ${factoryContainers.companyId}
          ), 0)`,
        })
        .from(factoryContainers)
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(eq(factoryContainers.companyId, companyId))
        .orderBy(desc(factoryContainers.createdAt));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertFactoryContainerSchema.parse({ ...req.body, companyId });
      const currencyCode = parsed.currencyCode || "USD";
      const fxRateSource = parsed.fxRateSource || "auto";
      const today = new Date().toISOString().split("T")[0];
      const importDate = parsed.arrivalDate || today;

      let fxRate: string;
      if (fxRateSource === "manual" && parsed.fxRateToUsd) {
        fxRate = parsed.fxRateToUsd;
      } else {
        fxRate = await getOrFetchFxRateToUsd(companyId, currencyCode, importDate);
      }

      const ratePerKg = parseFloat(parsed.ratePerKg || "0");
      const fxRateNum = parseFloat(fxRate);
      const ratePerKgUsd = currencyCode === "USD" ? ratePerKg : ratePerKg * fxRateNum;

      const values: any = {
        ...parsed,
        currencyCode,
        fxRateToUsd: fxRate,
        fxRateToUsdImport: fxRate,
        fxRateSource: fxRateSource === "manual" ? "manual" : "auto",
        fxRateDateImport: importDate,
        ratePerKgUsd: String(ratePerKgUsd),
      };

      // Auto-set commissionSupplierId to broker (parentId) if supplier has one and not already set
      if (parsed.supplierId && !parsed.commissionSupplierId) {
        const [sup] = await db
          .select({ parentId: factorySuppliers.parentId })
          .from(factorySuppliers)
          .where(eq(factorySuppliers.id, parsed.supplierId));
        if (sup?.parentId) values.commissionSupplierId = sup.parentId;
      }

      // Auto-create commission ledger account for the broker if commission amount > 0
      const commissionAmt = parseFloat(values.commissionAmount || "0");
      if (!values.commissionAccountId && values.commissionSupplierId) {
        const [broker] = await db
          .select({ id: factorySuppliers.id, name: factorySuppliers.name })
          .from(factorySuppliers)
          .where(eq(factorySuppliers.id, values.commissionSupplierId));
        if (broker) {
          const safeCode = `COMM_SUP_${broker.id}`;
          values.commissionAccountId = await getOrCreateLedgerAccount(
            companyId,
            safeCode,
            `Commission Payable - ${broker.name}`,
            "LIABILITY"
          );
        }
      }

      // Auto-create freight ledger account if freight > 0 and no account selected
      if (!values.freightAccountId && parseFloat(values.freight || "0") > 0) {
        values.freightAccountId = await getOrCreateLedgerAccount(companyId, "FREIGHT", "Freight");
      }

      const [container] = await db.insert(factoryContainers).values(values).returning();

      await writeDaybookEntry(db, {
        companyId,
        txDate: container.arrivalDate || today,
        txType: "CONTAINER_IMPORT",
        referenceId: container.id,
        description: `Container imported: ${container.containerNumber}`,
        currencyCode: container.currencyCode || "USD",
        amountCurrency: parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0"),
        fxRateToUsd: parseFloat(container.fxRateToUsd || "1"),
      });

      // Double-entry: Goods value — Dr Factory Import Cost / Cr Supplier Payable
      const goodsValue = parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0");
      if (goodsValue > 0 && container.supplierId) {
        const importCostAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_IMPORT_COST", "Factory Import Cost");
        const importVoucherNum = `FACTORY-IMPORT-${container.id}-${Date.now()}`;
        const [importVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: importVoucherNum,
          voucherDate: container.arrivalDate || today,
          description: `Goods import - container ${container.containerNumber}`,
          totalAmount: String(goodsValue),
          currency: container.currencyCode || "USD",
          exchangeRate: String(parseFloat(container.fxRateToUsd || "1")),
          sourceModule: "FACTORY",
        }).returning();
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          ledgerAccountId: importCostAccId,
          debitAmount: String(goodsValue),
          creditAmount: "0",
          narration: `Goods import cost - container ${container.containerNumber}`,
        });
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          factorySupplierId: container.supplierId,
          debitAmount: "0",
          creditAmount: String(goodsValue),
          narration: `Goods payable to supplier - container ${container.containerNumber}`,
        });
      }

      // Double-entry: Commission (Dr Commission Expense / Cr Broker Payable)
      if (commissionAmt > 0 && container.commissionAccountId && container.commissionSupplierId) {
        const commFx = parseFloat(container.fxRateToUsd || "1");
        const commVoucherNum = `FACTORY-COMM-${container.id}-${Date.now()}`;
        const [commVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: commVoucherNum,
          voucherDate: container.arrivalDate || today,
          description: `Commission on container ${container.containerNumber}`,
          totalAmount: String(commissionAmt),
          currency: container.commissionCurrencyCode || "USD",
          exchangeRate: String(commFx),
          sourceModule: "FACTORY",
        }).returning();
        // Dr Commission Expense account
        await db.insert(voucherEntries).values({
          voucherId: commVoucher.id,
          ledgerAccountId: container.commissionAccountId,
          debitAmount: String(commissionAmt),
          creditAmount: "0",
          narration: `Commission expense - container ${container.containerNumber}`,
        });
        // Cr Broker (factory supplier payable)
        await db.insert(voucherEntries).values({
          voucherId: commVoucher.id,
          factorySupplierId: container.commissionSupplierId,
          debitAmount: "0",
          creditAmount: String(commissionAmt),
          narration: `Commission payable to broker - container ${container.containerNumber}`,
        });
      }

      // Double-entry: Freight (Dr Freight Expense / Cr Supplier Payable)
      // Freight posts in its own currency (may differ from container currency)
      const freightAmt = parseFloat(container.freight || "0");
      const freightCcy = (container as any).freightCurrencyCode || container.currencyCode || "USD";
      if (freightAmt > 0 && container.freightAccountId) {
        const freightVoucherNum = `FACTORY-FREIGHT-${container.id}-${Date.now()}`;
        const [freightVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: freightVoucherNum,
          voucherDate: container.arrivalDate || today,
          description: `Freight on container ${container.containerNumber}`,
          totalAmount: String(freightAmt),
          currency: freightCcy,
          exchangeRate: freightCcy === (container.currencyCode || "USD")
            ? String(parseFloat(container.fxRateToUsd || "1"))
            : "1",
          sourceModule: "FACTORY",
        }).returning();
        // Dr Freight Expense
        await db.insert(voucherEntries).values({
          voucherId: freightVoucher.id,
          ledgerAccountId: container.freightAccountId,
          debitAmount: String(freightAmt),
          creditAmount: "0",
          narration: `Freight expense - container ${container.containerNumber}`,
        });
        // Cr Supplier Payable
        if (container.supplierId) {
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            factorySupplierId: container.supplierId,
            debitAmount: "0",
            creditAmount: String(freightAmt),
            narration: `Freight payable to supplier - container ${container.containerNumber}`,
          });
        }
      }

      res.json(container);
    } catch (error: any) {
      console.error("Error creating factory container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const updateData = { ...req.body, updatedAt: new Date() };

      if (updateData.currencyCode || updateData.ratePerKg || updateData.fxRateSource) {
        const [existing] = await db.select().from(factoryContainers)
          .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)));
        if (!existing) return res.status(404).json({ message: "Container not found" });

        const currencyCode = updateData.currencyCode || existing.currencyCode || "USD";
        const fxRateSource = updateData.fxRateSource || existing.fxRateSource || "auto";
        const importDate = updateData.arrivalDate || existing.arrivalDate || new Date().toISOString().split("T")[0];

        if (fxRateSource === "auto") {
          try {
            const fxRate = await getOrFetchFxRateToUsd(companyId, currencyCode, importDate);
            updateData.fxRateToUsd = fxRate;
            updateData.fxRateToUsdImport = fxRate;
            updateData.fxRateDateImport = importDate;
            updateData.fxRateSource = "auto";
            const ratePerKg = parseFloat(updateData.ratePerKg || existing.ratePerKg || "0");
            const fxRateNum = parseFloat(fxRate);
            updateData.ratePerKgUsd = String(currencyCode === "USD" ? ratePerKg : ratePerKg * fxRateNum);
          } catch {}
        } else {
          const fxRateNum = parseFloat(updateData.fxRateToUsd || existing.fxRateToUsd || "1");
          const ratePerKg = parseFloat(updateData.ratePerKg || existing.ratePerKg || "0");
          updateData.fxRateToUsdImport = String(fxRateNum);
          updateData.fxRateDateImport = importDate;
          updateData.fxRateSource = "manual";
          updateData.ratePerKgUsd = String(currencyCode === "USD" ? ratePerKg : ratePerKg * fxRateNum);
        }
      }

      // Auto-create freight ledger account if freight > 0 and no account selected
      if (!updateData.freightAccountId && parseFloat(updateData.freight || "0") > 0) {
        updateData.freightAccountId = await getOrCreateLedgerAccount(companyId, "FREIGHT", "Freight");
      }

      const [updated] = await db
        .update(factoryContainers)
        .set(updateData)
        .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)))
        .returning();

      if (!updated) return res.status(404).json({ message: "Container not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [deleted] = await db
        .delete(factoryContainers)
        .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Container not found" });
      res.json(deleted);
    } catch (error: any) {
      console.error("Error deleting factory container:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Backfill: create missing goods-import credits for existing containers ────
  app.post("/api/factory/containers/backfill-import-credits", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allContainers = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.companyId, companyId)));

      let created = 0;
      let skipped = 0;

      for (const container of allContainers) {
        if (!container.supplierId) { skipped++; continue; }
        const goodsValue = parseFloat(container.ratePerKg || "0") * parseFloat(container.totalKg || "0");
        if (goodsValue <= 0) { skipped++; continue; }

        // Skip if an import voucher already exists for this container
        const existing = await db
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(and(
            eq(vouchers.companyId, companyId),
            eq(vouchers.sourceModule, "FACTORY"),
            ilike(vouchers.voucherNumber, `FACTORY-IMPORT-${container.id}-%`)
          ))
          .limit(1);
        if (existing.length > 0) { skipped++; continue; }

        const today = new Date().toISOString().split("T")[0];
        const importCostAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_IMPORT_COST", "Factory Import Cost");
        const importVoucherNum = `FACTORY-IMPORT-${container.id}-${Date.now()}`;
        const [importVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: importVoucherNum,
          voucherDate: container.arrivalDate || today,
          description: `Goods import - container ${container.containerNumber}`,
          totalAmount: String(goodsValue),
          currency: container.currencyCode || "USD",
          exchangeRate: String(parseFloat(container.fxRateToUsd || "1")),
          sourceModule: "FACTORY",
        }).returning();
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          ledgerAccountId: importCostAccId,
          debitAmount: String(goodsValue),
          creditAmount: "0",
          narration: `Goods import cost - container ${container.containerNumber}`,
        });
        await db.insert(voucherEntries).values({
          voucherId: importVoucher.id,
          factorySupplierId: container.supplierId,
          debitAmount: "0",
          creditAmount: String(goodsValue),
          narration: `Goods payable to supplier - container ${container.containerNumber}`,
        });
        created++;
      }

      res.json({ created, skipped, total: allContainers.length });
    } catch (error: any) {
      console.error("Error backfilling import credits:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/containers/:id/other-charges", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseInt(req.params.id);
      const charges = await db
        .select()
        .from(factoryContainerOtherCharges)
        .where(and(
          eq(factoryContainerOtherCharges.containerId, containerId),
          eq(factoryContainerOtherCharges.companyId, companyId)
        ))
        .orderBy(factoryContainerOtherCharges.createdAt);
      res.json(charges);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:id/other-charges/sync", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const containerId = parseInt(req.params.id);
      const { charges, isCreate } = req.body as { charges: { description: string; amount: string; ledgerAccountId?: number | null }[]; isCreate?: boolean };

      // Void any previously created other-charge vouchers for this container (to avoid duplicates on edit)
      const ocPrefix = `FACTORY-OC-${containerId}-%`;
      const existingVouchers = await db
        .select({ id: vouchers.id })
        .from(vouchers)
        .where(and(
          eq(vouchers.companyId, companyId),
          eq(vouchers.sourceModule, "FACTORY"),
          ilike(vouchers.voucherNumber, ocPrefix)
        ));
      if (existingVouchers.length > 0) {
        const vIds = existingVouchers.map(v => v.id);
        await db.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
        await db.delete(vouchers).where(inArray(vouchers.id, vIds));
      }

      await db.delete(factoryContainerOtherCharges).where(and(
        eq(factoryContainerOtherCharges.containerId, containerId),
        eq(factoryContainerOtherCharges.companyId, companyId)
      ));

      let newCharges: any[] = [];
      if (charges && charges.length > 0) {
        const resolvedCharges = await Promise.all(
          charges.map(async (c) => {
            let ledgerAccountId = c.ledgerAccountId || null;
            if (!ledgerAccountId && c.description?.trim()) {
              const code = ("OC_" + c.description.toUpperCase().replace(/[^A-Z0-9]/g, "_")).slice(0, 50);
              ledgerAccountId = await getOrCreateLedgerAccount(companyId, code, c.description);
            }
            return { companyId, containerId, description: c.description, amount: c.amount, ledgerAccountId };
          })
        );
        newCharges = await db.insert(factoryContainerOtherCharges).values(resolvedCharges).returning();
      }

      const total = charges?.reduce((sum, c) => sum + parseFloat(c.amount || "0"), 0) ?? 0;
      await db.update(factoryContainers)
        .set({ otherCharges: total.toFixed(2) })
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      // Double-entry for each other charge: Dr Factory Charges Payable / Cr chosen account
      if (newCharges.length > 0) {
        const [container] = await db
          .select({ supplierId: factoryContainers.supplierId, containerNumber: factoryContainers.containerNumber, currencyCode: factoryContainers.currencyCode, fxRateToUsd: factoryContainers.fxRateToUsd, arrivalDate: factoryContainers.arrivalDate })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

        if (container) {
          const today = new Date().toISOString().split("T")[0];
          for (const charge of newCharges) {
            const chargeAmt = parseFloat(charge.amount || "0");
            if (chargeAmt <= 0 || !charge.ledgerAccountId) continue;
            const ocVoucherNum = `FACTORY-OC-${containerId}-${charge.id}-${Date.now()}`;
            const [ocVoucher] = await db.insert(vouchers).values({
              companyId,
              voucherType: "Journal",
              voucherNumber: ocVoucherNum,
              voucherDate: container.arrivalDate || today,
              description: `${charge.description} - container ${container.containerNumber}`,
              totalAmount: String(chargeAmt),
              currency: container.currencyCode || "USD",
              exchangeRate: String(parseFloat(container.fxRateToUsd || "1")),
              sourceModule: "FACTORY",
            }).returning();
            // Dr Factory Charges Payable
            const payableAccId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
            await db.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: payableAccId,
              debitAmount: String(chargeAmt),
              creditAmount: "0",
              narration: `${charge.description} payable - container ${container.containerNumber}`,
            });
            // Cr chosen account (credit = I owe this person)
            await db.insert(voucherEntries).values({
              voucherId: ocVoucher.id,
              ledgerAccountId: charge.ledgerAccountId,
              debitAmount: "0",
              creditAmount: String(chargeAmt),
              narration: `${charge.description} - container ${container.containerNumber}`,
            });
          }
        }
      }

      res.json({ charges: newCharges, total: total.toFixed(2) });
    } catch (error: any) {
      console.error("Error syncing container other charges:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 4b. Factory Containers - Excel Import
  // ───────────────────────────────────────────────

  app.post("/api/factory/containers/import-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows to import" });
      }

      const VALID_STATUSES = ["PENDING", "IN_TRANSIT", "AVAILABLE", "OFFLOADED"];
      const VALID_CURRENCIES = ["USD", "EUR", "AUD", "LBP", "GBP", "XOF", "XAF", "CFA"];

      const allSuppliers = await db
        .select()
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));

      const supplierMap = new Map<string, number>();
      allSuppliers.forEach((s: any) => supplierMap.set(s.name.toLowerCase().trim(), s.id));

      const results: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 1;
        try {
          if (!row.containerNumber || !row.containerNumber.trim()) {
            errors.push(`Row ${rowNum}: Missing container number`);
            continue;
          }

          const status = (row.status || "PENDING").toUpperCase();
          if (!VALID_STATUSES.includes(status)) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid status "${row.status}". Must be one of: ${VALID_STATUSES.join(", ")}`);
            continue;
          }

          const currencyCode = (row.currencyCode || "USD").toUpperCase();
          if (!VALID_CURRENCIES.includes(currencyCode)) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid currency "${row.currencyCode}"`);
            continue;
          }

          const ratePerKg = parseFloat(row.ratePerKg || "0") || 0;
          const totalKg = parseFloat(row.totalKg || "0") || 0;

          if (row.totalKg && isNaN(parseFloat(row.totalKg))) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid Total Kg value`);
            continue;
          }
          if (row.ratePerKg && isNaN(parseFloat(row.ratePerKg))) {
            errors.push(`Row ${rowNum} (${row.containerNumber}): Invalid Rate/Kg value`);
            continue;
          }

          const fxSource = (row.fxSource || "").toUpperCase() === "MANUAL" ? "manual" : "auto";
          const today = new Date().toISOString().split("T")[0];
          const importDate = row.arrivalDate || today;

          let fxRate: number;
          if (fxSource === "manual" && row.fxRateToUsd) {
            fxRate = parseFloat(row.fxRateToUsd) || 1;
          } else {
            try {
              fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, currencyCode, importDate));
            } catch (fxErr: any) {
              errors.push(`Row ${rowNum} (${row.containerNumber}): ${fxErr.message}`);
              continue;
            }
          }

          await db.transaction(async (tx: any) => {
            let supplierId: number | null = null;
            if (row.supplierName && row.supplierName.trim()) {
              const key = row.supplierName.toLowerCase().trim();
              if (supplierMap.has(key)) {
                supplierId = supplierMap.get(key)!;
              } else {
                const [newSupplier] = await tx.insert(factorySuppliers).values({
                  companyId,
                  name: row.supplierName.trim(),
                  isActive: true,
                }).returning();
                supplierMap.set(key, newSupplier.id);
                supplierId = newSupplier.id;
              }
            }

            const ratePerKgUsd = currencyCode === "USD" ? ratePerKg : ratePerKg * fxRate;

            const commAmt = row.commissionAmount ? String(parseFloat(row.commissionAmount) || 0) : "0";
            const commCcy = (row.commissionCurrencyCode || "USD").toUpperCase();

            const [container] = await tx.insert(factoryContainers).values({
              companyId,
              containerNumber: row.containerNumber.trim(),
              supplierId,
              origin: row.origin || null,
              totalKg: totalKg ? String(totalKg) : null,
              ratePerKg: ratePerKg ? String(ratePerKg) : null,
              currencyCode,
              fxRateToUsd: String(fxRate),
              fxRateToUsdImport: String(fxRate),
              fxRateSource: fxSource,
              fxRateDateImport: importDate,
              ratePerKgUsd: String(ratePerKgUsd),
              arrivalDate: row.arrivalDate || null,
              notes: row.notes || null,
              status,
              commissionAmount: commAmt,
              commissionCurrencyCode: commCcy,
            }).returning();

            await writeDaybookEntry(tx, {
              companyId,
              txDate: container.arrivalDate || importDate,
              txType: "CONTAINER_IMPORT",
              referenceId: container.id,
              description: `Container imported (Excel): ${container.containerNumber}`,
              currencyCode: container.currencyCode || "USD",
              amountCurrency: ratePerKg * totalKg,
              fxRateToUsd: fxRate,
            });

            results.push(container);
          });
        } catch (err: any) {
          errors.push(`Row ${rowNum} (${row.containerNumber || "unknown"}): ${err.message}`);
        }
      }

      res.json({
        imported: results.length,
        errors,
        total: rows.length,
      });
    } catch (error: any) {
      console.error("Error importing containers from Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 5. Factory Raw Stock
  // ───────────────────────────────────────────────

  app.get("/api/factory/raw-stock", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
          containerNumber: factoryContainers.containerNumber,
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
          origin: factoryContainers.origin,
          containerStatus: factoryContainers.status,
          currencyCode: factoryContainers.currencyCode,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.companyId, companyId), sql`${factoryContainers.status} != 'DELETED'`));

      const supplierMap = new Map<string, any>();
      for (const r of results) {
        const isOB = r.containerStatus === "OPENING_BALANCE";
        const key = (r.supplierName || `unknown-${r.containerId}`) + (isOB ? "__OB" : "__CT");
        const received = parseFloat(r.receivedKg as string) || 0;
        const used = parseFloat(r.usedKg as string) || 0;
        const costPerKg = parseFloat(r.costPerKg as string) || 0;

        const costPerKgUsd = parseFloat(r.costPerKgUsd as string) || costPerKg;
        if (supplierMap.has(key)) {
          const existing = supplierMap.get(key)!;
          const prevTotalCost = existing._totalReceived * existing._avgCostPerKg;
          const newTotalCost = received * costPerKg;
          const prevTotalCostUsd = existing._totalReceived * existing._avgCostPerKgUsd;
          const newTotalCostUsd = received * costPerKgUsd;
          existing._totalReceived += received;
          existing._totalUsed += used;
          existing._avgCostPerKg = existing._totalReceived > 0
            ? (prevTotalCost + newTotalCost) / existing._totalReceived
            : 0;
          existing._avgCostPerKgUsd = existing._totalReceived > 0
            ? (prevTotalCostUsd + newTotalCostUsd) / existing._totalReceived
            : 0;
          if (new Date(r.offloadedAt) > new Date(existing.lastOffloaded)) {
            existing.lastOffloaded = r.offloadedAt;
          }
        } else {
          supplierMap.set(key, {
            supplierName: r.supplierName || "Unknown",
            supplierId: r.supplierId,
            sourceType: isOB ? "OPENING_BALANCE" : "CONTAINER",
            currencyCode: r.currencyCode || "USD",
            _totalReceived: received,
            _totalUsed: used,
            _avgCostPerKg: costPerKg,
            _avgCostPerKgUsd: costPerKgUsd,
            lastOffloaded: r.offloadedAt,
          });
        }
      }

      const reservedRows = await db
        .select({
          supplierId: factoryMixBatchSources.supplierId,
          reservedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
        })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .where(and(
          eq(factoryMixBatches.companyId, companyId),
          sql`${factoryMixBatchSources.supplierId} IS NOT NULL`,
          sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`,
        ))
        .groupBy(factoryMixBatchSources.supplierId);

      const reservedBySupplierId = new Map<number, number>();
      for (const r of reservedRows) {
        if (r.supplierId) reservedBySupplierId.set(r.supplierId, parseFloat(r.reservedKg as string) || 0);
      }

      const aggregated = Array.from(supplierMap.values()).map((s: any) => {
        const remainingKg = s._totalReceived - s._totalUsed;
        const valueRemaining = remainingKg * s._avgCostPerKg;
        const valueRemainingUsd = remainingKg * s._avgCostPerKgUsd;
        const reservedKg = s.supplierId ? (reservedBySupplierId.get(s.supplierId) || 0) : 0;
        const freeKg = Math.max(0, remainingKg - reservedKg);
        return {
          supplierName: s.supplierName,
          supplierId: s.supplierId,
          sourceType: s.sourceType,
          currencyCode: s.currencyCode,
          receivedKg: s._totalReceived.toFixed(3),
          usedKg: s._totalUsed.toFixed(3),
          remainingKg: remainingKg.toFixed(3),
          reservedKg: reservedKg.toFixed(3),
          freeKg: freeKg.toFixed(3),
          costPerKg: s._avgCostPerKg.toFixed(4),
          costPerKgUsd: s._avgCostPerKgUsd.toFixed(4),
          valueRemaining: valueRemaining.toFixed(2),
          valueRemainingUsd: valueRemainingUsd.toFixed(2),
          lastOffloaded: s.lastOffloaded,
        };
      });

      res.json(aggregated);
    } catch (error: any) {
      console.error("Error fetching factory raw stock:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/raw-stock/by-container", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select({
          id: factoryRawStock.id,
          companyId: factoryRawStock.companyId,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          offloadedAt: factoryRawStock.offloadedAt,
          createdAt: factoryRawStock.createdAt,
          containerNumber: factoryContainers.containerNumber,
          containerStatus: factoryContainers.status,
          supplierName: factorySuppliers.name,
          supplierId: factoryContainers.supplierId,
          origin: factoryContainers.origin,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.companyId, companyId), sql`${factoryContainers.status} != 'DELETED'`));

      const enriched = results.map((r: any) => {
        const received = parseFloat(r.receivedKg) || 0;
        const used = parseFloat(r.usedKg) || 0;
        const costPerKg = parseFloat(r.costPerKg) || 0;
        const remainingKg = received - used;
        return { ...r, remainingKg: remainingKg.toFixed(3) };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching factory raw stock by container:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/raw-stock/available-containers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const offloaded = await db
        .select({ containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const offloadedIds = offloaded.map((o: any) => o.containerId).filter(Boolean);

      const baseConditions = [
        eq(factoryContainers.companyId, companyId),
        sql`${factoryContainers.status} NOT IN ('DELETED', 'OPENING_BALANCE')`,
      ];

      if (offloadedIds.length > 0) {
        baseConditions.push(
          sql`${factoryContainers.id} NOT IN (${sql.join(offloadedIds.map((id: number) => sql`${id}`), sql`, `)})`
        );
      }

      const results = await db
        .select()
        .from(factoryContainers)
        .where(and(...baseConditions));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching available containers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/raw-stock/offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const {
        containerId, receivedKg, costPerKg, commission,
        currencyCode: reqCurrencyCode, fxRateToUsd: reqFxRate,
        freight: reqFreight, freightAccountId: reqFreightAccountId,
        freightSupplierId: reqFreightSupplierId,
        freightCurrencyCode: reqFreightCurrencyCode,
        freightFxRate: reqFreightFxRate,
        otherCharges: reqOtherCharges, otherChargesAccountId: reqOtherChargesAccountId,
        otherChargesSupplierId: reqOtherChargesSupplierId,
        otherChargesCurrencyCode: reqOtherChargesCurrencyCode,
        otherChargesFxRate: reqOtherChargesFxRate,
        dutyAmount: reqDutyAmount, dutyAccountId: reqDutyAccountId,
        dutyStatus: reqDutyStatus, dutyNotes: reqDutyNotes,
        additionalCharges: reqAdditionalCharges,
        offloadDate: reqOffloadDate,
        mixBatchAllocations: reqMixBatchAllocations,
      } = req.body;
      if (!containerId) return res.status(400).json({ message: "Container ID is required" });

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });

      const [existing] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      if (existing) return res.status(400).json({ message: "This container has already been offloaded" });

      const currencyCode = reqCurrencyCode || container.currencyCode || "USD";
      const today = new Date().toISOString().split("T")[0];
      const offloadDate = reqOffloadDate || today;
      const mixBatchAllocationsArr = Array.isArray(reqMixBatchAllocations) ? reqMixBatchAllocations : [];

      let fxRate: number;
      if (reqFxRate && parseFloat(reqFxRate) > 0) {
        // User explicitly set the FX rate — always honour it
        fxRate = parseFloat(reqFxRate);
      } else {
        try {
          fxRate = parseFloat(await getOrFetchFxRateToUsd(companyId, currencyCode, offloadDate));
        } catch {
          fxRate = parseFloat(container.fxRateToUsd || "1");
        }
      }

      const declaredKg = container.totalKg || "0";
      const actualKg = receivedKg || declaredKg;
      const baseCostPerKg = costPerKg || container.ratePerKg || "0";
      const differenceKg = String(parseFloat(declaredKg) - parseFloat(actualKg));
      const basePayable = parseFloat(actualKg) * parseFloat(baseCostPerKg);

      const freightVal = parseFloat(reqFreight || "0");
      const otherChargesVal = parseFloat(reqOtherCharges || "0");
      const additionalChargesArr = Array.isArray(reqAdditionalCharges) ? reqAdditionalCharges : [];
      // Each charge may be in its own currency; convert each to container currency for totalCost
      const additionalChargesTotal = additionalChargesArr.reduce((sum: number, c: any) => {
        const amt = parseFloat(c.amount || "0");
        const chargeCcy = c.currencyCode || currencyCode;
        const chargeFx = parseFloat(c.fxRateToUsd || String(fxRate));
        if (chargeCcy === currencyCode) return sum + amt;
        const amtUsd = chargeCcy === "USD" ? amt : amt * chargeFx;
        const amtInContainerCcy = currencyCode === "USD" ? amtUsd : (fxRate > 0 ? amtUsd / fxRate : amtUsd);
        return sum + amtInContainerCcy;
      }, 0);
      const dutyVal = reqDutyStatus === "CONFIRMED" ? parseFloat(reqDutyAmount || "0") : 0;
      const dutyStatus = reqDutyStatus || "NONE";

      let commissionRecord = null;
      let commTotalVal = 0;
      let commInContainerCcy = 0;
      let commCurrencyForUsd = currencyCode;
      let commFxRateForUsd = fxRate;
      if (commission && commission.personName && commission.commissionRate) {
        const commType = commission.commissionType || "PER_KG";
        const commRate = parseFloat(commission.commissionRate) || 0;
        commTotalVal = commType === "PER_KG"
          ? commRate * parseFloat(actualKg)
          : commRate;

        const commCurrency = commission.currencyCode || currencyCode;
        const commFxRate = parseFloat(commission.fxRateToUsd || String(fxRate));
        commCurrencyForUsd = commCurrency;
        commFxRateForUsd = commFxRate;
        const commTotalUsd = commCurrency === "USD" ? commTotalVal : commTotalVal * commFxRate;
        // Convert commission to container currency for totalCost
        commInContainerCcy = commCurrency === currencyCode ? commTotalVal : (fxRate > 0 ? commTotalUsd / fxRate : commTotalUsd);

        [commissionRecord] = await db
          .insert(factoryContainerCommissions)
          .values({
            companyId,
            containerId,
            personName: commission.personName,
            commissionType: commType,
            commissionRate: String(commRate),
            commissionTotal: String(commTotalVal),
            currencyCode: commCurrency,
            fxRateToUsd: String(commFxRate),
            commissionTotalUsd: String(commTotalUsd),
            ledgerAccountId: commission.ledgerAccountId ? parseInt(commission.ledgerAccountId) : null,
          })
          .returning();
      }

      // Compute per-component USD values (each charge may be in its own currency)
      const freightCcy = reqFreightCurrencyCode || currencyCode;
      const freightFxRateVal = parseFloat(reqFreightFxRate || String(fxRate));
      const freightUsd = freightCcy === "USD" ? freightVal : freightVal * freightFxRateVal;
      // Convert freight to container currency for totalCost
      const freightInContainerCcy = (freightCcy === currencyCode) ? freightVal : (fxRate > 0 ? freightUsd / fxRate : freightVal);

      const ocCcy = reqOtherChargesCurrencyCode || currencyCode;
      const ocFxRateVal = parseFloat(reqOtherChargesFxRate || String(fxRate));
      const ocUsd = ocCcy === "USD" ? otherChargesVal : otherChargesVal * ocFxRateVal;
      // Convert OC to container currency for totalCost
      const ocInContainerCcy = (ocCcy === currencyCode) ? otherChargesVal : (fxRate > 0 ? ocUsd / fxRate : otherChargesVal);

      const totalCost = basePayable + freightInContainerCcy + ocInContainerCcy + additionalChargesTotal + commInContainerCcy + dutyVal;
      const inclusiveCostPerKg = parseFloat(actualKg) > 0 ? totalCost / parseFloat(actualKg) : 0;
      const finalPayableAmount = String(totalCost);

      const commUsd = commCurrencyForUsd === "USD" ? commTotalVal : commTotalVal * commFxRateForUsd;

      const baseMaterialUsd = currencyCode === "USD" ? basePayable : basePayable * fxRate;
      const addlUsd = additionalChargesArr.reduce((sum: number, c: any) => {
        const amt = parseFloat(c.amount || "0");
        const chargeCcy = c.currencyCode || currencyCode;
        const chargeFx = parseFloat(c.fxRateToUsd || String(fxRate));
        return sum + (chargeCcy === "USD" ? amt : amt * chargeFx);
      }, 0);
      const dutyUsd = currencyCode === "USD" ? dutyVal : dutyVal * fxRate;

      const totalUsd = baseMaterialUsd + freightUsd + commUsd + ocUsd + addlUsd + dutyUsd;
      const costPerKgUsd = parseFloat(actualKg) > 0 ? totalUsd / parseFloat(actualKg) : 0;
      const finalPayableAmountUsd = String(totalUsd);

      const newStatus = parseFloat(actualKg) < parseFloat(declaredKg) ? "PARTIALLY_RECEIVED" : "OFFLOADED";

      const [rawStock] = await db
        .insert(factoryRawStock)
        .values({
          companyId,
          containerId,
          receivedKg: String(actualKg),
          costPerKg: String(inclusiveCostPerKg),
          costPerKgUsd: String(costPerKgUsd),
        })
        .returning();

      // Insert mix batch source records for each allocation specified during offload
      for (const alloc of mixBatchAllocationsArr) {
        const allocKg = parseFloat(alloc.weightKg || "0");
        if (!alloc.mixBatchId || allocKg <= 0) continue;
        const allocCost = inclusiveCostPerKg * allocKg;
        await db.insert(factoryMixBatchSources).values({
          mixBatchId: parseInt(alloc.mixBatchId),
          containerId,
          supplierId: container.supplierId || null,
          sourceType: "container",
          weightKg: String(allocKg),
          costPerKg: String(inclusiveCostPerKg),
          totalCost: String(allocCost),
        });
      }

      await db
        .update(factoryContainers)
        .set({
          status: newStatus,
          declaredKg: String(declaredKg),
          actualReceivedKg: String(actualKg),
          finalPayableAmount,
          differenceKg,
          currencyCode,
          fxRateToUsd: String(fxRate),
          fxRateToUsdOffload: String(fxRate),
          fxRateDateOffload: offloadDate,
          ratePerKgUsd: String(costPerKgUsd),
          finalPayableAmountUsd,
          freight: String(freightVal),
          freightAccountId: reqFreightAccountId ? parseInt(reqFreightAccountId) : null,
          freightSupplierId: reqFreightSupplierId ? parseInt(reqFreightSupplierId) : null,
          otherCharges: String(otherChargesVal),
          otherChargesAccountId: reqOtherChargesAccountId ? parseInt(reqOtherChargesAccountId) : null,
          otherChargesSupplierId: reqOtherChargesSupplierId ? parseInt(reqOtherChargesSupplierId) : null,
          commissionAmount: commTotalVal > 0 ? String(commTotalVal) : (container.commissionAmount || "0"),
          dutyAmount: dutyStatus !== "NONE" ? String(parseFloat(reqDutyAmount || "0")) : null,
          dutyAccountId: reqDutyAccountId ? parseInt(reqDutyAccountId) : null,
          dutyStatus,
          dutyNotes: reqDutyNotes || null,
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      const insertedAdditionalCharges: any[] = [];
      if (additionalChargesArr.length > 0) {
        for (const charge of additionalChargesArr) {
          if (charge.description && parseFloat(charge.amount || "0") > 0) {
            const [inserted] = await db
              .insert(factoryOffloadAdditionalCharges)
              .values({
                companyId,
                containerId,
                description: charge.description,
                amount: String(charge.amount),
                currencyCode: charge.currencyCode || currencyCode,
                fxRateToUsd: String(charge.fxRateToUsd || (currencyCode === "USD" ? "1" : String(fxRate))),
                ledgerAccountId: charge.ledgerAccountId ? parseInt(charge.ledgerAccountId) : null,
                supplierId: charge.supplierId ? parseInt(charge.supplierId) : null,
              })
              .returning();
            insertedAdditionalCharges.push(inserted);
          }
        }
      }

      await writeDaybookEntry(db, {
        companyId,
        txDate: offloadDate,
        txType: "OFFLOAD_RAW_STOCK",
        referenceId: rawStock.id,
        description: `Offloaded container ${container.containerNumber}: ${actualKg} kg at ${inclusiveCostPerKg.toFixed(4)}/kg (inclusive)`,
        currencyCode,
        amountCurrency: totalCost,
        fxRateToUsd: fxRate,
      });
      if (commissionRecord) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: offloadDate,
          txType: "COMMISSION",
          referenceId: commissionRecord.id,
          description: `Commission for ${commissionRecord.personName} on container ${container.containerNumber}`,
          currencyCode: commissionRecord.currencyCode || "USD",
          amountCurrency: parseFloat(commissionRecord.commissionTotal),
          fxRateToUsd: parseFloat(commissionRecord.fxRateToUsd || "1"),
        });
      }
      if (freightVal > 0) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: offloadDate,
          txType: "FREIGHT",
          referenceId: containerId,
          description: `Freight on container ${container.containerNumber}`,
          currencyCode,
          amountCurrency: freightVal,
          fxRateToUsd: fxRate,
        });
      }
      if (otherChargesVal > 0) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: offloadDate,
          txType: "OTHER_CHARGE",
          referenceId: containerId,
          description: `Other charges on container ${container.containerNumber}`,
          currencyCode,
          amountCurrency: otherChargesVal,
          fxRateToUsd: fxRate,
        });
      }
      if (dutyVal > 0) {
        await writeDaybookEntry(db, {
          companyId,
          txDate: offloadDate,
          txType: "DUTY",
          referenceId: containerId,
          description: `Duty on container ${container.containerNumber}`,
          currencyCode,
          amountCurrency: dutyVal,
          fxRateToUsd: fxRate,
        });
      }
      for (const charge of additionalChargesArr) {
        const chargeAmount = parseFloat(charge.amount || "0");
        if (charge.description && chargeAmount > 0) {
          await writeDaybookEntry(db, {
            companyId,
            txDate: offloadDate,
            txType: "OTHER_CHARGE",
            referenceId: containerId,
            description: `${charge.description} on container ${container.containerNumber}`,
            currencyCode,
            amountCurrency: chargeAmount,
            fxRateToUsd: fxRate,
          });
        }
      }

      // Double-entry accounting vouchers for Freight
      if (freightVal > 0 && (reqFreightAccountId || reqFreightSupplierId)) {
        const freightVoucherNum = `FACTORY-FREIGHT-${containerId}-${Date.now()}`;
        const freightVoucherCcy = reqFreightCurrencyCode || currencyCode;
        const freightFx = parseFloat(reqFreightFxRate || String(fxRate));
        const [freightVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: freightVoucherNum,
          voucherDate: offloadDate,
          description: `Freight on container ${container.containerNumber}`,
          totalAmount: String(freightVal),
          currency: freightVoucherCcy,
          exchangeRate: String(freightFx),
          sourceModule: "FACTORY",
        }).returning();
        if (reqFreightSupplierId) {
          // Supplier selected: Dr Freight Expense / Cr Supplier Balance
          const freightExpenseAccountId = reqFreightAccountId
            ? parseInt(reqFreightAccountId)
            : await getOrCreateLedgerAccount(companyId, "FACTORY_FREIGHT_EXPENSE", "Freight Expense");
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            ledgerAccountId: freightExpenseAccountId,
            debitAmount: String(freightVal),
            creditAmount: "0",
            narration: `Freight expense - container ${container.containerNumber}`,
          });
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            factorySupplierId: parseInt(reqFreightSupplierId),
            debitAmount: "0",
            creditAmount: String(freightVal),
            narration: `Freight payable to supplier - container ${container.containerNumber}`,
          });
        } else {
          // No supplier: Dr Factory Charges Payable / Cr chosen account
          const freightPayableAccountId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            ledgerAccountId: freightPayableAccountId,
            debitAmount: String(freightVal),
            creditAmount: "0",
            narration: `Freight payable - container ${container.containerNumber}`,
          });
          await db.insert(voucherEntries).values({
            voucherId: freightVoucher.id,
            ledgerAccountId: parseInt(reqFreightAccountId),
            debitAmount: "0",
            creditAmount: String(freightVal),
            narration: `Freight - container ${container.containerNumber}`,
          });
        }
      }

      // Double-entry accounting vouchers for Other Charges
      if (otherChargesVal > 0 && (reqOtherChargesAccountId || reqOtherChargesSupplierId)) {
        const ocMainVoucherNum = `FACTORY-OC-${containerId}-MAIN-${Date.now()}`;
        const ocVoucherCcy = reqOtherChargesCurrencyCode || currencyCode;
        const ocFx = parseFloat(reqOtherChargesFxRate || String(fxRate));
        const [ocMainVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: ocMainVoucherNum,
          voucherDate: offloadDate,
          description: `Other charges on container ${container.containerNumber}`,
          totalAmount: String(otherChargesVal),
          currency: ocVoucherCcy,
          exchangeRate: String(ocFx),
          sourceModule: "FACTORY",
        }).returning();
        if (reqOtherChargesSupplierId) {
          // Supplier selected: Dr OC Expense / Cr Supplier Balance
          const ocExpenseAccountId = reqOtherChargesAccountId
            ? parseInt(reqOtherChargesAccountId)
            : await getOrCreateLedgerAccount(companyId, "FACTORY_OC_EXPENSE", "Other Charges Expense");
          await db.insert(voucherEntries).values({
            voucherId: ocMainVoucher.id,
            ledgerAccountId: ocExpenseAccountId,
            debitAmount: String(otherChargesVal),
            creditAmount: "0",
            narration: `Other charges expense - container ${container.containerNumber}`,
          });
          await db.insert(voucherEntries).values({
            voucherId: ocMainVoucher.id,
            factorySupplierId: parseInt(reqOtherChargesSupplierId),
            debitAmount: "0",
            creditAmount: String(otherChargesVal),
            narration: `Other charges payable to supplier - container ${container.containerNumber}`,
          });
        } else {
          // No supplier: Dr Factory Charges Payable / Cr chosen account
          const ocPayableAccountId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
          await db.insert(voucherEntries).values({
            voucherId: ocMainVoucher.id,
            ledgerAccountId: ocPayableAccountId,
            debitAmount: String(otherChargesVal),
            creditAmount: "0",
            narration: `Other charges payable - container ${container.containerNumber}`,
          });
          await db.insert(voucherEntries).values({
            voucherId: ocMainVoucher.id,
            ledgerAccountId: parseInt(reqOtherChargesAccountId),
            debitAmount: "0",
            creditAmount: String(otherChargesVal),
            narration: `Other charges - container ${container.containerNumber}`,
          });
        }
      }

      // Double-entry accounting vouchers for each offload additional charge
      // Dr Factory Charges Payable / Cr chosen account (ledger or supplier)
      for (const inserted of insertedAdditionalCharges) {
        const chargeAmount = parseFloat(inserted.amount || "0");
        if (chargeAmount <= 0) continue;
        // Must have either a ledger account or a supplier selected
        if (!inserted.ledgerAccountId && !inserted.supplierId) continue;
        const ocVoucherNum = `FACTORY-OC-${containerId}-${inserted.id}-${Date.now()}`;
        const [ocVoucher] = await db.insert(vouchers).values({
          companyId,
          voucherType: "Journal",
          voucherNumber: ocVoucherNum,
          voucherDate: offloadDate,
          description: `${inserted.description} - container ${container.containerNumber}`,
          totalAmount: String(chargeAmount),
          currency: currencyCode,
          exchangeRate: String(fxRate),
          sourceModule: "FACTORY",
        }).returning();
        // Dr Factory Charges Payable
        const addlPayableAccountId = await getOrCreateLedgerAccount(companyId, "FACTORY_CHARGES_PAYABLE", "Factory Charges Payable");
        await db.insert(voucherEntries).values({
          voucherId: ocVoucher.id,
          ledgerAccountId: addlPayableAccountId,
          debitAmount: String(chargeAmount),
          creditAmount: "0",
          narration: `${inserted.description} payable - container ${container.containerNumber}`,
        });
        // Cr chosen account — ledger account OR factory supplier
        if (inserted.ledgerAccountId) {
          await db.insert(voucherEntries).values({
            voucherId: ocVoucher.id,
            ledgerAccountId: inserted.ledgerAccountId,
            debitAmount: "0",
            creditAmount: String(chargeAmount),
            narration: `${inserted.description} - container ${container.containerNumber}`,
          });
        } else if (inserted.supplierId) {
          await db.insert(voucherEntries).values({
            voucherId: ocVoucher.id,
            factorySupplierId: inserted.supplierId,
            debitAmount: "0",
            creditAmount: String(chargeAmount),
            narration: `${inserted.description} - container ${container.containerNumber}`,
          });
        }
      }

      res.json({ rawStock, commission: commissionRecord });
    } catch (error: any) {
      console.error("Error offloading container:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // ── Reverse Offload ──────────────────────────────────────────────────────────
  app.post("/api/factory/containers/:id/reverse-offload", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.id);

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.status !== "OFFLOADED" && container.status !== "PARTIALLY_RECEIVED") {
        return res.status(400).json({ message: "Only OFFLOADED or PARTIALLY_RECEIVED containers can be reversed" });
      }

      await db.transaction(async (tx) => {
        // 1. Find the raw stock entry for this container
        const [rawStockRow] = await tx
          .select({ id: factoryRawStock.id })
          .from(factoryRawStock)
          .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

        // 2. Find commission records for this container
        const commissionRows = await tx
          .select({ id: factoryContainerCommissions.id })
          .from(factoryContainerCommissions)
          .where(and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId)));
        const commissionIds = commissionRows.map((r: any) => r.id);

        // 3. Delete daybook entries tied to this offload
        //    - OFFLOAD_RAW_STOCK referencing the raw stock row id
        //    - COMMISSION referencing each commission record id
        //    - FREIGHT / OTHER_CHARGE / DUTY referencing the container id
        if (rawStockRow) {
          await tx.delete(factoryDaybookEntries).where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "OFFLOAD_RAW_STOCK"),
              eq(factoryDaybookEntries.referenceId, rawStockRow.id)
            )
          );
        }
        if (commissionIds.length > 0) {
          await tx.delete(factoryDaybookEntries).where(
            and(
              eq(factoryDaybookEntries.companyId, companyId),
              eq(factoryDaybookEntries.txType, "COMMISSION"),
              inArray(factoryDaybookEntries.referenceId, commissionIds)
            )
          );
        }
        await tx.delete(factoryDaybookEntries).where(
          and(
            eq(factoryDaybookEntries.companyId, companyId),
            inArray(factoryDaybookEntries.txType, ["FREIGHT", "OTHER_CHARGE", "DUTY"]),
            eq(factoryDaybookEntries.referenceId, containerId)
          )
        );

        // 4. Delete all double-entry accounting vouchers for this container
        //    Patterns: FACTORY-COMM-{id}-*, FACTORY-FREIGHT-{id}-*, FACTORY-OC-{id}-*
        const containerVouchers = await tx
          .select({ id: vouchers.id })
          .from(vouchers)
          .where(
            and(
              eq(vouchers.companyId, companyId),
              eq(vouchers.sourceModule, "FACTORY"),
              or(
                ilike(vouchers.voucherNumber, `FACTORY-COMM-${containerId}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-FREIGHT-${containerId}-%`),
                ilike(vouchers.voucherNumber, `FACTORY-OC-${containerId}-%`)
              )
            )
          );
        if (containerVouchers.length > 0) {
          const vIds = containerVouchers.map((v: any) => v.id);
          await tx.delete(voucherEntries).where(inArray(voucherEntries.voucherId, vIds));
          await tx.delete(vouchers).where(inArray(vouchers.id, vIds));
        }

        // 5a. Delete raw stock, commission records, and additional charges
        await tx.delete(factoryRawStock).where(
          and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId))
        );
        await tx.delete(factoryContainerCommissions).where(
          and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId))
        );
        await tx.delete(factoryOffloadAdditionalCharges).where(
          and(eq(factoryOffloadAdditionalCharges.companyId, companyId), eq(factoryOffloadAdditionalCharges.containerId, containerId))
        );

        // 5. Reset container back to RECEIVED state, clearing offload-computed fields only.
        //    Pre-registered fields (freight, otherCharges, commission) are kept as-is so
        //    they remain visible on the containers list after the reverse.
        await tx.update(factoryContainers).set({
          status: "RECEIVED",
          actualReceivedKg: null,
          differenceKg: null,
          dutyAmount: null,
          dutyAccountId: null,
          dutyStatus: "NONE",
          dutyNotes: null,
          finalPayableAmount: null,
          finalPayableAmountUsd: null,
          ratePerKgUsd: null,
          fxRateToUsdOffload: null,
          fxRateDateOffload: null,
          updatedAt: new Date(),
        }).where(eq(factoryContainers.id, containerId));
      });

      res.json({ message: "Offload reversed successfully. Container is back to RECEIVED status." });
    } catch (error: any) {
      console.error("Error reversing offload:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/containers/:id/confirm-duty", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.id);
      const { dutyAmount, dutyNotes } = req.body;
      const userId = String((req.session as any).userId || (req.user as any)?.id || "system");

      if (!dutyAmount || parseFloat(dutyAmount) <= 0) {
        return res.status(400).json({ message: "Valid duty amount is required" });
      }

      const [container] = await db
        .select()
        .from(factoryContainers)
        .where(and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, companyId)));

      if (!container) return res.status(404).json({ message: "Container not found" });
      if (container.dutyStatus !== "PENDING") {
        return res.status(400).json({ message: "Only containers with PENDING duty can be confirmed" });
      }

      const oldDutyAmount = container.dutyAmount;
      const newDutyAmount = parseFloat(dutyAmount);

      await db.insert(factoryDutyAuditLog).values({
        companyId,
        containerId,
        oldDutyAmount: oldDutyAmount || "0",
        newDutyAmount: String(newDutyAmount),
        oldDutyStatus: container.dutyStatus,
        newDutyStatus: "CONFIRMED",
        notes: dutyNotes || null,
        updatedByUserId: userId,
      });

      const actualKg = parseFloat(container.actualReceivedKg || "0");
      const baseRate = parseFloat(container.ratePerKg || "0");
      const basePayable = actualKg * baseRate;
      const freightVal = parseFloat(container.freight || "0");
      const otherChargesVal = parseFloat(container.otherCharges || "0");
      const commissionVal = parseFloat(container.commissionAmount || "0");

      const additionalChargesRows = await db
        .select()
        .from(factoryOffloadAdditionalCharges)
        .where(and(eq(factoryOffloadAdditionalCharges.containerId, containerId), eq(factoryOffloadAdditionalCharges.companyId, companyId)));
      const additionalChargesTotal = additionalChargesRows.reduce((sum: number, c: any) => sum + parseFloat(c.amount || "0"), 0);

      const totalCost = basePayable + freightVal + otherChargesVal + additionalChargesTotal + commissionVal + newDutyAmount;
      const newInclusiveCostPerKg = actualKg > 0 ? totalCost / actualKg : 0;
      const fxRate = parseFloat(container.fxRateToUsd || "1");
      const costPerKgUsd = (container.currencyCode || "USD") === "USD" ? newInclusiveCostPerKg : newInclusiveCostPerKg * fxRate;
      const finalPayableAmountUsd = String(actualKg * costPerKgUsd);

      await db
        .update(factoryContainers)
        .set({
          dutyAmount: String(newDutyAmount),
          dutyStatus: "CONFIRMED",
          dutyNotes: dutyNotes || container.dutyNotes,
          finalPayableAmount: String(totalCost),
          ratePerKgUsd: String(costPerKgUsd),
          finalPayableAmountUsd,
          updatedAt: new Date(),
        })
        .where(eq(factoryContainers.id, containerId));

      const [rawStock] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)));

      if (rawStock) {
        await db
          .update(factoryRawStock)
          .set({
            costPerKg: String(newInclusiveCostPerKg),
            costPerKgUsd: String(costPerKgUsd),
          })
          .where(eq(factoryRawStock.id, rawStock.id));
      }

      const today = new Date().toISOString().split("T")[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: today,
        txType: "DUTY",
        referenceId: containerId,
        description: `Duty confirmed for container ${container.containerNumber}: $${newDutyAmount.toFixed(2)}`,
        currencyCode: container.currencyCode || "USD",
        amountCurrency: newDutyAmount,
        fxRateToUsd: fxRate,
      });

      res.json({ message: "Duty confirmed and costs recalculated", newCostPerKg: newInclusiveCostPerKg });
    } catch (error: any) {
      console.error("Error confirming duty:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/containers/:id/duty-audit-log", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.id);
      const logs = await db
        .select()
        .from(factoryDutyAuditLog)
        .where(and(eq(factoryDutyAuditLog.companyId, companyId), eq(factoryDutyAuditLog.containerId, containerId)))
        .orderBy(desc(factoryDutyAuditLog.createdAt));

      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching duty audit log:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/container-commissions/:containerId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const containerId = parseInt(req.params.containerId);
      const results = await db
        .select()
        .from(factoryContainerCommissions)
        .where(and(eq(factoryContainerCommissions.companyId, companyId), eq(factoryContainerCommissions.containerId, containerId)));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching commissions:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/raw-stock/opening-balance", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierName, supplierId: reqSupplierId, receivedKg, costPerKg, currencyCode: reqCurrency, fxRateToUsd: reqFxRate, notes,
        commissionAmount: reqCommAmount, commissionCurrencyCode: reqCommCurrency,
        commissionFxRateToUsd: reqCommFxRate } = req.body;

      if (!supplierName || !String(supplierName).trim()) return res.status(400).json({ message: "Supplier name is required" });
      if (!receivedKg || parseFloat(receivedKg) <= 0) return res.status(400).json({ message: "Received KG must be positive" });
      if (!costPerKg || parseFloat(costPerKg) < 0) return res.status(400).json({ message: "Cost per KG must be non-negative" });

      const currencyCode = reqCurrency || "USD";
      const fxRate = parseFloat(reqFxRate || "1");
      const kgVal = parseFloat(receivedKg);
      const rateVal = parseFloat(costPerKg);
      const costPerKgUsd = currencyCode === "USD" ? rateVal : rateVal * fxRate;
      const totalPayable = kgVal * rateVal;
      const totalPayableUsd = kgVal * costPerKgUsd;
      const trimmedSupplierName = String(supplierName).trim();

      const result = await db.transaction(async (tx: any) => {
        // Use supplierId directly if provided, otherwise find-or-create by name
        let existingSupplier: any = null;
        if (reqSupplierId) {
          const [found] = await tx
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, parseInt(reqSupplierId)), eq(factorySuppliers.companyId, companyId)))
            .limit(1);
          existingSupplier = found;
          if (!existingSupplier) return res.status(404).json({ message: "Supplier not found" });
        } else {
          const [found] = await tx
            .select()
            .from(factorySuppliers)
            .where(and(
              eq(factorySuppliers.companyId, companyId),
              sql`lower(${factorySuppliers.name}) = lower(${trimmedSupplierName})`
            ))
            .limit(1);
          if (found) {
            existingSupplier = found;
          } else {
            const [newSupplier] = await tx
              .insert(factorySuppliers)
              .values({ companyId, name: trimmedSupplierName, isActive: true })
              .returning();
            existingSupplier = newSupplier;
          }
        }

        const year = new Date().getFullYear();
        const existingOBs = await tx
          .select({ containerNumber: factoryContainers.containerNumber })
          .from(factoryContainers)
          .where(and(eq(factoryContainers.companyId, companyId), sql`${factoryContainers.containerNumber} LIKE ${"OB-" + year + "-%"}`));

        let nextNum = 1;
        for (const c of existingOBs) {
          const parts = c.containerNumber.split("-");
          const num = parseInt(parts[2]) || 0;
          if (num >= nextNum) nextNum = num + 1;
        }
        const containerNumber = `OB-${year}-${String(nextNum).padStart(4, "0")}`;

        const [container] = await tx
          .insert(factoryContainers)
          .values({
            companyId,
            containerNumber,
            supplierId: existingSupplier.id,
            origin: "Opening Balance",
            totalKg: String(kgVal),
            ratePerKg: String(rateVal),
            declaredKg: String(kgVal),
            actualReceivedKg: String(kgVal),
            finalPayableAmount: String(totalPayable),
            differenceKg: "0",
            currencyCode,
            fxRateToUsd: String(fxRate),
            ratePerKgUsd: String(costPerKgUsd),
            finalPayableAmountUsd: String(totalPayableUsd),
            notes: notes || "Opening balance import",
            status: "OPENING_BALANCE",
          })
          .returning();

        // Commission processing — auto-create/reuse "[SupplierName] Commission" sub-account
        const hasCommission = reqCommAmount && parseFloat(reqCommAmount) > 0;
        const commCurrency = reqCommCurrency || "USD";
        const commFxRate = parseFloat(reqCommFxRate || "1");
        const commAmountNum = hasCommission ? parseFloat(reqCommAmount) : 0;
        const commAmountUsd = hasCommission ? (commCurrency === "USD" ? commAmountNum : commAmountNum * commFxRate) : 0;

        let commissionSupplierId: number | null = null;
        if (hasCommission && existingSupplier) {
          const commName = `${existingSupplier.name} Commission`;
          const [existing] = await tx
            .select()
            .from(factorySuppliers)
            .where(and(
              eq(factorySuppliers.companyId, companyId),
              eq((factorySuppliers as any).parentId, existingSupplier.id),
              sql`lower(${factorySuppliers.name}) = lower(${commName})`
            ))
            .limit(1);
          if (existing) {
            commissionSupplierId = existing.id;
          } else {
            const [created] = await tx
              .insert(factorySuppliers)
              .values({ companyId, name: commName, isActive: true, parentId: existingSupplier.id } as any)
              .returning();
            commissionSupplierId = created.id;
          }
        }

        const [rawStock] = await tx
          .insert(factoryRawStock)
          .values({
            companyId,
            containerId: container.id,
            receivedKg: String(kgVal),
            costPerKg: String(rateVal),
            costPerKgUsd: String(costPerKgUsd),
            ...(hasCommission ? {
              commissionAmount: String(commAmountNum),
              commissionCurrencyCode: commCurrency,
              commissionFxRateToUsd: String(commFxRate),
              commissionAmountUsd: String(commAmountUsd),
              commissionSupplierId,
            } : {}),
          })
          .returning();

        const today = new Date().toISOString().split('T')[0];
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: "OPENING_BALANCE_RAW",
          referenceId: rawStock.id,
          description: `Opening balance: ${containerNumber} - ${kgVal} kg at ${rateVal}/kg (${currencyCode})`,
          currencyCode,
          amountCurrency: totalPayable,
          fxRateToUsd: fxRate,
        });

        return { container, rawStock };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating opening balance:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // GET a single opening-balance raw stock record
  app.get("/api/factory/raw-stock/opening-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [row] = await db
        .select({
          id: factoryRawStock.id,
          containerId: factoryRawStock.containerId,
          receivedKg: factoryRawStock.receivedKg,
          usedKg: factoryRawStock.usedKg,
          costPerKg: factoryRawStock.costPerKg,
          costPerKgUsd: factoryRawStock.costPerKgUsd,
          containerNumber: factoryContainers.containerNumber,
          containerStatus: factoryContainers.status,
          currencyCode: factoryContainers.currencyCode,
          fxRateToUsd: factoryContainers.fxRateToUsd,
          notes: factoryContainers.notes,
          origin: factoryContainers.origin,
          supplierId: factoryContainers.supplierId,
          supplierName: factorySuppliers.name,
        })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryContainers.supplierId, factorySuppliers.id))
        .where(and(eq(factoryRawStock.id, id), eq(factoryRawStock.companyId, companyId)))
        .limit(1);

      if (!row) return res.status(404).json({ message: "Raw stock record not found" });
      if (row.containerStatus !== "OPENING_BALANCE") {
        return res.status(400).json({ message: "This record is not an opening balance entry" });
      }

      const received = parseFloat(row.receivedKg as string) || 0;
      const used = parseFloat(row.usedKg as string) || 0;

      res.json({ ...row, remainingKg: (received - used).toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching opening balance record:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH a single opening-balance raw stock record
  app.patch("/api/factory/raw-stock/opening-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const { supplierId: reqSupplierId, supplierName, receivedKg, costPerKg, currencyCode, fxRateToUsd, notes,
              commissionAmount, commissionCurrencyCode, commissionPersonName, commissionNotes, commissionFxRateToUsd } = req.body;

      if (receivedKg !== undefined && parseFloat(receivedKg) <= 0) {
        return res.status(400).json({ message: "Received KG must be positive" });
      }
      if (costPerKg !== undefined && parseFloat(costPerKg) < 0) {
        return res.status(400).json({ message: "Cost per KG must be non-negative" });
      }
      if (fxRateToUsd !== undefined && parseFloat(fxRateToUsd) <= 0) {
        return res.status(400).json({ message: "FX rate must be positive" });
      }

      const [rawStockRow] = await db
        .select({ id: factoryRawStock.id, containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .where(and(
          eq(factoryRawStock.id, id),
          eq(factoryRawStock.companyId, companyId),
          eq(factoryContainers.status, "OPENING_BALANCE")
        ))
        .limit(1);

      if (!rawStockRow) return res.status(404).json({ message: "Opening balance record not found" });

      await db.transaction(async (tx: any) => {
        const rawUpdates: Record<string, any> = {};
        const containerUpdates: Record<string, any> = {};

        if (receivedKg !== undefined) {
          rawUpdates.receivedKg = String(parseFloat(receivedKg));
          containerUpdates.totalKg = String(parseFloat(receivedKg));
          containerUpdates.declaredKg = String(parseFloat(receivedKg));
          containerUpdates.actualReceivedKg = String(parseFloat(receivedKg));
        }

        const effectiveCurrency = currencyCode || undefined;
        const effectiveFx = fxRateToUsd !== undefined ? parseFloat(fxRateToUsd) : undefined;
        const effectiveCost = costPerKg !== undefined ? parseFloat(costPerKg) : undefined;

        if (effectiveCost !== undefined) {
          rawUpdates.costPerKg = String(effectiveCost);
          containerUpdates.ratePerKg = String(effectiveCost);
        }
        if (effectiveCurrency !== undefined) containerUpdates.currencyCode = effectiveCurrency;
        if (effectiveFx !== undefined) containerUpdates.fxRateToUsd = String(effectiveFx);

        if (effectiveCost !== undefined || effectiveFx !== undefined || effectiveCurrency !== undefined) {
          const [current] = await tx
            .select({ costPerKg: factoryRawStock.costPerKg, currencyCode: factoryContainers.currencyCode, fxRateToUsd: factoryContainers.fxRateToUsd })
            .from(factoryRawStock)
            .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
            .where(eq(factoryRawStock.id, id))
            .limit(1);

          const resolvedCost = effectiveCost ?? parseFloat(current?.costPerKg || "0");
          const resolvedFx = effectiveFx ?? parseFloat(current?.fxRateToUsd || "1");
          const resolvedCurrency = effectiveCurrency ?? current?.currencyCode ?? "USD";
          const costUsd = resolvedCurrency === "USD" ? resolvedCost : resolvedCost * resolvedFx;
          rawUpdates.costPerKgUsd = String(costUsd);
          containerUpdates.ratePerKgUsd = String(costUsd);
        }

        if (notes !== undefined) containerUpdates.notes = notes;

        // Phase 4: commission field edits on OB raw-stock
        if (commissionAmount !== undefined) rawUpdates.commissionAmount = String(parseFloat(commissionAmount));
        if (commissionCurrencyCode !== undefined) rawUpdates.commissionCurrencyCode = commissionCurrencyCode;
        if (commissionPersonName !== undefined) rawUpdates.commissionPersonName = commissionPersonName;
        if (commissionNotes !== undefined) rawUpdates.commissionNotes = commissionNotes;
        if (commissionFxRateToUsd !== undefined) rawUpdates.commissionFxRateToUsd = String(parseFloat(commissionFxRateToUsd));
        if (commissionAmount !== undefined || commissionFxRateToUsd !== undefined || commissionCurrencyCode !== undefined) {
          const [cur] = await tx.select({ commissionCurrencyCode: factoryRawStock.commissionCurrencyCode, commissionFxRateToUsd: factoryRawStock.commissionFxRateToUsd })
            .from(factoryRawStock).where(eq(factoryRawStock.id, id)).limit(1);
          const resolvedCommCurr = commissionCurrencyCode ?? cur?.commissionCurrencyCode ?? "USD";
          const resolvedCommFx = parseFloat(commissionFxRateToUsd ?? cur?.commissionFxRateToUsd ?? "1");
          const resolvedCommAmt = parseFloat(commissionAmount ?? "0");
          rawUpdates.commissionAmountUsd = resolvedCommCurr === "USD" ? String(resolvedCommAmt) : String(resolvedCommAmt * resolvedCommFx);
        }

        if (reqSupplierId !== undefined) {
          const [sup] = await tx
            .select({ id: factorySuppliers.id })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.id, parseInt(reqSupplierId)), eq(factorySuppliers.companyId, companyId)))
            .limit(1);
          if (!sup) throw new Error("Supplier not found");
          containerUpdates.supplierId = sup.id;
        } else if (supplierName !== undefined) {
          const trimmed = String(supplierName).trim();
          const [found] = await tx
            .select({ id: factorySuppliers.id })
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), sql`lower(${factorySuppliers.name}) = lower(${trimmed})`))
            .limit(1);
          if (found) {
            containerUpdates.supplierId = found.id;
          } else {
            const [created] = await tx
              .insert(factorySuppliers)
              .values({ companyId, name: trimmed, isActive: true })
              .returning();
            containerUpdates.supplierId = created.id;
          }
        }

        if (Object.keys(rawUpdates).length > 0) {
          await tx.update(factoryRawStock).set(rawUpdates).where(eq(factoryRawStock.id, id));
        }
        if (Object.keys(containerUpdates).length > 0) {
          await tx.update(factoryContainers).set(containerUpdates).where(eq(factoryContainers.id, rawStockRow.containerId));
        }
      });

      res.json({ message: "Opening balance updated successfully" });
    } catch (error: any) {
      console.error("Error updating opening balance:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // DELETE a single opening-balance raw stock record (bale-safe)
  app.delete("/api/factory/raw-stock/opening-balance/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

      const [rawStockRow] = await db
        .select({ id: factoryRawStock.id, containerId: factoryRawStock.containerId, containerStatus: factoryContainers.status })
        .from(factoryRawStock)
        .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
        .where(and(eq(factoryRawStock.id, id), eq(factoryRawStock.companyId, companyId)))
        .limit(1);

      if (!rawStockRow) return res.status(404).json({ message: "Raw stock record not found" });
      if (rawStockRow.containerStatus !== "OPENING_BALANCE") {
        return res.status(400).json({ message: "This record is not an opening balance entry and cannot be deleted through this endpoint" });
      }

      await db.transaction(async (tx: any) => {
        // Safely detach: null out containerId on mix batch sources referencing this container
        await tx
          .update(factoryMixBatchSources)
          .set({ containerId: null })
          .where(eq(factoryMixBatchSources.containerId, rawStockRow.containerId));

        // Delete the raw stock row
        await tx.delete(factoryRawStock).where(eq(factoryRawStock.id, id));

        // Soft-delete the container by changing its status
        await tx
          .update(factoryContainers)
          .set({ status: "DELETED" })
          .where(eq(factoryContainers.id, rawStockRow.containerId));
      });

      res.json({ message: "Opening balance deleted. Linked bales remain intact." });
    } catch (error: any) {
      console.error("Error deleting opening balance:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all bales with no mix batch link (unlinked / not yet sourced from raw stock)
  app.get("/api/factory/bales/unlinked", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const bales = await db
        .select({
          id: factoryBales.id,
          baleCode: factoryBales.baleCode,
          referenceNumber: factoryBales.referenceNumber,
          productName: factoryBales.productName,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
          pressedAt: factoryBales.pressedAt,
        })
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            sql`${factoryBales.mixBatchId} IS NULL`,
            inArray(factoryBales.status, ["IN_STOCK", "FINALIZED"]),
          ),
        )
        .orderBy(desc(factoryBales.pressedAt));

      res.json(bales);
    } catch (error: any) {
      console.error("Error fetching unlinked bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Assign opening balance raw stock to already-pressed bales
  app.post("/api/factory/raw-stock/:rawStockId/assign-to-bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rawStockId = parseInt(req.params.rawStockId);
      const { baleIds } = req.body as { baleIds: number[] };

      if (!Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds must be a non-empty array" });
      }

      // Fetch the raw stock record
      const [rs] = await db
        .select()
        .from(factoryRawStock)
        .where(and(eq(factoryRawStock.id, rawStockId), eq(factoryRawStock.companyId, companyId)));

      if (!rs) return res.status(404).json({ message: "Raw stock record not found" });

      // Validate all bales exist, belong to this company, and have no mix batch
      const bales = await db
        .select({ id: factoryBales.id, weightKg: factoryBales.weightKg, mixBatchId: factoryBales.mixBatchId })
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

      if (bales.length !== baleIds.length) {
        return res.status(400).json({ message: "One or more bale IDs are invalid or belong to another company" });
      }
      const alreadyLinked = bales.filter((b) => b.mixBatchId !== null);
      if (alreadyLinked.length > 0) {
        return res.status(400).json({ message: `${alreadyLinked.length} bale(s) are already linked to a mix batch` });
      }

      const totalKg = bales.reduce((sum, b) => sum + parseFloat(b.weightKg as string), 0);
      const availableKg = parseFloat(rs.receivedKg as string) - parseFloat(rs.usedKg as string);

      if (totalKg > availableKg + 0.001) {
        return res.status(400).json({
          message: `Not enough available kg (need ${totalKg.toFixed(3)}, have ${availableKg.toFixed(3)})`,
        });
      }

      const costPerKg = parseFloat(rs.costPerKg as string);
      const totalCost = totalKg * costPerKg;
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        // 1. Create a completed mix batch to represent this OB assignment
        const obBatchCode = `OB-ASSIGN-${rawStockId}-${Date.now()}`;
        const [newBatch] = await tx
          .insert(factoryMixBatches)
          .values({
            companyId,
            batchCode: obBatchCode,
            batchNumber: obBatchCode,
            name: "OB Stock Assignment",
            totalWeightKg: totalKg.toFixed(3),
            usedKg: totalKg.toFixed(3),
            costPerKg: rs.costPerKg,
            totalCost: totalCost.toFixed(2),
            status: "COMPLETED",
            updatedAt: now,
          })
          .returning({ id: factoryMixBatches.id });

        // 2. Link the OB container as the source of this mix batch
        await tx.insert(factoryMixBatchSources).values({
          mixBatchId: newBatch.id,
          containerId: rs.containerId,
          weightKg: totalKg.toFixed(3),
          costPerKg: rs.costPerKg,
          totalCost: totalCost.toFixed(2),
        });

        // 3. Assign the mix batch to each bale
        await tx
          .update(factoryBales)
          .set({ mixBatchId: newBatch.id, updatedAt: now })
          .where(inArray(factoryBales.id, baleIds));

        // 4. Increment usedKg on the raw stock record
        await tx
          .update(factoryRawStock)
          .set({ usedKg: sql`${factoryRawStock.usedKg} + ${totalKg.toFixed(3)}` })
          .where(eq(factoryRawStock.id, rawStockId));

        return { mixBatchId: newBatch.id };
      });

      res.json({ success: true, mixBatchId: result.mixBatchId, totalKg, balesUpdated: baleIds.length });
    } catch (error: any) {
      console.error("Error assigning raw stock to bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Recalculate usedKg for all factory_raw_stock records based on finalized bales
  app.post("/api/factory/raw-stock/recalculate-used", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allRawStock = await db
        .select({ id: factoryRawStock.id, containerId: factoryRawStock.containerId })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      if (allRawStock.length === 0) return res.json({ updated: 0 });

      const containerIds = allRawStock.map((r: any) => r.containerId);

      // Get mix batch sources that reference these containers
      const sources = await db
        .select({
          containerId: factoryMixBatchSources.containerId,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          weightKg: factoryMixBatchSources.weightKg,
        })
        .from(factoryMixBatchSources)
        .where(inArray(factoryMixBatchSources.containerId, containerIds));

      // Get finalized bales per mix batch
      const mixBatchIds = [...new Set(sources.map((s: any) => s.mixBatchId))] as number[];
      let baleWeightByMix: Record<number, number> = {};
      if (mixBatchIds.length > 0) {
        const bales = await db
          .select({ mixBatchId: factoryBales.mixBatchId, weightKg: factoryBales.weightKg })
          .from(factoryBales)
          .where(and(
            eq(factoryBales.companyId, companyId),
            eq(factoryBales.status, "FINALIZED"),
            inArray(factoryBales.mixBatchId, mixBatchIds)
          ));
        for (const b of bales) {
          if (!b.mixBatchId) continue;
          baleWeightByMix[b.mixBatchId] = (baleWeightByMix[b.mixBatchId] || 0) + parseFloat(b.weightKg);
        }
      }

      // Compute used KG per raw stock record proportionally
      let updated = 0;
      const now = new Date();
      for (const rs of allRawStock) {
        const relatedSources = sources.filter((s: any) => s.containerId === rs.containerId);
        let usedKg = 0;
        for (const src of relatedSources) {
          const mixTotal = sources.filter((s: any) => s.mixBatchId === src.mixBatchId)
            .reduce((sum: number, s: any) => sum + parseFloat(s.weightKg), 0);
          const baleWeight = baleWeightByMix[src.mixBatchId] || 0;
          if (mixTotal > 0) {
            const proportion = parseFloat(src.weightKg) / mixTotal;
            usedKg += proportion * baleWeight;
          }
        }
        await db
          .update(factoryRawStock)
          .set({ usedKg: String(usedKg.toFixed(3)), updatedAt: now } as any)
          .where(eq(factoryRawStock.id, rs.id));
        updated++;
      }

      res.json({ updated, message: `Recalculated used KG for ${updated} raw stock records.` });
    } catch (error: any) {
      console.error("Error recalculating raw stock used:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6. Factory Mix Batches
  // ───────────────────────────────────────────────

  app.get("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryMixBatches)
        .where(eq(factoryMixBatches.companyId, companyId))
        .orderBy(desc(factoryMixBatches.createdAt));

      const enriched = results.map((b: any) => {
        const total = parseFloat(b.totalWeightKg) || 0;
        const used = parseFloat(b.usedKg) || 0;
        return { ...b, remainingKg: (total - used).toFixed(3) };
      });

      res.json(enriched);
    } catch (error: any) {
      console.error("Error fetching mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const total = parseFloat(batch.totalWeightKg) || 0;
      const used = parseFloat(batch.usedKg) || 0;
      res.json({ ...batch, remainingKg: (total - used).toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const { name, notes } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name?.trim() || null;
      if (notes !== undefined) updates.notes = notes?.trim() || null;

      const [updated] = await db
        .update(factoryMixBatches)
        .set(updates)
        .where(eq(factoryMixBatches.id, id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      await db.transaction(async (tx: any) => {
        const [batch] = await tx
          .select()
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

        if (!batch) throw new Error("Mix batch not found");

        // 1. Unlink bales (set mixBatchId = NULL, preserve bales themselves)
        await tx
          .update(factoryBales)
          .set({ mixBatchId: null })
          .where(and(eq(factoryBales.mixBatchId, id), eq(factoryBales.companyId, companyId)));

        // 2. Reverse used_kg on each source
        const sources = await tx
          .select()
          .from(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        for (const src of sources) {
          if (src.containerId) {
            // Reverse used_kg on the raw stock container row
            const [rsRow] = await tx
              .select()
              .from(factoryRawStock)
              .where(eq(factoryRawStock.containerId, src.containerId));
            if (rsRow) {
              const newUsed = Math.max(0, parseFloat(rsRow.usedKg) - parseFloat(src.weightKg));
              await tx
                .update(factoryRawStock)
                .set({ usedKg: newUsed.toFixed(3) })
                .where(eq(factoryRawStock.id, rsRow.id));
            }
          } else if (src.sourceBatchId) {
            // Reverse used_kg on source batch and restore to ACTIVE
            const [srcBatch] = await tx
              .select()
              .from(factoryMixBatches)
              .where(eq(factoryMixBatches.id, src.sourceBatchId));
            if (srcBatch) {
              const newUsed = Math.max(0, parseFloat(srcBatch.usedKg) - parseFloat(src.weightKg));
              await tx
                .update(factoryMixBatches)
                .set({ usedKg: newUsed.toFixed(3), status: "ACTIVE" })
                .where(eq(factoryMixBatches.id, src.sourceBatchId));
            }
          }
        }

        // 3. Delete sources
        await tx
          .delete(factoryMixBatchSources)
          .where(eq(factoryMixBatchSources.mixBatchId, id));

        // 4. Delete the batch
        await tx
          .delete(factoryMixBatches)
          .where(eq(factoryMixBatches.id, id));
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { supplierSources = [], openingBatchId, name, notes,
              sources = [], batchSources = [], operatorUser, batchDate } = req.body;

      const hasSupplierSources = supplierSources.length > 0;
      const hasOpeningBatch = openingBatchId && openingBatchId !== "none";
      const hasLegacySources = sources.length > 0 || batchSources.length > 0;

      if (!hasSupplierSources && !hasOpeningBatch && !hasLegacySources) {
        return res.status(400).json({ message: "At least one source is required" });
      }

      const result = await db.transaction(async (tx: any) => {
        const year = new Date().getFullYear();
        const existingBatches = await tx
          .select({ batchCode: factoryMixBatches.batchCode })
          .from(factoryMixBatches)
          .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`));

        let nextNum = 1;
        for (const b of existingBatches) {
          const parts = b.batchCode.split("-");
          const num = parseInt(parts[2]) || 0;
          if (num >= nextNum) nextNum = num + 1;
        }
        const batchCode = `FMB-${year}-${String(nextNum).padStart(4, "0")}`;

        let totalWeightKg = 0;
        let totalCost = 0;
        const sourceRecords: any[] = [];

        if (hasOpeningBatch) {
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, openingBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");

          if (!srcBatch) throw new Error(`Opening batch not found`);

          const remaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          if (remaining <= 0.001) throw new Error(`Opening batch has no remaining stock`);

          const cost = parseFloat(srcBatch.costPerKg);

          await tx
            .update(factoryMixBatches)
            .set({
              usedKg: srcBatch.totalWeightKg,
              status: "CLOSED",
              updatedAt: new Date(),
            })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          totalWeightKg += remaining;
          totalCost += remaining * cost;
          sourceRecords.push({
            sourceBatchId: srcBatch.id,
            weightKg: String(remaining),
            costPerKg: String(cost),
            totalCost: String(remaining * cost),
          });
        }

        for (const source of supplierSources) {
          const { supplierId, weightKg, costPerKg: srcCostPerKg } = source;
          const weight = parseFloat(weightKg);

          const supplierRawStocks = await tx
            .select({
              id: factoryRawStock.id,
              receivedKg: factoryRawStock.receivedKg,
              usedKg: factoryRawStock.usedKg,
              costPerKg: factoryRawStock.costPerKg,
              costPerKgUsd: factoryRawStock.costPerKgUsd,
              containerId: factoryRawStock.containerId,
              offloadedAt: factoryRawStock.offloadedAt,
            })
            .from(factoryRawStock)
            .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
            .where(and(
              eq(factoryRawStock.companyId, companyId),
              eq(factoryContainers.supplierId, supplierId)
            ))
            .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id)
            .for("update");

          let totalAvailable = 0;
          let weightedCostSum = 0;
          let weightedCostWeight = 0;
          for (const rs of supplierRawStocks) {
            const avail = Math.max(0, parseFloat(rs.receivedKg) - parseFloat(rs.usedKg));
            totalAvailable += avail;
            const rsCost = parseFloat(rs.costPerKgUsd || rs.costPerKg);
            weightedCostSum += avail * rsCost;
            weightedCostWeight += avail;
          }

          let remaining = weight;
          for (const rs of supplierRawStocks) {
            if (remaining <= 0.001) break;
            const avail = parseFloat(rs.receivedKg) - parseFloat(rs.usedKg);
            if (avail <= 0) continue;

            const deduct = Math.min(remaining, avail);
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${deduct}` })
              .where(eq(factoryRawStock.id, rs.id));

            remaining -= deduct;
          }

          if (remaining > 0.001 && supplierRawStocks.length > 0) {
            const lastRs = supplierRawStocks[supplierRawStocks.length - 1];
            await tx
              .update(factoryRawStock)
              .set({ usedKg: sql`${factoryRawStock.usedKg} + ${remaining}` })
              .where(eq(factoryRawStock.id, lastRs.id));
            remaining = 0;
          }

          const costPerKg = weightedCostWeight > 0 ? weightedCostSum / weightedCostWeight : 0;
          totalWeightKg += weight;
          totalCost += weight * costPerKg;
          sourceRecords.push({
            supplierId,
            weightKg: String(weight),
            costPerKg: String(costPerKg),
            totalCost: String(weight * costPerKg),
          });
        }

        for (const source of sources) {
          const { containerId, weightKg, costPerKg: srcCostPerKg } = source;
          const [rawStock] = await tx
            .select()
            .from(factoryRawStock)
            .where(and(eq(factoryRawStock.companyId, companyId), eq(factoryRawStock.containerId, containerId)))
            .for("update");

          if (!rawStock) throw new Error(`Raw stock not found for container ${containerId}`);

          const containerRemaining = parseFloat(rawStock.receivedKg) - parseFloat(rawStock.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > containerRemaining + 0.001) {
            throw new Error(`Not enough raw stock for container ${containerId}. Available: ${containerRemaining.toFixed(3)} kg`);
          }

          const costUsd = srcCostPerKg ? parseFloat(srcCostPerKg) : parseFloat(rawStock.costPerKgUsd || rawStock.costPerKg);

          await tx
            .update(factoryRawStock)
            .set({ usedKg: sql`${factoryRawStock.usedKg} + ${weight}` })
            .where(eq(factoryRawStock.id, rawStock.id));

          totalWeightKg += weight;
          totalCost += weight * costUsd;
          sourceRecords.push({ containerId, weightKg: String(weight), costPerKg: String(costUsd), totalCost: String(weight * costUsd) });
        }

        for (const bSource of batchSources) {
          const { sourceBatchId, weightKg } = bSource;
          const [srcBatch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, sourceBatchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");

          if (!srcBatch) throw new Error(`Source batch ${sourceBatchId} not found`);

          const batchRemaining = parseFloat(srcBatch.totalWeightKg) - parseFloat(srcBatch.usedKg);
          const weight = parseFloat(weightKg);
          if (weight > batchRemaining + 0.001) {
            throw new Error(`Not enough in batch ${srcBatch.batchCode}. Available: ${batchRemaining.toFixed(3)} kg`);
          }

          const cost = parseFloat(srcBatch.costPerKg);

          await tx
            .update(factoryMixBatches)
            .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${weight}`, updatedAt: new Date() })
            .where(eq(factoryMixBatches.id, srcBatch.id));

          totalWeightKg += weight;
          totalCost += weight * cost;
          sourceRecords.push({ sourceBatchId, weightKg: String(weight), costPerKg: String(cost), totalCost: String(weight * cost) });
        }

        const blendedCostPerKg = totalWeightKg > 0 ? totalCost / totalWeightKg : 0;

        const [mixBatch] = await tx
          .insert(factoryMixBatches)
          .values({
            companyId,
            batchCode,
            batchNumber: batchCode,
            name: name || null,
            totalWeightKg: String(totalWeightKg),
            costPerKg: String(blendedCostPerKg),
            totalCost: String(totalCost),
            notes: notes || null,
            operatorUser: operatorUser || null,
            batchDate: batchDate || null,
            status: "OPEN",
          } as any)
          .returning();

        for (const sr of sourceRecords) {
          await tx.insert(factoryMixBatchSources).values({
            mixBatchId: mixBatch.id,
            containerId: sr.containerId || null,
            supplierId: sr.supplierId || null,
            sourceBatchId: sr.sourceBatchId || null,
            sourceType: sr.sourceBatchId ? "BATCH" : sr.containerId ? "CONTAINER" : "SUPPLIER",
            sourceId: sr.supplierId || sr.containerId || sr.sourceBatchId || null,
            weightKg: sr.weightKg,
            quantityKg: sr.weightKg,
            costPerKg: sr.costPerKg,
            totalCost: sr.totalCost,
          });
        }

        return mixBatch;
      });

      const mbToday = new Date().toISOString().split('T')[0];
      await writeDaybookEntry(db, {
        companyId,
        txDate: mbToday,
        txType: "MIX_BATCH_CREATED",
        referenceId: result.id,
        description: `Mix batch created: ${result.batchCode}${result.name ? ` – ${result.name}` : ""} (${parseFloat(result.totalWeightKg || "0").toFixed(1)} kg)`,
        amountCurrency: parseFloat(result.totalCost || "0"),
        amountUsd: parseFloat(result.totalCost || "0"),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error creating mix batch:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // Assign existing (unlinked) bales to a mix batch
  app.post("/api/factory/mix-batches/:id/assign-bales", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const mixBatchId = parseInt(req.params.id);
      const { baleIds } = req.body as { baleIds: number[] };

      if (!Array.isArray(baleIds) || baleIds.length === 0) {
        return res.status(400).json({ message: "baleIds must be a non-empty array" });
      }

      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, mixBatchId), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const bales = await db
        .select({ id: factoryBales.id, weightKg: factoryBales.weightKg, mixBatchId: factoryBales.mixBatchId })
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, baleIds)));

      if (bales.length !== baleIds.length) {
        return res.status(400).json({ message: "One or more bale IDs are invalid" });
      }
      const alreadyLinked = bales.filter((b) => b.mixBatchId !== null);
      if (alreadyLinked.length > 0) {
        return res.status(400).json({ message: `${alreadyLinked.length} bale(s) are already linked to a mix batch` });
      }

      const totalKg = bales.reduce((sum, b) => sum + parseFloat(b.weightKg as string), 0);
      const availableKg = parseFloat(batch.totalWeightKg as string) - parseFloat(batch.usedKg as string);

      if (totalKg > availableKg + 0.001) {
        return res.status(400).json({
          message: `Not enough remaining kg in this batch (need ${totalKg.toFixed(3)}, have ${availableKg.toFixed(3)})`,
        });
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(factoryBales)
          .set({ mixBatchId, updatedAt: now })
          .where(inArray(factoryBales.id, baleIds));

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalKg.toFixed(3)}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));
      });

      res.json({ success: true, balesUpdated: baleIds.length, totalKg });
    } catch (error: any) {
      console.error("Error assigning bales to mix batch:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/mix-batches/:id/sources", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const results = await db
        .select({
          id: factoryMixBatchSources.id,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          containerId: factoryMixBatchSources.containerId,
          sourceBatchId: factoryMixBatchSources.sourceBatchId,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          createdAt: factoryMixBatchSources.createdAt,
          containerNumber: factoryContainers.containerNumber,
        })
        .from(factoryMixBatchSources)
        .leftJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
        .where(eq(factoryMixBatchSources.mixBatchId, id));

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching mix batch sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 6b. Mix Batch Daily Consumption
  // ───────────────────────────────────────────────

  app.post("/api/factory/mix-batches/consume", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { usages, operatorUser, usedDate } = req.body as {
        usages: Array<{ batchId: number; kgUsed: number; notes?: string }>;
        operatorUser?: string;
        usedDate: string;
      };

      if (!Array.isArray(usages) || usages.length === 0) {
        return res.status(400).json({ message: "usages array is required" });
      }
      if (!usedDate) return res.status(400).json({ message: "usedDate is required" });

      const results: any[] = [];
      await db.transaction(async (tx: any) => {
        for (const u of usages) {
          const { batchId, kgUsed, notes } = u;
          if (!batchId || !(kgUsed > 0)) continue;

          const [batch] = await tx
            .select()
            .from(factoryMixBatches)
            .where(and(eq(factoryMixBatches.id, batchId), eq(factoryMixBatches.companyId, companyId)))
            .for("update");
          if (!batch) throw new Error(`Batch ${batchId} not found`);

          const total = parseFloat(batch.totalWeightKg) || 0;
          const alreadyUsed = parseFloat(batch.usedKg) || 0;
          const remaining = total - alreadyUsed;

          if (kgUsed > remaining + 0.001) {
            throw new Error(`Cannot consume ${kgUsed} kg from batch ${batch.batchCode}: only ${remaining.toFixed(3)} kg remaining`);
          }

          const now = new Date();
          await tx.insert(factoryDailyUsages).values({
            companyId,
            mixBatchId: batchId,
            kgUsed: String(kgUsed),
            operatorUser: operatorUser || null,
            usedDate,
            notes: notes || null,
          } as any);

          const isFullyConsumed = kgUsed >= remaining - 0.001;

          if (isFullyConsumed) {
            await tx
              .update(factoryMixBatches)
              .set({ usedKg: batch.totalWeightKg, status: "CLOSED", updatedAt: now })
              .where(eq(factoryMixBatches.id, batchId));
            results.push({ batchId, action: "closed", carryForwardId: null });
          } else {
            const leftoverKg = remaining - kgUsed;
            const costPerKg = parseFloat(batch.costPerKg) || 0;
            const leftoverCost = leftoverKg * costPerKg;

            await tx
              .update(factoryMixBatches)
              .set({ usedKg: String(total), status: "CLOSED", updatedAt: now })
              .where(eq(factoryMixBatches.id, batchId));

            const year = new Date().getFullYear();
            const existingBatches = await tx
              .select({ batchCode: factoryMixBatches.batchCode })
              .from(factoryMixBatches)
              .where(and(eq(factoryMixBatches.companyId, companyId), sql`${factoryMixBatches.batchCode} LIKE ${"FMB-" + year + "-%"}`));
            let nextNum = 1;
            for (const b of existingBatches) {
              const parts = b.batchCode.split("-");
              const num = parseInt(parts[2]) || 0;
              if (num >= nextNum) nextNum = num + 1;
            }
            const newBatchCode = `FMB-${year}-${String(nextNum).padStart(4, "0")}`;

            const [cfBatch] = await tx
              .insert(factoryMixBatches)
              .values({
                companyId,
                batchCode: newBatchCode,
                batchNumber: newBatchCode,
                name: batch.name || null,
                totalWeightKg: String(leftoverKg),
                costPerKg: String(costPerKg),
                totalCost: String(leftoverCost),
                notes: batch.notes || null,
                operatorUser: operatorUser || batch.operatorUser || null,
                batchDate: usedDate || null,
                carryForwardFromId: batchId,
                status: "CARRY_FORWARD",
              } as any)
              .returning();

            results.push({ batchId, action: "carry_forward", carryForwardId: cfBatch.id, carryForwardCode: cfBatch.batchCode, leftoverKg });
          }
        }
      });

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Error consuming mix batches:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daily-report", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          operatorUser: factoryDailyUsages.operatorUser,
          usedDate: factoryDailyUsages.usedDate,
          notes: factoryDailyUsages.notes,
          createdAt: factoryDailyUsages.createdAt,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          costPerKg: factoryMixBatches.costPerKg,
        })
        .from(factoryDailyUsages)
        .innerJoin(factoryMixBatches, eq(factoryDailyUsages.mixBatchId, factoryMixBatches.id))
        .where(and(eq(factoryDailyUsages.companyId, companyId), sql`${factoryDailyUsages.usedDate} = ${date}`))
        .orderBy(factoryDailyUsages.createdAt);

      const totalKgUsed = usages.reduce((s: number, u: any) => s + (parseFloat(u.kgUsed) || 0), 0);
      res.json({ date, usages, totalKgUsed: totalKgUsed.toFixed(3) });
    } catch (error: any) {
      console.error("Error fetching daily report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daily-report/export", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const format = (req.query.format as string) || "excel";

      const usages = await db
        .select({
          id: factoryDailyUsages.id,
          mixBatchId: factoryDailyUsages.mixBatchId,
          kgUsed: factoryDailyUsages.kgUsed,
          operatorUser: factoryDailyUsages.operatorUser,
          usedDate: factoryDailyUsages.usedDate,
          notes: factoryDailyUsages.notes,
          createdAt: factoryDailyUsages.createdAt,
          batchCode: factoryMixBatches.batchCode,
          batchName: factoryMixBatches.name,
          costPerKg: factoryMixBatches.costPerKg,
        })
        .from(factoryDailyUsages)
        .innerJoin(factoryMixBatches, eq(factoryDailyUsages.mixBatchId, factoryMixBatches.id))
        .where(and(eq(factoryDailyUsages.companyId, companyId), sql`${factoryDailyUsages.usedDate} = ${date}`))
        .orderBy(factoryDailyUsages.createdAt);

      const totalKgUsed = usages.reduce((s: number, u: any) => s + (parseFloat(u.kgUsed) || 0), 0);

      if (format === "excel") {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Daily Report");

        sheet.columns = [
          { header: "Date", key: "date", width: 14 },
          { header: "Batch Code", key: "batchCode", width: 18 },
          { header: "Batch Name", key: "batchName", width: 28 },
          { header: "Operator", key: "operatorUser", width: 20 },
          { header: "KG Used", key: "kgUsed", width: 14 },
          { header: "Cost / KG", key: "costPerKg", width: 14 },
          { header: "Notes", key: "notes", width: 32 },
        ];

        const headerRow = sheet.getRow(1);
        headerRow.eachCell((cell) => {
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
        });

        for (const u of usages) {
          sheet.addRow({
            date: u.usedDate,
            batchCode: u.batchCode,
            batchName: u.batchName || "",
            operatorUser: u.operatorUser || "",
            kgUsed: parseFloat(u.kgUsed || "0"),
            costPerKg: parseFloat(u.costPerKg || "0"),
            notes: u.notes || "",
          });
        }

        const totalRow = sheet.addRow({
          date: "",
          batchCode: "TOTAL",
          batchName: "",
          operatorUser: "",
          kgUsed: totalKgUsed,
          costPerKg: "",
          notes: "",
        });
        totalRow.eachCell((cell) => { cell.font = { bold: true }; });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-daily-report-${date}.xlsx"`);
        await workbook.xlsx.write(res);
        return res.end();
      }

      if (format === "pdf") {
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 40, size: "A4" });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="raw-production-daily-report-${date}.pdf"`);
        doc.pipe(res);

        doc.fontSize(16).font("Helvetica-Bold").text("Raw Production Daily Report", { align: "center" });
        doc.fontSize(11).font("Helvetica").text(`Date: ${date}`, { align: "center" });
        doc.moveDown();

        const colX = [40, 140, 270, 360, 430, 490];
        const headers = ["Batch Code", "Batch Name", "Operator", "KG Used", "Cost/KG", "Notes"];

        doc.fontSize(9).font("Helvetica-Bold");
        headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { continued: i < headers.length - 1, width: colX[i + 1] ? colX[i + 1] - colX[i] - 4 : 80 }));
        doc.moveDown(0.3);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(0.3);

        doc.font("Helvetica").fontSize(9);
        for (const u of usages) {
          const y = doc.y;
          const cols = [
            u.batchCode,
            u.batchName || "—",
            u.operatorUser || "—",
            `${parseFloat(u.kgUsed || "0").toFixed(3)} kg`,
            `$${parseFloat(u.costPerKg || "0").toFixed(4)}`,
            u.notes || "—",
          ];
          cols.forEach((c, i) => {
            doc.text(String(c), colX[i], y, { width: colX[i + 1] ? colX[i + 1] - colX[i] - 4 : 60, lineBreak: false });
          });
          doc.moveDown(1);
        }

        doc.moveDown(0.5);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(10).text(`Total KG Consumed: ${totalKgUsed.toFixed(3)} kg`, { align: "right" });

        doc.end();
        return;
      }

      return res.status(400).json({ message: "Invalid format. Use excel or pdf." });
    } catch (error: any) {
      console.error("Error exporting daily report:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // 7. Factory Pressing (create-and-print)
  // ───────────────────────────────────────────────

  app.post("/api/factory/pressing/create-and-print", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
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
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100876 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `REF${String(nextNumber + i).padStart(5, '0')}`;
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
              status: "PENDING_PRESSING",
            })
            .returning();
          bales.push(bale);
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = new Date().toISOString().split('T')[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100876 + totalExpected,
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
            const refNum = `REF${String(nextNumber + baleIndex).padStart(5, '0')}`;
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
                status: "PENDING_PRESSING",
              })
              .returning();
            bales.push({ ...bale, _product: product });
            baleIndex++;
          }
        }

        return { pressingBatchId: pressingBatch.id, bales };
      });

      const today = new Date().toISOString().split('T')[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100876 + quantity,
          });
        }

        const bales: any[] = [];
        for (let i = 0; i < quantity; i++) {
          const refNum = `REF${String(nextNumber + i).padStart(5, '0')}`;
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
      const companyId = (req.session as any).currentCompanyId;
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
          const finalizedCount = balesForBatch.filter((b: any) => b.status === "FINALIZED").length;

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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { pressingBatchId, scannedBaleIds, erpLocationId, mixBatchId } = req.body;

      if (!pressingBatchId || !scannedBaleIds || !erpLocationId || !mixBatchId) {
        return res.status(400).json({ message: "pressingBatchId, scannedBaleIds, erpLocationId, and mixBatchId are required" });
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
          throw new Error(`Not enough mix batch remaining. Need ${totalWeight.toFixed(3)} kg but only ${mixRemaining.toFixed(3)} kg available`);
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
            const c = src.containerId && rawStockCostMap[src.containerId] !== undefined
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
              status: "FINALIZED",
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
              const cached = stockGroupCache.get(catName);
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
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
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

      const today = new Date().toISOString().split('T')[0];
      const [finalizeLocation] = await db.select({ name: locations.name }).from(locations).where(eq(locations.id, erpLocationId));
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const balesWithMix = await db
        .select({
          id: factoryBales.id,
          weightKg: factoryBales.weightKg,
          mixBatchId: factoryBales.mixBatchId,
          articleCode: factoryBales.articleCode,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          eq(factoryBales.status, "FINALIZED"),
          sql`${factoryBales.mixBatchId} IS NOT NULL`
        ));

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
        let totalCost = 0, totalWt = 0;
        for (const src of sources) {
          const w = parseFloat(src.weightKg);
          const c = src.containerId && rawStockCostMap[src.containerId] !== undefined
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
      const companyId = (req.session as any).currentCompanyId;
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
      const locs = locIds.length > 0
        ? await db.select().from(locations).where(inArray(locations.id, locIds))
        : [];
      const locMap = new Map(locs.map((l: any) => [l.id, l]));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Bales");

      sheet.columns = [
        { header: "Reference Number", key: "referenceNumber", width: 22 },
        { header: "Article Code", key: "articleCode", width: 20 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Category", key: "category", width: 18 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
        { header: "Cost Per Kg", key: "costPerKg", width: 14 },
        { header: "Total Cost", key: "totalCost", width: 14 },
        { header: "Location Code", key: "locationCode", width: 16 },
        { header: "Location ID", key: "locationId", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Mix Batch ID", key: "mixBatchId", width: 14 },
        { header: "Bale Code", key: "baleCode", width: 18 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Finalized At", key: "finalizedAt", width: 22 },
      ];

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      });

      for (const bale of bales) {
        const loc = locMap.get(bale.erpLocationId);
        sheet.addRow({
          referenceNumber: bale.referenceNumber,
          articleCode: bale.articleCode ?? "",
          productName: bale.productName ?? "",
          category: bale.category ?? "",
          weightKg: parseFloat(bale.weightKg || "0"),
          costPerKg: parseFloat(bale.costPerKg || "0"),
          totalCost: parseFloat(bale.totalCost || "0"),
          locationCode: loc ? `${loc.code} - ${loc.name}` : "",
          locationId: bale.erpLocationId ?? "",
          status: bale.status ?? "IN_STOCK",
          mixBatchId: bale.mixBatchId ?? "",
          baleCode: bale.baleCode ?? "",
          grade: bale.grade ?? "",
          finalizedAt: bale.finalizedAt ? new Date(bale.finalizedAt).toISOString() : "",
        });
      }

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bales_export_${date}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting full bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/reimport", requireAuth, async (req: any, res: any) => {
    const multer = (await import("multer")).default;
    const upload = multer({ storage: multer.memoryStorage() });
    upload.single("file")(req, res, async (err: any) => {
      if (err) return res.status(400).json({ message: "File upload error" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      try {
        const companyId = (req.session as any).currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.getWorksheet(1);
        if (!sheet) return res.status(400).json({ message: "No worksheet found in file" });

        const headers: string[] = [];
        sheet.getRow(1).eachCell((cell, colNumber) => {
          headers[colNumber] = String(cell.value || "").trim().toLowerCase();
        });

        const refIdx = headers.findIndex(h => h.includes("reference"));
        const articleIdx = headers.findIndex(h => h.includes("article"));
        const nameIdx = headers.findIndex(h => h.includes("product name"));
        const catIdx = headers.findIndex(h => h.includes("category"));
        const weightIdx = headers.findIndex(h => h.includes("weight"));
        const costPerKgIdx = headers.findIndex(h => h.includes("cost per kg"));
        const totalCostIdx = headers.findIndex(h => h.includes("total cost"));
        const locIdIdx = headers.findIndex(h => h.includes("location id"));
        const statusIdx = headers.findIndex(h => h.includes("status"));
        const mixBatchIdx = headers.findIndex(h => h.includes("mix batch"));
        const baleCodeIdx = headers.findIndex(h => h.includes("bale code"));
        const gradeIdx = headers.findIndex(h => h.includes("grade"));
        const finalizedIdx = headers.findIndex(h => h.includes("finalized"));

        if (refIdx < 0 || nameIdx < 0 || weightIdx < 0) {
          return res.status(400).json({ message: "Excel must have at least: Reference Number, Product Name, Weight (kg) columns" });
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
            costPerKg: costPerKgIdx >= 0 ? String(parseFloat(String(row.getCell(costPerKgIdx + 1).value || "0")) || "0") : "0",
            totalCost: totalCostIdx >= 0 ? String(parseFloat(String(row.getCell(totalCostIdx + 1).value || "0")) || "0") : "0",
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
          return res.status(400).json({ message: `Duplicate reference numbers within the file: ${fileDuplicates.slice(0, 10).join(", ")}` });
        }

        const result = await db.transaction(async (tx: any) => {
          const existingBarcodes = await tx
            .select({ referenceNumber: factoryBales.referenceNumber })
            .from(factoryBales)
            .where(eq(factoryBales.companyId, companyId));
          const existingRefSet = new Set(existingBarcodes.map((b: any) => b.referenceNumber));

          const duplicates = rows.filter(r => existingRefSet.has(r.referenceNumber));
          if (duplicates.length > 0) {
            throw new Error(`These reference numbers already exist: ${duplicates.slice(0, 10).map(d => d.referenceNumber).join(", ")}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ""}`);
          }

          const validLocIds = new Set<number>();
          const allLocs = await tx.select({ id: locations.id }).from(locations).where(eq(locations.companyId, companyId));
          allLocs.forEach((l: any) => validLocIds.add(l.id));

          const invalidLocRows = rows.filter(r => r.erpLocationId && !validLocIds.has(r.erpLocationId));
          if (invalidLocRows.length > 0) {
            throw new Error(`Invalid location IDs found: ${invalidLocRows.map(r => `${r.referenceNumber} (loc ${r.erpLocationId})`).slice(0, 5).join(", ")}`);
          }

          const allProducts = await tx
            .select()
            .from(factoryBaleProducts)
            .where(eq(factoryBaleProducts.companyId, companyId));
          const productByName = new Map(allProducts.map((p: any) => [p.name.toLowerCase(), p]));
          const productByArticle = new Map(allProducts.map((p: any) => [p.articleCode?.toLowerCase(), p]));

          const allCategories = await tx.select().from(factoryCategories).where(eq(factoryCategories.companyId, companyId));
          const categoryByName = new Map(allCategories.map((c: any) => [c.name?.toLowerCase(), c]));

          const createdBales: any[] = [];
          let totalWeight = 0;

          for (const row of rows) {
            let product = (row.articleCode ? productByArticle.get(row.articleCode.toLowerCase()) : null) || productByName.get(row.productName.toLowerCase());
            if (!product) {
              const autoCode = row.articleCode || ("IMP-" + row.productName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().substring(0, 20) + "-" + Date.now().toString(36).slice(-4).toUpperCase());
              const categoryObj = row.category ? categoryByName.get(row.category.toLowerCase()) : null;
              const [newProduct] = await tx.insert(factoryBaleProducts).values({
                companyId,
                code: autoCode,
                articleCode: row.articleCode || autoCode,
                name: row.productName,
                active: true,
                ...(categoryObj ? { categoryId: categoryObj.id } : {}),
              }).returning();
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
            if (bale.status === "REMOVED") continue;

            const itemCode: string = bale.articleCode || bale.baleCode;
            if (!itemCode) continue;
            const locId = bale.erpLocationId;
            if (!locId) continue;

            const product = bale._product;
            let stockGroupId: number | null = null;
            if (bale.category) {
              const catName = bale.category as string;
              const cached = stockGroupCache.get(catName);
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
                  const groupCode = "F-" + catName.replace(/[^A-Z0-9]/gi, "").substring(0, 10).toUpperCase();
                  const [created] = await tx
                    .insert(stockGroups)
                    .values({ companyId, name: catName, code: groupCode })
                    .returning({ id: stockGroups.id });
                  stockGroupId = created.id;
                }
                stockGroupCache.set(catName, stockGroupId!);
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

        const today = new Date().toISOString().split("T")[0];
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
      const companyId = (req.session as any).currentCompanyId;
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

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bale_names_${companyId}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting bale names:", error);
      res.status(500).json({ message: error.message });
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
        const companyId = (req.session as any).currentCompanyId;
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

          if (!id || isNaN(id)) { skipped++; continue; }
          if (!productName) { skipped++; continue; }

          const [bale] = await db
            .select()
            .from(factoryBales)
            .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));

          if (!bale) { errors.push(`Bale ID ${id} not found`); skipped++; continue; }

          if (bale.productId) {
            await db
              .update(factoryBaleProducts)
              .set({ name: productName, updatedAt: new Date() })
              .where(and(eq(factoryBaleProducts.id, bale.productId), eq(factoryBaleProducts.companyId, companyId)));
          }

          await db
            .update(factoryBales)
            .set({ productName, updatedAt: new Date() })
            .where(eq(factoryBales.id, id));

          updated++;
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { status, mixBatchId, pressingBatchId } = req.query;

      const conditions: any[] = [eq(factoryBales.companyId, companyId)];

      if (status) conditions.push(eq(factoryBales.status, status as string));
      if (mixBatchId) conditions.push(eq(factoryBales.mixBatchId, parseInt(mixBatchId as string)));
      if (pressingBatchId) conditions.push(eq(factoryBales.pressingBatchId, parseInt(pressingBatchId as string)));

      const bales = await db
        .select()
        .from(factoryBales)
        .where(and(...conditions))
        .orderBy(desc(factoryBales.createdAt));

      const productIds: number[] = Array.from(new Set(bales.map((b: any) => b.productId).filter(Boolean)));
      const batchIds: number[] = Array.from(new Set(bales.map((b: any) => b.mixBatchId).filter(Boolean)));

      const products = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds))
        : [];
      const batches = batchIds.length > 0
        ? await db.select().from(factoryMixBatches).where(inArray(factoryMixBatches.id, batchIds))
        : [];

      const productMap = new Map(products.map((p: any) => [p.id, p]));
      const batchMap = new Map(batches.map((b: any) => [b.id, b]));

      const baleIds = bales.map((b: any) => b.id).filter(Boolean);
      const lastPrintMap = new Map<number, string>();
      if (baleIds.length > 0) {
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

      res.json(results);
    } catch (error: any) {
      console.error("Error fetching factory bales:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/bulk-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { ids, status } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "ids must be a non-empty array" });
      if (!status || typeof status !== "string") return res.status(400).json({ message: "status is required" });

      const ALLOWED = ["PENDING_PRESSING","LABEL_PRINTED","PRESSED","FINALIZED","IN_STOCK","RESERVED","RESERVED_FOR_ORDER","SOLD","REPACKED","REMOVED"];
      if (!ALLOWED.includes(status)) return res.status(400).json({ message: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });

      const result = await db
        .update(factoryBales)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.id, ids.map(Number))))
        .returning({ id: factoryBales.id });

      res.json({ updated: result.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid bale ID" });

      const { status } = req.body;
      if (!status || typeof status !== "string") return res.status(400).json({ message: "status is required" });

      const ALLOWED = ["PENDING_PRESSING","LABEL_PRINTED","PRESSED","FINALIZED","IN_STOCK","RESERVED","RESERVED_FOR_ORDER","SOLD","REPACKED","REMOVED"];
      if (!ALLOWED.includes(status)) return res.status(400).json({ message: `Invalid status. Allowed: ${ALLOWED.join(", ")}` });

      const [updated] = await db
        .update(factoryBales)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)))
        .returning({ id: factoryBales.id, status: factoryBales.status });

      if (!updated) return res.status(404).json({ message: "Bale not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/product-name", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
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

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating bale product name:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/factory/bales/:id/assign-worker", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const id = parseInt(req.params.id);
      const { workerId } = req.body;
      if (!workerId) return res.status(400).json({ message: "workerId is required" });
      const [bale] = await db.select().from(factoryBales).where(and(eq(factoryBales.id, id), eq(factoryBales.companyId, companyId)));
      if (!bale) return res.status(404).json({ message: "Bale not found" });
      if (bale.stockEntryDate) return res.status(403).json({ message: "Worker assignment is locked for stock-entry bales and cannot be changed." });
      const [updated] = await db.update(factoryBales).set({ finalizedBy: parseInt(workerId), updatedAt: new Date() }).where(eq(factoryBales.id, id)).returning();
      res.json(updated);
    } catch (error: any) {
      console.error("Error assigning worker to bale:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/bales/:id/repack", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

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
          nextNumber = 100876;
          await tx.insert(factoryBaleSequences).values({
            companyId,
            nextNumber: 100877,
          });
        }

        const newRefNum = `REF${String(nextNumber).padStart(5, '0')}`;

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

        await tx
          .update(factoryBales)
          .set({ status: "REPACKED", updatedAt: new Date() })
          .where(eq(factoryBales.id, id));

        return { originalBale, newBale, newRefNum };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error repacking bale:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/stock-entry-history", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate, workerId, productId, locationId, status, search, includeUnassigned } = req.query as Record<string, string>;

      const today = new Date().toISOString().split("T")[0];
      const effectiveStart = startDate || today;
      const effectiveEnd = endDate || today;

      const workerFilter = workerId ? sql`AND fb.finalized_by = ${parseInt(workerId)}` : sql``;
      const productFilter = productId ? sql`AND fb.product_id = ${parseInt(productId)}` : sql``;
      const locationFilter = locationId ? sql`AND fb.erp_location_id = ${parseInt(locationId)}` : sql``;
      const statusFilter = status ? sql`AND fb.status = ${status}` : sql``;
      const searchFilter = search ? sql`AND LOWER(fb.reference_number) LIKE ${'%' + search.toLowerCase() + '%'}` : sql``;
      const unassignedFilter = includeUnassigned === 'false' ? sql`AND fb.finalized_by IS NOT NULL` : sql``;

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

      res.json(rows);
    } catch (error: any) {
      console.error("Error fetching stock entry history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/bales/lookup/:barcode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const barcode = req.params.barcode;
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : null;
      const excludeIdsStr = req.query.excludeIds as string;
      const excludeIds = excludeIdsStr ? excludeIdsStr.split(",").map(Number).filter(n => !isNaN(n)) : [];

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
      }
      results = await db.select().from(factoryBales)
        .where(and(...baseConditions))
        .orderBy(factoryBales.id);

      if (results.length === 0) {
        const labelResults = await db
          .select()
          .from(baleLabelPrints)
          .where(
            and(
              eq(baleLabelPrints.companyId, companyId),
              eq(baleLabelPrints.referenceNumber, barcode)
            )
          );

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
      const companyId = (req.session as any).currentCompanyId;
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
        } else if (bale.status === "FINALIZED") {
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

      const rawStockTotals = await db
        .select({
          totalReceived: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg}), 0)`,
          totalUsed: sql<string>`COALESCE(SUM(${factoryRawStock.usedKg}), 0)`,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const totalReceived = parseFloat(rawStockTotals[0]?.totalReceived || "0");
      const totalUsed = parseFloat(rawStockTotals[0]?.totalUsed || "0");
      const closingStockKg = totalReceived - totalUsed;

      const todayMixBatches = await db
        .select({ totalWeightKg: factoryMixBatches.totalWeightKg })
        .from(factoryMixBatches)
        .where(
          and(
            eq(factoryMixBatches.companyId, companyId),
            sql`${factoryMixBatches.createdAt} >= ${todayStart}`
          )
        );

      const kgsUsedToday = todayMixBatches.reduce(
        (sum, mb) => sum + (parseFloat(mb.totalWeightKg as string) || 0), 0
      );
      const openingStockKg = closingStockKg + kgsUsedToday;

      const todayBales = await db
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
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            sql`${factoryBales.pressedAt} >= ${todayStart}`
          )
        );

      const balesPressedToday = todayBales.length;
      const totalBaleWeightToday = todayBales.reduce(
        (sum, b) => sum + (parseFloat(b.weightKg as string) || 0), 0
      );

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

      res.json({
        openingStockKg: openingStockKg.toFixed(3),
        closingStockKg: closingStockKg.toFixed(3),
        balesPressedToday,
        kgsUsedToday: kgsUsedToday.toFixed(3),
        totalBaleWeightToday: totalBaleWeightToday.toFixed(3),
        categories,
        balesDetail: todayBales.map((b: any) => ({ ...b, quantity: 1 })),
      });
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
              .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, item.supplierName.trim())));
            if (supplier) {
              supplierId = supplier.id;
            }
          }

          let [container] = await db
            .select()
            .from(factoryContainers)
            .where(and(eq(factoryContainers.companyId, companyId), eq(factoryContainers.containerNumber, item.containerNumber.trim())));

          if (!container) {
            [container] = await db.insert(factoryContainers).values({
              companyId,
              containerNumber: item.containerNumber.trim(),
              supplierId,
              totalKg: item.receivedKg,
              ratePerKg: item.costPerKg,
              arrivalDate: item.arrivalDate || null,
              status: "RECEIVED",
            }).returning();
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { bales } = req.body;
      if (!Array.isArray(bales) || bales.length === 0) {
        return res.status(400).json({ message: "No bales provided" });
      }

      const maxRef = await db.select({ maxRef: sql`MAX(CAST(SUBSTRING(reference_number FROM 4) AS INTEGER))` }).from(factoryBales).where(eq(factoryBales.companyId, companyId));
      let nextRef = Math.max((maxRef[0]?.maxRef || 0) + 1, 100876);

      let imported = 0;
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

          const status = bale.status || "FINALIZED";
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
            finalizedAt: status === "FINALIZED" ? new Date() : null,
          });
          imported++;
          nextRef++;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

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

      res.json({ imported, errors });
    } catch (error: any) {
      console.error("Error importing bales:", error);
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
  async function recalcOpeningStockUsage(companyId: number): Promise<{ suppliersProcessed: number; totalAllocatedKg: number; unmatchedKg: number }> {
    const obRawStocks = await db
      .select({
        id: factoryRawStock.id,
        receivedKg: factoryRawStock.receivedKg,
        supplierId: factoryContainers.supplierId,
        offloadedAt: factoryRawStock.offloadedAt,
      })
      .from(factoryRawStock)
      .innerJoin(factoryContainers, eq(factoryRawStock.containerId, factoryContainers.id))
      .where(and(
        eq(factoryRawStock.companyId, companyId),
        eq(factoryContainers.status, "OPENING_BALANCE")
      ))
      .orderBy(factoryRawStock.offloadedAt, factoryRawStock.id);

    if (obRawStocks.length === 0) return { suppliersProcessed: 0, totalAllocatedKg: 0, unmatchedKg: 0 };

    const obIds = obRawStocks.map((r: any) => r.id);
    await db.update(factoryRawStock)
      .set({ usedKg: "0" })
      .where(inArray(factoryRawStock.id, obIds));

    const consumed = await db
      .select({
        supplierId: factoryMixBatchSources.supplierId,
        totalKg: sql<string>`COALESCE(SUM(${factoryMixBatchSources.weightKg}), '0')`,
      })
      .from(factoryMixBatchSources)
      .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
      .where(and(
        eq(factoryMixBatches.companyId, companyId),
        sql`${factoryMixBatchSources.supplierId} IS NOT NULL`
      ))
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
        await db.update(factoryRawStock)
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
        .where(and(eq(factoryContainers.companyId, companyId), sql`${factoryContainers.containerNumber} LIKE ${"OB-%"}`));

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
          const fxRate = parseFloat(item.fxRateToUsd || "1");
          const openingDate = String(item.openingDate || "").trim();

          if (!supplierStr) { errors.push(`Row ${i + 1}: supplier is required`); continue; }
          if (isNaN(kgVal) || kgVal <= 0) { errors.push(`Row ${i + 1}: kg must be > 0`); continue; }
          if (isNaN(rateVal) || rateVal < 0) { errors.push(`Row ${i + 1}: costPerKg must be >= 0`); continue; }
          if (!currency) { errors.push(`Row ${i + 1}: currency is required`); continue; }
          if (isNaN(fxRate) || fxRate <= 0) { errors.push(`Row ${i + 1}: fxRateToUsd must be > 0`); continue; }
          if (!openingDate) { errors.push(`Row ${i + 1}: openingDate is required`); continue; }

          const [supplier] = await db
            .select()
            .from(factorySuppliers)
            .where(and(eq(factorySuppliers.companyId, companyId), ilike(factorySuppliers.name, supplierStr)));

          if (!supplier) { errors.push(`Row ${i + 1}: supplier "${supplierStr}" not found`); continue; }

          const costPerKgUsd = currency === "USD" ? rateVal : rateVal * fxRate;
          const containerNumber = `OB-${String(nextNum).padStart(4, "0")}`;
          nextNum++;

          const [container] = await db.insert(factoryContainers).values({
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
            ratePerKgUsd: String(costPerKgUsd),
            finalPayableAmountUsd: String(kgVal * costPerKgUsd),
            notes: String(item.notes || "Opening stock import"),
            status: "OPENING_BALANCE",
          }).returning();

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
          return res.status(400).json({ message: "Invalid template type. Use: suppliers, raw-stock, bales, or opening-raw-stock" });
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
  // HELPER: Recalculate order totals
  // ───────────────────────────────────────────────
  async function recalculateOrderTotals(dbConn: any, orderId: number) {
    const bales = await dbConn.select().from(customerOrderBales).where(eq(customerOrderBales.orderId, orderId));

    await dbConn.delete(customerOrderLines).where(eq(customerOrderLines.orderId, orderId));

    const grouped: Record<string, { articleCode: string; baleName: string; qty: number; totalWeight: number; totalPrice: number }> = {};
    for (const b of bales) {
      const key = b.articleCode || 'UNKNOWN';
      if (!grouped[key]) {
        grouped[key] = { articleCode: key, baleName: b.baleName || key, qty: 0, totalWeight: 0, totalPrice: 0 };
      }
      grouped[key].qty += 1;
      grouped[key].totalWeight += parseFloat(b.weight);
      grouped[key].totalPrice += parseFloat(b.priceUsed);
    }

    for (const line of Object.values(grouped)) {
      await dbConn.insert(customerOrderLines).values({
        orderId,
        articleCode: line.articleCode,
        baleName: line.baleName,
        qty: line.qty,
        weightPerBale: String(line.qty > 0 ? line.totalWeight / line.qty : 0),
        totalWeight: String(line.totalWeight),
        pricePerBale: String(line.qty > 0 ? line.totalPrice / line.qty : 0),
        totalPrice: String(line.totalPrice),
      });
    }

    const charges = await dbConn.select().from(customerOrderCharges).where(eq(customerOrderCharges.orderId, orderId));
    const freightAmount = charges.filter((c: any) => c.chargeType === 'FREIGHT').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
    const otherChargesTotal = charges.filter((c: any) => c.chargeType === 'OTHER').reduce((sum: number, c: any) => sum + parseFloat(c.amount), 0);
    const subtotalBales = bales.reduce((sum: number, b: any) => sum + parseFloat(b.priceUsed), 0);
    const grandTotal = subtotalBales + freightAmount + otherChargesTotal;

    await dbConn.update(customerOrders).set({
      subtotalBales: String(subtotalBales),
      freightAmount: String(freightAmount),
      otherChargesTotal: String(otherChargesTotal),
      grandTotal: String(grandTotal),
      totalQtyBales: bales.length,
      updatedAt: new Date(),
    }).where(eq(customerOrders.id, orderId));
  }

  // ───────────────────────────────────────────────
  // FX Rates CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/fx-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { currencyCode } = req.query;
      const conditions: any[] = [eq(factoryFxRates.companyId, companyId)];
      if (currencyCode) conditions.push(eq(factoryFxRates.currencyCode, currencyCode as string));
      const results = await db.select().from(factoryFxRates).where(and(...conditions)).orderBy(desc(factoryFxRates.effectiveDate));
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/fx-rates/latest/:currencyCode", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const currency = req.params.currencyCode.toUpperCase();
      const today = new Date().toISOString().split("T")[0];
      try {
        const rate = await getOrFetchFxRateToUsd(companyId, currency, today);
        res.json({ rate, effectiveDate: today });
      } catch (err: any) {
        const [fallback] = await db.select().from(factoryFxRates)
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const parsed = insertFactoryFxRateSchema.parse({ ...req.body, companyId });
      const [rate] = await db.insert(factoryFxRates).values(parsed).returning();
      res.json(rate);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/fx-rates/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const [deleted] = await db.delete(factoryFxRates)
        .where(and(eq(factoryFxRates.id, parseInt(req.params.id)), eq(factoryFxRates.companyId, companyId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Rate not found" });
      res.json(deleted);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory Daybook
  // ───────────────────────────────────────────────

  app.get("/api/factory/daybook", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const { startDate, endDate, txType, currencyCode } = req.query;

      // ── 1. Query existing factory_daybook_entries ──────────────────────────
      const conditions: any[] = [
        eq(factoryDaybookEntries.companyId, companyId),
        // Exclude void/delete audit entries — they are internal records, not daybook events
        sql`${factoryDaybookEntries.txType} NOT LIKE '%_VOIDED'`,
        sql`${factoryDaybookEntries.txType} NOT LIKE '%_DELETED'`,
      ];
      if (startDate) conditions.push(sql`${factoryDaybookEntries.txDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${factoryDaybookEntries.txDate} <= ${endDate}`);
      if (txType) conditions.push(eq(factoryDaybookEntries.txType, txType as string));
      if (currencyCode) conditions.push(eq(factoryDaybookEntries.currencyCode, currencyCode as string));
      const daybookRows = await db.select().from(factoryDaybookEntries)
        .where(and(...conditions))
        .orderBy(desc(factoryDaybookEntries.txDate), desc(factoryDaybookEntries.id));

      // ── 1b. Safety-net: drop real daybook entries whose source voucher was deleted ─
      // Also fetch `optional` flag for voucher-backed rows
      const voucherRefIds = daybookRows
        .filter((r: any) => r.referenceTable === "vouchers" && r.referenceId != null)
        .map((r: any) => r.referenceId as number);

      const validVoucherIds = new Set<number>();
      const voucherOptionalMap = new Map<number, boolean>();
      if (voucherRefIds.length > 0) {
        const liveVouchers = await db
          .select({ id: vouchers.id, optional: vouchers.optional })
          .from(vouchers)
          .where(and(
            inArray(vouchers.id, voucherRefIds),
            sql`${vouchers.deletedAt} IS NULL`
          ));
        liveVouchers.forEach((v: any) => {
          validVoucherIds.add(v.id);
          voucherOptionalMap.set(v.id, !!v.optional);
        });
      }

      const filteredDaybookRows = daybookRows
        .filter((r: any) => {
          if (r.referenceTable !== "vouchers" || r.referenceId == null) return true;
          return validVoucherIds.has(r.referenceId);
        })
        .map((r: any) => ({
          ...r,
          optional: r.referenceTable === "vouchers" && r.referenceId != null
            ? voucherOptionalMap.get(r.referenceId) ?? false
            : false,
        }));

      // ── 2. Query vouchers directly (to catch pre-fix historical entries) ───
      // Only include Payment / Receipt / Journal vouchers in the daybook view
      const voucherTxTypeMap: Record<string, string> = {
        Payment: "PAYMENT",
        Receipt: "RECEIPT",
        Journal: "JOURNAL",
      };
      // If a txType filter is applied, skip voucher pull for non-voucher types
      const voucherTypesReversed: Record<string, string> = {
        PAYMENT: "Payment",
        RECEIPT: "Receipt",
        JOURNAL: "Journal",
      };
      const shouldFetchVouchers = !txType || txType in voucherTypesReversed;

      let syntheticRows: any[] = [];
      if (shouldFetchVouchers) {
        // Build the set of voucher IDs already captured in factory_daybook_entries
        // Use filteredDaybookRows so deleted-voucher entries don't block synthetic rows
        const capturedVoucherIds = new Set<number>(
          filteredDaybookRows
            .filter((r: any) => r.referenceTable === "vouchers" && r.referenceId != null)
            .map((r: any) => r.referenceId as number)
        );

        const voucherConds: any[] = [
          eq(vouchers.companyId, companyId),
          sql`${vouchers.deletedAt} IS NULL`,
          inArray(vouchers.voucherType, ["Payment", "Receipt", "Journal"]),
        ];
        if (startDate) voucherConds.push(sql`${vouchers.voucherDate} >= ${startDate}`);
        if (endDate) voucherConds.push(sql`${vouchers.voucherDate} <= ${endDate}`);
        if (txType && txType in voucherTypesReversed) {
          voucherConds.push(eq(vouchers.voucherType, voucherTypesReversed[txType as string]));
        }
        if (currencyCode && currencyCode !== "ALL") {
          voucherConds.push(eq(vouchers.currency, currencyCode as string));
        }

        const rawVouchers = await db.select().from(vouchers).where(and(...voucherConds));

        syntheticRows = rawVouchers
          .filter((v: any) => !capturedVoucherIds.has(v.id))
          .map((v: any) => {
            const txTypeVal = voucherTxTypeMap[v.voucherType] || "JOURNAL";
            const currency = v.currency || "USD";
            const fxRate = parseFloat(v.exchangeRate || "1") || 1;
            const amtCurrency = parseFloat(v.totalAmount || "0");
            const amtUsd = currency === "USD" ? amtCurrency : amtCurrency * fxRate;
            return {
              id: -(v.id),          // negative id so FE can distinguish; won't clash with real ids
              companyId: v.companyId,
              txDate: v.voucherDate,
              txType: txTypeVal,
              referenceId: v.id,
              referenceTable: "vouchers",
              description: v.description || `${v.voucherType} voucher #${v.voucherNumber}`,
              currencyCode: currency,
              amountCurrency: String(amtCurrency),
              fxRateToUsd: String(fxRate),
              amountUsd: String(amtUsd),
              optional: !!v.optional,
              createdAt: v.createdAt,
              createdBy: null,
            };
          });
      }

      // ── 2b. Enrich zero-amount entries for BALE_STOCK_ENTRY and loading types ──
      // These were written before amount-population was in place; derive on the fly.
      const zeroRows = filteredDaybookRows.filter(
        (r: any) => parseFloat(r.amountCurrency || "0") === 0 &&
          ["BALE_STOCK_ENTRY", "LOADING_SUBMITTED", "ORDER_VERIFIED"].includes(r.txType)
      );

      if (zeroRows.length > 0) {
        // BALE_STOCK_ENTRY: derive from bale IDs stored in metaJson
        const baleStockRows = zeroRows.filter((r: any) => r.txType === "BALE_STOCK_ENTRY");
        if (baleStockRows.length > 0) {
          // Collect all bale IDs across all zero bale stock entries
          const baleIdToEntry = new Map<number, any[]>();
          for (const row of baleStockRows) {
            try {
              const meta = JSON.parse(row.metaJson || "{}");
              const bales: any[] = Array.isArray(meta.bales) ? meta.bales : [];
              for (const b of bales) {
                if (b.id) {
                  if (!baleIdToEntry.has(b.id)) baleIdToEntry.set(b.id, []);
                  baleIdToEntry.get(b.id)!.push({ row, weightKg: parseFloat(b.weightKg || "0") });
                }
              }
            } catch {}
          }
          if (baleIdToEntry.size > 0) {
            const allBaleIds = Array.from(baleIdToEntry.keys());
            // Fetch costPerKg, productId, and articleCode for multi-level fallback
            const baleRecords = await db.select({
              id: factoryBales.id,
              costPerKg: factoryBales.costPerKg,
              productId: factoryBales.productId,
              articleCode: factoryBales.articleCode,
            }).from(factoryBales).where(inArray(factoryBales.id, allBaleIds));

            // Build product price map: by id (primary) and by articleCode (fallback)
            const productPriceById = new Map<number, number>();
            const productPriceByArticleCode = new Map<string, number>();
            const zeroBales = baleRecords.filter((b: any) => parseFloat(b.costPerKg || "0") === 0);
            if (zeroBales.length > 0) {
              // All products for this company so we can match by articleCode too
              const allProducts = await db.select({
                id: factoryBaleProducts.id,
                articleCode: factoryBaleProducts.articleCode,
                productionPrice: factoryBaleProducts.productionPrice,
              }).from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
              allProducts.forEach((p: any) => {
                productPriceById.set(p.id, parseFloat(p.productionPrice || "0"));
                if (p.articleCode) productPriceByArticleCode.set(p.articleCode, parseFloat(p.productionPrice || "0"));
              });
            }

            // Accumulate value per daybook row id — costPerKg is the per-bale production price
            const rowValueMap = new Map<number, number>();
            for (const baleRec of baleRecords) {
              const entries = baleIdToEntry.get(baleRec.id) || [];
              const storedCost = parseFloat(baleRec.costPerKg || "0");
              let val = storedCost;
              if (val === 0) {
                // fallback 1: productId → productionPrice
                if (baleRec.productId) val = productPriceById.get(baleRec.productId) || 0;
                // fallback 2: articleCode → productionPrice
                if (val === 0 && baleRec.articleCode) val = productPriceByArticleCode.get(baleRec.articleCode) || 0;
              }
              for (const { row } of entries) {
                rowValueMap.set(row.id, (rowValueMap.get(row.id) || 0) + val);
              }
            }

            // Patch the filteredDaybookRows in-place
            for (const row of filteredDaybookRows as any[]) {
              if (row.txType === "BALE_STOCK_ENTRY" && parseFloat(row.amountCurrency || "0") === 0) {
                const derived = rowValueMap.get(row.id);
                if (derived && derived > 0) {
                  row.amountCurrency = String(derived.toFixed(2));
                  row.amountUsd = String(derived.toFixed(2));
                }
              }
            }
          }
        }

        // LOADING_SUBMITTED / ORDER_VERIFIED: derive from customerOrderBales.priceUsed
        const loadingRows = zeroRows.filter((r: any) =>
          ["LOADING_SUBMITTED", "ORDER_VERIFIED"].includes(r.txType) && r.referenceId
        );
        if (loadingRows.length > 0) {
          const orderIds = [...new Set(loadingRows.map((r: any) => r.referenceId as number))];
          const orderBaleValues = await db.select({
            orderId: customerOrderBales.orderId,
            priceUsed: customerOrderBales.priceUsed,
          }).from(customerOrderBales).where(inArray(customerOrderBales.orderId, orderIds));

          const orderTotals = new Map<number, number>();
          for (const b of orderBaleValues) {
            const oid = b.orderId;
            orderTotals.set(oid, (orderTotals.get(oid) || 0) + parseFloat(b.priceUsed || "0"));
          }

          for (const row of filteredDaybookRows as any[]) {
            if (["LOADING_SUBMITTED", "ORDER_VERIFIED"].includes(row.txType) && parseFloat(row.amountCurrency || "0") === 0) {
              const total = orderTotals.get(row.referenceId);
              if (total && total > 0) {
                row.amountCurrency = String(total.toFixed(2));
                row.amountUsd = String(total.toFixed(2));
              }
            }
          }
        }
      }

      // ── 3. Merge + sort ────────────────────────────────────────────────────
      const merged = [...filteredDaybookRows, ...syntheticRows].sort((a: any, b: any) => {
        if (b.txDate > a.txDate) return 1;
        if (b.txDate < a.txDate) return -1;
        return Math.abs(b.id) - Math.abs(a.id);
      });

      res.json(merged);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // FACTORY CUSTOMERS CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/customers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const allCustomers = await db.select().from(customers)
        .where(and(eq(customers.companyId, companyId), sql`${customers.deletedAt} IS NULL`));

      const customersWithBalances = await Promise.all(
        allCustomers.map(async (customer) => {
          // Always read balance from customerBalances (factory receivable ledger).
          // Previously this branched on ledgerAccountId and read from ERP voucherEntries,
          // but voucherEntries only contains charge-specific journal entries — the bale
          // subtotal is never posted there — so that path showed balance = charges only.
          const [balRow] = await db.select({ total: sql<string>`COALESCE(SUM(CAST(debit_amount AS numeric) - CAST(credit_amount AS numeric)), 0)` })
            .from(customerBalances)
            .where(and(eq(customerBalances.customerId, customer.id), eq(customerBalances.companyId, companyId)));
          const customerBal = parseFloat(balRow?.total || "0");
          const openingBalance = parseFloat(customer.openingBalance || "0");
          const openingSide = customer.openingBalanceSide || "Dr";
          const totalBalance = (openingSide === "Dr" ? openingBalance : -openingBalance) + customerBal;
          return { ...customer, balance: Math.abs(totalBalance), balanceSide: totalBalance >= 0 ? "Dr" : "Cr" };
        })
      );

      res.json(customersWithBalances);
    } catch (error: any) {
      console.error("Error fetching factory customers:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customers", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const dataWithCompany = { ...req.body, companyId };
      const parsed = insertCustomerSchema.parse(dataWithCompany);

      let suffix = 1;
      const allExisting = await db.select().from(customers)
        .where(eq(customers.companyId, companyId));

      const existingCodes = allExisting
        .map((c) => c.code)
        .filter((c) => c.startsWith("CUST"))
        .map((c) => parseInt(c.replace("CUST", "")))
        .filter((n) => !isNaN(n));

      if (existingCodes.length > 0) {
        suffix = Math.max(...existingCodes) + 1;
      }
      let code = `CUST${suffix.toString().padStart(3, "0")}`;

      let codeExists = true;
      while (codeExists) {
        const [dup] = await db.select().from(customers)
          .where(and(eq(customers.code, code), eq(customers.companyId, companyId)));
        if (dup) {
          suffix++;
          code = `CUST${suffix.toString().padStart(3, "0")}`;
        } else {
          codeExists = false;
        }
      }

      const [customer] = await db.insert(customers).values({ ...parsed, code }).returning();

      const customerAccountCode = `CUST-${customer.code}`;
      const [existingAccount] = await db.select().from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.code, customerAccountCode), eq(ledgerAccounts.companyId, companyId)));

      if (!existingAccount) {
        const [newAccount] = await db.insert(ledgerAccounts).values({
          companyId,
          code: customerAccountCode,
          name: `${customer.legalName} - Customer Account`,
          accountType: "Asset",
          subType: "Accounts Receivable",
          openingBalance: parsed.openingBalance || "0",
          openingBalanceSide: parsed.openingBalanceSide || "Dr",
          active: true,
        }).returning();

        await db.update(customers).set({ ledgerAccountId: newAccount.id })
          .where(eq(customers.id, customer.id));
      }

      res.status(201).json(customer);
    } catch (error: any) {
      console.error("Error creating factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      if (req.body.code && req.body.code !== existing.code) {
        const [dup] = await db.select().from(customers)
          .where(and(eq(customers.code, req.body.code), eq(customers.companyId, companyId)));
        if (dup) return res.status(400).json({ message: "Customer code already exists" });
      }

      const parsed = insertCustomerSchema.partial().parse(req.body);
      const [updated] = await db.update(customers).set(parsed)
        .where(eq(customers.id, customerId)).returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customers/:id", requireAuth, async (req: any, res: any) => {
    try {
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [existing] = await db.select().from(customers).where(eq(customers.id, customerId));
      if (!existing) return res.status(404).json({ message: "Customer not found" });
      if (existing.companyId !== companyId) return res.status(403).json({ message: "Access denied" });

      const [deleted] = await db.update(customers)
        .set({ deletedAt: new Date() })
        .where(eq(customers.id, customerId))
        .returning();

      res.json(deleted);
    } catch (error: any) {
      console.error("Error deleting factory customer:", error);
      res.status(400).json({ message: error.message });
    }
  });

  // CUSTOMER STATEMENT
  // ───────────────────────────────────────────────

  app.get("/api/factory/customers/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      // Get finalized invoices
      const invoices = await db
        .select({
          id: customerOrders.id,
          invoiceNumber: customerOrders.invoiceNumber,
          orderDate: customerOrders.orderDate,
          grandTotal: customerOrders.grandTotal,
          subtotalBales: customerOrders.subtotalBales,
          freightAmount: customerOrders.freightAmount,
          otherChargesTotal: customerOrders.otherChargesTotal,
          totalQtyBales: customerOrders.totalQtyBales,
          status: customerOrders.status,
          createdAt: customerOrders.createdAt,
        })
        .from(customerOrders)
        .where(and(
          eq(customerOrders.companyId, companyId),
          eq(customerOrders.customerId, customerId),
          eq(customerOrders.status, "FINALIZED"),
        ))
        .orderBy(desc(customerOrders.createdAt));

      // Get all balance history entries ordered by date
      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      // Build running balance
      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const balanceHistory = balanceRows.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        return {
          ...row,
          runningBalance,
          runningBalanceSide: runningBalance >= 0 ? "Dr" : "Cr",
        };
      });

      const currentBalance = Math.abs(runningBalance);
      const currentBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      res.json({
        customer,
        invoices,
        balanceHistory,
        currentBalance,
        currentBalanceSide,
        openingBalance,
        openingBalanceSide: openingSide,
      });
    } catch (error: any) {
      console.error("Error fetching customer statement:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Customer Statement: PDF Export ──────────────────────────────────────
  app.get("/api/factory/customers/:id/statement/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const rows = balanceRows.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        return { ...row, debit, credit };
      });

      const totalDr = rows.reduce((s: number, r: any) => s + r.debit, 0);
      const totalCr = rows.reduce((s: number, r: any) => s + r.credit, 0);
      const closingBalance = Math.abs(runningBalance);
      const closingBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      const fmtAmt = (n: number) => n > 0 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
      const fmtDate = (d: string) => {
        if (!d) return "";
        const [y, m, day] = d.split("-");
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${parseInt(day, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
      };
      const txLabel = (type: string) => {
        const map: Record<string, string> = { SALE: "Sale", PAYMENT: "Payment", RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", JOURNAL: "Journal", OPENING_BALANCE: "Opening Bal." };
        return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };

      const PDFDocument = (await import("pdfkit")).default;
      const pathModCust = await import("path");
      const companyName = (company as any)?.legalName || "Company";

      // Arabic font + reshaper — always load
      const custFontDir = pathModCust.join(process.cwd(), "server", "fonts");
      const custArabicFontPath = pathModCust.join(custFontDir, "Amiri-Regular.ttf");
      const custHasArabicFont = fs.existsSync(custArabicFontPath);

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      if (custHasArabicFont) doc.registerFont("Arabic", custArabicFontPath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${(customer.code || customerId).toString().replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      let custConvAr: ((t: string) => string) | null = null;
      let custBidi: { getEmbeddingLevels: (t: string, d: string) => any; getReorderedString: (t: string, l: any) => string } | null = null;
      try {
        custConvAr = (require("arabic-reshaper") as any).convertArabic;
        custBidi = (require("bidi-js") as any)();
      } catch {}
      const custHasAr = (t: string) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t);
      const custShape = (t: string): string => {
        if (!t || !custConvAr) return t;
        try {
          const r = custConvAr(t);
          if (custBidi) { const lv = custBidi.getEmbeddingLevels(r, "rtl"); return custBidi.getReorderedString(r, lv); }
          return r;
        } catch { return t; }
      };
      const custRender = (text: string, x: number, yPos: number, w: number, align: "left"|"right" = "left") => {
        const ar = custHasArabicFont && custHasAr(text);
        doc.font(ar ? "Arabic" : "Helvetica").fontSize(8)
          .text(ar ? custShape(text) : text, x, yPos, { width: w, align: ar ? "right" : align });
      };

      // ── Dark header bar ──
      doc.rect(40, 40, 515, 44).fill("#1F3864");
      const cnHasAr = custHasArabicFont && custHasAr(companyName);
      doc.fillColor("#FFFFFF").font(cnHasAr ? "Arabic" : "Helvetica-Bold").fontSize(15)
        .text(cnHasAr ? custShape(companyName) : companyName, 52, 47, { width: 400, align: cnHasAr ? "right" : "left" });
      doc.font("Helvetica").fontSize(9)
        .text("Account Statement", 52, 65, { width: 300 });
      const printDate = fmtDate(new Date().toISOString().split("T")[0]);
      doc.fontSize(8).text(`Printed: ${printDate}`, 450, 58, { width: 105, align: "right" });

      // ── Customer info block ──
      const infoY = 96;
      doc.fillColor("#000000").font("Helvetica").fontSize(9);
      doc.text("Customer:", 40, infoY);
      custRender(customer.legalName, 40, infoY + 12, 250);
      doc.font("Helvetica").text(`Code: ${customer.code || "—"}`, 40, infoY + 24);
      doc.text(`Phone: ${customer.phone || "—"}`, 40, infoY + 36);
      const obLabel = `${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingSide}`;
      doc.text(`Opening Balance: `, 300, infoY + 12, { continued: true }).font("Helvetica-Bold").text(obLabel);
      doc.font("Helvetica");

      // ── Table ──
      const colX   = [40,  115, 185, 380, 468];
      const colW   = [75,   70, 195,  88,  87];
      const colHdr = ["Date", "Type", "Description", "Debit (Dr)", "Credit (Cr)"];
      const colAlign: Array<"left" | "right"> = ["left", "left", "left", "right", "right"];
      const tableTop = infoY + 68;

      doc.rect(40, tableTop, 515, 14).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      let y = tableTop + 16;

      // Opening balance row if non-zero
      if (openingBalance > 0) {
        doc.rect(40, y, 515, 13).fill("#EFF3FB");
        doc.fillColor("#000000");
        doc.text(fmtDate(new Date().toISOString().split("T")[0]), colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text("Opening Bal.", colX[1] + 2, y + 3, { width: colW[1] - 4 });
        doc.text("Opening Balance", colX[2] + 2, y + 3, { width: colW[2] - 4 });
        if (openingSide === "Dr") {
          doc.text(obLabel, colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
        } else {
          doc.text(obLabel, colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        }
        y += 13;
      }

      rows.forEach((row: any, idx: number) => {
        if (y > 760) { doc.addPage(); y = 40; }
        if (idx % 2 === 1) { doc.rect(40, y, 515, 13).fill("#F8F8F8"); doc.fillColor("#000000"); }
        doc.font("Helvetica").fontSize(8);
        doc.text(fmtDate(row.transactionDate), colX[0] + 2, y + 3, { width: colW[0] - 4 });
        doc.text(txLabel(row.transactionType), colX[1] + 2, y + 3, { width: colW[1] - 4 });
        custRender(row.description || "—", colX[2] + 2, y + 3, colW[2] - 4, "left");
        doc.font("Helvetica").fontSize(8);
        if (row.debit > 0) doc.text(fmtAmt(row.debit), colX[3] + 2, y + 3, { width: colW[3] - 4, align: "right" });
        if (row.credit > 0) doc.text(fmtAmt(row.credit), colX[4] + 2, y + 3, { width: colW[4] - 4, align: "right" });
        y += 13;
      });

      // Separator
      y += 3;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 6;

      // Totals row
      doc.rect(40, y, 515, 15).fill("#1F3864");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      doc.text("TOTAL", colX[2] + 2, y + 4, { width: colW[2] - 4 });
      doc.text(fmtAmt(totalDr) || "0.00", colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      doc.text(fmtAmt(totalCr) || "0.00", colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      y += 17;

      // Closing balance row
      doc.rect(40, y, 515, 15).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      doc.text("Closing Balance", colX[2] + 2, y + 4, { width: colW[2] - 4 });
      const closingStr = closingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + closingBalanceSide;
      if (closingBalanceSide === "Dr") {
        doc.text(closingStr, colX[3] + 2, y + 4, { width: colW[3] - 4, align: "right" });
      } else {
        doc.text(closingStr, colX[4] + 2, y + 4, { width: colW[4] - 4, align: "right" });
      }

      doc.end();
    } catch (error: any) {
      console.error("Error exporting customer statement PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Customer Statement: Excel Export ────────────────────────────────────
  app.get("/api/factory/customers/:id/statement/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const customerId = parseInt(req.params.id);
      if (isNaN(customerId)) return res.status(400).json({ message: "Invalid customer ID" });

      const [customer] = await db.select().from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
      if (!customer) return res.status(404).json({ message: "Customer not found" });

      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));

      const balanceRows = await db.select().from(customerBalances)
        .where(and(eq(customerBalances.companyId, companyId), eq(customerBalances.customerId, customerId)))
        .orderBy(customerBalances.transactionDate, customerBalances.id);

      const openingBalance = parseFloat(customer.openingBalance || "0");
      const openingSide = customer.openingBalanceSide || "Dr";
      let runningBalance = openingSide === "Dr" ? openingBalance : -openingBalance;

      const rows = balanceRows.map((row: any) => {
        const debit = parseFloat(row.debitAmount || "0");
        const credit = parseFloat(row.creditAmount || "0");
        runningBalance += debit - credit;
        return { ...row, debit, credit };
      });

      const totalDr = rows.reduce((s: number, r: any) => s + r.debit, 0);
      const totalCr = rows.reduce((s: number, r: any) => s + r.credit, 0);
      const closingBalance = Math.abs(runningBalance);
      const closingBalanceSide = runningBalance >= 0 ? "Dr" : "Cr";

      const txLabel = (type: string) => {
        const map: Record<string, string> = { SALE: "Sale", PAYMENT: "Payment", RECEIPT: "Receipt", ADJUSTMENT: "Adjustment", JOURNAL: "Journal", OPENING_BALANCE: "Opening Bal." };
        return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };
      const numFmt = "#,##0.00";
      const navyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F3864" } };
      const lightBlueFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEFF3FB" } };
      const greyFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF5F5F5" } };
      const allBorders = {
        top: { style: "thin" as const }, bottom: { style: "thin" as const },
        left: { style: "thin" as const }, right: { style: "thin" as const },
      };

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Statement");

      sheet.columns = [
        { key: "date",  width: 14 },
        { key: "type",  width: 16 },
        { key: "desc",  width: 36 },
        { key: "dr",    width: 16 },
        { key: "cr",    width: 16 },
      ];

      // Rows 1–5: Customer info block
      const companyName = (company as any)?.legalName || "Company";
      const r1 = sheet.addRow([companyName]);
      r1.getCell(1).font = { bold: true, size: 14 };
      sheet.mergeCells(`A1:E1`);
      const r2 = sheet.addRow(["Account Statement"]);
      r2.getCell(1).font = { bold: true, size: 11 };
      sheet.mergeCells(`A2:E2`);
      sheet.addRow([`Customer: ${customer.legalName}   |   Code: ${customer.code || "—"}   |   Phone: ${customer.phone || "—"}`]);
      sheet.mergeCells(`A3:E3`);
      sheet.addRow([`Opening Balance: ${openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${openingSide}`]);
      sheet.mergeCells(`A4:E4`);
      sheet.addRow([`Printed: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`]);
      sheet.mergeCells(`A5:E5`);
      // Row 6: spacer
      sheet.addRow([]);

      // Row 7: Column headers
      const hdrRow = sheet.addRow(["Date", "Type", "Description", "Debit (Dr)", "Credit (Cr)"]);
      hdrRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
      });

      // Opening balance row if non-zero
      if (openingBalance > 0) {
        const obRow = sheet.addRow([
          new Date().toLocaleDateString("en-GB"),
          "Opening Bal.",
          "Opening Balance",
          openingSide === "Dr" ? openingBalance : null,
          openingSide === "Cr" ? openingBalance : null,
        ]);
        obRow.eachCell((cell) => {
          cell.fill = lightBlueFill;
          cell.border = allBorders;
        });
        obRow.getCell(4).numFmt = numFmt;
        obRow.getCell(5).numFmt = numFmt;
      }

      // Data rows
      rows.forEach((row: any, idx: number) => {
        const dr = row.debit > 0 ? row.debit : null;
        const cr = row.credit > 0 ? row.credit : null;
        const dateVal = row.transactionDate
          ? new Date(row.transactionDate + "T00:00:00")
          : "";
        const dr2 = sheet.addRow([dateVal, txLabel(row.transactionType), row.description || "—", dr, cr]);
        dr2.eachCell((cell) => { cell.border = allBorders; });
        if (idx % 2 === 0) {
          dr2.eachCell((cell) => { cell.fill = greyFill; });
        }
        dr2.getCell(1).numFmt = "dd/mm/yyyy";
        dr2.getCell(4).numFmt = numFmt;
        dr2.getCell(5).numFmt = numFmt;
        dr2.getCell(4).alignment = { horizontal: "right" };
        dr2.getCell(5).alignment = { horizontal: "right" };
      });

      // Totals row
      const totRow = sheet.addRow(["", "", "TOTAL", totalDr, totalCr]);
      totRow.eachCell((cell) => {
        cell.fill = navyFill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.border = allBorders;
      });
      totRow.getCell(4).numFmt = numFmt;
      totRow.getCell(5).numFmt = numFmt;
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(5).alignment = { horizontal: "right" };

      // Closing balance row
      const closingDr = closingBalanceSide === "Dr" ? closingBalance : null;
      const closingCr = closingBalanceSide === "Cr" ? closingBalance : null;
      const cbRow = sheet.addRow(["", "", "Closing Balance", closingDr, closingCr]);
      cbRow.eachCell((cell) => {
        cell.fill = lightBlueFill;
        cell.font = { bold: true };
        cell.border = allBorders;
      });
      cbRow.getCell(4).numFmt = numFmt;
      cbRow.getCell(5).numFmt = numFmt;
      cbRow.getCell(4).alignment = { horizontal: "right" };
      cbRow.getCell(5).alignment = { horizontal: "right" };

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=statement_${(customer.legalName || "customer").replace(/\s+/g, "_")}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting customer statement Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // CUSTOMER PROFORMAS CRUD
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const customerId = req.query.customerId ? parseInt(req.query.customerId) : null;
      if (!customerId) return res.status(400).json({ message: "customerId is required" });

      const proformas = await db
        .select()
        .from(customerProformas)
        .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, customerId)))
        .orderBy(desc(customerProformas.createdAt));

      const proformaIds = proformas.map((p: any) => p.id);
      let lines: any[] = [];
      if (proformaIds.length > 0) {
        lines = await db.select().from(customerProformaLines).where(inArray(customerProformaLines.proformaId, proformaIds));
      }

      // Enrich lines with weightPerBaleKg from factoryBaleProducts
      const articleCodes = [...new Set(lines.map((l: any) => l.articleCode).filter(Boolean))];
      let weightMap = new Map<string, string>();
      if (articleCodes.length > 0) {
        const baleProds = await db.select({ articleCode: factoryBaleProducts.articleCode, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes as string[])));
        baleProds.forEach((p: any) => { if (p.articleCode) weightMap.set(p.articleCode, p.weightPerBaleKg || "0"); });
      }

      const enrichedLines = lines.map((l: any) => ({ ...l, weightPerBaleKg: weightMap.get(l.articleCode) || "0" }));

      const result = proformas.map((p: any) => ({
        ...p,
        lines: enrichedLines.filter((l: any) => l.proformaId === p.id),
      }));

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching customer proformas:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const parsed = insertCustomerProformaSchema.parse({ ...req.body, companyId });

      if (parsed.isActive) {
        await db.update(customerProformas).set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, parsed.customerId)));
      }

      const [proforma] = await db.insert(customerProformas).values(parsed).returning();
      res.json(proforma);
    } catch (error: any) {
      console.error("Error creating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [existing] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!existing) return res.status(404).json({ message: "Proforma not found" });

      if (req.body.isActive === true) {
        await db.update(customerProformas).set({ isActive: false, updatedAt: new Date() })
          .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, existing.customerId)));
      }

      const [updated] = await db.update(customerProformas)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating customer proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proformas/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      await db.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      const [deleted] = await db.delete(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)))
        .returning();

      if (!deleted) return res.status(404).json({ message: "Proforma not found" });
      res.json({ message: "Proforma deleted" });
    } catch (error: any) {
      console.error("Error deleting customer proforma:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proforma-lines", requireAuth, async (req: any, res: any) => {
    try {
      const parsed = insertCustomerProformaLineSchema.parse(req.body);

      const [existingLine] = await db.select().from(customerProformaLines)
        .where(and(eq(customerProformaLines.proformaId, parsed.proformaId), eq(customerProformaLines.articleCode, parsed.articleCode)));
      if (existingLine) return res.status(400).json({ message: "Article code already exists in this proforma" });

      const [line] = await db.insert(customerProformaLines).values(parsed).returning();
      res.json(line);
    } catch (error: any) {
      console.error("Error creating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const updateData: any = {};
      if (req.body.productName !== undefined) updateData.productName = req.body.productName;
      if (req.body.quantity !== undefined) updateData.quantity = parseInt(req.body.quantity);
      if (req.body.pricePerBale !== undefined) updateData.pricePerBale = req.body.pricePerBale;

      const [updated] = await db.update(customerProformaLines).set(updateData)
        .where(eq(customerProformaLines.id, id)).returning();

      if (!updated) return res.status(404).json({ message: "Proforma line not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating proforma line:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/factory/customer-proforma-lines/:id", requireAuth, async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id);
      const [deleted] = await db.delete(customerProformaLines).where(eq(customerProformaLines.id, id)).returning();
      if (!deleted) return res.status(404).json({ message: "Proforma line not found" });
      res.json({ message: "Proforma line deleted" });
    } catch (error: any) {
      console.error("Error deleting proforma line:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas/bulk", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, name, isActive, lines } = req.body;
      if (!customerId || !name || !Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: `customerId, name, and at least one line are required. Got: customerId=${customerId}, name=${name}, lines=${Array.isArray(lines) ? lines.length : 'not array'}` });
      }

      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res.status(400).json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const parsed = insertCustomerProformaSchema.parse({ companyId, customerId, name, isActive: isActive || false });

      const result = await db.transaction(async (tx: any) => {
        if (parsed.isActive) {
          await tx.update(customerProformas).set({ isActive: false, updatedAt: new Date() })
            .where(and(eq(customerProformas.companyId, companyId), eq(customerProformas.customerId, parsed.customerId)));
        }

        const [proforma] = await tx.insert(customerProformas).values(parsed).returning();

        const lineValues = validLines.map((l: any) => ({
          proformaId: proforma.id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale || "0"),
        }));

        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();

        return { ...proforma, lines: insertedLines };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error bulk creating proforma:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/customer-proformas/:id/replace-lines", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const { lines } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ message: "At least one line is required" });
      }

      const validLines = lines.filter((l: any) => l.articleCode && l.productName && parseInt(l.quantity) > 0);
      if (validLines.length === 0) {
        return res.status(400).json({ message: "At least one line must have articleCode, productName, and quantity > 0" });
      }

      const result = await db.transaction(async (tx: any) => {
        await tx.delete(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
        const lineValues = validLines.map((l: any) => ({
          proformaId: id,
          articleCode: l.articleCode,
          productName: l.productName,
          quantity: parseInt(l.quantity),
          pricePerBale: String(l.pricePerBale || "0"),
        }));
        const insertedLines = await tx.insert(customerProformaLines).values(lineValues).returning();
        return { ...proforma, lines: insertedLines };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error replacing proforma lines:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/customer-proformas/:id/apply-catalog-prices", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);

      const lines = await db.select().from(customerProformaLines).where(eq(customerProformaLines.proformaId, id));
      if (!lines.length) return res.json({ updated: 0, skipped: 0 });

      const products = await db.select().from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId));
      const priceByArticleCode = new Map<string, string>();
      for (const p of products) {
        if (p.articleCode && p.sellingPrice && parseFloat(String(p.sellingPrice)) > 0) {
          priceByArticleCode.set(p.articleCode.toLowerCase(), String(p.sellingPrice));
        }
      }

      let updated = 0;
      let skipped = 0;
      for (const line of lines) {
        const newPrice = priceByArticleCode.get((line.articleCode || "").toLowerCase());
        if (newPrice) {
          await db.update(customerProformaLines)
            .set({ pricePerBale: newPrice })
            .where(eq(customerProformaLines.id, line.id));
          updated++;
        } else {
          skipped++;
        }
      }

      res.json({ updated, skipped });
    } catch (error: any) {
      console.error("Error applying catalog prices:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-proformas/:id/export/excel", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const rawLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, id));

      const [customer] = await db.select().from(customers).where(eq(customers.id, proforma.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).catch(() => [null]);

      // Fetch weight per bale from factoryBaleProducts by articleCode
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const wMap = new Map<string, number>();
      if (articleCodes.length > 0) {
        const prods = await db.select({ articleCode: factoryBaleProducts.articleCode, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes as string[])));
        prods.forEach((p: any) => { if (p.articleCode) wMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0")); });
      }

      const baseCurrency = (company as any)?.baseCurrency || "USD";
      const currencySymbolMap: Record<string, string> = {
        USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", XOF: "CFA ", XAF: "CFA ",
        CAD: "CA$ ", AUD: "A$ ", CHF: "CHF ", JPY: "¥", INR: "₹", AED: "AED ",
        MXN: "MX$ ", BRL: "R$ ", ZAR: "R", SGD: "S$ ", HKD: "HK$ ", NOK: "kr ", SEK: "kr ", DKK: "kr ",
      };
      const currSym = currencySymbolMap[baseCurrency.toUpperCase()] ?? (baseCurrency + " ");
      const fmtPrice = (n: number) => currSym + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
      const fmtKg = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Proforma Invoice");

      const COL_COUNT = 8;
      sheet.columns = [
        { key: "num", width: 6 },
        { key: "articleCode", width: 18 },
        { key: "productName", width: 32 },
        { key: "qty", width: 12 },
        { key: "kgPerBale", width: 13 },
        { key: "pricePerBale", width: 14 },
        { key: "totalKg", width: 13 },
        { key: "totalPrice", width: 15 },
      ];

      const companyName = (company as any)?.legalName || "Company";
      const r1 = sheet.addRow([companyName]);
      r1.getCell(1).font = { bold: true, size: 16 };
      r1.getCell(1).alignment = { horizontal: "center" };
      sheet.mergeCells(r1.number, 1, r1.number, COL_COUNT);

      const r2 = sheet.addRow([`Customer: ${customer?.legalName || "N/A"}`]);
      r2.getCell(1).font = { size: 11 };
      sheet.mergeCells(r2.number, 1, r2.number, COL_COUNT);

      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      const r3 = sheet.addRow([`Date: ${dateStr}`]);
      r3.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
      sheet.mergeCells(r3.number, 1, r3.number, COL_COUNT);

      const r4 = sheet.addRow([`Proforma: ${proforma.name}`]);
      r4.getCell(1).font = { size: 10, color: { argb: "FF555555" } };
      sheet.mergeCells(r4.number, 1, r4.number, COL_COUNT);

      sheet.addRow([]);

      const hdrRow = sheet.addRow(["#", "Article Code", "Product Name", "Qty (Bales)", "Kg / Bale", "Price / Bale", "Total KG", "Total Price"]);
      hdrRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
        cell.alignment = { horizontal: "center" };
      });

      let totalQty = 0, totalKgAll = 0, totalPriceAll = 0;
      rawLines.forEach((line: any, idx: number) => {
        const qty = parseInt(String(line.quantity));
        const kgPerBale = wMap.get(line.articleCode) || 0;
        const price = parseFloat(String(line.pricePerBale));
        const totalKg = qty * kgPerBale;
        const totalPrice = qty * price;
        totalQty += qty;
        totalKgAll += totalKg;
        totalPriceAll += totalPrice;

        const dr = sheet.addRow([idx + 1, line.articleCode, line.productName, qty, fmtKg(kgPerBale), fmtPrice(price), fmtKg(totalKg), fmtPrice(totalPrice)]);
        dr.getCell(4).alignment = { horizontal: "right" };
        dr.getCell(5).alignment = { horizontal: "right" };
        dr.getCell(6).alignment = { horizontal: "right" };
        dr.getCell(7).alignment = { horizontal: "right" };
        dr.getCell(8).alignment = { horizontal: "right" };
        if (idx % 2 === 1) {
          dr.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } }; });
        }
      });

      sheet.addRow([]);
      const totRow = sheet.addRow(["", "", "GRAND TOTAL", totalQty, "", "", fmtKg(totalKgAll), fmtPrice(totalPriceAll)]);
      totRow.eachCell((cell) => { cell.font = { bold: true }; });
      totRow.getCell(4).alignment = { horizontal: "right" };
      totRow.getCell(7).alignment = { horizontal: "right" };
      totRow.getCell(8).alignment = { horizontal: "right" };

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=proforma_${proforma.name.replace(/\s+/g, "_")}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting proforma to Excel:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/customer-proformas/:id/export/pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      const [proforma] = await db.select().from(customerProformas)
        .where(and(eq(customerProformas.id, id), eq(customerProformas.companyId, companyId)));
      if (!proforma) return res.status(404).json({ message: "Proforma not found" });

      const rawLines = await db.select().from(customerProformaLines)
        .where(eq(customerProformaLines.proformaId, id));

      const [customer] = await db.select().from(customers).where(eq(customers.id, proforma.customerId));
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).catch(() => [null]);

      // Fetch weight per bale from factoryBaleProducts by articleCode
      const articleCodes = [...new Set(rawLines.map((l: any) => l.articleCode).filter(Boolean))];
      const wMap = new Map<string, number>();
      if (articleCodes.length > 0) {
        const prods = await db.select({ articleCode: factoryBaleProducts.articleCode, weightPerBaleKg: factoryBaleProducts.weightPerBaleKg })
          .from(factoryBaleProducts)
          .where(and(eq(factoryBaleProducts.companyId, companyId), inArray(factoryBaleProducts.articleCode, articleCodes as string[])));
        prods.forEach((p: any) => { if (p.articleCode) wMap.set(p.articleCode, parseFloat(p.weightPerBaleKg || "0")); });
      }

      const baseCurrencyPdf = (company as any)?.baseCurrency || "USD";
      const currencySymbolMapPdf: Record<string, string> = {
        USD: "$ ", GBP: "£", EUR: "€", CFA: "CFA ", XOF: "CFA ", XAF: "CFA ",
        CAD: "CA$ ", AUD: "A$ ", CHF: "CHF ", JPY: "¥", INR: "₹", AED: "AED ",
        MXN: "MX$ ", BRL: "R$ ", ZAR: "R", SGD: "S$ ", HKD: "HK$ ", NOK: "kr ", SEK: "kr ", DKK: "kr ",
      };
      const currSymPdf = currencySymbolMapPdf[baseCurrencyPdf.toUpperCase()] ?? (baseCurrencyPdf + " ");
      const fmtPricePdf = (n: number) => currSymPdf + (n % 1 === 0 ? n.toLocaleString() : n.toFixed(2));
      const fmtKgPdf = (n: number) => n % 1 === 0 ? String(n) : n.toFixed(2);

      const PDFDocument = (await import("pdfkit")).default;
      const fs = await import("fs");

      const companyName = (company as any)?.legalName || "Company";
      const logoUrl: string | null = (settings as any)?.logoUrl || null;

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=proforma_${proforma.name.replace(/\s+/g, "_")}.pdf`);
      doc.pipe(res);

      // ── Header ──
      let headerY = 40;
      let logoWidth = 0;

      // Attempt to embed logo if it's a local file path
      if (logoUrl && logoUrl.startsWith("/") && fs.existsSync(`.${logoUrl}`)) {
        try {
          doc.image(`.${logoUrl}`, 40, headerY, { height: 48, fit: [80, 48] });
          logoWidth = 90;
        } catch {}
      }

      doc.fontSize(20).font("Helvetica-Bold")
        .text(companyName, 40 + logoWidth, headerY, { width: 515 - logoWidth });
      doc.fontSize(10).font("Helvetica").fillColor("#555555")
        .text("PROFORMA INVOICE", 40 + logoWidth, headerY + 24, { width: 515 - logoWidth });

      const headerBottom = Math.max(doc.y, headerY + 56);
      doc.moveTo(40, headerBottom + 4).lineTo(555, headerBottom + 4).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.lineWidth(1).strokeColor("#000000");

      // ── Meta info ──
      const metaY = headerBottom + 12;
      const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      doc.fillColor("#000000").fontSize(10).font("Helvetica");
      doc.text(`Customer:`, 40, metaY, { continued: true }).font("Helvetica-Bold").text(` ${customer?.legalName || "N/A"}`);
      doc.font("Helvetica").text(`Proforma:`, 40, doc.y + 2, { continued: true }).font("Helvetica-Bold").text(` ${proforma.name}`);
      doc.font("Helvetica").text(`Date:`, 40, doc.y + 2, { continued: true }).font("Helvetica-Bold").text(` ${dateStr}`);

      doc.moveDown(1);

      // ── Table ──
      // Columns: # | Article Code | Product Name | Qty | Kg/Bale | Price/Bale | Total KG | Total Price
      // x positions (left edge), total usable width = 515 (40..555)
      const colX  = [40,  62,  132, 310, 355, 403, 455, 508];
      const colW  = [22,  70,  178,  45,  48,  52,  53,  47];
      const colHdr= ["#","Code","Product Name","Qty","Kg/Bale","Pr/Bale","Total KG","Total Price"];
      const colAlign: Array<"left"|"right"> = ["right","left","left","right","right","right","right","right"];

      const tableTop = doc.y + 4;

      // Header row background
      doc.rect(40, tableTop, 515, 14).fill("#1F3864");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
      colHdr.forEach((h, i) => {
        doc.text(h, colX[i] + 2, tableTop + 3, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.fillColor("#000000").font("Helvetica").fontSize(8);
      let y = tableTop + 16;
      let totalQty = 0, totalKgAll = 0, totalPriceAll = 0;

      rawLines.forEach((line: any, idx: number) => {
        const qty = parseInt(String(line.quantity));
        const kgPerBale = wMap.get(line.articleCode) || 0;
        const price = parseFloat(String(line.pricePerBale));
        const totalKg = qty * kgPerBale;
        const totalPrice = qty * price;
        totalQty += qty;
        totalKgAll += totalKg;
        totalPriceAll += totalPrice;

        if (y > 770) {
          doc.addPage();
          y = 40;
        }

        const rowH = 14;
        if (idx % 2 === 1) {
          doc.rect(40, y, 515, rowH).fill("#F8F8F8");
          doc.fillColor("#000000");
        }

        const vals = [String(idx + 1), line.articleCode, line.productName, String(qty), fmtKgPdf(kgPerBale), fmtPricePdf(price), fmtKgPdf(totalKg), fmtPricePdf(totalPrice)];
        vals.forEach((v, i) => {
          doc.text(v, colX[i] + 2, y + 3, { width: colW[i] - 4, align: colAlign[i] });
        });
        y += rowH;
      });

      // Separator line
      y += 2;
      doc.moveTo(40, y).lineTo(555, y).lineWidth(0.5).strokeColor("#888888").stroke();
      y += 6;
      doc.lineWidth(1).strokeColor("#000000");

      // Grand total row
      doc.rect(40, y, 515, 16).fill("#EFF3FB");
      doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
      const totVals = ["", "", "GRAND TOTAL", String(totalQty), "", "", fmtKgPdf(totalKgAll), fmtPricePdf(totalPriceAll)];
      totVals.forEach((v, i) => {
        if (v) doc.text(v, colX[i] + 2, y + 4, { width: colW[i] - 4, align: colAlign[i] });
      });

      doc.end();
    } catch (error: any) {
      console.error("Error exporting proforma to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // CUSTOMER ORDERS CRUD + FINALIZE
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const conditions: any[] = [eq(customerOrders.companyId, companyId)];
      if (req.query.customerId) conditions.push(eq(customerOrders.customerId, parseInt(req.query.customerId)));
      if (req.query.status) conditions.push(eq(customerOrders.status, req.query.status));

      const orders = await db
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
        } else if (!req.body.allowBypassProforma) {
          return res.status(400).json({
            notInProforma: true,
            message: "Item loaded not requested. Please scan again to bypass.",
          });
        }
      }

      if (priceUsed === "0" && bale.productId) {
        const [product] = await db.select().from(factoryBaleProducts)
          .where(eq(factoryBaleProducts.id, bale.productId));
        if (product && product.sellingPrice) {
          priceUsed = product.sellingPrice;
        }
      }

      await db.insert(customerOrderBales).values({
        orderId,
        baleId: bale.id,
        baleReference: bale.referenceNumber,
        locationId: parseInt(locationId),
        weight: bale.weightKg,
        articleCode: bale.articleCode,
        baleName: bale.productName || bale.articleCode || bale.baleCode,
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
      const companyId = (req.session as any).currentCompanyId;
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

      // ── REF-NUMBER MODE ─────────────────────────────────────────────────────
      if (hasRefNumbers) {
        const refNumbers = refNumbersRaw as string[];
        for (const rawRef of refNumbers) {
          const refNum = String(rawRef).trim();
          if (!refNum) continue;

          const [bale] = await db.select().from(factoryBales)
            .where(and(
              eq(factoryBales.companyId, companyId),
              eq(factoryBales.referenceNumber, refNum),
              or(eq(factoryBales.status, "FINALIZED"), eq(factoryBales.status, "IN_STOCK"))
            ));

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

          await db.insert(customerOrderBales).values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: bale.erpLocationId ?? parsedLocationId,
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: bale.productName || bale.articleCode || bale.baleCode,
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

          await db.insert(customerOrderBales).values({
            orderId,
            baleId: bale.id,
            baleReference: bale.referenceNumber,
            locationId: parsedLocationId,
            weight: bale.weightKg,
            articleCode: bale.articleCode,
            baleName: bale.productName || bale.articleCode || bale.baleCode,
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
        const today = new Date().toISOString().split('T')[0];

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

      const today = new Date().toISOString().split('T')[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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

  app.post("/api/factory/customer-orders/:id/force-sync-bale-status", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const orderId = parseInt(req.params.id);
      if (isNaN(orderId)) return res.status(400).json({ message: "Invalid order ID" });

      const [order] = await db.select().from(customerOrders)
        .where(and(eq(customerOrders.id, orderId), eq(customerOrders.companyId, companyId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Load customer
      const [customer] = await db.select().from(customers)
        .where(eq(customers.id, order.customerId));

      // Load bale links
      const baleLinks = await db.select().from(customerOrderBales)
        .where(eq(customerOrderBales.orderId, orderId));

      // Load bale details
      const baleIds = baleLinks.map((b: any) => b.baleId).filter(Boolean);
      const baleRows: any[] = baleIds.length > 0
        ? await db.select().from(factoryBales).where(inArray(factoryBales.id, baleIds))
        : [];

      // Load products for name mapping
      const productIds = [...new Set(baleRows.map((b: any) => b.productId).filter((id: any) => id != null))];
      const productRecords: any[] = productIds.length > 0
        ? await db.select().from(factoryBaleProducts).where(inArray(factoryBaleProducts.id, productIds as number[]))
        : [];
      const productMap = new Map<number, any>(productRecords.map((p: any) => [p.id, p]));

      // Load charges
      const charges = await db.select().from(customerOrderCharges)
        .where(eq(customerOrderCharges.orderId, orderId));

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();

      // ── Sheet 1: Order Summary ──
      const summarySheet = workbook.addWorksheet("Order Summary");
      summarySheet.columns = [
        { header: "Field", key: "field", width: 28 },
        { header: "Value", key: "value", width: 40 },
      ];
      const summaryRows = [
        { field: "Order #", value: order.id },
        { field: "Invoice Number", value: order.invoiceNumber || "-" },
        { field: "Customer", value: customer?.legalName || `Customer #${order.customerId}` },
        { field: "Order Date", value: order.orderDate || "-" },
        { field: "Status", value: order.status },
        { field: "Container Number", value: order.containerNumber || "-" },
        { field: "Shipping Company", value: order.shippingCompany || "-" },
        { field: "Total Bales", value: order.totalQtyBales || baleRows.length },
        { field: "Subtotal (Bales)", value: parseFloat(order.subtotalBales || "0") },
        { field: "Freight Amount", value: parseFloat(order.freightAmount || "0") },
        { field: "Other Charges", value: parseFloat(order.otherChargesTotal || "0") },
        { field: "Grand Total", value: parseFloat(order.grandTotal || "0") },
      ];
      summaryRows.forEach((r) => summarySheet.addRow(r));
      summarySheet.getRow(1).font = { bold: true };

      // ── Sheet 2: Bale Details ──
      const baleSheet = workbook.addWorksheet("Bale Details");
      baleSheet.columns = [
        { header: "#", key: "seq", width: 6 },
        { header: "Reference", key: "ref", width: 18 },
        { header: "Article Code", key: "articleCode", width: 14 },
        { header: "Product Name", key: "productName", width: 30 },
        { header: "Weight (kg)", key: "weightKg", width: 14 },
        { header: "Cost/kg", key: "costPerKg", width: 12 },
        { header: "Status", key: "status", width: 16 },
        { header: "Price Used", key: "priceUsed", width: 14 },
      ];
      baleSheet.getRow(1).font = { bold: true };

      // Map baleId -> price from link table
      const balePriceMap = new Map<number, string>(baleLinks.map((l: any) => [l.baleId, l.priceUsed]));

      baleRows.forEach((bale: any, i: number) => {
        const product = productMap.get(bale.productId);
        baleSheet.addRow({
          seq: i + 1,
          ref: bale.referenceNumber || bale.baleCode || "-",
          articleCode: product?.articleCode || bale.articleCode || "-",
          productName: product?.name || product?.articleCode || "-",
          weightKg: parseFloat(bale.weightKg || "0"),
          costPerKg: parseFloat(bale.costPerKg || "0"),
          status: bale.status || "-",
          priceUsed: parseFloat(balePriceMap.get(bale.id) || "0"),
        });
      });

      // Totals row
      if (baleRows.length > 0) {
        const totalRow = baleSheet.addRow({
          seq: "",
          ref: "TOTAL",
          articleCode: "",
          productName: "",
          weightKg: baleRows.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0),
          costPerKg: "",
          status: "",
          priceUsed: "",
        });
        totalRow.font = { bold: true };
      }

      // ── Sheet 3: Charges ──
      if (charges.length > 0) {
        const chargeSheet = workbook.addWorksheet("Charges");
        chargeSheet.columns = [
          { header: "Description", key: "description", width: 36 },
          { header: "Amount", key: "amount", width: 16 },
        ];
        chargeSheet.getRow(1).font = { bold: true };
        charges.forEach((c: any) => chargeSheet.addRow({ description: c.description, amount: parseFloat(c.amount || "0") }));
      }

      const dateStr = new Date().toISOString().split("T")[0];
      const fileName = `order_${orderId}_${order.invoiceNumber || "draft"}_${dateStr}.xlsx`;
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
      const companyId = (req.session as any).currentCompanyId;
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
        const unfToday = new Date().toISOString().split("T")[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
      const cancelToday = new Date().toISOString().split("T")[0];
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
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { customerId, proformaIdUsed, locationId, orderDate } = req.body;
      if (!customerId) return res.status(400).json({ message: "Customer is required" });
      if (!locationId) return res.status(400).json({ message: "Location is required" });

      const [order] = await db.insert(customerOrders).values({
        companyId,
        customerId: parseInt(customerId),
        proformaIdUsed: proformaIdUsed ? parseInt(proformaIdUsed) : null,
        locationId: parseInt(locationId),
        orderDate: orderDate || new Date().toISOString().split('T')[0],
        status: "LOADING",
        loadingStartedAt: new Date(),
      }).returning();

      const [loadingCustomer] = await db.select({ legalName: customers.legalName }).from(customers).where(eq(customers.id, parseInt(customerId)));
      const loadingToday = new Date().toISOString().split('T')[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
      const lsToday = new Date().toISOString().split('T')[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
        const verifyToday = new Date().toISOString().split('T')[0];
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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

      const sortedLines = lines.sort((a: any, b: any) => (a.baleName || "").localeCompare(b.baleName || ""));

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
        csv += `${idx + 1},${line.articleCode},${(line.baleName || "").replace(/,/g, " ")},${csvFmtNum(line.qty)},${csvFmtNum(line.weightPerBale)},${csvFmtNum(line.totalWeight)},${csvFmtMoney(line.pricePerBale)},${csvFmtMoney(line.totalPrice)}\n`;
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
  // INVOICE EXPORT (PDF as HTML)
  // ───────────────────────────────────────────────

  app.get("/api/factory/customer-orders/:id/export-pdf", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
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

      const sortedLines = lines.sort((a: any, b: any) => (a.baleName || "").localeCompare(b.baleName || ""));

      const fmtNum = (val: any): string => {
        const n = parseFloat(val);
        if (isNaN(n)) return val ?? "";
        return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, "");
      };
      const fmtMoney = (val: any): string => `$${fmtNum(val)}`;

      let linesHtml = "";
      sortedLines.forEach((line: any, idx: number) => {
        linesHtml += `<tr>
          <td style="white-space:nowrap;text-align:center">${idx + 1}</td>
          <td style="white-space:nowrap">${line.articleCode}</td>
          <td>${line.baleName || ""}</td>
          <td style="white-space:nowrap;text-align:right">${fmtNum(line.qty)}</td>
          <td style="white-space:nowrap;text-align:right">${fmtNum(line.weightPerBale)}</td>
          <td style="white-space:nowrap;text-align:right">${fmtNum(line.totalWeight)}</td>
          <td style="white-space:nowrap;text-align:right">${fmtMoney(line.pricePerBale)}</td>
          <td style="white-space:nowrap;text-align:right">${fmtMoney(line.totalPrice)}</td>
        </tr>`;
      });

      let chargesHtml = "";
      for (const charge of charges) {
        chargesHtml += `<tr><td>${charge.name}</td><td style="white-space:nowrap">${charge.chargeType}</td><td style="white-space:nowrap;text-align:right">${fmtMoney(charge.amount)}</td></tr>`;
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${order.invoiceNumber || "DRAFT"}</title>
<style>
body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
h1 { margin-bottom: 5px; }
.header-info { margin-bottom: 20px; }
.header-info p { margin: 2px 0; }
table { border-collapse: collapse; margin-bottom: 20px; }
.lines-table { width: 100%; table-layout: auto; }
th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 13px; }
th { background-color: #f5f5f5; white-space: nowrap; }
.totals-table { min-width: 280px; margin-left: auto; }
.totals-table td:last-child { text-align: right; font-weight: bold; white-space: nowrap; }
.grand-total { font-size: 15px; font-weight: bold; background: #f0f0f0; }
@media print { body { margin: 20px; } }
</style></head><body>
<h1>${company?.name || ""}</h1>
<div class="header-info">
<p><strong>Invoice:</strong> ${order.invoiceNumber || "DRAFT"}</p>
<p><strong>Customer:</strong> ${order.customerName} (${order.customerCode})</p>
<p><strong>Date:</strong> ${order.orderDate}</p>
</div>
<h3>Order Lines</h3>
<table class="lines-table">
<thead><tr>
  <th style="text-align:center">#</th>
  <th>Article Code</th>
  <th>Product</th>
  <th style="text-align:right">Qty</th>
  <th style="text-align:right">Weight/Bale</th>
  <th style="text-align:right">Total Weight</th>
  <th style="text-align:right">Price/Bale</th>
  <th style="text-align:right">Total Price</th>
</tr></thead>
<tbody>${linesHtml}</tbody>
</table>
${charges.length > 0 ? `<h3>Charges</h3><table><thead><tr><th>Name</th><th>Type</th><th style="text-align:right">Amount</th></tr></thead><tbody>${chargesHtml}</tbody></table>` : ""}
<table class="totals-table">
<tr><td>Subtotal Bales</td><td>${fmtMoney(order.subtotalBales)}</td></tr>
<tr><td>Freight</td><td>${fmtMoney(order.freightAmount)}</td></tr>
<tr><td>Other Charges</td><td>${fmtMoney(order.otherChargesTotal)}</td></tr>
<tr class="grand-total"><td>Grand Total</td><td>${fmtMoney(order.grandTotal)}</td></tr>
<tr><td>Total Qty Bales</td><td style="text-align:right;font-weight:bold">${fmtNum(order.totalQtyBales)}</td></tr>
</table>
</body></html>`;

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (error: any) {
      console.error("Error exporting order to PDF:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENT TYPES ───────

  app.get("/api/factory/container-doc-types", requireAuth, async (req: any, res: any) => {
    try {
      const rows = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/container-doc-types", requireAuth, async (req: any, res: any) => {
    try {
      const [row] = await db.insert(containerDocumentTypes).values(req.body).returning();
      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER DOCUMENTS (upload / list / delete) ───────

  app.get("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const docs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
      const docTypes = await db.select().from(containerDocumentTypes).orderBy(containerDocumentTypes.label);
      const requiredTypes = docTypes.filter((dt: any) => dt.isRequired);
      const uploadedTypeIds = new Set(docs.map((d: any) => d.docTypeId));
      const completeness = {
        total: requiredTypes.length,
        uploaded: requiredTypes.filter((rt: any) => uploadedTypeIds.has(rt.id)).length,
        complete: requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id)),
      };
      res.json({ documents: docs, docTypes, completeness });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:containerId/documents", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const path = await import("path");
      const fs = await import("fs");
      const uploadDir = path.default.join(process.cwd(), "uploads", "container-docs");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const storage = multer.diskStorage({
        destination: (_req: any, _file: any, cb: any) => cb(null, uploadDir),
        filename: (_req: any, file: any, cb: any) => {
          const ext = path.default.extname(file.originalname);
          cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        },
      });
      const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

      upload.single("file")(req, res, async (err: any) => {
        try {
          if (err) return res.status(400).json({ message: err.message });
          if (!req.file) return res.status(400).json({ message: "No file uploaded" });

          const containerId = Number(req.params.containerId);
          const companyId = (req.session as any).currentCompanyId;
          const docTypeId = Number(req.body.docTypeId);
          if (!companyId || !docTypeId) return res.status(400).json({ message: "Missing companyId or docTypeId" });

          const storageKey = `container-docs/${req.file.filename}`;
          const [doc] = await db.insert(containerDocuments).values({
            companyId,
            containerId,
            docTypeId,
            fileName: req.file.originalname,
            storageKey,
            mimeType: req.file.mimetype,
            uploadedBy: (req.session as any).userId ? Number((req.session as any).userId) : null,
          }).returning();

          const docType = await db.select().from(containerDocumentTypes).where(eq(containerDocumentTypes.id, docTypeId));
          const docTypeName = docType[0]?.label || "Document";

          await writeDaybookEntry(db, {
            companyId,
            txDate: new Date().toISOString().split("T")[0],
            txType: "DOC_UPLOAD",
            referenceId: containerId,
            referenceTable: "containers",
            description: `Uploaded ${docTypeName}: ${req.file.originalname} for container #${containerId}`,
            metaJson: JSON.stringify({ docId: doc.id, docTypeId, fileName: req.file.originalname }),
            createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
          });

          const allDocs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
          const allDocTypes = await db.select().from(containerDocumentTypes);
          const requiredTypes = allDocTypes.filter((dt: any) => dt.isRequired);
          const uploadedTypeIds = new Set(allDocs.map((d: any) => d.docTypeId));
          const allComplete = requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id));
          await db.update(containers).set({ docReceived: allComplete }).where(eq(containers.id, containerId));

          res.json(doc);
        } catch (innerErr: any) {
          console.error("Error uploading container document:", innerErr);
          res.status(500).json({ message: innerErr.message });
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:containerId/documents/:docId", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const docId = Number(req.params.docId);
      const companyId = (req.session as any).currentCompanyId;

      const [deleted] = await db.delete(containerDocuments)
        .where(and(eq(containerDocuments.id, docId), eq(containerDocuments.containerId, containerId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Document not found" });

      const fs = await import("fs");
      const path = await import("path");
      const filePath = path.default.join(process.cwd(), "uploads", deleted.storageKey);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "DOC_DELETE",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Deleted document: ${deleted.fileName} from container #${containerId}`,
        metaJson: JSON.stringify({ docId: deleted.id, fileName: deleted.fileName }),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      const allDocs = await db.select().from(containerDocuments).where(eq(containerDocuments.containerId, containerId));
      const allDocTypes = await db.select().from(containerDocumentTypes);
      const requiredTypes = allDocTypes.filter((dt: any) => dt.isRequired);
      const uploadedTypeIds = new Set(allDocs.map((d: any) => d.docTypeId));
      const allComplete = requiredTypes.length > 0 && requiredTypes.every((rt: any) => uploadedTypeIds.has(rt.id));
      await db.update(containers).set({ docReceived: allComplete }).where(eq(containers.id, containerId));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/uploads/:folder/:filename", async (req: any, res: any) => {
    try {
      const path = await import("path");
      const fs = await import("fs");
      const filePath = path.default.join(process.cwd(), "uploads", req.params.folder, req.params.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found" });
      res.sendFile(filePath);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── CONTAINER FREIGHT ───────

  app.get("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const freightRows = await db.select().from(containerFreight).where(eq(containerFreight.containerId, containerId));
      const freightWithPayments = await Promise.all(freightRows.map(async (fr: any) => {
        const payments = await db.select().from(containerFreightPayments)
          .where(eq(containerFreightPayments.containerFreightId, fr.id));
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const freightAmount = Number(fr.freightAmount);
        const computedStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
        return { ...fr, payments, totalPaid, computedStatus };
      }));
      res.json(freightWithPayments);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/containers/:containerId/freight", requireAuth, async (req: any, res: any) => {
    try {
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [row] = await db.insert(containerFreight).values({
        companyId,
        containerId,
        vendorName: req.body.vendorName || null,
        vendorSupplierId: req.body.vendorSupplierId || null,
        freightAmount: String(req.body.freightAmount || 0),
        currency: req.body.currency || "USD",
        dueDate: req.body.dueDate || null,
        status: "UNPAID",
        notes: req.body.notes || null,
      }).returning();

      await writeDaybookEntry(db, {
        companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "FREIGHT_ADD",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Added freight charge ${row.currency} ${row.freightAmount} for container #${containerId}${row.vendorName ? ` (${row.vendorName})` : ""}`,
        currencyCode: row.currency,
        amountCurrency: Number(row.freightAmount),
        metaJson: JSON.stringify({ freightId: row.id, vendorName: row.vendorName }),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json(row);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/containers/:containerId/freight/:freightId", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const containerId = Number(req.params.containerId);
      const companyId = (req.session as any).currentCompanyId;

      await db.delete(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
      const [deleted] = await db.delete(containerFreight)
        .where(and(eq(containerFreight.id, freightId), eq(containerFreight.containerId, containerId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Freight not found" });

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "FREIGHT_DELETE",
        referenceId: containerId,
        referenceTable: "containers",
        description: `Deleted freight charge ${deleted.currency} ${deleted.freightAmount} from container #${containerId}`,
        currencyCode: deleted.currency,
        amountCurrency: Number(deleted.freightAmount),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── FREIGHT PAYMENTS ───────

  app.post("/api/factory/freight/:freightId/payments", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const [payment] = await db.insert(containerFreightPayments).values({
        companyId,
        containerFreightId: freightId,
        paymentDate: req.body.paymentDate,
        amount: String(req.body.amount),
        method: req.body.method || null,
        reference: req.body.reference || null,
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : null,
      }).returning();

      const [fr] = await db.select().from(containerFreight).where(eq(containerFreight.id, freightId));
      const payments = await db.select().from(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
      const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      const freightAmount = Number(fr.freightAmount);
      const newStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
      await db.update(containerFreight).set({ status: newStatus, updatedAt: new Date() }).where(eq(containerFreight.id, freightId));

      await writeDaybookEntry(db, {
        companyId,
        txDate: req.body.paymentDate || new Date().toISOString().split("T")[0],
        txType: "FREIGHT_PAYMENT",
        referenceId: fr.containerId,
        referenceTable: "containers",
        description: `Freight payment ${fr.currency} ${req.body.amount} for container #${fr.containerId}${fr.vendorName ? ` (${fr.vendorName})` : ""}`,
        currencyCode: fr.currency,
        amountCurrency: Number(req.body.amount),
        metaJson: JSON.stringify({ freightId, paymentId: payment.id }),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/freight/:freightId/payments/:paymentId", requireAuth, async (req: any, res: any) => {
    try {
      const freightId = Number(req.params.freightId);
      const paymentId = Number(req.params.paymentId);
      const companyId = (req.session as any).currentCompanyId;

      const [deleted] = await db.delete(containerFreightPayments)
        .where(and(eq(containerFreightPayments.id, paymentId), eq(containerFreightPayments.containerFreightId, freightId)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Payment not found" });

      const [fr] = await db.select().from(containerFreight).where(eq(containerFreight.id, freightId));
      if (fr) {
        const payments = await db.select().from(containerFreightPayments).where(eq(containerFreightPayments.containerFreightId, freightId));
        const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
        const freightAmount = Number(fr.freightAmount);
        const newStatus = totalPaid >= freightAmount ? "PAID" : totalPaid > 0 ? "PARTIAL" : "UNPAID";
        await db.update(containerFreight).set({ status: newStatus, updatedAt: new Date() }).where(eq(containerFreight.id, freightId));
      }

      await writeDaybookEntry(db, {
        companyId: companyId || deleted.companyId,
        txDate: new Date().toISOString().split("T")[0],
        txType: "FREIGHT_PAYMENT_DELETE",
        referenceId: fr?.containerId,
        referenceTable: "containers",
        description: `Deleted freight payment of ${deleted.amount} for freight #${freightId}`,
        amountCurrency: Number(deleted.amount),
        createdBy: (req.session as any).userId ? Number((req.session as any).userId) : undefined,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── BATCH OTW FREIGHT STATUS ───────

  app.get("/api/factory/containers/freight-status", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.json({});
      const allFreight = await db.select().from(containerFreight).where(eq(containerFreight.companyId, companyId));
      const freightIds = allFreight.map((f: any) => f.id);
      let allPayments: any[] = [];
      if (freightIds.length > 0) {
        allPayments = await db.select().from(containerFreightPayments).where(inArray(containerFreightPayments.containerFreightId, freightIds));
      }
      const paymentsByFreight = new Map<number, number>();
      for (const p of allPayments) {
        paymentsByFreight.set(p.containerFreightId, (paymentsByFreight.get(p.containerFreightId) || 0) + Number(p.amount));
      }

      const statusByContainer: Record<number, { totalFreight: number; totalPaid: number; status: string }> = {};
      for (const fr of allFreight) {
        const cid = fr.containerId;
        if (!statusByContainer[cid]) statusByContainer[cid] = { totalFreight: 0, totalPaid: 0, status: "NONE" };
        statusByContainer[cid].totalFreight += Number(fr.freightAmount);
        statusByContainer[cid].totalPaid += paymentsByFreight.get(fr.id) || 0;
      }
      for (const cid of Object.keys(statusByContainer)) {
        const s = statusByContainer[Number(cid)];
        s.status = s.totalFreight === 0 ? "NONE" : s.totalPaid >= s.totalFreight ? "PAID" : s.totalPaid > 0 ? "PARTIAL" : "UNPAID";
      }
      res.json(statusByContainer);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────── DAYBOOK ENTRY EDIT ───────

  app.put("/api/factory/daybook/:entryId", requireAuth, async (req: any, res: any) => {
    try {
      const rawEntryId = Number(req.params.entryId);
      const session = req.session as any;
      const companyId = session.currentCompanyId;
      const userId = session.userId ? Number(session.userId) : null;
      const { reason, description, amountCurrency, amountUsd, currencyCode, fxRateToUsd, txDate } = req.body;

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ message: "Edit reason is required" });
      }

      const canEdit = session.role === "admin" || session.daybookEditDays > 0;
      if (!canEdit) return res.status(403).json({ message: "You do not have permission to edit daybook entries" });

      let existing: any;
      let realEntryId: number;

      if (rawEntryId < 0) {
        // ── Synthetic row: backed by a voucher not yet in factory_daybook_entries ──
        // Negative ID means Math.abs(rawEntryId) is the voucher ID.
        const realVoucherId = Math.abs(rawEntryId);
        const [sourceVoucher] = await db.select().from(vouchers).where(eq(vouchers.id, realVoucherId));
        if (!sourceVoucher) return res.status(404).json({ message: "Source voucher not found" });

        const voucherTxTypeMap: Record<string, string> = { Payment: "PAYMENT", Receipt: "RECEIPT", Journal: "JOURNAL" };
        const txTypeVal = voucherTxTypeMap[sourceVoucher.voucherType] || "JOURNAL";
        const currency = sourceVoucher.currency || "USD";
        const fxRate = parseFloat(sourceVoucher.exchangeRate || "1") || 1;
        const amtCurrency = parseFloat(sourceVoucher.totalAmount || "0");
        const amtUsd = currency === "USD" ? amtCurrency : amtCurrency * fxRate;

        // Insert a real daybook entry from this voucher so it can be edited going forward
        const [inserted] = await db.insert(factoryDaybookEntries).values({
          companyId,
          txDate: sourceVoucher.voucherDate,
          txType: txTypeVal,
          referenceId: realVoucherId,
          referenceTable: "vouchers",
          description: description !== undefined ? description : (sourceVoucher.description || `${sourceVoucher.voucherType} voucher #${sourceVoucher.voucherNumber}`),
          currencyCode: currency,
          amountCurrency: String(amtCurrency),
          fxRateToUsd: String(fxRate),
          amountUsd: String(amtUsd),
          createdBy: userId,
        }).returning();
        existing = inserted;
        realEntryId = inserted.id;
      } else {
        // ── Real daybook entry ────────────────────────────────────────────────
        const [found] = await db.select().from(factoryDaybookEntries).where(eq(factoryDaybookEntries.id, rawEntryId));
        if (!found) return res.status(404).json({ message: "Daybook entry not found" });
        existing = found;
        realEntryId = rawEntryId;
      }

      if (session.role !== "admin" && session.daybookEditDays) {
        const entryDate = new Date(existing.txDate);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - session.daybookEditDays);
        if (entryDate < cutoff) {
          return res.status(403).json({ message: `Entry is older than ${session.daybookEditDays} days and cannot be edited` });
        }
      }

      const beforeJson = JSON.stringify(existing);

      const updates: any = {};
      if (description !== undefined) updates.description = description;
      if (amountCurrency !== undefined) updates.amountCurrency = String(amountCurrency);
      if (amountUsd !== undefined) updates.amountUsd = String(amountUsd);
      if (currencyCode !== undefined) updates.currencyCode = currencyCode;
      if (fxRateToUsd !== undefined) updates.fxRateToUsd = String(fxRateToUsd);
      if (txDate !== undefined) updates.txDate = txDate;

      const [updated] = await db.update(factoryDaybookEntries).set(updates).where(eq(factoryDaybookEntries.id, realEntryId)).returning();
      const afterJson = JSON.stringify(updated);

      await db.insert(factoryDaybookEntryEdits).values({
        daybookEntryId: realEntryId,
        editedBy: userId,
        beforeJson,
        afterJson,
        reason: reason.trim(),
      });

      // ── Sync description back to the source voucher so Accounts statements stay in sync ──
      if (description !== undefined && updated.referenceTable === "vouchers" && updated.referenceId) {
        await db.update(vouchers)
          .set({ description })
          .where(and(eq(vouchers.id, updated.referenceId), eq(vouchers.companyId, companyId)));
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error editing daybook entry:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/daybook/:entryId/edits", requireAuth, async (req: any, res: any) => {
    try {
      const entryId = Number(req.params.entryId);
      const edits = await db.select().from(factoryDaybookEntryEdits)
        .where(eq(factoryDaybookEntryEdits.daybookEntryId, entryId))
        .orderBy(desc(factoryDaybookEntryEdits.editedAt));
      res.json(edits);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/factory/daybook/entry/:id/void — Void a voucher-backed daybook entry
  app.delete("/api/factory/daybook/entry/:id/void", requireAuth, async (req: any, res: any) => {
    try {
      const session = req.session as any;
      const companyId = session.factoryCompanyId || session.currentCompanyId;
      const role = (session.currentRole || session.role || "").toLowerCase();
      if (role !== "admin" && role !== "owner") {
        return res.status(403).json({ message: "Only Admin or Owner can void vouchers" });
      }

      const rawId = Number(req.params.id);
      if (isNaN(rawId)) return res.status(400).json({ message: "Invalid entry ID" });

      let voucherId: number;
      let daybookEntryId: number | null = null;

      if (rawId < 0) {
        voucherId = Math.abs(rawId);
      } else {
        const [entry] = await db.select().from(factoryDaybookEntries)
          .where(and(eq(factoryDaybookEntries.id, rawId), eq(factoryDaybookEntries.companyId, companyId)));
        if (!entry) return res.status(404).json({ message: "Daybook entry not found" });
        if (entry.referenceTable !== "vouchers" || !entry.referenceId) {
          return res.status(400).json({ message: "This entry is not voucher-backed and cannot be voided" });
        }
        voucherId = entry.referenceId;
        daybookEntryId = entry.id;
      }

      const [voucher] = await db.select().from(vouchers)
        .where(and(eq(vouchers.id, voucherId), eq(vouchers.companyId, companyId), sql`${vouchers.deletedAt} IS NULL`));
      if (!voucher) return res.status(404).json({ message: "Voucher not found or already voided" });

      if (!["Payment", "Receipt", "Journal"].includes(voucher.voucherType)) {
        return res.status(400).json({ message: `Cannot void ${voucher.voucherType} vouchers from the daybook` });
      }

      const vNum = voucher.voucherNumber || "";
      const voucherTxTypeMap: Record<string, string> = { Payment: "PAYMENT", Receipt: "RECEIPT", Journal: "JOURNAL" };
      const txTypeVal = voucherTxTypeMap[voucher.voucherType] || "JOURNAL";
      const today = new Date().toISOString().split("T")[0];

      await db.transaction(async (tx: any) => {
        // 1. Delete voucher entries (double-entry lines)
        await tx.delete(voucherEntries).where(eq(voucherEntries.voucherId, voucherId));

        // 2. Soft-delete the voucher
        await tx.update(vouchers).set({ deletedAt: new Date() }).where(eq(vouchers.id, voucherId));

        // 3. Delete the real daybook entry if it exists
        if (daybookEntryId) {
          await tx.delete(factoryDaybookEntries).where(eq(factoryDaybookEntries.id, daybookEntryId));
        }

        // 4. Cascade effects based on voucher number pattern
        const advPayMatch = vNum.match(/^PAYMENT-ADV-(\d+)-/);
        const payPayMatch = vNum.match(/^PAYMENT-PAY-(\d+)-/);
        const repayMatch = vNum.match(/^RECEIPT-REPAY-(\d+)-/);

        if (advPayMatch) {
          const advanceId = parseInt(advPayMatch[1]);
          await tx.update(factoryWorkerAdvances).set({ cashAccountId: null })
            .where(and(eq(factoryWorkerAdvances.id, advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
        } else if (payPayMatch) {
          const payrollId = parseInt(payPayMatch[1]);
          const [payroll] = await tx.select().from(factoryPayrolls)
            .where(and(eq(factoryPayrolls.id, payrollId), eq(factoryPayrolls.companyId, companyId)));

          await tx.update(factoryPayrolls).set({ status: "DRAFT", cashAccountId: null, paidAt: null })
            .where(and(eq(factoryPayrolls.id, payrollId), eq(factoryPayrolls.companyId, companyId)));

          if (payroll) {
            const advAmt = parseFloat(payroll.advances || "0");
            if (advAmt > 0) {
              const workerAdvances = await tx.select().from(factoryWorkerAdvances)
                .where(and(
                  eq(factoryWorkerAdvances.companyId, companyId),
                  eq(factoryWorkerAdvances.workerId, payroll.workerId),
                  eq(factoryWorkerAdvances.repaymentType, "salary_deduction"),
                ))
                .orderBy(desc(factoryWorkerAdvances.advanceDate));

              let toRestore = advAmt;
              for (const adv of workerAdvances) {
                if (toRestore <= 0) break;
                const bal = parseFloat(adv.remainingBalance || "0");
                const originalAmt = parseFloat(adv.amount || "0");
                const room = originalAmt - bal;
                if (room <= 0) continue;
                const restoreAmt = Math.min(room, toRestore);
                const newBal = bal + restoreAmt;
                await tx.update(factoryWorkerAdvances).set({
                  remainingBalance: newBal.toFixed(2),
                  fullyPaid: false,
                }).where(eq(factoryWorkerAdvances.id, adv.id));
                toRestore -= restoreAmt;
              }
            }
          }
        } else if (repayMatch) {
          const repaymentId = parseInt(repayMatch[1]);
          const [repayment] = await tx.select().from(factoryAdvanceRepayments)
            .where(and(eq(factoryAdvanceRepayments.id, repaymentId), eq(factoryAdvanceRepayments.companyId, companyId)));
          if (repayment) {
            const [advance] = await tx.select().from(factoryWorkerAdvances)
              .where(and(eq(factoryWorkerAdvances.id, repayment.advanceId), eq(factoryWorkerAdvances.companyId, companyId)));
            if (advance) {
              const newBalance = parseFloat(advance.remainingBalance || "0") + parseFloat(repayment.amount || "0");
              await tx.update(factoryWorkerAdvances).set({
                remainingBalance: newBalance.toFixed(2),
                fullyPaid: false,
              }).where(eq(factoryWorkerAdvances.id, advance.id));
            }
            await tx.delete(factoryAdvanceRepayments).where(eq(factoryAdvanceRepayments.id, repaymentId));
          }
        }

        // 5. Write a VOIDED audit daybook entry (no voucher reference so it won't be filtered by soft-delete logic)
        const voidTxType = `${txTypeVal}_VOIDED`;
        const amt = parseFloat(voucher.totalAmount || "0");
        const currency = voucher.currency || "USD";
        const fxRate = parseFloat(voucher.exchangeRate || "1") || 1;
        const amtUsd = currency === "USD" ? amt : amt * fxRate;
        await writeDaybookEntry(tx, {
          companyId,
          txDate: today,
          txType: voidTxType,
          description: `VOIDED: ${voucher.description || voucher.voucherNumber} (voucher #${voucherId})`,
          currencyCode: currency,
          amountCurrency: amt,
          fxRateToUsd: fxRate,
          amountUsd: amtUsd,
          createdBy: session.userId ? Number(session.userId) : undefined,
        });
      });

      res.json({ message: "Voucher voided successfully", voucherId });
    } catch (error: any) {
      console.error("Error voiding voucher:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ───────────────────────────────────────────────
  // Factory User Management
  // ───────────────────────────────────────────────

  app.get("/api/factory/users", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (currentRole !== "Admin" && currentRole !== "Owner" && currentRole !== "Developer") {
        return res.status(403).json({ message: "Only Admin or Owner can manage users" });
      }

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        active: users.active,
        createdAt: users.createdAt,
      }).from(users);

      // Collect Developer user IDs to hide them from non-Developer viewers
      const devRoles = await db
        .select({ userId: userCompanyRoles.userId })
        .from(userCompanyRoles)
        .where(eq(userCompanyRoles.role, "Developer"));
      const devUserIds = new Set(devRoles.map((r: any) => r.userId));
      const requesterIsDeveloper = currentRole === "Developer";

      const visibleUsers = allUsers.filter((u: any) =>
        requesterIsDeveloper || !devUserIds.has(u.id)
      );

      const profiles = await db.select()
        .from(factoryUserProfiles)
        .where(eq(factoryUserProfiles.companyId, companyId));

      const access = await db.select()
        .from(factoryUserPageAccess)
        .where(eq(factoryUserPageAccess.companyId, companyId));

      const profileMap = new Map(profiles.map((p: any) => [p.userId, p]));
      const accessMap = new Map<string, string[]>();
      access.forEach((a: any) => {
        if (!accessMap.has(a.userId)) accessMap.set(a.userId, []);
        accessMap.get(a.userId)!.push(a.pageKey);
      });

      const result = visibleUsers.map((u: any) => {
        const profile = profileMap.get(u.id);
        return {
          ...u,
          displayName: profile?.displayName || null,
          hasErpAccess: profile?.hasErpAccess ?? true,
          hasFactoryAccess: profile?.hasFactoryAccess ?? true,
          hiddenCostFields: profile?.hiddenCostFields ?? [],
          pageAccess: accessMap.get(u.id) || [],
        };
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error fetching factory users:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/users", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can manage users" });
      }

      const { username, password, displayName, pageAccess, hasErpAccess, hasFactoryAccess } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (password.length < 4) {
        return res.status(400).json({ message: "Password must be at least 4 characters" });
      }

      const existing = await db.select().from(users).where(eq(users.username, username));
      if (existing.length > 0) {
        return res.status(400).json({ message: "Username already exists" });
      }

      await db.transaction(async (tx: any) => {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [newUser] = await tx.insert(users).values({
          username,
          password: hashedPassword,
          active: true,
        }).returning();

        await tx.insert(userCompanyRoles).values({
          userId: newUser.id,
          companyId,
          role: "User",
        });

        await tx.insert(factoryUserProfiles).values({
          companyId,
          userId: newUser.id,
          displayName: displayName || username,
          hasErpAccess: hasErpAccess ?? true,
          hasFactoryAccess: hasFactoryAccess ?? true,
        });

        if (Array.isArray(pageAccess) && pageAccess.length > 0) {
          await tx.insert(factoryUserPageAccess).values(
            pageAccess.map((pk: string) => ({
              companyId,
              userId: newUser.id,
              pageKey: pk,
            }))
          );
        }

        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json({
          ...userWithoutPassword,
          displayName: displayName || username,
          hasErpAccess: hasErpAccess ?? true,
          hasFactoryAccess: hasFactoryAccess ?? true,
          pageAccess: pageAccess || [],
        });
      });
    } catch (error: any) {
      console.error("Error creating factory user:", error);
      res.status(400).json({ message: error.message });
    }
  });

  app.put("/api/factory/users/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can manage users" });
      }

      const { userId } = req.params;
      const { displayName, pageAccess, password, hasErpAccess, hasFactoryAccess, hiddenCostFields, username } = req.body;

      await db.transaction(async (tx: any) => {
        const userUpdates: any = {};
        if (password && password.length >= 4) {
          userUpdates.password = await bcrypt.hash(password, 10);
        }
        if (username && username.trim()) {
          const existingWithUsername = await tx.select({ id: users.id }).from(users).where(eq(users.username, username.trim()));
          if (existingWithUsername.length > 0 && existingWithUsername[0].id !== userId) {
            throw new Error("Username already taken");
          }
          userUpdates.username = username.trim();
        }
        if (Object.keys(userUpdates).length > 0) {
          await tx.update(users).set(userUpdates).where(eq(users.id, userId));
        }

        const profileUpdates: any = { updatedAt: new Date() };
        if (displayName !== undefined) profileUpdates.displayName = displayName;
        if (hasErpAccess !== undefined) profileUpdates.hasErpAccess = hasErpAccess;
        if (hasFactoryAccess !== undefined) profileUpdates.hasFactoryAccess = hasFactoryAccess;
        if (Array.isArray(hiddenCostFields)) profileUpdates.hiddenCostFields = hiddenCostFields;

        const existingProfile = await tx.select()
          .from(factoryUserProfiles)
          .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));

        if (existingProfile.length > 0) {
          await tx.update(factoryUserProfiles)
            .set(profileUpdates)
            .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));
        } else {
          await tx.insert(factoryUserProfiles).values({
            companyId,
            userId,
            displayName: displayName || "User",
            hasErpAccess: hasErpAccess ?? true,
            hasFactoryAccess: hasFactoryAccess ?? true,
            hiddenCostFields: Array.isArray(hiddenCostFields) ? hiddenCostFields : [],
          });
        }

        if (Array.isArray(pageAccess)) {
          await tx.delete(factoryUserPageAccess)
            .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));

          if (pageAccess.length > 0) {
            await tx.insert(factoryUserPageAccess).values(
              pageAccess.map((pk: string) => ({
                companyId,
                userId,
                pageKey: pk,
              }))
            );
          }
        }
      });

      res.json({ message: "User updated" });
    } catch (error: any) {
      console.error("Error updating factory user:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/factory/users/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      const currentRole = (req.session as any).currentRole;
      const sessionUserId = (req.session as any).userId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      if (currentRole !== "Admin" && currentRole !== "Owner") {
        return res.status(403).json({ message: "Only Admin or Owner can manage users" });
      }
      const { userId } = req.params;
      if (userId === sessionUserId) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      await db.transaction(async (tx: any) => {
        await tx.delete(factoryUserPageAccess)
          .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));
        await tx.delete(factoryUserProfiles)
          .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));
        await tx.update(users).set({ active: false }).where(eq(users.id, userId));
      });
      res.json({ message: "User removed successfully" });
    } catch (error: any) {
      console.error("Error deleting factory user:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/my-access", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      const userId = (req.session as any).userId;
      if (!companyId || !userId) return res.status(400).json({ message: "No company or user" });

      // Pin the factory company ID to the session so cross-tab ERP company switches
      // don't corrupt factory API calls made after the ERP tab changes company.
      (req.session as any).factoryCompanyId = companyId;

      const role = (req.session as any).currentRole;
      if (role === "Admin" || role === "Owner") {
        return res.json({ fullAccess: true, pageKeys: [], hasErpAccess: true, hasFactoryAccess: true, hiddenCostFields: [] });
      }

      const [profile] = await db.select({
        hasErpAccess: factoryUserProfiles.hasErpAccess,
        hasFactoryAccess: factoryUserProfiles.hasFactoryAccess,
        hiddenCostFields: factoryUserProfiles.hiddenCostFields,
      })
        .from(factoryUserProfiles)
        .where(and(eq(factoryUserProfiles.companyId, companyId), eq(factoryUserProfiles.userId, userId)));

      const hasErpAccess = profile ? profile.hasErpAccess : true;
      const hasFactoryAccess = profile ? profile.hasFactoryAccess : true;
      const hiddenCostFields = profile?.hiddenCostFields ?? [];

      const access = await db.select({ pageKey: factoryUserPageAccess.pageKey })
        .from(factoryUserPageAccess)
        .where(and(eq(factoryUserPageAccess.companyId, companyId), eq(factoryUserPageAccess.userId, userId)));

      if (access.length === 0) {
        return res.json({ fullAccess: true, pageKeys: [], hasErpAccess, hasFactoryAccess, hiddenCostFields });
      }

      res.json({
        fullAccess: false,
        pageKeys: access.map((a: any) => a.pageKey),
        hasErpAccess,
        hasFactoryAccess,
        hiddenCostFields,
      });
    } catch (error: any) {
      console.error("Error fetching my access:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============ DIRECT MESSAGES / CHAT ============

  const chatUploadsDir = path.resolve("uploads/chat");
  if (!fs.existsSync(chatUploadsDir)) fs.mkdirSync(chatUploadsDir, { recursive: true });

  const chatStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, chatUploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });
  const chatUpload = multer({ storage: chatStorage, limits: { fileSize: 25 * 1024 * 1024 } });

  const typingStatus = new Map<string, { receiverId: string; until: number }>();

  app.post("/api/chat/upload", requireAuth, chatUpload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const fileUrl = `/uploads/chat/${req.file.filename}`;
      res.json({
        fileUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/chat/typing", requireAuth, async (req: any, res: any) => {
    try {
      const senderId = (req.session as any).userId;
      const { receiverId, isTyping } = req.body;
      if (!receiverId) return res.status(400).json({ message: "receiverId required" });
      if (isTyping) {
        typingStatus.set(senderId, { receiverId, until: Date.now() + 5000 });
      } else {
        typingStatus.delete(senderId);
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/typing/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const otherUserId = req.params.userId;
      const record = typingStatus.get(otherUserId);
      const isTyping = !!record && record.receiverId === currentUserId && record.until > Date.now();
      res.json({ isTyping });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/users", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        active: users.active,
      }).from(users).where(eq(users.active, true));

      const filtered = allUsers.filter((u: any) => u.id !== currentUserId);

      // Fetch all presence records in one query
      const presenceRecords = await db.select().from(userPresence);
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const usersWithUnread = await Promise.all(filtered.map(async (u: any) => {
        const [unreadResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(directMessages)
          .where(and(
            eq(directMessages.senderId, u.id),
            eq(directMessages.receiverId, currentUserId),
            sql`${directMessages.readAt} IS NULL`
          ));
        const [msgResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(directMessages)
          .where(or(
            and(eq(directMessages.senderId, u.id), eq(directMessages.receiverId, currentUserId)),
            and(eq(directMessages.senderId, currentUserId), eq(directMessages.receiverId, u.id))
          ));

        // Find most recent presence record for this user
        const userPresenceRecords = presenceRecords.filter((p: any) => p.userId === u.id);
        const latestPresence = userPresenceRecords.sort((a: any, b: any) =>
          new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
        )[0];
        const isOnline = latestPresence ? new Date(latestPresence.lastSeen) > twoMinutesAgo : false;
        const lastSeen = latestPresence ? latestPresence.lastSeen : null;

        return {
          ...u,
          unreadCount: unreadResult?.count || 0,
          hasMessages: (msgResult?.count || 0) > 0,
          isOnline,
          lastSeen,
        };
      }));

      res.json(usersWithUnread);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/conversations/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const otherUserId = req.params.userId;

      const messages = await db.select()
        .from(directMessages)
        .where(or(
          and(eq(directMessages.senderId, currentUserId), eq(directMessages.receiverId, otherUserId)),
          and(eq(directMessages.senderId, otherUserId), eq(directMessages.receiverId, currentUserId))
        ))
        .orderBy(directMessages.createdAt);

      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/chat/messages", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const parsed = insertDirectMessageSchema.parse({
        ...req.body,
        senderId: currentUserId,
      });

      const [msg] = await db.insert(directMessages).values({
        senderId: currentUserId,
        receiverId: parsed.receiverId,
        message: parsed.message || null,
        fileUrl: parsed.fileUrl || null,
        fileName: parsed.fileName || null,
        fileType: parsed.fileType || null,
        fileSize: parsed.fileSize || null,
      }).returning();

      typingStatus.delete(currentUserId);

      res.json(msg);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post("/api/chat/mark-read/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const senderId = req.params.userId;

      await db.update(directMessages)
        .set({ readAt: new Date() })
        .where(and(
          eq(directMessages.senderId, senderId),
          eq(directMessages.receiverId, currentUserId),
          sql`${directMessages.readAt} IS NULL`
        ));

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/chat/messages/:userId", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const otherUserId = req.params.userId;

      await db.delete(directMessages)
        .where(
          or(
            and(
              eq(directMessages.senderId, currentUserId),
              eq(directMessages.receiverId, otherUserId)
            ),
            and(
              eq(directMessages.senderId, otherUserId),
              eq(directMessages.receiverId, currentUserId)
            )
          )
        );

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/chat/unread-count", requireAuth, async (req: any, res: any) => {
    try {
      const currentUserId = (req.session as any).userId;
      const [result] = await db.select({ count: sql<number>`count(*)::int` })
        .from(directMessages)
        .where(and(
          eq(directMessages.receiverId, currentUserId),
          sql`${directMessages.readAt} IS NULL`
        ));
      res.json({ count: result?.count || 0 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/factory/export-company-data", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const byCompany = (table: any) => eq(table.companyId, companyId);

      const data: Record<string, any[]> = {};

      data.locations = await db.select().from(locations).where(byCompany(locations));
      data.ledger_accounts = await db.select().from(ledgerAccounts).where(byCompany(ledgerAccounts));
      data.bank_accounts = await db.select().from(bankAccounts).where(byCompany(bankAccounts));
      data.stock_groups = await db.select().from(stockGroups).where(byCompany(stockGroups));
      data.stock_items = await db.select().from(stockItems).where(byCompany(stockItems));
      data.inventory = await db.select().from(inventory).where(byCompany(inventory));
      data.company_settings = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId));
      data.exchange_rates = await db.select().from(exchangeRates).where(byCompany(exchangeRates));
      data.customers = await db.select().from(customers).where(byCompany(customers));
      data.customer_balances = await db.select().from(customerBalances).where(byCompany(customerBalances));
      data.vouchers = await db.select().from(vouchers).where(byCompany(vouchers));

      const voucherIds = data.vouchers.map((v: any) => v.id);
      if (voucherIds.length > 0) {
        data.voucher_entries = await db.select().from(voucherEntries).where(inArray(voucherEntries.voucherId, voucherIds));
      } else {
        data.voucher_entries = [];
      }

      data.factory_settings = await db.select().from(factorySettings).where(eq(factorySettings.companyId, companyId));
      data.factory_suppliers = await db.select().from(factorySuppliers).where(byCompany(factorySuppliers));
      data.factory_categories = await db.select().from(factoryCategories).where(byCompany(factoryCategories));
      data.factory_bale_products = await db.select().from(factoryBaleProducts).where(byCompany(factoryBaleProducts));
      data.factory_fx_rates = await db.select().from(factoryFxRates).where(byCompany(factoryFxRates));
      data.factory_bale_sequences = await db.select().from(factoryBaleSequences).where(eq(factoryBaleSequences.companyId, companyId));
      data.factory_containers = await db.select().from(factoryContainers).where(byCompany(factoryContainers));
      data.factory_raw_stock = await db.select().from(factoryRawStock).where(byCompany(factoryRawStock));
      data.factory_container_commissions = await db.select().from(factoryContainerCommissions).where(byCompany(factoryContainerCommissions));
      data.factory_offload_additional_charges = await db.select().from(factoryOffloadAdditionalCharges).where(byCompany(factoryOffloadAdditionalCharges));
      data.factory_duty_audit_log = await db.select().from(factoryDutyAuditLog).where(byCompany(factoryDutyAuditLog));
      data.factory_mix_batches = await db.select().from(factoryMixBatches).where(byCompany(factoryMixBatches));

      const mixBatchIds = data.factory_mix_batches.map((b: any) => b.id);
      if (mixBatchIds.length > 0) {
        data.factory_mix_batch_sources = await db.select().from(factoryMixBatchSources).where(inArray(factoryMixBatchSources.mixBatchId, mixBatchIds));
        data.factory_daily_usages = await db.select().from(factoryDailyUsages).where(inArray(factoryDailyUsages.mixBatchId, mixBatchIds));
      } else {
        data.factory_mix_batch_sources = [];
        data.factory_daily_usages = [];
      }

      data.factory_pressing_batches = await db.select().from(factoryPressingBatches).where(byCompany(factoryPressingBatches));
      data.factory_bales = await db.select().from(factoryBales).where(byCompany(factoryBales));
      data.factory_workers = await db.select().from(factoryWorkers).where(byCompany(factoryWorkers));
      data.factory_payrolls = await db.select().from(factoryPayrolls).where(byCompany(factoryPayrolls));
      data.factory_worker_documents = await db.select().from(factoryWorkerDocuments).where(byCompany(factoryWorkerDocuments));
      data.factory_daybook_entries = await db.select().from(factoryDaybookEntries).where(byCompany(factoryDaybookEntries));

      const daybookIds = data.factory_daybook_entries.map((e: any) => e.id);
      if (daybookIds.length > 0) {
        data.factory_daybook_entry_edits = await db.select().from(factoryDaybookEntryEdits).where(inArray(factoryDaybookEntryEdits.daybookEntryId, daybookIds));
      } else {
        data.factory_daybook_entry_edits = [];
      }

      data.factory_waste_entries = await db.select().from(factoryWasteEntries).where(byCompany(factoryWasteEntries));
      data.factory_bale_photos = await db.select().from(factoryBalePhotos).where(byCompany(factoryBalePhotos));
      data.factory_alerts = await db.select().from(factoryAlerts).where(byCompany(factoryAlerts));
      data.factory_daily_kpi_snapshots = await db.select().from(factoryDailyKpiSnapshots).where(byCompany(factoryDailyKpiSnapshots));
      data.factory_supplier_score_snapshots = await db.select().from(factorySupplierScoreSnapshots).where(byCompany(factorySupplierScoreSnapshots));
      data.factory_bale_cost_snapshots = await db.select().from(factoryBaleCostSnapshots).where(byCompany(factoryBaleCostSnapshots));
      data.factory_container_profit_snapshots = await db.select().from(factoryContainerProfitSnapshots).where(byCompany(factoryContainerProfitSnapshots));

      data.customer_proformas = await db.select().from(customerProformas).where(byCompany(customerProformas));
      const proformaIds = data.customer_proformas.map((p: any) => p.id);
      if (proformaIds.length > 0) {
        data.customer_proforma_lines = await db.select().from(customerProformaLines).where(inArray(customerProformaLines.proformaId, proformaIds));
      } else {
        data.customer_proforma_lines = [];
      }

      data.customer_invoice_sequences = await db.select().from(customerInvoiceSequences).where(eq(customerInvoiceSequences.companyId, companyId));
      data.customer_orders = await db.select().from(customerOrders).where(byCompany(customerOrders));
      const orderIds = data.customer_orders.map((o: any) => o.id);
      if (orderIds.length > 0) {
        data.customer_order_lines = await db.select().from(customerOrderLines).where(inArray(customerOrderLines.orderId, orderIds));
        data.customer_order_bales = await db.select().from(customerOrderBales).where(inArray(customerOrderBales.orderId, orderIds));
        data.customer_order_charges = await db.select().from(customerOrderCharges).where(inArray(customerOrderCharges.orderId, orderIds));
      } else {
        data.customer_order_lines = [];
        data.customer_order_bales = [];
        data.customer_order_charges = [];
      }

      const exportPayload = {
        version: 1,
        sourceCompanyId: companyId,
        exportedAt: new Date().toISOString(),
        tables: data,
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="company_${companyId}_export_${new Date().toISOString().slice(0, 10)}.json"`);
      res.send(jsonStr);
    } catch (error: any) {
      console.error("Export company data error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/factory/import-company-data", requireAuth, async (req: any, res: any) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

      upload.single("file")(req, res, async (err: any) => {
        if (err) return res.status(400).json({ message: "File upload error: " + err.message });
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });

        try {
          const targetCompanyId = (req.session as any).currentCompanyId;
          if (!targetCompanyId) return res.status(400).json({ message: "No company selected" });

          const jsonStr = req.file.buffer.toString("utf-8");
          const payload = JSON.parse(jsonStr);

          if (!payload.tables || !payload.sourceCompanyId) {
            return res.status(400).json({ message: "Invalid export file format" });
          }

          if (payload.sourceCompanyId === targetCompanyId) {
            return res.status(400).json({ message: "Cannot import into the same company that was exported. Switch to a different company first." });
          }

          const [existingBales] = await db.select({ count: sql<number>`count(*)::int` }).from(factoryBales).where(eq(factoryBales.companyId, targetCompanyId));
          const [existingContainers] = await db.select({ count: sql<number>`count(*)::int` }).from(factoryContainers).where(eq(factoryContainers.companyId, targetCompanyId));
          const [existingVouchers] = await db.select({ count: sql<number>`count(*)::int` }).from(vouchers).where(eq(vouchers.companyId, targetCompanyId));
          if ((existingBales?.count || 0) > 0 || (existingContainers?.count || 0) > 0 || (existingVouchers?.count || 0) > 0) {
            return res.status(400).json({ message: "Target company already has data (bales, containers, or vouchers). Import should only be done on a new/empty company to avoid duplicates." });
          }

          await db.delete(factorySettings).where(eq(factorySettings.companyId, targetCompanyId));
          await db.delete(factoryBaleSequences).where(eq(factoryBaleSequences.companyId, targetCompanyId));
          await db.delete(customerInvoiceSequences).where(eq(customerInvoiceSequences.companyId, targetCompanyId));
          await db.delete(companySettings).where(eq(companySettings.companyId, targetCompanyId));

          const t = payload.tables;
          const summary: Record<string, number> = {};
          let totalRecords = 0;
          const importSuffix = `_C${targetCompanyId}`;

          const remap: Record<string, Map<number, number>> = {};
          const initRemap = (key: string) => { remap[key] = new Map(); };
          const r = (key: string, oldId: number | null | undefined): number | null => {
            if (oldId == null) return null;
            const mapped = remap[key]?.get(oldId);
            return mapped ?? null;
          };

          async function makeUniqueCode(tx: any, table: any, field: any, baseValue: string): Promise<string> {
            const [existing] = await tx.select({ id: table.id }).from(table).where(eq(field, baseValue)).limit(1);
            if (!existing) return baseValue;
            let attempt = baseValue + importSuffix;
            const [existing2] = await tx.select({ id: table.id }).from(table).where(eq(field, attempt)).limit(1);
            if (!existing2) return attempt;
            let counter = 2;
            while (counter < 1000) {
              const val = `${baseValue}${importSuffix}_${counter}`;
              const [ex] = await tx.select({ id: table.id }).from(table).where(eq(field, val)).limit(1);
              if (!ex) return val;
              counter++;
            }
            return baseValue + importSuffix + "_" + Date.now();
          }

          const tables = [
            "locations", "ledger_accounts", "bank_accounts", "stock_groups", "stock_items",
            "inventory", "company_settings", "exchange_rates", "customers", "customer_balances",
            "factory_settings", "factory_suppliers", "factory_categories", "factory_bale_products",
            "factory_fx_rates", "factory_bale_sequences", "factory_containers", "factory_raw_stock",
            "factory_container_commissions", "factory_offload_additional_charges", "factory_duty_audit_log",
            "factory_daily_usages", "factory_mix_batches", "factory_mix_batch_sources", "factory_pressing_batches",
            "factory_bales", "factory_workers", "factory_payrolls", "factory_worker_documents",
            "factory_daybook_entries", "factory_daybook_entry_edits", "factory_waste_entries",
            "factory_bale_photos", "factory_alerts", "factory_daily_kpi_snapshots",
            "factory_supplier_score_snapshots", "factory_bale_cost_snapshots",
            "factory_container_profit_snapshots", "customer_proformas", "customer_proforma_lines",
            "customer_invoice_sequences", "customer_orders", "customer_order_lines",
            "customer_order_bales", "customer_order_charges", "vouchers", "voucher_entries"
          ];
          tables.forEach(initRemap);

          const dateFieldNames = new Set([
            "createdAt", "updatedAt", "deletedAt", "offloadedAt", "pressedAt",
            "finalizedAt", "paidAt", "generatedAt", "approvedAt", "uploadedAt",
            "editedAt", "readAt", "logoUpdatedAt", "verifiedAt",
            "loadingStartedAt", "loadingFinalizedAt", "lastUpdated",
          ]);
          function fixDates(rec: any) {
            for (const key of Object.keys(rec)) {
              if (rec[key] == null) continue;
              if (dateFieldNames.has(key) && typeof rec[key] === "string") {
                rec[key] = new Date(rec[key]);
              }
            }
            return rec;
          }

          await db.transaction(async (tx: any) => {

            async function insertAndMap(tableName: string, drizzleTable: any, rows: any[], fkRemaps: Record<string, string>, opts?: { hasCompanyId?: boolean, nullifyFields?: string[] }) {
              const hasCompanyId = opts?.hasCompanyId !== false;
              const nullifyFields = opts?.nullifyFields || [];
              let count = 0;
              for (const row of rows) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                if (hasCompanyId) rec.companyId = targetCompanyId;
                for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                  rec[fkField] = r(remapKey, rec[fkField]);
                }
                for (const field of nullifyFields) {
                  rec[field] = null;
                }
                const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                if (inserted && oldId != null) {
                  remap[tableName].set(oldId, inserted.id);
                }
                count++;
              }
              summary[tableName] = count;
              totalRecords += count;
            }

            async function insertSelfReferencing(tableName: string, drizzleTable: any, rows: any[], parentField: string, fkRemaps: Record<string, string>, opts?: { hasCompanyId?: boolean }) {
              const hasCompanyId = opts?.hasCompanyId !== false;
              const roots = rows.filter((r: any) => r[parentField] == null);
              const children = rows.filter((r: any) => r[parentField] != null);
              let count = 0;

              for (const row of roots) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                if (hasCompanyId) rec.companyId = targetCompanyId;
                rec[parentField] = null;
                for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                  rec[fkField] = r(remapKey, rec[fkField]);
                }
                const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                if (inserted && oldId != null) remap[tableName].set(oldId, inserted.id);
                count++;
              }

              let remaining = [...children];
              let maxPasses = 20;
              while (remaining.length > 0 && maxPasses > 0) {
                const nextRemaining: any[] = [];
                for (const row of remaining) {
                  const parentMapped = r(tableName, row[parentField]);
                  if (parentMapped != null) {
                    const oldId = row.id;
                    const rec: any = fixDates({ ...row });
                    delete rec.id;
                    if (hasCompanyId) rec.companyId = targetCompanyId;
                    rec[parentField] = parentMapped;
                    for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                      rec[fkField] = r(remapKey, rec[fkField]);
                    }
                    const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                    if (inserted && oldId != null) remap[tableName].set(oldId, inserted.id);
                    count++;
                  } else {
                    nextRemaining.push(row);
                  }
                }
                remaining = nextRemaining;
                maxPasses--;
              }

              if (remaining.length > 0) {
                for (const row of remaining) {
                  const oldId = row.id;
                  const rec: any = fixDates({ ...row });
                  delete rec.id;
                  if (hasCompanyId) rec.companyId = targetCompanyId;
                  rec[parentField] = null;
                  for (const [fkField, remapKey] of Object.entries(fkRemaps)) {
                    rec[fkField] = r(remapKey, rec[fkField]);
                  }
                  const [inserted] = await tx.insert(drizzleTable).values(rec).returning({ id: drizzleTable.id });
                  if (inserted && oldId != null) remap[tableName].set(oldId, inserted.id);
                  count++;
                }
              }

              summary[tableName] = count;
              totalRecords += count;
            }

            if (t.locations?.length) {
              for (const row of t.locations) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                rec.companyId = targetCompanyId;
                rec.code = await makeUniqueCode(tx, locations, locations.code, rec.code);
                const [inserted] = await tx.insert(locations).values(rec).returning({ id: locations.id });
                if (inserted && oldId != null) remap["locations"].set(oldId, inserted.id);
              }
              summary["locations"] = t.locations.length;
              totalRecords += t.locations.length;
            }

            if (t.ledger_accounts?.length) {
              await insertSelfReferencing("ledger_accounts", ledgerAccounts, t.ledger_accounts, "parentId", {});
            }

            if (t.bank_accounts?.length) {
              for (const row of t.bank_accounts) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                rec.companyId = targetCompanyId;
                rec.linkedLedgerId = r("ledger_accounts", rec.linkedLedgerId);
                rec.code = await makeUniqueCode(tx, bankAccounts, bankAccounts.code, rec.code);
                const [inserted] = await tx.insert(bankAccounts).values(rec).returning({ id: bankAccounts.id });
                if (inserted && oldId != null) remap["bank_accounts"].set(oldId, inserted.id);
              }
              summary["bank_accounts"] = t.bank_accounts.length;
              totalRecords += t.bank_accounts.length;
            }

            if (t.stock_groups?.length) {
              await insertSelfReferencing("stock_groups", stockGroups, t.stock_groups, "parentId", {});
            }

            if (t.stock_items?.length) {
              await insertAndMap("stock_items", stockItems, t.stock_items, { stockGroupId: "stock_groups" });
            }

            if (t.inventory?.length) {
              await insertAndMap("inventory", inventory, t.inventory, { locationId: "locations", stockItemId: "stock_items" });
            }

            if (t.company_settings?.length) {
              await insertAndMap("company_settings", companySettings, t.company_settings, { parentCreditAccountId: "ledger_accounts" });
            }

            if (t.exchange_rates?.length) {
              await insertAndMap("exchange_rates", exchangeRates, t.exchange_rates, {});
            }

            if (t.customers?.length) {
              await insertAndMap("customers", customers, t.customers, { ledgerAccountId: "ledger_accounts" });
            }

            if (t.customer_balances?.length) {
              await insertAndMap("customer_balances", customerBalances, t.customer_balances, { customerId: "customers" });
            }

            if (t.factory_settings?.length) {
              await insertAndMap("factory_settings", factorySettings, t.factory_settings, {});
            }

            if (t.factory_suppliers?.length) {
              await insertAndMap("factory_suppliers", factorySuppliers, t.factory_suppliers, {});
            }

            if (t.factory_categories?.length) {
              await insertAndMap("factory_categories", factoryCategories, t.factory_categories, {});
            }

            if (t.factory_bale_products?.length) {
              await insertAndMap("factory_bale_products", factoryBaleProducts, t.factory_bale_products, { categoryId: "factory_categories" });
            }

            if (t.factory_fx_rates?.length) {
              await insertAndMap("factory_fx_rates", factoryFxRates, t.factory_fx_rates, {});
            }

            if (t.factory_bale_sequences?.length) {
              await insertAndMap("factory_bale_sequences", factoryBaleSequences, t.factory_bale_sequences, {});
            }

            if (t.factory_containers?.length) {
              await insertAndMap("factory_containers", factoryContainers, t.factory_containers, {
                supplierId: "factory_suppliers",
                freightAccountId: "ledger_accounts",
                otherChargesAccountId: "ledger_accounts",
                dutyAccountId: "ledger_accounts",
              });
            }

            if (t.factory_raw_stock?.length) {
              await insertAndMap("factory_raw_stock", factoryRawStock, t.factory_raw_stock, { containerId: "factory_containers" });
            }

            if (t.factory_container_commissions?.length) {
              await insertAndMap("factory_container_commissions", factoryContainerCommissions, t.factory_container_commissions, {
                containerId: "factory_containers",
                ledgerAccountId: "ledger_accounts",
              });
            }

            if (t.factory_offload_additional_charges?.length) {
              await insertAndMap("factory_offload_additional_charges", factoryOffloadAdditionalCharges, t.factory_offload_additional_charges, {
                containerId: "factory_containers",
                ledgerAccountId: "ledger_accounts",
              });
            }

            if (t.factory_duty_audit_log?.length) {
              await insertAndMap("factory_duty_audit_log", factoryDutyAuditLog, t.factory_duty_audit_log, {
                containerId: "factory_containers",
              }, { nullifyFields: ["updatedByUserId"] });
            }

            if (t.factory_mix_batches?.length) {
              await insertAndMap("factory_mix_batches", factoryMixBatches, t.factory_mix_batches, {
                carryForwardFromId: "factory_mix_batches",
              });
            }

            if (t.factory_mix_batch_sources?.length) {
              await insertAndMap("factory_mix_batch_sources", factoryMixBatchSources, t.factory_mix_batch_sources, {
                mixBatchId: "factory_mix_batches",
                containerId: "factory_containers",
                supplierId: "factory_suppliers",
                sourceBatchId: "factory_mix_batches",
              }, { hasCompanyId: false });
            }

            if (t.factory_daily_usages?.length) {
              await insertAndMap("factory_daily_usages", factoryDailyUsages, t.factory_daily_usages, {
                mixBatchId: "factory_mix_batches",
              });
            }

            if (t.factory_pressing_batches?.length) {
              await insertAndMap("factory_pressing_batches", factoryPressingBatches, t.factory_pressing_batches, {
                mixBatchId: "factory_mix_batches",
                productId: "factory_bale_products",
                finalizedLocationId: "locations",
              }, { nullifyFields: ["createdBy"] });
            }

            if (t.factory_bales?.length) {
              await insertAndMap("factory_bales", factoryBales, t.factory_bales, {
                mixBatchId: "factory_mix_batches",
                productId: "factory_bale_products",
                pressingBatchId: "factory_pressing_batches",
                erpLocationId: "locations",
              }, { nullifyFields: ["finalizedBy"] });
            }

            if (t.factory_workers?.length) {
              await insertAndMap("factory_workers", factoryWorkers, t.factory_workers, {});
            }

            if (t.factory_payrolls?.length) {
              await insertAndMap("factory_payrolls", factoryPayrolls, t.factory_payrolls, {
                workerId: "factory_workers",
                cashAccountId: "ledger_accounts",
              }, { nullifyFields: ["approvedBy"] });
            }

            if (t.factory_worker_documents?.length) {
              await insertAndMap("factory_worker_documents", factoryWorkerDocuments, t.factory_worker_documents, {
                workerId: "factory_workers",
              });
            }

            if (t.factory_daybook_entries?.length) {
              await insertAndMap("factory_daybook_entries", factoryDaybookEntries, t.factory_daybook_entries, {}, { nullifyFields: ["createdBy"] });
            }

            if (t.factory_daybook_entry_edits?.length) {
              await insertAndMap("factory_daybook_entry_edits", factoryDaybookEntryEdits, t.factory_daybook_entry_edits, {
                daybookEntryId: "factory_daybook_entries",
              }, { hasCompanyId: false, nullifyFields: ["editedBy"] });
            }

            if (t.factory_waste_entries?.length) {
              await insertAndMap("factory_waste_entries", factoryWasteEntries, t.factory_waste_entries, {
                mixBatchId: "factory_mix_batches",
                supplierId: "factory_suppliers",
                containerId: "factory_containers",
              }, { nullifyFields: ["createdBy"] });
            }

            if (t.factory_bale_photos?.length) {
              await insertAndMap("factory_bale_photos", factoryBalePhotos, t.factory_bale_photos, {
                baleId: "factory_bales",
              }, { nullifyFields: ["uploadedBy"] });
            }

            if (t.factory_alerts?.length) {
              await insertAndMap("factory_alerts", factoryAlerts, t.factory_alerts, {});
            }

            if (t.customer_proformas?.length) {
              await insertAndMap("customer_proformas", customerProformas, t.customer_proformas, {
                customerId: "customers",
              });
            }

            if (t.customer_proforma_lines?.length) {
              await insertAndMap("customer_proforma_lines", customerProformaLines, t.customer_proforma_lines, {
                proformaId: "customer_proformas",
              }, { hasCompanyId: false });
            }

            if (t.customer_invoice_sequences?.length) {
              await insertAndMap("customer_invoice_sequences", customerInvoiceSequences, t.customer_invoice_sequences, {});
            }

            if (t.customer_orders?.length) {
              await insertAndMap("customer_orders", customerOrders, t.customer_orders, {
                customerId: "customers",
                proformaIdUsed: "customer_proformas",
                locationId: "locations",
              }, { nullifyFields: ["verifiedByUserId"] });
            }

            if (t.customer_order_lines?.length) {
              await insertAndMap("customer_order_lines", customerOrderLines, t.customer_order_lines, {
                orderId: "customer_orders",
              }, { hasCompanyId: false });
            }

            if (t.customer_order_bales?.length) {
              await insertAndMap("customer_order_bales", customerOrderBales, t.customer_order_bales, {
                orderId: "customer_orders",
                baleId: "factory_bales",
                locationId: "locations",
              }, { hasCompanyId: false });
            }

            if (t.customer_order_charges?.length) {
              await insertAndMap("customer_order_charges", customerOrderCharges, t.customer_order_charges, {
                orderId: "customer_orders",
              }, { hasCompanyId: false });
            }

            if (t.vouchers?.length) {
              for (const row of t.vouchers) {
                const oldId = row.id;
                const rec: any = fixDates({ ...row });
                delete rec.id;
                rec.companyId = targetCompanyId;
                rec.locationId = r("locations", rec.locationId);
                rec.voucherNumber = await makeUniqueCode(tx, vouchers, vouchers.voucherNumber, rec.voucherNumber);
                const [inserted] = await tx.insert(vouchers).values(rec).returning({ id: vouchers.id });
                if (inserted && oldId != null) remap["vouchers"].set(oldId, inserted.id);
              }
              summary["vouchers"] = t.vouchers.length;
              totalRecords += t.vouchers.length;
            }

            if (t.voucher_entries?.length) {
              await insertAndMap("voucher_entries", voucherEntries, t.voucher_entries, {
                voucherId: "vouchers",
                ledgerAccountId: "ledger_accounts",
                bankAccountId: "bank_accounts",
              }, { hasCompanyId: false, nullifyFields: ["supplierId", "employeeId", "fixedAssetId"] });
            }

            if (t.factory_daily_kpi_snapshots?.length) {
              await insertAndMap("factory_daily_kpi_snapshots", factoryDailyKpiSnapshots, t.factory_daily_kpi_snapshots, {
                topWorkerId: "factory_workers",
              });
            }

            if (t.factory_supplier_score_snapshots?.length) {
              await insertAndMap("factory_supplier_score_snapshots", factorySupplierScoreSnapshots, t.factory_supplier_score_snapshots, {
                supplierId: "factory_suppliers",
              });
            }

            if (t.factory_bale_cost_snapshots?.length) {
              await insertAndMap("factory_bale_cost_snapshots", factoryBaleCostSnapshots, t.factory_bale_cost_snapshots, {
                baleId: "factory_bales",
              });
            }

            if (t.factory_container_profit_snapshots?.length) {
              await insertAndMap("factory_container_profit_snapshots", factoryContainerProfitSnapshots, t.factory_container_profit_snapshots, {
                containerId: "factory_containers",
              });
            }

          });

          res.json({
            success: true,
            message: `Successfully imported ${totalRecords} records across ${Object.keys(summary).length} tables`,
            totalRecords,
            details: summary,
          });
        } catch (importError: any) {
          console.error("Import company data error:", importError);
          res.status(500).json({ message: "Import failed: " + importError.message });
        }
      });
    } catch (error: any) {
      console.error("Import company data error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: Sales by Customer ─────────────────────────────────
  app.get("/api/factory/analytics/sales-by-customer", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select({
          customerId: containerSales.customerId,
          customerName: customers.legalName,
          containers: sql<number>`COUNT(${containerSales.id})`,
          totalAmount: sql<string>`COALESCE(SUM(${containerSales.totalAmount}), '0')`,
          paidAmount: sql<string>`COALESCE(SUM(${containerSales.paidAmount}), '0')`,
        })
        .from(containerSales)
        .leftJoin(customers, eq(containerSales.customerId, customers.id))
        .where(eq(containerSales.companyId, companyId))
        .groupBy(containerSales.customerId, customers.legalName)
        .orderBy(sql`SUM(${containerSales.totalAmount}) DESC`);

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: Container Sales Report (loaded containers by customer) ──
  app.get("/api/factory/analytics/container-sales-report", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { startDate, endDate, customerId, paymentStatus } = req.query as Record<string, string>;

      const conditions: any[] = [eq(containerSales.companyId, companyId)];
      if (startDate) conditions.push(sql`${containerSales.saleDate} >= ${startDate}`);
      if (endDate) conditions.push(sql`${containerSales.saleDate} <= ${endDate}`);
      if (customerId && customerId !== "all") conditions.push(eq(containerSales.customerId, parseInt(customerId)));
      if (paymentStatus && paymentStatus !== "all") conditions.push(eq(containerSales.paymentStatus, paymentStatus));

      const rows = await db
        .select({
          id: containerSales.id,
          saleDate: containerSales.saleDate,
          invoiceNumber: containerSales.invoiceNumber,
          paymentStatus: containerSales.paymentStatus,
          totalAmount: containerSales.totalAmount,
          paidAmount: containerSales.paidAmount,
          containerNumber: factoryContainers.containerNumber,
          containerStatus: factoryContainers.status,
          customerId: containerSales.customerId,
          customerName: customers.legalName,
        })
        .from(containerSales)
        .leftJoin(factoryContainers, eq(containerSales.containerId, factoryContainers.id))
        .leftJoin(customers, eq(containerSales.customerId, customers.id))
        .where(and(...conditions))
        .orderBy(desc(containerSales.saleDate));

      const total = rows.reduce((sum, r) => sum + parseFloat(r.totalAmount || "0"), 0);
      const paid = rows.reduce((sum, r) => sum + parseFloat(r.paidAmount || "0"), 0);

      res.json({ rows, summary: { total, paid, outstanding: total - paid, count: rows.length } });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Factory Analytics: Stock Summary (opening + closing stock) ───────────
  app.get("/api/factory/analytics/stock-summary", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Opening stock = total raw material received (cost basis)
      const [rawReceived] = await db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg} * ${factoryRawStock.costPerKgUsd}), '0')`,
          totalKg: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg}), '0')`,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      // Closing stock = remaining raw material (not yet used) + bale stock in stock
      const [rawRemaining] = await db
        .select({
          remainingCost: sql<string>`COALESCE(SUM((${factoryRawStock.receivedKg} - ${factoryRawStock.usedKg}) * ${factoryRawStock.costPerKgUsd}), '0')`,
          remainingKg: sql<string>`COALESCE(SUM(${factoryRawStock.receivedKg} - ${factoryRawStock.usedKg}), '0')`,
        })
        .from(factoryRawStock)
        .where(eq(factoryRawStock.companyId, companyId));

      const [baleStock] = await db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${factoryBales.totalCost}), '0')`,
          totalWeightKg: sql<string>`COALESCE(SUM(${factoryBales.weightKg}), '0')`,
          count: sql<number>`COUNT(${factoryBales.id})`,
        })
        .from(factoryBales)
        .where(and(
          eq(factoryBales.companyId, companyId),
          or(eq(factoryBales.status, "IN_STOCK"), eq(factoryBales.status, "FINALIZED")),
        ));

      const openingStock = parseFloat(rawReceived?.totalCost || "0");
      const closingRaw = parseFloat(rawRemaining?.remainingCost || "0");
      const closingBales = parseFloat(baleStock?.totalCost || "0");
      const closingStock = closingRaw + closingBales;

      res.json({
        openingStock,
        closingStock,
        detail: {
          rawReceived: { cost: openingStock, kg: parseFloat(rawReceived?.totalKg || "0") },
          rawRemaining: { cost: closingRaw, kg: parseFloat(rawRemaining?.remainingKg || "0") },
          balesInStock: {
            cost: closingBales,
            kg: parseFloat(baleStock?.totalWeightKg || "0"),
            count: baleStock?.count ?? 0,
          },
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─────────────────────────────────────────────────────
  // BALE RELABELING  (validate → apply → audit history)
  // ─────────────────────────────────────────────────────

  /** POST /api/factory/bales/relabel/validate
   *  Dry-run: checks each currentRef against factory_bales. Returns per-row results.
   */
  app.post("/api/factory/bales/relabel/validate", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows array is required" });
      }

      const refCodes: string[] = rows.map((r: any) => String(r.currentRef || "").trim()).filter(Boolean);
      if (refCodes.length === 0) return res.status(400).json({ message: "No reference codes provided" });

      // fetch all bales in one query
      const baleRows = await db
        .select({
          referenceNumber: factoryBales.referenceNumber,
          productName: factoryBales.productName,
          articleCode: factoryBales.articleCode,
          weightKg: factoryBales.weightKg,
          status: factoryBales.status,
        })
        .from(factoryBales)
        .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.referenceNumber, refCodes)));

      const baleMap = new Map<string, any>(baleRows.map((b: any) => [b.referenceNumber, b]));

      // detect duplicate refs in the uploaded file
      const seen = new Set<string>();
      const dupes = new Set<string>();
      for (const ref of refCodes) {
        if (seen.has(ref)) dupes.add(ref);
        seen.add(ref);
      }

      const results = rows.map((r: any) => {
        const ref = String(r.currentRef || "").trim();
        if (!ref) return { currentRef: ref, valid: false, error: "Empty reference code" };
        if (dupes.has(ref)) return { currentRef: ref, valid: false, error: "Duplicate in upload" };
        const bale = baleMap.get(ref);
        if (!bale) return { currentRef: ref, valid: false, error: "Not found in inventory" };
        return {
          currentRef: ref,
          valid: true,
          productName: bale.productName || bale.articleCode || "Unknown",
          articleCode: bale.articleCode || "",
          weightKg: bale.weightKg || "0",
          status: bale.status,
        };
      });

      const validCount = results.filter((r: any) => r.valid).length;
      const invalidCount = results.length - validCount;
      res.json({ results, validCount, invalidCount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  /** POST /api/factory/bales/relabel/apply
   *  Atomically reassigns reference codes and records audit.
   */
  app.post("/api/factory/bales/relabel/apply", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      const userId: string | null = (req.session as any).userId || null;

      const { rows, printFormat, designColor, filename } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "rows array is required" });
      }

      const validRows = rows.filter((r: any) => String(r.currentRef || "").trim());
      if (validRows.length === 0) return res.status(400).json({ message: "No valid rows to apply" });

      const result = await db.transaction(async (tx: any) => {
        // 1. Fetch bales to recode
        const refCodes = validRows.map((r: any) => String(r.currentRef).trim());
        const baleRows = await tx
          .select({
            id: factoryBales.id,
            referenceNumber: factoryBales.referenceNumber,
            productName: factoryBales.productName,
            articleCode: factoryBales.articleCode,
            weightKg: factoryBales.weightKg,
            status: factoryBales.status,
          })
          .from(factoryBales)
          .where(and(eq(factoryBales.companyId, companyId), inArray(factoryBales.referenceNumber, refCodes)));

        const baleMap = new Map<string, any>(baleRows.map((b: any) => [b.referenceNumber, b]));
        const notFound = refCodes.filter((r) => !baleMap.has(r));
        if (notFound.length > 0) {
          throw new Error(`Bales not found: ${notFound.slice(0, 5).join(", ")}${notFound.length > 5 ? ` +${notFound.length - 5} more` : ""}`);
        }

        // 2. Allocate sequential new REF codes
        const count = refCodes.length;
        const [seqRow] = await tx
          .select({ nextNumber: factoryBaleSequences.nextNumber })
          .from(factoryBaleSequences)
          .where(eq(factoryBaleSequences.companyId, companyId))
          .for("update");

        const dbMaxResult = await tx.execute(
          sql`SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(reference_number, '[^0-9]', '', 'g') AS BIGINT)), 100875) as maxnum FROM factory_bales WHERE company_id = ${companyId}`
        );
        const dbMaxRow: any = Array.isArray(dbMaxResult) ? dbMaxResult[0] : (dbMaxResult?.rows?.[0] ?? {});
        const dbMax = Number(dbMaxRow?.maxnum ?? 100875);
        const storedNext = seqRow?.nextNumber ?? 1;
        let nextNumber = Math.max(storedNext, dbMax + 1);

        const newRefs: string[] = [];
        for (let i = 0; i < count; i++) {
          newRefs.push(`REF${String(nextNumber + i).padStart(5, "0")}`);
        }

        // Upsert sequence
        if (seqRow) {
          await tx
            .update(factoryBaleSequences)
            .set({ nextNumber: nextNumber + count })
            .where(eq(factoryBaleSequences.companyId, companyId));
        } else {
          await tx.insert(factoryBaleSequences).values({ companyId, nextNumber: nextNumber + count });
        }

        // 3. Update factory_bales referenceNumber
        const recodeMap: { oldRef: string; newRef: string; bale: any }[] = refCodes.map((oldRef, i) => ({
          oldRef,
          newRef: newRefs[i],
          bale: baleMap.get(oldRef),
        }));

        for (const { oldRef, newRef } of recodeMap) {
          await tx
            .update(factoryBales)
            .set({ referenceNumber: newRef, updatedAt: new Date() })
            .where(and(eq(factoryBales.companyId, companyId), eq(factoryBales.referenceNumber, oldRef)));

          // Also update bale_label_prints if the old ref is there
          await tx
            .update(baleLabelPrints)
            .set({ referenceNumber: newRef })
            .where(and(eq(baleLabelPrints.companyId, companyId), eq(baleLabelPrints.referenceNumber, oldRef)));
        }

        // 4. Write audit session
        const [session] = await tx
          .insert(baleRecodeSessions)
          .values({
            companyId,
            performedBy: userId || null,
            uploadedFilename: filename || null,
            printFormat: printFormat || "A4",
            designColor: designColor || null,
            totalRows: rows.length,
            validRows: recodeMap.length,
            invalidRows: rows.length - recodeMap.length,
          })
          .returning({ id: baleRecodeSessions.id });

        // 5. Write audit items
        const itemValues = recodeMap.map(({ oldRef, newRef, bale }) => ({
          sessionId: session.id,
          oldReferenceCode: oldRef,
          newReferenceCode: newRef,
          productName: bale.productName || bale.articleCode || null,
          articleCode: bale.articleCode || null,
          weightKg: bale.weightKg || null,
          status: "SUCCESS",
          errorMessage: null,
        }));
        await tx.insert(baleRecodeItems).values(itemValues);

        return { sessionId: session.id, items: recodeMap.map(({ oldRef, newRef, bale }) => ({
          oldRef,
          newRef,
          productName: bale.productName || bale.articleCode || "Unknown",
          articleCode: bale.articleCode || "",
          weightKg: bale.weightKg || "0",
        })) };
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  /** GET /api/factory/bales/relabel/sessions
   *  Recent relabeling history for the company.
   */
  app.get("/api/factory/bales/relabel/sessions", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const sessions = await db
        .select()
        .from(baleRecodeSessions)
        .where(eq(baleRecodeSessions.companyId, companyId))
        .orderBy(desc(baleRecodeSessions.createdAt))
        .limit(10);

      // attach items counts
      const sessionIds = sessions.map((s: any) => s.id);
      let itemsBySession: Record<number, any[]> = {};
      if (sessionIds.length > 0) {
        const items = await db
          .select()
          .from(baleRecodeItems)
          .where(inArray(baleRecodeItems.sessionId, sessionIds));
        for (const item of items) {
          if (!itemsBySession[item.sessionId]) itemsBySession[item.sessionId] = [];
          itemsBySession[item.sessionId].push(item);
        }
      }

      const enriched = sessions.map((s: any) => ({
        ...s,
        items: itemsBySession[s.id] || [],
      }));

      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Factory Employees ────────────────────────────────────────────────────────

  // GET /api/factory/employees - list employees (employeeType = "Employee") for current company
  app.get("/api/factory/employees", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const rows = await db
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.companyId, companyId),
            eq(employees.employeeType, "Employee"),
            sql`${employees.deletedAt} IS NULL`
          )
        )
        .orderBy(employees.firstName);

      res.json(rows);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/employees/:id - single employee
  app.get("/api/factory/employees/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const [emp] = await db
        .select()
        .from(employees)
        .where(and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee")));

      if (!emp) return res.status(404).json({ message: "Employee not found" });
      res.json(emp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees - create employee with employeeType = "Employee"
  app.post("/api/factory/employees", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { firstName, lastName, code, department, phone, monthlySalary, joinDate, active } = req.body;
      if (!firstName || !lastName) return res.status(400).json({ message: "First name and last name are required" });
      if (!joinDate) return res.status(400).json({ message: "Join date is required" });

      // Auto-generate code if not provided
      let empCode = code;
      if (!empCode) {
        const firstPart = firstName.trim().substring(0, 3).toUpperCase();
        const lastPart = lastName.trim().substring(0, 3).toUpperCase();
        let baseCode = firstPart + lastPart || "EMP";
        empCode = baseCode;
        let suffix = 1;
        const existing = await db.select({ code: employees.code }).from(employees).where(eq(employees.companyId, companyId));
        const existingCodes = new Set(existing.map((e: any) => e.code));
        while (existingCodes.has(empCode)) {
          empCode = `${baseCode}${suffix}`;
          suffix++;
        }
      } else {
        const [existing] = await db.select().from(employees).where(and(eq(employees.companyId, companyId), eq(employees.code, empCode)));
        if (existing) return res.status(400).json({ message: "Employee code already exists" });
      }

      const [emp] = await db.insert(employees).values({
        companyId,
        code: empCode,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone || null,
        department: department || null,
        monthlySalary: monthlySalary ? String(monthlySalary) : "0",
        joinDate,
        employeeType: "Employee",
        active: active !== false,
      }).returning();

      res.status(201).json(emp);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/factory/employees/:id - update employee
  app.patch("/api/factory/employees/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const { firstName, lastName, department, phone, monthlySalary, active } = req.body;
      const updates: any = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (department !== undefined) updates.department = department;
      if (phone !== undefined) updates.phone = phone;
      if (monthlySalary !== undefined) updates.monthlySalary = String(monthlySalary);
      if (active !== undefined) updates.active = active;

      const [updated] = await db.update(employees).set(updates).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
      ).returning();

      if (!updated) return res.status(404).json({ message: "Employee not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/factory/employees/:id/statement - running ledger from voucher entries
  app.get("/api/factory/employees/:id/statement", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const [emp] = await db.select().from(employees).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId))
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Pull all voucher entries for this employee
      const entries = await db
        .select({
          id: voucherEntries.id,
          voucherId: voucherEntries.voucherId,
          debitAmount: voucherEntries.debitAmount,
          creditAmount: voucherEntries.creditAmount,
          narration: voucherEntries.narration,
          voucherNumber: vouchers.voucherNumber,
          voucherDate: vouchers.voucherDate,
          voucherType: vouchers.voucherType,
          description: vouchers.description,
        })
        .from(voucherEntries)
        .innerJoin(vouchers, eq(voucherEntries.voucherId, vouchers.id))
        .where(
          and(
            eq(voucherEntries.employeeId, id),
            eq(vouchers.companyId, companyId)
          )
        )
        .orderBy(vouchers.voucherDate, vouchers.id);

      // Build running balance
      let runningBalance = 0;
      const rows = entries.map((e: any) => {
        const credit = parseFloat(e.creditAmount || "0");
        const debit = parseFloat(e.debitAmount || "0");
        runningBalance += credit - debit;
        return {
          ...e,
          credit,
          debit,
          balance: runningBalance,
        };
      });

      res.json({ employee: emp, rows });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/:id/deposit - single deposit
  // DR: PAYROLL_DEPOSIT_EXPENSE, CR: Employee (via employeeId)
  app.post("/api/factory/employees/:id/deposit", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const { amount, date, notes } = req.body;
      const depositAmount = parseFloat(amount);
      if (isNaN(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });

      const [emp] = await db.select().from(employees).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
      let [payrollExpenseAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
      );
      if (!payrollExpenseAccount) {
        [payrollExpenseAccount] = await db.insert(ledgerAccounts).values({
          companyId,
          code: "PAYROLL_DEPOSIT_EXPENSE",
          name: "Payroll Deposit Expense",
          accountType: "Indirect Expense",
          openingBalance: "0",
          active: true,
        }).returning();
      }

      const voucherNumber = `EMP-DEP-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Salary deposit for ${emp.firstName} ${emp.lastName}`,
        totalAmount: depositAmount.toFixed(2),
      }).returning();

      // DR: Payroll Expense
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: payrollExpenseAccount.id,
        debitAmount: depositAmount.toFixed(2),
        creditAmount: "0",
        narration: notes || `Salary deposit - ${voucherNumber}`,
      });

      // CR: Employee
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: id,
        debitAmount: "0",
        creditAmount: depositAmount.toFixed(2),
        narration: notes || `Salary deposit - ${voucherNumber}`,
      });

      // Update employee balance
      const newBalance = parseFloat(emp.currentBalance || "0") + depositAmount;
      const newDeposits = parseFloat(emp.totalDeposits || "0") + depositAmount;
      await db.update(employees).set({
        currentBalance: newBalance.toFixed(2),
        totalDeposits: newDeposits.toFixed(2),
      }).where(eq(employees.id, id));

      const [updated] = await db.select().from(employees).where(eq(employees.id, id));
      res.json({ voucher, employee: updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/:id/withdraw - single withdrawal
  // DR: Employee (via employeeId), CR: Cash ledger account
  app.post("/api/factory/employees/:id/withdraw", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid employee ID" });

      const { amount, date, notes, cashAccountId } = req.body;
      const withdrawAmount = parseFloat(amount);
      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });
      if (!cashAccountId) return res.status(400).json({ message: "Cash account is required" });

      const [emp] = await db.select().from(employees).where(
        and(eq(employees.id, id), eq(employees.companyId, companyId), eq(employees.employeeType, "Employee"))
      );
      if (!emp) return res.status(404).json({ message: "Employee not found" });

      // Verify cash account belongs to this company
      const [cashAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.id, parseInt(cashAccountId)), eq(ledgerAccounts.companyId, companyId))
      );
      if (!cashAccount) return res.status(404).json({ message: "Cash account not found" });

      const voucherNumber = `EMP-WD-${Date.now()}`;
      const [voucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Withdrawal for ${emp.firstName} ${emp.lastName}`,
        totalAmount: withdrawAmount.toFixed(2),
      }).returning();

      // DR: Employee
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: null,
        employeeId: id,
        debitAmount: withdrawAmount.toFixed(2),
        creditAmount: "0",
        narration: notes || `Withdrawal - ${voucherNumber}`,
      });

      // CR: Cash
      await db.insert(voucherEntries).values({
        voucherId: voucher.id,
        ledgerAccountId: cashAccount.id,
        debitAmount: "0",
        creditAmount: withdrawAmount.toFixed(2),
        narration: notes || `Withdrawal - ${voucherNumber}`,
      });

      // Update employee balance (can go negative)
      const newBalance = parseFloat(emp.currentBalance || "0") - withdrawAmount;
      const newWithdrawals = parseFloat(emp.totalWithdrawals || "0") + withdrawAmount;
      await db.update(employees).set({
        currentBalance: newBalance.toFixed(2),
        totalWithdrawals: newWithdrawals.toFixed(2),
      }).where(eq(employees.id, id));

      const [updated] = await db.select().from(employees).where(eq(employees.id, id));
      res.json({ voucher, employee: updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/factory/employees/bulk-payroll - bulk payroll deposit for multiple employees
  app.post("/api/factory/employees/bulk-payroll", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const { deposits, date, notes } = req.body;
      if (!deposits || !Array.isArray(deposits) || deposits.length === 0) {
        return res.status(400).json({ message: "No deposits provided" });
      }
      if (!date) return res.status(400).json({ message: "Date is required" });

      // Validate amounts
      const validDeposits = deposits.filter((d: any) => {
        const a = parseFloat(d.amount);
        return !isNaN(a) && a > 0 && d.employeeId;
      });
      if (validDeposits.length === 0) {
        return res.status(400).json({ message: "No valid deposit amounts provided" });
      }

      // Get or create PAYROLL_DEPOSIT_EXPENSE ledger account
      let [payrollExpenseAccount] = await db.select().from(ledgerAccounts).where(
        and(eq(ledgerAccounts.companyId, companyId), eq(ledgerAccounts.code, "PAYROLL_DEPOSIT_EXPENSE"))
      );
      if (!payrollExpenseAccount) {
        [payrollExpenseAccount] = await db.insert(ledgerAccounts).values({
          companyId,
          code: "PAYROLL_DEPOSIT_EXPENSE",
          name: "Payroll Deposit Expense",
          accountType: "Indirect Expense",
          openingBalance: "0",
          active: true,
        }).returning();
      }

      const totalAmount = validDeposits.reduce((sum: number, d: any) => sum + parseFloat(d.amount), 0);
      const voucherNumber = `EMP-PAY-${Date.now()}`;

      // Single bulk voucher
      const [bulkVoucher] = await db.insert(vouchers).values({
        companyId,
        voucherNumber,
        voucherType: "Journal",
        voucherDate: date,
        description: notes || `Bulk payroll deposit - ${validDeposits.length} employees`,
        totalAmount: totalAmount.toFixed(2),
      }).returning();

      // DR: Payroll Expense (total)
      await db.insert(voucherEntries).values({
        voucherId: bulkVoucher.id,
        ledgerAccountId: payrollExpenseAccount.id,
        debitAmount: totalAmount.toFixed(2),
        creditAmount: "0",
        narration: notes || `Bulk payroll - ${validDeposits.length} employees - ${voucherNumber}`,
      });

      // CR: Each employee individually
      const results = [];
      for (const dep of validDeposits) {
        const empId = parseInt(dep.employeeId);
        const amount = parseFloat(dep.amount);

        const [emp] = await db.select().from(employees).where(
          and(eq(employees.id, empId), eq(employees.companyId, companyId))
        );
        if (!emp) continue;

        await db.insert(voucherEntries).values({
          voucherId: bulkVoucher.id,
          ledgerAccountId: null,
          employeeId: empId,
          debitAmount: "0",
          creditAmount: amount.toFixed(2),
          narration: `Payroll deposit for ${emp.firstName} ${emp.lastName} - ${voucherNumber}`,
        });

        // Update employee balance
        const newBalance = parseFloat(emp.currentBalance || "0") + amount;
        const newDeposits = parseFloat(emp.totalDeposits || "0") + amount;
        await db.update(employees).set({
          currentBalance: newBalance.toFixed(2),
          totalDeposits: newDeposits.toFixed(2),
        }).where(eq(employees.id, empId));

        results.push({ employeeId: empId, amount, name: `${emp.firstName} ${emp.lastName}` });
      }

      res.json({ voucher: bulkVoucher, results, totalAmount });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================
  // BALE LEDGER — full production lifecycle summary
  // ============================================================

  app.get("/api/factory/bale-ledger", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      // Load all relevant data
      const [allBalesRaw, allProducts, allCategories] = await Promise.all([
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
          AND fb.status IN ('IN_STOCK', 'FINALIZED', 'SOLD', 'REMOVED')
        `),
        db.select({ id: factoryBaleProducts.id, name: factoryBaleProducts.name, articleCode: factoryBaleProducts.articleCode, categoryId: factoryBaleProducts.categoryId }).from(factoryBaleProducts).where(eq(factoryBaleProducts.companyId, companyId)),
        db.select({ id: factoryCategories.id, name: factoryCategories.name }).from(factoryCategories).where(eq(factoryCategories.companyId, companyId)),
      ]);

      const allBales: any[] = Array.isArray(allBalesRaw) ? allBalesRaw : (allBalesRaw as any).rows || [];

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

      // Group bales into buckets
      type BaleDetail = { ref: string; weightKg: number; totalCost: number };
      type BucketRow = { productId: number | null; productName: string; articleCode: string; categoryName: string; baleCount: number; totalWeightKg: number; totalCost: number; baleDetails: BaleDetail[] };
      const buckets: { currentStock: Map<string, BucketRow>; wasteStock: Map<string, BucketRow>; sold: Map<string, BucketRow>; wasteDispatched: Map<string, BucketRow> } = {
        currentStock: new Map(),
        wasteStock: new Map(),
        sold: new Map(),
        wasteDispatched: new Map(),
      };

      function addToBucket(bucket: Map<string, BucketRow>, key: string, label: ReturnType<typeof getProductLabel>, bale: any) {
        const existing = bucket.get(key);
        const w = parseFloat(bale.weightKg) || 0;
        const c = parseFloat(bale.totalCost) || 0;
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
          addToBucket(buckets.sold, key, label, bale);
        } else if (bale.status === "REMOVED" && bale.wasteDispatchId) {
          addToBucket(buckets.wasteDispatched, key, label, bale);
        } else if (bale.status === "IN_STOCK" || bale.status === "FINALIZED") {
          if (waste) {
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

      res.json({
        currentStock,
        wasteStock,
        sold,
        wasteDispatched,
        totals: {
          currentStock: sumBucket(currentStock),
          wasteStock: sumBucket(wasteStock),
          sold: sumBucket(sold),
          wasteDispatched: sumBucket(wasteDispatched),
          grand: sumBucket([...currentStock, ...wasteStock, ...sold, ...wasteDispatched]),
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
      const companyId = (req.session as any).currentCompanyId;
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
            inArray(factoryBales.status, ["IN_STOCK", "FINALIZED"]),
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
      const companyId = (req.session as any).currentCompanyId;
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
      const companyId = (req.session as any).currentCompanyId;
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
          if (bale.status !== "IN_STOCK" && bale.status !== "FINALIZED") {
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
          await tx.execute(sql`UPDATE factory_bales SET status = 'REMOVED', waste_dispatch_id = ${dispatch.id}, updated_at = ${now} WHERE id = ${bale.id}`);

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
}
