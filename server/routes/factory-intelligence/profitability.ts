/**
 * factoryIntelligenceRoutes: FactoryProfitability endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Database } from "../../db";
import type { Express, Request, Response, RequestHandler } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { eq, and, sql } from "drizzle-orm";
import {
  factorySettings,
  factoryBales,
  factoryContainers,
  factoryRawStock,
  factoryMixBatchSources,
  containerFreight,
  customerOrderBales,
} from "@shared/schema";

export function registerFactoryProfitabilityRoutes(app: Express, requireAuth: RequestHandler, db: Database) {
  app.get("/api/factory/profitability/bales", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const [settings] = await db.select().from(factorySettings).where(eq(factorySettings.companyId, companyId));

      const laborCostPerKg = parseFloat(settings?.laborCostPerKg || "0");
      const overheadPerKg = parseFloat(settings?.overheadPerKg || "0");

      const bales = await db
        .select()
        .from(factoryBales)
        .where(
          and(
            eq(factoryBales.companyId, companyId),
            sql`DATE(${factoryBales.finalizedAt}) >= ${from}`,
            sql`DATE(${factoryBales.finalizedAt}) <= ${to}`
          )
        );

      if (bales.length === 0) return res.json([]);

      const mixBatchIds = Array.from(new Set(bales.map((b: any) => b.mixBatchId).filter(Boolean))) as number[];
      const _sources =
        mixBatchIds.length > 0
          ? await db
              .select()
              .from(factoryMixBatchSources)
              .where(
                sql`${factoryMixBatchSources.mixBatchId} IN (${sql.join(
                  mixBatchIds.map((id: number) => sql`${id}`),
                  sql`, `
                )})`
              )
          : [];

      const orderBales = await db
        .select()
        .from(customerOrderBales)
        .where(
          sql`${customerOrderBales.baleId} IN (${sql.join(
            bales.map((b: any) => sql`${b.id}`),
            sql`, `
          )})`
        );

      const orderBaleMap = new Map(orderBales.map((ob) => [ob.baleId, ob] as const));

      const _freightEntries = await db.select().from(containerFreight).where(eq(containerFreight.companyId, companyId));

      const result = bales.map((bale: any) => {
        const weightKg = parseFloat(bale.weightKg || "0");
        const materialCost = parseFloat(bale.totalCost || "0");
        const laborCost = weightKg * laborCostPerKg;
        const overheadCost = weightKg * overheadPerKg;

        const freightAllocated = 0;
        const totalCost = materialCost + laborCost + overheadCost + freightAllocated;

        const ob = orderBaleMap.get(bale.id);
        const salePrice = ob ? parseFloat(ob.priceUsed || "0") : null;
        const profit = salePrice !== null ? salePrice - totalCost : null;

        return {
          baleId: bale.id,
          referenceNumber: bale.referenceNumber,
          productName: bale.productName,
          weightKg,
          materialCost: Math.round(materialCost * 100) / 100,
          laborCost: Math.round(laborCost * 100) / 100,
          overheadCost: Math.round(overheadCost * 100) / 100,
          freightAllocated: Math.round(freightAllocated * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          salePrice,
          profit: profit !== null ? Math.round(profit * 100) / 100 : null,
        };
      });

      res.json(result);
    } catch (error: unknown) {
      logger.error("Error fetching bale profitability:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  app.get("/api/factory/profitability/containers", requireAuth, async (req: Request, res: Response) => {
    try {
      const companyId = req.session.factoryCompanyId || req.session.currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const from = req.query.from as string;
      const to = req.query.to as string;
      if (!from || !to) return res.status(400).json({ message: "from and to dates are required" });

      const containers = await db
        .select()
        .from(factoryContainers)
        .where(
          and(
            eq(factoryContainers.companyId, companyId),
            sql`DATE(${factoryContainers.createdAt}) >= ${from}`,
            sql`DATE(${factoryContainers.createdAt}) <= ${to}`
          )
        );

      if (containers.length === 0) return res.json([]);

      const containerIds = containers.map((c: any) => c.id);

      const rawStockEntries = await db
        .select()
        .from(factoryRawStock)
        .where(
          and(
            eq(factoryRawStock.companyId, companyId),
            sql`${factoryRawStock.containerId} IN (${sql.join(
              containerIds.map((id: number) => sql`${id}`),
              sql`, `
            )})`
          )
        );

      const freightEntries = await db
        .select()
        .from(containerFreight)
        .where(
          and(
            eq(containerFreight.companyId, companyId),
            sql`${containerFreight.containerId} IN (${sql.join(
              containerIds.map((id: number) => sql`${id}`),
              sql`, `
            )})`
          )
        );

      const allBales = await db.select().from(factoryBales).where(eq(factoryBales.companyId, companyId));

      const allOrderBales = await db.select().from(customerOrderBales);

      const orderBaleMap = new Map(allOrderBales.map((ob) => [ob.baleId, ob] as const));

      const [settings] = await db.select().from(factorySettings).where(eq(factorySettings.companyId, companyId));

      const laborCostPerKg = parseFloat(settings?.laborCostPerKg || "0");
      const overheadPerKg = parseFloat(settings?.overheadPerKg || "0");

      const mixSources = await db
        .select()
        .from(factoryMixBatchSources)
        .where(
          sql`${factoryMixBatchSources.containerId} IN (${sql.join(
            containerIds.map((id: number) => sql`${id}`),
            sql`, `
          )})`
        );

      const result = containers.map((container: any) => {
        const containerRawStock = rawStockEntries.filter((r: any) => r.containerId === container.id);
        const rawStockCost = containerRawStock.reduce(
          (s: number, r: any) => s + parseFloat(r.receivedKg || "0") * parseFloat(r.costPerKg || "0"),
          0
        );

        const containerFreightTotal = freightEntries
          .filter((f: any) => f.containerId === container.id)
          .reduce((s: number, f: any) => s + parseFloat(f.freightAmount || "0"), 0);

        const containerMixSources = mixSources.filter((s: any) => s.containerId === container.id);
        const mixBatchIds = Array.from(new Set(containerMixSources.map((s: any) => s.mixBatchId))) as number[];

        const containerBales = allBales.filter((b: any) => mixBatchIds.includes(b.mixBatchId));
        const baleTotalKg = containerBales.reduce((s: number, b: any) => s + parseFloat(b.weightKg || "0"), 0);
        const baleLaborCost = baleTotalKg * laborCostPerKg;
        const baleOverheadCost = baleTotalKg * overheadPerKg;

        const totalCost = rawStockCost + containerFreightTotal + baleLaborCost + baleOverheadCost;

        let totalRevenue = 0;
        for (const bale of containerBales) {
          const ob = orderBaleMap.get(bale.id);
          if (ob) totalRevenue += parseFloat(ob.priceUsed || "0");
        }

        const profit = totalRevenue - totalCost;
        const marginPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

        return {
          containerId: container.id,
          containerNumber: container.containerNumber,
          totalCost: Math.round(totalCost * 100) / 100,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          marginPct: Math.round(marginPct * 100) / 100,
        };
      });

      res.json(result);
    } catch (error: unknown) {
      logger.error("Error fetching container profitability:", { error: error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });

  // ───────────────────────────────────────────────
  // 6. Alerts
  // ───────────────────────────────────────────────
}
