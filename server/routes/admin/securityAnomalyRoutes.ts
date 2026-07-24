import type { Express, Request, Response } from "express";
import { logger } from "../../lib/logger";
import { db } from "../../db";
import { requireAuth, requireRole } from "../../auth";
import { loadCompanySecurityAnomalies } from "../../services/security/securityAuditRuntime";

export function registerSecurityAnomalyRoutes(app: Express) {
  app.get(
    "/api/admin/security-anomalies",
    requireAuth,
    requireRole("Admin", "Developer"),
    async (req: Request, res: Response) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(403).json({ message: "Forbidden" });
        const result = await loadCompanySecurityAnomalies(db, companyId, {
          windowMs: 15 * 60 * 1000,
          denialThreshold: 5,
          limit: 500,
        });
        return res.json({
          companyId,
          generatedAt: new Date().toISOString(),
          ...result,
        });
      } catch (error) {
        logger.error("Security anomaly query failed:", { error: error });
        return res.status(500).json({ message: "Failed to load security anomalies" });
      }
    }
  );
}
