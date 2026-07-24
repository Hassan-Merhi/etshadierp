import type { Express } from "express";
import { logger } from "../../lib/logger";
import Decimal from "decimal.js";
import { requireAuth, requireNonPOS } from "../../auth";
import {
  getCashBankAccountSummary,
  getCashBankRevaluation,
  type CashBankCurrencySummary,
} from "../../services/accounting/cashBankRevaluationService";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rebuildBreakdown(accounts: any[]): Array<{ name: string; value: number }> {
  const totals = new Map<string, number>();
  for (const account of accounts) {
    const category = account.category || "Other";
    totals.set(category, (totals.get(category) || 0) + Number(account.value || 0));
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value: round2(value) }))
    .filter((row) => Math.abs(row.value) >= 0.005)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function applyCurrentCashTranslation(payload: any, summaries: CashBankCurrencySummary[]) {
  if (!payload?.forUs || !payload?.onUs) return payload;

  const resolved = summaries.filter((row) => row.currentTranslatedBaseBalance !== null);
  const resolvedLedgerIds = new Set(
    resolved.filter((row) => row.accountKind === "ledger").map((row) => row.id),
  );

  const oldForUsAccounts = Array.isArray(payload.forUs.accounts) ? payload.forUs.accounts : [];
  const oldOnUsAccounts = Array.isArray(payload.onUs.accounts) ? payload.onUs.accounts : [];
  const removedForUs = oldForUsAccounts.filter((row: any) => row.id && resolvedLedgerIds.has(row.id));
  const removedOnUs = oldOnUsAccounts.filter((row: any) => row.id && resolvedLedgerIds.has(row.id));

  const forUsAccounts = oldForUsAccounts.filter((row: any) => !row.id || !resolvedLedgerIds.has(row.id));
  const onUsAccounts = oldOnUsAccounts.filter((row: any) => !row.id || !resolvedLedgerIds.has(row.id));

  let forUsTotal = new Decimal(payload.forUs.total ?? payload.forUsTotal ?? 0);
  let onUsTotal = new Decimal(payload.onUs.total ?? payload.onUsTotal ?? 0);
  for (const row of removedForUs) forUsTotal = forUsTotal.minus(row.value || 0);
  for (const row of removedOnUs) onUsTotal = onUsTotal.minus(row.value || 0);

  for (const summary of resolved) {
    const translated = new Decimal(summary.currentTranslatedBaseBalance || 0);
    const accountRow = {
      id: summary.accountKind === "ledger" ? summary.id : undefined,
      name: summary.name,
      code: summary.code,
      value: translated.abs().toDecimalPlaces(2).toNumber(),
      category: "Cash / Bank (Current Translation)",
      currencyRevalued: true,
      nativeBalancesByCurrency: summary.nativeBalancesByCurrency,
      historicalBaseBalance: summary.historicalBaseBalance,
      currentTranslatedBaseBalance: summary.currentTranslatedBaseBalance,
      translationDifference: summary.translationDifference,
    };
    if (translated.gte(0)) {
      forUsAccounts.push(accountRow);
      forUsTotal = forUsTotal.plus(translated);
    } else {
      onUsAccounts.push(accountRow);
      onUsTotal = onUsTotal.plus(translated.abs());
    }
  }

  const forUsRounded = round2(forUsTotal.toNumber());
  const onUsRounded = round2(onUsTotal.toNumber());
  const netPosition = round2(forUsRounded - onUsRounded);

  payload.forUs.accounts = forUsAccounts.sort((a: any, b: any) => Number(b.value || 0) - Number(a.value || 0));
  payload.onUs.accounts = onUsAccounts.sort((a: any, b: any) => Number(b.value || 0) - Number(a.value || 0));
  payload.forUs.total = forUsRounded;
  payload.onUs.total = onUsRounded;
  payload.forUs.breakdown = rebuildBreakdown(payload.forUs.accounts);
  payload.onUs.breakdown = rebuildBreakdown(payload.onUs.accounts);
  payload.forUsTotal = forUsRounded;
  payload.onUsTotal = onUsRounded;
  payload.netPosition = netPosition;
  payload.netPositionLabel = netPosition >= 0 ? "Net Assets" : "Net Liabilities";
  return payload;
}

/**
 * Registered from statsRoutes only to keep the top-level route registry small.
 * The account URLs deliberately live under /api/accounts so accounting users do
 * not need the separate Analytics-module permission to view cash/bank balances.
 */
export function registerStatsMultiCurrencyRoutes(app: Express) {
  // Register before /api/stats/net-profit. It post-processes the live snapshot so
  // only actual cash/bank accounts are translated at the current rate. Historical
  // or date-filtered snapshots remain based on their stored historical amounts.
  app.use(async (req, res, next) => {
    if (req.method !== "GET" || req.path !== "/api/stats/net-profit" || req.query.toDate) {
      return next();
    }
    const companyId = req.session.currentCompanyId;
    if (!companyId) return next();

    try {
      const revaluation = await getCashBankRevaluation(companyId);
      const originalJson = res.json.bind(res);
      res.json = ((payload: any) => {
        // The existing report engine caches its object. Clone before adjusting so
        // repeated requests never reapply translation to the cached reference.
        const copy = payload == null ? payload : JSON.parse(JSON.stringify(payload));
        const adjusted = applyCurrentCashTranslation(copy, revaluation.accounts);
        adjusted.currencyRevaluation = {
          currentCfaPerUsd: revaluation.currentCfaPerUsd,
          unresolvedAccountCount: revaluation.unresolvedAccountCount,
          unresolvedAccounts: revaluation.accounts
            .filter((row) => row.totalsProvisional)
            .map((row) => ({
              accountKind: row.accountKind,
              id: row.id,
              name: row.name,
              openingBalanceCurrencyUnresolved: row.openingBalanceCurrencyUnresolved,
              unresolvedLegacyEntryCount: row.unresolvedLegacyEntryCount,
              currentRateMissing: row.currentRateMissing,
              unresolvedTranslationCurrencies: row.unresolvedTranslationCurrencies,
            })),
          appliedToCurrentSnapshotOnly: true,
        };
        return originalJson(adjusted);
      }) as typeof res.json;
    } catch (error) {
      logger.error("Unable to prepare cash-only Net Position translation:", { error: error });
    }
    return next();
  });

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
        logger.error("Multi-currency cash/bank revaluation failed:", { error: error });
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
        logger.error("Multi-currency account summary failed:", { error: error });
        return res.status(500).json({ message: error.message });
      }
    },
  );
}
