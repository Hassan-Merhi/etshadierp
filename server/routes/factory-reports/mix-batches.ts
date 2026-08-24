/**
 * factoryReportRoutes: FactoryMixBatchesByDate endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, RequestHandler } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { pool } from "../../db";
import {} from "@shared/schema";

export function registerFactoryMixBatchesByDateRoutes(app: Express, requireAuth: RequestHandler, _db: any) {
  // ── Mix batches by date ───────────────────────────────────────────────────
  app.get(
    "/api/factory/mix-batches-by-date",
    requireAuth,
    async (req: import("express").Request, res: import("express").Response) => {
      try {
        const companyId = req.session?.factoryCompanyId || req.session?.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const date = req.query.date as string;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ message: "date query param required (YYYY-MM-DD)" });
        }

        const batchesResult = await pool.query(
          `
        SELECT b.id, b.batch_code, b.name, b.status, b.total_weight_kg, b.used_kg,
               b.batch_date, b.created_at, b.notes
        FROM factory_mix_batches b
        WHERE b.company_id = $1
          AND b.deleted_at IS NULL
          AND (
            b.batch_date = $2::date
            OR (b.batch_date IS NULL AND DATE(b.created_at AT TIME ZONE 'UTC') = $2::date)
          )
        ORDER BY b.created_at DESC
      `,
          [companyId, date]
        );

        const batches = batchesResult.rows;
        const batchIds = batches.map((b) => b.id);

        let sources = [];
        if (batchIds.length > 0) {
          const sourcesResult = await pool.query(
            `
          SELECT
            s.id, s.mix_batch_id, s.container_id, s.supplier_id, s.source_batch_id,
            s.weight_kg, s.cost_per_kg, s.total_cost,
            c.container_number,
            COALESCE(sup_via_c.name, sup_direct.name, mb.batch_code, 'Unknown') AS source_name
          FROM factory_mix_batch_sources s
          LEFT JOIN factory_containers c ON c.id = s.container_id
          LEFT JOIN factory_suppliers sup_via_c ON sup_via_c.id = c.supplier_id
          LEFT JOIN factory_suppliers sup_direct ON sup_direct.id = s.supplier_id
          LEFT JOIN factory_mix_batches mb ON mb.id = s.source_batch_id
          WHERE s.mix_batch_id = ANY($1)
          ORDER BY s.id
        `,
            [batchIds]
          );
          sources = sourcesResult.rows;
        }

        // Apply the same fallback cost enrichment as /api/factory/mix-batches/:id/sources
        // When costPerKg is 0 in the DB, look up the weighted-average from factoryRawStock.
        const enrichedSources = await Promise.all(
          sources.map(async (s) => {
            const storedCost = parseFloat(s.cost_per_kg) || 0;
            if (storedCost > 0) return s;

            let fallbackCost = 0;
            if (s.container_id) {
              const rsRows = await pool.query(
                `SELECT cost_per_kg_usd, cost_per_kg, received_kg
             FROM factory_raw_stock
             WHERE container_id = $1 AND company_id = $2`,
                [s.container_id, companyId]
              );
              let wSum = 0,
                wWeight = 0;
              for (const r of rsRows.rows) {
                const kg = parseFloat(r.received_kg) || 0;
                const c = parseFloat(r.cost_per_kg_usd) || parseFloat(r.cost_per_kg) || 0;
                wSum += kg * c;
                wWeight += kg;
              }
              fallbackCost = wWeight > 0 ? wSum / wWeight : 0;
            } else if (s.supplier_id) {
              const rsRows = await pool.query(
                `SELECT rs.cost_per_kg_usd, rs.cost_per_kg, rs.received_kg
             FROM factory_raw_stock rs
             INNER JOIN factory_containers c ON c.id = rs.container_id
             WHERE c.supplier_id = $1 AND rs.company_id = $2`,
                [s.supplier_id, companyId]
              );
              let wSum = 0,
                wWeight = 0;
              for (const r of rsRows.rows) {
                const kg = parseFloat(r.received_kg) || 0;
                const c = parseFloat(r.cost_per_kg_usd) || parseFloat(r.cost_per_kg) || 0;
                wSum += kg * c;
                wWeight += kg;
              }
              fallbackCost = wWeight > 0 ? wSum / wWeight : 0;
            }

            if (fallbackCost <= 0) return s;
            const weightKg = parseFloat(s.weight_kg) || 0;
            return {
              ...s,
              cost_per_kg: String(fallbackCost),
              total_cost: String(weightKg * fallbackCost),
            };
          })
        );

        const enriched = batches.map((b) => {
          const batchSources = enrichedSources.filter((s) => s.mix_batch_id === b.id);
          const totalWeight = parseFloat(b.total_weight_kg) || 0;
          const totalCost = batchSources.reduce((sum: number, s) => sum + (parseFloat(s.total_cost) || 0), 0);
          const costPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;
          return {
            id: b.id,
            batchCode: b.batch_code,
            name: b.name,
            status: b.status,
            totalWeightKg: totalWeight,
            totalCost,
            costPerKg,
            batchDate: b.batch_date,
            createdAt: b.created_at,
            sources: batchSources.map((s) => ({
              id: s.id,
              sourceName: s.source_name,
              containerNumber: s.container_number,
              weightKg: parseFloat(s.weight_kg) || 0,
              costPerKg: parseFloat(s.cost_per_kg) || 0,
              totalCost: parseFloat(s.total_cost) || 0,
              percentOfBatch: totalWeight > 0 ? ((parseFloat(s.weight_kg) || 0) / totalWeight) * 100 : 0,
            })),
          };
        });

        res.json(enriched);
      } catch (err: unknown) {
        logger.error("[mix-batches-by-date]", { error: err });
        res.status(500).json({ message: getErrorMessage(err) });
      }
    }
  );
}
