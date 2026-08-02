/**
 * rawStockRecalcRoutesLegacy: RawStockRecalcAudit endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../../../lib/httpHandlers";
import { logger } from "../../../../lib/logger";
import { requireAuth, requireRole } from "../../../../auth";
import { getMixBatchSourceCostMismatchPreview, getFullAuditScan } from "../../../../services/factory/raw-stock-recalc";
import { ADMIN_ROLES } from "./_helpers";

export function registerRawStockRecalcAuditRoutes(app: Express) {
  // ──────────────────────────────────────────────────────────────────────────
  // Full audit scan — all containers, all layers, all issue codes
  // GET /api/factory/raw-stock/recalc/full-audit
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/full-audit",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const result = await getFullAuditScan(companyId);
        res.json(result);
      } catch (err: unknown) {
        logger.error("[raw-stock recalc full-audit] error:", { error: err });
        res.status(500).json({ message: getErrorMessage(err) || "Failed to run full audit scan" });
      }
    }
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Source cost mismatches — full scan (not just zero-cost)
  // GET /api/factory/raw-stock/recalc/source-cost-mismatches
  // ──────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/factory/raw-stock/recalc/source-cost-mismatches",
    requireAuth,
    requireRole(...ADMIN_ROLES),
    async (req: any, res: any) => {
      const companyId = (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId;
      if (!companyId) return res.status(400).json({ message: "No company selected" });
      try {
        const result = await getMixBatchSourceCostMismatchPreview(companyId);
        res.json(result);
      } catch (err: unknown) {
        logger.error("[raw-stock recalc source-cost-mismatches] error:", { error: err });
        res.status(500).json({ message: getErrorMessage(err) || "Failed to scan source cost mismatches" });
      }
    }
  );
}
