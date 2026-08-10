/**
 * factoryBalesRoutes: BalesFinalize endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { getClientDate } from "../../../lib/dateUtils";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";

import { adjustInventory } from "../../../inventoryHelper";
import { writeDaybookEntry, checkFactoryAdmin } from "../_helpers";
import {
  factoryCategories,
  factoryBaleProducts,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryPressingBatches,
  factoryBales,
  stockItems,
  stockGroups,
  locations,
} from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";

export function registerBalesFinalizeRoutes(app: Express) {
  // ───────────────────────────────────────────────
  // 9. Factory Finalize
  // ───────────────────────────────────────────────

  app.post("/api/factory/finalize", requireAuth, async (req: Request, res: Response) => {
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
        const updatedBales = [];

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
    } catch (error: unknown) {
      logger.error("Error finalizing pressing batch:", { error: error });
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });

  // Backfill historical bale costs from raw stock source prices
  app.post("/api/factory/bales/backfill-costs", requireAuth, async (req: Request, res: Response) => {
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
    } catch (error: unknown) {
      logger.error("Error backfilling bale costs:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
