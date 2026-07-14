import type { Express } from "express";
import { eq, and, sql, isNull } from "drizzle-orm";
import { db } from "../../../db";
import { requireAuth, requireRole } from "../../../auth";
import { getLockedSupplierRateReadOnly, getAuthoritativeSupplierRemainingKg } from "../../../services/factory/rawStockLockedRate";
import { factorySuppliers, factoryMixBatchSources, factoryMixBatches } from "@shared/schema";

/**
 * Read-only Admin/Developer diagnostic for the supplier locked raw-material rate.
 * Surfaces, per supplier, the persisted rate, an independently-reproduced Raw
 * Materials display value, and the spec-mandated expected value (freeKg ×
 * persisted rate) so drift between them is visible. NEVER writes: uses
 * getLockedSupplierRateReadOnly (no lazy backfill side effect) and issues only
 * SELECT statements.
 */
export function registerRawStockDiagnosticRoutes(app: Express) {
  app.get(
    "/api/factory/raw-stock/diagnostics/locked-rates",
    requireAuth,
    requireRole("Admin", "Developer"),
    async (req: any, res: any) => {
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

        // reservedKg is informational only (see rawStockReceiptRoutes.ts) — active
        // (non-CLOSED/COMPLETED) batch source weight. It must NOT be subtracted from
        // freeKg a second time: usedKg already reflects that consumption.
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
              sql`${factoryMixBatches.status} NOT IN ('CLOSED', 'COMPLETED')`,
              isNull(factoryMixBatches.deletedAt)
            )
          )
          .groupBy(factoryMixBatchSources.supplierId);
        const reservedBySupplierId = new Map<number, number>();
        for (const r of reservedRows) {
          if (r.supplierId) reservedBySupplierId.set(r.supplierId, parseFloat(r.reservedKg as string) || 0);
        }

        // Read-only transaction: SELECT-only work, no writes are issued anywhere in
        // this handler (getLockedSupplierRateReadOnly never persists a lazy backfill).
        const rows = await db.transaction(async (tx: any) => {
          const out = [];
          for (const supplier of suppliers) {
            const persistedRaw = supplier.currentRawMaterialCostPerKgUsd;
            const persistedLockedRate =
              persistedRaw !== null && persistedRaw !== undefined ? parseFloat(persistedRaw as string) || 0 : null;

            // Independently reproduce what GET /api/factory/raw-stock would display for
            // this supplier's rate: the persisted rate if set, else the same lazy-derive
            // computation (without writing it).
            const { rate: rawMaterialsDisplayedRate } = await getLockedSupplierRateReadOnly(tx, companyId, supplier.id);
            const mixBatchDialogRate = rawMaterialsDisplayedRate; // same helper backs the mix-batch dialog too

            const remainingKg = await getAuthoritativeSupplierRemainingKg(tx, companyId, supplier.id);
            const reservedKg = reservedBySupplierId.get(supplier.id) || 0;
            // Model A (matches rawStockReceiptRoutes.ts): usedKg already reflects mix-batch
            // consumption, so freeKg = remainingKg, not remainingKg - reservedKg.
            const freeKg = remainingKg;

            // displayedValue independently reproduces the Raw Materials API's own formula
            // (freeKg × its displayed rate). expectedValue is the spec-mandated
            // freeKg × persistedLockedRate, using ONLY the persisted column — these are
            // deliberately different expressions so a real inconsistency (e.g. a supplier
            // whose persisted column drifted from what the lazy-derive would compute) is
            // visible as a non-zero difference instead of being masked by circular math.
            const displayedValue = freeKg * rawMaterialsDisplayedRate;
            const expectedValue = freeKg * (persistedLockedRate ?? 0);
            const difference = displayedValue - expectedValue;

            out.push({
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
          return out;
        });

        res.json(rows);
      } catch (error: any) {
        console.error("Error running locked-rate diagnostics:", error);
        res.status(500).json({ message: error.message });
      }
    }
  );
}
