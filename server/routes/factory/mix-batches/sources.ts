/**
 * factoryMixBatchRoutes: FactoryMixBatchSource endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { parseId } from "../../../lib/parseId";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import {
  factorySuppliers,
  factoryContainers,
  factoryRawStock,
  factoryMixBatches,
  factoryMixBatchSources,
  factoryBales,
} from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getStableSupplierCost } from "../../../services/factory/rawStockStableCost";

export function registerFactoryMixBatchSourceRoutes(app: Express) {
  // Assign existing (unlinked) bales to a mix batch
  app.post("/api/factory/mix-batches/:id/assign-bales", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const mixBatchId = parseId(req.params.id);

      if (mixBatchId === null) return res.status(400).json({ message: "Invalid id" });
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
        await tx.update(factoryBales).set({ mixBatchId, updatedAt: now }).where(inArray(factoryBales.id, baleIds));

        await tx
          .update(factoryMixBatches)
          .set({ usedKg: sql`${factoryMixBatches.usedKg} + ${totalKg.toFixed(3)}`, updatedAt: now })
          .where(eq(factoryMixBatches.id, mixBatchId));
      });

      res.json({ success: true, balesUpdated: baleIds.length, totalKg });
    } catch (error: unknown) {
      logger.error("Error assigning bales to mix batch:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/mix-batches/:id/sources", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });

      const results = await db
        .select({
          id: factoryMixBatchSources.id,
          mixBatchId: factoryMixBatchSources.mixBatchId,
          containerId: factoryMixBatchSources.containerId,
          supplierId: factoryMixBatchSources.supplierId,
          sourceBatchId: factoryMixBatchSources.sourceBatchId,
          sourceType: factoryMixBatchSources.sourceType,
          weightKg: factoryMixBatchSources.weightKg,
          costPerKg: factoryMixBatchSources.costPerKg,
          totalCost: factoryMixBatchSources.totalCost,
          createdAt: factoryMixBatchSources.createdAt,
          containerNumber: factoryContainers.containerNumber,
          supplierName: factorySuppliers.name,
          sourceBatchCode: sql<string>`(SELECT batch_code FROM factory_mix_batches WHERE id = ${factoryMixBatchSources.sourceBatchId})`,
        })
        .from(factoryMixBatchSources)
        .leftJoin(factoryContainers, eq(factoryMixBatchSources.containerId, factoryContainers.id))
        .leftJoin(factorySuppliers, eq(factoryMixBatchSources.supplierId, factorySuppliers.id))
        .where(eq(factoryMixBatchSources.mixBatchId, id));

      // For any source row with a stored costPerKg of 0 (or null), look up the
      // actual weighted-average cost from factoryRawStock so the breakdown
      // display always shows a meaningful number.
      const enriched = await Promise.all(
        results.map(async (src) => {
          const storedCost = parseFloat(src.costPerKg) || 0;
          if (storedCost > 0) return src;

          // Try to find a raw stock cost via containerId first, then supplierId.
          // Uses the same stable receipt-weighted rate as the write paths (getStableSupplierCost)
          // so the display fallback can never disagree with what was actually costed.
          let fallbackCost = 0;
          if (src.containerId) {
            const rows = await db
              .select({
                costPerKgUsd: factoryRawStock.costPerKgUsd,
                costPerKg: factoryRawStock.costPerKg,
                receivedKg: factoryRawStock.receivedKg,
              })
              .from(factoryRawStock)
              .where(and(eq(factoryRawStock.containerId, src.containerId), eq(factoryRawStock.companyId, companyId)));
            let wSum = 0,
              wWeight = 0;
            for (const r of rows) {
              const kg = parseFloat(r.receivedKg) || 0;
              const c = parseFloat(r.costPerKgUsd || "0") || parseFloat(r.costPerKg || "0") || 0;
              wSum += kg * c;
              wWeight += kg;
            }
            fallbackCost = wWeight > 0 ? wSum / wWeight : 0;
          } else if (src.supplierId) {
            const stable = await getStableSupplierCost(db, companyId, src.supplierId);
            fallbackCost = stable.costPerKgUsd;
          }

          if (fallbackCost <= 0) return src;
          const weightKg = parseFloat(src.weightKg) || 0;
          return {
            ...src,
            costPerKg: String(fallbackCost),
            totalCost: String(weightKg * fallbackCost),
          };
        })
      );

      res.json(enriched);
    } catch (error: unknown) {
      logger.error("Error fetching mix batch sources:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ───────────────────────────────────────────────
  // 6b. Mix Batch Daily Consumption
  // ───────────────────────────────────────────────
}
