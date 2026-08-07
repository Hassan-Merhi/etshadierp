import type { Express } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, pool } from "../../db";
import { requireAuth } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { factoryMixBatches } from "@shared/schema";

/**
 * Replaces the list-only mix-batch read before the legacy Factory registrar.
 * The old handler loaded every source and then performed one locked-rate query
 * per supplier. This keeps the exact list contract but calculates all source
 * display totals in one grouped SQL query.
 */
export function registerBandwidthPhase3MixBatchRead(app: Express): void {
  app.get("/api/factory/mix-batches", requireAuth, async (req: any, res: any) => {
    try {
      const rawCompanyId = req.session?.factoryCompanyId || req.session?.currentCompanyId;
      const companyId = Number(rawCompanyId);
      if (!Number.isFinite(companyId) || companyId <= 0) {
        return res.status(400).json({ message: "No company selected" });
      }

      const batches = await db
        .select()
        .from(factoryMixBatches)
        .where(and(eq(factoryMixBatches.companyId, companyId), isNull(factoryMixBatches.deletedAt)))
        .orderBy(desc(factoryMixBatches.createdAt));

      if (batches.length === 0) {
        res.set("X-ERP-Payload-Profile", "mix-batches-grouped-rates");
        res.set("Cache-Control", "private, max-age=10");
        return res.json([]);
      }

      const ids = batches.map((batch) => batch.id);
      const aggregateResult = await pool.query(
        `SELECT
           src.mix_batch_id,
           COALESCE(SUM(src.weight_kg::numeric), 0)::float AS display_total_weight_kg,
           COALESCE(SUM(
             src.weight_kg::numeric *
             CASE
               WHEN src.source_batch_id IS NOT NULL THEN COALESCE(src.cost_per_kg::numeric, 0)
               WHEN src.supplier_id IS NOT NULL THEN COALESCE(fs.current_raw_material_cost_per_kg_usd::numeric, src.cost_per_kg::numeric, 0)
               ELSE COALESCE(src.cost_per_kg::numeric, 0)
             END
           ), 0)::float AS display_total_cost
         FROM factory_mix_batch_sources src
         LEFT JOIN factory_suppliers fs
           ON fs.id = src.supplier_id
          AND fs.company_id = $1
         WHERE src.mix_batch_id = ANY($2::int[])
         GROUP BY src.mix_batch_id`,
        [companyId, ids],
      );

      const totalsByBatch = new Map<number, { weight: number; cost: number }>();
      for (const row of aggregateResult.rows) {
        totalsByBatch.set(Number(row.mix_batch_id), {
          weight: Number(row.display_total_weight_kg || 0),
          cost: Number(row.display_total_cost || 0),
        });
      }

      const enriched = batches.map((batch: any) => {
        const total = Number(batch.totalWeightKg || 0);
        const used = Number(batch.usedKg || 0);
        const aggregate = totalsByBatch.get(batch.id);
        const displayTotalWeightKg = aggregate ? aggregate.weight : total;
        const displayTotalCost = aggregate ? aggregate.cost : Number(batch.totalCost || 0);
        const displayCostPerKg =
          displayTotalWeightKg > 0 ? displayTotalCost / displayTotalWeightKg : Number(batch.costPerKg || 0);

        return {
          ...batch,
          remainingKg: (total - used).toFixed(3),
          displayTotalWeightKg: displayTotalWeightKg.toFixed(3),
          displayTotalCost: displayTotalCost.toFixed(6),
          displayCostPerKg: displayCostPerKg.toFixed(6),
        };
      });

      res.set("X-ERP-Payload-Profile", "mix-batches-grouped-rates");
      res.set("Cache-Control", "private, max-age=10");
      return res.json(enriched);
    } catch (error: unknown) {
      logger.error("Error fetching bandwidth-optimized mix batches", { error });
      return res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
