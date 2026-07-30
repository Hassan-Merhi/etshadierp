import type { Express } from "express";
import { requireAuth, requireRole } from "../../auth";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { buildImportCycleDiagnostics } from "./importCycleDiagnosticAnalysis";
import { collectImportCycleBalanceSnapshot } from "./importCycleDiagnosticFoundation";

export function registerImportCycleDiagnosticRoutes(app: Express) {
  app.get("/api/debug/import-cycle", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      const companyId = req.session.currentCompanyId;
      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const snapshot = await collectImportCycleBalanceSnapshot(companyId);
      const diagnostics = await buildImportCycleDiagnostics(companyId, snapshot);
      res.json(diagnostics);
    } catch (error: unknown) {
      logger.error("Import cycle diagnostics error:", { error });
      res.status(500).json({ message: getErrorMessage(error) });
    }
  });
}
