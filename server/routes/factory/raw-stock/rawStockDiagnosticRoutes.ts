import type { Express, Request, Response } from "express";
import { getErrorMessage } from "../../../lib/httpHandlers";
import { logger } from "../../../lib/logger";
import { requireAuth, requireRole } from "../../../auth";
import { getLockedRateDiagnosticsForCompany } from "../../../services/factory/rawStockLockedRate";
import { getFactoryCostingConsistencyReport } from "../../../services/factory/factoryCostingConsistencyService";

function getFactoryCompanyId(req: any): number | null {
  return (req.session as any).factoryCompanyId || (req.session as any).currentCompanyId || null;
}

export function registerRawStockDiagnosticRoutes(app: Express) {
  app.get(
    "/api/factory/raw-stock/diagnostics/locked-rates",
    requireAuth,
    requireRole("Admin", "Developer"),
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const rows = await getLockedRateDiagnosticsForCompany(companyId);
        return res.json(rows);
      } catch (error: unknown) {
        logger.error("Error running locked-rate diagnostics:", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );

  app.get(
    "/api/factory/raw-stock/diagnostics/costing-integrity",
    requireAuth,
    requireRole("Admin", "Developer"),
    async (req: Request, res: Response) => {
      try {
        const companyId = getFactoryCompanyId(req);
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        return res.json(await getFactoryCostingConsistencyReport(companyId));
      } catch (error: unknown) {
        logger.error("Error running factory costing integrity diagnostics:", { error });
        return res.status(500).json({ message: getErrorMessage(error) });
      }
    }
  );
}
