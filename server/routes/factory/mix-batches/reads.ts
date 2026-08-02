/**
 * factoryMixBatchRoutes: FactoryMixBatchRead endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { parseId } from "../../../lib/parseId";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { factoryMixBatches, factoryMixBatchSources } from "@shared/schema";
import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import { getLockedSupplierRateReadOnly } from "../../../services/factory/rawStockLockedRate";
import Decimal from "decimal.js";

export function registerFactoryMixBatchReadRoutes(app: Express) {
  app.get("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const results = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.companyId, companyId), isNull(factoryMixBatches.deletedAt)))
        .orderBy(desc(factoryMixBatches.createdAt));

      // ── Display-blend calculation (read-only, no DB writes) ──
      const batchIds = results.map((b: any) => b.id);
      let sourceRows: any[] = [];
      if (batchIds.length > 0) {
        sourceRows = await db
          .select()
          .from(factoryMixBatchSources)
          .where(inArray(factoryMixBatchSources.mixBatchId, batchIds));
      }

      // Collect unique supplier IDs referenced by any source row
      const uniqueSupplierIds = [
        ...new Set(sourceRows.filter((s: any) => s.supplierId != null).map((s: any) => s.supplierId as number)),
      ];

      // Load current locked USD raw-material rate for each supplier (read-only)
      const supplierRateMap = new Map<number, number>();
      for (const supplierId of uniqueSupplierIds) {
        const { rate } = await getLockedSupplierRateReadOnly(db, companyId, supplierId);
        supplierRateMap.set(supplierId, rate);
      }

      // Group source rows by mixBatchId
      const sourcesByBatch = new Map<number, any[]>();
      for (const src of sourceRows) {
        if (!sourcesByBatch.has(src.mixBatchId)) sourcesByBatch.set(src.mixBatchId, []);
        sourcesByBatch.get(src.mixBatchId)!.push(src);
      }

      const enriched = results.map((b: any) => {
        const total = parseFloat(b.totalWeightKg) || 0;
        const used = parseFloat(b.usedKg) || 0;

        // Compute display totals using the same source rules as EditMixBatchDialog:
        //   A. sourceBatchId exists → use source row's stored costPerKg
        //   B. supplierId exists (incl. FIFO rows with containerId+supplierId) → current locked rate
        //   C. neither → fall back to source row's stored costPerKg
        const sources = sourcesByBatch.get(b.id) || [];
        let displayTotalWeightKg = new Decimal(0);
        let displayTotalCost = new Decimal(0);
        for (const src of sources) {
          const w = new Decimal(src.weightKg || 0);
          let effectiveCostPerKg: Decimal;
          if (src.sourceBatchId != null) {
            effectiveCostPerKg = new Decimal(src.costPerKg || 0);
          } else if (src.supplierId != null) {
            effectiveCostPerKg = new Decimal(supplierRateMap.get(src.supplierId) || 0);
          } else {
            effectiveCostPerKg = new Decimal(src.costPerKg || 0);
          }
          displayTotalWeightKg = displayTotalWeightKg.plus(w);
          displayTotalCost = displayTotalCost.plus(w.times(effectiveCostPerKg));
        }

        let displayCostPerKg: Decimal;
        if (displayTotalWeightKg.gt(0)) {
          displayCostPerKg = displayTotalCost.dividedBy(displayTotalWeightKg);
        } else {
          // No source rows → fall back to stored batch values
          displayTotalWeightKg = new Decimal(b.totalWeightKg || 0);
          displayTotalCost = new Decimal(b.totalCost || 0);
          displayCostPerKg = new Decimal(b.costPerKg || 0);
        }

        return {
          ...b,
          remainingKg: (total - used).toFixed(3),
          displayTotalWeightKg: displayTotalWeightKg.toFixed(3),
          displayTotalCost: displayTotalCost.toFixed(6),
          displayCostPerKg: displayCostPerKg.toFixed(6),
        };
      });

      res.json(enriched);
    } catch (error: unknown) {
      logger.error("Error fetching mix batches:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/mix-batches/:id", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const id = parseId(req.params.id);

      if (id === null) return res.status(400).json({ message: "Invalid id" });
      const [batch] = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.id, id), eq(factoryMixBatches.companyId, companyId)));

      if (!batch) return res.status(404).json({ message: "Mix batch not found" });

      const total = parseFloat(batch.totalWeightKg) || 0;
      const used = parseFloat(batch.usedKg) || 0;
      res.json({ ...batch, remainingKg: (total - used).toFixed(3) });
    } catch (error: unknown) {
      logger.error("Error fetching mix batch:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
