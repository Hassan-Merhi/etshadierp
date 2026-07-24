import type { Express } from "express";
import { logger } from "../../../lib/logger";
import { requireAuth, requireRole } from "../../../auth";
import { getLockedRateDiagnosticsForCompany } from "../../../services/factory/rawStockLockedRate";

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

        const rows = await getLockedRateDiagnosticsForCompany(companyId);
        res.json(rows);
      } catch (error: any) {
        logger.error("Error running locked-rate diagnostics:", { error: error });
        res.status(500).json({ message: error.message });
      }
    }
  );
}
