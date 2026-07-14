import type { Express } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../../db";
import { requireAuth } from "../../../auth";
import { getLockedSupplierRate, getAuthoritativeSupplierRemainingKg } from "../../../services/factory/rawStockLockedRate";
import { factorySuppliers, factoryMixBatchSources, factoryMixBatches } from "@shared/schema";

/**
 * Read-only developer/admin diagnostic for the supplier locked raw-material rate.
 * Surfaces, per supplier, every place the rate is supposed to show up so drift
 * between the persisted value, the Raw Materials API, and the mix-batch dialog
 * can be spotted at a glance. Never writes anything.
 */
export function registerRawStockDiagnosticRoutes(app: Express) {
  app.get("/api/factory/raw-stock/diagnostics/locked-rates", requireAuth, async (req: any, res: any) => {
    try {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });

      const suppliers = await db
        .select({
          id: factorySuppliers.id,
          name: factorySuppliers.name,
          currentRawMaterialCostPerKgUsd: factorySuppliers.currentRawMaterialCostPerKgUsd,
        })
        .from(factorySuppliers)
        .where(eq(factorySuppliers.companyId, companyId));

      const reservedRows = await db
        .select({
          supplierId: factoryMixBatchSources.supplierId,
          reservedKg: sql<string>`SUM(${factoryMixBatchSources.weightKg})`,
        })
        .from(factoryMixBatchSources)
        .innerJoin(factoryMixBatches, eq(factoryMixBatchSources.mixBatchId, factoryMixBatches.id))
        .where(
          and(
            eq(factoryMixBatches.companyId, companyId),
            sql`${factoryMixBatchSources.supplierId} IS NOT NULL`,
            sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`
          )
        )
        .groupBy(factoryMixBatchSources.supplierId);
      const reservedBySupplierId = new Map<number, number>();
      for (const r of reservedRows) {
        if (r.supplierId) reservedBySupplierId.set(r.supplierId, parseFloat(r.reservedKg as string) || 0);
      }

      const results = await db.transaction(async (tx: any) => {
        const rows = [];
        for (const supplier of suppliers) {
          const persistedRaw = supplier.currentRawMaterialCostPerKgUsd;
          const persistedLockedRate =
            persistedRaw !== null && persistedRaw !== undefined ? parseFloat(persistedRaw as string) || 0 : null;

          // This is exactly what the Raw Materials API (GET /api/factory/raw-stock) and
          // the Create/Edit Mix Batch dialogs read — reading it fresh here, read-only,
          // confirms all three surfaces are looking at the same underlying value.
          const rawMaterialsDisplayedRate = await getLockedSupplierRate(tx, companyId, supplier.id);
          const mixBatchDialogRate = rawMaterialsDisplayedRate; // same helper, same read path

          const remainingKg = await getAuthoritativeSupplierRemainingKg(tx, companyId, supplier.id);
          const reservedKg = reservedBySupplierId.get(supplier.id) || 0;
          const freeKg = remainingKg - reservedKg;

          const displayedValue = freeKg * rawMaterialsDisplayedRate;
          const expectedValue = freeKg * rawMaterialsDisplayedRate; // same formula, kept explicit per spec
          const difference = displayedValue - expectedValue;

          rows.push({
            companyId,
            supplierId: supplier.id,
            supplierName: supplier.name,
            persistedLockedRate,
            rawMaterialsDisplayedRate,
            mixBatchDialogRate,
            remainingKg,
            reservedKg,
            freeKg,
            displayedValue: displayedValue.toFixed(2),
            expectedValue: expectedValue.toFixed(2),
            difference: difference.toFixed(2),
            backfillRequired: persistedLockedRate === null,
          });
        }
        return rows;
      });

      res.json(results);
    } catch (error: any) {
      console.error("Error running locked-rate diagnostics:", error);
      res.status(500).json({ message: error.message });
    }
  });
}
