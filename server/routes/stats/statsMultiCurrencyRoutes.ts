import type { Express } from "express";
import { requireAuth, requireNonPOS } from "../../auth";
import {
  getCashBankAccountSummary,
  getCashBankRevaluation,
} from "../../services/accounting/cashBankRevaluationService";

/**
 * Registered from statsRoutes only to keep the top-level route registry small.
 * The URLs deliberately live under /api/accounts so accounting users do not
 * need the separate Analytics-module permission to view cash/bank balances.
 */
export function registerStatsMultiCurrencyRoutes(app: Express) {
  app.get(
    "/api/accounts/multi-currency/cash-bank-revaluation",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });
        return res.json(await getCashBankRevaluation(companyId));
      } catch (error: any) {
        console.error("Multi-currency cash/bank revaluation failed:", error);
        return res.status(500).json({ message: error.message });
      }
    },
  );

  app.get(
    "/api/accounts/multi-currency/:kind/:id",
    requireAuth,
    requireNonPOS,
    async (req, res) => {
      try {
        const companyId = req.session.currentCompanyId;
        if (!companyId) return res.status(400).json({ message: "No company selected" });

        const kind = req.params.kind;
        if (kind !== "ledger" && kind !== "bank") {
          return res.status(400).json({ message: "Account kind must be ledger or bank" });
        }
        const accountId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(accountId) || accountId <= 0) {
          return res.status(400).json({ message: "Invalid account ID" });
        }

        const summary = await getCashBankAccountSummary(companyId, kind, accountId);
        if (!summary) return res.status(404).json({ message: "Cash/bank account not found" });
        return res.json(summary);
      } catch (error: any) {
        console.error("Multi-currency account summary failed:", error);
        return res.status(500).json({ message: error.message });
      }
    },
  );
}
