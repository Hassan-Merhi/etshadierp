import type { Express } from "express";
import { requireAuth } from "../auth";
import { getLedgerParentGroupOptions } from "../services/ledgerAccountOptionsService";
import { registerLedgerRoutes as registerLegacyLedgerRoutes } from "./ledgerRoutesLegacy";
import {
  normalizeAccountOpeningBalance,
  registerAccountCurrencyRoutes,
} from "./accountCurrencyRoutes";
import { registerHistoricalCurrencyGuardRoutes } from "./historicalCurrencyGuardRoutes";

export function registerLedgerRoutes(app: Express) {
  // This module registers before the legacy bank/account/report route modules.
  // Install write normalization, safe reads, and historical-report readiness
  // guards here so every existing caller receives the corrected currency model.
  app.use(normalizeAccountOpeningBalance);
  registerHistoricalCurrencyGuardRoutes(app);
  registerAccountCurrencyRoutes(app);

  app.get("/api/ledger-accounts/parent-groups", requireAuth, async (req, res) => {
    try {
      const requestedCompanyId =
        typeof req.query.companyId === "string" ? Number.parseInt(req.query.companyId, 10) : undefined;
      const sessionCompanyId = req.session.currentCompanyId;
      const companyId = requestedCompanyId || sessionCompanyId;

      if (!companyId) {
        return res.status(400).json({ message: "No company selected" });
      }
      if (requestedCompanyId && sessionCompanyId && requestedCompanyId !== sessionCompanyId) {
        return res.status(403).json({ message: "Access denied for selected company" });
      }

      const options = await getLedgerParentGroupOptions(companyId, req.query.includeHidden === "true");
      return res.json(options);
    } catch (error: any) {
      return res.status(500).json({ message: error.message });
    }
  });

  registerLegacyLedgerRoutes(app);
}
