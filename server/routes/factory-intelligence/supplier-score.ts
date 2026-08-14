/**
 * factoryIntelligenceRoutes: FactorySupplierScore endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import {
  factoryWasteEntries,
  factoryBales,
  factoryContainers,
  factoryRawStock,
  factoryMixBatchSources,
  factorySuppliers,
} from "@shared/schema";

export function registerFactorySupplierScoreRoutes(app: Express, requireAuth: any, db: any) {
  app.get("/api/factory/suppliers/score", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const rawStockEntries = await db
        .select()
        .from(factoryRawStock)
        .where(
          and(
            eq(factoryRawStock.companyId, companyId),
            sql`DATE(${factoryRawStock.offloadedAt}) >= ${from}`,
            sql`DATE(${factoryRawStock.offloadedAt}) <= ${to}`
          )
        );

      const containers = await db.select().from(factoryContainers).where(eq(factoryContainers.companyId, companyId));

      const containerMap = new Map<number, any>(containers.map((c: any) => [c.id, c]));

      const wasteEntries = await db
        .select()
        .from(factoryWasteEntries)
        .where(
          and(
            eq(factoryWasteEntries.companyId, companyId),
            gte(factoryWasteEntries.date, from),
            lte(factoryWasteEntries.date, to)
          )
        );

      const suppliers = await db.select().from(factorySuppliers).where(eq(factorySuppliers.companyId, companyId));

      const supplierMap = new Map<number, any>(suppliers.map((s: any) => [s.id, s]));

      const mixSources = await db.select().from(factoryMixBatchSources);

      const allBales = await db.select().from(factoryBales).where(eq(factoryBales.companyId, companyId));

      const supplierStats: Record<
        number,
        {
          supplierId: number;
          supplierName: string;
          totalKg: number;
          totalCost: number;
          wasteKg: number;
          outputBales: number;
        }
      > = {};

      for (const rs of rawStockEntries) {
        const container = containerMap.get(rs.containerId);
        const supplierId = container?.supplierId;
        if (!supplierId) continue;

        if (!supplierStats[supplierId]) {
          const supplier = supplierMap.get(supplierId);
          supplierStats[supplierId] = {
            supplierId,
            supplierName: supplier?.name || "Unknown",
            totalKg: 0,
            totalCost: 0,
            wasteKg: 0,
            outputBales: 0,
          };
        }

        const kg = parseFloat(rs.receivedKg || "0");
        const cost = kg * parseFloat(rs.costPerKg || "0");
        supplierStats[supplierId].totalKg += kg;
        supplierStats[supplierId].totalCost += cost;
      }

      for (const w of wasteEntries) {
        if (w.supplierId && supplierStats[w.supplierId]) {
          supplierStats[w.supplierId].wasteKg += parseFloat(w.kgWaste || "0");
        }
      }

      for (const suppId of Object.keys(supplierStats).map(Number)) {
        const supplierContainerIds = containers.filter((c: any) => c.supplierId === suppId).map((c: any) => c.id);

        const supplierMixSources = mixSources.filter((s: any) => supplierContainerIds.includes(s.containerId));
        const mixBatchIds = Array.from(new Set(supplierMixSources.map((s: any) => s.mixBatchId))) as number[];
        const balesFromSupplier = allBales.filter((b: any) => mixBatchIds.includes(b.mixBatchId));
        supplierStats[suppId].outputBales = balesFromSupplier.length;
      }

      const result = Object.values(supplierStats).map((s) => {
        const wastePct = s.totalKg > 0 ? (s.wasteKg / s.totalKg) * 100 : 0;
        const avgCostPerKg = s.totalKg > 0 ? s.totalCost / s.totalKg : 0;
        let score = 100 - wastePct * 2 - avgCostPerKg * 5 + s.outputBales * 0.5;
        score = Math.max(0, Math.min(100, score));

        return {
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          totalKg: Math.round(s.totalKg * 1000) / 1000,
          wasteKg: Math.round(s.wasteKg * 1000) / 1000,
          wastePct: Math.round(wastePct * 100) / 100,
          avgCostPerKg: Math.round(avgCostPerKg * 10000) / 10000,
          outputBales: s.outputBales,
          score: Math.round(score * 100) / 100,
        };
      });

      result.sort((a, b) => b.score - a.score);
      res.json(result);
    } catch (error: unknown) {
      logger.error("Error fetching supplier scores:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ───────────────────────────────────────────────
  // 8. Mix Optimizer
  // ───────────────────────────────────────────────
}
