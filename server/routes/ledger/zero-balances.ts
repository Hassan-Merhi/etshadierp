/**
 * ledgerRoutesLegacy: LedgerZeroBalance endpoints.
 *
 * Registered by ./index.ts in the original order; Express resolves
 * first-match, so that order is behaviour.
 */
import type { Express } from "express";
import { getErrorMessage } from "../../lib/httpHandlers";
import { storage } from "../../storage";
import { requireAuth, requireRole } from "../../auth";

export function registerLedgerZeroBalanceRoutes(app: Express) {
  // Zero opening balances for selected ledger accounts
  app.post("/api/ledger-accounts/zero-balances", requireAuth, requireRole("Admin"), async (req, res) => {
    try {
      if (!req.session.currentCompanyId) {
        return res.status(400).json({ message: "No company selected" });
      }

      const { accountIds } = req.body;
      if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
        return res.status(400).json({ message: "No accounts selected" });
      }

      // Get all accounts for this company
      const allAccounts = await storage.getAllLedgerAccounts(req.session.currentCompanyId);
      const validAccountIds = allAccounts.map((a) => a.id);

      // Filter to only accounts that belong to this company
      const accountsToUpdate = accountIds.filter((id: number) => validAccountIds.includes(id));

      if (accountsToUpdate.length === 0) {
        return res.status(400).json({ message: "No valid accounts found" });
      }

      // Update each account to zero its opening balance
      let count = 0;
      for (const accountId of accountsToUpdate) {
        await storage.updateLedgerAccount({
          id: accountId,
          openingBalance: "0",
          openingBalanceSide: undefined,
        });
        count++;
      }

      res.json({ message: `Opening balances zeroed for ${count} account(s)`, count });
    } catch (error: unknown) {
      res.status(400).json({ message: getErrorMessage(error) });
    }
  });
}
